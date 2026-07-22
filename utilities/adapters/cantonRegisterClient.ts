import type {CompanyRegistryPort, CompanySearchQuery, RegistryCompany} from "@swissOutreachModule/utilities/ports";
import {getLogger} from "@coreModule/loggers/serverLog";

const logger = getLogger("swissOutreach.cantonRegister");

/**
 * Placeholder for canton Handelsregister deep extracts.
 * ZEFIX remains the primary source; this adapter is wired for future canton APIs
 * without changing the orchestrator.
 */
export class CantonCommercialRegisterClient implements CompanyRegistryPort {
    async search(query: CompanySearchQuery): Promise<RegistryCompany[]> {
        logger.debug(
            `Canton register search stub (cantons=${query.cantons.join(",") || "*"}, terms=${query.keywords.length})`,
        );
        return [];
    }
}

export const cantonCommercialRegisterClient = new CantonCommercialRegisterClient();

/** Prefer ZEFIX, then merge unique canton results. */
export class CompositeCompanyRegistry implements CompanyRegistryPort {
    constructor(
        private readonly primary: CompanyRegistryPort,
        private readonly secondary: CompanyRegistryPort,
    ) {}

    async search(query: CompanySearchQuery): Promise<RegistryCompany[]> {
        const primaryHits = await this.primary.search(query);
        if (primaryHits.length >= query.maxResults) {
            return primaryHits.slice(0, query.maxResults);
        }
        const secondaryHits = await this.secondary.search({
            ...query,
            maxResults: query.maxResults - primaryHits.length,
        });
        const seen = new Set(
            primaryHits.map((c) => (c.uid || `${c.companyName}|${c.canton || ""}`).toLowerCase()),
        );
        const merged = [...primaryHits];
        for (const hit of secondaryHits) {
            const key = (hit.uid || `${hit.companyName}|${hit.canton || ""}`).toLowerCase();
            if (seen.has(key)) continue;
            seen.add(key);
            merged.push(hit);
            if (merged.length >= query.maxResults) break;
        }
        return merged;
    }
}
