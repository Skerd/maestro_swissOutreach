import {describe, expect, it} from "vitest";
import {buildDedupeKey, heuristicParseJob, scoreProspect, type ScoreInput} from "@swissOutreachModule/utilities/scoring/scoreProspect";
import {preferContactEmail} from "@swissOutreachModule/utilities/adapters/contactExtractor";
import {JobParser} from "@swissOutreachModule/utilities/pipeline/jobParser";
import {generateOutreachEmail, summarizeCompany} from "@swissOutreachModule/utilities/pipeline/emailGenerator";
import type {LlmPort} from "@swissOutreachModule/utilities/ports";
import {OUTREACH_OPT_OUT_LINES} from "armonia/src/modules/swissOutreach/prompts/outreachPrompts";

/** A prospect with no public signals at all. */
const bare: ScoreInput = {emails: [], services: [], campaignCantons: [], languages: [], campaignLanguage: "de", keywords: []};

/** An LLM that answers every call with `json` / `text`, or fails when given an Error. */
function fakeLlm(json: unknown, text: string | Error = "summary"): LlmPort & {calls: {system: string; user: string}[]} {
    const calls: {system: string; user: string}[] = [];
    return {
        calls,
        async completeJson<T>(system: string, user: string): Promise<T> {
            calls.push({system, user});
            if (json instanceof Error) throw json;
            return json as T;
        },
        async completeText(system: string, user: string): Promise<string> {
            calls.push({system, user});
            if (text instanceof Error) throw text;
            return text;
        },
    };
}

const draftInput = {
    language: "fr" as const,
    emailTone: "professional",
    jobDescription: "Rénovation de deux salles de bains à Genève.",
    companySummary: "Plombier à Genève.",
    services: ["Sanitär"],
    companyName: "Plomberie Léman SA",
    senderCompanyName: "Buyer AG",
    senderName: "Ada",
    senderEmail: "ada@buyer.ch",
    senderPhone: "+41 79 000 00 00",
};

describe("prospect scoring", () => {
    it("gives a prospect with no public signals the base score", () => {
        expect(scoreProspect(bare)).toEqual({score: 20, reason: "limited public signals"});
    });

    it("adds the confidence bonus from 70 upwards only", () => {
        expect(scoreProspect({...bare, website: "https://a.ch", websiteConfidence: 69}).score).toBe(35);
        const confident = scoreProspect({...bare, website: "https://a.ch", websiteConfidence: 70});
        expect(confident.score).toBe(45);
        expect(confident.reason).toBe("official website found; high website confidence");
        // Confidence without a website counts for nothing
        expect(scoreProspect({...bare, websiteConfidence: 95}).score).toBe(20);
    });

    it("scores contact email, canton (any case) and language", () => {
        const result = scoreProspect({...bare, emails: ["info@a.ch"], canton: "bs", campaignCantons: ["BS"], languages: ["de"]});
        expect(result.score).toBe(20 + 20 + 15 + 10);
        expect(result.reason).toBe("contact email found; canton match (bs); language match");
        // A canton outside the campaign's list and another language score nothing
        expect(scoreProspect({...bare, canton: "ZH", campaignCantons: ["BS"], languages: ["fr"]}).score).toBe(20);
    });

    it("gives 5 points per keyword found, capped at 20, and names the first three", () => {
        const keywords = ["sanitär", "heizung", "elektro", "lüftung", "dach"];
        const result = scoreProspect({...bare, keywords, textBlob: "Sanitär Heizung Elektro Lüftung Dach"});
        expect(result.score).toBe(40);
        expect(result.reason).toBe("relevant services (sanitär, heizung, elektro)");
        // Keywords are found in the summary and services too, ignoring case
        expect(scoreProspect({...bare, keywords: ["Plumbing", "HVAC"], summary: "plumbing", services: ["hvac"]}).score).toBe(30);
    });

    it("adds 5 for a summary longer than 40 characters, without a reason", () => {
        expect(scoreProspect({...bare, summary: "x".repeat(40)}).score).toBe(20);
        expect(scoreProspect({...bare, summary: "x".repeat(41)})).toEqual({score: 25, reason: "limited public signals"});
    });

    it("never scores above 100", () => {
        const result = scoreProspect({
            website: "https://a.ch", websiteConfidence: 90, emails: ["info@a.ch"], services: ["Sanitär"], canton: "BS", campaignCantons: ["BS"],
            summary: "A plumbing company in Basel doing bathroom renovations.", languages: ["de"], campaignLanguage: "de",
            keywords: ["plumbing", "sanitär", "basel", "bathroom"], textBlob: "",
        });
        expect(result.score).toBe(100);
    });
});

describe("prospect dedupe key", () => {
    it("uses the register UID without spaces, upper-cased", () => {
        expect(buildDedupeKey(" che-123.456 789 ", "Other AG", "ZH")).toBe("CHE-123.456789");
    });

    it("falls back to the trimmed lower-cased name and upper-cased canton", () => {
        expect(buildDedupeKey(undefined, "  Acme AG ", "zh")).toBe("acme ag|ZH");
        expect(buildDedupeKey(undefined, "Acme AG")).toBe("acme ag|");
    });
});

describe("contact email choice", () => {
    it("prefers a sales/info-style address and avoids no-reply and jobs addresses", () => {
        expect(preferContactEmail(["jobs@a.ch", "info@a.ch"])).toBe("info@a.ch");
        expect(preferContactEmail(["noreply@a.ch", "peter@a.ch"])).toBe("peter@a.ch");
        expect(preferContactEmail([])).toBeUndefined();
    });
});

