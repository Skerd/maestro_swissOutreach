import {Types} from "mongoose";
import {getLogger} from "@coreModule/loggers/serverLog";
import Campaign, {ICampaign} from "@swissOutreachModule/database/schemas/campaign/campaign";
import ProspectCompany from "@swissOutreachModule/database/schemas/prospectCompany/prospectCompany";
import OutreachEmail from "@swissOutreachModule/database/schemas/outreachEmail/outreachEmail";
import PipelineRunLog from "@swissOutreachModule/database/schemas/pipelineRunLog/pipelineRunLog";
import type {
    CompanyRegistryPort,
    LlmPort,
    MailPort,
    WebsiteFetchPort,
} from "@swissOutreachModule/utilities/ports";
import {JobParser} from "@swissOutreachModule/utilities/pipeline/jobParser";
import {
    generateOutreachEmail,
    summarizeCompany,
} from "@swissOutreachModule/utilities/pipeline/emailGenerator";
import {
    buildDedupeKey,
    scoreProspect,
} from "@swissOutreachModule/utilities/scoring/scoreProspect";
import {preferContactEmail} from "@swissOutreachModule/utilities/adapters/contactExtractor";
import {getSwissOutreachConfig} from "@swissOutreachModule/utilities/config";
import {createSwissOutreachPorts} from "@swissOutreachModule/utilities/adapters/createPorts";
import {mapWithConcurrency} from "@swissOutreachModule/utilities/pipeline/concurrency";
import {incrementMetric} from "@swissOutreachModule/utilities/monitoring/metrics";
import {publishSwissOutreachPipelineEvent} from "@swissOutreachModule/kafka/kafkaProducer";
import {
    abortCampaign,
    CampaignCancelledError,
    clearCampaignAbort,
    getCampaignAbortSignal,
    throwIfCancelled,
} from "@swissOutreachModule/utilities/pipeline/cancellation";

const logger = getLogger("swissOutreach.orchestrator");

const running = new Set<string>();

async function logStep(
    companyId: Types.ObjectId | string,
    campaignId: Types.ObjectId | string,
    step: string,
    message: string,
    level: "debug" | "info" | "warn" | "error" = "info",
    meta?: Record<string, unknown>,
): Promise<void> {
    logger[level === "error" ? "err" : level === "warn" ? "warn" : "info"](
        `[campaign=${campaignId}] ${step}: ${message}`,
    );
    await PipelineRunLog.create({
        company: companyId,
        campaignId,
        step,
        level,
        message,
        meta,
    });
}

export type OrchestratorDeps = {
    registry: CompanyRegistryPort;
    llm: LlmPort;
    website: WebsiteFetchPort;
    mail: MailPort;
};

export function createDefaultOrchestratorDeps(): OrchestratorDeps {
    const ports = createSwissOutreachPorts();
    return {
        registry: ports.registry,
        llm: ports.llm,
        website: ports.website,
        mail: ports.mail,
    };
}

function sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
}

export class CampaignOrchestrator {
    private readonly jobParser: JobParser;

    constructor(private readonly deps: OrchestratorDeps = createDefaultOrchestratorDeps()) {
        this.jobParser = new JobParser(deps.llm);
    }

    async cancel(campaignId: string): Promise<void> {
        abortCampaign(campaignId);
        const campaign = await Campaign.findByIdAndUpdate(
            campaignId,
            {$set: {status: "cancelled"}},
            {new: true},
        );
        running.delete(campaignId);
        // Un-claim in-flight sends so they are not stranded as queued.
        await OutreachEmail.updateMany(
            {campaignId, deletedAt: null, status: "queued"},
            {$set: {status: "approved"}},
        );
        if (campaign) {
            await logStep(campaign.company, campaignId, "cancel", "Campaign cancelled by user", "warn");
        }
    }

