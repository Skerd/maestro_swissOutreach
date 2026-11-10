import type {IOutreachEmail} from "@swissOutreachModule/database/schemas/outreachEmail/outreachEmail";
import type {OutreachEmail} from "armonia/src/modules/swissOutreach/api/swissOutreach/private/outreachEmail/outreachEmail.dto";
import {
    mapLifeCycleToDTO,
    mapOwnershipToDTO,
    mapSoftDeleteToDTO,
} from "@coreModule/utilities/mappers/plugin/pluginMappers.dto";
import {nestedEntityToRef, objectIdToString} from "@coreModule/utilities/mappers/common.mapper";

export function outreachEmailToDTO(doc: IOutreachEmail): OutreachEmail {
    return {
        _id: doc._id.toString(),
        // The generic list populates refs; send the id either way.
        campaignId: objectIdToString(nestedEntityToRef(doc.campaignId)),
        prospectCompanyId: objectIdToString(nestedEntityToRef(doc.prospectCompanyId)),
        toEmail: doc.toEmail,
        subject: doc.subject,
        body: doc.body,
        language: doc.language,
        status: doc.status,
        messageId: doc.messageId,
        sentAt: doc.sentAt ? doc.sentAt.toISOString() : undefined,
        attempts: doc.attempts || 0,
        lastError: doc.lastError,
        ...mapSoftDeleteToDTO(doc),
        ...mapOwnershipToDTO(doc),
        ...mapLifeCycleToDTO(doc),
    };
}

export function outreachEmailsToDTO(docs: IOutreachEmail[]): OutreachEmail[] {
    return docs.map(outreachEmailToDTO);
}
