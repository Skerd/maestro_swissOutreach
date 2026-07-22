import type {Model} from "mongoose";
import Campaign from "@swissOutreachModule/database/schemas/campaign/campaign";
import ProspectCompany from "@swissOutreachModule/database/schemas/prospectCompany/prospectCompany";
import OutreachEmail from "@swissOutreachModule/database/schemas/outreachEmail/outreachEmail";
import PipelineRunLog from "@swissOutreachModule/database/schemas/pipelineRunLog/pipelineRunLog";

export const swissOutreachModels: Model<any>[] = [
    Campaign,
    ProspectCompany,
    OutreachEmail,
    PipelineRunLog,
];

export async function dropSwissOutreachCollections(): Promise<void> {
    for (const model of swissOutreachModels) {
        try {
            await model.collection.drop();
        } catch {
            // collection may not exist
        }
    }
}
