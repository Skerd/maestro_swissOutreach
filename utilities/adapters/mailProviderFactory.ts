import type {MailPort, MailSendRequest, MailSendResult} from "@swissOutreachModule/utilities/ports";
import {mailDeliveryAdapter} from "@swissOutreachModule/utilities/adapters/mailAdapter";
import {getLogger} from "@coreModule/loggers/serverLog";

const logger = getLogger("swissOutreach.mailFactory");

/**
 * Gmail / Microsoft 365 / generic SMTP all deliver through core mailDeliveryService.
 * Provider selection documents which SMTP profile operators should configure
 * (tenant smtpServer rows or EMAIL_* env). OAuth-native adapters can replace
 * this later without changing the orchestrator.
 */
export type MailProviderKind = "smtp" | "gmail" | "microsoft365";

export function resolveMailProviderKind(): MailProviderKind {
    const raw = (process.env.SWISS_OUTREACH_EMAIL_PROVIDER || "smtp").toLowerCase();
    if (raw === "gmail") return "gmail";
    if (raw === "microsoft365" || raw === "m365" || raw === "office365") return "microsoft365";
    return "smtp";
}

export class DocumentedMailAdapter implements MailPort {
    constructor(
        private readonly kind: MailProviderKind,
        private readonly inner: MailPort = mailDeliveryAdapter,
    ) {}

    async send(request: MailSendRequest): Promise<MailSendResult> {
        logger.debug(`Sending via mail provider preset=${this.kind}`);
        return this.inner.send(request);
    }
}

export function createMailPort(): MailPort {
    return new DocumentedMailAdapter(resolveMailProviderKind());
}

/** Suggested SMTP hosts for operator configuration (not auto-connected). */
export const MAIL_PROVIDER_PRESETS: Record<MailProviderKind, {host: string; port: number; encryption: string}> = {
    smtp: {host: "localhost", port: 587, encryption: "starttls"},
    gmail: {host: "smtp.gmail.com", port: 587, encryption: "starttls"},
    microsoft365: {host: "smtp.office365.com", port: 587, encryption: "starttls"},
};
