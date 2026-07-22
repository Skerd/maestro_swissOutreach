import {Document, model, Schema, SchemaTypes, Types} from "mongoose";
import ownershipPlugin from "@coreModule/database/plugins/ownershipPlugin";
import lifeCyclePlugin from "@coreModule/database/plugins/lifeCyclePlugin";
import {ILifeCyclePluginFields, IOwnershipPluginFields} from "@coreModule/database/types/plugin-fields";
import {pipelineLogLevelValues} from "armonia/src/modules/swissOutreach/types/constants";

export interface IPipelineRunLog extends Document, IOwnershipPluginFields, ILifeCyclePluginFields {
    campaignId: Types.ObjectId;
    step: string;
    level: (typeof pipelineLogLevelValues)[number];
    message: string;
    meta?: Record<string, unknown>;
}

const PipelineRunLogSchema = new Schema<IPipelineRunLog>(
    {
        campaignId: {type: SchemaTypes.ObjectId, ref: "SwissOutreachCampaign", required: true, index: true},
        step: {type: SchemaTypes.String, required: true},
        level: {type: SchemaTypes.String, enum: pipelineLogLevelValues, default: "info"},
        message: {type: SchemaTypes.String, required: true},
        meta: {type: SchemaTypes.Mixed, required: false},
    },
    {accessMode: "loose"},
);

ownershipPlugin(PipelineRunLogSchema);
lifeCyclePlugin(PipelineRunLogSchema);
PipelineRunLogSchema.index({company: 1, campaignId: 1, createdAt: -1});

const PipelineRunLog = model<IPipelineRunLog>("SwissOutreachPipelineRunLog", PipelineRunLogSchema);
export default PipelineRunLog;
