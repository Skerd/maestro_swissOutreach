/**
 * Env-backed configuration for swissOutreach. Never hardcode operational limits. The values are checked at boot by
 * `environment.validator.ts`; a value that is unset (or, outside boot, unreadable) falls back to its default here.
 */

function parseIntEnv(key: string, fallback: number): number {
    const raw = process.env[key];
    if (raw == null || raw.trim() === "") return fallback;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) ? n : fallback;
}

export const WEB_SEARCH_PROVIDERS = ["serper", "bing", "google", "none"] as const;
export const LLM_PROVIDERS = ["openai", "ollama"] as const;
/** `m365` and `office365` are accepted spellings of `microsoft365`. */
export const EMAIL_PROVIDERS = ["smtp", "gmail", "microsoft365", "m365", "office365"] as const;

export type WebSearchProvider = (typeof WEB_SEARCH_PROVIDERS)[number];
export type LlmProvider = (typeof LLM_PROVIDERS)[number];

/** Conservative default: a steady trickle well under every mail provider's sending limits. */
export const DEFAULT_MAX_SENDS_PER_MINUTE = 10;

export type SwissOutreachConfig = {
    maxCompaniesDefault: number;
    searchDepth: number;
    requestTimeoutMs: number;
    retryCount: number;
    concurrency: number;
    requestDelayMs: number;
    /** Successful sends of one campaign are spaced so no more than this many go out per minute. */
    maxSendsPerMinute: number;
    /** Runs and sends go through the Kafka pipeline topic (with an in-process fallback) instead of in-process. */
    useKafkaPipeline: boolean;
    zefixBaseUrl: string;
    zefixUsername: string;
    zefixPassword: string;
    webSearchProvider: WebSearchProvider;
    serperApiKey: string;
    bingApiKey: string;
    googleCseApiKey: string;
    googleCseCx: string;
    llmProvider: LlmProvider;
    llmBaseUrl: string;
    llmApiKey: string;
    llmModel: string;
};

function oneOf<T extends string>(values: readonly T[], raw: string, fallback: T): T {
    return values.find((value) => value === raw) ?? fallback;
}

export function getSwissOutreachConfig(): SwissOutreachConfig {
    return {
        maxCompaniesDefault: parseIntEnv("SWISS_OUTREACH_MAX_COMPANIES_DEFAULT", 50),
        searchDepth: parseIntEnv("SWISS_OUTREACH_SEARCH_DEPTH", 3),
        requestTimeoutMs: parseIntEnv("SWISS_OUTREACH_REQUEST_TIMEOUT_MS", 30000),
        retryCount: parseIntEnv("SWISS_OUTREACH_RETRY_COUNT", 3),
        concurrency: parseIntEnv("SWISS_OUTREACH_CONCURRENCY", 3),
        requestDelayMs: parseIntEnv("SWISS_OUTREACH_REQUEST_DELAY_MS", 750),
        maxSendsPerMinute: Math.max(1, parseIntEnv("SWISS_OUTREACH_MAX_SENDS_PER_MINUTE", DEFAULT_MAX_SENDS_PER_MINUTE)),
        // Opt-in: with KAFKA_ENABLED alone a publish can succeed while no consumer runs the event.
        useKafkaPipeline: process.env.SWISS_OUTREACH_USE_KAFKA_PIPELINE === "true",
        zefixBaseUrl:
            process.env.SWISS_OUTREACH_ZEFIX_BASE_URL ||
            "https://www.zefix.ch/ZefixREST/api/v1",
        zefixUsername: process.env.SWISS_OUTREACH_ZEFIX_USERNAME || "",
        zefixPassword: process.env.SWISS_OUTREACH_ZEFIX_PASSWORD || "",
        webSearchProvider: oneOf(WEB_SEARCH_PROVIDERS, (process.env.SWISS_OUTREACH_WEB_SEARCH_PROVIDER || "none").toLowerCase(), "none"),
        serperApiKey: process.env.SWISS_OUTREACH_SERPER_API_KEY || "",
        bingApiKey: process.env.SWISS_OUTREACH_BING_API_KEY || "",
        googleCseApiKey: process.env.SWISS_OUTREACH_GOOGLE_CSE_API_KEY || "",
        googleCseCx: process.env.SWISS_OUTREACH_GOOGLE_CSE_CX || "",
        llmProvider: oneOf(LLM_PROVIDERS, (process.env.SWISS_OUTREACH_LLM_PROVIDER || "ollama").toLowerCase(), "ollama"),
        llmBaseUrl:
            process.env.SWISS_OUTREACH_LLM_BASE_URL ||
            process.env.AI_ASSISTANT_BASE_URL ||
            "http://localhost:11434",
        llmApiKey: process.env.SWISS_OUTREACH_LLM_API_KEY || "",
        llmModel:
            process.env.SWISS_OUTREACH_LLM_MODEL ||
            process.env.AI_ASSISTANT_MODEL ||
            "llama3.1:8b",
    };
}
