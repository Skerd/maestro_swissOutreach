import {ICampaign} from "@swissOutreachModule/database/schemas/campaign/campaign";
import type {Campaign} from "armonia/src/modules/swissOutreach/api/swissOutreach/private/campaign/campaign.dto";
import {
    mapLifeCycleToDTO,
    mapOwnershipToDTO,
    mapSoftDeleteToDTO,
} from "@coreModule/utilities/mappers/plugin/pluginMappers.dto";

export function campaignToDTO(campaign: ICampaign): Campaign {
    return {
        _id: campaign._id.toString(),
        jobDescription: campaign.jobDescription,
        country: campaign.country,
        cantons: campaign.cantons || [],
        maxCompanies: campaign.maxCompanies,
        language: campaign.language,
        emailTone: campaign.emailTone,
        sendAutomatically: Boolean(campaign.sendAutomatically),
        senderCompanyName: campaign.senderCompanyName,
        senderName: campaign.senderName,
        senderEmail: campaign.senderEmail,
        senderPhone: campaign.senderPhone,
        senderWebsite: campaign.senderWebsite,
        additionalNotes: campaign.additionalNotes,
        status: campaign.status,
        parsedJob: campaign.parsedJob,
        stats: {
            found: campaign.stats?.found || 0,
            enriched: campaign.stats?.enriched || 0,
            scored: campaign.stats?.scored || 0,
            approved: campaign.stats?.approved || 0,
            sent: campaign.stats?.sent || 0,
            failed: campaign.stats?.failed || 0,
        },
        lastError: campaign.lastError,
        ...mapSoftDeleteToDTO(campaign),
        ...mapOwnershipToDTO(campaign),
        ...mapLifeCycleToDTO(campaign),
    };
}

export function campaignsToDTO(campaigns: ICampaign[]): Campaign[] {
    return campaigns.map(campaignToDTO);
}
