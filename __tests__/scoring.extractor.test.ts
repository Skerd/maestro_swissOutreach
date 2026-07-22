import {describe, expect, it} from "vitest";
import {
    buildDedupeKey,
    heuristicParseJob,
    scoreProspect,
} from "@swissOutreachModule/utilities/scoring/scoreProspect";
import {
    extractEmails,
    preferContactEmail,
    isDirectoryUrl,
    scoreWebsiteCandidate,
} from "@swissOutreachModule/utilities/adapters/contactExtractor";

describe("swissOutreach scoring & extractors", () => {
    it("prefers sales/info emails and ignores noreply", () => {
        const emails = extractEmails("Contact sales@acme.ch or noreply@acme.ch and careers@acme.ch");
        expect(emails).toContain("sales@acme.ch");
        expect(emails).not.toContain("noreply@acme.ch");
        expect(preferContactEmail(emails)).toBe("sales@acme.ch");
    });

    it("marks directory hosts as low quality", () => {
        expect(isDirectoryUrl("https://www.local.ch/company/foo")).toBe(true);
        expect(isDirectoryUrl("https://www.acme-elektro.ch/kontakt")).toBe(false);
        const score = scoreWebsiteCandidate("Acme Elektro AG", {
            title: "Acme Elektro AG",
            url: "https://www.acme-elektro.ch",
            snippet: "Elektroinstallationen Basel",
        });
        expect(score).toBeGreaterThan(50);
    });

    it("builds stable dedupe keys from UID", () => {
        expect(buildDedupeKey("CHE-100.200.300", "X", "BS")).toBe("CHE-100.200.300");
        expect(buildDedupeKey(undefined, "Acme AG", "bs")).toBe("acme ag|BS");
    });

    it("parses plumbing jobs heuristically", () => {
        const parsed = heuristicParseJob("Looking for a plumbing company to renovate bathrooms");
        expect(parsed.keywords.length).toBeGreaterThan(0);
        expect(parsed.keywords.join(" ").toLowerCase()).toMatch(/plumb|sanit|bath/);
    });

    it("scores canton + email + website highly", () => {
        const {score, reason} = scoreProspect({
            website: "https://example.ch",
            websiteConfidence: 90,
            emails: ["info@example.ch"],
            services: ["Sanitär"],
            canton: "BS",
            campaignCantons: ["BS", "BL"],
            summary: "Residential bathroom renovations in Basel",
            languages: ["de"],
            campaignLanguage: "de",
            keywords: ["plumbing", "Sanitär", "bathroom"],
            textBlob: "Badrenovation Sanitär Basel",
        });
        expect(score).toBeGreaterThanOrEqual(70);
        expect(reason.toLowerCase()).toContain("canton");
    });
});
