import { OpenAPIHono } from "@hono/zod-openapi";
import type { Bindings } from "../../types";
import type { TurnstileVerifyResponse } from "../../types";
import { encryptUrl } from "../utils/crypto";
import { isSafeTargetUrl, generateShortUrl } from "../utils/url";

const RATE_LIMIT = 10;
const WINDOW_SECONDS = 60;
const MAX_URL_LENGTH = 8096;

export const saveRoute = new OpenAPIHono<{ Bindings: Bindings }>();

saveRoute.post("/api/saveURL", async (c) => {
    const ip = c.req.header("CF-Connecting-IP") ?? "unknown";
    const windowKey = Math.floor(Date.now() / (WINDOW_SECONDS * 1000));
    const rateLimitKey = `ratelimit:save:${ip}:${windowKey}`;

    const currentCount = parseInt(await c.env.EdgeLinkCache.get(rateLimitKey) ?? "0", 10);
    if (currentCount >= RATE_LIMIT) {
        return c.json({ error: "Too many requests. Please try again later." }, 429);
    }
    c.executionCtx.waitUntil(
        c.env.EdgeLinkCache.put(rateLimitKey, String(currentCount + 1), { expirationTtl: WINDOW_SECONDS * 2 })
    );

    let body: { originalUrl?: unknown; shortenedUrl?: unknown; cfToken?: unknown };
    try {
        body = await c.req.json();
    } catch {
        return c.json({ error: "Invalid JSON body" }, 400);
    }

    const { originalUrl, cfToken } = body;
    let requestedShortUrl = typeof body.shortenedUrl === "string" ? body.shortenedUrl.trim() : "";

    if (typeof originalUrl !== "string" || !originalUrl.trim()) {
        return c.json({ error: "originalUrl is required" }, 400);
    }
    if (typeof cfToken !== "string" || !cfToken.trim()) {
        return c.json({ error: "CAPTCHA token is required" }, 400);
    }

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

    if (originalUrl.length > MAX_URL_LENGTH) {
        return c.json({ error: `URL exceeds maximum length of ${MAX_URL_LENGTH} characters` }, 400);
    }

    let allowedHost: string | undefined;
    try {
        allowedHost = new URL(c.env.URL).hostname;
    } catch {}

    if (!isSafeTargetUrl(originalUrl, allowedHost)) {
        return c.json({ error: "Invalid or prohibited URL destination" }, 400);
    }

    const storedUrl = c.env.ENCRYPTION_KEY
        ? await encryptUrl(originalUrl, c.env.ENCRYPTION_KEY)
        : originalUrl;

    let finalShortUrl = requestedShortUrl;
    let saved = false;

    if (finalShortUrl && /^[0-9a-zA-Z]{1,12}$/.test(finalShortUrl)) {
        const { meta } = await c.env.DB.prepare(
            "INSERT OR IGNORE INTO urls (shortened_url, original_url) VALUES (?1, ?2)"
        ).bind(finalShortUrl, storedUrl).run();
        if (meta.changes > 0) {
            saved = true;
        }
    }

    if (!saved) {
        for (let attempt = 0; attempt < 3; attempt++) {
            finalShortUrl = generateShortUrl(8);
            const { meta } = await c.env.DB.prepare(
                "INSERT OR IGNORE INTO urls (shortened_url, original_url) VALUES (?1, ?2)"
            ).bind(finalShortUrl, storedUrl).run();

            if (meta.changes > 0) {
                saved = true;
                break;
            }
        }
    }

    if (!saved) {
        return c.json({ error: "Failed to allocate unique URL. Please try again." }, 500);
    }

    c.executionCtx.waitUntil(
        c.env.EdgeLinkCache.put(finalShortUrl, originalUrl, { expirationTtl: 86400 })
    );

    return c.json({
        message: "URL saved successfully",
        shortenedUrl: finalShortUrl,
        fullUrl: `${c.env.URL}/${finalShortUrl}`,
    });
});
