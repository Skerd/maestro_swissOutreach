import {Schema} from "mongoose";

export function applyCampaignIndexes(CampaignSchema: Schema): void {
    CampaignSchema.index({company: 1, createdAt: -1});
    CampaignSchema.index({company: 1, status: 1});
}