    enqueue(campaignId: string, companyId?: string): void {
        if (running.has(campaignId)) return;
        incrementMetric("campaignsStarted");
        void (async () => {
            try {
                const campaign = await Campaign.findById(campaignId).select("company status").lean();
                if (!campaign || campaign.status === "completed" || campaign.status === "sending") {
                    return;
                }
                const resolvedCompanyId = companyId || String(campaign.company || "");
                clearCampaignAbort(campaignId);
                getCampaignAbortSignal(campaignId);

                // Kafka is opt-in. When KAFKA_ENABLED alone is true, publish can succeed while
                // no consumer processes the event — campaigns stay stuck in `draft`.
                const useKafkaPipeline = process.env.SWISS_OUTREACH_USE_KAFKA_PIPELINE === "true";
                if (useKafkaPipeline) {
                    const published = await publishSwissOutreachPipelineEvent({
                        campaignId,
                        companyId: resolvedCompanyId,
                        action: "run",
                    });
                    if (published) return;
                }

                await this.run(campaignId);
            } catch (err: any) {
                incrementMetric("pipelineErrors");
                logger.err(`enqueue failed for ${campaignId}: ${err?.message || err}`);
                await this.run(campaignId);
            }
        })();
    }

    async run(campaignId: string): Promise<void> {
        if (running.has(campaignId)) return;
        running.add(campaignId);
        const signal = getCampaignAbortSignal(campaignId);
        const campaign = await Campaign.findById(campaignId);
        if (!campaign || campaign.deletedAt || campaign.status === "cancelled") {
            running.delete(campaignId);
            return;
        }
        const companyId = campaign.company;
        try {
            await Campaign.updateOne(
                {_id: campaign._id, status: {$ne: "cancelled"}},
                {$set: {status: "parsing", lastError: undefined}},
            );
            await logStep(
                companyId,
                campaign._id,
                "pipeline",
                "Pipeline started — parsing job, searching companies, enriching, drafting emails",
            );

            await this.parseJob(campaign, signal);
            await this.searchCompanies(campaign, signal);
            await this.enrichProspects(campaign, signal);
            await this.prepareEmails(campaign, signal);

            if (await this.isCancelled(campaignId)) return;

            if (campaign.sendAutomatically) {
                await Campaign.updateOne(
                    {_id: campaign._id, status: {$ne: "cancelled"}},
                    {$set: {status: "sending"}},
                );
                await this.sendApproved(campaign._id.toString(), true);
            } else {
                await Campaign.updateOne(
                    {_id: campaign._id, status: {$ne: "cancelled"}},
                    {$set: {status: "awaiting_approval"}},
                );
                await logStep(companyId, campaign._id, "approval", "Awaiting human approval");
            }
        } catch (err: any) {
            if (err instanceof CampaignCancelledError || (await this.isCancelled(campaignId))) {
                await Campaign.updateOne({_id: campaignId}, {$set: {status: "cancelled"}});
                await logStep(companyId, campaignId, "cancel", "Pipeline stopped after cancel", "warn");
                return;
            }
            incrementMetric("pipelineErrors");
            await Campaign.updateOne(
                {_id: campaignId, status: {$ne: "cancelled"}},
                {$set: {status: "failed", lastError: err?.message || String(err)}},
            );
            await logStep(companyId, campaign._id, "pipeline", err?.message || String(err), "error");
        } finally {
            running.delete(campaignId);
            clearCampaignAbort(campaignId);
        }
    }

    private async isCancelled(campaignId: string): Promise<boolean> {
        const c = await Campaign.findById(campaignId).select("status").lean();
        return c?.status === "cancelled";
    }

