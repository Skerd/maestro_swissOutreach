import type {ParsedJob} from "armonia/src/modules/swissOutreach/types/parsedJob";

export type ScoreInput = {
    website?: string;
    websiteConfidence?: number;
    emails: string[];
    services: string[];
    canton?: string;
    campaignCantons: string[];
    summary?: string;
    languages: string[];
    campaignLanguage: string;
    keywords: string[];
    textBlob?: string;
};

export function scoreProspect(input: ScoreInput): {score: number; reason: string} {
    let score = 20;
    const reasons: string[] = [];

    if (input.website) {
        score += 15;
        reasons.push("official website found");
        if ((input.websiteConfidence || 0) >= 70) {
            score += 10;
            reasons.push("high website confidence");
        }
    }

    if (input.emails.length > 0) {
        score += 20;
        reasons.push("contact email found");
    }

    const cantonMatch =
        input.canton &&
        input.campaignCantons.some((c) => c.toUpperCase() === input.canton!.toUpperCase());
    if (cantonMatch) {
        score += 15;
        reasons.push(`canton match (${input.canton})`);
    }

    const hay = `${input.summary || ""} ${(input.services || []).join(" ")} ${input.textBlob || ""}`.toLowerCase();
    const keywordHits = input.keywords.filter((k) => hay.includes(k.toLowerCase()));
    if (keywordHits.length > 0) {
        score += Math.min(20, keywordHits.length * 5);
        reasons.push(`relevant services (${keywordHits.slice(0, 3).join(", ")})`);
    }

    if (input.languages.includes(input.campaignLanguage)) {
        score += 10;
        reasons.push("language match");
    }

    if (input.summary && input.summary.length > 40) {
        score += 5;
    }

    score = Math.max(0, Math.min(100, score));
    return {
        score,
        reason: reasons.length > 0 ? reasons.join("; ") : "limited public signals",
    };
}

export function heuristicParseJob(jobDescription: string): ParsedJob {
    const text = jobDescription.toLowerCase();
    const keywords: string[] = [];
    const push = (...words: string[]) => {
        for (const w of words) {
            if (!keywords.some((k) => k.toLowerCase() === w.toLowerCase())) keywords.push(w);
        }
    };

    if (/plumb|sanit|bathroom|badrenov|badezimmer/.test(text)) {
        push("plumbing", "Sanitär", "Badrenovation", "salle de bains", "installazioni idrauliche");
    }
    if (/electr|elektro|electrician|électrique/.test(text)) {
        push("electrician", "Elektro", "Elektroinstallationen", "installation électrique", "elettricista");
    }
    if (/hvac|heizung|heating|climat/.test(text)) {
        push("HVAC", "Heizung", "chauffage", "riscaldamento");
    }
    if (keywords.length === 0) {
        push(...jobDescription.split(/\W+/).filter((w) => w.length > 4).slice(0, 8));
    }

    return {
        industry: keywords[0] || "General contractor",
        companyTypes: ["GmbH", "AG", "SA", "Sagl"],
        synonyms: keywords.slice(0, 5),
        germanEquivalents: keywords.filter((k) => /[äöüÄÖÜ]|Elektro|Sanitär|Heizung/.test(k)),
        frenchEquivalents: keywords.filter((k) => /é|è|à|ç|sanitaire|électrique|chauffage/i.test(k)),
        italianEquivalents: keywords.filter((k) => /idraul|elettric|riscald/i.test(k)),
        nogaCategories: [],
        keywords,
    };
}

export function buildDedupeKey(uid?: string, companyName?: string, canton?: string): string {
    if (uid) return uid.replace(/\s+/g, "").toUpperCase();
    return `${(companyName || "").trim().toLowerCase()}|${(canton || "").toUpperCase()}`;
}
