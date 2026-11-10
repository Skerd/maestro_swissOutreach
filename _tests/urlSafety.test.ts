import {afterEach, describe, expect, it, vi} from "vitest";
import dns, {type LookupAddress} from "dns";
import http from "http";
import type {AddressInfo} from "net";
import {Readable} from "stream";
import {
    assertSafePublicHttpUrl,
    isBlockedIp,
    publicOnlyLookup,
    readCapped,
    safeFetchHtml,
} from "@swissOutreachModule/utilities/adapters/urlSafety";

/** Makes the resolver answer each list in turn (`{all: true}` lookups), the last one from then on. */
function resolveTo(...answers: LookupAddress[][]) {
    const answer = (addresses: LookupAddress[]) => (...args: unknown[]) => {
        const callback = args[args.length - 1];
        if (typeof callback === "function") callback(null, addresses);
    };
    const spy = vi.spyOn(dns, "lookup").mockImplementation(answer(answers[answers.length - 1]));
    for (const addresses of answers.slice(0, -1)) spy.mockImplementationOnce(answer(addresses));
    return spy;
}

function lookupResult(host: string, all: boolean): Promise<{error: NodeJS.ErrnoException | null; address: string | LookupAddress[]}> {
    return new Promise((resolve) => publicOnlyLookup(host, {all}, (error, address) => resolve({error, address})));
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe("blocked addresses", () => {
    it.each([
        "127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "0.0.0.0",
        // Regression (A5): shared address space (CGNAT) and benchmarking ranges were reachable
        "100.64.0.1", "100.127.255.254", "198.18.0.1", "198.19.255.255",
        "224.0.0.1", "255.255.255.255",
    ])("refuses IPv4 %s", (ip) => {
        expect(isBlockedIp(ip)).toBe(true);
    });

    it.each([
        "::1", "fd00::1", "fe80::1",
        // Regression (A5): the unspecified address and IPv4 addresses written as IPv6 passed
        "::", "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:169.254.169.254", "::ffff:10.0.0.1", "64:ff9b::a00:1", "2002:7f00:1::",
        "ff02::1",
    ])("refuses IPv6 %s", (ip) => {
        expect(isBlockedIp(ip)).toBe(true);
    });

    it.each(["8.8.8.8", "100.128.0.1", "198.20.0.1", "2a00:1450:4001::200e", "::ffff:8.8.8.8"])("allows public %s", (ip) => {
        expect(isBlockedIp(ip)).toBe(false);
    });

    it("refuses what is not an IP address", () => {
        expect(isBlockedIp("example.ch")).toBe(true);
    });
});

describe("checking a URL before a crawl", () => {
    it.each([
        "http://[::ffff:127.0.0.1]/", "http://[::]/", "http://100.64.0.1/", "http://localhost/", "http://printer.local/",
        "ftp://example.ch/", "http://user:secret@example.ch/",
    ])("refuses %s", async (url) => {
        await expect(assertSafePublicHttpUrl(url)).rejects.toThrow();
    });

    it("refuses a host that resolves to a private address", async () => {
        resolveTo([{address: "10.0.0.5", family: 4}]);
        await expect(assertSafePublicHttpUrl("https://intranet.example.ch/")).rejects.toThrow(/Blocked private IP/);
    });
});

describe("the resolver the crawler connects with", () => {
    it("answers with a public address", async () => {
        resolveTo([{address: "93.184.216.34", family: 4}]);
        expect(await lookupResult("example.ch", false)).toEqual({error: null, address: "93.184.216.34"});
        expect(await lookupResult("example.ch", true)).toEqual({error: null, address: [{address: "93.184.216.34", family: 4}]});
    });

    it("fails when any address of the host is private", async () => {
        resolveTo([{address: "93.184.216.34", family: 4}, {address: "::ffff:127.0.0.1", family: 6}]);
        const {error} = await lookupResult("example.ch", false);
        expect(error?.message).toMatch(/Blocked private IP/);
    });

    // Regression (A5): the check resolved the host, then fetch resolved it again, so a host answering a public address
    // first and a private one to the connect reached the private one.
    it("never connects to a private address a host gives after passing the check", async () => {
        const hits: string[] = [];
        const server = http.createServer((req, res) => {
            hits.push(req.url ?? "");
            res.writeHead(200, {"content-type": "text/html"}).end("<p>internal</p>");
        });
        await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
        try {
            const {port} = server.address() as AddressInfo;
            // Public to the check, loopback to the connect
            const lookups = resolveTo([{address: "93.184.216.34", family: 4}], [{address: "127.0.0.1", family: 4}]);

            expect(await safeFetchHtml(`http://rebind.example.ch:${port}/`, 2000)).toBeNull();
            expect(lookups).toHaveBeenCalledTimes(2);
            expect(hits).toEqual([]);
        } finally {
            server.close();
        }
    });
});

describe("reading a page", () => {
    it("cuts a body at the limit", async () => {
        const body = Readable.from([Buffer.alloc(600, "a"), Buffer.alloc(600, "b"), Buffer.alloc(600, "c")]);
        const read = await readCapped(body, 1000);
        expect(read.length).toBe(1000);
        expect(read.toString()).toBe(`${"a".repeat(600)}${"b".repeat(400)}`);
    });

    it("reads a smaller body whole", async () => {
        expect((await readCapped(Readable.from([Buffer.from("<p>hi</p>")]), 1000)).toString()).toBe("<p>hi</p>");
    });
});
