import {describe, expect, it} from "vitest";
import {assertSafePublicHttpUrl, isBlockedIp} from "@swissOutreachModule/utilities/adapters/urlSafety";

describe("urlSafety SSRF guards", () => {
    it("blocks private and loopback IPs", () => {
        expect(isBlockedIp("127.0.0.1")).toBe(true);
        expect(isBlockedIp("10.0.0.5")).toBe(true);
        expect(isBlockedIp("192.168.1.1")).toBe(true);
        expect(isBlockedIp("169.254.169.254")).toBe(true);
        expect(isBlockedIp("8.8.8.8")).toBe(false);
    });

    it("rejects non-http schemes and credentialed URLs", async () => {
        await expect(assertSafePublicHttpUrl("file:///etc/passwd")).rejects.toThrow(/http/i);
        await expect(assertSafePublicHttpUrl("https://user:pass@example.com")).rejects.toThrow(/credentials/i);
        await expect(assertSafePublicHttpUrl("http://127.0.0.1/")).rejects.toThrow(/private|blocked/i);
        await expect(assertSafePublicHttpUrl("http://localhost/admin")).rejects.toThrow(/hostname|blocked/i);
    });

    it("allows public https URLs", async () => {
        const url = await assertSafePublicHttpUrl("https://www.admin.ch/gov/de/start.html");
        expect(url.hostname).toContain("admin.ch");
    });
});
