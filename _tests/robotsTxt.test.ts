import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

// The crawl test fakes the network: robots.txt and pages come from these stubs, never from a live site.
const net = vi.hoisted(() => ({
    robots: {state: "absent"} as {state: "found"; text: string} | {state: "absent"} | {state: "unreachable"},
    fetchHtml: vi.fn(async (url: string) => ({url, html: "<p>Kontakt: info@example.ch</p>"})),
}));
vi.mock("@swissOutreachModule/utilities/adapters/urlSafety", () => ({
    CRAWLER_PRODUCT_TOKEN: "ArpeggioSwissOutreachBot",
    assertSafePublicHttpUrl: async (url: string) => new URL(url),
    fetchRobotsTxt: async () => net.robots,
    fetchHtml: net.fetchHtml,
}));

import {isPathAllowed, robotsRulesFor} from "@swissOutreachModule/utilities/adapters/robotsTxt";
import {HttpWebsiteFetcher} from "@swissOutreachModule/utilities/adapters/websiteFetcher";

const BOT = "ArpeggioSwissOutreachBot";

describe("robots.txt rules (TD-B127)", () => {
    it("matches Disallow as a path prefix, not only `Disallow: /`", () => {
        const rules = robotsRulesFor("User-agent: *\nDisallow: /kontakt\nDisallow: /team/", BOT);
        expect(isPathAllowed(rules, "/kontakt")).toBe(false);
        expect(isPathAllowed(rules, "/kontakt/form")).toBe(false);
        expect(isPathAllowed(rules, "/team/")).toBe(false);
        expect(isPathAllowed(rules, "/team")).toBe(true);
        expect(isPathAllowed(rules, "/impressum")).toBe(true);
    });

    it("lets the longest rule decide, Allow winning a tie", () => {
        const rules = robotsRulesFor("User-agent: *\nDisallow: /\nAllow: /impressum\nAllow: /contact$", BOT);
        expect(isPathAllowed(rules, "/impressum")).toBe(true);
        expect(isPathAllowed(rules, "/contact")).toBe(true);
        expect(isPathAllowed(rules, "/contact/form")).toBe(false);
        expect(isPathAllowed(rules, "/about")).toBe(false);
        expect(isPathAllowed(robotsRulesFor("User-agent: *\nDisallow: /a\nAllow: /a", BOT), "/a")).toBe(true);
    });

    it("supports * wildcards", () => {
        const rules = robotsRulesFor("User-agent: *\nDisallow: /*.pdf$\nDisallow: /*/private", BOT);
        expect(isPathAllowed(rules, "/files/report.pdf")).toBe(false);
        expect(isPathAllowed(rules, "/de/private/x")).toBe(false);
        expect(isPathAllowed(rules, "/files/report.pdf.html")).toBe(true);
    });

    it("prefers the crawler's own group over *, and ignores other bots' groups", () => {
        const text = [
            "User-agent: Googlebot",
            "Disallow: /",
            "",
            "User-agent: *",
            "Disallow: /",
            "",
            "User-agent: arpeggioswissoutreachbot",
            "User-agent: OtherBot",
            "Disallow: /team # staff pages",
        ].join("\r\n");
        const rules = robotsRulesFor(text, BOT);
        expect(isPathAllowed(rules, "/")).toBe(true);
        expect(isPathAllowed(rules, "/team")).toBe(false);
    });

    it("treats an empty Disallow and an empty file as allowing everything", () => {
        expect(isPathAllowed(robotsRulesFor("User-agent: *\nDisallow:", BOT), "/kontakt")).toBe(true);
        expect(isPathAllowed(robotsRulesFor("", BOT), "/kontakt")).toBe(true);
    });
});

describe("the crawl obeys robots.txt (TD-B127)", () => {
    const fetcher = new HttpWebsiteFetcher({search: async () => []});

    beforeEach(() => {
        vi.stubEnv("SWISS_OUTREACH_REQUEST_DELAY_MS", "0");
        vi.stubEnv("SWISS_OUTREACH_SEARCH_DEPTH", "20");
        net.fetchHtml.mockClear();
    });
    afterEach(() => {
        vi.unstubAllEnvs();
    });

    const requestedPaths = () => net.fetchHtml.mock.calls.map(([url]) => new URL(url).pathname);

    it("never requests a disallowed contact page", async () => {
        net.robots = {state: "found", text: "User-agent: *\nDisallow: /kontakt\nDisallow: /team"};

        const result = await fetcher.crawl("https://example.ch/");

        expect(requestedPaths()).not.toContain("/kontakt");
        expect(requestedPaths()).not.toContain("/team");
        expect(requestedPaths()).toContain("/impressum");
        expect(result.emails).toContain("info@example.ch");
    });

    it("crawls nothing when the whole site is disallowed", async () => {
        net.robots = {state: "found", text: "User-agent: *\nDisallow: /"};

        expect((await fetcher.crawl("https://example.ch/")).pages).toEqual([]);
        expect(net.fetchHtml).not.toHaveBeenCalled();
    });

    it("crawls nothing when robots.txt cannot be reached, and everything when there is none", async () => {
        net.robots = {state: "unreachable"};
        await fetcher.crawl("https://example.ch/");
        expect(net.fetchHtml).not.toHaveBeenCalled();

        net.robots = {state: "absent"};
        await fetcher.crawl("https://example.ch/");
        expect(requestedPaths()).toContain("/kontakt");
    });
});
