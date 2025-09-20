import { OpenAPIHono } from "@hono/zod-openapi";
import { drizzle } from "drizzle-orm/d1";
import { urlsTable } from "../../db/schema";
import { eq } from "drizzle-orm";
import { cache } from "hono/cache";
import { decrypt } from "../utils/crypto";
import type { Bindings } from "../../types";

export const redirectRoute = new OpenAPIHono<{ Bindings: Bindings }>();

redirectRoute.get(
    "/:shortUrl",
    cache({ cacheName: "short-url-cache", cacheControl: "public, max-age=3600" }),
    async (c) => {
        const db = drizzle(c.env.DB);
        const shortUrl = c.req.param("shortUrl");

        const result = await db.select().from(urlsTable).where(eq(urlsTable.shortenedUrl, shortUrl)).get();
        if (!result) {
            return c.text('Not Found', 404)
        }

        try {
            const decryptedUrl = await decrypt(result.originalUrl, c.env.secretKey);
            return c.redirect(decryptedUrl, 302);
        } catch {
            return c.json({ error: "Failed to retrieve URL" }, 500);
        }
    }
);
