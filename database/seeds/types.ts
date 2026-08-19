/**
 * Row shapes for the exported swissOutreach seeds.
 *
 * Reference encoding, matching `propertyManagement/database/seeds/operations/types.ts`:
 *  - A bare hex string is a **preserved ObjectId** for a swissOutreach-internal document
 *    (campaign, prospect company). The whole graph keeps its original ids, so the
 *    campaign → prospect → e-mail links need no remapping between runs.
 *  - Nothing here points outside the module, so there are no business keys to resolve.
 *  - Dates are ISO strings; `createdAt` / `updatedAt` are not exported (injected at
 *    seed time).
 *
 * Every prospect company in these seeds is **invented**. The live rows were real Swiss
 * register entries; see `tools/genSwissOutreach.js` in the seed-handoff bundle.
 */

/** A preserved ObjectId hex string. */
export type PreservedId = string;

/** Mirrors `ParsedJob` in armonia — carried through verbatim as the schema stores it. */
export type ParsedJobSeed = {
    industry: string;
    companyTypes: string[];
    synonyms: string[];
    germanEquivalents: string[];
    frenchEquivalents: string[];
    italianEquivalents: string[];
    nogaCategories: string[];
    keywords: string[];
};

export type CampaignStatsSeed = {
    found: number;
    enriched: number;
    scored: number;
    approved: number;
    sent: number;
    failed: number;
};

export type CampaignSeedRow = {
    id: PreservedId;
    jobDescription: string;
    country: string;
    /** Two-letter canton codes; `[]` means "search the whole country". */
    cantons: string[];
    maxCompanies: number;
    /** de | fr | it | en */
    language: string;
    /** professional | friendly | formal */
    emailTone: string;
    sendAutomatically: boolean;
    senderCompanyName: string;
    senderName: string;
    senderEmail: string;
    senderPhone?: string;
    senderWebsite?: string;
    additionalNotes?: string;
    /** draft | parsing | searching | enriching | scoring | awaiting_approval | sending | completed | failed | cancelled */
    status: string;
    parsedJob?: ParsedJobSeed;
    stats: CampaignStatsSeed;
    lastError?: string;
};

export type ProspectCompanySeedRow = {
    id: PreservedId;
    campaign: PreservedId;
    companyName: string;
    uid?: string;
    /** Unique per `{company, campaign}` — the UID when there is one. */
    dedupeKey: string;
    canton?: string;
    legalForm?: string;
    registerUrl?: string;
    website?: string;
    websiteConfidence?: number;
    emails: string[];
    phones: string[];
    city?: string;
    postalCode?: string;
    languages: string[];
    summary?: string;
    services: string[];
    score?: number;
    scoreReason?: string;
    /** discovered | website_found | crawled | scored | skipped | approved | sent | failed */
    status: string;
};

export type OutreachEmailSeedRow = {
    id: PreservedId;
    campaign: PreservedId;
    prospectCompany: PreservedId;
    toEmail?: string;
    subject: string;
    body: string;
    /** de | fr | it | en */
    language: string;
    /** draft | edited | approved | skipped | queued | sent | failed */
    status: string;
    messageId?: string;
    sentAt?: string;
    attempts: number;
    lastError?: string;
};
