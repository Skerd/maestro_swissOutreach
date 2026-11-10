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
// The routes' orchestrator works through the fake ports, never a live provider.
vi.mock("@swissOutreachModule/utilities/adapters/createPorts", async () => (await import("./outreach.fixtures")).createPortsMock);

import {allPermissionTags, appFor, callerHeader, type TestCaller} from "@coreModule/_tests/httpHarness";
import {withTenant} from "@coreModule/utilities/endpoints/tenantScope";
import * as campaignRoute from "@swissOutreachModule/api/swissOutreach/private/campaign";
import * as outreachEmailRoute from "@swissOutreachModule/api/swissOutreach/private/outreachEmail";
import * as prospectCompanyRoute from "@swissOutreachModule/api/swissOutreach/private/prospectCompany";
import * as dashboardRoute from "@swissOutreachModule/api/swissOutreach/private/dashboard";
import * as viewConfigsRoute from "@coreModule/api/auxiliary/private/viewConfigs";
import Campaign from "@swissOutreachModule/database/schemas/campaign/campaign";
import ProspectCompany from "@swissOutreachModule/database/schemas/prospectCompany/prospectCompany";
import OutreachEmail from "@swissOutreachModule/database/schemas/outreachEmail/outreachEmail";
import PipelineRunLog from "@swissOutreachModule/database/schemas/pipelineRunLog/pipelineRunLog";
import {CampaignOrchestrator} from "@swissOutreachModule/utilities/pipeline/campaignOrchestrator";
import {createCampaign, fakePorts, PLUMBER, seedReview, testPorts} from "./outreach.fixtures";

const companyId = new ObjectId();
const otherCompanyId = new ObjectId();
const asCompany = <T>(fn: () => PromiseLike<T>): Promise<T> => withTenant(companyId, fn);
const asOther = <T>(fn: () => PromiseLike<T>): Promise<T> => withTenant(otherCompanyId, fn);

const app = appFor([
    {basePath: "/api/swissOutreach/campaign", router: campaignRoute.router, module: "swissOutreach"},
    {basePath: "/api/swissOutreach/outreachEmail", router: outreachEmailRoute.router, module: "swissOutreach"},
    {basePath: "/api/swissOutreach/prospectCompany", router: prospectCompanyRoute.router, module: "swissOutreach"},
    {basePath: "/api/swissOutreach/dashboard", router: dashboardRoute.router, module: "swissOutreach"},
    {basePath: "/api/auxiliary/viewConfigs", router: viewConfigsRoute.router, module: "core"},
]);

/** Every permission the three models have, the actions included. */
const staff: TestCaller = {
    userId: new ObjectId().toString(),
    companyId: companyId.toString(),
    isAdmin: true,
    permissions: allPermissionTags([Campaign, OutreachEmail, ProspectCompany]),
};
const call = (method: "put" | "patch" | "post", path: string, body: Record<string, unknown>, caller: TestCaller = staff) =>
    request(app)[method](`/api/swissOutreach/${path}`).set(callerHeader(caller)).send(body);

/** What an edit form sends for a whole email: the fields a reviewer may write. */
const emailEdit = (id: ObjectId, overrides: Record<string, unknown> = {}) =>
    ({_id: id.toString(), subject: "Anfrage Offerte", body: "Guten Tag", language: "de", ...overrides});

beforeAll(async () => {
    process.env.SWISS_OUTREACH_REQUEST_DELAY_MS = "0";
    process.env.SWISS_OUTREACH_RETRY_COUNT = "1";
    await connectTestDatabase();
}, 120000);

afterAll(async () => {
    await disconnectTestDatabase();
});

beforeEach(async () => {
    vi.restoreAllMocks();
    testPorts.current = fakePorts();
    await Promise.all([Campaign, ProspectCompany, OutreachEmail, PipelineRunLog].map((model) => model.collection.deleteMany({})));
});

