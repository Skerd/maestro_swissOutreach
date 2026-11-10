import {getLogger} from "@coreModule/loggers/serverLog";
import {CircuitBreaker} from "@coreModule/utilities/circuitBreaker";
import type {WebSearchPort, WebSearchResult} from "@swissOutreachModule/utilities/ports";
import {getSwissOutreachConfig} from "@swissOutreachModule/utilities/config";

const logger = getLogger("swissOutreach.webSearch");

/** The fields of a search provider's result item the adapters read; a provider may leave any of them out. */
export type ProviderSearchItem = {title?: unknown; name?: unknown; link?: unknown; url?: unknown; snippet?: unknown};
type SerperResponse = {organic?: unknown};
type BingResponse = {webPages?: {value?: unknown}};

const textOf = (value: unknown): string | undefined => (typeof value === "string" && value ? value : undefined);

/** A provider's result list as search results: Serper and Google name the URL `link`, Bing `url` and its title `name`. */
export function toSearchResults(items: unknown, limit: number): WebSearchResult[] {
    if (!Array.isArray(items)) return [];
    return items
        .filter((item): item is ProviderSearchItem => typeof item === "object" && item !== null)
        .slice(0, limit)
        .map((item) => ({
            title: textOf(item.title) ?? textOf(item.name) ?? "",
            url: textOf(item.link) ?? textOf(item.url) ?? "",
            snippet: textOf(item.snippet),
        }));
}

/** One breaker per provider: a provider that keeps failing fails the next searches fast (BE-09). */
export const serperCircuitBreaker = new CircuitBreaker({name: "swissOutreach.serper", logger});
export const bingCircuitBreaker = new CircuitBreaker({name: "swissOutreach.bing", logger});

export class SerperWebSearch implements WebSearchPort {
    async search(query: string, limit = 5): Promise<WebSearchResult[]> {
        const config = getSwissOutreachConfig();
        if (!config.serperApiKey) {
            logger.warn("Serper API key missing");
            return [];
        }
        return serperCircuitBreaker.execute(async () => {
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
                const json: SerperResponse | null = await response.json();
                return toSearchResults(json?.organic, limit);
            } finally {
                clearTimeout(timer);
            }
        });
    }
}

export class BingWebSearch implements WebSearchPort {
    async search(query: string, limit = 5): Promise<WebSearchResult[]> {
        const config = getSwissOutreachConfig();
        if (!config.bingApiKey) {
            logger.warn("Bing API key missing");
            return [];
        }
        return bingCircuitBreaker.execute(async () => {
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
                const json: BingResponse | null = await response.json();
                return toSearchResults(json?.webPages?.value, limit);
            } finally {
                clearTimeout(timer);
            }
        });
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
