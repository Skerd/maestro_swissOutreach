import type {ApiSelectDatum} from "armonia/src/modules/core/types/shared.types";
import type {ISuppressedContact} from "@swissOutreachModule/database/schemas/suppressedContact/suppressedContact";

export function suppressedContactToSelect(doc: ISuppressedContact): ApiSelectDatum {
    return {
        value: doc._id.toString(),
        label: doc.email ?? doc.domain ?? "",
    };
}

export function suppressedContactsToSelect(docs: ISuppressedContact[]): ApiSelectDatum[] {
    return docs.map(suppressedContactToSelect);
}
