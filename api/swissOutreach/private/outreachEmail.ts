import {buildCreateDataFromSchemaDef, buildUpdateDataFromSchemaDef} from "@coreModule/api/buildUpdateDataFromSchemaDef";
import {createCrudRouter} from "@coreModule/api/crudRouterFactory";
import {createOutreachEmailFormSchema} from "armonia/src/modules/swissOutreach/api/swissOutreach/private/outreachEmail/createOutreachEmail.form.validator";
import {editOutreachEmailFormSchema} from "armonia/src/modules/swissOutreach/api/swissOutreach/private/outreachEmail/editOutreachEmail.form.validator";
import {OutreachEmailSchemaDef} from "armonia/src/modules/swissOutreach/api/swissOutreach/private/outreachEmail/outreachEmail.schema-def";
import OutreachEmail from "@swissOutreachModule/database/schemas/outreachEmail/outreachEmail";
import {outreachEmailService} from "@swissOutreachModule/database/schemas/outreachEmail/outreachEmail.service";
import {
    outreachEmailsToDTO,
    outreachEmailToDTO,
} from "@swissOutreachModule/utilities/mappers/outreachEmail/outreachEmailMapper.dto";
import {OutreachEmailActions} from "@swissOutreachModule/database/schemas/outreachEmail/outreachEmail.actions";
import {outreachEmailsToSelect} from "@swissOutreachModule/utilities/mappers/outreachEmail/outreachEmailMapper.select";
import {apiValidationException} from "armonia/src/modules/core/helpers/exceptions";
import type {OutreachEmailStatusValue} from "armonia/src/modules/swissOutreach/types/constants";

/**
 * An email still waiting for a decision. An approved email is changed only through `editDraft`, which takes the
 * approval back; one being sent or sent is history.
 */
const EDITABLE: OutreachEmailStatusValue[] = ["draft", "edited", "skipped", "failed"];

export const {router} = createCrudRouter({
    collectionName: "swissoutreachemails",
    model: OutreachEmail,
    service: outreachEmailService,
    entityName: "SwissOutreachEmail",
    createSchema: createOutreachEmailFormSchema,
    editSchema: editOutreachEmailFormSchema,
    toDTO: outreachEmailToDTO,
    toDTOArray: outreachEmailsToDTO,
    toSelect: outreachEmailsToSelect,
    selectSearchField: "subject",
    defaultSort: {createdAt: -1},
    // Never reached: the model's create permission is "no-permission" (only the pipeline drafts emails).
    buildCreateData: buildCreateDataFromSchemaDef(OutreachEmailSchemaDef),
    buildUpdateData: (params, writeFields) => {
        if (!EDITABLE.includes(params.existing.status)) {
            throw apiValidationException("email_not_editable", "emailId", null, params.languageCode);
        }
        return buildUpdateDataFromSchemaDef(OutreachEmailSchemaDef)(params, writeFields);
    },
    // approve / skip / editDraft / doNotContact (D86)
    actions: OutreachEmailActions,
});
