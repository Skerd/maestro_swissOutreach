import {afterAll, beforeAll, beforeEach, describe, expect, it, vi} from "vitest";
import {ObjectId} from "mongodb";
import {connectTestDatabase, disconnectTestDatabase} from "@coreModule/_tests/testDatabase";

// The module's own orchestrator (used by the cron) never reaches a live provider.
vi.mock("@swissOutreachModule/utilities/adapters/createPorts", async () => (await import("./outreach.fixtures")).createPortsMock);

import {withTenant} from "@coreModule/utilities/endpoints/tenantScope";
import Campaign from "@swissOutreachModule/database/schemas/campaign/campaign";
import ProspectCompany from "@swissOutreachModule/database/schemas/prospectCompany/prospectCompany";
import OutreachEmail from "@swissOutreachModule/database/schemas/outreachEmail/outreachEmail";
import PipelineRunLog from "@swissOutreachModule/database/schemas/pipelineRunLog/pipelineRunLog";
import AuditLog from "@coreModule/database/schemas/auditLog/auditLog";
import {CampaignOrchestrator, campaignOrchestrator} from "@swissOutreachModule/utilities/pipeline/campaignOrchestrator";
import {retryStuckSwissOutreachCampaigns} from "@swissOutreachModule/utilities/cron/retryStuckCampaigns";
import {campaignService} from "@swissOutreachModule/database/schemas/campaign/campaign.service";
import type {CrawlResult, MailSendRequest, MailSendResult} from "@swissOutreachModule/utilities/ports";
import {createCampaign, fakePorts, NO_WEBSITE, PLUMBER, PLUMBER_CRAWL, seedReview} from "./outreach.fixtures";
import {OUTREACH_OPT_OUT_LINES} from "armonia/src/modules/swissOutreach/prompts/outreachPrompts";

/** The fake writer's body, as every draft ends: with the opt-out sentence. */
const DRAFT_BODY = `Guten Tag\n\n${OUTREACH_OPT_OUT_LINES.de}`;

const companyId = new ObjectId();
const otherCompanyId = new ObjectId();
/** The tests act on this company's data, as its requests and jobs do (D16). */
const asCompany = <T>(fn: () => PromiseLike<T>): Promise<T> => withTenant(companyId, fn);
const asOther = <T>(fn: () => PromiseLike<T>): Promise<T> => withTenant(otherCompanyId, fn);

const accepted = (messageId = "msg-1") => vi.fn(async (_request: MailSendRequest): Promise<MailSendResult> => ({accepted: true, messageId}));

beforeAll(async () => {
    process.env.SWISS_OUTREACH_REQUEST_DELAY_MS = "0";
    process.env.SWISS_OUTREACH_RETRY_COUNT = "2";
    process.env.SWISS_OUTREACH_CONCURRENCY = "1";
    // The fastest send rate (100 ms apart), so tests with several sends stay quick.
    process.env.SWISS_OUTREACH_MAX_SENDS_PER_MINUTE = "600";
    await connectTestDatabase();
}, 120000);

afterAll(async () => {
    await disconnectTestDatabase();
});

beforeEach(async () => {
    vi.restoreAllMocks();
    // Raw collection deletes: the soft-delete plugin would only mark the rows deleted
    await Promise.all([Campaign, ProspectCompany, OutreachEmail, PipelineRunLog].map((model) => model.collection.deleteMany({})));
});