// Regression (A1): `status` and the record links were SchemaDef fields, so a generic PATCH approved an email,
// rewrote a sent one, revived a cancelled campaign; PUT made emails and prospects the pipeline never found.
describe("server-owned fields and records", {timeout: 30000}, () => {
    it("an email edit cannot approve it, move it to another campaign or prospect", () => asCompany(async () => {
        const {campaign, emails} = await seedReview(companyId, [{status: "draft", toEmail: "a@one.ch"}]);
        const other = await createCampaign(companyId);
        const response = await call("patch", "outreachEmail", emailEdit(emails[0]._id, {
            status: "approved", campaignId: other._id.toString(), prospectCompanyId: new ObjectId().toString(), subject: "Neu",
        }));
        expect(response.status).toBe(200);
        const stored = (await OutreachEmail.findById(emails[0]._id))!;
        expect(stored).toMatchObject({status: "draft", subject: "Neu"});
        expect(stored.campaignId.toString()).toBe(campaign._id.toString());
        expect(stored.prospectCompanyId.toString()).toBe(emails[0].prospectCompanyId.toString());
        expect((await Campaign.findById(campaign._id))!.stats.approved).toBe(0);
    }));

    it("refuses to edit an approved, queued or sent email, so approved text is what gets sent", () => asCompany(async () => {
        const {emails} = await seedReview(companyId, [
            {status: "approved", toEmail: "a@one.ch"},
            {status: "queued", toEmail: "b@one.ch"},
            {status: "sent", toEmail: "c@one.ch"},
        ]);
        for (const email of emails) {
            const response = await call("patch", "outreachEmail", emailEdit(email._id, {body: "Rewritten", toEmail: "x@evil.ch"}));
            expect(response.status).toBe(409);
            expect(response.body.error_code).toBe("email_not_editable");
            expect(await OutreachEmail.findById(email._id)).toMatchObject({status: email.status, body: "Guten Tag", toEmail: email.toEmail});
        }
        // A skipped or failed one may still be corrected; it needs approving before it goes out
        const {emails: [failed]} = await seedReview(companyId, [{status: "failed", toEmail: "d@one.ch"}]);
        expect((await call("patch", "outreachEmail", emailEdit(failed._id, {toEmail: "e@one.ch"}))).status).toBe(200);
        expect(await OutreachEmail.findById(failed._id)).toMatchObject({status: "failed", toEmail: "e@one.ch"});
    }));

    it("a campaign edit cannot change its status: a cancelled campaign stays cancelled", () => asCompany(async () => {
        const campaign = await createCampaign(companyId, {status: "cancelled"});
        const response = await call("patch", "campaign", {
            _id: campaign._id.toString(), status: "draft", stats: {sent: 99}, name: "Three bathrooms",
            jobDescription: "Looking for a plumbing company to renovate three bathrooms.", country: "Switzerland", maxCompanies: 10,
            language: "de", emailTone: "professional", senderCompanyName: "Buyer AG", senderName: "Ada", senderEmail: "ada@buyer.ch",
        });
        expect(response.status).toBe(200);
        const stored = (await Campaign.findById(campaign._id))!;
        expect(stored.status).toBe("cancelled");
        expect(stored.stats.sent).toBe(0);
        expect(stored.jobDescription).toBe("Looking for a plumbing company to renovate three bathrooms.");
    }));

    it("a prospect edit cannot change its status, campaign or dedupe key", () => asCompany(async () => {
        const {campaign, prospects} = await seedReview(companyId, [{status: "draft", toEmail: "a@one.ch"}]);
        const response = await call("patch", "prospectCompany", {
            _id: prospects[0]._id.toString(), companyName: "Renamed AG", status: "approved", dedupeKey: "CHE-X", campaignId: new ObjectId().toString(),
        });
        expect(response.status).toBe(200);
        const stored = (await ProspectCompany.findById(prospects[0]._id))!;
        expect(stored).toMatchObject({companyName: "Renamed AG", status: "scored", dedupeKey: "CHE-1"});
        expect(stored.campaignId.toString()).toBe(campaign._id.toString());
    }));

    it("only the pipeline creates emails and prospects", () => asCompany(async () => {
        const campaign = await createCampaign(companyId);
        const email = await call("put", "outreachEmail", {subject: "Hi", body: "Text", language: "de", toEmail: "a@one.ch"});
        expect(email.status).toBe(403);
        expect(email.body.error_code).toBe("user_permissions_not_sufficient");
        const prospect = await call("put", "prospectCompany", {companyName: "Fake AG", campaignId: campaign._id.toString()});
        expect(prospect.status).toBe(403);
        expect(await OutreachEmail.countDocuments({})).toBe(0);
        expect(await ProspectCompany.countDocuments({})).toBe(0);
    }));
});

