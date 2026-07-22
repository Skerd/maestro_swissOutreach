import {sendMail} from "@coreModule/utilities/emails/mailDeliveryService";
import type {MailPort, MailSendRequest, MailSendResult} from "@swissOutreachModule/utilities/ports";
import {randomUUID} from "crypto";

export class MailDeliveryAdapter implements MailPort {
    async send(request: MailSendRequest): Promise<MailSendResult> {
        await sendMail(request.companyId, {
            to: request.to,
            subject: request.subject,
            text: request.text,
            fromEmail: request.fromEmail,
            fromName: request.fromName,
            replyTo: request.replyTo || request.fromEmail,
        });
        return {
            accepted: true,
            messageId: `swiss-outreach-${randomUUID()}`,
        };
    }
}

export const mailDeliveryAdapter = new MailDeliveryAdapter();
