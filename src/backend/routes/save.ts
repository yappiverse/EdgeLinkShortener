import { OpenAPIHono } from "@hono/zod-openapi";
import type { Bindings } from "../../types";
import type { TurnstileVerifyResponse } from "../../types";
import { encryptUrl } from "../utils/crypto";

const RATE_LIMIT = 5;
const WINDOW_SECONDS = 60;
const MAX_URL_LENGTH = 8096;

export const saveRoute = new OpenAPIHono<{ Bindings: Bindings }>();

saveRoute.post("/api/saveURL", async (c) => {
    // Rate limiting (soft limit — KV is eventually consistent)
    const ip = c.req.header("CF-Connecting-IP") ?? "unknown";
    const windowKey = Math.floor(Date.now() / (WINDOW_SECONDS * 1000));
    const rateLimitKey = `ratelimit:save:${ip}:${windowKey}`;

    const currentCount = parseInt(await c.env.EdgeLinkCache.get(rateLimitKey) ?? "0", 10);
    if (currentCount >= RATE_LIMIT) {
        return c.json({ error: "Too many requests. Please try again later." }, 429);
    }
    await c.env.EdgeLinkCache.put(rateLimitKey, String(currentCount + 1), { expirationTtl: WINDOW_SECONDS * 2 });

    const { originalUrl, shortenedUrl, cfToken } = await c.req.json();

    if (!originalUrl || !shortenedUrl) return c.json({ error: "Both originalUrl and shortenedUrl are required" }, 400);
    if (!cfToken) return c.json({ error: "CAPTCHA token is required" }, 400);

    // Verify Turnstile CAPTCHA
    const verifyBody = new URLSearchParams({
        secret: c.env.TURNSTILE_SECRET,
        response: cfToken,
        remoteip: ip,
    });
    const verifyRes = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
        method: "POST",
        body: verifyBody,
    });
    const verification = await verifyRes.json() as TurnstileVerifyResponse;
    if (!verification.success) {
        return c.json({ error: "CAPTCHA verification failed" }, 403);
    }

    // Validate URL scheme — only allow http and https
    let parsedUrl: URL;
    try {
        parsedUrl = new URL(originalUrl);
    } catch {
        return c.json({ error: "Invalid URL format" }, 400);
    }
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
        return c.json({ error: "Only http and https URLs are allowed" }, 400);
    }

    // Enforce maximum URL length
    if (originalUrl.length > MAX_URL_LENGTH) {
        return c.json({ error: `URL exceeds maximum length of ${MAX_URL_LENGTH} characters` }, 400);
    }

    // Validate shortenedUrl format: alphanumeric only, 1–12 chars
    if (!/^[0-9a-zA-Z]{1,12}$/.test(shortenedUrl)) {
        return c.json({ error: "Invalid shortened URL format" }, 400);
    }

    // Encrypt URL at rest in D1 if an encryption key is configured
    const storedUrl = c.env.ENCRYPTION_KEY
        ? await encryptUrl(originalUrl, c.env.ENCRYPTION_KEY)
        : originalUrl;

    const { meta } = await c.env.DB.prepare(
        "INSERT OR IGNORE INTO urls (shortened_url, original_url) VALUES (?1, ?2)"
    ).bind(shortenedUrl, storedUrl).run();

    if (meta.changes === 0) {
        return c.json({ error: "URL already exists" }, 400);
    }

    // Pre-warm KV so the first redirect hits cache instead of D1
    c.executionCtx.waitUntil(
        c.env.EdgeLinkCache.put(shortenedUrl, originalUrl, { expirationTtl: 3600 })
    );

    return c.json({ message: "URL saved successfully" });
});
