import {afterEach, describe, expect, it, vi} from "vitest";
import {toSearchResults} from "@swissOutreachModule/utilities/adapters/webSearch";
import {ZefixRestClient} from "@swissOutreachModule/utilities/adapters/zefixRestClient";

// TD-B144: provider JSON is unchecked input. No live provider: `fetch` answers from the test.
afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
});

function answer(json: unknown) {
    return vi.fn(async () => new Response(JSON.stringify(json), {status: 200, headers: {"content-type": "application/json"}}));
}

const query = {keywords: ["Sanitär"], cantons: [], maxResults: 10, language: "de"};

describe("search provider answers", () => {
    it("maps Serper/Google (`link`) and Bing (`name`, `url`) items, and drops what is not an item", () => {
        expect(toSearchResults([
            {title: "Sanitär AG", link: "https://sanitaer.ch", snippet: "Bäder"},
            {name: "Bing Hit", url: "https://bing-hit.ch"},
            null,
            "text",
            {title: 7, link: ["x"]},
        ], 10)).toEqual([
            {title: "Sanitär AG", url: "https://sanitaer.ch", snippet: "Bäder"},
            {title: "Bing Hit", url: "https://bing-hit.ch", snippet: undefined},
            {title: "", url: "", snippet: undefined},
        ]);
    });

    it("answers no results for a list that is not a list, and keeps to the limit", () => {
        expect(toSearchResults({organic: []}, 5)).toEqual([]);
        expect(toSearchResults(undefined, 5)).toEqual([]);
        expect(toSearchResults([{link: "https://a.ch"}, {link: "https://b.ch"}], 1)).toHaveLength(1);
    });
});

describe("ZEFIX answers", () => {
    it("maps public firm hits, per-language legal forms and the register link, skipping hits without a name", async () => {
        vi.stubGlobal("fetch", answer({list: [
            {name: "Test Sanitär AG", uid: "CHE111111111", canton: "BS", legalFormId: 3, ehraid: 42},
            {name: "Other GmbH", legalForm: {name: {de: "GmbH"}}, cantonalExcerptWeb: "https://register.ch/x"},
            {uid: "CHE222222222"},
            "junk",
        ]}));

        expect(await new ZefixRestClient().search(query)).toEqual([
            {companyName: "Test Sanitär AG", uid: "CHE-111.111.111", canton: "BS", legalForm: "AG", registerUrl: "https://www.zefix.ch/en/search/entity/list/firm/42"},
            {companyName: "Other GmbH", uid: undefined, canton: undefined, legalForm: "GmbH", registerUrl: "https://register.ch/x"},
        ]);
    });

    it("maps authenticated company hits with names per language and the seat's canton", async () => {
        vi.stubEnv("SWISS_OUTREACH_ZEFIX_USERNAME", "user");
        vi.stubEnv("SWISS_OUTREACH_ZEFIX_PASSWORD", "secret");
        vi.stubGlobal("fetch", answer([
            {name: {fr: "Plomberie SA"}, uidOrganisationId: "CHE-333.333.333", legalSeat: {canton: "GE"}, legalForm: "SA", zefixDetailWeb: "https://zefix.ch/d"},
            {name: 12},
        ]));

        expect(await new ZefixRestClient().search(query)).toEqual([
            {companyName: "Plomberie SA", uid: "CHE-333.333.333", canton: "GE", legalForm: "SA", registerUrl: "https://zefix.ch/d"},
        ]);
    });
});
