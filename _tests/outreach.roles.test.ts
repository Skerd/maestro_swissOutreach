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
// The routes' orchestrator never reaches a live provider.
vi.mock("@swissOutreachModule/utilities/adapters/createPorts", async () => (await import("./outreach.fixtures")).createPortsMock);

import {appFor, callerHeader, type TestCaller} from "@coreModule/_tests/httpHarness";
import {withTenant} from "@coreModule/utilities/endpoints/tenantScope";
import RolePermission from "@coreModule/database/schemas/rolePermission/rolePermission";
import {createRolePermissions} from "@coreModule/database/schemas/rolePermission/rolePermission.default";
import {resolveDefaultRolePermissionIds} from "@coreModule/database/schemas/role/role.defaults";
import * as campaignRoute from "@swissOutreachModule/api/swissOutreach/private/campaign";
import * as outreachEmailRoute from "@swissOutreachModule/api/swissOutreach/private/outreachEmail";
import * as prospectCompanyRoute from "@swissOutreachModule/api/swissOutreach/private/prospectCompany";
import * as suppressedContactRoute from "@swissOutreachModule/api/swissOutreach/private/suppressedContact";
import Campaign from "@swissOutreachModule/database/schemas/campaign/campaign";
import ProspectCompany from "@swissOutreachModule/database/schemas/prospectCompany/prospectCompany";
import OutreachEmail from "@swissOutreachModule/database/schemas/outreachEmail/outreachEmail";
import "@swissOutreachModule/database/schemas/pipelineRunLog/pipelineRunLog";
import SuppressedContact from "@swissOutreachModule/database/schemas/suppressedContact/suppressedContact";
import {moduleBootstrap} from "@swissOutreachModule/database/moduleBootstrap";
import {swissOutreachDefaultRoles} from "@swissOutreachModule/database/schemas/role/swissOutreach.role.defaults";
import {campaignOrchestrator} from "@swissOutreachModule/utilities/pipeline/campaignOrchestrator";
import {seedReview} from "./outreach.fixtures";

const companyId = new ObjectId();
const asCompany = <T>(fn: () => PromiseLike<T>): Promise<T> => withTenant(companyId, fn);

const app = appFor([
    {basePath: "/api/swissOutreach/campaign", router: campaignRoute.router, module: "swissOutreach"},
    {basePath: "/api/swissOutreach/outreachEmail", router: outreachEmailRoute.router, module: "swissOutreach"},
    {basePath: "/api/swissOutreach/prospectCompany", router: prospectCompanyRoute.router, module: "swissOutreach"},
    {basePath: "/api/swissOutreach/suppressedContact", router: suppressedContactRoute.router, module: "swissOutreach"},
]);

/** The tags a new company's role gets from its default definition, as company creation and the role sync grant them. */
const granted: Record<string, string[]> = {};
const callerFor = (slug: string): TestCaller => ({
    userId: new ObjectId().toString(),
    companyId: companyId.toString(),
    isAdmin: false,
    permissions: granted[slug],
});
const post = (caller: TestCaller, path: string, body: Record<string, unknown>) =>
    request(app).post(`/api/swissOutreach/${path}`).set(callerHeader(caller)).send(body);
const put = (caller: TestCaller, path: string, body: Record<string, unknown>) =>
    request(app).put(`/api/swissOutreach/${path}`).set(callerHeader(caller)).send(body);

const ACTIONS = {
    start: "swissoutreachcampaigns[action:start]",
    cancel: "swissoutreachcampaigns[action:cancel]",
    approveAll: "swissoutreachcampaigns[action:approveAll]",
    sendApproved: "swissoutreachcampaigns[action:sendApproved]",
    approve: "swissoutreachemails[action:approve]",
    skip: "swissoutreachemails[action:skip]",
    editDraft: "swissoutreachemails[action:editDraft]",
    doNotContact: "swissoutreachemails[action:doNotContact]",
};
/** What both roles hold: read the whole module, create and edit campaigns, start/cancel them, rewrite drafts (D113). */
const OPERATOR_GRANTS = [
    ACTIONS.start, ACTIONS.cancel, ACTIONS.editDraft,
    "swissoutreachcampaigns[create:swissoutreachcampaigns]",
    "swissoutreachcampaigns[read:name]", "swissoutreachcampaigns[write:name]", "swissoutreachcampaigns[read:lastError]",
    "swissoutreachemails[read:subject]", "swissoutreachemails[write:toEmail]",
    "swissoutreachprospectcompanies[read:companyName]",
    "swissoutreachpipelinerunlogs[read:message]",
    "swissoutreachsuppressedcontacts[read:email]",
];
/** What only the approver holds: the decisions on what goes out, and the do-not-contact list itself. */
const APPROVER_ONLY = [
    ACTIONS.approve, ACTIONS.skip, ACTIONS.doNotContact, ACTIONS.approveAll, ACTIONS.sendApproved,
    "swissoutreachsuppressedcontacts[create:swissoutreachsuppressedcontacts]",
    "swissoutreachsuppressedcontacts[delete:swissoutreachsuppressedcontacts]",
    "swissoutreachsuppressedcontacts[restore:swissoutreachsuppressedcontacts]",
];
/** Neither role: deleting campaigns and emails (history) and changing what the pipeline found. */
const NEITHER = [
    "swissoutreachcampaigns[delete:swissoutreachcampaigns]", "swissoutreachcampaigns[restore:swissoutreachcampaigns]",
    "swissoutreachemails[delete:swissoutreachemails]", "swissoutreachemails[restore:swissoutreachemails]",
    "swissoutreachprospectcompanies[write:companyName]", "swissoutreachpipelinerunlogs[write:message]",
];