// Regression (A4): the run was queued inside the create's transaction and read the campaign before it was committed,
// found nothing and gave up, so every new campaign stayed in draft.
describe("creating a campaign", {timeout: 30000}, () => {
    it("runs its pipeline once the create has committed", async () => {
        const response = await call("put", "campaign", {
            name: "Two bathrooms",
            jobDescription: "Looking for a plumbing company to renovate two bathrooms.", country: "Switzerland", cantons: ["ZH"], maxCompanies: 5,
            language: "de", emailTone: "professional", senderCompanyName: "Buyer AG", senderName: "Ada", senderEmail: "ada@buyer.ch",
        });
        expect(response.status).toBe(200);
        const campaignId = response.body._id as string;
        await vi.waitFor(async () => {
            expect((await asCompany(() => Campaign.findById(campaignId)))!.status).toBe("awaiting_approval");
        }, {timeout: 15000, interval: 100});
        expect(await asCompany(() => ProspectCompany.countDocuments({campaignId}))).toBe(2);
    });
});

describe("a campaign's name", {timeout: 30000}, () => {
    const newCampaign = {
        jobDescription: "Looking for a plumbing company to renovate two bathrooms.", country: "Switzerland", maxCompanies: 5,
        language: "de", emailTone: "professional", senderCompanyName: "Buyer AG", senderName: "Ada", senderEmail: "ada@buyer.ch",
    };

    it("is required on create", () => asCompany(async () => {
        const response = await call("put", "campaign", newCampaign);
        expect(response.status).toBe(400);
        expect(response.body.error_code).toBe("form_not_correct");
        expect(await Campaign.countDocuments({})).toBe(0);
    }));

    it("is what the campaign picker searches and shows", () => asCompany(async () => {
        await createCampaign(companyId, {name: "Roof repair, Basel"});
        await createCampaign(companyId);
        const response = await call("post", "campaign/select", {page: 1, limit: 20, name: "roof"});
        expect(response.status).toBe(200);
        expect(response.body.data.map((option: {label: string}) => option.label)).toEqual(["Roof repair, Basel (draft)"]);
    }));

    it("of a campaign made before campaigns had one is its sender company", () => asCompany(async () => {
        const {_id} = await createCampaign(companyId);
        await Campaign.collection.updateOne({_id}, {$unset: {name: ""}});
        const response = await call("post", "campaign/single", {_id: _id.toString()});
        expect(response.status).toBe(200);
        expect(response.body.name).toBe("Buyer AG");
    }));
});

// Regression (A6): the dashboard answered every tenant with the process-wide counters and the operator's providers.
describe("dashboard summary", {timeout: 30000}, () => {
    it("holds the company's own counts and nothing about the server", async () => {
        const response = await call("post", "dashboard/summary", {});
        expect(response.status).toBe(200);
        // No replies count: nothing tracks replies, so it could only ever say 0.
        expect(Object.keys(response.body.data).sort()).toEqual([
            "averageScore", "campaignsActive", "campaignsTotal", "companiesContacted", "companiesFound", "emailsSent", "failures",
            "successRate",
        ]);
    });
});

