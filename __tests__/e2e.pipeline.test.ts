/**
 * End-to-end style pipeline test using in-memory Mongo + fake ports.
 * Complements orchestrator.integration.test.ts by asserting dashboard aggregates.
 */
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

describe("swissOutreach e2e pipeline", () => {
    it("creates campaign → approval → send → measurable outcomes", async () => {
        const registry: CompanyRegistryPort = {
            async search() {
                return [
                    {
                        companyName: "E2E Elektro AG",
                        uid: "CHE-111.222.333",
                        canton: "BL",
                        legalForm: "AG",
                    },
                ];
            },
        };
        const llm: LlmPort = {
            async completeJson() {
                return {
                    industry: "Electrical",
                    companyTypes: ["AG"],
                    synonyms: [],
                    germanEquivalents: ["Elektro"],
                    frenchEquivalents: [],
                    italianEquivalents: [],
                    nogaCategories: [],
                    keywords: ["electrician", "Elektro"],
                    subject: "Anfrage Offerte",
                    body: "Guten Tag E2E Elektro AG",
                };
            },
            async completeText() {
                return "Electrical contractor in Basel-Landschaft.";
            },
        };
        const website: WebsiteFetchPort = {
            async discoverWebsite() {
                return {url: "https://e2e-elektro.ch", confidence: 92};
            },
            async crawl() {
                return {
                    pages: [],
                    emails: ["info@e2e-elektro.ch"],
                    phones: [],
                    languages: ["de"],
                    services: ["Elektro"],
                    textBlob: "Elektroinstallationen BL",
                };
            },
        };
        const mail: MailPort = {send: vi.fn(async () => ({accepted: true, messageId: "e2e-1"}))};

        const campaign = await Campaign.create({
            company: companyId,
            jobDescription: "Need an electrician for a residential building renovation.",
            country: "Switzerland",
            cantons: ["BL"],
            maxCompanies: 3,
            language: "de",
            emailTone: "professional",
            sendAutomatically: false,
            senderCompanyName: "E2E Buyer",
            senderName: "Tester",
            senderEmail: "tester@example.ch",
            status: "draft",
            stats: {found: 0, enriched: 0, scored: 0, approved: 0, sent: 0, failed: 0},
        });

        const orch = new CampaignOrchestrator({registry, llm, website, mail});
        await orch.run(campaign._id.toString());

        const emails = await OutreachEmail.find({campaignId: campaign._id});
        expect(emails).toHaveLength(1);
        emails[0].status = "approved";
        await emails[0].save();

        const result = await orch.sendApproved(campaign._id.toString());
        expect(result.sent).toBe(1);
        expect(result.failed).toBe(0);

        const done = await Campaign.findById(campaign._id);
        expect(done?.status).toBe("completed");
        expect(done?.stats.sent).toBeGreaterThanOrEqual(1);
        expect(await ProspectCompany.countDocuments({campaignId: campaign._id, status: "sent"})).toBe(1);
    });
});
