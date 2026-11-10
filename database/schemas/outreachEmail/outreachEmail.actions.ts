import {action} from "@coreModule/api/actionDecorator";
import type {TransactionRequiredParams} from "@coreModule/utilities/middlewares/transactionUtils";
import {apiValidationException} from "armonia/src/modules/core/helpers/exceptions";
import {
    editOutreachEmailDraftFormSchema,
    outreachEmailIdFormSchema,
} from "armonia/src/modules/swissOutreach/api/swissOutreach/private/outreachEmail/outreachEmailAction.form.validator";
import type {OutreachEmail as OutreachEmailDto} from "armonia/src/modules/swissOutreach/api/swissOutreach/private/outreachEmail/outreachEmail.dto";
import type {IOutreachEmail} from "./outreachEmail";
import {outreachEmailService} from "./outreachEmail.service";
import {campaignService} from "../campaign/campaign.service";
import {prospectCompanyService} from "../prospectCompany/prospectCompany.service";
import {suppressedContactService} from "../suppressedContact/suppressedContact.service";
import {outreachEmailToDTO} from "@swissOutreachModule/utilities/mappers/outreachEmail/outreachEmailMapper.dto";

type EmailParams = TransactionRequiredParams & {emailId: string};
type EditDraftParams = EmailParams & {subject?: string; body?: string};

async function loadEmail(params: EmailParams): Promise<IOutreachEmail> {
    const {company, languageCode, emailId, session} = params;
    const email = await outreachEmailService.findOne({_id: emailId, company: company._id}, {withDeleted: false, languageCode, session});
    if (!email) throw apiValidationException("email_not_found", "emailId", null, languageCode);
    return email;
}

/** A sent email, or one a send has claimed, is history: it is not skipped or rewritten (D85). */
function refuseIfSent(email: IOutreachEmail, languageCode: string): void {
    if (email.status === "sent" || email.status === "queued") {
        throw apiValidationException("email_already_sent", "emailId", null, languageCode);
    }
}

/** Leaves the email's prospect out of its campaign; an approved email leaves the approved count. */
async function skipEmail(email: IOutreachEmail, session: TransactionRequiredParams["session"]): Promise<void> {
    const wasApproved = email.status === "approved";
    email.status = "skipped";
    await email.save({session});
    await prospectCompanyService.updateOne({_id: email.prospectCompanyId}, {$set: {status: "skipped"}}, {session});
    if (wasApproved) {
        await campaignService.updateOne({_id: email.campaignId}, {$inc: {"stats.approved": -1}}, {session});
    }
}

/** Review actions on one drafted email (D14, D86): each is its own role permission on `swissoutreachemails`. */
export class OutreachEmailActions {
    /** Approves the email for sending, with its prospect. */
    @action({auth: "private", transaction: true, rateLimit: {windowMs: 60000, max: 60}, schema: outreachEmailIdFormSchema})
    async approve(params: EmailParams): Promise<{data: OutreachEmailDto}> {
        const {languageCode, session} = params;
        const email = await loadEmail(params);
        if (!email.toEmail) throw apiValidationException("email_missing_recipient", "toEmail", null, languageCode);
        // Already approved, being sent or sent: unchanged, so a sent email never goes back into the send queue.
        if (email.status === "approved" || email.status === "sent" || email.status === "queued") {
            return {data: outreachEmailToDTO(email)};
        }
        email.status = "approved";
        await email.save({session});
        await prospectCompanyService.updateOne({_id: email.prospectCompanyId}, {$set: {status: "approved"}}, {session});
        await campaignService.updateOne({_id: email.campaignId}, {$inc: {"stats.approved": 1}}, {session});
        return {data: outreachEmailToDTO(email)};
    }

    /** Leaves the prospect out of this campaign. */
    @action({auth: "private", transaction: true, rateLimit: {windowMs: 60000, max: 60}, schema: outreachEmailIdFormSchema})
    async skip(params: EmailParams): Promise<{data: OutreachEmailDto}> {
        const {languageCode, session} = params;
        const email = await loadEmail(params);
        refuseIfSent(email, languageCode);
        await skipEmail(email, session);
        return {data: outreachEmailToDTO(email)};
    }

    /**
     * The recipient asked not to be contacted: their address goes on the company's do-not-contact list, so no campaign
     * drafts or sends to it again, and this email is skipped unless it is already sent or being sent.
     */
    @action({auth: "private", transaction: true, rateLimit: {windowMs: 60000, max: 60}, schema: outreachEmailIdFormSchema})
    async doNotContact(params: EmailParams): Promise<{data: OutreachEmailDto}> {
        const {company, languageCode, session, actionUserCtx} = params;
        const email = await loadEmail(params);
        if (!email.toEmail) throw apiValidationException("email_missing_recipient", "toEmail", null, languageCode);
        await suppressedContactService.suppressAddress(company._id, email.toEmail, {session, auditUserId: actionUserCtx.userId});
        if (email.status !== "sent" && email.status !== "queued" && email.status !== "skipped") {
            await skipEmail(email, session);
        }
        return {data: outreachEmailToDTO(email)};
    }

    /** A reviewer's rewrite; the email then needs approving again. */
    @action({auth: "private", transaction: true, rateLimit: {windowMs: 60000, max: 60}, schema: editOutreachEmailDraftFormSchema})
    async editDraft(params: EditDraftParams): Promise<{data: OutreachEmailDto}> {
        const {languageCode, subject, body, session} = params;
        const email = await loadEmail(params);
        refuseIfSent(email, languageCode);
        const wasApproved = email.status === "approved";
        if (subject) email.subject = subject;
        if (body) email.body = body;
        email.status = "edited";
        await email.save({session});
        if (wasApproved) {
            await campaignService.updateOne({_id: email.campaignId}, {$inc: {"stats.approved": -1}}, {session});
        }
        return {data: outreachEmailToDTO(email)};
    }
}