    private async parseJob(campaign: ICampaign, signal: AbortSignal): Promise<void> {
        await throwIfCancelled(campaign._id.toString(), signal);
        await Campaign.updateOne({_id: campaign._id, status: {$ne: "cancelled"}}, {$set: {status: "parsing"}});
        await logStep(campaign.company, campaign._id, "job_parse", "Parsing job description");
        campaign.parsedJob = await this.jobParser.parse(campaign.jobDescription, campaign.language);
        await Campaign.updateOne(
            {_id: campaign._id, status: {$ne: "cancelled"}},
            {$set: {parsedJob: campaign.parsedJob}},
        );
        await logStep(campaign.company, campaign._id, "job_parse", "Job parsed", "info", {
            industry: campaign.parsedJob.industry,
            keywords: campaign.parsedJob.keywords,
        });
    }

    private async searchCompanies(campaign: ICampaign, signal: AbortSignal): Promise<void> {
        await throwIfCancelled(campaign._id.toString(), signal);
        await Campaign.updateOne({_id: campaign._id, status: {$ne: "cancelled"}}, {$set: {status: "searching"}});
        const config = getSwissOutreachConfig();
        const keywords = [
            ...(campaign.parsedJob?.keywords || []),
            ...(campaign.parsedJob?.germanEquivalents || []),
            ...(campaign.parsedJob?.frenchEquivalents || []),
            ...(campaign.parsedJob?.italianEquivalents || []),
        ];
        await logStep(campaign.company, campaign._id, "company_search", "Searching ZEFIX", "info", {
            keywords,
            cantons: campaign.cantons,
        });

        const found = await this.deps.registry.search({
            keywords,
            cantons: campaign.cantons || [],
            maxResults: campaign.maxCompanies || config.maxCompaniesDefault,
            language: campaign.language,
        });

        let created = 0;
        for (const hit of found) {
            await throwIfCancelled(campaign._id.toString(), signal);
            const dedupeKey = buildDedupeKey(hit.uid, hit.companyName, hit.canton);
            try {
                await ProspectCompany.findOneAndUpdate(
                    {company: campaign.company, campaignId: campaign._id, dedupeKey},
                    {
                        $setOnInsert: {
                            company: campaign.company,
                            campaignId: campaign._id,
                            companyName: hit.companyName,
                            uid: hit.uid,
                            canton: hit.canton,
                            legalForm: hit.legalForm,
                            registerUrl: hit.registerUrl,
                            dedupeKey,
                            status: "discovered",
                            emails: [],
                            phones: [],
                            languages: [],
                            services: [],
                        },
                    },
                    {upsert: true, new: true},
                );
                created += 1;
            } catch (err: any) {
                await logStep(
                    campaign.company,
                    campaign._id,
                    "company_search",
                    `Skip duplicate/failed insert ${hit.companyName}: ${err?.message || err}`,
                    "warn",
                );
            }
        }

        const foundCount = await ProspectCompany.countDocuments({
            company: campaign.company,
            campaignId: campaign._id,
            deletedAt: null,
        });
        incrementMetric("companiesDiscovered", foundCount);
        await Campaign.updateOne(
            {_id: campaign._id, status: {$ne: "cancelled"}},
            {$set: {"stats.found": foundCount}},
        );
        await logStep(
            campaign.company,
            campaign._id,
            "company_search",
            `Stored ${created} companies (total ${foundCount})`,
        );
    }

