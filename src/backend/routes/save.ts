import { OpenAPIHono } from "@hono/zod-openapi";
import type { Bindings } from "../../types";

const RATE_LIMIT = 5;
const WINDOW_SECONDS = 60;

export const saveRoute = new OpenAPIHono<{ Bindings: Bindings }>();

saveRoute.post("/api/saveURL", async (c) => {
    const ip = c.req.header("CF-Connecting-IP") ?? "unknown";
    const windowKey = Math.floor(Date.now() / (WINDOW_SECONDS * 1000));
    const rateLimitKey = `ratelimit:save:${ip}:${windowKey}`;

    const currentCount = parseInt(await c.env.EdgeLinkCache.get(rateLimitKey) ?? "0", 10);
    if (currentCount >= RATE_LIMIT) {
        return c.json({ error: "Too many requests. Please try again later." }, 429);
    }
    await c.env.EdgeLinkCache.put(rateLimitKey, String(currentCount + 1), { expirationTtl: WINDOW_SECONDS * 2 });

    const { originalUrl, shortenedUrl } = await c.req.json();

    if (!originalUrl || !shortenedUrl) return c.json({ error: "Both originalUrl and shortenedUrl are required" }, 400);

    try {
        new URL(originalUrl);
    } catch {
        return c.json({ error: "Invalid URL format" }, 400);
    }

    const { meta } = await c.env.DB.prepare(
        "INSERT OR IGNORE INTO urls (shortened_url, original_url) VALUES (?1, ?2)"
    ).bind(shortenedUrl, originalUrl).run();

    if (meta.changes === 0) {
        return c.json({ error: "URL already exists" }, 400);
    }

    // Pre-warm KV so the first redirect hits cache instead of D1
    c.executionCtx.waitUntil(
        c.env.EdgeLinkCache.put(shortenedUrl, originalUrl, { expirationTtl: 3600 })
    );

    return c.json({ message: "URL saved successfully" });
});
