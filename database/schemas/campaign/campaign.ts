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
import {CampaignSchemaDef} from "armonia/src/modules/swissOutreach/api/swissOutreach/private/campaign/campaign.schema-def";
import {
    campaignStatusValues,
    emailToneValues,
    outreachLanguageValues,
} from "armonia/src/modules/swissOutreach/types/constants";
import type {ParsedJob} from "armonia/src/modules/swissOutreach/types/parsedJob";
import {applyCampaignIndexes} from "./campaign.indexes";
import {campaignViews} from "./campaign.views";

export interface ICampaignStats {
    found: number;
    enriched: number;
    scored: number;
    approved: number;
    sent: number;
    failed: number;
}

export interface ICampaign
    extends Document,
        IOwnershipPluginFields,
        ISoftDeletePluginFields,
        ILifeCyclePluginFields {
    jobDescription: string;
    country: string;
    cantons: string[];
    maxCompanies: number;
    language: (typeof outreachLanguageValues)[number];
    emailTone: (typeof emailToneValues)[number];
    sendAutomatically: boolean;
    senderCompanyName: string;
    senderName: string;
    senderEmail: string;
    senderPhone?: string;
    senderWebsite?: string;
    additionalNotes?: string;
    status: (typeof campaignStatusValues)[number];
    parsedJob?: ParsedJob;
    stats: ICampaignStats;
    lastError?: string;
}

const CampaignSchema = new Schema<ICampaign>(
    {
        jobDescription: {
            type: SchemaTypes.String,
            required: true,
            dynamicTableConfiguration: {filterable: true, sortable: false, cellType: COLUMN_TYPE.TEXT},
        },
        country: {
            type: SchemaTypes.String,
            required: true,
            trim: true,
            dynamicTableConfiguration: {filterable: true, sortable: true, cellType: COLUMN_TYPE.TEXT},
        },
        cantons: {type: [SchemaTypes.String], default: []},
        maxCompanies: {
            type: SchemaTypes.Number,
            required: true,
            min: 1,
            max: 500,
            dynamicTableConfiguration: {filterable: true, sortable: true, cellType: COLUMN_TYPE.NUMBER},
        },
        language: {
            type: SchemaTypes.String,
            required: true,
            enum: outreachLanguageValues,
            dynamicTableConfiguration: {filterable: true, sortable: true, cellType: COLUMN_TYPE.ENUM},
        },
        emailTone: {
            type: SchemaTypes.String,
            required: true,
            enum: emailToneValues,
        },
        sendAutomatically: {type: SchemaTypes.Boolean, default: false},
        senderCompanyName: {type: SchemaTypes.String, required: true, trim: true},
        senderName: {type: SchemaTypes.String, required: true, trim: true},
        senderEmail: {type: SchemaTypes.String, required: true, trim: true},
        senderPhone: {type: SchemaTypes.String, required: false},
        senderWebsite: {type: SchemaTypes.String, required: false},
        additionalNotes: {type: SchemaTypes.String, required: false},
        status: {
            type: SchemaTypes.String,
            enum: campaignStatusValues,
            default: "draft",
            dynamicTableConfiguration: {filterable: true, sortable: true, cellType: COLUMN_TYPE.ENUM},
        },
        parsedJob: {type: SchemaTypes.Mixed, required: false},
        stats: {
            found: {type: SchemaTypes.Number, default: 0},
            enriched: {type: SchemaTypes.Number, default: 0},
            scored: {type: SchemaTypes.Number, default: 0},
            approved: {type: SchemaTypes.Number, default: 0},
            sent: {type: SchemaTypes.Number, default: 0},
            failed: {type: SchemaTypes.Number, default: 0},
        },
        lastError: {type: SchemaTypes.String, required: false},
    },
    {accessMode: "loose"},
);

ownershipPlugin(CampaignSchema);
auditPlugin(CampaignSchema);
softDeletePlugin(CampaignSchema);
lifeCyclePlugin(CampaignSchema);
applyCampaignIndexes(CampaignSchema);

const Campaign = model<ICampaign>("SwissOutreachCampaign", CampaignSchema);
normalizeSchemaPermissions(Campaign);
export default Campaign;

addModelData(Campaign, campaignViews);
validateSchemaDefAgainstMongoose(CampaignSchema, CampaignSchemaDef, "SwissOutreachCampaign", [
    "company",
    "parsedJob",
    "stats",
    "lastError",
]);

export type {Types};
