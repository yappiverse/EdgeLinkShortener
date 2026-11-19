import { OpenAPIHono } from "@hono/zod-openapi";
import { drizzle } from "drizzle-orm/d1";
import { urlsTable } from "../../db/schema";
import { eq } from "drizzle-orm";
import type { Bindings } from "../../types";
import { isEncrypted, decryptUrl } from "../utils/crypto";
import { isSafeTargetUrl } from "../utils/url";

const NOT_FOUND_SENTINEL = "__404__";
const MAX_URL_LENGTH = 8096;

const l1MemoryCache = new Map<string, { url: string; expires: number }>();
const L1_TTL_MS = 60 * 1000;

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

    const edgeCache = caches.default;
    const cacheKey = new Request(c.req.url);
    const cachedResponse = await edgeCache.match(cacheKey);
    if (cachedResponse) {
        return cachedResponse;
    }

    const now = Date.now();
    const l1Hit = l1MemoryCache.get(shortUrl);
    if (l1Hit && l1Hit.expires > now) {
        if (l1Hit.url === NOT_FOUND_SENTINEL) {
            const body = await getNotFoundHtml(c.env.ASSETS, origin);
            return new Response(body, {
                status: 404,
                headers: {
                    "Content-Type": "text/html;charset=UTF-8",
                    "Cache-Control": "public, max-age=60",
                }
            });
        }
        const resp = new Response(null, {
            status: 301,
            headers: {
                "Location": l1Hit.url,
                "Cache-Control": "public, max-age=3600, s-maxage=86400",
                "X-Cache": "HIT-L1",
            },
        });
        c.executionCtx.waitUntil(edgeCache.put(cacheKey, resp.clone()));
        return resp;
    }

    let originalUrl = await c.env.EdgeLinkCache.get(shortUrl, { cacheTtl: 300 });

    if (originalUrl === NOT_FOUND_SENTINEL) {
        l1MemoryCache.set(shortUrl, { url: NOT_FOUND_SENTINEL, expires: now + 30 * 1000 });
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
            l1MemoryCache.set(shortUrl, { url: NOT_FOUND_SENTINEL, expires: now + 30 * 1000 });
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
        l1MemoryCache.set(shortUrl, { url: NOT_FOUND_SENTINEL, expires: now + 30 * 1000 });
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

    l1MemoryCache.set(shortUrl, { url: safeLocation, expires: now + L1_TTL_MS });

    const response = new Response(null, {
        status: 301,
        headers: {
            "Location": safeLocation,
            "Cache-Control": "public, max-age=3600, s-maxage=86400",
            "X-Content-Type-Options": "nosniff",
            "Referrer-Policy": "no-referrer",
            "X-Cache": "HIT-L2",
        },
    });

    c.executionCtx.waitUntil(edgeCache.put(cacheKey, response.clone()));
    return response;
});
