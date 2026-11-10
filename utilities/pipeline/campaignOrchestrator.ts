import {Types, type FilterQuery} from "mongoose";
import {getLogger} from "@coreModule/loggers/serverLog";
import {nestedEntityToRef} from "@coreModule/utilities/mappers/common.mapper";
import Campaign, {ICampaign} from "@swissOutreachModule/database/schemas/campaign/campaign";
import type {IOutreachEmail} from "@swissOutreachModule/database/schemas/outreachEmail/outreachEmail";
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
import {incrementMetric} from "@swissOutreachModule/utilities/monitoring/metrics";
import {publishSwissOutreachPipelineEvent} from "@swissOutreachModule/kafka/kafkaProducer";
import {
    abortCampaign,
    CampaignCancelledError,
    clearCampaignAbort,
    getCampaignAbortSignal,
    throwIfCancelled,
} from "@swissOutreachModule/utilities/pipeline/cancellation";
import {ICompany} from "@coreModule/database/schemas/company/company";
import {mapWithConcurrency} from "@coreModule/utilities/helpers/mapWithConcurrency";

import {pipelineRunLogService} from "@swissOutreachModule/database/schemas/pipelineRunLog/pipelineRunLog.service";
import {outreachEmailService} from "@swissOutreachModule/database/schemas/outreachEmail/outreachEmail.service";
import {campaignService} from "@swissOutreachModule/database/schemas/campaign/campaign.service";
import {prospectCompanyService} from "@swissOutreachModule/database/schemas/prospectCompany/prospectCompany.service";
import {DO_NOT_CONTACT_SKIP_REASON, suppressedContactService} from "@swissOutreachModule/database/schemas/suppressedContact/suppressedContact.service";
import type {CampaignStatusValue} from "armonia/src/modules/swissOutreach/types/constants";
import {apiValidationException} from "armonia/src/modules/core/helpers/exceptions";
import {CONSTANTS} from "@coreModule/environment";
const logger = getLogger("swissOutreach.orchestrator");

const running = new Set<string>();

/** A run that reaches one of these (a redelivered Kafka event, a late retry) does nothing: the campaign is past its pipeline. */
const NOT_RUNNABLE: CampaignStatusValue[] = ["sending", "completed", "cancelled"];

