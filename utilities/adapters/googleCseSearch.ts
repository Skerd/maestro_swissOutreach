import type {WebSearchPort, WebSearchResult} from "@swissOutreachModule/utilities/ports";
import {getSwissOutreachConfig} from "@swissOutreachModule/utilities/config";
import {getLogger} from "@coreModule/loggers/serverLog";

const logger = getLogger("swissOutreach.googleCse");

/** Google Programmable Search (CSE) adapter. */
export class GoogleCseWebSearch implements WebSearchPort {
    async search(query: string, limit = 5): Promise<WebSearchResult[]> {
        const apiKey = process.env.SWISS_OUTREACH_GOOGLE_CSE_API_KEY || "";
        const cx = process.env.SWISS_OUTREACH_GOOGLE_CSE_CX || "";
        if (!apiKey || !cx) {
            logger.warn("Google CSE key/cx missing");
            return [];
        }
        const config = getSwissOutreachConfig();
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
            const json = await response.json();
            const items = Array.isArray(json?.items) ? json.items : [];
            return items.slice(0, limit).map((r: any) => ({
                title: String(r.title || ""),
                url: String(r.link || ""),
                snippet: r.snippet ? String(r.snippet) : undefined,
            }));
        } finally {
            clearTimeout(timer);
        }
    }
}
