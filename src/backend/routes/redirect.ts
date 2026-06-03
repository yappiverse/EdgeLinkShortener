import { OpenAPIHono } from "@hono/zod-openapi";
import { drizzle } from "drizzle-orm/d1";
import { urlsTable } from "../../db/schema";
import { eq } from "drizzle-orm";
import type { Bindings } from "../../types";

const NOT_FOUND_SENTINEL = "__404__";

export const redirectRoute = new OpenAPIHono<{ Bindings: Bindings }>();

redirectRoute.get("/:shortUrl", async (c) => {
  const shortUrl = c.req.param("shortUrl");
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

  let originalUrl = await c.env.EdgeLinkCache.get(shortUrl);

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

    c.executionCtx.waitUntil(
      c.env.EdgeLinkCache.put(shortUrl, originalUrl, { expirationTtl: 3600 })
    );
  }

  const response = new Response(null, {
    status: 301,
    headers: {
      "Location": originalUrl,
      "Cache-Control": "public, immutable, max-age=31536000",
      "X-Cache-Hit": "false",
    },
  });

  c.executionCtx.waitUntil(edgeCache.put(cacheKey, response.clone()));

  return response;
});
