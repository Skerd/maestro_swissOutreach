import {
    ERASED_EMAIL,
    ERASED_NAME,
    objectIds as ids,
    registerPersonEraser,
    type ErasureContext,
    type ErasureCount,
} from "@coreModule/utilities/erasure/personErasure";
import {escapeRegex} from "@coreModule/utilities/helpers";
import {campaignService} from "@swissOutreachModule/database/schemas/campaign/campaign.service";
import {outreachEmailService} from "@swissOutreachModule/database/schemas/outreachEmail/outreachEmail.service";
import {prospectCompanyService} from "@swissOutreachModule/database/schemas/prospectCompany/prospectCompany.service";

/**
 * A company's outreach records of one person (D57), found by email: prospects lose the address and the phone numbers
 * found next to it; emails written to them lose their recipient (and the send error that may name it), keeping the
 * text and dates; a campaign they sent becomes "Erased person" without contact details. The do-not-contact list is
 * kept: it is how the company goes on honouring their request not to be contacted.
 */
async function eraseSwissOutreachPerson(ctx: ErasureContext): Promise<ErasureCount[]> {
    const {companyId, subject, preview, session} = ctx;
    if (subject.emails.length === 0) return [];
    const found = {session, withDeleted: true};
    const erased = new Set(subject.emails);

    // Addresses are stored as the crawler or the sender wrote them; erasure matches them case-blind.
    const anyCase = subject.emails.map((email) => new RegExp(`^${escapeRegex(email)}$`, "i"));
    const prospects = await prospectCompanyService.find({company: companyId, emails: {$in: anyCase}}, found, undefined, "_id emails");
    const emails = await outreachEmailService.find({company: companyId, toEmail: {$in: anyCase}}, found, undefined, "_id");
    const campaigns = await campaignService.find({company: companyId, senderEmail: {$in: anyCase}}, found, undefined, "_id");
    const counts: ErasureCount[] = [
        {collection: "swissoutreachprospectcompanies", anonymised: prospects.length, deleted: 0},
        {collection: "swissoutreachemails", anonymised: emails.length, deleted: 0},
        {collection: "swissoutreachcampaigns", anonymised: campaigns.length, deleted: 0},
    ];
    if (preview) return counts;

    for (const prospect of prospects) {
        const kept = prospect.emails.filter((email) => !erased.has(email.trim().toLowerCase()));
        await prospectCompanyService.eraseFields({company: companyId, _id: prospect._id}, {$set: {emails: kept, phones: []}}, {session});
    }
    if (prospects.length > 0) ctx.scrubAudit("swissoutreachprospectcompanies", ids(prospects), ["emails", "phones"]);

    if (emails.length > 0) {
        await outreachEmailService.eraseFields({company: companyId, _id: {$in: ids(emails)}}, {$unset: {toEmail: "", lastError: ""}}, {session});
        ctx.scrubAudit("swissoutreachemails", ids(emails), ["toEmail", "lastError"]);
    }
    if (campaigns.length > 0) {
        await campaignService.eraseFields({company: companyId, _id: {$in: ids(campaigns)}}, {
            $set: {senderEmail: ERASED_EMAIL, senderName: ERASED_NAME},
            $unset: {senderPhone: ""},
        }, {session});
        ctx.scrubAudit("swissoutreachcampaigns", ids(campaigns), ["senderEmail", "senderName", "senderPhone"]);
    }
    return counts;
}

export function registerSwissOutreachPersonErasers(): void {
    registerPersonEraser({module: "swissOutreach", erase: eraseSwissOutreachPerson});
}
