import {afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi} from "vitest";
import {ObjectId} from "mongodb";
import request from "supertest";
import {connectTestDatabase, disconnectTestDatabase} from "@coreModule/_tests/testDatabase";

vi.mock("@coreModule/utilities/middlewares/authMW", async () =>
    (await import("@coreModule/_tests/httpHarness")).authMWStub);
// No Redis in tests.
vi.mock("@coreModule/utilities/middlewares/rateLimiter", () => ({
    rateLimiter: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("@swissOutreachModule/utilities/adapters/createPorts", async () => (await import("./outreach.fixtures")).createPortsMock);
const {publish} = vi.hoisted(() => ({publish: vi.fn(async (_event: {campaignId: string; companyId: string; action: string}) => true)}));
vi.mock("@swissOutreachModule/kafka/kafkaProducer", () => ({publishSwissOutreachPipelineEvent: publish}));

import type {ModuleEnvironmentContext} from "@coreModule/environment/validator";
import {allPermissionTags, appFor, callerHeader, type TestCaller} from "@coreModule/_tests/httpHarness";
import {withTenant} from "@coreModule/utilities/endpoints/tenantScope";
import * as campaignRoute from "@swissOutreachModule/api/swissOutreach/private/campaign";
import Campaign from "@swissOutreachModule/database/schemas/campaign/campaign";
import ProspectCompany from "@swissOutreachModule/database/schemas/prospectCompany/prospectCompany";
import OutreachEmail from "@swissOutreachModule/database/schemas/outreachEmail/outreachEmail";
import PipelineRunLog from "@swissOutreachModule/database/schemas/pipelineRunLog/pipelineRunLog";
import {CampaignOrchestrator} from "@swissOutreachModule/utilities/pipeline/campaignOrchestrator";
import {llmCircuitBreaker, openAiCompatibleLlm} from "@swissOutreachModule/utilities/adapters/llmClient";
import {validateEnvironment} from "@swissOutreachModule/environment.validator";
import type {MailSendRequest, MailSendResult} from "@swissOutreachModule/utilities/ports";
import {createCampaignFormSchema} from "armonia/src/modules/swissOutreach/api/swissOutreach/private/campaign/createCampaign.form.validator";
import {editCampaignFormSchema} from "armonia/src/modules/swissOutreach/api/swissOutreach/private/campaign/editCampaign.form.validator";
import {createCampaign, fakePorts, seedReview, testPorts} from "./outreach.fixtures";

const companyId = new ObjectId();
const asCompany = <T>(fn: () => PromiseLike<T>): Promise<T> => withTenant(companyId, fn);
const app = appFor([{basePath: "/api/swissOutreach/campaign", router: campaignRoute.router, module: "swissOutreach"}]);
const staff: TestCaller = {userId: new ObjectId().toString(), companyId: companyId.toString(), isAdmin: true, permissions: allPermissionTags([Campaign, OutreachEmail])};
const sendApproved = (campaignId: string) =>
    request(app).post("/api/swissOutreach/campaign/sendApproved").set(callerHeader(staff)).send({campaignId});
const settled = (campaignId: string) =>
    vi.waitFor(async () => expect((await Campaign.findById(campaignId))!.status).not.toBe("sending"), {timeout: 10000, interval: 25});

/** 600 a minute: successful sends at least 100 ms apart. */
const GAP_MS = 100;

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
    publish.mockClear();
    delete process.env.SWISS_OUTREACH_USE_KAFKA_PIPELINE;
    await Promise.all([Campaign, ProspectCompany, OutreachEmail, PipelineRunLog].map((model) => model.collection.deleteMany({})));
});

describe("sending approved emails off the request", {timeout: 30000}, () => {
    // Regression (A9): the action awaited every email, retry and pause inside the HTTP request.
    it("answers at once with the campaign sending, refuses a second send, then sends in the background spaced by the rate", () => asCompany(async () => {
        let release!: () => void;
        const firstHeld = new Promise<void>((resolve) => { release = resolve; });
        const startedAt: number[] = [];
        const finishedAt: number[] = [];
        const send = vi.fn(async (_request: MailSendRequest): Promise<MailSendResult> => {
            startedAt.push(Date.now());
            if (startedAt.length === 1) await firstHeld;
            finishedAt.push(Date.now());
            return {accepted: true, messageId: `m-${startedAt.length}`};
        });
        testPorts.current = fakePorts({mail: {send}});
        const {campaign} = await seedReview(companyId, [
            {status: "approved", toEmail: "a@one.ch"},
            {status: "approved", toEmail: "b@one.ch"},
            {status: "approved", toEmail: "c@one.ch"},
        ]);
        const campaignId = campaign._id.toString();

        const response = await sendApproved(campaignId);
        expect(response.status).toBe(200);
        expect(response.body.data).toMatchObject({_id: campaignId, status: "sending"});
        await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
        expect(finishedAt).toHaveLength(0);

        const second = await sendApproved(campaignId);
        expect(second.status).toBe(409);
        expect(second.body.error_code).toBe("campaign_cannot_send");

        release();
        await settled(campaignId);
        expect(send).toHaveBeenCalledTimes(3);
        for (let index = 1; index < startedAt.length; index++) {
            // Timers may fire a millisecond early.
            expect(startedAt[index] - finishedAt[index - 1]).toBeGreaterThanOrEqual(GAP_MS - 5);
        }
        expect((await Campaign.findById(campaignId))!).toMatchObject({status: "completed", stats: {sent: 3, approved: 3}});
        expect(publish).not.toHaveBeenCalled();
    }));

    it("hands the send to the Kafka pipeline when it is on, and sends in-process when the publish fails", () => asCompany(async () => {
        process.env.SWISS_OUTREACH_USE_KAFKA_PIPELINE = "true";
        const send = vi.fn(async (_request: MailSendRequest): Promise<MailSendResult> => ({accepted: true, messageId: "m-1"}));
        testPorts.current = fakePorts({mail: {send}});

        const published = await seedReview(companyId, [{status: "approved", toEmail: "a@one.ch"}]);
        expect((await sendApproved(published.campaign._id.toString())).status).toBe(200);
        await vi.waitFor(() => expect(publish).toHaveBeenCalledWith({campaignId: published.campaign._id.toString(), companyId: companyId.toString(), action: "send_approved"}));
        // The consumer sends it; this process does not.
        expect(send).not.toHaveBeenCalled();
        expect((await Campaign.findById(published.campaign._id))!.status).toBe("sending");

        publish.mockResolvedValueOnce(false);
        const fallback = await seedReview(companyId, [{status: "approved", toEmail: "b@one.ch"}]);
        expect((await sendApproved(fallback.campaign._id.toString())).status).toBe(200);
        await settled(fallback.campaign._id.toString());
        expect(send).toHaveBeenCalledTimes(1);
        expect((await Campaign.findById(fallback.campaign._id))!.stats.sent).toBe(1);
    }));

    it("a late or redelivered send finds the campaign no longer sending and does nothing", () => asCompany(async () => {
        const send = vi.fn(async (_request: MailSendRequest): Promise<MailSendResult> => ({accepted: true, messageId: "m-1"}));
        const orchestrator = new CampaignOrchestrator(fakePorts({mail: {send}}));
        for (const status of ["completed", "failed", "awaiting_approval"] as const) {
            const {campaign, emails} = await seedReview(companyId, [{status: "approved", toEmail: "a@one.ch"}], {status});
            expect(await orchestrator.sendApproved(campaign._id.toString())).toEqual({sent: 0, failed: 0});
            expect((await Campaign.findById(campaign._id))!.status).toBe(status);
            expect((await OutreachEmail.findById(emails[0]._id))!.status).toBe("approved");
        }
        expect(send).not.toHaveBeenCalled();
    }));

    it("refuses an unknown campaign with a localized error", () => asCompany(async () => {
        await expect(new CampaignOrchestrator(fakePorts()).sendApproved(new ObjectId().toString()))
            .rejects.toMatchObject({error_code: "campaign_not_found"});
    }));
});

describe("circuit breakers", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        llmCircuitBreaker.reset();
    });

    // A10: the LLM, ZEFIX and web search each sit behind a core circuit breaker.
    it("stops calling the LLM after five failures in a minute and fails fast", async () => {
        const fetchMock = vi.fn(async () => { throw new Error("connect ECONNREFUSED"); });
        vi.stubGlobal("fetch", fetchMock);
        for (let attempt = 0; attempt < 5; attempt++) {
            await expect(openAiCompatibleLlm.completeText("system", "user")).rejects.toThrow("ECONNREFUSED");
        }
        await expect(openAiCompatibleLlm.completeText("system", "user")).rejects.toThrow("Circuit breaker swissOutreach.llm is OPEN");
        expect(fetchMock).toHaveBeenCalledTimes(5);
    });
});

