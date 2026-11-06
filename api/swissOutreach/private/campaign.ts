import {Router} from "express";
import {buildCreateDataFromSchemaDef, buildUpdateDataFromSchemaDef} from "@coreModule/api/buildUpdateDataFromSchemaDef";
import {createCrudRouter} from "@coreModule/api/crudRouterFactory";
import {createCampaignFormSchema} from "armonia/src/modules/swissOutreach/api/swissOutreach/private/campaign/createCampaign.form.validator";
import {editCampaignFormSchema} from "armonia/src/modules/swissOutreach/api/swissOutreach/private/campaign/editCampaign.form.validator";
import {CampaignSchemaDef} from "armonia/src/modules/swissOutreach/api/swissOutreach/private/campaign/campaign.schema-def";
import Campaign from "@swissOutreachModule/database/schemas/campaign/campaign";
import {campaignService} from "@swissOutreachModule/database/schemas/campaign/campaign.service";
import {
    campaignsToDTO,
    campaignToDTO,
} from "@swissOutreachModule/utilities/mappers/campaign/campaignMapper.dto";
import {campaignsToSelect} from "@swissOutreachModule/utilities/mappers/campaign/campaignMapper.select";
import {campaignOrchestrator} from "@swissOutreachModule/utilities/pipeline/campaignOrchestrator";
import {prospectCompanyService} from "@swissOutreachModule/database/schemas/prospectCompany/prospectCompany.service";
import {outreachEmailService} from "@swissOutreachModule/database/schemas/outreachEmail/outreachEmail.service";
import {pipelineRunLogService} from "@swissOutreachModule/database/schemas/pipelineRunLog/pipelineRunLog.service";
import {prospectCompaniesToDTO} from "@swissOutreachModule/utilities/mappers/prospectCompany/prospectCompanyMapper.dto";
import {outreachEmailsToDTO} from "@swissOutreachModule/utilities/mappers/outreachEmail/outreachEmailMapper.dto";
import authMW from "@coreModule/utilities/middlewares/authMW";
import {rateLimiter} from "@coreModule/utilities/middlewares/rateLimiter";
import {validateFormZod} from "@coreModule/utilities/middlewares/validateFormZod";
import {asyncHandler} from "@coreModule/utilities/middlewares/asyncHandler";
import {transactionHandler} from "@coreModule/utilities/middlewares/transactionUtils";
import {campaignIdFormSchema} from "armonia/src/modules/swissOutreach/api/swissOutreach/private/campaign/campaignAction.form.validator";
import {apiValidationException} from "armonia/src/modules/core/helpers/exceptions";
import {getSwissOutreachConfig} from "@swissOutreachModule/utilities/config";

const {router: crudRouter} = createCrudRouter({
    collectionName: "swissoutreachcampaigns",
    model: Campaign,
    service: campaignService,
    entityName: "SwissOutreachCampaign",
    createSchema: createCampaignFormSchema,
    editSchema: editCampaignFormSchema,
    toDTO: campaignToDTO,
    toDTOArray: campaignsToDTO,
    toSelect: campaignsToSelect,
    selectSearchField: "senderCompanyName",
    selectProjection: "_id senderCompanyName status",
    defaultSort: {createdAt: -1},
    buildCreateData: (body: any) => {
        const config = getSwissOutreachConfig();
        const data = buildCreateDataFromSchemaDef(CampaignSchemaDef)(body);
        return {
            ...data,
            sendAutomatically: Boolean(body.sendAutomatically),
            maxCompanies: body.maxCompanies || config.maxCompaniesDefault,
            cantons: Array.isArray(body.cantons) ? body.cantons : [],
            status: "draft",
            stats: {found: 0, enriched: 0, scored: 0, approved: 0, sent: 0, failed: 0},
        };
    },
    buildUpdateData: buildUpdateDataFromSchemaDef(CampaignSchemaDef),
    afterCreate: async (doc: any) => {
        campaignOrchestrator.enqueue(doc._id.toString(), doc.company?.toString?.() || String(doc.company || ""));
    },
});

export const router = Router();
router.use(crudRouter);

router.post(
    "/start",
    authMW("private"),
    rateLimiter({windowMs: 60000, max: 30}),
    validateFormZod(campaignIdFormSchema),
    asyncHandler(async (params: any) => {
        const {company, languageCode, campaignId} = params;
        const campaign = await campaignService.findOne({_id: campaignId, company: company._id}, {withDeleted: false, languageCode});
        if (!campaign) throw apiValidationException("campaign_not_found", "campaignId", null, languageCode);
        campaignOrchestrator.enqueue(campaign._id.toString(), company._id.toString());
        return {data: campaignToDTO(campaign)};
    }),
);

