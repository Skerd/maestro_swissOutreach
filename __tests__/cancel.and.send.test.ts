import {afterAll, beforeAll, beforeEach, describe, expect, it, vi} from "vitest";
import {MongoMemoryServer} from "mongodb-memory-server";
import mongoose from "mongoose";
import {ObjectId} from "mongodb";
import Campaign from "@swissOutreachModule/database/schemas/campaign/campaign";
import ProspectCompany from "@swissOutreachModule/database/schemas/prospectCompany/prospectCompany";
import OutreachEmail from "@swissOutreachModule/database/schemas/outreachEmail/outreachEmail";
import {CampaignOrchestrator} from "@swissOutreachModule/utilities/pipeline/campaignOrchestrator";
import type {CompanyRegistryPort, LlmPort, MailPort, WebsiteFetchPort} from "@swissOutreachModule/utilities/ports";

let mongod: MongoMemoryServer;
const companyId = new ObjectId();

beforeAll(async () => {
    process.env.SWISS_OUTREACH_REQUEST_DELAY_MS = "0";
    process.env.SWISS_OUTREACH_RETRY_COUNT = "1";
    process.env.SWISS_OUTREACH_CONCURRENCY = "1";
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri());
}, 120000);

afterAll(async () => {
    await mongoose.disconnect();
    await mongod.stop();
});

beforeEach(async () => {
    await Promise.all([
        Campaign.deleteMany({}),
        ProspectCompany.deleteMany({}),
        OutreachEmail.deleteMany({}),
    ]);
});

function slowDeps(mailSend: MailPort["send"]) {
    const registry: CompanyRegistryPort = {
        async search() {
            return [{companyName: "Cancel AG", uid: "CHE-1", canton: "BS", legalForm: "AG"}];
        },
    };
    const llm: LlmPort = {
        async completeJson() {
            return {
                industry: "X",
                companyTypes: [],
                synonyms: [],
                germanEquivalents: [],
                frenchEquivalents: [],
                italianEquivalents: [],
                nogaCategories: [],
                keywords: ["elektro"],
                subject: "S",
                body: "B",
            };
        },
        async completeText() {
            await new Promise((r) => setTimeout(r, 50));
            return "summary";
        },
    };
    const website: WebsiteFetchPort = {
        async discoverWebsite() {
            return {url: "https://example.com", confidence: 80};
        },
                async crawl(_url, signal) {
            if (signal?.aborted) {
                const {CampaignCancelledError} = await import("@swissOutreachModule/utilities/pipeline/cancellation");
                throw new CampaignCancelledError("test");
            }
            await new Promise((r) => setTimeout(r, 80));
            if (signal?.aborted) {
                const {CampaignCancelledError} = await import("@swissOutreachModule/utilities/pipeline/cancellation");
                throw new CampaignCancelledError("test");
            }
            return {
                pages: [],
                emails: ["info@example.com"],
                phones: [],
                languages: ["de"],
                services: [],
                textBlob: "elektro",
            };
        },
    };
    const mail: MailPort = {send: mailSend};
    return {registry, llm, website, mail};
}

describe("cancel + atomic send", () => {
    it("cancel stops pipeline from completing as awaiting_approval", async () => {
        const orch = new CampaignOrchestrator(slowDeps(vi.fn(async () => ({accepted: true, messageId: "1"}))));
        const campaign = await Campaign.create({
            company: companyId,
            jobDescription: "Need electrician for residential work in Basel.",
            country: "Switzerland",
            cantons: ["BS"],
            maxCompanies: 5,
            language: "de",
            emailTone: "professional",
            sendAutomatically: false,
            senderCompanyName: "Buyer",
            senderName: "A",
            senderEmail: "a@b.ch",
            status: "draft",
            stats: {found: 0, enriched: 0, scored: 0, approved: 0, sent: 0, failed: 0},
        });

        const runPromise = orch.run(campaign._id.toString());
        await new Promise((r) => setTimeout(r, 30));
        await orch.cancel(campaign._id.toString());
        await runPromise;

        const refreshed = await Campaign.findById(campaign._id);
        expect(refreshed?.status).toBe("cancelled");
    });

    it("atomic claim prevents double send under parallel sendApproved", async () => {
        const send = vi.fn(async () => {
            await new Promise((r) => setTimeout(r, 20));
            return {accepted: true, messageId: "m1"};
        });
        const orch = new CampaignOrchestrator(slowDeps(send));
        const campaign = await Campaign.create({
            company: companyId,
            jobDescription: "Need electrician for residential work in Basel.",
            country: "Switzerland",
            cantons: ["BS"],
            maxCompanies: 5,
            language: "de",
            emailTone: "professional",
            sendAutomatically: false,
            senderCompanyName: "Buyer",
            senderName: "A",
            senderEmail: "a@b.ch",
            status: "awaiting_approval",
            stats: {found: 1, enriched: 1, scored: 1, approved: 1, sent: 0, failed: 0},
        });
        const prospect = await ProspectCompany.create({
            company: companyId,
            campaignId: campaign._id,
            companyName: "Cancel AG",
            dedupeKey: "CHE-1",
            status: "approved",
            emails: ["info@example.com"],
            phones: [],
            languages: [],
            services: [],
            score: 80,
        });
        await OutreachEmail.create({
            company: companyId,
            campaignId: campaign._id,
            prospectCompanyId: prospect._id,
            toEmail: "info@example.com",
            subject: "Hi",
            body: "Body",
            language: "de",
            status: "approved",
            attempts: 0,
        });

        const [a, b] = await Promise.all([
            orch.sendApproved(campaign._id.toString(), false),
            orch.sendApproved(campaign._id.toString(), false),
        ]);
        expect(a.sent + b.sent).toBe(1);
        expect(send).toHaveBeenCalledTimes(1);
    });
});