/** Core's checks, as the boot passes them (they are not exported). */
function bootContext(env: NodeJS.ProcessEnv): ModuleEnvironmentContext {
    const missing = (key: string) => ({key, message: "missing"});
    return {
        env,
        kafkaEnabled: false,
        validateString: (key, value, required = true) => (required && !value?.trim() ? missing(key) : null),
        validateNumber: (key, value, required = true, min, max) => {
            if (!value) return required ? missing(key) : null;
            const number = parseInt(value, 10);
            return Number.isNaN(number) || (min !== undefined && number < min) || (max !== undefined && number > max) ? {key, message: "range"} : null;
        },
        validateBoolean: (key, value, required = true) => {
            if (!value) return required ? missing(key) : null;
            return ["true", "false"].includes(value.toLowerCase()) ? null : {key, message: "boolean"};
        },
        validateArray: () => null,
    };
}

describe("environment validator", () => {
    const keys = (env: NodeJS.ProcessEnv) => validateEnvironment(bootContext(env)).map((error) => error.key);

    it("accepts an unset environment: every setting has a default", () => {
        expect(keys({})).toEqual([]);
    });

    it("checks numbers, switches and provider choices", () => {
        expect(keys({
            SWISS_OUTREACH_MAX_SENDS_PER_MINUTE: "0",
            SWISS_OUTREACH_CONCURRENCY: "many",
            SWISS_OUTREACH_SEARCH_DEPTH: "11",
            SWISS_OUTREACH_REQUEST_DELAY_MS: "0",
            SWISS_OUTREACH_USE_KAFKA_PIPELINE: "yes",
            SWISS_OUTREACH_WEB_SEARCH_PROVIDER: "duckduckgo",
            SWISS_OUTREACH_EMAIL_PROVIDER: "M365",
            SWISS_OUTREACH_LLM_PROVIDER: "anthropic",
        })).toEqual([
            "SWISS_OUTREACH_SEARCH_DEPTH",
            "SWISS_OUTREACH_CONCURRENCY",
            "SWISS_OUTREACH_MAX_SENDS_PER_MINUTE",
            "SWISS_OUTREACH_USE_KAFKA_PIPELINE",
            "SWISS_OUTREACH_WEB_SEARCH_PROVIDER",
            "SWISS_OUTREACH_LLM_PROVIDER",
        ]);
    });

    it("requires the chosen web search provider's key, and both ZEFIX credentials or neither", () => {
        expect(keys({SWISS_OUTREACH_WEB_SEARCH_PROVIDER: "serper"})).toEqual(["SWISS_OUTREACH_SERPER_API_KEY"]);
        expect(keys({SWISS_OUTREACH_WEB_SEARCH_PROVIDER: "Google", SWISS_OUTREACH_GOOGLE_CSE_API_KEY: "k"})).toEqual(["SWISS_OUTREACH_GOOGLE_CSE_CX"]);
        expect(keys({SWISS_OUTREACH_WEB_SEARCH_PROVIDER: "bing", SWISS_OUTREACH_BING_API_KEY: "k"})).toEqual([]);
        expect(keys({SWISS_OUTREACH_ZEFIX_USERNAME: "user"})).toEqual(["SWISS_OUTREACH_ZEFIX_PASSWORD"]);
    });
});

