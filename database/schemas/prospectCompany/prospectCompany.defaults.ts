import {ObjectId} from "mongodb";
import ProspectCompany from "./prospectCompany";
import {getLogger, serverLogger} from "@coreModule/loggers/serverLog";
import {ICompany} from "@coreModule/database/schemas/company/company";
import {prospectCompaniesSeed} from "@swissOutreachModule/database/seeds/prospectCompanies.seed";
import type {ProspectStatusValue} from "armonia/src/modules/swissOutreach/types/constants";

export {prospectCompaniesSeed as defaultProspectCompanies};

/**
 * Seeds the prospect companies each campaign discovered, at the `scored` stage the
 * live pipeline left them in.
 *
 * Every company is invented — see `seeds/types.ts`. No e-mails or phone numbers are
 * carried: the live pipeline never managed to scrape any, and the panel is expected to
 * render that gap.
 */
export async function createProspectCompanies(
    parentLogger: serverLogger,
    company: ICompany,
    campaignIds: Map<string, ObjectId>,
): Promise<Map<string, ObjectId>> {
    const logger = getLogger("mongoDbInitialization-createProspectCompanies", parentLogger);
    logger.start(`Creating Swiss outreach prospect companies (${prospectCompaniesSeed.length})...`);

    const created = new Map<string, ObjectId>();

    for (const row of prospectCompaniesSeed) {
        try {
            const campaignId = campaignIds.get(row.campaign);
            if (!campaignId) {
                logger.warn(`Skipping prospect ${row.id} — campaign ${row.campaign} did not seed.`);
                continue;
            }

            const prospectId = new ObjectId(row.id);
            const payload = {
                campaignId,
                companyName: row.companyName,
                ...(row.uid ? {uid: row.uid} : {}),
                dedupeKey: row.dedupeKey,
                ...(row.canton ? {canton: row.canton} : {}),
                ...(row.legalForm ? {legalForm: row.legalForm} : {}),
                ...(row.registerUrl ? {registerUrl: row.registerUrl} : {}),
                ...(row.website ? {website: row.website} : {}),
                ...(row.websiteConfidence != null ? {websiteConfidence: row.websiteConfidence} : {}),
                emails: [...row.emails],
                phones: [...row.phones],
                ...(row.city ? {city: row.city} : {}),
                ...(row.postalCode ? {postalCode: row.postalCode} : {}),
                languages: [...row.languages],
                ...(row.summary ? {summary: row.summary} : {}),
                services: [...row.services],
                ...(row.score != null ? {score: row.score} : {}),
                ...(row.scoreReason ? {scoreReason: row.scoreReason} : {}),
                status: row.status as ProspectStatusValue,
                company: company._id,
                createdBy: company.createdBy,
            };

            const existing = await ProspectCompany.findById(prospectId);
            if (existing) {
                existing.set(payload);
                await existing.save();
            } else {
                await ProspectCompany.create({_id: prospectId, ...payload});
            }

            created.set(row.id, prospectId);
        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : String(e);
            logger.err(`Error creating prospect company ${row.id}: ${message}`);
        }
    }

    logger.finish("Finished creating Swiss outreach prospect companies!", created.size);
    return created;
}
