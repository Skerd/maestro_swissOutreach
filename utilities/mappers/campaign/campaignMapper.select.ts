import type {ApiSelectDatum} from "armonia/src/modules/core/types/shared.types";
import type {ICampaign} from "@swissOutreachModule/database/schemas/campaign/campaign";
import {campaignName} from "@swissOutreachModule/utilities/mappers/campaign/campaignMapper.dto";

export function campaignToSelect(campaign: ICampaign): ApiSelectDatum {
    return {
        value: campaign._id.toString(),
        label: `${campaignName(campaign)} (${campaign.status})`,
    };
}

export function campaignsToSelect(campaigns: ICampaign[]): ApiSelectDatum[] {
    return campaigns.map(campaignToSelect);
}
