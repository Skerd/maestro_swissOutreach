import {BaseCrudService} from "@coreModule/database/services/baseCrudService";
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
}

export const campaignService = new CampaignService();
