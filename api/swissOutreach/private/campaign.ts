import {Router} from "express";
import {buildCreateDataFromSchemaDef, buildUpdateDataFromSchemaDef} from "@coreModule/api/buildUpdateDataFromSchemaDef";
import {createCrudRouter, type CrudCreateParams} from "@coreModule/api/crudRouterFactory";
import {createCampaignFormSchema} from "armonia/src/modules/swissOutreach/api/swissOutreach/private/campaign/createCampaign.form.validator";
import {editCampaignFormSchema} from "armonia/src/modules/swissOutreach/api/swissOutreach/private/campaign/editCampaign.form.validator";
import {
    CampaignSchemaDef,
    type CreateCampaignFormType,
    type EditCampaignFormType,
} from "armonia/src/modules/swissOutreach/api/swissOutreach/private/campaign/campaign.schema-def";
import Campaign, {type ICampaign} from "@swissOutreachModule/database/schemas/campaign/campaign";
import {campaignService} from "@swissOutreachModule/database/schemas/campaign/campaign.service";
import {
    campaignsToDTO,
    campaignToDTO,
} from "@swissOutreachModule/utilities/mappers/campaign/campaignMapper.dto";
import {CampaignActions} from "@swissOutreachModule/database/schemas/campaign/campaign.actions";
import {campaignsToSelect} from "@swissOutreachModule/utilities/mappers/campaign/campaignMapper.select";
import {campaignOrchestrator} from "@swissOutreachModule/utilities/pipeline/campaignOrchestrator";
import {pipelineRunLogService} from "@swissOutreachModule/database/schemas/pipelineRunLog/pipelineRunLog.service";
import authMW, {type AuthenticatedMWType} from "@coreModule/utilities/middlewares/authMW";
import {rateLimiter} from "@coreModule/utilities/middlewares/rateLimiter";
import {asyncHandler} from "@coreModule/utilities/middlewares/asyncHandler";
import {validateFormZod} from "@coreModule/utilities/middlewares/validateFormZod";
import {schemaSanitizer, type SchemaSanitizerMWType} from "@coreModule/utilities/middlewares/schemaSanitizerMW";
import {runAfterCommit} from "@coreModule/utilities/middlewares/transactionUtils";
import {apiValidationException} from "armonia/src/modules/core/helpers/exceptions";
import {campaignIdFormSchema} from "armonia/src/modules/swissOutreach/api/swissOutreach/private/campaign/campaignAction.form.validator";
import {getSwissOutreachConfig} from "@swissOutreachModule/utilities/config";

const {router: crudRouter} = createCrudRouter<ICampaign, CreateCampaignFormType, EditCampaignFormType>({
    collectionName: "swissoutreachcampaigns",
    model: Campaign,
    service: campaignService,
    entityName: "SwissOutreachCampaign",
    createSchema: createCampaignFormSchema,
    editSchema: editCampaignFormSchema,
    toDTO: campaignToDTO,
    toDTOArray: campaignsToDTO,
    toSelect: campaignsToSelect,
    selectSearchField: "name",
    // senderCompanyName: the label of a campaign made before campaigns had a name
    selectProjection: "_id name senderCompanyName status",
    defaultSort: {createdAt: -1},
    buildCreateData: (params: CrudCreateParams<CreateCampaignFormType>) => {
        const config = getSwissOutreachConfig();
        const data = buildCreateDataFromSchemaDef(CampaignSchemaDef)(params);
        return {
            ...data,
            sendAutomatically: Boolean(params.sendAutomatically),
            maxCompanies: params.maxCompanies || config.maxCompaniesDefault,
            cantons: params.cantons ?? [],
            status: "draft",
            stats: {found: 0, enriched: 0, scored: 0, approved: 0, sent: 0, failed: 0},
        };
    },
    buildUpdateData: buildUpdateDataFromSchemaDef(CampaignSchemaDef),
    // start / cancel / approveAll / sendApproved (D86)
    actions: CampaignActions,
    // The run reads the campaign outside this transaction, so it starts once the create has committed.
    afterCreate: async (doc, params) => {
        await runAfterCommit(params.session, async () => {
            await campaignOrchestrator.claimAndEnqueue(doc._id.toString(), ["draft"], {company: params.company._id});
        });
    },
});

export const router = Router();
router.use(crudRouter);

/**
 * The campaign's pipeline activity, newest first. Its prospects and emails are read through their own lists, filtered
 * by `campaignId`. The log narrates the run and its errors, so it needs read access to the campaign's `lastError`.
 */
router.post(
    "/logs",
    authMW("private"),
    rateLimiter({windowMs: 60000, max: 60}),
    validateFormZod(campaignIdFormSchema),
    schemaSanitizer({model: "swissoutreachcampaigns", requiredModes: ["read"]}),
    asyncHandler(async (params: AuthenticatedMWType & SchemaSanitizerMWType & {campaignId: string}) => {
        const {company, languageCode, campaignId, sanitizedReadFields} = params;
        if (!sanitizedReadFields.lastError) {
            throw apiValidationException("user_permissions_not_sufficient", null, null, languageCode);
        }
        const campaign = await campaignService.findOne({_id: campaignId, company: company._id}, {withDeleted: false, languageCode}, undefined, "_id");
        if (!campaign) throw apiValidationException("campaign_not_found", "campaignId", null, languageCode);
        const logs = await pipelineRunLogService.find(
            {company: company._id, campaignId: campaign._id},
            {},
            undefined,
            "step level message createdAt",
            {createdAt: -1},
            200,
        );
        return {
            data: logs.map((log) => ({
                _id: log._id.toString(),
                step: log.step,
                level: log.level,
                message: log.message,
                createdAt: log.createdAt,
            })),
        };
    }),
);
