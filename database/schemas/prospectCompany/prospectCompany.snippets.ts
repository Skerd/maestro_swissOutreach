import type {ProspectCompanySimple} from "armonia/src/modules/swissOutreach/dto/prospectCompany.dto";
import type {IProspectCompany} from "@swissOutreachModule/database/schemas/prospectCompany/prospectCompany";
import {defineSnippet} from "@coreModule/database/utilities/snippet";

export const ProspectCompanySimpleSnippet = defineSnippet<IProspectCompany, ProspectCompanySimple>()({
    keys: {
        companyName: {},
        uid: {},
        score: {},
        status: {},
    },
});
