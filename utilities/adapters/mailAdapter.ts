import {sendMail} from "@coreModule/utilities/emails/mailDeliveryService";
import {CONSTANTS, EMAIL} from "@coreModule/environment";
import {apiValidationException} from "armonia/src/modules/core/helpers/exceptions";
import type {MailPort, MailSendRequest, MailSendResult} from "@swissOutreachModule/utilities/ports";

export class MailDeliveryAdapter implements MailPort {
    async send(request: MailSendRequest): Promise<MailSendResult> {
        // Core's sendMail returns without sending when email is turned off; that must not count as sent.
        if (!EMAIL.ENABLED) {
            throw apiValidationException("outreach_mail_disabled", null, null, CONSTANTS.DEFAULT_LANGUAGE);
        }
        // The transport's own id is what replies (In-Reply-To) and bounces carry, so it is the one stored.
        const {messageId} = await sendMail(request.companyId, {
            to: request.to,
            subject: request.subject,
            text: request.text,
            fromEmail: request.fromEmail,
            fromName: request.fromName,
            replyTo: request.replyTo || request.fromEmail,
        });
        return {accepted: true, messageId};
    }
}

export const mailDeliveryAdapter = new MailDeliveryAdapter();
