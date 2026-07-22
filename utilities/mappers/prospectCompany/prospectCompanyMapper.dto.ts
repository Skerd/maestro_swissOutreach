import type {IProspectCompany} from "@swissOutreachModule/database/schemas/prospectCompany/prospectCompany";
import type {ProspectCompany} from "armonia/src/modules/swissOutreach/api/swissOutreach/private/prospectCompany/prospectCompany.dto";
import {
    mapLifeCycleToDTO,
    mapOwnershipToDTO,
    mapSoftDeleteToDTO,
} from "@coreModule/utilities/mappers/plugin/pluginMappers.dto";

export function prospectCompanyToDTO(doc: IProspectCompany): ProspectCompany {
    return {
        _id: doc._id.toString(),
        campaignId: doc.campaignId.toString(),
        companyName: doc.companyName,
        uid: doc.uid,
        canton: doc.canton,
        legalForm: doc.legalForm,
        registerUrl: doc.registerUrl,
        website: doc.website,
        websiteConfidence: doc.websiteConfidence,
        emails: doc.emails || [],
        phones: doc.phones || [],
        city: doc.city,
        postalCode: doc.postalCode,
        languages: doc.languages || [],
        summary: doc.summary,
        services: doc.services || [],
        score: doc.score,
        scoreReason: doc.scoreReason,
        status: doc.status,
        dedupeKey: doc.dedupeKey,
        ...mapSoftDeleteToDTO(doc),
        ...mapOwnershipToDTO(doc),
        ...mapLifeCycleToDTO(doc),
    };
}

export function prospectCompaniesToDTO(docs: IProspectCompany[]): ProspectCompany[] {
    return docs.map(prospectCompanyToDTO);
}
