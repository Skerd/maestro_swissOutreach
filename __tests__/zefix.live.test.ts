import {describe, expect, it} from "vitest";
import {ZefixRestClient} from "@swissOutreachModule/utilities/adapters/zefixRestClient";

describe("ZefixRestClient public firm/search", () => {
    it("searches live zefix.ch firm/search without credentials", async () => {
        delete process.env.SWISS_OUTREACH_ZEFIX_USERNAME;
        delete process.env.SWISS_OUTREACH_ZEFIX_PASSWORD;
        process.env.SWISS_OUTREACH_ZEFIX_BASE_URL = "https://www.zefix.ch/ZefixREST/api/v1";
        process.env.SWISS_OUTREACH_REQUEST_TIMEOUT_MS = "20000";

        const client = new ZefixRestClient();
        const results = await client.search({
            keywords: ["Elektro"],
            cantons: [],
            maxResults: 3,
            language: "de",
        });

        expect(results.length).toBeGreaterThan(0);
        expect(results[0].companyName.toLowerCase()).toContain("elektro");
        expect(results[0].uid || results[0].registerUrl).toBeTruthy();
    }, 30000);
});
