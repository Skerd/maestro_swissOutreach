import {ObjectId} from "mongodb";
import OutreachEmail from "./outreachEmail";
import {getLogger, serverLogger} from "@coreModule/loggers/serverLog";
import {ICompany} from "@coreModule/database/schemas/company/company";
import {outreachEmailsSeed} from "@swissOutreachModule/database/seeds/outreachEmails.seed";
import type {
    OutreachEmailStatusValue,
    OutreachLanguageValue,
} from "armonia/src/modules/swissOutreach/types/constants";

export {outreachEmailsSeed as defaultOutreachEmails};

/**
 * Seeds the generated e-mail drafts — one per prospect, all still `draft`, which is
 * what puts the two live campaigns in `awaiting_approval`.
 *
 * `toEmail` is absent throughout (no contact address was ever found), which also keeps
 * the partial unique index on `{company, campaignId, toEmail}` out of play.
 */
export async function createOutreachEmails(
    parentLogger: serverLogger,
    company: ICompany,
    campaignIds: Map<string, ObjectId>,
    prospectIds: Map<string, ObjectId>,
): Promise<Map<string, ObjectId>> {
    const logger = getLogger("mongoDbInitialization-createOutreachEmails", parentLogger);
    logger.start(`Creating Swiss outreach e-mails (${outreachEmailsSeed.length})...`);

    const created = new Map<string, ObjectId>();

    for (const row of outreachEmailsSeed) {
        try {
            const campaignId = campaignIds.get(row.campaign);
            const prospectCompanyId = prospectIds.get(row.prospectCompany);
            if (!campaignId || !prospectCompanyId) {
                logger.warn(
                    `Skipping outreach e-mail ${row.id} — campaign or prospect company did not seed.`,
                );
                continue;
            }

            const emailId = new ObjectId(row.id);
            const payload = {
                campaignId,
                prospectCompanyId,
                ...(row.toEmail ? {toEmail: row.toEmail} : {}),
                subject: row.subject,
                body: row.body,
                language: row.language as OutreachLanguageValue,
                status: row.status as OutreachEmailStatusValue,
                ...(row.messageId ? {messageId: row.messageId} : {}),
                ...(row.sentAt ? {sentAt: new Date(row.sentAt)} : {}),
                attempts: row.attempts,
                ...(row.lastError ? {lastError: row.lastError} : {}),
                company: company._id,
                createdBy: company.createdBy,
            };

            const existing = await OutreachEmail.findById(emailId);
            if (existing) {
                existing.set(payload);
                await existing.save();
            } else {
                await OutreachEmail.create({_id: emailId, ...payload});
            }

            created.set(row.id, emailId);
        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : String(e);
            logger.err(`Error creating outreach e-mail ${row.id}: ${message}`);
        }
    }

    logger.finish("Finished creating Swiss outreach e-mails!", created.size);
    return created;
}