describe("campaign pipeline", {timeout: 30000}, () => {
    it("runs a campaign from draft to awaiting approval with scored prospects and drafts", () => asCompany(async () => {
        const send = accepted();
        const campaign = await createCampaign(companyId);
        await new CampaignOrchestrator(fakePorts({mail: {send}})).run(campaign._id.toString());

        const stored = await Campaign.findById(campaign._id);
        expect(stored!.status).toBe("awaiting_approval");
        expect(stored!.parsedJob!.keywords).toEqual(["plumbing", "Sanitär"]);
        expect(stored!.stats).toMatchObject({found: 2, enriched: 2, scored: 2, failed: 0, sent: 0});

        const plumber = await ProspectCompany.findOne({uid: PLUMBER.uid});
        expect(plumber).toMatchObject({status: "scored", website: "https://test-sanitaer.ch", websiteConfidence: 88, city: "Basel", score: 80});
        expect(plumber!.scoreReason).toBe("official website found; high website confidence; contact email found; relevant services (Sanitär); language match");
        const empty = await ProspectCompany.findOne({uid: NO_WEBSITE.uid});
        expect(empty).toMatchObject({status: "scored", score: 35, scoreReason: "canton match (ZH)"});
        expect(empty!.website).toBeUndefined();

        // One draft per prospect, addressed to the preferred contact address; nothing is sent before approval
        const plumberEmail = await OutreachEmail.findOne({prospectCompanyId: plumber!._id});
        expect(plumberEmail).toMatchObject({status: "draft", toEmail: "info@test-sanitaer.ch", subject: "Anfrage Offerte", body: DRAFT_BODY, language: "de", attempts: 0});
        const emptyEmail = await OutreachEmail.findOne({prospectCompanyId: empty!._id});
        expect(emptyEmail!.status).toBe("draft");
        expect(emptyEmail!.toEmail).toBeUndefined();
        expect(send).not.toHaveBeenCalled();

        const steps = (await PipelineRunLog.find({campaignId: campaign._id})).map((log) => log.step);
        expect(steps).toEqual(expect.arrayContaining(["pipeline", "job_parse", "company_search", "enrich", "email_generate", "approval"]));
    }));

    it("stores a company the register returns twice only once", () => asCompany(async () => {
        const campaign = await createCampaign(companyId);
        const ports = fakePorts({registry: {search: async () => [PLUMBER, {...PLUMBER, uid: "che-111.111.111 "}]}});
        await new CampaignOrchestrator(ports).run(campaign._id.toString());
        expect(await ProspectCompany.countDocuments({campaignId: campaign._id})).toBe(1);
        expect((await Campaign.findById(campaign._id))!.stats.found).toBe(1);
    }));

    it("keeps reviewed emails when the pipeline runs again and redrafts the rest", () => asCompany(async () => {
        const campaign = await createCampaign(companyId);
        await new CampaignOrchestrator(fakePorts()).run(campaign._id.toString());
        const plumber = await ProspectCompany.findOne({uid: PLUMBER.uid});
        await OutreachEmail.updateOne({prospectCompanyId: plumber!._id}, {$set: {status: "edited", subject: "Mine"}});
        const empty = await ProspectCompany.findOne({uid: NO_WEBSITE.uid});
        await OutreachEmail.updateOne({prospectCompanyId: empty!._id}, {$set: {subject: "Old draft"}});

        // A deliberate restart (start, the stuck-run cron) claims the campaign into `parsing` before it runs
        await campaignService.claimRun(campaign._id.toString(), ["awaiting_approval"]);
        await new CampaignOrchestrator(fakePorts()).run(campaign._id.toString());

        expect(await OutreachEmail.countDocuments({campaignId: campaign._id})).toBe(2);
        expect(await OutreachEmail.findOne({prospectCompanyId: plumber!._id})).toMatchObject({status: "edited", subject: "Mine"});
        expect(await OutreachEmail.findOne({prospectCompanyId: empty!._id})).toMatchObject({status: "draft", subject: "Anfrage Offerte"});
    }));

    it("sends straight away when the campaign sends automatically, only to prospects with an address", () => asCompany(async () => {
        const send = accepted("auto-1");
        const campaign = await createCampaign(companyId, {sendAutomatically: true});
        await new CampaignOrchestrator(fakePorts({mail: {send}})).run(campaign._id.toString());

        expect(send).toHaveBeenCalledTimes(1);
        expect(send.mock.calls[0][0]).toMatchObject({
            companyId: companyId.toString(), to: "info@test-sanitaer.ch", subject: "Anfrage Offerte", text: DRAFT_BODY, fromEmail: "ada@buyer.ch", fromName: "Ada",
        });
        const stored = await Campaign.findById(campaign._id);
        expect(stored!.status).toBe("completed");
        expect(stored!.stats).toMatchObject({sent: 1, approved: 1, failed: 0});
        const plumber = await ProspectCompany.findOne({uid: PLUMBER.uid});
        expect(plumber!.status).toBe("sent");
        expect(await OutreachEmail.findOne({prospectCompanyId: plumber!._id})).toMatchObject({status: "sent", messageId: "auto-1", attempts: 1});
        const empty = await ProspectCompany.findOne({uid: NO_WEBSITE.uid});
        expect((await OutreachEmail.findOne({prospectCompanyId: empty!._id}))!.status).toBe("draft");
    }));

    it("marks a prospect failed and carries on when its enrichment fails", () => asCompany(async () => {
        const campaign = await createCampaign(companyId);
        const ports = fakePorts();
        await new CampaignOrchestrator({
            ...ports,
            website: {
                discoverWebsite: async (companyName, canton) => {
                    if (companyName === NO_WEBSITE.companyName) throw new Error("search quota exceeded");
                    return ports.website.discoverWebsite(companyName, canton);
                },
                crawl: ports.website.crawl,
            },
        }).run(campaign._id.toString());

        const stored = await Campaign.findById(campaign._id);
        expect(stored!.status).toBe("awaiting_approval");
        expect(stored!.stats).toMatchObject({found: 2, enriched: 1, scored: 1, failed: 1});
        const failed = await ProspectCompany.findOne({uid: NO_WEBSITE.uid});
        expect(failed!.status).toBe("failed");
        // A failed prospect gets no draft
        expect(await OutreachEmail.countDocuments({prospectCompanyId: failed!._id})).toBe(0);
        expect(await OutreachEmail.countDocuments({campaignId: campaign._id})).toBe(1);
        expect(await PipelineRunLog.countDocuments({campaignId: campaign._id, step: "enrich", level: "warn"})).toBe(1);
    }));

    it("fails the campaign with the register's error", () => asCompany(async () => {
        const campaign = await createCampaign(companyId);
        await new CampaignOrchestrator(fakePorts({registry: {search: async () => { throw new Error("ZEFIX unavailable"); }}})).run(campaign._id.toString());
        expect(await Campaign.findById(campaign._id)).toMatchObject({status: "failed", lastError: "ZEFIX unavailable"});
        expect(await PipelineRunLog.countDocuments({campaignId: campaign._id, level: "error"})).toBe(1);
    }));

    it("does not re-run a campaign awaiting approval when a late run event is redelivered (TD-B169)", () => asCompany(async () => {
        const search = vi.fn(async () => [PLUMBER]);
        const {campaign, emails} = await seedReview(companyId, [{status: "edited", toEmail: "info@one.ch"}], {status: "awaiting_approval"});

        await new CampaignOrchestrator(fakePorts({registry: {search}})).run(campaign._id.toString());

        expect(search).not.toHaveBeenCalled();
        expect((await Campaign.findById(campaign._id))!.status).toBe("awaiting_approval");
        expect((await OutreachEmail.findById(emails[0]._id))!.status).toBe("edited");
    }));

    it("does not run a cancelled campaign or another company's campaign", async () => {
        const search = vi.fn(async () => [PLUMBER]);
        const orchestrator = new CampaignOrchestrator(fakePorts({registry: {search}}));
        const cancelled = await asCompany(() => createCampaign(companyId, {status: "cancelled"}));
        const foreign = await asOther(() => createCampaign(otherCompanyId));

        await asCompany(() => orchestrator.run(cancelled._id.toString()));
        await asCompany(() => orchestrator.run(foreign._id.toString()));

        expect(search).not.toHaveBeenCalled();
        expect((await asCompany(() => Campaign.findById(cancelled._id)))!.status).toBe("cancelled");
        expect((await asOther(() => Campaign.findById(foreign._id)))!.status).toBe("draft");
    });

    it("stops at the next step when the campaign is cancelled mid-run", () => asCompany(async () => {
        let crawlStarted!: () => void;
        const started = new Promise<void>((resolve) => { crawlStarted = resolve; });
        let releaseCrawl!: () => void;
        const gate = new Promise<void>((resolve) => { releaseCrawl = resolve; });
        const orchestrator = new CampaignOrchestrator(fakePorts({
            website: {
                discoverWebsite: async () => ({url: "https://test-sanitaer.ch", confidence: 88}),
                crawl: async (): Promise<CrawlResult> => {
                    crawlStarted();
                    await gate;
                    return PLUMBER_CRAWL;
                },
            },
        }));
        const campaign = await createCampaign(companyId);

        const running = orchestrator.run(campaign._id.toString());
        await started;
        await orchestrator.cancel(campaign._id.toString());
        releaseCrawl();
        await running;

        expect((await Campaign.findById(campaign._id))!.status).toBe("cancelled");
        expect(await OutreachEmail.countDocuments({campaignId: campaign._id})).toBe(0);
        expect(await PipelineRunLog.countDocuments({campaignId: campaign._id, step: "cancel"})).toBe(2);
    }));
});

