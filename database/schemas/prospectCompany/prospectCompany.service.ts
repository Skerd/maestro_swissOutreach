import {BaseCrudService} from "@coreModule/database/services/baseCrudService";
import ProspectCompany, {IProspectCompany} from "./prospectCompany";

export class ProspectCompanyService extends BaseCrudService<IProspectCompany, typeof ProspectCompany> {
    constructor() {
        super(ProspectCompany, "SwissOutreachProspectCompany");
    }
}

export const prospectCompanyService = new ProspectCompanyService();
