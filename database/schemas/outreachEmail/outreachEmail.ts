import {Document, model, Schema, SchemaTypes, Types} from "mongoose";
import {normalizeSchemaPermissions} from "@coreModule/database/utilities";
import ownershipPlugin from "@coreModule/database/plugins/ownershipPlugin";
import auditPlugin from "@coreModule/database/plugins/auditPlugin";
import softDeletePlugin from "@coreModule/database/plugins/softDeletePlugin";
import lifeCyclePlugin from "@coreModule/database/plugins/lifeCyclePlugin";
import {
    ILifeCyclePluginFields,
    IOwnershipPluginFields,
    ISoftDeletePluginFields,
} from "@coreModule/database/types/plugin-fields";
import {COLUMN_TYPE} from "armonia/src/modules/core/database/filter/typeOperators";
import {addModelData} from "@coreModule/database/collections";
import {validateSchemaDefAgainstMongoose} from "@coreModule/database/utilities/validateSchemaDefAgainstMongoose";
import {OutreachEmailSchemaDef} from "armonia/src/modules/swissOutreach/api/swissOutreach/private/outreachEmail/outreachEmail.schema-def";
import {
    outreachEmailStatusValues,
    outreachLanguageValues,
} from "armonia/src/modules/swissOutreach/types/constants";
import {applyOutreachEmailIndexes} from "./outreachEmail.indexes";
import {outreachEmailViews} from "./outreachEmail.views";

export interface IOutreachEmail
    extends Document,
        IOwnershipPluginFields,
        ISoftDeletePluginFields,
        ILifeCyclePluginFields {
    campaignId: Types.ObjectId;
    prospectCompanyId: Types.ObjectId;
    toEmail?: string;
    subject: string;
    body: string;
    language: (typeof outreachLanguageValues)[number];
    status: (typeof outreachEmailStatusValues)[number];
    messageId?: string;
    sentAt?: Date;
    attempts: number;
    lastError?: string;
}

const OutreachEmailSchema = new Schema<IOutreachEmail>(
    {
        campaignId: {
            type: SchemaTypes.ObjectId,
            ref: "SwissOutreachCampaign",
            required: true,
            dynamicTableConfiguration: {filterable: true, sortable: true, cellType: COLUMN_TYPE.OBJECT_ID},
        },
        prospectCompanyId: {
            type: SchemaTypes.ObjectId,
            ref: "SwissOutreachProspectCompany",
            required: true,
        },
        toEmail: {type: SchemaTypes.String, required: false, trim: true},
        subject: {type: SchemaTypes.String, required: true},
        body: {type: SchemaTypes.String, required: true},
        language: {
            type: SchemaTypes.String,
            required: true,
            enum: outreachLanguageValues,
        },
        status: {
            type: SchemaTypes.String,
            enum: outreachEmailStatusValues,
            default: "draft",
            dynamicTableConfiguration: {filterable: true, sortable: true, cellType: COLUMN_TYPE.ENUM},
        },
        messageId: {type: SchemaTypes.String, required: false},
        sentAt: {type: SchemaTypes.Date, required: false},
        attempts: {type: SchemaTypes.Number, default: 0},
        lastError: {type: SchemaTypes.String, required: false},
    },
    {accessMode: "loose"},
);

ownershipPlugin(OutreachEmailSchema);
auditPlugin(OutreachEmailSchema);
softDeletePlugin(OutreachEmailSchema);
lifeCyclePlugin(OutreachEmailSchema);
applyOutreachEmailIndexes(OutreachEmailSchema);

const OutreachEmail = model<IOutreachEmail>("SwissOutreachEmail", OutreachEmailSchema);
normalizeSchemaPermissions(OutreachEmail);
export default OutreachEmail;

addModelData(OutreachEmail, outreachEmailViews);
validateSchemaDefAgainstMongoose(OutreachEmailSchema, OutreachEmailSchemaDef, "SwissOutreachEmail", [
    "company",
    "messageId",
    "sentAt",
    "attempts",
    "lastError",
]);
