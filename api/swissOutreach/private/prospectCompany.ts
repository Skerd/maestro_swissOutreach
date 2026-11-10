import {ObjectId} from "mongodb";
import {buildCreateDataFromSchemaDef, buildUpdateDataFromSchemaDef} from "@coreModule/api/buildUpdateDataFromSchemaDef";
import {createCrudRouter} from "@coreModule/api/crudRouterFactory";
import {createProspectCompanyFormSchema} from "armonia/src/modules/swissOutreach/api/swissOutreach/private/prospectCompany/createProspectCompany.form.validator";
import {editProspectCompanyFormSchema} from "armonia/src/modules/swissOutreach/api/swissOutreach/private/prospectCompany/editProspectCompany.form.validator";
import {prospectCompanyListFormSchema} from "armonia/src/modules/swissOutreach/api/swissOutreach/private/prospectCompany/prospectCompanyList.form.validator";
import {ProspectCompanySchemaDef} from "armonia/src/modules/swissOutreach/api/swissOutreach/private/prospectCompany/prospectCompany.schema-def";
import ProspectCompany from "@swissOutreachModule/database/schemas/prospectCompany/prospectCompany";
import {prospectCompanyService} from "@swissOutreachModule/database/schemas/prospectCompany/prospectCompany.service";
import {
    prospectCompaniesToDTO,
    prospectCompanyToDTO,
} from "@swissOutreachModule/utilities/mappers/prospectCompany/prospectCompanyMapper.dto";
import {prospectCompaniesToSelect} from "@swissOutreachModule/utilities/mappers/prospectCompany/prospectCompanyMapper.select";

export const {router} = createCrudRouter({
    collectionName: "swissoutreachprospectcompanies",
    model: ProspectCompany,
    service: prospectCompanyService,
    entityName: "SwissOutreachProspectCompany",
    createSchema: createProspectCompanyFormSchema,
    editSchema: editProspectCompanyFormSchema,
    toDTO: prospectCompanyToDTO,
    toDTOArray: prospectCompaniesToDTO,
    toSelect: prospectCompaniesToSelect,
    selectSearchField: "companyName",
    defaultSort: {score: -1},
    // `ids`: the prospects of the emails one approval page shows (the DSL filter does not take `_id`).
    listSchema: prospectCompanyListFormSchema,
    extraListFilter: ({ids}) => (ids ? {_id: {$in: ids.map((id: string) => new ObjectId(id))}} : {}),
    // Never reached: the model's create permission is "no-permission" (only the pipeline finds prospects).
    buildCreateData: buildCreateDataFromSchemaDef(ProspectCompanySchemaDef),
    buildUpdateData: buildUpdateDataFromSchemaDef(ProspectCompanySchemaDef),
});
