import {afterAll, beforeAll, beforeEach, describe, expect, it, vi} from "vitest";
import {MongoMemoryServer} from "mongodb-memory-server";
import mongoose from "mongoose";
import {ObjectId} from "mongodb";
import Campaign from "@swissOutreachModule/database/schemas/campaign/campaign";
import ProspectCompany from "@swissOutreachModule/database/schemas/prospectCompany/prospectCompany";
import OutreachEmail from "@swissOutreachModule/database/schemas/outreachEmail/outreachEmail";
import {CampaignOrchestrator} from "@swissOutreachModule/utilities/pipeline/campaignOrchestrator";
import type {
    CompanyRegistryPort,
    LlmPort,
    MailPort,
    WebsiteFetchPort,
} from "@swissOutreachModule/utilities/ports";

let mongod: MongoMemoryServer;
const companyId = new ObjectId();

beforeAll(async () => {
    process.env.SWISS_OUTREACH_REQUEST_DELAY_MS = "0";
    process.env.SWISS_OUTREACH_RETRY_COUNT = "2";
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

describe("CampaignOrchestrator integration", () => {
    it("runs parse → search → enrich → email draft with fakes", async () => {
        const registry: CompanyRegistryPort = {
            async search() {
                return [
                    {
                        companyName: "Test Sanitär AG",
                        uid: "CHE-999.999.999",
                        canton: "BS",
                        legalForm: "AG",
                        registerUrl: "https://www.zefix.ch/test",
                    },
                ];
            },
        };
        const llm: LlmPort = {
            async completeJson() {
                return {
                    industry: "Plumbing",
                    companyTypes: ["AG"],
                    synonyms: ["plumbing"],
                    germanEquivalents: ["Sanitär"],
                    frenchEquivalents: [],
                    italianEquivalents: [],
                    nogaCategories: [],
                    keywords: ["plumbing", "Sanitär"],
                    subject: "Anfrage",
                    body: "Guten Tag",
                };
            },
            async completeText() {
                return "Test Sanitär AG renovates bathrooms in Basel.";
            },
        };
        const website: WebsiteFetchPort = {
            async discoverWebsite() {
                return {url: "https://test-sanitaer.ch", confidence: 88};
            },
            async crawl() {
                return {
                    pages: [{url: "https://test-sanitaer.ch/kontakt", html: "<a>info@test-sanitaer.ch</a>"}],
                    emails: ["info@test-sanitaer.ch"],
                    phones: ["+41 61 000 00 00"],
                    city: "Basel",
                    postalCode: "4001",
                    languages: ["de"],
                    services: ["Sanitär"],
                    textBlob: "Sanitär Badrenovation Basel info@test-sanitaer.ch",
                };
            },
        };
        const mail: MailPort = {
            send: vi.fn(async () => ({accepted: true, messageId: "msg-1"})),
        };

        const campaign = await Campaign.create({
            company: companyId,
            jobDescription: "Looking for a plumbing company to renovate bathrooms in Basel.",
            country: "Switzerland",
            cantons: ["BS"],
            maxCompanies: 5,
            language: "de",
            emailTone: "professional",
            sendAutomatically: false,
            senderCompanyName: "Buyer AG",
            senderName: "Ada",
            senderEmail: "ada@buyer.ch",
            status: "draft",
            stats: {found: 0, enriched: 0, scored: 0, approved: 0, sent: 0, failed: 0},
        });

        const orch = new CampaignOrchestrator({registry, llm, website, mail});
        await orch.run(campaign._id.toString());

        const refreshed = await Campaign.findById(campaign._id);
        expect(refreshed?.status).toBe("awaiting_approval");
        expect(refreshed?.stats.found).toBeGreaterThanOrEqual(1);

        const prospects = await ProspectCompany.find({campaignId: campaign._id});
        expect(prospects.length).toBeGreaterThanOrEqual(1);
        expect(prospects[0].emails).toContain("info@test-sanitaer.ch");
        expect((prospects[0].score || 0) > 0).toBe(true);

        const emails = await OutreachEmail.find({campaignId: campaign._id});
        expect(emails.length).toBeGreaterThanOrEqual(1);
        expect(emails[0].status).toBe("draft");

        emails[0].status = "approved";
        await emails[0].save();
        const sendResult = await orch.sendApproved(campaign._id.toString(), false);
        expect(sendResult.sent).toBe(1);
        expect(mail.send).toHaveBeenCalled();
    });
});
