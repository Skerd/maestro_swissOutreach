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
    buildCreateData: buildCreateDataFromSchemaDef(OutreachEmailSchemaDef),
    buildUpdateData: buildUpdateDataFromSchemaDef(OutreachEmailSchemaDef),
    // approve / skip / editDraft (D86)
    actions: OutreachEmailActions,
});
