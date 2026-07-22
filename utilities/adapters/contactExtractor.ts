const IGNORE_EMAIL_RE = /(noreply|no-reply|donotreply|careers|jobs|recruit|invoice|billing|unsubscribe)/i;
const PREFERRED_LOCAL_PARTS = ["sales", "info", "contact", "hello", "office", "anfrage", "kontakt"];

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const PHONE_RE = /(?:\+|00)?(?:41|43|49)?[\s./-]?(?:\(?0?\d{2,3}\)?[\s./-]?)?\d{3}[\s./-]?\d{2,4}[\s./-]?\d{2,4}/g;
const POSTAL_CITY_RE = /\b(\d{4})\s+([A-ZÄÖÜ][a-zäöüßéèêàâùûôîA-ZÄÖÜ-]{1,40})\b/;

const DIRECTORY_HOST_HINTS = [
    "local.ch",
    "search.ch",
    "gelbeseiten",
    "pagesjaunes",
    "moneyhouse.ch",
    "company.ch",
    "linkedin.com",
    "facebook.com",
    "instagram.com",
    "xing.com",
    "kununu.com",
    "tripadvisor",
];

export function isDirectoryUrl(url: string): boolean {
    try {
        const host = new URL(url).hostname.toLowerCase();
        return DIRECTORY_HOST_HINTS.some((h) => host.includes(h));
    } catch {
        return true;
    }
}

export function extractEmails(text: string): string[] {
    const found = text.match(EMAIL_RE) || [];
    const unique = [...new Set(found.map((e) => e.toLowerCase()))];
    return unique.filter((e) => !IGNORE_EMAIL_RE.test(e));
}

export function preferContactEmail(emails: string[]): string | undefined {
    if (emails.length === 0) return undefined;
    const ranked = [...emails].sort((a, b) => scoreEmail(b) - scoreEmail(a));
    return ranked[0];
}

function scoreEmail(email: string): number {
    const local = email.split("@")[0] || "";
    let score = 0;
    for (const pref of PREFERRED_LOCAL_PARTS) {
        if (local.includes(pref)) score += 10;
    }
    if (IGNORE_EMAIL_RE.test(email)) score -= 50;
    return score;
}

export function extractPhones(text: string): string[] {
    const found = text.match(PHONE_RE) || [];
    return [...new Set(found.map((p) => p.trim()).filter((p) => p.replace(/\D/g, "").length >= 9))].slice(0, 10);
}

export function extractPostalAndCity(text: string): {postalCode?: string; city?: string} {
    const m = text.match(POSTAL_CITY_RE);
    if (!m) return {};
    return {postalCode: m[1], city: m[2]};
}

export function extractLikelyServices(text: string): string[] {
    const keywords = [
        "Elektro",
        "Sanitär",
        "plumbing",
        "electrical",
        "installation",
        "renovation",
        "Badrenovation",
        "Heizung",
        "HVAC",
        "Gebäude",
        "residential",
        "commercial",
    ];
    const lower = text.toLowerCase();
    return keywords.filter((k) => lower.includes(k.toLowerCase()));
}

export function stripHtml(html: string): string {
    return html
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

export function scoreWebsiteCandidate(companyName: string, result: {title: string; url: string; snippet?: string}): number {
    if (isDirectoryUrl(result.url)) return 5;
    let score = 40;
    const nameTokens = companyName.toLowerCase().split(/[^a-z0-9äöü]+/).filter((t) => t.length > 2);
    const hay = `${result.title} ${result.url} ${result.snippet || ""}`.toLowerCase();
    for (const token of nameTokens) {
        if (hay.includes(token)) score += 12;
    }
    if (result.url.endsWith(".ch") || result.url.includes(".ch/")) score += 15;
    return Math.min(100, score);
}
