import {BaseCrudService} from "@coreModule/database/services/baseCrudService";
import ProspectCompany, {IProspectCompany} from "./prospectCompany";
import type {FilterQuery} from "mongoose";

export class ProspectCompanyService extends BaseCrudService<IProspectCompany, typeof ProspectCompany> {
    constructor() {
        super(ProspectCompany, "SwissOutreachProspectCompany");
    }

    /** Inserts the prospect unless the campaign already has it (same dedupe key). */
    insertIfNew(filter: FilterQuery<IProspectCompany>, onInsert: Partial<IProspectCompany>) {
        return this.model.findOneAndUpdate(filter, {$setOnInsert: onInsert}, {upsert: true, new: true});
    }
}

export const prospectCompanyService = new ProspectCompanyService();