    private async enrichProspects(campaign: ICampaign, signal: AbortSignal): Promise<void> {
        await throwIfCancelled(campaign._id.toString(), signal);
        await Campaign.updateOne({_id: campaign._id, status: {$ne: "cancelled"}}, {$set: {status: "enriching"}});
        const config = getSwissOutreachConfig();
        const prospects = await ProspectCompany.find({
            company: campaign.company,
            campaignId: campaign._id,
            deletedAt: null,
        });

        let enriched = 0;
        let scored = 0;
        let failed = 0;

        await mapWithConcurrency(prospects, config.concurrency, async (prospect) => {
            try {
                await throwIfCancelled(campaign._id.toString(), signal);
                await sleep(config.requestDelayMs);
                const discovery = await this.deps.website.discoverWebsite(
                    prospect.companyName,
                    prospect.canton,
                );
                if (discovery.url) {
                    prospect.website = discovery.url;
                    prospect.websiteConfidence = discovery.confidence;
                    prospect.status = "website_found";
                    incrementMetric("websitesFound");
                }

                let crawlText = "";
                if (prospect.website) {
                    const crawl = await this.deps.website.crawl(prospect.website, signal);
                    prospect.emails = crawl.emails;
                    prospect.phones = crawl.phones;
                    prospect.city = crawl.city || prospect.city;
                    prospect.postalCode = crawl.postalCode || prospect.postalCode;
                    prospect.languages = crawl.languages;
                    prospect.services = crawl.services;
                    crawlText = crawl.textBlob;
                    prospect.status = "crawled";
                }

                prospect.summary = await summarizeCompany(this.deps.llm, {
                    companyName: prospect.companyName,
                    legalForm: prospect.legalForm,
                    canton: prospect.canton,
                    websiteText: crawlText || prospect.companyName,
                    services: prospect.services || [],
                });

                const {score, reason} = scoreProspect({
                    website: prospect.website,
                    websiteConfidence: prospect.websiteConfidence,
                    emails: prospect.emails || [],
                    services: prospect.services || [],
                    canton: prospect.canton,
                    campaignCantons: campaign.cantons || [],
                    summary: prospect.summary,
                    languages: prospect.languages || [],
                    campaignLanguage: campaign.language,
                    keywords: campaign.parsedJob?.keywords || [],
                    textBlob: crawlText,
                });
                prospect.score = score;
                prospect.scoreReason = reason;
                prospect.status = "scored";
                await prospect.save();
                enriched += 1;
                scored += 1;
            } catch (err: any) {
                if (err instanceof CampaignCancelledError) throw err;
                prospect.status = "failed";
                await prospect.save();
                failed += 1;
                await logStep(
                    campaign.company,
                    campaign._id,
                    "enrich",
                    `Failed ${prospect.companyName}: ${err?.message || err}`,
                    "warn",
                );
            }
        });

        await Campaign.updateOne(
            {_id: campaign._id, status: {$ne: "cancelled"}},
            {
                $set: {
                    status: "scoring",
                    "stats.enriched": enriched,
                    "stats.scored": scored,
                },
                $inc: {"stats.failed": failed},
            },
        );
        await logStep(campaign.company, campaign._id, "enrich", `Enriched ${enriched}, scored ${scored}`);
    }

    private async prepareEmails(campaign: ICampaign, signal: AbortSignal): Promise<void> {
        await throwIfCancelled(campaign._id.toString(), signal);
        const prospects = await ProspectCompany.find({
            company: campaign.company,
            campaignId: campaign._id,
            deletedAt: null,
            status: {$in: ["scored", "crawled", "website_found"]},
        }).sort({score: -1});

        for (const prospect of prospects) {
            await throwIfCancelled(campaign._id.toString(), signal);
            const existing = await OutreachEmail.findOne({
                company: campaign.company,
                campaignId: campaign._id,
                prospectCompanyId: prospect._id,
                deletedAt: null,
            }).select("status");
            // Preserve human edits and anything already in the send pipeline.
            if (existing && !["draft"].includes(existing.status)) {
                continue;
            }

            const toEmail = preferContactEmail(prospect.emails || []);
            const draft = await generateOutreachEmail(this.deps.llm, {
                language: campaign.language,
                emailTone: campaign.emailTone,
                jobDescription: campaign.jobDescription,
                companySummary: prospect.summary || "",
                services: prospect.services || [],
                companyName: prospect.companyName,
                senderCompanyName: campaign.senderCompanyName,
                senderName: campaign.senderName,
                senderEmail: campaign.senderEmail,
                senderPhone: campaign.senderPhone,
                senderWebsite: campaign.senderWebsite,
                additionalNotes: campaign.additionalNotes,
            });

            await OutreachEmail.findOneAndUpdate(
                {
                    company: campaign.company,
                    campaignId: campaign._id,
                    prospectCompanyId: prospect._id,
                },
                {
                    $set: {
                        toEmail,
                        subject: draft.subject,
                        body: draft.body,
                        language: campaign.language,
                        status: campaign.sendAutomatically && toEmail ? "approved" : "draft",
                    },
                    $setOnInsert: {
                        company: campaign.company,
                        campaignId: campaign._id,
                        prospectCompanyId: prospect._id,
                        attempts: 0,
                    },
                },
                {upsert: true},
            );
        }
        await logStep(campaign.company, campaign._id, "email_generate", `Drafted emails for ${prospects.length} prospects`);
        incrementMetric("emailsDrafted", prospects.length);
    }