beforeAll(async () => {
    process.env.SWISS_OUTREACH_REQUEST_DELAY_MS = "0";
    await connectTestDatabase();
    await createRolePermissions();
    for (const role of swissOutreachDefaultRoles) {
        const ids = await resolveDefaultRolePermissionIds(role);
        granted[role.slug] = (await RolePermission.find({_id: {$in: ids}}).select("tag").lean()).map((permission) => permission.tag);
    }
}, 120000);

afterAll(async () => {
    await disconnectTestDatabase();
});

beforeEach(async () => {
    vi.restoreAllMocks();
    await Promise.all([Campaign, ProspectCompany, OutreachEmail, SuppressedContact].map((model) => model.collection.deleteMany({})));
});

describe("swissOutreach default roles (D113)", {timeout: 30000}, () => {
    it("are the module's default role pack", () => {
        expect(moduleBootstrap.defaultRoles.map((role) => role.slug)).toEqual(["outreach_operator", "outreach_approver"]);
    });

    it("exclude only tags that exist, so a misspelt one cannot grant silently", async () => {
        const excluded = swissOutreachDefaultRoles.flatMap((role) => role.excludedPermissions ?? []);
        const known = new Set((await RolePermission.find({tag: {$in: excluded}}).select("tag").lean()).map((permission) => permission.tag));
        expect(excluded.filter((tag) => !known.has(tag))).toEqual([]);
    });

    it("let the operator read the module, run campaigns and rewrite drafts, but decide nothing that goes out", () => {
        const tags = granted.outreach_operator;
        expect(tags).toEqual(expect.arrayContaining(OPERATOR_GRANTS));
        for (const tag of [...APPROVER_ONLY, ...NEITHER]) expect(tags, tag).not.toContain(tag);
    });

    it("let the approver do what the operator does, and approve, skip, send and keep the do-not-contact list", () => {
        const tags = granted.outreach_approver;
        expect(tags).toEqual(expect.arrayContaining([...OPERATOR_GRANTS, ...APPROVER_ONLY]));
        for (const tag of NEITHER) expect(tags, tag).not.toContain(tag);
    });

    it("hold for real: the operator edits a draft and cancels a run, and is refused every approval action", () => asCompany(async () => {
        vi.spyOn(campaignOrchestrator, "enqueue").mockImplementation(() => undefined);
        const operator = callerFor("outreach_operator");
        const {campaign, emails} = await seedReview(companyId, [{status: "draft", toEmail: "a@one.ch"}]);
        const emailId = emails[0]._id.toString();
        const campaignId = campaign._id.toString();

        expect((await post(operator, "outreachEmail/editDraft", {emailId, subject: "Neue Anfrage"})).status).toBe(200);
        expect((await post(operator, "prospectCompany", {offset: 0, limit: 20})).status).toBe(200);
        expect((await post(operator, "suppressedContact", {offset: 0, limit: 20})).status).toBe(200);
        for (const [path, body] of [
            ["outreachEmail/approve", {emailId}],
            ["outreachEmail/skip", {emailId}],
            ["outreachEmail/doNotContact", {emailId}],
            ["campaign/approveAll", {campaignId}],
            ["campaign/sendApproved", {campaignId}],
        ] as const) {
            const response = await post(operator, path, body);
            expect(response.status, path).toBe(403);
            expect(response.body.error_code).toBe("user_permissions_not_sufficient");
        }
        expect((await put(operator, "suppressedContact", {email: "stop@one.ch"})).status).toBe(403);
        expect((await OutreachEmail.findById(emailId))!.status).toBe("edited");

        expect((await post(operator, "campaign/cancel", {campaignId})).status).toBe(200);
        expect((await Campaign.findById(campaignId))!.status).toBe("cancelled");
    }));

    it("hold for real: the approver approves an email and adds to the do-not-contact list", () => asCompany(async () => {
        const approver = callerFor("outreach_approver");
        const {emails} = await seedReview(companyId, [{status: "draft", toEmail: "a@one.ch"}]);

        expect((await post(approver, "outreachEmail/approve", {emailId: emails[0]._id.toString()})).status).toBe(200);
        expect((await OutreachEmail.findById(emails[0]._id))!.status).toBe("approved");
        expect((await put(approver, "suppressedContact", {email: "stop@one.ch"})).status).toBe(200);
        expect(await SuppressedContact.countDocuments({email: "stop@one.ch"})).toBe(1);
    }));
});