router.post(
    "/cancel",
    authMW("private"),
    rateLimiter({windowMs: 60000, max: 30}),
    validateFormZod(campaignIdFormSchema),
    asyncHandler(async (params: any) => {
        const {company, languageCode, campaignId} = params;
        const campaign = await campaignService.findOne({_id: campaignId, company: company._id}, {withDeleted: false, languageCode});
        if (!campaign) throw apiValidationException("campaign_not_found", "campaignId", null, languageCode);
        await campaignOrchestrator.cancel(campaign._id.toString());
        const refreshed = await campaignService.findById(campaign._id);
        return {data: campaignToDTO(refreshed!)};
    }),
);

router.post(
    "/approveAll",
    authMW("private"),
    rateLimiter({windowMs: 60000, max: 20}),
    transactionHandler(),
    validateFormZod(campaignIdFormSchema),
    asyncHandler(async (params: any) => {
        const {company, languageCode, campaignId, session} = params;
        const campaign = await campaignService.findOne({_id: campaignId, company: company._id}, {withDeleted: false, languageCode, session});
        if (!campaign) throw apiValidationException("campaign_not_found", "campaignId", null, languageCode);
        await outreachEmailService.updateMany(
            {
                company: company._id,
                campaignId: campaign._id,
                status: {$in: ["draft", "edited"]},
                toEmail: {$type: "string"},
            },
            {$set: {status: "approved"}},
            {withDeleted: false, session},
        );
        campaign.stats.approved = await outreachEmailService.count({
            company: company._id,
            campaignId: campaign._id,
            status: "approved",
        }, {session});
        await campaign.save({session});
        return {data: campaignToDTO(campaign)};
    }),
);

router.post(
    "/sendApproved",
    authMW("private"),
    rateLimiter({windowMs: 60000, max: 10}),
    validateFormZod(campaignIdFormSchema),
    asyncHandler(async (params: any) => {
        const {company, languageCode, campaignId} = params;
        const campaign = await campaignService.findOne({_id: campaignId, company: company._id}, {withDeleted: false, languageCode});
        if (!campaign) throw apiValidationException("campaign_not_found", "campaignId", null, languageCode);
        const result = await campaignOrchestrator.sendApproved(campaign._id.toString(), false);
        const refreshed = await campaignService.findById(campaign._id);
        return {data: {campaign: campaignToDTO(refreshed!), ...result}};
    }),
);

router.get(
    "/:campaignId/prospects",
    authMW("private"),
    rateLimiter({windowMs: 60000, max: 60}),
    asyncHandler(async (params: any, routeParams: any) => {
        const {company, languageCode} = params;
        const campaignId = routeParams.campaignId;
        const campaign = await campaignService.findOne({_id: campaignId, company: company._id}, {withDeleted: false, languageCode});
        if (!campaign) throw apiValidationException("campaign_not_found", "campaignId", null, languageCode);
        const prospects = await prospectCompanyService.find(
            {company: company._id, campaignId: campaign._id},
            {withDeleted: false},
            undefined,
            undefined,
            {score: -1},
        );
        return {data: prospectCompaniesToDTO(prospects)};
    }),
);

router.get(
    "/:campaignId/emails",
    authMW("private"),
    rateLimiter({windowMs: 60000, max: 60}),
    asyncHandler(async (params: any, routeParams: any) => {
        const {company, languageCode} = params;
        const campaignId = routeParams.campaignId;
        const campaign = await campaignService.findOne({_id: campaignId, company: company._id}, {withDeleted: false, languageCode});
        if (!campaign) throw apiValidationException("campaign_not_found", "campaignId", null, languageCode);
        const emails = await outreachEmailService.find(
            {company: company._id, campaignId: campaign._id},
            {withDeleted: false},
            undefined,
            undefined,
            {createdAt: -1},
        );
        return {data: outreachEmailsToDTO(emails)};
    }),
);

router.get(
    "/:campaignId/logs",
    authMW("private"),
    rateLimiter({windowMs: 60000, max: 60}),
    asyncHandler(async (params: any, routeParams: any) => {
        const {company, languageCode} = params;
        const campaignId = routeParams.campaignId;
        const campaign = await campaignService.findOne({_id: campaignId, company: company._id}, {withDeleted: false, languageCode});
        if (!campaign) throw apiValidationException("campaign_not_found", "campaignId", null, languageCode);
        const logs = await pipelineRunLogService.find(
            {company: company._id, campaignId: campaign._id},
            {},
            undefined,
            undefined,
            {createdAt: -1},
            200,
        );
        return {
            data: logs.map((l: any) => ({
                _id: l._id.toString(),
                step: l.step,
                level: l.level,
                message: l.message,
                meta: l.meta,
                createdAt: l.createdAt,
            })),
        };
    }),
);
