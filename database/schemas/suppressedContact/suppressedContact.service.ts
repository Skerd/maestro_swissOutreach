import {BaseCrudService} from "@coreModule/database/services/baseCrudService";
import type {ObjectId} from "mongodb";
import type {ClientSession} from "mongoose";
import type {ICompany} from "@coreModule/database/schemas/company/company";
import SuppressedContact, {ISuppressedContact} from "./suppressedContact";

/** Why an email to a listed address was skipped, kept in its `lastError` (approval and the send loop both check). */
export const DO_NOT_CONTACT_SKIP_REASON = "The recipient is on the do-not-contact list.";

/** The domain part of an address, lower-cased (`""` when it has none). */
export function emailDomain(address: string): string {
    return address.slice(address.lastIndexOf("@") + 1).trim().toLowerCase();
}

export class SuppressedContactService extends BaseCrudService<ISuppressedContact, typeof SuppressedContact> {
    constructor() {
        super(SuppressedContact, "SwissOutreachSuppressedContact");
    }

    /**
     * The given addresses (lower-cased) that the company's do-not-contact list covers, by the address itself or its
     * domain. Every campaign of the company drafts and sends nothing to them.
     */
    async suppressedAmong(company: ObjectId | ICompany, addresses: readonly string[], session?: ClientSession): Promise<Set<string>> {
        const emails = [...new Set(addresses.map((address) => address.trim().toLowerCase()).filter(Boolean))];
        if (emails.length === 0) return new Set();
        const domains = [...new Set(emails.map(emailDomain).filter(Boolean))];
        const entries = await this.find(
            {company, $or: [{email: {$in: emails}}, {domain: {$in: domains}}]},
            {withDeleted: false, session},
            undefined,
            "email domain",
        );
        const blockedEmails = new Set(entries.map((entry) => entry.email).filter((email): email is string => !!email));
        const blockedDomains = new Set(entries.map((entry) => entry.domain).filter((domain): domain is string => !!domain));
        return new Set(emails.filter((email) => blockedEmails.has(email) || blockedDomains.has(emailDomain(email))));
    }

    /** Puts an address on the list (or back on it, when it was removed); an address already listed stays as it is. */
    async suppressAddress(
        company: ObjectId,
        address: string,
        options: {session: ClientSession; auditUserId: string; reason?: string},
    ): Promise<void> {
        const email = address.trim().toLowerCase();
        const existing = await this.findOne({company, email}, {withDeleted: true, session: options.session});
        if (existing?.deletedAt) {
            await this.restoreById(existing._id, {session: options.session, auditUserId: options.auditUserId});
        } else if (!existing) {
            await this.create(
                {company, email, source: "outreach_email", ...(options.reason ? {reason: options.reason} : {})},
                {session: options.session, auditUserId: options.auditUserId},
            );
        }
    }
}

export const suppressedContactService = new SuppressedContactService();
