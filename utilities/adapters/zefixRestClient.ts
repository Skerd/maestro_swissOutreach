import {getLogger} from "@coreModule/loggers/serverLog";
import type {CompanyRegistryPort, CompanySearchQuery, RegistryCompany} from "@swissOutreachModule/utilities/ports";
import {getSwissOutreachConfig} from "@swissOutreachModule/utilities/config";

const logger = getLogger("swissOutreach.zefix");

/** Same catalog the public zefix.ch SPA loads from /legalForm. */
const LEGAL_FORM_BY_ID: Record<number, string> = {
    1: "Einzelunternehmen",
    2: "Kollektivgesellschaft",
    3: "AG",
    4: "GmbH",
    5: "Genossenschaft",
    6: "Verein",
    7: "Stiftung",
    8: "Institut des öffentlichen Rechts",
    9: "Zweigniederlassung",
    10: "Kommanditgesellschaft",
    11: "Zweigniederlassung einer ausl. Gesellschaft",
    12: "Kommanditaktiengesellschaft",
};

function authHeader(username: string, password: string): Record<string, string> {
    if (!username) return {};
    const token = Buffer.from(`${username}:${password}`).toString("base64");
    return {Authorization: `Basic ${token}`};
}

function spaHeaders(): Record<string, string> {
    return {
        Accept: "application/json, text/plain, */*",
        "Content-Type": "application/json",
        Origin: "https://www.zefix.ch",
        Referer: "https://www.zefix.ch/en/search/entity/list",
    };
}

function formatUid(uid?: string, uidFormatted?: string): string | undefined {
    if (uidFormatted) return uidFormatted;
    if (!uid) return undefined;
    // CHE366403063 → CHE-366.403.063
    const m = /^CHE(\d{3})(\d{3})(\d{3})$/i.exec(uid.replace(/[^a-z0-9]/gi, ""));
    if (!m) return uid;
    return `CHE-${m[1]}.${m[2]}.${m[3]}`;
}

function mapFirmHit(raw: any): RegistryCompany | null {
    const name = typeof raw?.name === "string" ? raw.name : raw?.companyName;
    if (!name) return null;
    const uid = formatUid(raw.uid, raw.uidFormatted);
    const legalFormId = Number(raw.legalFormId);
    return {
        companyName: String(name),
        uid,
        canton: raw.canton || undefined,
        legalForm: LEGAL_FORM_BY_ID[legalFormId] || (raw.legalForm?.name?.de || raw.legalForm?.name) || undefined,
        registerUrl:
            raw.cantonalExcerptWeb ||
            (raw.ehraid ? `https://www.zefix.ch/en/search/entity/list/firm/${raw.ehraid}` : undefined),
        purpose: raw.purpose || undefined,
    };
}

/**
 * Live ZEFIX client using the same public API as https://www.zefix.ch
 * (`POST /ZefixREST/api/v1/firm/search`) — no admin credentials required.
 *
 * Optional: set SWISS_OUTREACH_ZEFIX_USERNAME/PASSWORD + base URL
 * `https://www.zefix.admin.ch/ZefixPublicREST/api/v1` to use the authenticated
 * `/company/search` API instead.
 */
export class ZefixRestClient implements CompanyRegistryPort {
    async search(query: CompanySearchQuery): Promise<RegistryCompany[]> {
        const config = getSwissOutreachConfig();
        const useAuthenticated = Boolean(config.zefixUsername && config.zefixPassword);
        const results: RegistryCompany[] = [];
        const seen = new Set<string>();
        const cantons = query.cantons.length > 0 ? query.cantons : [undefined];
        const terms = query.companyName
            ? [query.companyName]
            : query.keywords.slice(0, Math.max(1, config.searchDepth));

        if (terms.length === 0) {
            logger.warn("ZEFIX search skipped: no company name or keywords");
            return [];
        }

        for (const term of terms) {
            for (const canton of cantons) {
                if (results.length >= query.maxResults) break;
                const page = useAuthenticated
                    ? await this.searchAuthenticated({
                          name: term,
                          canton,
                          language: query.language || "de",
                          maxEntries: Math.min(100, query.maxResults - results.length),
                      })
                    : await this.searchPublicFirm({
                          name: term,
                          canton,
                          maxEntries: Math.min(100, query.maxResults - results.length),
                      });

                for (const company of page) {
                    const key = (company.uid || `${company.companyName}|${company.canton || ""}`).toLowerCase();
                    if (seen.has(key)) continue;
                    seen.add(key);
                    results.push(company);
                    if (results.length >= query.maxResults) break;
                }
            }
        }

        // Enrich purpose from firm detail when using the public SPA API (list hits omit purpose).
        if (!useAuthenticated) {
            await this.enrichPurposes(results.slice(0, query.maxResults), config.requestTimeoutMs);
        }

        return results.slice(0, query.maxResults);
    }

