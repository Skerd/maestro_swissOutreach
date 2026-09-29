import type {CampaignSimple} from "armonia/src/modules/swissOutreach/dto/campaign.dto";
import type {ICampaign} from "@swissOutreachModule/database/schemas/campaign/campaign";
import {defineSnippet} from "@coreModule/database/utilities/snippet";

export const CampaignSimpleSnippet = defineSnippet<ICampaign, CampaignSimple>()({
    keys: {
        jobDescription: {},
        status: {},
        language: {},
        senderCompanyName: {},
    },
});
