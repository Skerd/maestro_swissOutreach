import {buildCreateDataFromSchemaDef, buildUpdateDataFromSchemaDef} from "@coreModule/api/buildUpdateDataFromSchemaDef";
import {createCrudRouter} from "@coreModule/api/crudRouterFactory";
import {createProspectCompanyFormSchema} from "armonia/src/modules/swissOutreach/api/swissOutreach/private/prospectCompany/createProspectCompany.form.validator";
import {editProspectCompanyFormSchema} from "armonia/src/modules/swissOutreach/api/swissOutreach/private/prospectCompany/editProspectCompany.form.validator";
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
    defaultSort: {score: -1},
    buildCreateData: buildCreateDataFromSchemaDef(ProspectCompanySchemaDef),
    buildUpdateData: buildUpdateDataFromSchemaDef(ProspectCompanySchemaDef),
});
