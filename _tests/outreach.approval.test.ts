import {afterAll, beforeAll, beforeEach, describe, expect, it, vi} from "vitest";
import {ObjectId} from "mongodb";
import request from "supertest";
import {connectTestDatabase, disconnectTestDatabase} from "@coreModule/_tests/testDatabase";

vi.mock("@coreModule/utilities/middlewares/authMW", async () =>
    (await import("@coreModule/_tests/httpHarness")).authMWStub);
// No Redis in tests
vi.mock("@coreModule/utilities/middlewares/rateLimiter", () => ({
    rateLimiter: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
// The routes' orchestrator sends through the fake mail port, never a live provider.
vi.mock("@swissOutreachModule/utilities/adapters/createPorts", async () => (await import("./outreach.fixtures")).createPortsMock);

import {allPermissionTags, appFor, callerHeader, type TestCaller} from "@coreModule/_tests/httpHarness";
import {withTenant} from "@coreModule/utilities/endpoints/tenantScope";
import * as campaignRoute from "@swissOutreachModule/api/swissOutreach/private/campaign";
import * as outreachEmailRoute from "@swissOutreachModule/api/swissOutreach/private/outreachEmail";
import * as dashboardRoute from "@swissOutreachModule/api/swissOutreach/private/dashboard";
import Campaign from "@swissOutreachModule/database/schemas/campaign/campaign";
import ProspectCompany from "@swissOutreachModule/database/schemas/prospectCompany/prospectCompany";
import OutreachEmail from "@swissOutreachModule/database/schemas/outreachEmail/outreachEmail";
import PipelineRunLog from "@swissOutreachModule/database/schemas/pipelineRunLog/pipelineRunLog";
import SuppressedContact from "@swissOutreachModule/database/schemas/suppressedContact/suppressedContact";
import {DO_NOT_CONTACT_SKIP_REASON} from "@swissOutreachModule/database/schemas/suppressedContact/suppressedContact.service";
import {campaignOrchestrator} from "@swissOutreachModule/utilities/pipeline/campaignOrchestrator";
import type {MailSendRequest, MailSendResult} from "@swissOutreachModule/utilities/ports";
import {createCampaign, fakePorts, seedReview, testPorts} from "./outreach.fixtures";

const companyId = new ObjectId();
const otherCompanyId = new ObjectId();
/** The tests act on this company's data, as its requests and jobs do (D16). */
const asCompany = <T>(fn: () => PromiseLike<T>): Promise<T> => withTenant(companyId, fn);
const asOther = <T>(fn: () => PromiseLike<T>): Promise<T> => withTenant(otherCompanyId, fn);

const app = appFor([
    {basePath: "/api/swissOutreach/campaign", router: campaignRoute.router, module: "swissOutreach"},
    {basePath: "/api/swissOutreach/outreachEmail", router: outreachEmailRoute.router, module: "swissOutreach"},
    {basePath: "/api/swissOutreach/dashboard", router: dashboardRoute.router, module: "swissOutreach"},
]);

/** Every campaign, prospect and email permission, the seven actions included (D86). */
const staff: TestCaller = {userId: new ObjectId().toString(), companyId: companyId.toString(), isAdmin: true, permissions: allPermissionTags([Campaign, OutreachEmail, ProspectCompany])};
const outsider: TestCaller = {...staff, companyId: otherCompanyId.toString()};
/** May edit campaigns and emails, but holds none of their actions. */
const editor: TestCaller = {...staff, permissions: staff.permissions!.filter((tag) => !tag.includes("[action:"))};
const send = vi.fn(async (_request: MailSendRequest): Promise<MailSendResult> => ({accepted: true, messageId: "msg-1"}));

const post = (path: string, body: Record<string, unknown>, caller: TestCaller = staff) =>
    request(app).post(`/api/swissOutreach/${path}`).set(callerHeader(caller)).send(body);

/** `sendApproved` answers at once and sends in the background: this waits until the campaign is no longer sending. */
async function sendAndSettle(campaignId: string) {
    const response = await post("campaign/sendApproved", {campaignId});
    await vi.waitFor(async () => expect((await Campaign.findById(campaignId))!.status).not.toBe("sending"), {timeout: 10000, interval: 25});
    return response;
}

beforeAll(async () => {
    process.env.SWISS_OUTREACH_REQUEST_DELAY_MS = "0";
    process.env.SWISS_OUTREACH_RETRY_COUNT = "1";
    process.env.SWISS_OUTREACH_MAX_SENDS_PER_MINUTE = "600";
    await connectTestDatabase();
}, 120000);

afterAll(async () => {
    await disconnectTestDatabase();
});

beforeEach(async () => {
    vi.restoreAllMocks();
    send.mockClear();
    testPorts.current = fakePorts({mail: {send}});
    // Raw collection deletes: the soft-delete plugin would only mark the rows deleted
    await Promise.all([Campaign, ProspectCompany, OutreachEmail, PipelineRunLog, SuppressedContact].map((model) => model.collection.deleteMany({})));
});

describe("approving one email", {timeout: 30000}, () => {
    it("approves a draft and its prospect, and counts it once", () => asCompany(async () => {
        const {campaign, emails, prospects} = await seedReview(companyId, [{status: "draft", toEmail: "info@one.ch"}]);

        const first = await post("outreachEmail/approve", {emailId: emails[0]._id.toString()});
        expect(first.status).toBe(200);
        expect(first.body.data.status).toBe("approved");
        expect((await ProspectCompany.findById(prospects[0]._id))!.status).toBe("approved");
        expect((await Campaign.findById(campaign._id))!.stats.approved).toBe(1);

        expect((await post("outreachEmail/approve", {emailId: emails[0]._id.toString()})).status).toBe(200);
        expect((await Campaign.findById(campaign._id))!.stats.approved).toBe(1);
    }));

    it("refuses an email without a recipient", () => asCompany(async () => {
        const {emails} = await seedReview(companyId, [{status: "draft"}]);
        const response = await post("outreachEmail/approve", {emailId: emails[0]._id.toString()});
        expect(response.status).toBe(400);
        expect(response.body.error_code).toBe("email_missing_recipient");
        expect((await OutreachEmail.findById(emails[0]._id))!.status).toBe("draft");
    }));

    // Regression (TD-B129): approve did not check the do-not-contact list, so the email showed approved.
    it("skips an email whose recipient is on the do-not-contact list, with the reason, instead of approving it", () => asCompany(async () => {
        const {campaign, emails, prospects} = await seedReview(companyId, [{status: "failed", toEmail: "Info@One.ch"}]);
        await SuppressedContact.create({company: companyId, source: "manual", domain: "one.ch"});

        const response = await post("outreachEmail/approve", {emailId: emails[0]._id.toString()});
        expect(response.status).toBe(200);
        expect(response.body.data).toMatchObject({status: "skipped", lastError: DO_NOT_CONTACT_SKIP_REASON});
        expect(await OutreachEmail.findById(emails[0]._id)).toMatchObject({status: "skipped", lastError: DO_NOT_CONTACT_SKIP_REASON});
        expect((await ProspectCompany.findById(prospects[0]._id))!.status).toBe("skipped");
        expect((await Campaign.findById(campaign._id))!.stats.approved).toBe(0);
    }));

    it("approves a failed email again, so the next send retries it", () => asCompany(async () => {
        const {emails} = await seedReview(companyId, [{status: "failed", toEmail: "info@one.ch"}]);
        const response = await post("outreachEmail/approve", {emailId: emails[0]._id.toString()});
        expect(response.status).toBe(200);
        expect((await OutreachEmail.findById(emails[0]._id))!.status).toBe("approved");
    }));

    // Regression: approving a sent or in-flight email put it back to `approved`, so the next send mailed it again.
    it("leaves a sent or in-flight email as it is, so it is never sent twice", () => asCompany(async () => {
        const {campaign, emails, prospects} = await seedReview(companyId, [
            {status: "sent", toEmail: "info@one.ch"},
            {status: "queued", toEmail: "info@two.ch"},
        ]);
        await Campaign.updateOne({_id: campaign._id}, {$set: {"stats.approved": 2}});

        for (const email of emails) {
            const response = await post("outreachEmail/approve", {emailId: email._id.toString()});
            expect(response.status).toBe(200);
            expect(response.body.data.status).toBe(email.status);
        }
        expect((await OutreachEmail.findById(emails[0]._id))!.status).toBe("sent");
        expect((await OutreachEmail.findById(emails[1]._id))!.status).toBe("queued");
        expect((await ProspectCompany.findById(prospects[0]._id))!.status).toBe("sent");
        expect((await Campaign.findById(campaign._id))!.stats.approved).toBe(2);

        const sending = await sendAndSettle(campaign._id.toString());
        expect(sending.status).toBe(200);
        expect(send).not.toHaveBeenCalled();
        expect((await Campaign.findById(campaign._id))!.stats.sent).toBe(0);
    }));
});

describe("skipping and editing", {timeout: 30000}, () => {
    it("skips an email and its prospect, and approve all leaves it skipped", () => asCompany(async () => {
        const {campaign, emails, prospects} = await seedReview(companyId, [{status: "draft", toEmail: "info@one.ch"}]);
        const response = await post("outreachEmail/skip", {emailId: emails[0]._id.toString()});
        expect(response.status).toBe(200);
        expect(response.body.data.status).toBe("skipped");
        expect((await ProspectCompany.findById(prospects[0]._id))!.status).toBe("skipped");

        await post("campaign/approveAll", {campaignId: campaign._id.toString()});
        expect((await OutreachEmail.findById(emails[0]._id))!.status).toBe("skipped");
    }));

    it("refuses to skip or rewrite a sent or in-flight email", () => asCompany(async () => {
        const {emails, prospects} = await seedReview(companyId, [
            {status: "sent", toEmail: "info@one.ch"},
            {status: "queued", toEmail: "info@two.ch"},
        ]);
        for (const email of emails) {
            for (const path of ["outreachEmail/skip", "outreachEmail/editDraft"]) {
                const response = await post(path, {emailId: email._id.toString(), subject: "Rewritten"});
                expect(response.status).toBe(409);
                expect(response.body.error_code).toBe("email_already_sent");
            }
        }
        expect(await OutreachEmail.findById(emails[0]._id)).toMatchObject({status: "sent", subject: "Anfrage Offerte"});
        expect(await OutreachEmail.findById(emails[1]._id)).toMatchObject({status: "queued", subject: "Anfrage Offerte"});
        expect((await ProspectCompany.findById(prospects[0]._id))!.status).toBe("sent");
    }));

    it("editing an approved email takes it out of the approved count until it is approved again", () => asCompany(async () => {
        const {campaign, emails} = await seedReview(companyId, [{status: "draft", toEmail: "info@one.ch"}]);
        await post("outreachEmail/approve", {emailId: emails[0]._id.toString()});
        expect((await Campaign.findById(campaign._id))!.stats.approved).toBe(1);

        await post("outreachEmail/editDraft", {emailId: emails[0]._id.toString(), body: "Neuer Text"});
        expect((await OutreachEmail.findById(emails[0]._id))!.status).toBe("edited");
        expect((await Campaign.findById(campaign._id))!.stats.approved).toBe(0);

        // Editing an edited email again changes no count
        await post("outreachEmail/editDraft", {emailId: emails[0]._id.toString(), body: "Noch neuer"});
        expect((await Campaign.findById(campaign._id))!.stats.approved).toBe(0);
        await post("outreachEmail/approve", {emailId: emails[0]._id.toString()});
        expect((await Campaign.findById(campaign._id))!.stats.approved).toBe(1);
    }));

    // Regression: skipping an approved email left it in the approved count.
    it("skipping an approved email takes it out of the approved count", () => asCompany(async () => {
        const {campaign, emails} = await seedReview(companyId, [{status: "draft", toEmail: "info@one.ch"}, {status: "draft", toEmail: "info@two.ch"}]);
        await post("outreachEmail/approve", {emailId: emails[0]._id.toString()});
        expect((await Campaign.findById(campaign._id))!.stats.approved).toBe(1);

        expect((await post("outreachEmail/skip", {emailId: emails[0]._id.toString()})).status).toBe(200);
        expect((await Campaign.findById(campaign._id))!.stats.approved).toBe(0);

        // Skipping an email that was never approved changes no count
        await post("outreachEmail/skip", {emailId: emails[1]._id.toString()});
        expect((await Campaign.findById(campaign._id))!.stats.approved).toBe(0);
    }));

    // Regression: an email drafted without a recipient could never be approved, since no edit could set one.
    it("an edit sets the recipient, so an email without one can then be approved", () => asCompany(async () => {
        const {emails} = await seedReview(companyId, [{status: "draft"}]);
        const emailId = emails[0]._id.toString();

        const invalid = await post("outreachEmail/editDraft", {emailId, toEmail: "not an address"});
        expect(invalid.status).toBe(400);
        expect(invalid.body.error_code).toBe("form_not_correct");
        expect((await OutreachEmail.findById(emailId))!.toEmail).toBeUndefined();

        const edited = await post("outreachEmail/editDraft", {emailId, toEmail: "offerte@one.ch"});
        expect(edited.status).toBe(200);
        expect(await OutreachEmail.findById(emailId)).toMatchObject({status: "edited", toEmail: "offerte@one.ch", subject: "Anfrage Offerte"});
        expect((await post("outreachEmail/approve", {emailId})).body.data.status).toBe("approved");
    }));

    it("an edit changes only the parts given and marks the email edited", () => asCompany(async () => {
        const {emails} = await seedReview(companyId, [{status: "draft", toEmail: "info@one.ch"}]);
        const response = await post("outreachEmail/editDraft", {emailId: emails[0]._id.toString(), subject: "Neue Anfrage"});
        expect(response.status).toBe(200);
        expect(await OutreachEmail.findById(emails[0]._id)).toMatchObject({status: "edited", subject: "Neue Anfrage", body: "Guten Tag"});
    }));
});

describe("approving a whole campaign", {timeout: 30000}, () => {
    it("approves every draft and edited email with a recipient, and their prospects, nothing else", () => asCompany(async () => {
        const {campaign, emails, prospects} = await seedReview(companyId, [
            {status: "draft", toEmail: "a@one.ch"},
            {status: "edited", toEmail: "b@one.ch"},
            {status: "draft"},
            {status: "skipped", toEmail: "c@one.ch"},
            {status: "failed", toEmail: "d@one.ch"},
            {status: "sent", toEmail: "e@one.ch"},
        ]);

        const response = await post("campaign/approveAll", {campaignId: campaign._id.toString()});
        expect(response.status).toBe(200);

        const statuses = await Promise.all(emails.map(async (email) => (await OutreachEmail.findById(email._id))!.status));
        expect(statuses).toEqual(["approved", "approved", "draft", "skipped", "failed", "sent"]);
        // Regression: the count left out emails already sent, unlike approve and send (approved = approved + queued + sent).
        expect(response.body.data.stats.approved).toBe(3);
        expect((await Campaign.findById(campaign._id))!.stats.approved).toBe(3);
        const prospectStatuses = await Promise.all(prospects.map(async (prospect) => (await ProspectCompany.findById(prospect._id))!.status));
        expect(prospectStatuses).toEqual(["approved", "approved", "scored", "scored", "scored", "sent"]);
    }));

    it("skips the emails to addresses on the do-not-contact list, with the reason, and approves the rest", () => asCompany(async () => {
        const {campaign, emails, prospects} = await seedReview(companyId, [
            {status: "draft", toEmail: "a@one.ch"},
            {status: "edited", toEmail: "stop@two.ch"},
        ]);
        await SuppressedContact.create({company: companyId, source: "manual", email: "stop@two.ch"});

        const response = await post("campaign/approveAll", {campaignId: campaign._id.toString()});
        expect(response.status).toBe(200);
        expect(response.body.data.stats.approved).toBe(1);
        expect(await OutreachEmail.findById(emails[0]._id)).toMatchObject({status: "approved"});
        expect(await OutreachEmail.findById(emails[1]._id)).toMatchObject({status: "skipped", lastError: DO_NOT_CONTACT_SKIP_REASON});
        expect((await ProspectCompany.findById(prospects[1]._id))!.status).toBe("skipped");
    }));

    it("then sends the approved emails through the mail port", () => asCompany(async () => {
        const {campaign, emails} = await seedReview(companyId, [{status: "draft", toEmail: "a@one.ch"}, {status: "draft"}]);
        await post("campaign/approveAll", {campaignId: campaign._id.toString()});

        const response = await sendAndSettle(campaign._id.toString());
        expect(response.status).toBe(200);
        expect(response.body.data.status).toBe("sending");
        expect((await Campaign.findById(campaign._id))!).toMatchObject({status: "completed", stats: {sent: 1, approved: 1}});
        expect(send).toHaveBeenCalledTimes(1);
        expect(send.mock.calls[0][0]).toMatchObject({to: "a@one.ch", companyId: companyId.toString()});
        expect((await OutreachEmail.findById(emails[0]._id))!.status).toBe("sent");
    }));

    it("sends only once the pipeline has stopped", () => asCompany(async () => {
        for (const status of ["draft", "searching", "sending", "cancelled"] as const) {
            const {campaign, emails} = await seedReview(companyId, [{status: "approved", toEmail: "a@one.ch"}], {status});
            const response = await post("campaign/sendApproved", {campaignId: campaign._id.toString()});
            expect(response.status).toBe(409);
            expect(response.body.error_code).toBe("campaign_cannot_send");
            expect((await OutreachEmail.findById(emails[0]._id))!.status).toBe("approved");
        }
        expect(send).not.toHaveBeenCalled();
        for (const status of ["completed", "failed"] as const) {
            const {campaign} = await seedReview(companyId, [{status: "approved", toEmail: "b@one.ch"}], {status});
            expect((await sendAndSettle(campaign._id.toString())).status).toBe(200);
            expect((await Campaign.findById(campaign._id))!.stats.sent).toBe(1);
        }
        expect(send).toHaveBeenCalledTimes(2);
    }));

    it("starts a campaign that can run and refuses one that cannot", () => asCompany(async () => {
        const enqueue = vi.spyOn(campaignOrchestrator, "enqueue").mockImplementation(() => undefined);
        // Regression (A8): a campaign mid-pipeline (parsing → scoring) could be started again and ran twice.
        for (const status of ["parsing", "searching", "enriching", "scoring", "sending", "completed", "cancelled"] as const) {
            const campaign = await createCampaign(companyId, {status});
            const response = await post("campaign/start", {campaignId: campaign._id.toString()});
            expect(response.status).toBe(409);
            expect(response.body.error_code).toBe("campaign_cannot_start");
            expect((await Campaign.findById(campaign._id))!.status).toBe(status);
        }
        // Already running in this process
        const running = await createCampaign(companyId, {status: "awaiting_approval"});
        const isRunning = vi.spyOn(campaignOrchestrator, "isRunning").mockImplementation((id) => id === running._id.toString());
        expect((await post("campaign/start", {campaignId: running._id.toString()})).body.error_code).toBe("campaign_cannot_start");
        expect(enqueue).not.toHaveBeenCalled();

        for (const status of ["draft", "failed", "awaiting_approval"] as const) {
            const campaign = await createCampaign(companyId, {status});
            const response = await post("campaign/start", {campaignId: campaign._id.toString()});
            expect(response.status).toBe(200);
            // Claimed for the run at once, so a second start sees it running
            expect(response.body.data.status).toBe("parsing");
            expect((await Campaign.findById(campaign._id))!.status).toBe("parsing");
            expect(enqueue).toHaveBeenLastCalledWith(campaign._id.toString(), companyId.toString());
        }
        expect(enqueue).toHaveBeenCalledTimes(3);
        isRunning.mockRestore();
    }));

    // Regression (A8): two starts at once both passed the status check and ran the pipeline twice.
    it("runs a campaign once when two starts race", () => asCompany(async () => {
        const enqueue = vi.spyOn(campaignOrchestrator, "enqueue").mockImplementation(() => undefined);
        const campaign = await createCampaign(companyId, {status: "awaiting_approval"});
        const responses = await Promise.all([1, 2].map(() => post("campaign/start", {campaignId: campaign._id.toString()})));
        expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
        expect(enqueue).toHaveBeenCalledTimes(1);
    }));

    it("cancels a campaign", () => asCompany(async () => {
        const campaign = await createCampaign(companyId, {status: "awaiting_approval"});
        const response = await post("campaign/cancel", {campaignId: campaign._id.toString()});
        expect(response.status).toBe(200);
        expect(response.body.data.status).toBe("cancelled");
    }));

    // Regression: cancel had no status check, so a completed campaign could be turned into a cancelled one.
    it("refuses to cancel a completed or cancelled campaign", () => asCompany(async () => {
        for (const status of ["completed", "cancelled"] as const) {
            const campaign = await createCampaign(companyId, {status});
            const response = await post("campaign/cancel", {campaignId: campaign._id.toString()});
            expect(response.status).toBe(409);
            expect(response.body.error_code).toBe("campaign_cannot_cancel");
            expect((await Campaign.findById(campaign._id))!.status).toBe(status);
        }
        expect(await PipelineRunLog.countDocuments({step: "cancel"})).toBe(0);
    }));
});

describe("action permissions", {timeout: 30000}, () => {
    it("refuses every action to a user without its permission, even one who may edit the records", () => asCompany(async () => {
        const enqueue = vi.spyOn(campaignOrchestrator, "enqueue").mockImplementation(() => undefined);
        const {campaign, emails} = await seedReview(companyId, [{status: "draft", toEmail: "a@one.ch"}, {status: "approved", toEmail: "b@one.ch"}]);
        const emailId = emails[0]._id.toString();
        const campaignId = campaign._id.toString();

        const refused = [
            ...["approve", "skip", "editDraft"].map((name) => post(`outreachEmail/${name}`, {emailId, subject: "x"}, editor)),
            ...["start", "cancel", "approveAll", "sendApproved"].map((name) => post(`campaign/${name}`, {campaignId}, editor)),
        ];
        for (const response of await Promise.all(refused)) {
            expect(response.status).toBe(403);
            expect(response.body.error_code).toBe("user_permissions_not_sufficient");
        }

        expect(enqueue).not.toHaveBeenCalled();
        expect(send).not.toHaveBeenCalled();
        expect((await OutreachEmail.findById(emails[0]._id))!.status).toBe("draft");
        expect((await Campaign.findById(campaign._id))!.status).toBe("awaiting_approval");
    }));

    it("each action is its own permission", async () => {
        expect(staff.permissions).toEqual(expect.arrayContaining([
            "swissoutreachcampaigns[action:start]",
            "swissoutreachcampaigns[action:cancel]",
            "swissoutreachcampaigns[action:approveAll]",
            "swissoutreachcampaigns[action:sendApproved]",
            "swissoutreachemails[action:approve]",
            "swissoutreachemails[action:skip]",
            "swissoutreachemails[action:editDraft]",
        ]));
    });
});

describe("tenancy", {timeout: 30000}, () => {
    it("another company's campaign and emails are not found and stay as they are", async () => {
        const {campaign, emails} = await asCompany(() => seedReview(companyId, [{status: "draft", toEmail: "a@one.ch"}, {status: "approved", toEmail: "b@one.ch"}]));
        const emailId = emails[0]._id.toString();
        const campaignId = campaign._id.toString();

        for (const path of ["outreachEmail/approve", "outreachEmail/skip", "outreachEmail/editDraft"]) {
            const response = await post(path, {emailId, subject: "Hijacked"}, outsider);
            expect(response.status).toBe(404);
            expect(response.body.error_code).toBe("email_not_found");
        }
        for (const path of ["campaign/approveAll", "campaign/sendApproved", "campaign/cancel", "campaign/start"]) {
            const response = await post(path, {campaignId}, outsider);
            expect(response.status).toBe(404);
            expect(response.body.error_code).toBe("campaign_not_found");
        }
        const logs = await post("campaign/logs", {campaignId}, outsider);
        expect(logs.body.error_code).toBe("campaign_not_found");

        expect(send).not.toHaveBeenCalled();
        const stored = await asCompany(() => OutreachEmail.find({campaignId: campaign._id}).sort({_id: 1}));
        expect(stored.map((email) => [email.status, email.subject])).toEqual([["draft", "Anfrage Offerte"], ["approved", "Anfrage Offerte"]]);
        expect((await asCompany(() => Campaign.findById(campaign._id)))!.status).toBe("awaiting_approval");
    });
});

describe("dashboard summary", {timeout: 30000}, () => {
    it("counts the company's campaigns, prospects and sends", async () => {
        const {campaign} = await asCompany(() => seedReview(companyId, [
            {status: "sent", toEmail: "a@one.ch"},
            {status: "sent", toEmail: "b@one.ch"},
            {status: "sent", toEmail: "c@one.ch"},
            {status: "failed", toEmail: "d@one.ch"},
            {status: "draft", toEmail: "e@one.ch"},
        ]));
        await asCompany(async () => {
            await createCampaign(companyId, {status: "completed"});
            await ProspectCompany.create({company: companyId, campaignId: campaign._id, companyName: "Top AG", dedupeKey: "CHE-9", status: "scored", score: 81});
        });
        // Another company's records count for nothing
        await asOther(() => seedReview(otherCompanyId, [{status: "sent", toEmail: "x@two.ch"}]));

        const response = await post("dashboard/summary", {});
        expect(response.status).toBe(200);
        expect(response.body.data).toEqual({
            companiesFound: 6,
            companiesContacted: 3,
            emailsSent: 3,
            failures: 1,
            successRate: 75,
            // (5 × 50 + 81) / 6 = 55.17
            averageScore: 55.2,
            campaignsTotal: 2,
            campaignsActive: 1,
        });
    });

    it("counts one campaign's prospects and sends when a campaign is picked", async () => {
        const {campaign} = await asCompany(() => seedReview(companyId, [
            {status: "sent", toEmail: "a@one.ch"},
            {status: "failed", toEmail: "b@one.ch"},
        ]));
        await asCompany(() => seedReview(companyId, [{status: "sent", toEmail: "c@one.ch"}, {status: "sent", toEmail: "d@one.ch"}], {status: "completed"}));

        const response = await post("dashboard/summary", {campaignId: campaign._id.toString()});
        expect(response.status).toBe(200);
        expect(response.body.data).toEqual({
            companiesFound: 2,
            companiesContacted: 1,
            emailsSent: 1,
            failures: 1,
            successRate: 50,
            averageScore: 50,
            campaignsTotal: 1,
            campaignsActive: 1,
        });
        expect((await post("dashboard/summary", {campaignId: "not-an-id"})).body.error_code).toBe("form_not_correct");
    });

    // TD-B146: the counts are read field by field like any list (SEC-09)
    it("refuses a caller who may not read the prospects' status and score", async () => {
        const prospectReadTags = allPermissionTags([ProspectCompany]);
        const noProspects: TestCaller = {...staff, permissions: staff.permissions!.filter((tag) => !prospectReadTags.includes(tag))};

        const response = await post("dashboard/summary", {}, noProspects);
        expect(response.status).toBe(403);
        expect(response.body.error_code).toBe("user_permissions_not_sufficient");
    });
});
