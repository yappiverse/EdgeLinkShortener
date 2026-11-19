import { describe, expect, test } from "bun:test";
import { isSafeTargetUrl, generateShortUrl } from "./backend/utils/url";

describe("isSafeTargetUrl", () => {
    test("allows valid public HTTPS and HTTP URLs", () => {
        expect(isSafeTargetUrl("https://google.com")).toBe(true);
        expect(isSafeTargetUrl("https://github.com/naufalsetyawan")).toBe(true);
        expect(isSafeTargetUrl("http://example.org/test?id=123")).toBe(true);
    });

    test("blocks non-HTTP protocols", () => {
        expect(isSafeTargetUrl("javascript:alert(1)")).toBe(false);
        expect(isSafeTargetUrl("data:text/html,<script>alert(1)</script>")).toBe(false);
        expect(isSafeTargetUrl("file:///etc/passwd")).toBe(false);
        expect(isSafeTargetUrl("blob:https://example.com/uuid")).toBe(false);
    });

    test("blocks localhost, loopback and private networks (SSRF)", () => {
        expect(isSafeTargetUrl("http://localhost:3000")).toBe(false);
        expect(isSafeTargetUrl("http://127.0.0.1:8080")).toBe(false);
        expect(isSafeTargetUrl("http://10.0.0.1")).toBe(false);
        expect(isSafeTargetUrl("http://172.16.0.1")).toBe(false);
        expect(isSafeTargetUrl("http://192.168.1.1")).toBe(false);
        expect(isSafeTargetUrl("http://169.254.169.254/latest/meta-data")).toBe(false);
        expect(isSafeTargetUrl("http://[::1]")).toBe(false);
    });

    test("blocks internal loop redirect to API endpoints", () => {
        expect(isSafeTargetUrl("https://lmpt.in/api/saveURL", "lmpt.in")).toBe(false);
        expect(isSafeTargetUrl("https://lmpt.in/_qr_cache/xyz", "lmpt.in")).toBe(false);
        expect(isSafeTargetUrl("https://lmpt.in/blog", "lmpt.in")).toBe(true);
    });

    test("blocks malformed URLs and control characters", () => {
        expect(isSafeTargetUrl("not-a-url")).toBe(false);
        expect(isSafeTargetUrl("https://example.com/\x00evil")).toBe(false);
        expect(isSafeTargetUrl("")).toBe(false);
    });
});

describe("generateShortUrl (Cryptographic High-Entropy)", () => {
    test("generates base62 short identifier of requested length", () => {
        const id1 = generateShortUrl(8);
        const id2 = generateShortUrl(8);
        expect(typeof id1).toBe("string");
        expect(id1.length).toBe(8);
        expect(id2.length).toBe(8);
        expect(/^[0-9a-zA-Z]{8}$/.test(id1)).toBe(true);
        expect(/^[0-9a-zA-Z]{8}$/.test(id2)).toBe(true);
        expect(id1).not.toBe(id2);
    });

    test("generates 1000 unique IDs without collision", () => {
        const set = new Set<string>();
        for (let i = 0; i < 1000; i++) {
            set.add(generateShortUrl(8));
        }
        expect(set.size).toBe(1000);
    });
});
