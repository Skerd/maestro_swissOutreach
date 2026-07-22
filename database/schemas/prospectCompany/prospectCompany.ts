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
import {ProspectCompanySchemaDef} from "armonia/src/modules/swissOutreach/api/swissOutreach/private/prospectCompany/prospectCompany.schema-def";
import {prospectStatusValues} from "armonia/src/modules/swissOutreach/types/constants";
import {applyProspectCompanyIndexes} from "./prospectCompany.indexes";
import {prospectCompanyViews} from "./prospectCompany.views";

export interface IProspectCompany
    extends Document,
        IOwnershipPluginFields,
        ISoftDeletePluginFields,
        ILifeCyclePluginFields {
    campaignId: Types.ObjectId;
    companyName: string;
    uid?: string;
    canton?: string;
    legalForm?: string;
    registerUrl?: string;
    website?: string;
    websiteConfidence?: number;
    emails: string[];
    phones: string[];
    city?: string;
    postalCode?: string;
    languages: string[];
    summary?: string;
    services: string[];
    score?: number;
    scoreReason?: string;
    status: (typeof prospectStatusValues)[number];
    dedupeKey: string;
}

const ProspectCompanySchema = new Schema<IProspectCompany>(
    {
        campaignId: {
            type: SchemaTypes.ObjectId,
            ref: "SwissOutreachCampaign",
            required: true,
            dynamicTableConfiguration: {filterable: true, sortable: true, cellType: COLUMN_TYPE.OBJECT_ID},
        },
        companyName: {
            type: SchemaTypes.String,
            required: true,
            trim: true,
            dynamicTableConfiguration: {filterable: true, sortable: true, cellType: COLUMN_TYPE.TEXT},
        },
        uid: {type: SchemaTypes.String, required: false, trim: true},
        canton: {
            type: SchemaTypes.String,
            required: false,
            dynamicTableConfiguration: {filterable: true, sortable: true, cellType: COLUMN_TYPE.TEXT},
        },
        legalForm: {type: SchemaTypes.String, required: false},
        registerUrl: {type: SchemaTypes.String, required: false},
        website: {type: SchemaTypes.String, required: false},
        websiteConfidence: {type: SchemaTypes.Number, required: false, min: 0, max: 100},
        emails: {type: [SchemaTypes.String], default: []},
        phones: {type: [SchemaTypes.String], default: []},
        city: {type: SchemaTypes.String, required: false},
        postalCode: {type: SchemaTypes.String, required: false},
        languages: {type: [SchemaTypes.String], default: []},
        summary: {type: SchemaTypes.String, required: false},
        services: {type: [SchemaTypes.String], default: []},
        score: {
            type: SchemaTypes.Number,
            required: false,
            min: 0,
            max: 100,
            dynamicTableConfiguration: {filterable: true, sortable: true, cellType: COLUMN_TYPE.NUMBER},
        },
        scoreReason: {type: SchemaTypes.String, required: false},
        status: {
            type: SchemaTypes.String,
            enum: prospectStatusValues,
            default: "discovered",
            dynamicTableConfiguration: {filterable: true, sortable: true, cellType: COLUMN_TYPE.ENUM},
        },
        dedupeKey: {type: SchemaTypes.String, required: true},
    },
    {accessMode: "loose"},
);

ownershipPlugin(ProspectCompanySchema);
auditPlugin(ProspectCompanySchema);
softDeletePlugin(ProspectCompanySchema);
lifeCyclePlugin(ProspectCompanySchema);
applyProspectCompanyIndexes(ProspectCompanySchema);

const ProspectCompany = model<IProspectCompany>("SwissOutreachProspectCompany", ProspectCompanySchema);
normalizeSchemaPermissions(ProspectCompany);
export default ProspectCompany;

addModelData(ProspectCompany, prospectCompanyViews);
validateSchemaDefAgainstMongoose(ProspectCompanySchema, ProspectCompanySchemaDef, "SwissOutreachProspectCompany", [
    "company",
]);
