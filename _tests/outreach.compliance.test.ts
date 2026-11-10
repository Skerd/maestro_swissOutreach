import {afterAll, beforeAll, beforeEach, describe, expect, it, vi} from "vitest";
import mongoose from "mongoose";
import {ObjectId} from "mongodb";
import request from "supertest";
import {connectTestDatabase, disconnectTestDatabase} from "@coreModule/_tests/testDatabase";

vi.mock("@coreModule/utilities/middlewares/authMW", async () =>
    (await import("@coreModule/_tests/httpHarness")).authMWStub);
// No Redis in tests
vi.mock("@coreModule/utilities/middlewares/rateLimiter", () => ({
    rateLimiter: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("@swissOutreachModule/utilities/adapters/createPorts", async () => (await import("./outreach.fixtures")).createPortsMock);
vi.mock("@coreModule/utilities/gridfs/gridfsStorage", () => ({getGridFSStorage: () => ({deleteFile: async () => undefined})}));

import {allPermissionTags, appFor, callerHeader, type TestCaller} from "@coreModule/_tests/httpHarness";
import {asCrossTenant, withTenant} from "@coreModule/utilities/endpoints/tenantScope";
import {EMAIL} from "@coreModule/environment";
import * as privacyRoute from "@coreModule/api/company/private/privacy";
import {ERASED_EMAIL, ERASED_NAME, loadPersonErasers} from "@coreModule/utilities/erasure/personErasure";
import * as outreachEmailRoute from "@swissOutreachModule/api/swissOutreach/private/outreachEmail";
import * as suppressedContactRoute from "@swissOutreachModule/api/swissOutreach/private/suppressedContact";
import Campaign from "@swissOutreachModule/database/schemas/campaign/campaign";
import ProspectCompany from "@swissOutreachModule/database/schemas/prospectCompany/prospectCompany";
import OutreachEmail from "@swissOutreachModule/database/schemas/outreachEmail/outreachEmail";
import PipelineRunLog from "@swissOutreachModule/database/schemas/pipelineRunLog/pipelineRunLog";
import SuppressedContact from "@swissOutreachModule/database/schemas/suppressedContact/suppressedContact";
import {CampaignOrchestrator} from "@swissOutreachModule/utilities/pipeline/campaignOrchestrator";
import {mailDeliveryAdapter} from "@swissOutreachModule/utilities/adapters/mailAdapter";
import type {MailSendRequest, MailSendResult} from "@swissOutreachModule/utilities/ports";
import {createCampaign, fakePorts, NO_WEBSITE, PLUMBER, seedReview} from "./outreach.fixtures";

const companyId = new ObjectId();
const otherCompanyId = new ObjectId();
const asCompany = <T>(fn: () => PromiseLike<T>): Promise<T> => withTenant(companyId, fn);
const asOther = <T>(fn: () => PromiseLike<T>): Promise<T> => withTenant(otherCompanyId, fn);
const raw = <T>(fn: () => Promise<T>) => asCrossTenant("test reads raw collections", fn);

const app = appFor([
    {...privacyRoute, module: "core"},
    {basePath: "/api/swissOutreach/outreachEmail", router: outreachEmailRoute.router, module: "swissOutreach"},
    {basePath: "/api/swissOutreach/suppressedContact", router: suppressedContactRoute.router, module: "swissOutreach"},
]);
const staff: TestCaller = {
    userId: new ObjectId().toString(),
    companyId: companyId.toString(),
    isAdmin: true,
    permissions: allPermissionTags([OutreachEmail, SuppressedContact]),
    modules: ["core", "swissOutreach"],
};
const call = (method: "put" | "patch" | "post", path: string, body: Record<string, unknown>) =>
    request(app)[method](`/api/swissOutreach/${path}`).set(callerHeader(staff)).send(body);
const accepted = () => vi.fn(async (_request: MailSendRequest): Promise<MailSendResult> => ({accepted: true, messageId: "m-1"}));
const suppress = (company: ObjectId, entry: {email?: string; domain?: string}) =>
    SuppressedContact.create({company, source: "manual", ...entry});

beforeAll(async () => {
    process.env.SWISS_OUTREACH_REQUEST_DELAY_MS = "0";
    process.env.SWISS_OUTREACH_RETRY_COUNT = "1";
    await connectTestDatabase();
    // Every module's eraser (and so its models) first, then every index: an index built inside the erasure's
    // transaction aborts it.
    await loadPersonErasers();
    await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
}, 120000);

afterAll(async () => {
    await disconnectTestDatabase();
});

beforeEach(async () => {
    vi.restoreAllMocks();
    await Promise.all([Campaign, ProspectCompany, OutreachEmail, PipelineRunLog, SuppressedContact].map((model) => model.collection.deleteMany({})));
});

describe("the do-not-contact list", {timeout: 30000}, () => {
    it("drafts nothing to a listed domain or address, in any campaign of the company", () => asCompany(async () => {
        await suppress(companyId, {domain: "test-sanitaer.ch"});
        const orchestrator = new CampaignOrchestrator(fakePorts());
        for (const campaign of [await createCampaign(companyId), await createCampaign(companyId)]) {
            await orchestrator.run(campaign._id.toString());
            const plumber = (await ProspectCompany.findOne({campaignId: campaign._id, uid: PLUMBER.uid}))!;
            expect(plumber.status).toBe("skipped");
            expect(await OutreachEmail.countDocuments({prospectCompanyId: plumber._id})).toBe(0);
            // A prospect without an address is drafted as before, for a reviewer to address
            const empty = (await ProspectCompany.findOne({campaignId: campaign._id, uid: NO_WEBSITE.uid}))!;
            expect(await OutreachEmail.countDocuments({prospectCompanyId: empty._id})).toBe(1);
        }
    }));

    it("drafts to the prospect's other address when only one is listed", () => asCompany(async () => {
        await suppress(companyId, {email: "info@test-sanitaer.ch"});
        const campaign = await createCampaign(companyId);
        await new CampaignOrchestrator(fakePorts()).run(campaign._id.toString());
        const plumber = (await ProspectCompany.findOne({campaignId: campaign._id, uid: PLUMBER.uid}))!;
        expect((await OutreachEmail.findOne({prospectCompanyId: plumber._id}))!.toEmail).toBe("jobs@test-sanitaer.ch");
    }));

    it("another company's list does not apply", () => asCompany(async () => {
        await asOther(() => suppress(otherCompanyId, {domain: "test-sanitaer.ch"}));
        const campaign = await createCampaign(companyId);
        await new CampaignOrchestrator(fakePorts()).run(campaign._id.toString());
        const plumber = (await ProspectCompany.findOne({campaignId: campaign._id, uid: PLUMBER.uid}))!;
        expect((await OutreachEmail.findOne({prospectCompanyId: plumber._id}))!.toEmail).toBe("info@test-sanitaer.ch");
    }));

    it("sends nothing to an address listed after its email was approved", () => asCompany(async () => {
        const send = accepted();
        const {campaign, emails, prospects} = await seedReview(companyId, [{status: "approved", toEmail: "Ada@One.ch"}, {status: "approved", toEmail: "b@one.ch"}], {status: "sending"});
        await suppress(companyId, {email: "ada@one.ch"});

        expect(await new CampaignOrchestrator(fakePorts({mail: {send}})).sendApproved(campaign._id.toString())).toEqual({sent: 1, failed: 0});

        expect(send).toHaveBeenCalledTimes(1);
        expect(send.mock.calls[0][0].to).toBe("b@one.ch");
        expect((await OutreachEmail.findById(emails[0]._id))!.status).toBe("skipped");
        expect((await ProspectCompany.findById(prospects[0]._id))!.status).toBe("skipped");
        expect((await Campaign.findById(campaign._id))!.stats).toMatchObject({sent: 1, approved: 1, failed: 0});
    }));

    it("doNotContact lists the recipient, skips an unsent email, and leaves a sent one as history", () => asCompany(async () => {
        const {emails, prospects} = await seedReview(companyId, [{status: "approved", toEmail: "Ada@One.ch"}, {status: "sent", toEmail: "b@one.ch"}]);

        const first = await call("post", "outreachEmail/doNotContact", {emailId: emails[0]._id.toString()});
        expect(first.status).toBe(200);
        expect(first.body.data.status).toBe("skipped");
        expect((await ProspectCompany.findById(prospects[0]._id))!.status).toBe("skipped");
        // Twice is the same as once
        expect((await call("post", "outreachEmail/doNotContact", {emailId: emails[0]._id.toString()})).status).toBe(200);

        const sent = await call("post", "outreachEmail/doNotContact", {emailId: emails[1]._id.toString()});
        expect(sent.body.data.status).toBe("sent");
        const listed = await SuppressedContact.find({}).sort({email: 1});
        expect(listed.map((entry) => [entry.email, entry.source])).toEqual([["ada@one.ch", "outreach_email"], ["b@one.ch", "outreach_email"]]);
    }));

    it("doNotContact puts a removed address back on the list, and is its own permission", () => asCompany(async () => {
        const {emails} = await seedReview(companyId, [{status: "draft", toEmail: "a@one.ch"}]);
        const removed = await suppress(companyId, {email: "a@one.ch"});
        await SuppressedContact.updateOne({_id: removed._id}, {$set: {deletedAt: new Date()}});

        const editor: TestCaller = {...staff, permissions: staff.permissions!.filter((tag) => !tag.includes("action:doNotContact"))};
        const refused = await request(app).post("/api/swissOutreach/outreachEmail/doNotContact").set(callerHeader(editor)).send({emailId: emails[0]._id.toString()});
        expect(refused.status).toBe(403);

        expect((await call("post", "outreachEmail/doNotContact", {emailId: emails[0]._id.toString()})).status).toBe(200);
        const entries = await SuppressedContact.collection.find({email: "a@one.ch"}).toArray();
        expect(entries).toHaveLength(1);
        expect(entries[0].deletedAt).toBeNull();
    }));

    it("is kept by hand: lower-cased, one entry per address, an address or a domain needed, never edited", () => asCompany(async () => {
        const created = await call("put", "suppressedContact", {email: "Stop@Example.CH", reason: "Asked by phone"});
        expect(created.status).toBe(200);
        expect(created.body).toMatchObject({email: "stop@example.ch", source: "manual", reason: "Asked by phone"});

        const duplicate = await call("put", "suppressedContact", {email: "stop@example.ch"});
        expect(duplicate.body.error_code).toBe("swissOutreachSuppressedContact_already_exists");
        expect((await call("put", "suppressedContact", {reason: "No address"})).body.error_code).toBe("form_not_correct");
        expect((await call("put", "suppressedContact", {domain: "not a domain"})).body.error_code).toBe("form_not_correct");
        expect((await call("put", "suppressedContact", {domain: "Example.org"})).body.domain).toBe("example.org");

        await call("patch", "suppressedContact", {_id: created.body._id, email: "other@example.ch", reason: "Changed"});
        expect(await SuppressedContact.findById(created.body._id)).toMatchObject({email: "stop@example.ch", reason: "Asked by phone"});
    }));
});

// Regression (A3): with email turned off, core's sendMail returned without sending and the adapter reported success.
describe("sending with email turned off", {timeout: 30000}, () => {
    it("marks the email failed with the reason, never sent", () => asCompany(async () => {
        const enabled = EMAIL.ENABLED;
        EMAIL.ENABLED = false;
        try {
            // Claimed for sending, as the action does
            const {campaign, emails} = await seedReview(companyId, [{status: "approved", toEmail: "a@one.ch"}], {status: "sending"});
            const orchestrator = new CampaignOrchestrator({...fakePorts(), mail: mailDeliveryAdapter});

            expect(await orchestrator.sendApproved(campaign._id.toString())).toEqual({sent: 0, failed: 1});

            const stored = (await OutreachEmail.findById(emails[0]._id))!;
            expect(stored.status).toBe("failed");
            expect(stored.messageId).toBeUndefined();
            expect(stored.lastError).toContain("turned off");
            expect((await Campaign.findById(campaign._id))!.status).toBe("failed");
        } finally {
            EMAIL.ENABLED = enabled;
        }
    }));
});

describe("person erasure in Swiss outreach (D57)", {timeout: 60000}, () => {
    it("removes the person's address from prospects, emails and campaigns, and keeps the do-not-contact entry", async () => {
        const person = "ada@example.com";
        const ids = {campaign: new ObjectId(), prospect: new ObjectId(), other: new ObjectId(), email: new ObjectId(), entry: new ObjectId()};
        await raw(async () => {
            await Campaign.collection.insertOne({
                _id: ids.campaign, company: companyId, jobDescription: "Plumbing", senderCompanyName: "Buyer AG", senderName: "Ada Lovelace",
                senderEmail: "Ada@Example.com", senderPhone: "+41 79 000 00 00", status: "completed", deletedAt: null,
            });
            await ProspectCompany.collection.insertMany([
                {_id: ids.prospect, company: companyId, campaignId: ids.campaign, companyName: "Lovelace GmbH", dedupeKey: "a", emails: [person, "info@lovelace.ch"], phones: ["+41 44 000 00 00"], deletedAt: null},
                {_id: ids.other, company: companyId, campaignId: ids.campaign, companyName: "Other AG", dedupeKey: "b", emails: ["info@other.ch"], phones: ["+41 44 111 11 11"], deletedAt: null},
            ]);
            await OutreachEmail.collection.insertOne({
                _id: ids.email, company: companyId, campaignId: ids.campaign, prospectCompanyId: ids.prospect, toEmail: person,
                subject: "Anfrage", body: "Guten Tag", status: "failed", lastError: `550 ${person} unknown`, deletedAt: null,
            });
            await SuppressedContact.collection.insertOne({_id: ids.entry, company: companyId, email: person, source: "outreach_email", deletedAt: null});
        });

        const erased = await request(app).post("/api/privacy/erasePerson").set(callerHeader(staff)).send({email: person, preview: false});
        expect(erased.body.error_code ?? "ok").toBe("ok");

        const campaign = (await raw(() => Campaign.collection.findOne({_id: ids.campaign})))!;
        expect(campaign).toMatchObject({senderEmail: ERASED_EMAIL, senderName: ERASED_NAME, senderCompanyName: "Buyer AG"});
        expect(campaign.senderPhone).toBeUndefined();
        expect(await raw(() => ProspectCompany.collection.findOne({_id: ids.prospect}))).toMatchObject({emails: ["info@lovelace.ch"], phones: []});
        expect(await raw(() => ProspectCompany.collection.findOne({_id: ids.other}))).toMatchObject({emails: ["info@other.ch"], phones: ["+41 44 111 11 11"]});
        const email = (await raw(() => OutreachEmail.collection.findOne({_id: ids.email})))!;
        expect(email).toMatchObject({subject: "Anfrage", body: "Guten Tag", status: "failed"});
        expect(email.toEmail).toBeUndefined();
        expect(email.lastError).toBeUndefined();
        expect(await raw(() => SuppressedContact.collection.findOne({_id: ids.entry}))).toMatchObject({email: person});
    });
});
