import type {ApiSelectDatum} from "armonia/src/modules/core/types/shared.types";
import type {IOutreachEmail} from "@swissOutreachModule/database/schemas/outreachEmail/outreachEmail";

export function outreachEmailToSelect(doc: IOutreachEmail): ApiSelectDatum {
    return {
        value: doc._id.toString(),
        label: doc.subject,
    };
}

export function outreachEmailsToSelect(docs: IOutreachEmail[]): ApiSelectDatum[] {
    return docs.map(outreachEmailToSelect);
}
