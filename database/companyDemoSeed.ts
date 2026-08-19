import {getLogger, serverLogger} from "@coreModule/loggers/serverLog";
import {createCampaigns} from "@swissOutreachModule/database/schemas/campaign/campaign.defaults";
import {createProspectCompanies} from "@swissOutreachModule/database/schemas/prospectCompany/prospectCompany.defaults";
import {createOutreachEmails} from "@swissOutreachModule/database/schemas/outreachEmail/outreachEmail.defaults";

/** Last of the module seeds — depends on nothing outside its own module. */
export const companyDemoSeedOrder = 70;

/**
 * Seeds the Swiss outreach demo: three campaigns, the prospects they discovered and
 * the e-mail drafts waiting for approval.
 *
 * Strictly ordered — prospects reference their campaign, e-mails reference both.
 * `pipelineRunLog` is deliberately not seeded; it is a runtime trace.
 */
export async function seedCompanyDemoData(parentLogger: serverLogger | undefined, company: any): Promise<void> {
    const logger = getLogger("swissOutreach_company_demo_seed", parentLogger);
    logger.start("Seeding Swiss outreach demo data...");

    const campaignIds = await createCampaigns(logger, company);
    const prospectIds = await createProspectCompanies(logger, company, campaignIds);
    await createOutreachEmails(logger, company, campaignIds, prospectIds);

    logger.finish("Finished seeding Swiss outreach demo data!");
}
