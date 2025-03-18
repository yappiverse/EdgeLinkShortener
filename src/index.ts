import { OpenAPIHono } from "@hono/zod-openapi";
import { drizzle } from "drizzle-orm/d1";
import { initialize, svg2png } from "svg2png-wasm";
import wasm from "svg2png-wasm/svg2png_wasm_bg.wasm";
import qr from "qrcode-svg";
import { urlsTable } from "./db/schema";
import { eq } from "drizzle-orm";
import { createHash } from 'crypto';

export type Bindings = {
  DB: D1Database;
};

const app = new OpenAPIHono<{ Bindings: Bindings }>();

let isWasmInitialized = false;

async function initializeWasm() {
  if (!isWasmInitialized) {
    try {
      await initialize(wasm);
      isWasmInitialized = true;
    } catch (error) {
      console.error("Failed to initialize WASM:", error);
      throw new Error("WASM initialization failed");
    }
  }
}

const BASE62 = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

function toBase62(num: number): string {
  if (num === 0) return BASE62[0];
  let result = "";
  while (num > 0) {
    result = BASE62[num % 62] + result;
    num = Math.floor(num / 62);
  }
  return result;
}

function generateShortUrl(url: string): string {
  const input = url + Date.now().toString();
  const hash = createHash('sha256').update(input).digest('hex');
  const num = parseInt(hash.substring(0, 9), 16);
  return toBase62(num);
}

app.post("/api/generateShortenedUrl", async (c) => {
  const db = drizzle(c.env.DB);
  const { url } = await c.req.json();

  if (!url) return c.json({ error: "URL is required" }, 400);

  let uniqueId: string;
  let isUnique = false;
  const existingUrls = await db.select({ shortenedUrl: urlsTable.shortenedUrl }).from(urlsTable).all();

  do {
    uniqueId = generateShortUrl(url);
    isUnique = !existingUrls.some((entry) => entry.shortenedUrl === uniqueId);
    if (!isUnique) {
      uniqueId += toBase62(Math.floor(Math.random() * 62));
    }
  } while (!isUnique);

  return c.json({ shortenedUrl: uniqueId, fullUrl: `${uniqueId}` });
});

app.post("/api/saveURL", async (c) => {
  const db = drizzle(c.env.DB);
  const { originalUrl, shortenedUrl } = await c.req.json();


  if (!originalUrl || !shortenedUrl) {
    return c.json({ error: "Both originalUrl and shortenedUrl are required" }, 400);
  }

  try {
    new URL(originalUrl);
  } catch (error) {
    return c.json({ error: "Invalid URL format" }, 400);
  }

  const existingUrl = await db
    .select()
    .from(urlsTable)
    .where(eq(urlsTable.shortenedUrl, shortenedUrl))
    .get();

  if (existingUrl) {
    return c.json({ error: "URL already exists" }, 400);
  }

  try {
    await db.insert(urlsTable).values({
      shortenedUrl,
      originalUrl,
    }).execute();

    return c.json({ message: "URL saved successfully" }, 200);
  } catch (error) {
    console.error("Database error:", error);
    return c.json({ error: "Failed to save URL" }, 500);
  }
});

app.get("/qrcode", async (c) => {
  await initializeWasm();

  const { url, size = 600, format = "png" } = c.req.query();
  if (!url) return c.json({ error: 'Missing "url" parameter' }, 400);

  const qrCode = new qr({
    content: url,
    padding: 4,
    width: Number(size),
    height: Number(size),
    color: "#000000",
    background: "#ffffff",
    ecl: "H",
  });

  let svg = qrCode.svg();
  svg = svg.replace('<svg', `<svg viewBox="0 0 ${size} ${size}" preserveAspectRatio="xMidYMid meet"`);

  if (format === "svg") return c.text(svg, 200, { "Content-Type": "image/svg+xml" });

  try {
    const pngBuffer = await svg2png(svg, { width: Number(size), height: Number(size) });
    return new Response(pngBuffer, { status: 200, headers: { "Content-Type": "image/png" } });
  } catch {
    return c.json({ error: "Error generating PNG" }, 500);
  }
});


export default app;