/**
 * Env-backed configuration for swissOutreach. Never hardcode operational limits.
 */

function parseIntEnv(key: string, fallback: number): number {
    const raw = process.env[key];
    if (raw == null || raw.trim() === "") return fallback;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) ? n : fallback;
}

function parseListEnv(key: string, fallback: string[]): string[] {
    const raw = process.env[key];
    if (!raw?.trim()) return fallback;
    return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

export type SwissOutreachConfig = {
    maxCompaniesDefault: number;
    searchDepth: number;
    requestTimeoutMs: number;
    retryCount: number;
    concurrency: number;
    requestDelayMs: number;
    supportedCountries: string[];
    supportedLanguages: string[];
    zefixBaseUrl: string;
    zefixUsername: string;
    zefixPassword: string;
    webSearchProvider: "serper" | "bing" | "google" | "none";
    serperApiKey: string;
    bingApiKey: string;
    emailProvider: "smtp" | "gmail" | "microsoft365";
    llmProvider: "openai" | "ollama";
    llmBaseUrl: string;
    llmApiKey: string;
    llmModel: string;
    kafkaTopicPipeline: string;
};

export function getSwissOutreachConfig(): SwissOutreachConfig {
    const provider = (process.env.SWISS_OUTREACH_WEB_SEARCH_PROVIDER || "none").toLowerCase();
    const llm = (process.env.SWISS_OUTREACH_LLM_PROVIDER || "ollama").toLowerCase();
    const email = (process.env.SWISS_OUTREACH_EMAIL_PROVIDER || "smtp").toLowerCase();
    return {
        maxCompaniesDefault: parseIntEnv("SWISS_OUTREACH_MAX_COMPANIES_DEFAULT", 50),
        searchDepth: parseIntEnv("SWISS_OUTREACH_SEARCH_DEPTH", 3),
        requestTimeoutMs: parseIntEnv("SWISS_OUTREACH_REQUEST_TIMEOUT_MS", 30000),
        retryCount: parseIntEnv("SWISS_OUTREACH_RETRY_COUNT", 3),
        concurrency: parseIntEnv("SWISS_OUTREACH_CONCURRENCY", 3),
        requestDelayMs: parseIntEnv("SWISS_OUTREACH_REQUEST_DELAY_MS", 750),
        supportedCountries: parseListEnv("SWISS_OUTREACH_SUPPORTED_COUNTRIES", ["Switzerland", "CH", "Schweiz"]),
        supportedLanguages: parseListEnv("SWISS_OUTREACH_SUPPORTED_LANGUAGES", ["de", "fr", "it", "en"]),
        zefixBaseUrl:
            process.env.SWISS_OUTREACH_ZEFIX_BASE_URL ||
            "https://www.zefix.ch/ZefixREST/api/v1",
        zefixUsername: process.env.SWISS_OUTREACH_ZEFIX_USERNAME || "",
        zefixPassword: process.env.SWISS_OUTREACH_ZEFIX_PASSWORD || "",
        webSearchProvider:
            provider === "serper" || provider === "bing" || provider === "google" ? provider : "none",
        serperApiKey: process.env.SWISS_OUTREACH_SERPER_API_KEY || "",
        bingApiKey: process.env.SWISS_OUTREACH_BING_API_KEY || "",
        emailProvider:
            email === "gmail"
                ? "gmail"
                : email === "microsoft365" || email === "m365" || email === "office365"
                  ? "microsoft365"
                  : "smtp",
        llmProvider: llm === "openai" ? "openai" : "ollama",
        llmBaseUrl:
            process.env.SWISS_OUTREACH_LLM_BASE_URL ||
            process.env.AI_ASSISTANT_BASE_URL ||
            "http://localhost:11434",
        llmApiKey: process.env.SWISS_OUTREACH_LLM_API_KEY || "",
        llmModel:
            process.env.SWISS_OUTREACH_LLM_MODEL ||
            process.env.AI_ASSISTANT_MODEL ||
            "llama3.1:8b",
        kafkaTopicPipeline: process.env.KAFKA_TOPIC_SWISS_OUTREACH_PIPELINE || "swissOutreach.pipeline",
    };
}