// The send loop runs for a campaign claimed `sending` (the action's claim, or the pipeline's automatic send).
describe("sending approved emails", {timeout: 30000}, () => {
    it("sends each approved email with an address once, even when two sends race", () => asCompany(async () => {
        const send = vi.fn(async (_request: MailSendRequest): Promise<MailSendResult> => {
            await new Promise((resolve) => setTimeout(resolve, 20));
            return {accepted: true, messageId: "m-1"};
        });
        const {campaign, emails, prospects} = await seedReview(companyId, [
            {status: "approved", toEmail: "info@one.ch"},
            {status: "draft", toEmail: "info@two.ch"},
            {status: "skipped", toEmail: "info@three.ch"},
        ], {status: "sending"});
        const orchestrator = new CampaignOrchestrator(fakePorts({mail: {send}}));

        const results = await Promise.all([orchestrator.sendApproved(campaign._id.toString()), orchestrator.sendApproved(campaign._id.toString())]);

        expect(send).toHaveBeenCalledTimes(1);
        expect(results.map((result) => result.sent).sort()).toEqual([0, 1]);
        expect(await OutreachEmail.findById(emails[0]._id)).toMatchObject({status: "sent", messageId: "m-1", attempts: 1});
        expect(await ProspectCompany.findById(prospects[0]._id)).toMatchObject({status: "sent"});
        expect((await OutreachEmail.findById(emails[1]._id))!.status).toBe("draft");
        expect((await OutreachEmail.findById(emails[2]._id))!.status).toBe("skipped");
        const stored = await Campaign.findById(campaign._id);
        expect(stored!.status).toBe("completed");
        expect(stored!.stats).toMatchObject({sent: 1, approved: 1});
    }));

    it("retries a failed send within the retry count", () => asCompany(async () => {
        const send = vi.fn(async (_request: MailSendRequest): Promise<MailSendResult> => ({accepted: true, messageId: "m-2"}));
        send.mockRejectedValueOnce(new Error("SMTP busy"));
        const {campaign, emails} = await seedReview(companyId, [{status: "approved", toEmail: "info@one.ch"}], {status: "sending"});

        expect(await new CampaignOrchestrator(fakePorts({mail: {send}})).sendApproved(campaign._id.toString())).toEqual({sent: 1, failed: 0});

        expect(send).toHaveBeenCalledTimes(2);
        expect(await OutreachEmail.findById(emails[0]._id)).toMatchObject({status: "sent", attempts: 2, messageId: "m-2"});
    }));

    it("marks the email failed after the last retry and fails a campaign that sent nothing", () => asCompany(async () => {
        const send = vi.fn(async (_request: MailSendRequest): Promise<MailSendResult> => { throw new Error("SMTP refused"); });
        const {campaign, emails} = await seedReview(companyId, [{status: "approved", toEmail: "info@one.ch"}], {status: "sending"});

        expect(await new CampaignOrchestrator(fakePorts({mail: {send}})).sendApproved(campaign._id.toString())).toEqual({sent: 0, failed: 1});

        // RETRY_COUNT=2: two tries in all
        expect(send).toHaveBeenCalledTimes(2);
        expect(await OutreachEmail.findById(emails[0]._id)).toMatchObject({status: "failed", lastError: "SMTP refused", attempts: 2});
        const stored = await Campaign.findById(campaign._id);
        expect(stored!.status).toBe("failed");
        expect(stored!.stats).toMatchObject({failed: 1, sent: 0, approved: 0});
    }));

    it("gives an email approved again after failing a fresh retry budget, counting every try", () => asCompany(async () => {
        const send = vi.fn(async (_request: MailSendRequest): Promise<MailSendResult> => { throw new Error("Mailbox full"); });
        const {campaign, emails} = await seedReview(companyId, [{status: "approved", toEmail: "info@one.ch"}, {status: "approved", toEmail: "info@two.ch"}], {status: "sending"});
        // Both failed once already with the whole budget (2 tries) used up
        await OutreachEmail.updateMany({campaignId: campaign._id}, {$set: {attempts: 2, lastError: "SMTP refused"}});
        send.mockImplementationOnce(async () => ({accepted: true, messageId: "m-3"}));

        expect(await new CampaignOrchestrator(fakePorts({mail: {send}})).sendApproved(campaign._id.toString())).toEqual({sent: 1, failed: 1});

        // Regression: the old loop started at the lifetime count, so the second send never tried and wrote an empty error.
        expect(send).toHaveBeenCalledTimes(3);
        const stored = await Promise.all(emails.map((email) => OutreachEmail.findById(email._id)));
        const sent = stored.find((email) => email!.status === "sent")!;
        const failed = stored.find((email) => email!.status === "failed")!;
        expect(sent.attempts).toBe(3);
        expect(sent.lastError).toBeUndefined();
        expect(failed).toMatchObject({attempts: 4, lastError: "Mailbox full"});
    }));

    it("counts what was sent and stops cleanly when the campaign is cancelled mid-send", () => asCompany(async () => {
        const {campaign, emails} = await seedReview(companyId, [{status: "approved", toEmail: "info@one.ch"}, {status: "approved", toEmail: "info@two.ch"}], {status: "sending"});
        const send = vi.fn(async (_request: MailSendRequest): Promise<MailSendResult> => {
            await Campaign.updateOne({_id: campaign._id}, {$set: {status: "cancelled"}});
            return {accepted: true, messageId: "m-4"};
        });

        expect(await new CampaignOrchestrator(fakePorts({mail: {send}})).sendApproved(campaign._id.toString())).toEqual({sent: 1, failed: 0});

        expect(send).toHaveBeenCalledTimes(1);
        const stored = await Campaign.findById(campaign._id);
        expect(stored!.status).toBe("cancelled");
        expect(stored!.stats).toMatchObject({sent: 1, approved: 2});
        const statuses = (await Promise.all(emails.map((email) => OutreachEmail.findById(email._id)))).map((email) => email!.status).sort();
        expect(statuses).toEqual(["approved", "sent"]);
    }));

    it("hands the email in hand back to approved when cancelled between tries", () => asCompany(async () => {
        const {campaign, emails} = await seedReview(companyId, [{status: "approved", toEmail: "info@one.ch"}], {status: "sending"});
        const send = vi.fn(async (_request: MailSendRequest): Promise<MailSendResult> => {
            await Campaign.updateOne({_id: campaign._id}, {$set: {status: "cancelled"}});
            throw new Error("SMTP busy");
        });

        expect(await new CampaignOrchestrator(fakePorts({mail: {send}})).sendApproved(campaign._id.toString())).toEqual({sent: 0, failed: 0});

        expect(send).toHaveBeenCalledTimes(1);
        expect(await OutreachEmail.findById(emails[0]._id)).toMatchObject({status: "approved", attempts: 1});
        expect((await Campaign.findById(campaign._id))!.stats.failed).toBe(0);
    }));

    it("sends nothing for a cancelled campaign", () => asCompany(async () => {
        const send = accepted();
        const {campaign, emails} = await seedReview(companyId, [{status: "approved", toEmail: "info@one.ch"}], {status: "cancelled"});
        expect(await new CampaignOrchestrator(fakePorts({mail: {send}})).sendApproved(campaign._id.toString())).toEqual({sent: 0, failed: 0});
        expect(send).not.toHaveBeenCalled();
        expect((await OutreachEmail.findById(emails[0]._id))!.status).toBe("approved");
        expect((await Campaign.findById(campaign._id))!.status).toBe("cancelled");
    }));

    it("cancelling hands claimed emails back to approved", () => asCompany(async () => {
        const {campaign, emails} = await seedReview(companyId, [{status: "queued", toEmail: "info@one.ch"}, {status: "sent", toEmail: "info@two.ch"}], {status: "sending"});
        await new CampaignOrchestrator(fakePorts()).cancel(campaign._id.toString());
        expect((await Campaign.findById(campaign._id))!.status).toBe("cancelled");
        expect((await OutreachEmail.findById(emails[0]._id))!.status).toBe("approved");
        expect((await OutreachEmail.findById(emails[1]._id))!.status).toBe("sent");
        expect(await PipelineRunLog.countDocuments({campaignId: campaign._id, step: "cancel", level: "warn"})).toBe(1);
    }));
});