describe("job parsing", () => {
    it("uses the LLM's keywords and fills the missing parts", async () => {
        const parsed = await new JobParser(fakeLlm({keywords: ["Sanitär"], germanEquivalents: ["Sanitär"]})).parse("Bad renovieren", "de");
        expect(parsed).toEqual({
            industry: "Unknown", companyTypes: [], synonyms: [], germanEquivalents: ["Sanitär"], frenchEquivalents: [],
            italianEquivalents: [], nogaCategories: [], keywords: ["Sanitär"],
        });
    });

    it("falls back to the heuristic when the LLM gives no keywords or fails", async () => {
        const job = "Bathroom renovation with a new electrical installation";
        const expected = heuristicParseJob(job);
        expect(await new JobParser(fakeLlm({keywords: []})).parse(job, "en")).toEqual(expected);
        expect(await new JobParser(fakeLlm(new Error("LLM down"))).parse(job, "en")).toEqual(expected);
    });

    it("the heuristic maps trades to keywords in the four languages", () => {
        const parsed = heuristicParseJob("Bathroom renovation with a new electrical installation");
        expect(parsed.industry).toBe("plumbing");
        expect(parsed.keywords).toEqual([
            "plumbing", "Sanitär", "Badrenovation", "salle de bains", "installazioni idrauliche",
            "electrician", "Elektro", "Elektroinstallationen", "installation électrique", "elettricista",
        ]);
        expect(parsed.germanEquivalents).toEqual(["Sanitär", "Elektro", "Elektroinstallationen"]);
        expect(parsed.frenchEquivalents).toEqual(["installation électrique"]);
        expect(parsed.italianEquivalents).toEqual(["installazioni idrauliche", "elettricista"]);
    });

    it("the heuristic keeps up to 8 long words of an unknown trade", () => {
        const parsed = heuristicParseJob("We need gardeners for hedge trimming and lawn mowing around three office buildings plus parking garages");
        expect(parsed.keywords).toEqual(["gardeners", "hedge", "trimming", "mowing", "around", "three", "office", "buildings"]);
        expect(parsed.industry).toBe("gardeners");
    });
});

describe("outreach email drafts", () => {
    it("uses the LLM's draft, capping the subject at 300 characters and ending it with the opt-out sentence", async () => {
        const llm = fakeLlm({subject: "S".repeat(400), body: "Bonjour"});
        const draft = await generateOutreachEmail(llm, draftInput);
        expect(draft).toEqual({subject: "S".repeat(300), body: `Bonjour\n\n${OUTREACH_OPT_OUT_LINES.fr}`});
        // The prompt names the recipient and the job, and hands the writer the opt-out sentence
        expect(llm.calls[0].user).toContain("Recipient company: Plomberie Léman SA");
        expect(llm.calls[0].user).toContain(draftInput.jobDescription);
        expect(llm.calls[0].user).toContain(OUTREACH_OPT_OUT_LINES.fr);
    });

    it("does not add the opt-out sentence twice when the writer already ended with it", async () => {
        const body = `Bonjour\n\n${OUTREACH_OPT_OUT_LINES.fr}`;
        expect((await generateOutreachEmail(fakeLlm({subject: "Devis", body}), draftInput)).body).toBe(body);
    });

    it("falls back to the template in the campaign language when the LLM answer is incomplete", async () => {
        const draft = await generateOutreachEmail(fakeLlm({subject: "Only a subject"}), draftInput);
        expect(draft.subject).toBe("Demande de devis – Buyer AG");
        expect(draft.body).toContain("Bonjour Plomberie Léman SA");
        expect(draft.body).toContain(draftInput.jobDescription);
        expect(draft.body.endsWith(`Ada\nada@buyer.ch\n+41 79 000 00 00\n\n${OUTREACH_OPT_OUT_LINES.fr}`)).toBe(true);
    });

    it("falls back to the template in each outreach language when the LLM fails, opt-out sentence included", async () => {
        const failing = fakeLlm(new Error("timeout"));
        const german = await generateOutreachEmail(failing, {...draftInput, language: "de"});
        expect(german.subject).toBe("Anfrage Offerte – Buyer AG");
        expect(german.body.endsWith(OUTREACH_OPT_OUT_LINES.de)).toBe(true);
        const italian = await generateOutreachEmail(failing, {...draftInput, language: "it"});
        expect(italian.subject).toBe("Richiesta di preventivo – Buyer AG");
        expect(italian.body.endsWith(OUTREACH_OPT_OUT_LINES.it)).toBe(true);
        const english = await generateOutreachEmail(failing, {...draftInput, language: "en", senderPhone: undefined});
        expect(english.subject).toBe("Quotation request – Buyer AG");
        expect(english.body.endsWith(`Ada\nada@buyer.ch\n\n${OUTREACH_OPT_OUT_LINES.en}`)).toBe(true);
    });

    it("summarizes a company in at most 1200 characters, or from the register data when the LLM fails", async () => {
        const long = await summarizeCompany(fakeLlm({}, `  ${"w".repeat(1500)}  `), {companyName: "Acme AG", websiteText: "", services: []});
        expect(long).toBe("w".repeat(1200));
        const fallback = await summarizeCompany(fakeLlm({}, new Error("down")), {companyName: "Acme AG", legalForm: "AG", canton: "BS", websiteText: "", services: ["Elektro", "HVAC"]});
        expect(fallback).toBe("Acme AG (AG) based in BS appears to offer Elektro, HVAC.");
        expect(await summarizeCompany(fakeLlm({}, new Error("down")), {companyName: "Acme", websiteText: "", services: []}))
            .toBe("Acme (company) based in Switzerland appears to offer general services.");
    });
});
