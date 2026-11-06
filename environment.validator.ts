import type {ModuleEnvironmentContext, ValidationError} from "@coreModule/environment/validator";

/** swissOutreach's boot checks (D67): optional settings, checked for range when set. */
export function validateEnvironment({env, validateString, validateNumber}: ModuleEnvironmentContext): ValidationError[] {
    return [
        validateString("SWISS_OUTREACH_ZEFIX_BASE_URL", env.SWISS_OUTREACH_ZEFIX_BASE_URL, false),
        validateNumber("SWISS_OUTREACH_MAX_COMPANIES_DEFAULT", env.SWISS_OUTREACH_MAX_COMPANIES_DEFAULT, false, 1, 500),
        validateNumber("SWISS_OUTREACH_REQUEST_TIMEOUT_MS", env.SWISS_OUTREACH_REQUEST_TIMEOUT_MS, false, 1000, 300000),
        validateNumber("SWISS_OUTREACH_RETRY_COUNT", env.SWISS_OUTREACH_RETRY_COUNT, false, 1, 10),
    ].filter((error): error is ValidationError => error !== null);
}
