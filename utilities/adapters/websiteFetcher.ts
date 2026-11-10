import {getLogger} from "@coreModule/loggers/serverLog";
import {CircuitBreaker} from "@coreModule/utilities/circuitBreaker";
import type {CrawlResult, WebsiteFetchPort, WebSearchPort} from "@swissOutreachModule/utilities/ports";
import {getSwissOutreachConfig} from "@swissOutreachModule/utilities/config";
import {
    extractEmails,
    extractLikelyServices,
    extractPhones,
    extractPostalAndCity,
    isDirectoryUrl,
    scoreWebsiteCandidate,
    stripHtml,
} from "@swissOutreachModule/utilities/adapters/contactExtractor";
import {
    assertSafePublicHttpUrl,
    CRAWLER_PRODUCT_TOKEN,
    fetchHtml,
    fetchRobotsTxt,
} from "@swissOutreachModule/utilities/adapters/urlSafety";
import {isPathAllowed, robotsRulesFor} from "@swissOutreachModule/utilities/adapters/robotsTxt";
import {CampaignCancelledError} from "@swissOutreachModule/utilities/pipeline/cancellation";

const logger = getLogger("swissOutreach.crawler");

const CONTACT_PATHS = ["/", "/contact", "/kontakt", "/about", "/uber-uns", "/ueber-uns", "/impressum", "/team", "/about-us"];
/** Pages of one site that fail to load before the crawl gives up on the rest of it. */
const SITE_FAILURES_TO_STOP = 2;
/** Longer than any crawl of one site, so a site's breaker never half-opens during its crawl. */
const SITE_BREAKER_SPAN_MS = 10 * 60 * 1000;

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/** The contact pages the site's robots.txt lets the crawler read; none when robots.txt could not be reached. */
async function pathsAllowedByRobots(origin: string, timeoutMs: number, signal?: AbortSignal): Promise<string[]> {
    const robots = await fetchRobotsTxt(origin, timeoutMs, signal);
    if (signal?.aborted) {
        throw new CampaignCancelledError("crawl");
    }
    if (robots.state === "unreachable") return [];
    if (robots.state === "absent") return CONTACT_PATHS;
    const rules = robotsRulesFor(robots.text, CRAWLER_PRODUCT_TOKEN);
    return CONTACT_PATHS.filter((path) => isPathAllowed(rules, path));
}

export class HttpWebsiteFetcher implements WebsiteFetchPort {
    constructor(private readonly webSearch: WebSearchPort) {}

    async discoverWebsite(companyName: string, canton?: string): Promise<{url?: string; confidence: number}> {
        const query = `"${companyName}" ${canton || ""} Schweiz official site`.trim();
        const results = await this.webSearch.search(query, 8);
        const ranked = results
            .map((r) => ({...r, confidence: scoreWebsiteCandidate(companyName, r)}))
            .filter((r) => !isDirectoryUrl(r.url) || r.confidence >= 80)
            .sort((a, b) => b.confidence - a.confidence);

        for (const candidate of ranked) {
            try {
                await assertSafePublicHttpUrl(candidate.url);
                return {url: candidate.url, confidence: candidate.confidence};
            } catch (err) {
                logger.debug(`Skipping unsafe website candidate ${candidate.url}: ${err instanceof Error ? err.message : String(err)}`);
            }
        }
        return {confidence: 0};
    }

    async crawl(websiteUrl: string, signal?: AbortSignal): Promise<CrawlResult> {
        const config = getSwissOutreachConfig();
        let origin: string;
        try {
            origin = (await assertSafePublicHttpUrl(websiteUrl)).origin;
        } catch (err) {
            logger.warn(`Refusing crawl of unsafe URL ${websiteUrl}: ${err instanceof Error ? err.message : String(err)}`);
            return {pages: [], emails: [], phones: [], languages: [], services: [], textBlob: ""};
        }

        const allowedPaths = await pathsAllowedByRobots(origin, config.requestTimeoutMs, signal);
        if (allowedPaths.length === 0) {
            logger.info(`robots.txt disallows the crawl of ${origin}, or could not be reached`);
            return {pages: [], emails: [], phones: [], languages: [], services: [], textBlob: ""};
        }

        const pages: {url: string; html: string}[] = [];
        const depth = Math.min(allowedPaths.length, Math.max(1, config.searchDepth + 2));
        // A site that is down or timing out is not asked for its remaining pages, each waiting out the timeout (BE-09).
        const site = new CircuitBreaker({
            name: `swissOutreach.site ${origin}`,
            failureThreshold: SITE_FAILURES_TO_STOP,
            failureWindow: SITE_BREAKER_SPAN_MS,
            resetTimeout: SITE_BREAKER_SPAN_MS,
            logger,
        });
        for (const path of allowedPaths.slice(0, depth)) {
            if (signal?.aborted) {
                throw new CampaignCancelledError("crawl");
            }
            if (site.isOpen()) break;
            const target = new URL(path, origin).toString();
            await delay(config.requestDelayMs);
            const fetched = await site.execute(() => fetchHtml(target, config.requestTimeoutMs, 5, signal)).catch(() => null);
            if (fetched) pages.push({url: fetched.url, html: fetched.html});
        }

        const textBlob = pages.map((p) => stripHtml(p.html)).join("\n");
        const emails = extractEmails(textBlob);
        const phones = extractPhones(textBlob);
        const {city, postalCode} = extractPostalAndCity(textBlob);
        const services = extractLikelyServices(textBlob);
        const languages: string[] = [];
        if (/\b(Deutsch|German|de-CH)\b/i.test(textBlob)) languages.push("de");
        if (/\b(Français|French|fr-CH)\b/i.test(textBlob)) languages.push("fr");
        if (/\b(Italiano|Italian|it-CH)\b/i.test(textBlob)) languages.push("it");
        if (/\b(English|en-US|en-GB)\b/i.test(textBlob)) languages.push("en");

        return {
            pages,
            emails,
            phones,
            city,
            postalCode,
            languages,
            services,
            textBlob: textBlob.slice(0, 20000),
        };
    }
}
