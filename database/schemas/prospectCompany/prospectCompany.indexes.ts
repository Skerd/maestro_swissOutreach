import {Schema} from "mongoose";

export function applyProspectCompanyIndexes(ProspectCompanySchema: Schema): void {
    ProspectCompanySchema.index({company: 1, campaignId: 1, score: -1});
    ProspectCompanySchema.index({company: 1, campaignId: 1, dedupeKey: 1}, {unique: true});
    ProspectCompanySchema.index({uid: 1});
}
