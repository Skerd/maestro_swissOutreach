import {getLogger} from "@coreModule/loggers/serverLog";
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
import {assertSafePublicHttpUrl, safeFetchHtml} from "@swissOutreachModule/utilities/adapters/urlSafety";
import {CampaignCancelledError} from "@swissOutreachModule/utilities/pipeline/cancellation";

const logger = getLogger("swissOutreach.crawler");

const CONTACT_PATHS = ["/", "/contact", "/kontakt", "/about", "/uber-uns", "/ueber-uns", "/impressum", "/team", "/about-us"];

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function isAllowedByRobots(origin: string, timeoutMs: number, signal?: AbortSignal): Promise<boolean> {
    try {
        const robotsUrl = new URL("/robots.txt", origin).toString();
        const fetched = await safeFetchHtml(robotsUrl, timeoutMs, 3, signal);
        if (!fetched?.html) return true;
        const lines = fetched.html.split(/\r?\n/);
        let inStar = false;
        for (const line of lines) {
            const trimmed = line.trim();
            if (/^user-agent:\s*\*/i.test(trimmed)) {
                inStar = true;
                continue;
            }
            if (/^user-agent:/i.test(trimmed)) {
                inStar = false;
                continue;
            }
            if (inStar && /^disallow:\s*\/\s*$/i.test(trimmed)) {
                return false;
            }
        }
        return true;
    } catch {
        return true;
    }
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
            } catch (err: any) {
                logger.debug(`Skipping unsafe website candidate ${candidate.url}: ${err?.message || err}`);
            }
        }
        return {confidence: 0};
    }

    async crawl(websiteUrl: string, signal?: AbortSignal): Promise<CrawlResult> {
        const config = getSwissOutreachConfig();
        let origin: string;
        try {
            origin = (await assertSafePublicHttpUrl(websiteUrl)).origin;
        } catch (err: any) {
            logger.warn(`Refusing crawl of unsafe URL ${websiteUrl}: ${err?.message || err}`);
            return {pages: [], emails: [], phones: [], languages: [], services: [], textBlob: ""};
        }

        const allowed = await isAllowedByRobots(origin, config.requestTimeoutMs, signal);
        if (!allowed) {
            logger.info(`robots.txt disallows crawl for ${origin}`);
            return {pages: [], emails: [], phones: [], languages: [], services: [], textBlob: ""};
        }

        const pages: {url: string; html: string}[] = [];
        const depth = Math.min(CONTACT_PATHS.length, Math.max(1, config.searchDepth + 2));
        for (const path of CONTACT_PATHS.slice(0, depth)) {
            if (signal?.aborted) {
                throw new CampaignCancelledError("crawl");
            }
            const target = new URL(path, origin).toString();
            await delay(config.requestDelayMs);
            const fetched = await safeFetchHtml(target, config.requestTimeoutMs, 5, signal);
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
