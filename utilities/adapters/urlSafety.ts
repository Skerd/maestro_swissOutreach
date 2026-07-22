import dns from "dns/promises";
import net from "net";

const BLOCKED_HOSTNAMES = new Set(["localhost", "metadata.google.internal"]);

function ipv4ToInt(ip: string): number {
    return ip.split(".").reduce((acc, octet) => (acc << 8) + Number(octet), 0) >>> 0;
}

function isPrivateIpv4(ip: string): boolean {
    const n = ipv4ToInt(ip);
    const ranges: Array<[number, number]> = [
        [ipv4ToInt("0.0.0.0"), ipv4ToInt("0.255.255.255")],
        [ipv4ToInt("10.0.0.0"), ipv4ToInt("10.255.255.255")],
        [ipv4ToInt("127.0.0.0"), ipv4ToInt("127.255.255.255")],
        [ipv4ToInt("169.254.0.0"), ipv4ToInt("169.254.255.255")],
        [ipv4ToInt("172.16.0.0"), ipv4ToInt("172.31.255.255")],
        [ipv4ToInt("192.168.0.0"), ipv4ToInt("192.168.255.255")],
    ];
    return ranges.some(([start, end]) => n >= start && n <= end);
}

function isPrivateIpv6(ip: string): boolean {
    const normalized = ip.toLowerCase();
    return (
        normalized === "::1" ||
        normalized.startsWith("fc") ||
        normalized.startsWith("fd") ||
        normalized.startsWith("fe80")
    );
}

export function isBlockedIp(ip: string): boolean {
    const version = net.isIP(ip);
    if (version === 4) return isPrivateIpv4(ip);
    if (version === 6) return isPrivateIpv6(ip);
    return true;
}

export async function assertSafePublicHttpUrl(rawUrl: string): Promise<URL> {
    let parsed: URL;
    try {
        parsed = new URL(rawUrl);
    } catch {
        throw new Error("Invalid URL");
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new Error("Only http/https URLs are allowed");
    }
    if (parsed.username || parsed.password) {
        throw new Error("URLs with credentials are not allowed");
    }
    const hostname = parsed.hostname.toLowerCase();
    if (BLOCKED_HOSTNAMES.has(hostname) || hostname.endsWith(".local") || hostname.endsWith(".internal")) {
        throw new Error("Blocked hostname");
    }
    if (net.isIP(hostname)) {
        if (isBlockedIp(hostname)) throw new Error("Private/link-local IP blocked");
        return parsed;
    }
    const records = await dns.lookup(hostname, {all: true, verbatim: true});
    if (!records.length) throw new Error("DNS lookup failed");
    for (const record of records) {
        if (isBlockedIp(record.address)) {
            throw new Error(`Blocked private IP resolution for ${hostname}`);
        }
    }
    return parsed;
}

/** Fetch with manual redirect following and SSRF checks on each hop. */
export async function safeFetchHtml(
    rawUrl: string,
    timeoutMs: number,
    maxRedirects = 5,
    externalSignal?: AbortSignal,
): Promise<{url: string; html: string} | null> {
    let current = rawUrl;
    for (let hop = 0; hop <= maxRedirects; hop++) {
        const safeUrl = await assertSafePublicHttpUrl(current);
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        const onAbort = () => controller.abort();
        externalSignal?.addEventListener("abort", onAbort);
        try {
            const response = await fetch(safeUrl.toString(), {
                method: "GET",
                redirect: "manual",
                headers: {
                    "User-Agent": "ArpeggioSwissOutreachBot/1.0 (+https://arpeggio.local; respectful crawler)",
                    Accept: "text/html,application/xhtml+xml",
                },
                signal: controller.signal,
            });
            if ([301, 302, 303, 307, 308].includes(response.status)) {
                const location = response.headers.get("location");
                if (!location) return null;
                current = new URL(location, safeUrl).toString();
                continue;
            }
            if (!response.ok) return null;
            const contentType = response.headers.get("content-type") || "";
            if (!contentType.includes("text/html") && !contentType.includes("application/xhtml")) {
                return null;
            }
            const html = await response.text();
            return {url: safeUrl.toString(), html};
        } catch {
            return null;
        } finally {
            clearTimeout(timer);
            externalSignal?.removeEventListener("abort", onAbort);
        }
    }
    return null;
}
