import dns, {type LookupAddress} from "dns";
import http from "http";
import https from "https";
import net, {type LookupFunction} from "net";
import {pipeline, type Readable} from "stream";
import zlib from "zlib";

const BLOCKED_HOSTNAMES = new Set(["localhost", "metadata.google.internal"]);

/** The most of one page the crawler reads; the rest is never downloaded. */
export const MAX_HTML_BYTES = 2 * 1024 * 1024;

const REDIRECT_STATUSES = [301, 302, 303, 307, 308];

/** IPv4 ranges a crawl must never reach: private, loopback, link-local, shared (CGNAT), benchmarking, multicast, reserved. */
const BLOCKED_IPV4_RANGES: Array<[string, number]> = [
    ["0.0.0.0", 8],
    ["10.0.0.0", 8],
    ["100.64.0.0", 10],
    ["127.0.0.0", 8],
    ["169.254.0.0", 16],
    ["172.16.0.0", 12],
    ["192.0.0.0", 24],
    ["192.168.0.0", 16],
    ["198.18.0.0", 15],
    ["224.0.0.0", 4],
    ["240.0.0.0", 4],
];

function ipv4ToInt(ip: string): number {
    return ip.split(".").reduce((acc, octet) => (acc << 8) + Number(octet), 0) >>> 0;
}

function isBlockedIpv4(ip: string): boolean {
    const n = ipv4ToInt(ip);
    return BLOCKED_IPV4_RANGES.some(([base, bits]) => {
        const mask = (~0 << (32 - bits)) >>> 0;
        return ((n & mask) >>> 0) === ((ipv4ToInt(base) & mask) >>> 0);
    });
}

/** The eight 16-bit groups of a valid IPv6 address (`::` expanded, a dotted IPv4 tail turned into two groups). */
function ipv6Groups(ip: string): number[] {
    let address = ip.toLowerCase().split("%")[0];
    const lastColon = address.lastIndexOf(":");
    const tail = address.slice(lastColon + 1);
    if (net.isIPv4(tail)) {
        const n = ipv4ToInt(tail);
        address = `${address.slice(0, lastColon + 1)}${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`;
    }
    const [head, rest] = address.split("::");
    const headGroups = head ? head.split(":") : [];
    const restGroups = rest ? rest.split(":") : [];
    const zeros = rest === undefined ? [] : Array<string>(8 - headGroups.length - restGroups.length).fill("0");
    return [...headGroups, ...zeros, ...restGroups].map((group) => parseInt(group, 16));
}

function isBlockedIpv6(ip: string): boolean {
    const g = ipv6Groups(ip);
    const v4 = (high: number, low: number) => `${high >>> 8}.${high & 0xff}.${low >>> 8}.${low & 0xff}`;
    const zeroUpTo = (end: number) => g.slice(0, end).every((group) => group === 0);
    if (zeroUpTo(8)) return true; // ::
    if (zeroUpTo(7) && g[7] === 1) return true; // ::1
    // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible (::a.b.c.d) reach the IPv4 address inside
    if (zeroUpTo(5) && (g[5] === 0xffff || g[5] === 0)) return isBlockedIpv4(v4(g[6], g[7]));
    if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((group) => group === 0)) return isBlockedIpv4(v4(g[6], g[7])); // NAT64
    if (g[0] === 0x2002) return isBlockedIpv4(v4(g[1], g[2])); // 6to4
    if ((g[0] & 0xfe00) === 0xfc00) return true; // unique local fc00::/7
    if ((g[0] & 0xffc0) === 0xfe80) return true; // link-local fe80::/10
    if ((g[0] & 0xffc0) === 0xfec0) return true; // site-local fec0::/10
    return (g[0] & 0xff00) === 0xff00; // multicast ff00::/8
}

/** Whether a crawl must not connect to this address; anything that is not an IP address counts as blocked. */
export function isBlockedIp(ip: string): boolean {
    const version = net.isIP(ip);
    if (version === 4) return isBlockedIpv4(ip);
    if (version === 6) return isBlockedIpv6(ip);
    return true;
}

/** The URL's host without the brackets of an IPv6 literal (`[::1]` → `::1`). */
function bareHostname(url: URL): string {
    return url.hostname.toLowerCase().replace(/^\[(.*)\]$/, "$1");
}

/** Every address of a host, from the same resolver the connection uses. */
function lookupAll(hostname: string): Promise<LookupAddress[]> {
    return new Promise((resolve, reject) => {
        dns.lookup(hostname, {all: true, verbatim: true}, (error, addresses) => (error ? reject(error) : resolve(addresses)));
    });
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
    const hostname = bareHostname(parsed);
    if (BLOCKED_HOSTNAMES.has(hostname) || hostname.endsWith(".local") || hostname.endsWith(".internal")) {
        throw new Error("Blocked hostname");
    }
    if (net.isIP(hostname)) {
        if (isBlockedIp(hostname)) throw new Error("Private/link-local IP blocked");
        return parsed;
    }
    const records = await lookupAll(hostname);
    if (!records.length) throw new Error("DNS lookup failed");
    for (const record of records) {
        if (isBlockedIp(record.address)) {
            throw new Error(`Blocked private IP resolution for ${hostname}`);
        }
    }
    return parsed;
}

