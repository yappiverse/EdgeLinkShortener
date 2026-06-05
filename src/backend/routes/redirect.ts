import { OpenAPIHono } from "@hono/zod-openapi";
import { drizzle } from "drizzle-orm/d1";
import { urlsTable } from "../../db/schema";
import { eq } from "drizzle-orm";
import type { Bindings } from "../../types";
import { isEncrypted, decryptUrl } from "../utils/crypto";

const NOT_FOUND_SENTINEL = "__404__";
const REDIRECT_RATE_LIMIT = 30;
const REDIRECT_WINDOW_SECONDS = 60;
const MAX_URL_LENGTH = 8096;

function isValidRedirectUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export const redirectRoute = new OpenAPIHono<{ Bindings: Bindings }>();

redirectRoute.get("/:shortUrl", async (c) => {
  const shortUrl = c.req.param("shortUrl");

  // Validate shortUrl format: alphanumeric only, 1–12 chars
  if (!/^[0-9a-zA-Z]{1,12}$/.test(shortUrl)) {
    const notFoundRes = await c.env.ASSETS.fetch(new Request(`${new URL(c.req.url).origin}/404.html`));
    return new Response(notFoundRes.body, { status: 404, headers: { "Content-Type": "text/html;charset=UTF-8" } });
  }

  // Rate limiting per IP on redirect endpoint
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

  const edgeCache = caches.default;
  const cacheKey = new Request(c.req.url);

  const cachedResponse = await edgeCache.match(cacheKey);
  if (cachedResponse) {
    return new Response(cachedResponse.body, {
      status: cachedResponse.status,
      headers: {
        ...Object.fromEntries(cachedResponse.headers),
        "X-Cache-Hit": "true",
      },
    });
  }

  let originalUrl = await c.env.EdgeLinkCache.get(shortUrl, { cacheTtl: 120 });

  if (originalUrl === NOT_FOUND_SENTINEL) {
    const notFoundRes = await c.env.ASSETS.fetch(new Request(`${new URL(c.req.url).origin}/404.html`));
    return new Response(notFoundRes.body, { status: 404, headers: { "Content-Type": "text/html;charset=UTF-8" } });
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
      const notFoundRes = await c.env.ASSETS.fetch(new Request(`${new URL(c.req.url).origin}/404.html`));
      return new Response(notFoundRes.body, { status: 404, headers: { "Content-Type": "text/html;charset=UTF-8" } });
    }

    originalUrl = result.originalUrl;

    // Decrypt if stored as ciphertext (backward-compat: plaintext rows pass through)
    if (c.env.ENCRYPTION_KEY && isEncrypted(originalUrl)) {
      originalUrl = await decryptUrl(originalUrl, c.env.ENCRYPTION_KEY);
    }

    // Cache the decrypted plaintext in KV for fast future reads
    c.executionCtx.waitUntil(
      c.env.EdgeLinkCache.put(shortUrl, originalUrl, { expirationTtl: 3600 })
    );
  }

  // Defense-in-depth: re-validate URL scheme before issuing redirect
  if (!isValidRedirectUrl(originalUrl)) {
    c.executionCtx.waitUntil(
      c.env.EdgeLinkCache.put(shortUrl, NOT_FOUND_SENTINEL, { expirationTtl: 3600 })
    );
    const notFoundRes = await c.env.ASSETS.fetch(new Request(`${new URL(c.req.url).origin}/404.html`));
    return new Response(notFoundRes.body, { status: 404, headers: { "Content-Type": "text/html;charset=UTF-8" } });
  }

  // Truncate overly long URLs to prevent header injection
  const safeLocation = originalUrl.length > MAX_URL_LENGTH
    ? originalUrl.substring(0, MAX_URL_LENGTH)
    : originalUrl;

  const response = new Response(null, {
    status: 302,
    headers: {
      "Location": safeLocation,
      "Cache-Control": "no-store",
      "X-Cache-Hit": "false",
    },
  });

  c.executionCtx.waitUntil(edgeCache.put(cacheKey, response.clone()));

  return response;
});