    async sendApproved(campaignId: string, autoApproved = false): Promise<{sent: number; failed: number}> {
        const campaign = await Campaign.findById(campaignId);
        if (!campaign) throw new Error("Campaign not found");
        if (campaign.status === "cancelled") return {sent: 0, failed: 0};
        const config = getSwissOutreachConfig();
        const signal = getCampaignAbortSignal(campaignId);

        await Campaign.updateOne(
            {_id: campaign._id, status: {$ne: "cancelled"}},
            {$set: {status: "sending"}},
        );

        let sent = 0;
        let failed = 0;

        while (true) {
            await throwIfCancelled(campaignId, signal);
            const claimFilter = autoApproved
                ? {
                      company: campaign.company,
                      campaignId: campaign._id,
                      deletedAt: null,
                      status: {$in: ["approved", "draft"]},
                      toEmail: {$type: "string"},
                  }
                : {
                      company: campaign.company,
                      campaignId: campaign._id,
                      deletedAt: null,
                      status: "approved",
                      toEmail: {$type: "string"},
                  };

            const email = await OutreachEmail.findOneAndUpdate(
                claimFilter,
                {$set: {status: "queued"}, $inc: {attempts: 1}},
                {new: true},
            );
            if (!email) break;

            let success = false;
            let lastError = "";
            for (let attempt = email.attempts; attempt <= config.retryCount; attempt++) {
                await throwIfCancelled(campaignId, signal);
                try {
                    const result = await this.deps.mail.send({
                        companyId: campaign.company.toString(),
                        to: email.toEmail!,
                        subject: email.subject,
                        text: email.body,
                        fromEmail: campaign.senderEmail,
                        fromName: campaign.senderName,
                    });
                    email.status = "sent";
                    email.sentAt = new Date();
                    email.messageId = result.messageId;
                    email.attempts = attempt;
                    email.lastError = undefined;
                    await email.save();
                    await ProspectCompany.updateOne({_id: email.prospectCompanyId}, {$set: {status: "sent"}});
                    sent += 1;
                    success = true;
                    incrementMetric("emailsSent");
                    break;
                } catch (err: any) {
                    lastError = err?.message || String(err);
                    email.attempts = attempt;
                    await sleep(config.requestDelayMs * attempt);
                }
            }
            if (!success) {
                email.status = "failed";
                email.lastError = lastError;
                await email.save();
                failed += 1;
                await Campaign.updateOne({_id: campaign._id}, {$inc: {"stats.failed": 1}});
                incrementMetric("emailsFailed");
            }
        }

        const approved = await OutreachEmail.countDocuments({
            campaignId: campaign._id,
            status: {$in: ["approved", "sent", "queued"]},
        });
        if (!(await this.isCancelled(campaignId))) {
            await Campaign.updateOne(
                {_id: campaign._id, status: {$ne: "cancelled"}},
                {
                    $set: {
                        status: failed > 0 && sent === 0 ? "failed" : "completed",
                        "stats.approved": approved,
                    },
                    $inc: {"stats.sent": sent},
                },
            );
        }
        await logStep(campaign.company, campaign._id, "send", `Sent ${sent}, failed ${failed}`);
        return {sent, failed};
    }
}

export const campaignOrchestrator = new CampaignOrchestrator();
