/**
 * Shared fixtures of the swissOutreach tests: fake ports (no live ZEFIX, web, LLM or mail) and seeded
 * campaigns. Call the seeders inside the company's tenant context (`withTenant`).
 */
import type {ObjectId} from "mongodb";
import {JOB_PARSE_SYSTEM_PROMPT} from "armonia/src/modules/swissOutreach/prompts/outreachPrompts";
import Campaign, {type ICampaign} from "@swissOutreachModule/database/schemas/campaign/campaign";
import ProspectCompany, {type IProspectCompany} from "@swissOutreachModule/database/schemas/prospectCompany/prospectCompany";
import OutreachEmail, {type IOutreachEmail} from "@swissOutreachModule/database/schemas/outreachEmail/outreachEmail";
import type {OrchestratorDeps} from "@swissOutreachModule/utilities/pipeline/campaignOrchestrator";
import type {SwissOutreachPorts} from "@swissOutreachModule/utilities/adapters/createPorts";
import type {CrawlResult} from "@swissOutreachModule/utilities/ports";

/** Two register hits: a plumber with a website and a contact address, and a company with neither. */
export const PLUMBER = {companyName: "Test Sanitär AG", uid: "CHE-111.111.111", canton: "BS", legalForm: "AG"};
export const NO_WEBSITE = {companyName: "Leer GmbH", uid: "CHE-222.222.222", canton: "ZH", legalForm: "GmbH"};

export const PLUMBER_CRAWL: CrawlResult = {
    pages: [],
    emails: ["jobs@test-sanitaer.ch", "info@test-sanitaer.ch"],
    phones: ["+41 61 000 00 00"],
    city: "Basel",
    postalCode: "4001",
    languages: ["de"],
    services: ["Sanitär"],
    textBlob: "Sanitär Badrenovation Basel",
};

/** Fake ports: the register finds both companies, only the plumber has a website, every mail is accepted. */
export function fakePorts(overrides: Partial<OrchestratorDeps> = {}): OrchestratorDeps {
    return {
        registry: {search: async () => [PLUMBER, NO_WEBSITE]},
        website: {
            discoverWebsite: async (companyName) => (companyName === PLUMBER.companyName ? {url: "https://test-sanitaer.ch", confidence: 88} : {confidence: 0}),
            crawl: async () => PLUMBER_CRAWL,
        },
        llm: {
            async completeJson<T>(system: string): Promise<T> {
                const answer = system === JOB_PARSE_SYSTEM_PROMPT
                    ? {industry: "Plumbing", keywords: ["plumbing", "Sanitär"], germanEquivalents: ["Badrenovation"]}
                    : {subject: "Anfrage Offerte", body: "Guten Tag"};
                return answer as T;
            },
            completeText: async () => "A Swiss company.",
        },
        mail: {send: async () => ({accepted: true, messageId: "msg-1"})},
        ...overrides,
    };
}

/** The ports the module's own orchestrator (`campaignOrchestrator`) gets in tests: they forward to `testPorts.current`. */
export const testPorts: {current: OrchestratorDeps} = {current: fakePorts()};

/** Stands in for `createPorts` (`vi.mock(..., async () => (await import("./outreach.fixtures")).createPortsMock)`). */
export const createPortsMock = {
    createSwissOutreachPorts: (): SwissOutreachPorts => ({
        registry: {search: (query) => testPorts.current.registry.search(query)},
        webSearch: {search: async () => []},
        website: {
            discoverWebsite: (companyName, canton) => testPorts.current.website.discoverWebsite(companyName, canton),
            crawl: (url, signal) => testPorts.current.website.crawl(url, signal),
        },
        llm: {
            completeJson: <T>(system: string, user: string) => testPorts.current.llm.completeJson<T>(system, user),
            completeText: (system, user) => testPorts.current.llm.completeText(system, user),
        },
        mail: {send: (request) => testPorts.current.mail.send(request)},
    }),
};

type CampaignOverrides = Partial<Pick<ICampaign, "cantons" | "language" | "sendAutomatically" | "status" | "maxCompanies">>;

/** A German-language campaign for plumbers in Zurich, waiting to run. */
export function createCampaign(company: ObjectId, overrides: CampaignOverrides = {}): Promise<ICampaign> {
    return Campaign.create({
        company,
        jobDescription: "Looking for a plumbing company to renovate two bathrooms.",
        country: "Switzerland",
        cantons: ["ZH"],
        maxCompanies: 10,
        language: "de",
        emailTone: "professional",
        sendAutomatically: false,
        senderCompanyName: "Buyer AG",
        senderName: "Ada",
        senderEmail: "ada@buyer.ch",
        status: "draft",
        stats: {found: 0, enriched: 0, scored: 0, approved: 0, sent: 0, failed: 0},
        ...overrides,
    });
}

export type SeededEmail = {status: IOutreachEmail["status"]; toEmail?: string};

/** A campaign awaiting approval with one scored prospect and one email per entry. */
export async function seedReview(company: ObjectId, emails: SeededEmail[], campaignOverrides: CampaignOverrides = {}): Promise<{
    campaign: ICampaign;
    prospects: IProspectCompany[];
    emails: IOutreachEmail[];
}> {
    const campaign = await createCampaign(company, {status: "awaiting_approval", ...campaignOverrides});
    const prospects: IProspectCompany[] = [];
    const stored: IOutreachEmail[] = [];
    for (const [index, email] of emails.entries()) {
        const prospect = await ProspectCompany.create({
            company,
            campaignId: campaign._id,
            companyName: `Prospect ${index + 1} AG`,
            dedupeKey: `CHE-${index + 1}`,
            status: email.status === "sent" ? "sent" : "scored",
            score: 50,
        });
        prospects.push(prospect);
        stored.push(await OutreachEmail.create({
            company,
            campaignId: campaign._id,
            prospectCompanyId: prospect._id,
            toEmail: email.toEmail,
            subject: "Anfrage Offerte",
            body: "Guten Tag",
            language: "de",
            status: email.status,
            attempts: email.status === "sent" ? 1 : 0,
        }));
    }
    return {campaign, prospects, emails: stored};
}
