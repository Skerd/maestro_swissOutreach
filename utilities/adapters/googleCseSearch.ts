import type {WebSearchPort, WebSearchResult} from "@swissOutreachModule/utilities/ports";
import {getSwissOutreachConfig} from "@swissOutreachModule/utilities/config";
import {getLogger} from "@coreModule/loggers/serverLog";
import {CircuitBreaker} from "@coreModule/utilities/circuitBreaker";
import {toSearchResults} from "@swissOutreachModule/utilities/adapters/webSearch";

const logger = getLogger("swissOutreach.googleCse");

/** Google CSE failing again and again fails the next searches fast (BE-09). */
export const googleCseCircuitBreaker = new CircuitBreaker({name: "swissOutreach.googleCse", logger});

/** Google Programmable Search (CSE) adapter. */
export class GoogleCseWebSearch implements WebSearchPort {
    async search(query: string, limit = 5): Promise<WebSearchResult[]> {
        const config = getSwissOutreachConfig();
        const apiKey = config.googleCseApiKey;
        const cx = config.googleCseCx;
        if (!apiKey || !cx) {
            logger.warn("Google CSE key/cx missing");
            return [];
        }
        return googleCseCircuitBreaker.execute(async () => {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), config.requestTimeoutMs);
            try {
                const url = new URL("https://www.googleapis.com/customsearch/v1");
                url.searchParams.set("key", apiKey);
                url.searchParams.set("cx", cx);
                url.searchParams.set("q", query);
                url.searchParams.set("num", String(Math.min(10, limit)));
                const response = await fetch(url.toString(), {signal: controller.signal});
                if (!response.ok) throw new Error(`Google CSE HTTP ${response.status}`);
                const json: {items?: unknown} | null = await response.json();
                return toSearchResults(json?.items, limit);
            } finally {
                clearTimeout(timer);
            }
        });
    }
}
