import {Router} from "express";
import authMW, {type AuthenticatedMWType} from "@coreModule/utilities/middlewares/authMW";
import {rateLimiter} from "@coreModule/utilities/middlewares/rateLimiter";
import {asyncHandler} from "@coreModule/utilities/middlewares/asyncHandler";
import {validateFormZod} from "@coreModule/utilities/middlewares/validateFormZod";
import {ObjectId} from "mongodb";
import {campaignService} from "@swissOutreachModule/database/schemas/campaign/campaign.service";
import {prospectCompanyService} from "@swissOutreachModule/database/schemas/prospectCompany/prospectCompany.service";
import {outreachEmailService} from "@swissOutreachModule/database/schemas/outreachEmail/outreachEmail.service";
import type {SwissOutreachDashboardSummary} from "armonia/src/modules/swissOutreach/api/swissOutreach/private/dashboard/dashboard.dto";
import {
    dashboardSummaryFormSchema,
    type DashboardSummaryFormType,
} from "armonia/src/modules/swissOutreach/api/swissOutreach/private/dashboard/dashboardSummary.form.validator";

export const router = Router();

/** The company's outreach counts, or one campaign's when `campaignId` is given. */
router.post(
    "/summary",
    authMW("private"),
    rateLimiter({windowMs: 60000, max: 60}),
    validateFormZod(dashboardSummaryFormSchema),
    asyncHandler(async (params: AuthenticatedMWType & DashboardSummaryFormType) => {
        const {company, campaignId} = params;
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
