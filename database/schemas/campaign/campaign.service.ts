import {BaseCrudService} from "@coreModule/database/services/baseCrudService";
import Campaign, {ICampaign} from "./campaign";

export class CampaignService extends BaseCrudService<ICampaign, typeof Campaign> {
    constructor() {
        super(Campaign, "SwissOutreachCampaign");
    }
}

export const campaignService = new CampaignService();
