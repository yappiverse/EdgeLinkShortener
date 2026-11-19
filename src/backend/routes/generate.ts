import { OpenAPIHono } from "@hono/zod-openapi";
import { generateShortUrl, isSafeTargetUrl } from "../utils/url";
import { encryptUrl } from "../utils/crypto";
import type { Bindings } from "../../types";
import type { TurnstileVerifyResponse } from "../../types";

const MAX_URL_LENGTH = 8096;
const GENERATE_RATE_LIMIT = 20;
const GENERATE_WINDOW_SECONDS = 60;

export const generateRoute = new OpenAPIHono<{ Bindings: Bindings }>();

generateRoute.post("/api/generateShortenedUrl", async (c) => {
    const ip = c.req.header("CF-Connecting-IP") ?? "unknown";
    const windowKey = Math.floor(Date.now() / (GENERATE_WINDOW_SECONDS * 1000));
    const rateLimitKey = `ratelimit:gen:${ip}:${windowKey}`;

    const currentCount = parseInt(await c.env.EdgeLinkCache.get(rateLimitKey) ?? "0", 10);
    if (currentCount >= GENERATE_RATE_LIMIT) {
        return c.json({ error: "Too many requests. Please try again later." }, 429);
    }
    c.executionCtx.waitUntil(
        c.env.EdgeLinkCache.put(rateLimitKey, String(currentCount + 1), { expirationTtl: GENERATE_WINDOW_SECONDS * 2 })
    );

    let body: { url?: unknown; cfToken?: unknown };
    try {
        body = await c.req.json();
    } catch {
        return c.json({ error: "Invalid JSON body" }, 400);
    }

    const { url, cfToken } = body;
    if (typeof url !== "string" || !url.trim()) return c.json({ error: "URL is required" }, 400);
    if (typeof cfToken !== "string" || !cfToken.trim()) return c.json({ error: "CAPTCHA token is required" }, 400);

    if (url.length > MAX_URL_LENGTH) {
        return c.json({ error: `URL exceeds maximum length of ${MAX_URL_LENGTH} characters` }, 400);
    }

    let allowedHost: string | undefined;
    try {
        allowedHost = new URL(c.env.URL).hostname;
    } catch {}

    if (!isSafeTargetUrl(url, allowedHost)) {
        return c.json({ error: "Invalid or prohibited URL destination" }, 400);
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

    const storedUrl = c.env.ENCRYPTION_KEY
        ? await encryptUrl(url, c.env.ENCRYPTION_KEY)
        : url;

    let uniqueId = "";
    let saved = false;

    for (let attempt = 0; attempt < 3; attempt++) {
        uniqueId = generateShortUrl(8);
        const { meta } = await c.env.DB.prepare(
            "INSERT OR IGNORE INTO urls (shortened_url, original_url) VALUES (?1, ?2)"
        ).bind(uniqueId, storedUrl).run();

        if (meta.changes > 0) {
            saved = true;
            break;
        }
    }

    if (!saved) {
        return c.json({ error: "Failed to generate unique link. Please try again." }, 500);
    }

    c.executionCtx.waitUntil(
        c.env.EdgeLinkCache.put(uniqueId, url, { expirationTtl: 86400 })
    );

    const fullUrl = `${c.env.URL}/${uniqueId}`;

    return c.json({
        shortenedUrl: uniqueId,
        fullUrl,
        saved: true
    }, 200, {
        "Cache-Control": "private, no-store",
    });
});
