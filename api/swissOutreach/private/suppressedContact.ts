import {buildCreateDataFromSchemaDef, buildUpdateDataFromSchemaDef} from "@coreModule/api/buildUpdateDataFromSchemaDef";
import {createCrudRouter} from "@coreModule/api/crudRouterFactory";
import {SuppressedContactSchemaDef} from "armonia/src/modules/swissOutreach/api/swissOutreach/private/suppressedContact/suppressedContact.schema-def";
import {createSuppressedContactFormSchema} from "armonia/src/modules/swissOutreach/api/swissOutreach/private/suppressedContact/createSuppressedContact.form.validator";
import {editSuppressedContactFormSchema} from "armonia/src/modules/swissOutreach/api/swissOutreach/private/suppressedContact/editSuppressedContact.form.validator";
import SuppressedContact from "@swissOutreachModule/database/schemas/suppressedContact/suppressedContact";
import {suppressedContactService} from "@swissOutreachModule/database/schemas/suppressedContact/suppressedContact.service";
import {
    suppressedContactsToDTO,
    suppressedContactToDTO,
} from "@swissOutreachModule/utilities/mappers/suppressedContact/suppressedContactMapper.dto";
import {suppressedContactsToSelect} from "@swissOutreachModule/utilities/mappers/suppressedContact/suppressedContactMapper.select";

/** The company's do-not-contact list: every campaign skips these addresses and domains when it drafts and sends. */
export const {router} = createCrudRouter({
    collectionName: "swissoutreachsuppressedcontacts",
    model: SuppressedContact,
    service: suppressedContactService,
    entityName: "SwissOutreachSuppressedContact",
    createSchema: createSuppressedContactFormSchema,
    // No field is writable after create, so an edit is refused (entries are removed and added again).
    editSchema: editSuppressedContactFormSchema,
    toDTO: suppressedContactToDTO,
    toDTOArray: suppressedContactsToDTO,
    toSelect: suppressedContactsToSelect,
    selectSearchField: "email",
    defaultSort: {createdAt: -1},
    buildCreateData: (params) => ({...buildCreateDataFromSchemaDef(SuppressedContactSchemaDef)(params), source: "manual"}),
    buildUpdateData: buildUpdateDataFromSchemaDef(SuppressedContactSchemaDef),
});
