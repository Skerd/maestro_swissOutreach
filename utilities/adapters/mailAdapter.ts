import {sendMail} from "@coreModule/utilities/emails/mailDeliveryService";
import {CONSTANTS, EMAIL} from "@coreModule/environment";
import {apiValidationException} from "armonia/src/modules/core/helpers/exceptions";
import type {MailPort, MailSendRequest, MailSendResult} from "@swissOutreachModule/utilities/ports";
import {randomUUID} from "crypto";

export class MailDeliveryAdapter implements MailPort {
    async send(request: MailSendRequest): Promise<MailSendResult> {
        // Core's sendMail returns without sending when email is turned off; that must not count as sent.
        if (!EMAIL.ENABLED) {
            throw apiValidationException("outreach_mail_disabled", null, null, CONSTANTS.DEFAULT_LANGUAGE);
        }
        await sendMail(request.companyId, {
            to: request.to,
            subject: request.subject,
            text: request.text,
            fromEmail: request.fromEmail,
            fromName: request.fromName,
            replyTo: request.replyTo || request.fromEmail,
        });
        // Core's sendMail does not return the transport's message id, so this one only names the send.
        return {
            accepted: true,
            messageId: `swiss-outreach-${randomUUID()}`,
        };
    }
}

export const mailDeliveryAdapter = new MailDeliveryAdapter();
