import {describe, expect, it} from "vitest";
import {mapWithConcurrency} from "@swissOutreachModule/utilities/pipeline/concurrency";
import {
    CantonCommercialRegisterClient,
    CompositeCompanyRegistry,
} from "@swissOutreachModule/utilities/adapters/cantonRegisterClient";
import type {CompanyRegistryPort} from "@swissOutreachModule/utilities/ports";
import {
    getSwissOutreachMetrics,
    incrementMetric,
    resetSwissOutreachMetricsForTests,
} from "@swissOutreachModule/utilities/monitoring/metrics";
import {MAIL_PROVIDER_PRESETS, resolveMailProviderKind} from "@swissOutreachModule/utilities/adapters/mailProviderFactory";

describe("swissOutreach concurrency, composite registry, metrics", () => {
    it("maps with concurrency preserving order", async () => {
        const out = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (n) => n * 2);
        expect(out).toEqual([2, 4, 6, 8, 10]);
    });

    it("merges primary and secondary registry hits without duplicates", async () => {
        const primary: CompanyRegistryPort = {
            async search() {
                return [{companyName: "A AG", uid: "CHE-1", canton: "BS"}];
            },
        };
        const secondary: CompanyRegistryPort = {
            async search() {
                return [
                    {companyName: "A AG", uid: "CHE-1", canton: "BS"},
                    {companyName: "B GmbH", uid: "CHE-2", canton: "BL"},
                ];
            },
        };
        const composite = new CompositeCompanyRegistry(primary, secondary);
        const hits = await composite.search({keywords: ["x"], cantons: ["BS", "BL"], maxResults: 10});
        expect(hits).toHaveLength(2);
        expect(hits.map((h) => h.uid).sort()).toEqual(["CHE-1", "CHE-2"]);
    });

    it("canton stub returns empty", async () => {
        const client = new CantonCommercialRegisterClient();
        await expect(client.search({keywords: ["x"], cantons: ["ZH"], maxResults: 5})).resolves.toEqual([]);
    });

    it("increments runtime metrics", () => {
        resetSwissOutreachMetricsForTests();
        incrementMetric("emailsSent", 2);
        expect(getSwissOutreachMetrics().emailsSent).toBe(2);
    });

    it("resolves mail provider presets", () => {
        process.env.SWISS_OUTREACH_EMAIL_PROVIDER = "gmail";
        expect(resolveMailProviderKind()).toBe("gmail");
        expect(MAIL_PROVIDER_PRESETS.gmail.host).toContain("gmail");
        process.env.SWISS_OUTREACH_EMAIL_PROVIDER = "smtp";
    });
});
