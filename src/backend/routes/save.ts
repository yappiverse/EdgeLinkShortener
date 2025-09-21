import { OpenAPIHono } from "@hono/zod-openapi";
import { drizzle } from "drizzle-orm/d1";
import { urlsTable } from "../../db/schema";
import { eq } from "drizzle-orm";
// import { encrypt } from "../utils/crypto";
import type { Bindings } from "../../types";

export const saveRoute = new OpenAPIHono<{ Bindings: Bindings }>();

saveRoute.post("/api/saveURL", async (c) => {
    const db = drizzle(c.env.DB);
    const { originalUrl, shortenedUrl } = await c.req.json();

    if (!originalUrl || !shortenedUrl) return c.json({ error: "Both originalUrl and shortenedUrl are required" }, 400);

    try {
        new URL(originalUrl);
    } catch {
        return c.json({ error: "Invalid URL format" }, 400);
    }

    const existingUrl = await db.select().from(urlsTable).where(eq(urlsTable.shortenedUrl, shortenedUrl)).get();
    if (existingUrl) return c.json({ error: "URL already exists" }, 400);

    // const encryptedUrl = await encrypt(originalUrl, c.env.secretKey);
    await db.insert(urlsTable).values({ shortenedUrl, originalUrl }).execute();

    return c.json({ message: "URL saved successfully" });
});
