import {
    EMAIL_COMPOSE_SYSTEM_PROMPT,
    buildEmailComposeUserPrompt,
    COMPANY_SUMMARY_SYSTEM_PROMPT,
    buildCompanySummaryUserPrompt,
    OUTREACH_OPT_OUT_LINES,
} from "armonia/src/modules/swissOutreach/prompts/outreachPrompts";
import type {OutreachLanguageValue} from "armonia/src/modules/swissOutreach/types/constants";
import type {LlmPort} from "@swissOutreachModule/utilities/ports";
import {getLogger} from "@coreModule/loggers/serverLog";

const logger = getLogger("swissOutreach.emailGen");

export async function summarizeCompany(
    llm: LlmPort,
    input: {
        companyName: string;
        legalForm?: string;
        canton?: string;
        websiteText: string;
        services: string[];
    },
): Promise<string> {
    try {
        const text = await llm.completeText(
            COMPANY_SUMMARY_SYSTEM_PROMPT,
            buildCompanySummaryUserPrompt(input),
        );
        return text.trim().slice(0, 1200);
    } catch (err) {
        logger.warn(`Summary LLM failed: ${err instanceof Error ? err.message : String(err)}`);
        const services = input.services.join(", ") || "general services";
        return `${input.companyName} (${input.legalForm || "company"}) based in ${input.canton || "Switzerland"} appears to offer ${services}.`;
    }
}

/** The body ending with the opt-out sentence in the email's language, added when the writer left it out. */
function withOptOut(body: string, language: OutreachLanguageValue): string {
    const line = OUTREACH_OPT_OUT_LINES[language];
    return body.includes(line) ? body : `${body.trimEnd()}\n\n${line}`;
}

/** Drafts one outreach email; every draft ends with the opt-out sentence, whoever wrote it. */
export async function generateOutreachEmail(
    llm: LlmPort,
    input: {
        language: OutreachLanguageValue;
        emailTone: string;
        jobDescription: string;
        companySummary: string;
        services: string[];
        companyName: string;
        senderCompanyName: string;
        senderName: string;
        senderEmail: string;
        senderPhone?: string;
        senderWebsite?: string;
        additionalNotes?: string;
    },
): Promise<{subject: string; body: string}> {
    try {
        const result = await llm.completeJson<{subject: string; body: string}>(
            EMAIL_COMPOSE_SYSTEM_PROMPT,
            buildEmailComposeUserPrompt(input),
        );
        if (result?.subject && result?.body) {
            return {subject: result.subject.slice(0, 300), body: withOptOut(result.body, input.language)};
        }
    } catch (err) {
        logger.warn(`Email LLM failed, using template: ${err instanceof Error ? err.message : String(err)}`);
    }
    const fallback = fallbackEmail(input);
    return {...fallback, body: withOptOut(fallback.body, input.language)};
}

function fallbackEmail(input: {
    language: OutreachLanguageValue;
    companyName: string;
    jobDescription: string;
    senderCompanyName: string;
    senderName: string;
    senderEmail: string;
    senderPhone?: string;
}): {subject: string; body: string} {
    const templates: Record<OutreachLanguageValue, {subject: string; body: string}> = {
        de: {
            subject: `Anfrage Offerte – ${input.senderCompanyName}`,
            body: `Guten Tag ${input.companyName},\n\nmein Name ist ${input.senderName} von ${input.senderCompanyName}. Wir suchen eine Offerte für folgendes Projekt:\n\n${input.jobDescription}\n\nKönnten Sie uns bitte eine Offerte zusenden?\n\nMit freundlichen Grüssen\n${input.senderName}\n${input.senderEmail}${input.senderPhone ? `\n${input.senderPhone}` : ""}`,
        },
        fr: {
            subject: `Demande de devis – ${input.senderCompanyName}`,
            body: `Bonjour ${input.companyName},\n\nJe m'appelle ${input.senderName} de ${input.senderCompanyName}. Nous souhaitons obtenir un devis pour le projet suivant:\n\n${input.jobDescription}\n\nPourriez-vous nous transmettre une offre?\n\nCordialement\n${input.senderName}\n${input.senderEmail}${input.senderPhone ? `\n${input.senderPhone}` : ""}`,
        },
        it: {
            subject: `Richiesta di preventivo – ${input.senderCompanyName}`,
            body: `Buongiorno ${input.companyName},\n\nMi chiamo ${input.senderName} di ${input.senderCompanyName}. Desideriamo un preventivo per il seguente progetto:\n\n${input.jobDescription}\n\nPotreste inviarci un'offerta?\n\nCordiali saluti\n${input.senderName}\n${input.senderEmail}${input.senderPhone ? `\n${input.senderPhone}` : ""}`,
        },
        en: {
            subject: `Quotation request – ${input.senderCompanyName}`,
            body: `Hello ${input.companyName},\n\nMy name is ${input.senderName} from ${input.senderCompanyName}. We would like a quotation for the following project:\n\n${input.jobDescription}\n\nCould you please send us a quote?\n\nKind regards\n${input.senderName}\n${input.senderEmail}${input.senderPhone ? `\n${input.senderPhone}` : ""}`,
        },
    };
    return templates[input.language];
}
