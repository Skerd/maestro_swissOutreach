import {action} from "@coreModule/api/actionDecorator";
import type {AuthenticatedMWType} from "@coreModule/utilities/middlewares/authMW";
import type {TransactionRequiredParams} from "@coreModule/utilities/middlewares/transactionUtils";
import {apiValidationException} from "armonia/src/modules/core/helpers/exceptions";
import {campaignIdFormSchema} from "armonia/src/modules/swissOutreach/api/swissOutreach/private/campaign/campaignAction.form.validator";
import type {Campaign as CampaignDto} from "armonia/src/modules/swissOutreach/api/swissOutreach/private/campaign/campaign.dto";
import type {CampaignStatusValue} from "armonia/src/modules/swissOutreach/types/constants";
import type {ClientSession} from "mongodb";
import type {ICampaign} from "./campaign";
import {campaignService} from "./campaign.service";
import {outreachEmailService} from "../outreachEmail/outreachEmail.service";
import {prospectCompanyService} from "../prospectCompany/prospectCompany.service";
import {campaignToDTO} from "@swissOutreachModule/utilities/mappers/campaign/campaignMapper.dto";
import {campaignOrchestrator} from "@swissOutreachModule/utilities/pipeline/campaignOrchestrator";

type CampaignParams = AuthenticatedMWType & {campaignId: string};

/**
 * A pipeline run (re)starts only from these: never while it runs (parsing → scoring), sends, or once it is completed
 * or cancelled for good.
 */
const STARTABLE: CampaignStatusValue[] = ["draft", "failed", "awaiting_approval"];
/** Approved emails are sent only once the pipeline has stopped. */
const SENDABLE: CampaignStatusValue[] = ["awaiting_approval", "completed", "failed"];

async function loadCampaign(params: CampaignParams, session?: ClientSession): Promise<ICampaign> {
    const {company, languageCode, campaignId} = params;
    const campaign = await campaignService.findOne({_id: campaignId, company: company._id}, {withDeleted: false, languageCode, session});
    if (!campaign) throw apiValidationException("campaign_not_found", "campaignId", null, languageCode);
    return campaign;
}

/** Campaign lifecycle actions (D14, D86): each is its own role permission on `swissoutreachcampaigns`. */
export class CampaignActions {
    /** Runs (or resumes) the discovery pipeline. */
    @action({auth: "private", rateLimit: {windowMs: 60000, max: 30}, schema: campaignIdFormSchema})
    async start(params: CampaignParams): Promise<{data: CampaignDto}> {
        const campaign = await loadCampaign(params);
        const campaignId = campaign._id.toString();
        // The claim is one compare-and-set write, so two starts (or a start and the create's own run) get one run.
        const claimed = campaignOrchestrator.isRunning(campaignId)
            ? null
            : await campaignOrchestrator.claimAndEnqueue(campaignId, STARTABLE, {company: params.company._id});
        if (!claimed) throw apiValidationException("campaign_cannot_start", "campaignId", null, params.languageCode);
        return {data: campaignToDTO(claimed)};
    }

    /** Stops the pipeline or a send in progress. */
    @action({auth: "private", rateLimit: {windowMs: 60000, max: 30}, schema: campaignIdFormSchema})
    async cancel(params: CampaignParams): Promise<{data: CampaignDto}> {
        const campaign = await loadCampaign(params);
        await campaignOrchestrator.cancel(campaign._id.toString());
        const refreshed = await campaignService.findById(campaign._id);
        return {data: campaignToDTO(refreshed!)};
    }

    /** Approves every draft and edited email that has a recipient, and their prospects. */
    @action({auth: "private", transaction: true, rateLimit: {windowMs: 60000, max: 20}, schema: campaignIdFormSchema})
    async approveAll(params: TransactionRequiredParams & CampaignParams): Promise<{data: CampaignDto}> {
        const {company, session} = params;
        const campaign = await loadCampaign(params, session);
        const approvable = await outreachEmailService.find(
            {company: company._id, campaignId: campaign._id, status: {$in: ["draft", "edited"]}, toEmail: {$type: "string"}},
            {withDeleted: false, session},
            undefined,
            "_id prospectCompanyId",
        );
        if (approvable.length > 0) {
            await outreachEmailService.updateMany(
                {company: company._id, _id: {$in: approvable.map((email) => email._id)}},
                {$set: {status: "approved"}},
                {withDeleted: false, session},
            );
            await prospectCompanyService.updateMany(
                {company: company._id, _id: {$in: approvable.map((email) => email.prospectCompanyId)}},
                {$set: {status: "approved"}},
                {withDeleted: false, session},
            );
        }
        // Counted like approve and send do: emails being sent or sent were approved too.
        campaign.stats.approved = await outreachEmailService.count({
            company: company._id,
            campaignId: campaign._id,
            status: {$in: ["approved", "queued", "sent"]},
        }, {session});
        await campaign.save({session});
        return {data: campaignToDTO(campaign)};
    }

    /**
     * Starts sending the approved emails and answers at once with the campaign `sending`: the send runs in the
     * background, throttled, and the campaign's stats show its progress. The claim is one compare-and-set write, so a
     * second send while one runs is refused.
     */
    @action({auth: "private", rateLimit: {windowMs: 60000, max: 10}, schema: campaignIdFormSchema})
    async sendApproved(params: CampaignParams): Promise<{data: CampaignDto}> {
        const campaign = await loadCampaign(params);
        const claimed = await campaignOrchestrator.claimAndSend(campaign._id.toString(), SENDABLE, {company: params.company._id});
        if (!claimed) throw apiValidationException("campaign_cannot_send", "campaignId", null, params.languageCode);
        return {data: campaignToDTO(claimed)};
    }
}
