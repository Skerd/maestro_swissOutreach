import type {ApiSelectDatum} from "armonia/src/modules/core/types/shared.types";
import type {IProspectCompany} from "@swissOutreachModule/database/schemas/prospectCompany/prospectCompany";

export function prospectCompanyToSelect(doc: IProspectCompany): ApiSelectDatum {
    return {
        value: doc._id.toString(),
        label: doc.companyName,
    };
}

export function prospectCompaniesToSelect(docs: IProspectCompany[]): ApiSelectDatum[] {
    return docs.map(prospectCompanyToSelect);
}