describe("stuck campaign cron", {timeout: 30000}, () => {
    const longAgo = () => new Date(Date.now() - 20 * 60 * 1000);

    it("puts emails left queued for 15 minutes back to approved, only the job company's", async () => {
        const mine = await asCompany(() => seedReview(companyId, [{status: "queued", toEmail: "a@one.ch"}, {status: "queued", toEmail: "b@one.ch"}], {status: "sending"}));
        const theirs = await asOther(() => seedReview(otherCompanyId, [{status: "queued", toEmail: "c@two.ch"}], {status: "sending"}));
        await OutreachEmail.collection.updateMany({_id: {$in: [mine.emails[0]._id, theirs.emails[0]._id]}}, {$set: {updatedAt: longAgo()}});

        await asCompany(() => retryStuckSwissOutreachCampaigns(companyId));

        expect((await asCompany(() => OutreachEmail.findById(mine.emails[0]._id)))!.status).toBe("approved");
        // Queued a moment ago: a send may still hold it
        expect((await asCompany(() => OutreachEmail.findById(mine.emails[1]._id)))!.status).toBe("queued");
        expect((await asOther(() => OutreachEmail.findById(theirs.emails[0]._id)))!.status).toBe("queued");
    });

    it("restarts discovery stages and drafts left for 15 minutes, resumes a dead send, never a finished campaign", () => asCompany(async () => {
        const enqueue = vi.spyOn(campaignOrchestrator, "enqueue").mockImplementation(() => undefined);
        const enqueueSend = vi.spyOn(campaignOrchestrator, "enqueueSend").mockImplementation(() => undefined);
        const stuck = await createCampaign(companyId, {status: "searching"});
        await createCampaign(companyId, {status: "enriching"}); // stuck too, but only a moment ago
        // Regression (A4): a campaign whose first run never started stayed in draft for good
        const neverStarted = await createCampaign(companyId);
        await createCampaign(companyId); // just created: its own run is about to start
        const sending = await createCampaign(companyId, {status: "sending"});
        await createCampaign(companyId, {status: "sending"}); // its send wrote the campaign a moment ago: alive
        const waiting = await createCampaign(companyId, {status: "awaiting_approval"});
        const failed = await createCampaign(companyId, {status: "failed"});
        await Campaign.collection.updateMany({_id: {$in: [stuck._id, neverStarted._id, sending._id, waiting._id, failed._id]}}, {$set: {updatedAt: longAgo()}});

        await retryStuckSwissOutreachCampaigns(companyId);

        expect(enqueue).toHaveBeenCalledTimes(2);
        expect(enqueue).toHaveBeenCalledWith(stuck._id.toString(), companyId.toString());
        expect(enqueue).toHaveBeenCalledWith(neverStarted._id.toString(), companyId.toString());
        // Each claimed for its run, so a start or a second sweep does not run it again
        expect((await Campaign.findById(neverStarted._id))!.status).toBe("parsing");
        // A send that has not written its campaign for 15 minutes has no sender: it is claimed again and resumed
        expect(enqueueSend).toHaveBeenCalledTimes(1);
        expect(enqueueSend).toHaveBeenCalledWith(sending._id.toString(), companyId.toString());
        await retryStuckSwissOutreachCampaigns(companyId);
        expect(enqueue).toHaveBeenCalledTimes(2);
        expect(enqueueSend).toHaveBeenCalledTimes(1);
    }));
});

