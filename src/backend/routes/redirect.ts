import { OpenAPIHono } from "@hono/zod-openapi";
import { drizzle } from "drizzle-orm/d1";
import { urlsTable } from "../../db/schema";
import { eq } from "drizzle-orm";
import type { Bindings } from "../../types";
import { isEncrypted, decryptUrl } from "../utils/crypto";
import { isSafeTargetUrl } from "../utils/url";

const NOT_FOUND_SENTINEL = "__404__";
const REDIRECT_RATE_LIMIT = 60;
const REDIRECT_WINDOW_SECONDS = 60;
const MAX_URL_LENGTH = 8096;

let notFoundHtmlPromise: Promise<string> | null = null;

async function getNotFoundHtml(assets: Fetcher, origin: string): Promise<string> {
    if (!notFoundHtmlPromise) {
        notFoundHtmlPromise = assets.fetch(new Request(`${origin}/404.html`))
            .then(res => res.text())
            .catch(() => "<!DOCTYPE html><html><body><h1>404 Not Found</h1></body></html>");
    }
    return notFoundHtmlPromise;
}

export const redirectRoute = new OpenAPIHono<{ Bindings: Bindings }>();

redirectRoute.get("/:shortUrl", async (c) => {
    const shortUrl = c.req.param("shortUrl");
    const origin = new URL(c.req.url).origin;

    if (!/^[0-9a-zA-Z]{1,12}$/.test(shortUrl)) {
        const body = await getNotFoundHtml(c.env.ASSETS, origin);
        return new Response(body, {
            status: 404,
            headers: {
                "Content-Type": "text/html;charset=UTF-8",
                "Cache-Control": "public, max-age=300",
            }
        });
    }

    const ip = c.req.header("CF-Connecting-IP") ?? "unknown";
    const windowKey = Math.floor(Date.now() / (REDIRECT_WINDOW_SECONDS * 1000));
    const rateLimitKey = `ratelimit:redirect:${ip}:${windowKey}`;

    const currentCount = parseInt(await c.env.EdgeLinkCache.get(rateLimitKey) ?? "0", 10);
    if (currentCount >= REDIRECT_RATE_LIMIT) {
        return c.text("Too Many Requests", 429);
    }
    c.executionCtx.waitUntil(
        c.env.EdgeLinkCache.put(rateLimitKey, String(currentCount + 1), { expirationTtl: REDIRECT_WINDOW_SECONDS * 2 })
    );

    let originalUrl = await c.env.EdgeLinkCache.get(shortUrl, { cacheTtl: 300 });

    if (originalUrl === NOT_FOUND_SENTINEL) {
        const body = await getNotFoundHtml(c.env.ASSETS, origin);
        return new Response(body, {
            status: 404,
            headers: {
                "Content-Type": "text/html;charset=UTF-8",
                "Cache-Control": "public, max-age=60",
            }
        });
    }

    if (!originalUrl) {
        const db = drizzle(c.env.DB);
        const result = await db
            .select({ originalUrl: urlsTable.originalUrl })
            .from(urlsTable)
            .where(eq(urlsTable.shortenedUrl, shortUrl))
            .get();

        if (!result) {
            c.executionCtx.waitUntil(
                c.env.EdgeLinkCache.put(shortUrl, NOT_FOUND_SENTINEL, { expirationTtl: 60 })
            );
            const body = await getNotFoundHtml(c.env.ASSETS, origin);
            return new Response(body, {
                status: 404,
                headers: {
                    "Content-Type": "text/html;charset=UTF-8",
                    "Cache-Control": "public, max-age=60",
                }
            });
        }

        originalUrl = result.originalUrl;

        if (c.env.ENCRYPTION_KEY && isEncrypted(originalUrl)) {
            originalUrl = await decryptUrl(originalUrl, c.env.ENCRYPTION_KEY);
        }

        c.executionCtx.waitUntil(
            c.env.EdgeLinkCache.put(shortUrl, originalUrl, { expirationTtl: 86400 })
        );
    }

    let allowedHost: string | undefined;
    try {
        allowedHost = new URL(c.env.URL).hostname;
    } catch {}

    if (!isSafeTargetUrl(originalUrl, allowedHost)) {
        c.executionCtx.waitUntil(
            c.env.EdgeLinkCache.put(shortUrl, NOT_FOUND_SENTINEL, { expirationTtl: 3600 })
        );
        const body = await getNotFoundHtml(c.env.ASSETS, origin);
        return new Response(body, {
            status: 404,
            headers: {
                "Content-Type": "text/html;charset=UTF-8",
                "Cache-Control": "no-store",
            }
        });
    }

    const safeLocation = originalUrl.length > MAX_URL_LENGTH ? originalUrl.substring(0, MAX_URL_LENGTH) : originalUrl;

    return new Response(null, {
        status: 302,
        headers: {
            "Location": safeLocation,
            "Cache-Control": "private, no-cache, no-store, must-revalidate",
            "X-Content-Type-Options": "nosniff",
            "Referrer-Policy": "no-referrer",
        },
    });
});
