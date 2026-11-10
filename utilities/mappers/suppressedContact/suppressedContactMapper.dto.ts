import type {ISuppressedContact} from "@swissOutreachModule/database/schemas/suppressedContact/suppressedContact";
import type {SuppressedContact} from "armonia/src/modules/swissOutreach/api/swissOutreach/private/suppressedContact/suppressedContact.dto";
import {
    mapLifeCycleToDTO,
    mapOwnershipToDTO,
    mapSoftDeleteToDTO,
} from "@coreModule/utilities/mappers/plugin/pluginMappers.dto";

export function suppressedContactToDTO(doc: ISuppressedContact): SuppressedContact {
    return {
        _id: doc._id.toString(),
        email: doc.email,
        domain: doc.domain,
        reason: doc.reason,
        source: doc.source,
        ...mapSoftDeleteToDTO(doc),
        ...mapOwnershipToDTO(doc),
        ...mapLifeCycleToDTO(doc),
    };
}

export function suppressedContactsToDTO(docs: ISuppressedContact[]): SuppressedContact[] {
    return docs.map(suppressedContactToDTO);
}
