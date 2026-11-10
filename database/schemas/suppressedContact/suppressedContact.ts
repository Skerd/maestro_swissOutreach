import {Document, model, Schema, SchemaTypes} from "mongoose";
import {normalizeSchemaPermissions} from "@coreModule/database/utilities";
import ownershipPlugin from "@coreModule/database/plugins/ownershipPlugin";
import auditPlugin from "@coreModule/database/plugins/auditPlugin";
import softDeletePlugin from "@coreModule/database/plugins/softDeletePlugin";
import lifeCyclePlugin from "@coreModule/database/plugins/lifeCyclePlugin";
import {ILifeCyclePluginFields, IOwnershipPluginFields, ISoftDeletePluginFields} from "@coreModule/database/types/plugin-fields";
import {COLUMN_TYPE} from "armonia/src/modules/core/database/filter/typeOperators";
import {addModelData} from "@coreModule/database/collections";
import {validateSchemaDefAgainstMongoose} from "@coreModule/database/utilities/validateSchemaDefAgainstMongoose";
import {
    SUPPRESSED_CONTACT_DOMAIN_MAX,
    SUPPRESSED_CONTACT_REASON_MAX,
    SuppressedContactSchemaDef,
} from "armonia/src/modules/swissOutreach/api/swissOutreach/private/suppressedContact/suppressedContact.schema-def";
import {suppressionSourceValues, type SuppressionSourceValue} from "armonia/src/modules/swissOutreach/types/constants";
import {applySuppressedContactIndexes} from "./suppressedContact.indexes";
import {suppressedContactViews} from "./suppressedContact.views";

export interface ISuppressedContact extends Document, IOwnershipPluginFields, ISoftDeletePluginFields, ILifeCyclePluginFields {
    email?: string;
    domain?: string;
    reason?: string;
    source: SuppressionSourceValue;
}

/** Entries are never edited (removed and added again), so no field is writable after create. */
const readOnly = {self: {write: "no-permission"}, others: {write: "no-permission"}};

const SuppressedContactSchema = new Schema<ISuppressedContact>(
    {
        email: {
            type: SchemaTypes.String,
            trim: true,
            lowercase: true,
            permissions: readOnly,
            dynamicTableConfiguration: {filterable: true, sortable: true, cellType: COLUMN_TYPE.STRING},
        },
        domain: {
            type: SchemaTypes.String,
            trim: true,
            lowercase: true,
            maxlength: SUPPRESSED_CONTACT_DOMAIN_MAX,
            permissions: readOnly,
            dynamicTableConfiguration: {filterable: true, sortable: true, cellType: COLUMN_TYPE.STRING},
        },
        reason: {type: SchemaTypes.String, trim: true, maxlength: SUPPRESSED_CONTACT_REASON_MAX, permissions: readOnly},
        source: {
            type: SchemaTypes.String,
            enum: suppressionSourceValues,
            default: "manual",
            permissions: readOnly,
            dynamicTableConfiguration: {filterable: true, sortable: true, cellType: COLUMN_TYPE.ENUM},
        },
    },
    {accessMode: "loose"},
);

ownershipPlugin(SuppressedContactSchema);
auditPlugin(SuppressedContactSchema);
softDeletePlugin(SuppressedContactSchema);
lifeCyclePlugin(SuppressedContactSchema);
applySuppressedContactIndexes(SuppressedContactSchema);
const SuppressedContact = model<ISuppressedContact>("SwissOutreachSuppressedContact", SuppressedContactSchema);
normalizeSchemaPermissions(SuppressedContact);
export default SuppressedContact;

addModelData(SuppressedContact, suppressedContactViews);
// `source` is set by the server: "manual" from the list, "outreach_email" from the email's doNotContact action.
validateSchemaDefAgainstMongoose(SuppressedContactSchema, SuppressedContactSchemaDef, "SwissOutreachSuppressedContact", ["source"]);