async function logStep(
    companyId: Types.ObjectId | string | ICompany,
    campaignId: Types.ObjectId | string,
    step: string,
    message: string,
    level: "debug" | "info" | "warn" | "error" = "info",
    meta?: Record<string, unknown>,
): Promise<void> {
    logger[level === "error" ? "err" : level === "warn" ? "warn" : "info"](
        `[campaign=${campaignId}] ${step}: ${message}`,
    );
    await pipelineRunLogService.create({
        company: nestedEntityToRef(companyId),
        campaignId: new Types.ObjectId(String(campaignId)),
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

function errorText(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

export class CampaignOrchestrator {
    private readonly jobParser: JobParser;

    constructor(private readonly deps: OrchestratorDeps = createDefaultOrchestratorDeps()) {
        this.jobParser = new JobParser(deps.llm);
    }

    async cancel(campaignId: string): Promise<void> {
        abortCampaign(campaignId);
        const campaign = await campaignService.markCancelled(campaignId);
        running.delete(campaignId);
        // Un-claim in-flight sends so they are not stranded as queued.
        await outreachEmailService.updateMany({campaignId, status: "queued"}, {$set: {status: "approved"}}, {withDeleted: false});
        if (campaign) {
            await logStep(campaign.company, campaignId, "cancel", "Campaign cancelled by user", "warn");
        }
    }

    /**
     * Claims the campaign's run (it must still be in one of `from`, see `CampaignService.claimRun`) and queues it.
     * Returns the claimed campaign, or null when another trigger got it first or it is no longer in `from`.
     */
    async claimAndEnqueue(campaignId: string, from: CampaignStatusValue[], extra: FilterQuery<ICampaign> = {}): Promise<ICampaign | null> {
        const claimed = await campaignService.claimRun(campaignId, from, extra);
        if (claimed) this.enqueue(campaignId, claimed.company.toString());
        return claimed;
    }

    enqueue(campaignId: string, companyId?: string): void {
        if (running.has(campaignId)) return;
        incrementMetric("campaignsStarted");
        void (async () => {
            try {
                const campaign = await campaignService.findByIdLean(campaignId, "company status");
                if (!campaign || campaign.status === "completed" || campaign.status === "sending") {
                    return;
                }
                const resolvedCompanyId = companyId || String(campaign.company || "");
                clearCampaignAbort(campaignId);
                getCampaignAbortSignal(campaignId);

                if (getSwissOutreachConfig().useKafkaPipeline) {
                    const published = await publishSwissOutreachPipelineEvent({
                        campaignId,
                        companyId: resolvedCompanyId,
                        action: "run",
                    });
                    if (published) return;
                }

                await this.run(campaignId);
            } catch (err) {
                incrementMetric("pipelineErrors");
                logger.err(`enqueue failed for ${campaignId}: ${errorText(err)}`);
                await this.run(campaignId);
            }
        })();
    }

    /**
     * Claims the campaign's send (it must still be in one of `from`, see `CampaignService.claimSend`) and starts it off
     * the request. Returns the claimed campaign, or null when another send got it first or it is no longer in `from`.
     */
    async claimAndSend(campaignId: string, from: CampaignStatusValue[], extra: FilterQuery<ICampaign> = {}): Promise<ICampaign | null> {
        const claimed = await campaignService.claimSend(campaignId, from, extra);
        if (claimed) this.enqueueSend(campaignId, claimed.company.toString());
        return claimed;
    }

    /**
     * Sends a claimed campaign's approved emails in the background (BE-10): through the Kafka pipeline when it is on,
     * else (or when the publish fails) in this process. A send that breaks fails the campaign with its error, so it can
     * be sent again; emails it left `queued` go back to `approved` with the stuck-campaign cron.
     */
    enqueueSend(campaignId: string, companyId: string): void {
        void (async () => {
            try {
                if (getSwissOutreachConfig().useKafkaPipeline) {
                    const published = await publishSwissOutreachPipelineEvent({campaignId, companyId, action: "send_approved"}).catch((err: unknown) => {
                        logger.warn(`send_approved publish failed for ${campaignId}, sending in-process: ${errorText(err)}`);
                        return false;
                    });
                    if (published) return;
                }
                await this.sendApproved(campaignId);
            } catch (err) {
                incrementMetric("pipelineErrors");
                logger.err(`send failed for ${campaignId}: ${errorText(err)}`);
                await campaignService.updateOne({_id: campaignId, status: "sending"}, {$set: {status: "failed", lastError: errorText(err)}})
                    .catch((updateErr: unknown) => logger.err(`could not mark campaign ${campaignId} failed: ${errorText(updateErr)}`));
            }
        })();
    }

    async run(campaignId: string): Promise<void> {
        if (running.has(campaignId)) return;
        running.add(campaignId);
        const signal = getCampaignAbortSignal(campaignId);
        const campaign = await campaignService.findById(campaignId, {});
        if (!campaign || campaign.deletedAt || NOT_RUNNABLE.includes(campaign.status)) {
            running.delete(campaignId);
            return;
        }
        const companyId = campaign.company;
        try {
            await campaignService.updateOne({_id: campaign._id, status: {$ne: "cancelled"}}, {$set: {status: "parsing", lastError: undefined}});
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
                await campaignService.updateOne({_id: campaign._id, status: {$ne: "cancelled"}}, {$set: {status: "sending"}});
                await this.sendApproved(campaign._id.toString(), true);
            } else {
                await campaignService.updateOne({_id: campaign._id, status: {$ne: "cancelled"}}, {$set: {status: "awaiting_approval"}});
                await logStep(companyId, campaign._id, "approval", "Awaiting human approval");
            }
        } catch (err) {
            if (err instanceof CampaignCancelledError || (await this.isCancelled(campaignId))) {
                await campaignService.updateOne({_id: campaignId}, {$set: {status: "cancelled"}});
                await logStep(companyId, campaignId, "cancel", "Pipeline stopped after cancel", "warn");
                return;
            }
            incrementMetric("pipelineErrors");
            await campaignService.updateOne({_id: campaignId, status: {$ne: "cancelled"}}, {$set: {status: "failed", lastError: errorText(err)}});
            await logStep(companyId, campaign._id, "pipeline", errorText(err), "error");
        } finally {
            running.delete(campaignId);
            clearCampaignAbort(campaignId);
        }
    }

    private async isCancelled(campaignId: string): Promise<boolean> {
        const c = await campaignService.findByIdLean(campaignId, "status");
        return c?.status === "cancelled";
    }

    private async parseJob(campaign: ICampaign, signal: AbortSignal): Promise<void> {
        await throwIfCancelled(campaign._id.toString(), signal);
        await campaignService.updateOne({_id: campaign._id, status: {$ne: "cancelled"}}, {$set: {status: "parsing"}});
        await logStep(campaign.company, campaign._id, "job_parse", "Parsing job description");
        campaign.parsedJob = await this.jobParser.parse(campaign.jobDescription, campaign.language);
        await campaignService.updateOne({_id: campaign._id, status: {$ne: "cancelled"}}, {$set: {parsedJob: campaign.parsedJob}});
        await logStep(campaign.company, campaign._id, "job_parse", "Job parsed", "info", {
            industry: campaign.parsedJob.industry,
            keywords: campaign.parsedJob.keywords,
        });
    }

    private async searchCompanies(campaign: ICampaign, signal: AbortSignal): Promise<void> {
        await throwIfCancelled(campaign._id.toString(), signal);
        await campaignService.updateOne({_id: campaign._id, status: {$ne: "cancelled"}}, {$set: {status: "searching"}});
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
                await prospectCompanyService.insertIfNew(
                    {company: campaign.company, campaignId: campaign._id, dedupeKey},
                    {
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
                );
                created += 1;
            } catch (err) {
                await logStep(
                    campaign.company,
                    campaign._id,
                    "company_search",
                    `Skip duplicate/failed insert ${hit.companyName}: ${errorText(err)}`,
                    "warn",
                );
            }
        }

        const foundCount = await prospectCompanyService.count({
            company: campaign.company,
            campaignId: campaign._id,
        }, {withDeleted: false});
        incrementMetric("companiesDiscovered", foundCount);
        await campaignService.updateOne({_id: campaign._id, status: {$ne: "cancelled"}}, {$set: {"stats.found": foundCount}});
        await logStep(
            campaign.company,
            campaign._id,
            "company_search",
            `Stored ${created} companies (total ${foundCount})`,
        );
    }

    private async enrichProspects(campaign: ICampaign, signal: AbortSignal): Promise<void> {
        await throwIfCancelled(campaign._id.toString(), signal);
        await campaignService.updateOne({_id: campaign._id, status: {$ne: "cancelled"}}, {$set: {status: "enriching"}});
        const config = getSwissOutreachConfig();
        const prospects = await prospectCompanyService.find({
            company: campaign.company,
            campaignId: campaign._id,
        }, {withDeleted: false});

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
            } catch (err) {
                if (err instanceof CampaignCancelledError) throw err;
                prospect.status = "failed";
                await prospect.save();
                failed += 1;
                await logStep(
                    campaign.company,
                    campaign._id,
                    "enrich",
                    `Failed ${prospect.companyName}: ${errorText(err)}`,
                    "warn",
                );
            }
        });

        await campaignService.updateOne({_id: campaign._id, status: {$ne: "cancelled"}}, {
                $set: {
                    status: "scoring",
                    "stats.enriched": enriched,
                    "stats.scored": scored,
                },
                $inc: {"stats.failed": failed},
            });
        await logStep(campaign.company, campaign._id, "enrich", `Enriched ${enriched}, scored ${scored}`);
    }

    private async prepareEmails(campaign: ICampaign, signal: AbortSignal): Promise<void> {
        await throwIfCancelled(campaign._id.toString(), signal);
        const prospects = await prospectCompanyService.find({
            company: campaign.company,
            campaignId: campaign._id,
            status: {$in: ["scored", "crawled", "website_found"]},
        }, {withDeleted: false}, undefined, undefined, {score: -1});
        // The company's do-not-contact list covers every campaign: listed addresses are never drafted to.
        const suppressed = await suppressedContactService.suppressedAmong(campaign.company, prospects.flatMap((prospect) => prospect.emails || []));
        let suppressedProspects = 0;

        for (const prospect of prospects) {
            await throwIfCancelled(campaign._id.toString(), signal);
            const existing = await outreachEmailService.findOne({
                company: campaign.company,
                campaignId: campaign._id,
                prospectCompanyId: prospect._id,
            }, {withDeleted: false}, undefined, "status");
            // Preserve human edits and anything already in the send pipeline.
            if (existing && !["draft"].includes(existing.status)) {
                continue;
            }

            const addresses = prospect.emails || [];
            const reachable = addresses.filter((address) => !suppressed.has(address.trim().toLowerCase()));
            if (addresses.length > 0 && reachable.length === 0) {
                // Every address it has asked not to be contacted: no draft, and an earlier draft is set aside.
                suppressedProspects += 1;
                await prospectCompanyService.updateOne({_id: prospect._id}, {$set: {status: "skipped"}});
                if (existing) await outreachEmailService.updateOne({_id: existing._id, status: "draft"}, {$set: {status: "skipped"}});
                continue;
            }
            const toEmail = preferContactEmail(reachable);
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

            await outreachEmailService.upsertDraft(
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
            );
        }
        const drafted = prospects.length - suppressedProspects;
        await logStep(campaign.company, campaign._id, "email_generate", `Drafted emails for ${drafted} prospects${suppressedProspects > 0 ? `; ${suppressedProspects} on the do-not-contact list skipped` : ""}`);
        incrementMetric("emailsDrafted", drafted);
    }

    /**
     * Sends the approved emails of a campaign claimed for sending (`claimAndSend`, or the pipeline's automatic send).
     * Does nothing unless the campaign is `sending`, so a redelivered or late send event finds it finished and stops.
     * Successful sends are spaced by the configured rate; every send writes the campaign, which shows the progress
     * and tells the stuck-campaign cron the send is alive.
     */
    async sendApproved(campaignId: string, autoApproved = false): Promise<{sent: number; failed: number}> {
        const campaign = await campaignService.findById(campaignId, {});
        if (!campaign) throw apiValidationException("campaign_not_found", "campaignId", null, CONSTANTS.DEFAULT_LANGUAGE);
        if (campaign.status !== "sending") return {sent: 0, failed: 0};
        const config = getSwissOutreachConfig();
        // Each send gets the whole retry budget; `attempts` counts every try the email ever had.
        const triesPerSend = Math.max(1, config.retryCount);
        const sendGapMs = Math.ceil(60000 / config.maxSendsPerMinute);
        const signal = getCampaignAbortSignal(campaignId);

        let sent = 0;
        let failed = 0;
        let lastSentAt: number | null = null;
        let claimed: IOutreachEmail | null = null;

        try {
            while (true) {
                // Throttle: no email is claimed until the gap after the last successful send has passed.
                const wait = lastSentAt === null ? 0 : lastSentAt + sendGapMs - Date.now();
                if (wait > 0) await sleep(wait);
                await throwIfCancelled(campaignId, signal);
                const claimFilter = autoApproved
                    ? {
                          company: campaign.company,
                          campaignId: campaign._id,
                          status: {$in: ["approved", "draft"]},
                          toEmail: {$type: "string"},
                      }
                    : {
                          company: campaign.company,
                          campaignId: campaign._id,
                          status: "approved",
                          toEmail: {$type: "string"},
                      };

                // Claiming counts the first try.
                const email: IOutreachEmail | null = await outreachEmailService.claimNext(claimFilter);
                if (!email) break;
                claimed = email;

                // Checked at send time too: the address may have gone on the list after the email was approved.
                if ((await suppressedContactService.suppressedAmong(campaign.company, [email.toEmail!])).size > 0) {
                    email.status = "skipped";
                    email.lastError = DO_NOT_CONTACT_SKIP_REASON;
                    await email.save();
                    await prospectCompanyService.updateOne({_id: email.prospectCompanyId}, {$set: {status: "skipped"}});
                    claimed = null;
                    continue;
                }

                let success = false;
                let lastError = "";
                for (let tryNumber = 1; tryNumber <= triesPerSend; tryNumber++) {
                    await throwIfCancelled(campaignId, signal);
                    if (tryNumber > 1) email.attempts += 1;
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
                        email.lastError = undefined;
                        await email.save();
                        await prospectCompanyService.updateOne({_id: email.prospectCompanyId}, {$set: {status: "sent"}});
                        await campaignService.updateOne({_id: campaign._id}, {$inc: {"stats.sent": 1}});
                        sent += 1;
                        lastSentAt = Date.now();
                        success = true;
                        incrementMetric("emailsSent");
                        break;
                    } catch (err) {
                        lastError = errorText(err);
                        await sleep(config.requestDelayMs * tryNumber);
                    }
                }
                if (!success) {
                    email.status = "failed";
                    email.lastError = lastError || email.lastError;
                    await email.save();
                    failed += 1;
                    await campaignService.updateOne({_id: campaign._id}, {$inc: {"stats.failed": 1}});
                    incrementMetric("emailsFailed");
                }
                claimed = null;
            }
        } catch (err) {
            if (!(err instanceof CampaignCancelledError)) throw err;
            // Cancelled mid-send: the email in hand goes back to approved, and what was sent is still counted.
            if (claimed) {
                await outreachEmailService.updateOne({_id: claimed._id, status: "queued"}, {$set: {status: "approved"}});
            }
        }

        const approved = await outreachEmailService.count({
            campaignId: campaign._id,
            status: {$in: ["approved", "sent", "queued"]},
        });
        if (await this.isCancelled(campaignId)) {
            await campaignService.updateOne({_id: campaign._id}, {$set: {"stats.approved": approved}});
        } else {
            await campaignService.updateOne({_id: campaign._id, status: {$ne: "cancelled"}}, {
                    $set: {
                        status: failed > 0 && sent === 0 ? "failed" : "completed",
                        "stats.approved": approved,
                    },
                });
        }
        await logStep(campaign.company, campaign._id, "send", `Sent ${sent}, failed ${failed}`);
        return {sent, failed};
    }

    /** Whether this process is running the campaign's pipeline right now. */
    isRunning(campaignId: string): boolean {
        return running.has(campaignId);
    }
}

export const campaignOrchestrator = new CampaignOrchestrator();