describe("campaign lease (TD-B128)", {timeout: 30000}, () => {
    const longAgo = () => new Date(Date.now() - 20 * 60 * 1000);
    /** A lease that runs out after 300 ms unless renewed, renewed every 50 ms. */
    const QUICK_LEASE = {leaseMs: 300, renewEveryMs: 50};

    it("a live sender stalled on one email keeps renewing its lease, and a second sender is refused", () => asCompany(async () => {
        let release!: () => void;
        const hung = new Promise<void>((resolve) => { release = resolve; });
        const send = vi.fn(async (_request: MailSendRequest): Promise<MailSendResult> => {
            await hung;
            return {accepted: true, messageId: "<real@smtp.test>"};
        });
        const {campaign, emails} = await seedReview(companyId, [{status: "approved", toEmail: "a@one.ch"}], {status: "sending"});
        const campaignId = campaign._id.toString();

        const sending = new CampaignOrchestrator(fakePorts({mail: {send}}), QUICK_LEASE).sendApproved(campaignId);
        await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
        const first = (await Campaign.findById(campaignId))!.lease!;

        // Longer than the lease lasts: only renewals keep it
        await new Promise((resolve) => setTimeout(resolve, 2 * QUICK_LEASE.leaseMs));
        const renewed = (await Campaign.findById(campaignId))!.lease!;
        expect(renewed.holder).toBe(first.holder);
        expect(renewed.until.getTime()).toBeGreaterThan(Date.now());

        // Another process given the same send (a redelivered event) finds the campaign held
        const twin = accepted();
        expect(await new CampaignOrchestrator(fakePorts({mail: {send: twin}}), QUICK_LEASE).sendApproved(campaignId)).toEqual({sent: 0, failed: 0});
        expect(twin).not.toHaveBeenCalled();
        expect((await OutreachEmail.findById(emails[0]._id))!.status).toBe("queued");

        release();
        expect(await sending).toEqual({sent: 1, failed: 0});
        const done = await Campaign.findById(campaignId);
        expect(done!.status).toBe("completed");
        expect(done!.lease?.holder).toBeUndefined();
        // TD-B126: the transport's own id is stored
        expect((await OutreachEmail.findById(emails[0]._id))!.messageId).toBe("<real@smtp.test>");
        // TD-B144: the per-email stats increments and the lease renewals are machine writes, not audit entries
        expect(await AuditLog.countDocuments({documentId: campaign._id, action: "CREATE"})).toBe(1);
        expect(await AuditLog.countDocuments({documentId: campaign._id, action: "UPDATE"})).toBe(0);
    }));

    it("the cron leaves a campaign with a live lease alone, however long since its last write, and takes it once the lease ran out", () => asCompany(async () => {
        const enqueueSend = vi.spyOn(campaignOrchestrator, "enqueueSend").mockImplementation(() => undefined);
        const enqueue = vi.spyOn(campaignOrchestrator, "enqueue").mockImplementation(() => undefined);
        const {campaign, emails} = await seedReview(companyId, [{status: "queued", toEmail: "a@one.ch"}], {status: "sending"});
        const enriching = await createCampaign(companyId, {status: "enriching"});
        const liveLease = {holder: "other-process", until: new Date(Date.now() + 5 * 60 * 1000)};
        await Campaign.collection.updateMany({_id: {$in: [campaign._id, enriching._id]}}, {$set: {updatedAt: longAgo(), lease: liveLease}});
        await OutreachEmail.collection.updateMany({_id: emails[0]._id}, {$set: {updatedAt: longAgo()}});

        await retryStuckSwissOutreachCampaigns(companyId);

        expect(enqueueSend).not.toHaveBeenCalled();
        expect(enqueue).not.toHaveBeenCalled();
        // The live sender still has it in hand
        expect((await OutreachEmail.findById(emails[0]._id))!.status).toBe("queued");

        await Campaign.collection.updateMany({_id: {$in: [campaign._id, enriching._id]}}, {$set: {"lease.until": new Date(Date.now() - 1000)}});
        await retryStuckSwissOutreachCampaigns(companyId);

        expect(enqueueSend).toHaveBeenCalledWith(campaign._id.toString(), companyId.toString());
        expect(enqueue).toHaveBeenCalledWith(enriching._id.toString(), companyId.toString());
        expect((await OutreachEmail.findById(emails[0]._id))!.status).toBe("approved");
    }));

    it("a run given to a second worker while the first holds the campaign does nothing", () => asCompany(async () => {
        const search = vi.fn(async () => [PLUMBER]);
        const campaign = await createCampaign(companyId, {status: "parsing"});
        await Campaign.collection.updateOne({_id: campaign._id}, {$set: {lease: {holder: "other-process", until: new Date(Date.now() + 60_000)}}});

        await new CampaignOrchestrator(fakePorts({registry: {search}}), QUICK_LEASE).run(campaign._id.toString());

        expect(search).not.toHaveBeenCalled();
        expect((await Campaign.findById(campaign._id))!).toMatchObject({status: "parsing", lease: {holder: "other-process"}});
    }));
});