/**
 * The resolver the crawler connects with: it fails when any address of the host is not public, so the connection
 * uses an address checked at connect time. A host that answers a public address to the first check and a private one
 * to the connect (DNS rebinding) is refused.
 */
export const publicOnlyLookup: LookupFunction = (hostname, options, callback) => {
    dns.lookup(hostname, {family: options.family, hints: options.hints, all: true, verbatim: true}, (error, addresses) => {
        if (error) return callback(error, "", 0);
        if (addresses.length === 0 || addresses.some((record) => isBlockedIp(record.address))) {
            const blocked: NodeJS.ErrnoException = new Error(`Blocked private IP resolution for ${hostname}`);
            blocked.code = "EBLOCKEDADDRESS";
            return callback(blocked, "", 0);
        }
        if (options.all) return callback(null, addresses);
        callback(null, addresses[0].address, addresses[0].family);
    });
};

/** Reads a stream up to `maxBytes`, then stops it: a larger body is cut at the limit, never held whole. */
export function readCapped(stream: Readable, maxBytes: number): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        let size = 0;
        const finish = () => resolve(Buffer.concat(chunks, Math.min(size, maxBytes)));
        stream.on("data", (chunk: Buffer) => {
            chunks.push(chunk);
            size += chunk.length;
            if (size >= maxBytes) {
                finish();
                stream.destroy();
            }
        });
        stream.on("end", finish);
        stream.on("error", reject);
        // Closed before its end (timeout, cancel): settled already when the body was read or cut.
        stream.on("close", () => reject(new Error("Response closed before its end")));
    });
}

function decodedBody(response: http.IncomingMessage): Readable {
    const encoding = String(response.headers["content-encoding"] || "").toLowerCase();
    const decoder = encoding === "gzip" || encoding === "x-gzip"
        ? zlib.createGunzip()
        : encoding === "deflate"
          ? zlib.createInflate()
          : encoding === "br"
            ? zlib.createBrotliDecompress()
            : undefined;
    if (!decoder) return response;
    // A failure on either side destroys both; the decoder then reports it to the reader.
    pipeline(response, decoder, () => undefined);
    return decoder;
}

type PageResponse = {status: number; location?: string; html?: string};

/** One GET through the pinned resolver; the body is read only for an HTML page, and at most {@link MAX_HTML_BYTES}. */
function requestPage(url: URL, signal: AbortSignal): Promise<PageResponse> {
    const client = url.protocol === "https:" ? https : http;
    return new Promise((resolve, reject) => {
        const request = client.request(url, {
            method: "GET",
            lookup: publicOnlyLookup,
            signal,
            headers: {
                "User-Agent": "ArpeggioSwissOutreachBot/1.0 (+https://arpeggio.local; respectful crawler)",
                Accept: "text/html,application/xhtml+xml",
                "Accept-Encoding": "gzip, deflate, br",
            },
        }, (response) => {
            const status = response.statusCode ?? 0;
            const contentType = String(response.headers["content-type"] || "");
            const isHtml = contentType.includes("text/html") || contentType.includes("application/xhtml");
            if (status < 200 || status >= 300 || !isHtml) {
                response.resume();
                resolve({status, location: response.headers.location});
                return;
            }
            readCapped(decodedBody(response), MAX_HTML_BYTES).then((body) => resolve({status, html: body.toString("utf8")}), reject);
        });
        request.on("error", reject);
        request.end();
    });
}

/**
 * Fetch with manual redirect following and SSRF checks on each hop. Null for anything but an HTML page (another
 * type, a status outside 2xx, a redirect without a target or too many); a failure to reach the page (refused, reset,
 * timed out, a hop to a blocked address) throws, so a caller can count it.
 */
export async function fetchHtml(
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
            const page = await requestPage(safeUrl, controller.signal);
            if (REDIRECT_STATUSES.includes(page.status)) {
                if (!page.location) return null;
                current = new URL(page.location, safeUrl).toString();
                continue;
            }
            return page.html === undefined ? null : {url: safeUrl.toString(), html: page.html};
        } finally {
            clearTimeout(timer);
            externalSignal?.removeEventListener("abort", onAbort);
        }
    }
    return null;
}

/** {@link fetchHtml} that answers null when the page cannot be reached too. */
export function safeFetchHtml(
    rawUrl: string,
    timeoutMs: number,
    maxRedirects = 5,
    externalSignal?: AbortSignal,
): Promise<{url: string; html: string} | null> {
    return fetchHtml(rawUrl, timeoutMs, maxRedirects, externalSignal).catch(() => null);
}
