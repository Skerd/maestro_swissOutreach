import {Router} from "express";
import authMW, {type AuthenticatedMWType} from "@coreModule/utilities/middlewares/authMW";
import {rateLimiter} from "@coreModule/utilities/middlewares/rateLimiter";
import {asyncHandler} from "@coreModule/utilities/middlewares/asyncHandler";
import {validateFormZod} from "@coreModule/utilities/middlewares/validateFormZod";
import {ObjectId} from "mongodb";
import type {Model} from "mongoose";
import SchemaGuard from "@coreModule/database/security/schemaGuard";
import {getModelCollectedData} from "@coreModule/database/collections";
import {apiValidationException} from "armonia/src/modules/core/helpers/exceptions";
import type {UserContext} from "@coreModule/utilities/types/types";
import Campaign from "@swissOutreachModule/database/schemas/campaign/campaign";
import ProspectCompany from "@swissOutreachModule/database/schemas/prospectCompany/prospectCompany";
import OutreachEmail from "@swissOutreachModule/database/schemas/outreachEmail/outreachEmail";
import {campaignService} from "@swissOutreachModule/database/schemas/campaign/campaign.service";
import {prospectCompanyService} from "@swissOutreachModule/database/schemas/prospectCompany/prospectCompany.service";
import {outreachEmailService} from "@swissOutreachModule/database/schemas/outreachEmail/outreachEmail.service";
import type {SwissOutreachDashboardSummary} from "armonia/src/modules/swissOutreach/api/swissOutreach/private/dashboard/dashboard.dto";
import {
    dashboardSummaryFormSchema,
    type DashboardSummaryFormType,
} from "armonia/src/modules/swissOutreach/api/swissOutreach/private/dashboard/dashboardSummary.form.validator";

export const router = Router();

/** The fields of `collectionName` the caller may read (SEC-09); throws when there are none. */
function readableFields<T>(model: Model<T>, collectionName: string, actionUserCtx: UserContext, languageCode: string) {
    return SchemaGuard.sanitizeFields(model, getModelCollectedData(collectionName).readFields ?? {}, "read", actionUserCtx, languageCode);
}

/** The company's outreach counts, or one campaign's when `campaignId` is given. */
router.post(
    "/summary",
    authMW("private"),
    rateLimiter({windowMs: 60000, max: 60}),
    validateFormZod(dashboardSummaryFormSchema),
    asyncHandler(async (params: AuthenticatedMWType & DashboardSummaryFormType) => {
        const {company, campaignId, actionUserCtx, languageCode} = params;
        // Every figure counts by status (and the average reads the score): the caller must be able to read them (SEC-09).
        const campaignFields = readableFields(Campaign, "swissoutreachcampaigns", actionUserCtx, languageCode);
        const prospectFields = readableFields(ProspectCompany, "swissoutreachprospectcompanies", actionUserCtx, languageCode);
        const emailFields = readableFields(OutreachEmail, "swissoutreachemails", actionUserCtx, languageCode);
        if (!campaignFields.status || !prospectFields.status || !prospectFields.score || !emailFields.status) {
            throw apiValidationException("user_permissions_not_sufficient", null, null, languageCode);
        }
        const companyId = company._id;
        const campaign = campaignId ? new ObjectId(campaignId) : undefined;
        // Campaigns are matched by their id, their prospects and emails by `campaignId`.
        const ofCampaign = campaign ? {_id: campaign} : {};
        const inCampaign = campaign ? {campaignId: campaign} : {};

        const [campaignsTotal, campaignsActive, companiesFound, emailsSent, failures, scoreAgg, contacted] =
            await Promise.all([
                campaignService.count({company: companyId, ...ofCampaign}, {withDeleted: false}),
                campaignService.count({
                    company: companyId,
                    ...ofCampaign,
                    status: {
                        $in: [
                            "parsing",
                            "searching",
                            "enriching",
                            "scoring",
                            "awaiting_approval",
                            "sending",
                        ],
                    },
                }, {withDeleted: false}),
                prospectCompanyService.count({company: companyId, ...inCampaign}, {withDeleted: false}),
                outreachEmailService.count({company: companyId, ...inCampaign, status: "sent"}, {withDeleted: false}),
                outreachEmailService.count({company: companyId, ...inCampaign, status: "failed"}, {withDeleted: false}),
                prospectCompanyService.aggregate([
                    {$match: {company: companyId, ...inCampaign, deletedAt: null, score: {$type: "number"}}},
                    {$group: {_id: null, avg: {$avg: "$score"}}},
                ]),
                prospectCompanyService.count({
                    company: companyId,
                    ...inCampaign,
                    status: {$in: ["approved", "sent"]},
                }, {withDeleted: false}),
            ]);

        const totalAttempts = emailsSent + failures;
        const summary: SwissOutreachDashboardSummary = {
            companiesFound,
            companiesContacted: contacted,
            emailsSent,
            failures,
            successRate: totalAttempts > 0 ? Math.round((emailsSent / totalAttempts) * 1000) / 10 : 0,
            averageScore: scoreAgg[0]?.avg != null ? Math.round(scoreAgg[0].avg * 10) / 10 : 0,
            campaignsTotal,
            campaignsActive,
        };

        // The company's own counts only: process-wide counters and the operator's provider setup are not tenant data.
        return {data: summary};
    }),
);
