import {Schema} from "mongoose";

export function applyOutreachEmailIndexes(OutreachEmailSchema: Schema): void {
    OutreachEmailSchema.index({company: 1, campaignId: 1, prospectCompanyId: 1}, {unique: true});
    OutreachEmailSchema.index(
        {company: 1, campaignId: 1, toEmail: 1},
        {unique: true, partialFilterExpression: {toEmail: {$type: "string"}}},
    );
    OutreachEmailSchema.index({company: 1, status: 1});
}
