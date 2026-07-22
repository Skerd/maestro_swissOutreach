import {getLogger} from "@coreModule/loggers/serverLog";
import type {WebSearchPort, WebSearchResult} from "@swissOutreachModule/utilities/ports";
import {getSwissOutreachConfig} from "@swissOutreachModule/utilities/config";

const logger = getLogger("swissOutreach.webSearch");

export class SerperWebSearch implements WebSearchPort {
    async search(query: string, limit = 5): Promise<WebSearchResult[]> {
        const config = getSwissOutreachConfig();
        if (!config.serperApiKey) {
            logger.warn("Serper API key missing");
            return [];
        }
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), config.requestTimeoutMs);
        try {
            const response = await fetch("https://google.serper.dev/search", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "X-API-KEY": config.serperApiKey,
                },
                body: JSON.stringify({q: query, num: limit}),
                signal: controller.signal,
            });
            if (!response.ok) throw new Error(`Serper HTTP ${response.status}`);
            const json = await response.json();
            const organic = Array.isArray(json?.organic) ? json.organic : [];
            return organic.slice(0, limit).map((r: any) => ({
                title: String(r.title || ""),
                url: String(r.link || ""),
                snippet: r.snippet ? String(r.snippet) : undefined,
            }));
        } finally {
            clearTimeout(timer);
        }
    }
}

export class BingWebSearch implements WebSearchPort {
    async search(query: string, limit = 5): Promise<WebSearchResult[]> {
        const config = getSwissOutreachConfig();
        if (!config.bingApiKey) {
            logger.warn("Bing API key missing");
            return [];
        }
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), config.requestTimeoutMs);
        try {
            const url = new URL("https://api.bing.microsoft.com/v7.0/search");
            url.searchParams.set("q", query);
            url.searchParams.set("count", String(limit));
            const response = await fetch(url.toString(), {
                headers: {"Ocp-Apim-Subscription-Key": config.bingApiKey},
                signal: controller.signal,
            });
            if (!response.ok) throw new Error(`Bing HTTP ${response.status}`);
            const json = await response.json();
            const pages = Array.isArray(json?.webPages?.value) ? json.webPages.value : [];
            return pages.slice(0, limit).map((r: any) => ({
                title: String(r.name || ""),
                url: String(r.url || ""),
                snippet: r.snippet ? String(r.snippet) : undefined,
            }));
        } finally {
            clearTimeout(timer);
        }
    }
}

export class NoopWebSearch implements WebSearchPort {
    async search(): Promise<WebSearchResult[]> {
        return [];
    }
}

import {GoogleCseWebSearch} from "@swissOutreachModule/utilities/adapters/googleCseSearch";

export function createWebSearchPort(): WebSearchPort {
    const config = getSwissOutreachConfig();
    if (config.webSearchProvider === "serper") return new SerperWebSearch();
    if (config.webSearchProvider === "bing") return new BingWebSearch();
    if (config.webSearchProvider === "google") return new GoogleCseWebSearch();
    return new NoopWebSearch();
}
