import { OpenAPIHono } from "@hono/zod-openapi";
import { drizzle } from "drizzle-orm/d1";
import { initialize, svg2png } from "svg2png-wasm";
import wasm from "svg2png-wasm/svg2png_wasm_bg.wasm";
import qr from "qrcode-svg";
import { urlsTable } from "./db/schema";
import { eq } from "drizzle-orm";
import { createHash } from 'crypto';
import { cache } from "hono/cache";
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

app.get("/", async (c) => {
  return c.html(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>QR Code Generator</title>
      <link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ctext y='90' font-size='90'%3E🔗%3C/text%3E%3C/svg%3E">
      <style>
        * { box-sizing: border-box; font-family: sans-serif; }
        body { display: flex; justify-content: center; align-items: center; min-height: 100vh; background: #f5f5f5; margin: 0; padding: 20px; }
        .container { width: 100%; max-width: 400px; background: white; padding: 20px; border-radius: 8px; box-shadow: 0 4px 10px rgba(0, 0, 0, 0.1); text-align: center; }
        input, select, button { width: 100%; padding: 12px; margin-top: 10px; border: 1px solid #ccc; border-radius: 5px; font-size: 16px; outline: none; }
        button { background: #000; color: white; cursor: pointer; font-weight: bold; transition: background 0.3s; }
        button:hover { background: #333; }
        img { margin-top: 20px; width: 100%; max-width: 250px; display: none; margin-left: auto; margin-right: auto; }
        .hidden { display: none; }
        #url-info { margin-top: 20px; text-align: left; font-size: 14px; }
        #url-info p { margin: 10px 0; }
        .url-text { word-break: break-all; display: block; margin-bottom: 10px; }
        .copy-btn { background: #007bff; border: none; padding: 8px 16px; font-size: 14px; cursor: pointer; color: white; border-radius: 4px; width: 100%; transition: background 0.3s; }
        .copy-btn:hover { background: #0056b3; }
        .error-message { color: red; font-size: 14px; margin-top: 10px; display: none; }
      </style>
    </head>
    <body>
      <div class="container">
        <input type="text" id="qr-input" placeholder="Enter URL or text" />
        <div class="error-message" id="error-message">Please enter a valid URL.</div>
        <select id="format">
          <option value="png">PNG</option>
          <option value="svg">SVG</option>
        </select>
        <img id="qr-code" alt="QR Code" />
        <div id="url-info" class="hidden">
          <p><strong>Original URL:</strong> <span id="original-url" class="url-text"></span></p>
          <p>
            <strong>Shortened URL:</strong> 
            <span id="short-url" class="url-text"></span>
            <button class="copy-btn" onclick="copyToClipboard()">Copy</button>
          </p>
        </div>
        <button id="download-btn" class="hidden" onclick="downloadQRCode()">Download & Save</button>
      </div>
  
      <script>
        let isUrlSaved = false;
        let currentShortUrl = null;
  
        function debounce(func, delay) {
          clearTimeout(debounce.timer);
          debounce.timer = setTimeout(func, delay);
        }
  
        function isValidUrl(url) {
          try {
            new URL(url);
            return true;
          } catch {
            return false;
          }
        }
  
        async function generateShortUrl(input) {
          const res = await fetch("/api/generateShortenedUrl", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url: input }),
          });
          const data = await res.json();
          return data.fullUrl;
        }
  
        async function updateQRCode() {
          const input = document.getElementById("qr-input").value;
          const format = document.getElementById("format").value;
          const img = document.getElementById("qr-code");
          const downloadBtn = document.getElementById("download-btn");
          const urlInfo = document.getElementById("url-info");
          const originalUrlSpan = document.getElementById("original-url");
          const shortUrlSpan = document.getElementById("short-url");
          const errorMessage = document.getElementById("error-message");
  
          errorMessage.style.display = "none";
  
          if (!input.trim()) {
            img.style.display = "none";
            downloadBtn.classList.add("hidden");
            urlInfo.classList.add("hidden");
            return;
          }
  
          if (!isValidUrl(input)) {
            errorMessage.style.display = "block";
            img.style.display = "none";
            downloadBtn.classList.add("hidden");
            urlInfo.classList.add("hidden");
            return;
          }
  
          currentShortUrl = await generateShortUrl(input);
          isUrlSaved = false;

          const baseUrl = window.location.origin;
          const fullShortUrl = \`\${baseUrl}/\${currentShortUrl}\`;
  
          img.src = \`/qrcode?url=\${encodeURIComponent(currentShortUrl)}&format=\${format}\`;
          img.style.display = "block";
          downloadBtn.classList.remove("hidden");
  
          originalUrlSpan.textContent = input;
          shortUrlSpan.textContent = fullShortUrl;
          urlInfo.classList.remove("hidden");
        }
  
        document.getElementById("qr-input").addEventListener("input", () => {
          currentShortUrl = null;
          isUrlSaved = false;
          debounce(updateQRCode, 150);
        });
  
        async function saveUrlIfNeeded() {
        
          if (!isUrlSaved && currentShortUrl) {
            const input = document.getElementById("qr-input").value;
            // const shortCode = new URL(currentShortUrl).pathname.replace("/", "");
            const shortCode = currentShortUrl;

            const saveResponse = await fetch("/api/saveURL", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ originalUrl: input, shortenedUrl: shortCode }),
            });
  
            if (saveResponse.ok) {
              isUrlSaved = true;
            }
          }
        }
  
        async function copyToClipboard() {
          const shortUrlText = document.getElementById("short-url").textContent;
          if (!shortUrlText.trim()) return;
  
          await saveUrlIfNeeded();
  
          navigator.clipboard.writeText(shortUrlText).then(() => {
            const copyButton = document.querySelector(".copy-btn");
            copyButton.textContent = "Copied!";
            setTimeout(() => { copyButton.textContent = "Copy"; }, 2000);
          });
        }
  
        async function downloadQRCode() {
          const format = document.getElementById("format").value;
          if (!currentShortUrl) return;
  
          await saveUrlIfNeeded();
          
  
          const qrCodeUrl = \`/qrcode?url=\${encodeURIComponent(currentShortUrl)}&format=\${format}\`;
          const response = await fetch(qrCodeUrl);
          const blob = await response.blob();
          const downloadLink = document.createElement("a");
          downloadLink.href = URL.createObjectURL(blob);
          downloadLink.download = \`qrcode.\${format}\`;
          document.body.appendChild(downloadLink);
          downloadLink.click();
          document.body.removeChild(downloadLink);
        }
      </script>
    </body>
    </html>
  `);
});


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

app.get(
  '/:shortUrl',
  cache({
    cacheName: 'short-url-cache',
    cacheControl: 'public, max-age=3600', // Cache response for 1 hour
  }),
  async (c) => {
    const db = drizzle(c.env.DB);
    const shortUrl = c.req.param('shortUrl');

    const result = await db
      .select()
      .from(urlsTable)
      .where(eq(urlsTable.shortenedUrl, shortUrl))
      .get();

    if (!result) {
      return c.html(
        `<!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>404 - URL Not Found</title>
          <link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ctext y='90' font-size='90'%3E😢%3C/text%3E%3C/svg%3E">
          <style>
            * { box-sizing: border-box; font-family: Arial, sans-serif; margin: 0; padding: 0; }
            body { display: flex; align-items: center; justify-content: center; height: 100vh; background: #f8f9fa; }
            .container { text-align: center; background: white; padding: 40px; border-radius: 10px; box-shadow: 0px 4px 10px rgba(0, 0, 0, 0.1); max-width: 400px; }
            h1 { font-size: 36px; color: #333; margin-bottom: 10px; }
            p { font-size: 16px; color: #555; margin-bottom: 20px; }
            a { display: inline-block; padding: 12px 20px; background: #007bff; color: white; text-decoration: none; border-radius: 5px; font-weight: bold; transition: background 0.3s; }
            a:hover { background: #0056b3; }
            .sad-face { font-size: 60px; color: #ff3b30; margin-bottom: 10px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="sad-face">😢</div>
            <h1>404 - Not Found</h1>
            <p>Oops! The shortened URL you are looking for does not exist or has expired.</p>
            <a href="/">Go Back Home</a>
          </div>
        </body>
        </html>`,
        404
      );
    }

    return c.redirect(result.originalUrl, 302);
  }
);


export default app;