    private async searchPublicFirm(input: {
        name: string;
        canton?: string;
        maxEntries: number;
    }): Promise<RegistryCompany[]> {
        const config = getSwissOutreachConfig();
        const base = (config.zefixBaseUrl || "https://www.zefix.ch/ZefixREST/api/v1").replace(/\/$/, "");
        const url = `${base.includes("ZefixREST") ? base : "https://www.zefix.ch/ZefixREST/api/v1"}/firm/search`;
        const body: Record<string, unknown> = {
            name: input.name,
            activeOnly: true,
            maxEntries: input.maxEntries,
            offset: 0,
        };
        // Public firm/search may ignore canton; still send it when present.
        if (input.canton) body.canton = input.canton.toUpperCase();

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), config.requestTimeoutMs);
        try {
            const response = await fetch(url, {
                method: "POST",
                headers: spaHeaders(),
                body: JSON.stringify(body),
                signal: controller.signal,
            });
            if (!response.ok) {
                const text = await response.text().catch(() => "");
                throw new Error(`ZEFIX firm/search HTTP ${response.status}${text ? `: ${text.slice(0, 200)}` : ""}`);
            }
            const json = await response.json();
            const list = Array.isArray(json) ? json : json?.list || [];
            return (list as any[]).map(mapFirmHit).filter(Boolean) as RegistryCompany[];
        } finally {
            clearTimeout(timer);
        }
    }

    private async searchAuthenticated(input: {
        name: string;
        canton?: string;
        language: string;
        maxEntries: number;
    }): Promise<RegistryCompany[]> {
        const config = getSwissOutreachConfig();
        const url = `${config.zefixBaseUrl.replace(/\/$/, "")}/company/search`;
        const body: Record<string, unknown> = {
            name: input.name,
            activeOnly: true,
            maxEntries: input.maxEntries,
            offset: 0,
            languageKey: input.language,
        };
        if (input.canton) body.canton = input.canton.toUpperCase();

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), config.requestTimeoutMs);
        try {
            const response = await fetch(url, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Accept: "application/json",
                    ...authHeader(config.zefixUsername, config.zefixPassword),
                },
                body: JSON.stringify(body),
                signal: controller.signal,
            });
            if (!response.ok) {
                const text = await response.text().catch(() => "");
                throw new Error(`ZEFIX company/search HTTP ${response.status}${text ? `: ${text.slice(0, 200)}` : ""}`);
            }
            const json = await response.json();
            const list = Array.isArray(json) ? json : json?.list || json?.companies || json?.data || [];
            return (list as any[])
                .map((raw) => {
                    const name =
                        typeof raw?.name === "string"
                            ? raw.name
                            : raw?.name?.de || raw?.name?.fr || raw?.name?.it || raw?.name?.en;
                    if (!name) return null;
                    return {
                        companyName: String(name),
                        uid: raw.uid || raw.uidOrganisationId,
                        canton: raw.canton || raw.legalSeat?.canton,
                        legalForm: raw.legalForm?.name?.de || raw.legalForm?.name || raw.legalForm,
                        registerUrl: raw.zefixDetailWeb || raw.detailWeb || raw.ehraIdWeb,
                        purpose: raw.purpose || raw.translation?.purpose,
                    } as RegistryCompany;
                })
                .filter(Boolean) as RegistryCompany[];
        } finally {
            clearTimeout(timer);
        }
    }

    private async enrichPurposes(companies: RegistryCompany[], timeoutMs: number): Promise<void> {
        await Promise.all(
            companies.map(async (company) => {
                const ehraid = company.registerUrl?.match(/firm\/(\d+)/)?.[1];
                if (!ehraid || company.purpose) return;
                try {
                    const controller = new AbortController();
                    const timer = setTimeout(() => controller.abort(), timeoutMs);
                    const response = await fetch(`https://www.zefix.ch/ZefixREST/api/v1/firm/${ehraid}`, {
                        headers: {
                            Accept: "application/json",
                            Origin: "https://www.zefix.ch",
                            Referer: "https://www.zefix.ch/en/search/entity/list",
                        },
                        signal: controller.signal,
                    });
                    clearTimeout(timer);
                    if (!response.ok) return;
                    const detail = await response.json();
                    if (typeof detail?.purpose === "string" && detail.purpose.trim()) {
                        company.purpose = detail.purpose.trim().slice(0, 2000);
                    }
                } catch (err: any) {
                    logger.debug(`ZEFIX firm detail enrich failed for ${company.companyName}: ${err?.message || err}`);
                }
            }),
        );
    }
}

export const zefixRestClient = new ZefixRestClient();
