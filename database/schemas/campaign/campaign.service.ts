import type {FilterQuery} from "mongoose";
import {BaseCrudService} from "@coreModule/database/services/baseCrudService";
import type {CampaignStatusValue} from "armonia/src/modules/swissOutreach/types/constants";
import Campaign, {ICampaign} from "./campaign";

export class CampaignService extends BaseCrudService<ICampaign, typeof Campaign> {
    constructor() {
        super(Campaign, "SwissOutreachCampaign");
    }

    /** The campaign with only the `select`ed fields, as a plain object. */
    findByIdLean(campaignId: string, select: string) {
        return this.model.findById(campaignId).select(select).lean();
    }

    /** Marks the campaign cancelled and returns it. */
    markCancelled(campaignId: string) {
        return this.model.findByIdAndUpdate(campaignId, {$set: {status: "cancelled"}}, {new: true});
    }

    /**
     * Claims a pipeline run: moves the campaign to `parsing` only while it is still in one of `from` (and matches
     * `extra`), in one write. Two triggers racing for the same campaign get it once; the loser gets null.
     */
    claimRun(campaignId: string, from: CampaignStatusValue[], extra: FilterQuery<ICampaign> = {}) {
        return this.claim(campaignId, from, "parsing", extra);
    }

    /** Claims a send the same way: moves the campaign to `sending` only while it is still in one of `from`. */
    claimSend(campaignId: string, from: CampaignStatusValue[], extra: FilterQuery<ICampaign> = {}) {
        return this.claim(campaignId, from, "sending", extra);
    }

    private claim(campaignId: string, from: CampaignStatusValue[], to: CampaignStatusValue, extra: FilterQuery<ICampaign>) {
        return this.model.findOneAndUpdate(
            {...extra, _id: campaignId, status: {$in: from}},
            {$set: {status: to}, $unset: {lastError: ""}},
            {new: true},
        ).noDeleted();
    }
}

export const campaignService = new CampaignService();