// Regression (A7): `/:campaignId/prospects|emails|logs` checked nothing but the sign-in and returned whole documents.
describe("a campaign's prospects, emails and logs", {timeout: 30000}, () => {
    it("the nested prospect and email routes are gone; the lists filter by campaign", () => asCompany(async () => {
        const {campaign} = await seedReview(companyId, [{status: "draft", toEmail: "a@one.ch"}, {status: "sent", toEmail: "b@one.ch"}]);
        await seedReview(companyId, [{status: "draft", toEmail: "c@one.ch"}]);
        for (const path of ["prospects", "emails"]) {
            expect((await request(app).get(`/api/swissOutreach/campaign/${campaign._id}/${path}`).set(callerHeader(staff))).status).toBe(404);
        }
        const filter = {id: "campaign", operator: "and", rules: [{id: "c", field: "campaignId", operator: "equals", value: campaign._id.toString()}], groups: []};
        const emails = await call("post", "outreachEmail", {limit: 50, offset: 0, filter});
        expect(emails.status).toBe(200);
        expect(emails.body.data.map((email: {toEmail: string}) => email.toEmail).sort()).toEqual(["a@one.ch", "b@one.ch"]);
        // The list populates refs; the rows still carry plain ids (the approval page joins on them).
        for (const email of emails.body.data as Array<{campaignId: string; prospectCompanyId: string}>) {
            expect(email.campaignId).toBe(campaign._id.toString());
            expect(email.prospectCompanyId).toMatch(/^[a-f0-9]{24}$/);
        }
        const prospects = await call("post", "prospectCompany", {limit: 50, offset: 0, filter});
        expect(prospects.body.total).toBe(2);
        expect(prospects.body.data.map((prospect: {campaignId: string}) => prospect.campaignId)).toEqual([campaign._id.toString(), campaign._id.toString()]);
    }));

    it("logs need a valid campaign id and read access to the campaign's errors, and hold only that campaign's steps", async () => {
        const campaign = await asCompany(() => createCampaign(companyId));
        const foreign = await asOther(() => createCampaign(otherCompanyId));
        await asCompany(() => PipelineRunLog.create({company: companyId, campaignId: campaign._id, step: "pipeline", level: "info", message: "Started", meta: {secret: 1}}));
        await asOther(() => PipelineRunLog.create({company: otherCompanyId, campaignId: foreign._id, step: "pipeline", level: "info", message: "Theirs"}));

        const invalid = await call("post", "campaign/logs", {campaignId: "not-an-id"});
        expect(invalid.status).toBe(400);
        expect(invalid.body.error_code).toBe("form_not_correct");

        const blind: TestCaller = {...staff, permissions: staff.permissions!.filter((tag) => !tag.includes("lastError"))};
        const refused = await call("post", "campaign/logs", {campaignId: campaign._id.toString()}, blind);
        expect(refused.status).toBe(403);

        expect((await call("post", "campaign/logs", {campaignId: foreign._id.toString()})).body.error_code).toBe("campaign_not_found");

        const logs = await call("post", "campaign/logs", {campaignId: campaign._id.toString()});
        expect(logs.status).toBe(200);
        expect(logs.body.data).toHaveLength(1);
        expect(logs.body.data[0]).toMatchObject({step: "pipeline", level: "info", message: "Started"});
        expect(logs.body.data[0].meta).toBeUndefined();
    });
});

// A8: a redelivered Kafka event (or a late retry) for a campaign past its pipeline must not run it again.
describe("a run of a campaign past its pipeline", {timeout: 30000}, () => {
    it("does nothing for a sending, completed or cancelled campaign", () => asCompany(async () => {
        const search = vi.fn(async () => [PLUMBER]);
        const orchestrator = new CampaignOrchestrator(fakePorts({registry: {search}}));
        for (const status of ["sending", "completed", "cancelled"] as const) {
            const campaign = await createCampaign(companyId, {status});
            await orchestrator.run(campaign._id.toString());
            expect((await Campaign.findById(campaign._id))!.status).toBe(status);
        }
        expect(search).not.toHaveBeenCalled();
    }));
});

describe("the campaign sheet", {timeout: 30000}, () => {
    // `stats` is a plain nested object, so its read fields are flat paths (`stats.found`);
    // the sheet filter must not lock cards the caller may read.
    it("shows the results to a caller who may read them", async () => {
        const response = await request(app).get("/api/auxiliary/viewConfigs").set(callerHeader({...staff, modules: ["core", "swissOutreach"]}));
        expect(response.status).toBe(200);
        const fields: Array<{name?: string; locked?: boolean}> = [];
        const walk = (nodes: Array<{field?: {name?: string; locked?: boolean}; children?: unknown}> = []) => {
            for (const node of nodes) {
                if (node.field) fields.push(node.field);
                walk(node.children as typeof nodes);
            }
        };
        walk(response.body.swissoutreachcampaigns.sheet.nodes);
        const stats = fields.filter((field) => field.name?.startsWith("stats."));
        expect(stats.map((field) => field.name)).toContain("stats.found");
        expect(stats.filter((field) => field.locked)).toEqual([]);
    });
});