describe("campaign cantons", {timeout: 30000}, () => {
    const form = {
        jobDescription: "Looking for a plumbing company to renovate two bathrooms.",
        country: "Switzerland",
        maxCompanies: 10,
        language: "de",
        emailTone: "professional",
        senderCompanyName: "Buyer AG",
        senderName: "Ada",
        senderEmail: "ada@buyer.ch",
    };

    // A12: cantons were free text, so a typo searched ZEFIX for a canton that does not exist.
    it("accepts canton codes and none, and refuses anything else on create and edit", () => {
        expect(createCampaignFormSchema("en-US").safeParse({...form, cantons: ["ZH", "BS"]}).success).toBe(true);
        expect(createCampaignFormSchema("en-US").safeParse({...form, cantons: []}).success).toBe(true);
        const refused = createCampaignFormSchema("en-US").safeParse({...form, cantons: ["ZH", "XX", "zh"]});
        expect(refused.success).toBe(false);
        expect(refused.error!.issues.map((issue) => issue.path.join("."))).toEqual(["cantons.1", "cantons.2"]);
        const edit = editCampaignFormSchema("en-US").safeParse({_id: new ObjectId().toString(), cantons: ["Zurich"]});
        expect(edit.success).toBe(false);
    });

    it("the stored campaign refuses a value that is not a canton code", () => asCompany(async () => {
        const campaign = await createCampaign(companyId, {cantons: ["ZH"]});
        campaign.set("cantons", ["ZH", "XX"]);
        await expect(campaign.validate()).rejects.toThrow(/cantons/);
    }));
});
