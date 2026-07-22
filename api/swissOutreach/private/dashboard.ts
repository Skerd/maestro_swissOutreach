import {Router} from "express";
import authMW from "@coreModule/utilities/middlewares/authMW";
import {rateLimiter} from "@coreModule/utilities/middlewares/rateLimiter";
import {asyncHandler} from "@coreModule/utilities/middlewares/asyncHandler";
import Campaign from "@swissOutreachModule/database/schemas/campaign/campaign";
import ProspectCompany from "@swissOutreachModule/database/schemas/prospectCompany/prospectCompany";
import OutreachEmail from "@swissOutreachModule/database/schemas/outreachEmail/outreachEmail";
import type {SwissOutreachDashboardSummary} from "armonia/src/modules/swissOutreach/api/swissOutreach/private/dashboard/dashboard.dto";
import {getSwissOutreachMetrics} from "@swissOutreachModule/utilities/monitoring/metrics";
import {MAIL_PROVIDER_PRESETS, resolveMailProviderKind} from "@swissOutreachModule/utilities/adapters/mailProviderFactory";
import {getSwissOutreachConfig} from "@swissOutreachModule/utilities/config";

export const router = Router();

router.get(
    "/summary",
    authMW("private"),
    rateLimiter({windowMs: 60000, max: 60}),
    asyncHandler(async (params: any) => {
        const {company} = params;
        const companyId = company._id;

        const [campaignsTotal, campaignsActive, companiesFound, emailsSent, failures, scoreAgg, contacted] =
            await Promise.all([
                Campaign.countDocuments({company: companyId, deletedAt: null}),
                Campaign.countDocuments({
                    company: companyId,
                    deletedAt: null,
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
                }),
                ProspectCompany.countDocuments({company: companyId, deletedAt: null}),
                OutreachEmail.countDocuments({company: companyId, deletedAt: null, status: "sent"}),
                OutreachEmail.countDocuments({company: companyId, deletedAt: null, status: "failed"}),
                ProspectCompany.aggregate([
                    {$match: {company: companyId, deletedAt: null, score: {$type: "number"}}},
                    {$group: {_id: null, avg: {$avg: "$score"}}},
                ]),
                ProspectCompany.countDocuments({
                    company: companyId,
                    deletedAt: null,
                    status: {$in: ["approved", "sent"]},
                }),
            ]);

        const totalAttempts = emailsSent + failures;
        const summary: SwissOutreachDashboardSummary = {
            companiesFound,
            companiesContacted: contacted,
            emailsSent,
            repliesReceived: 0,
            failures,
            successRate: totalAttempts > 0 ? Math.round((emailsSent / totalAttempts) * 1000) / 10 : 0,
            averageScore: scoreAgg[0]?.avg != null ? Math.round(scoreAgg[0].avg * 10) / 10 : 0,
            campaignsTotal,
            campaignsActive,
        };

        return {
            data: {
                ...summary,
                runtimeMetrics: getSwissOutreachMetrics(),
                config: {
                    emailProvider: resolveMailProviderKind(),
                    emailPreset: MAIL_PROVIDER_PRESETS[resolveMailProviderKind()],
                    webSearchProvider: getSwissOutreachConfig().webSearchProvider,
                    llmProvider: getSwissOutreachConfig().llmProvider,
                    zefixConfigured: true,
                    zefixMode:
                        getSwissOutreachConfig().zefixUsername && getSwissOutreachConfig().zefixPassword
                            ? "authenticated"
                            : "public",
                },
            },
        };
    }),
);
