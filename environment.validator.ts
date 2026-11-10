import type {ModuleEnvironmentContext, ValidationError} from "@coreModule/environment/validator";
import {EMAIL_PROVIDERS, LLM_PROVIDERS, WEB_SEARCH_PROVIDERS} from "./utilities/config";

/** An optional choice: unset is fine (the default applies), anything else must be one of `values` (any case). */
function validateChoice(key: string, value: string | undefined, values: readonly string[]): ValidationError | null {
    if (!value || value.trim() === "") return null;
    if (values.includes(value.trim().toLowerCase())) return null;
    return {key, message: `Environment variable ${key} must be one of ${values.join(", ")}, got: ${value}`};
}

/**
 * swissOutreach's boot checks (D67). Every setting is optional with a default (`utilities/config.ts`); a set value is
 * checked for range or choice, and the chosen web search provider's key must be set, else website discovery would
 * silently find nothing.
 */
export function validateEnvironment({env, validateString, validateNumber, validateBoolean}: ModuleEnvironmentContext): ValidationError[] {
    const webSearch = (env.SWISS_OUTREACH_WEB_SEARCH_PROVIDER || "none").trim().toLowerCase();
    const zefixCredentials = Boolean(env.SWISS_OUTREACH_ZEFIX_USERNAME?.trim() || env.SWISS_OUTREACH_ZEFIX_PASSWORD?.trim());
    return [
        validateString("SWISS_OUTREACH_ZEFIX_BASE_URL", env.SWISS_OUTREACH_ZEFIX_BASE_URL, false),
        // The authenticated ZEFIX API needs both, or neither for the public one.
        validateString("SWISS_OUTREACH_ZEFIX_USERNAME", env.SWISS_OUTREACH_ZEFIX_USERNAME, zefixCredentials),
        validateString("SWISS_OUTREACH_ZEFIX_PASSWORD", env.SWISS_OUTREACH_ZEFIX_PASSWORD, zefixCredentials),
        validateNumber("SWISS_OUTREACH_MAX_COMPANIES_DEFAULT", env.SWISS_OUTREACH_MAX_COMPANIES_DEFAULT, false, 1, 500),
        validateNumber("SWISS_OUTREACH_SEARCH_DEPTH", env.SWISS_OUTREACH_SEARCH_DEPTH, false, 1, 10),
        validateNumber("SWISS_OUTREACH_REQUEST_TIMEOUT_MS", env.SWISS_OUTREACH_REQUEST_TIMEOUT_MS, false, 1000, 300000),
        validateNumber("SWISS_OUTREACH_RETRY_COUNT", env.SWISS_OUTREACH_RETRY_COUNT, false, 1, 10),
        validateNumber("SWISS_OUTREACH_CONCURRENCY", env.SWISS_OUTREACH_CONCURRENCY, false, 1, 20),
        validateNumber("SWISS_OUTREACH_REQUEST_DELAY_MS", env.SWISS_OUTREACH_REQUEST_DELAY_MS, false, 0, 60000),
        validateNumber("SWISS_OUTREACH_MAX_SENDS_PER_MINUTE", env.SWISS_OUTREACH_MAX_SENDS_PER_MINUTE, false, 1, 600),
        validateBoolean("SWISS_OUTREACH_USE_KAFKA_PIPELINE", env.SWISS_OUTREACH_USE_KAFKA_PIPELINE, false),
        validateChoice("SWISS_OUTREACH_WEB_SEARCH_PROVIDER", env.SWISS_OUTREACH_WEB_SEARCH_PROVIDER, WEB_SEARCH_PROVIDERS),
        validateString("SWISS_OUTREACH_SERPER_API_KEY", env.SWISS_OUTREACH_SERPER_API_KEY, webSearch === "serper"),
        validateString("SWISS_OUTREACH_BING_API_KEY", env.SWISS_OUTREACH_BING_API_KEY, webSearch === "bing"),
        validateString("SWISS_OUTREACH_GOOGLE_CSE_API_KEY", env.SWISS_OUTREACH_GOOGLE_CSE_API_KEY, webSearch === "google"),
        validateString("SWISS_OUTREACH_GOOGLE_CSE_CX", env.SWISS_OUTREACH_GOOGLE_CSE_CX, webSearch === "google"),
        validateChoice("SWISS_OUTREACH_EMAIL_PROVIDER", env.SWISS_OUTREACH_EMAIL_PROVIDER, EMAIL_PROVIDERS),
        // No key is required for `openai`: an OpenAI-compatible server may run without one.
        validateChoice("SWISS_OUTREACH_LLM_PROVIDER", env.SWISS_OUTREACH_LLM_PROVIDER, LLM_PROVIDERS),
    ].filter((error): error is ValidationError => error !== null);
}
