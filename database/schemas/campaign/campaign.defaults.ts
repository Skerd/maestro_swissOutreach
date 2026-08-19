import {ObjectId} from "mongodb";
import Campaign from "./campaign";
import {getLogger, serverLogger} from "@coreModule/loggers/serverLog";
import {ICompany} from "@coreModule/database/schemas/company/company";
import {campaignsSeed} from "@swissOutreachModule/database/seeds/campaigns.seed";
import type {
    CampaignStatusValue,
    EmailToneValue,
    OutreachLanguageValue,
} from "armonia/src/modules/swissOutreach/types/constants";

export {campaignsSeed as defaultCampaigns};

/**
 * Seeds the three outreach campaigns the panel demos: a cancelled run, and two that
 * stopped at `awaiting_approval` with drafted e-mails waiting for a decision.
 *
 * Ids are preserved so prospects and e-mails link up without remapping.
 */
export async function createCampaigns(
    parentLogger: serverLogger,
    company: ICompany,
): Promise<Map<string, ObjectId>> {
    const logger = getLogger("mongoDbInitialization-createCampaigns", parentLogger);
    logger.start(`Creating Swiss outreach campaigns (${campaignsSeed.length})...`);

    const created = new Map<string, ObjectId>();

    for (const row of campaignsSeed) {
        try {
            const campaignId = new ObjectId(row.id);
            const payload = {
                jobDescription: row.jobDescription,
                country: row.country,
                cantons: [...row.cantons],
                maxCompanies: row.maxCompanies,
                language: row.language as OutreachLanguageValue,
                emailTone: row.emailTone as EmailToneValue,
                sendAutomatically: row.sendAutomatically,
                senderCompanyName: row.senderCompanyName,
                senderName: row.senderName,
                senderEmail: row.senderEmail,
                ...(row.senderPhone ? {senderPhone: row.senderPhone} : {}),
                ...(row.senderWebsite ? {senderWebsite: row.senderWebsite} : {}),
                ...(row.additionalNotes ? {additionalNotes: row.additionalNotes} : {}),
                status: row.status as CampaignStatusValue,
                ...(row.parsedJob ? {parsedJob: row.parsedJob} : {}),
                stats: {...row.stats},
                ...(row.lastError ? {lastError: row.lastError} : {}),
                company: company._id,
                createdBy: company.createdBy,
            };

            const existing = await Campaign.findById(campaignId);
            if (existing) {
                existing.set(payload);
                await existing.save();
            } else {
                await Campaign.create({_id: campaignId, ...payload});
            }

            created.set(row.id, campaignId);
        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : String(e);
            logger.err(`Error creating campaign ${row.id}: ${message}`);
        }
    }

    logger.finish("Finished creating Swiss outreach campaigns!", created.size);
    return created;
}
