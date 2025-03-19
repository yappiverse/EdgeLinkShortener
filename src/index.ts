import { OpenAPIHono } from "@hono/zod-openapi";
import { drizzle } from "drizzle-orm/d1";
import { initialize, svg2png } from "svg2png-wasm";
import wasm from "svg2png-wasm/svg2png_wasm_bg.wasm";
import qr from "qrcode-svg";
import { urlsTable } from "./db/schema";
import { eq } from "drizzle-orm";
import { createHash } from 'crypto';
import { cache } from "hono/cache";
import { cors } from "hono/cors";
export type Bindings = {
  DB: D1Database;
  URL: string;
};

const app = new OpenAPIHono<{ Bindings: Bindings }>();

app.use('/api/*', async (c, next) => {
  const allowedOrigins = [c.env.URL]; // Allowed origins from env
  const origin = c.req.header('Origin'); // Get Origin header

  // If origin is missing or not allowed, reject the request
  if (!origin || !allowedOrigins.includes(origin)) {
    return c.text('Forbidden: Origin not allowed', 403);
  }

  // Apply CORS middleware if the origin is allowed
  const corsMiddleware = cors({
    origin: allowedOrigins,
  });

  return corsMiddleware(c, next);
});


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
        .copy-btn {
          background: #007bff;
          border: none;
          padding: 8px 16px;
          font-size: 14px;
          cursor: pointer;
          color: white;
          border-radius: 4px;
          width: 100%;
          transition: background 0.3s, transform 0.2s ease;
        }

        .copy-btn:hover {
          background: #0056b3;
        }

        .copy-btn:active {
          transform: scale(0.95);
        }

        .copy-btn.copied {
          background: #28a745 !important; /* Green when copied */
          transform: scale(1.01);
        }

        .error-message { color: red; font-size: 14px; margin-top: 10px; display: none; }

        .toast {
          position: fixed;
          top: 20px;
          right: 20px;
          background: #007bff;
          color: white;
          padding: 12px 20px;
          border-radius: 5px;
          font-size: 14px;
          opacity: 0;
          transition: opacity 0.3s ease, transform 0.3s ease;
          box-shadow: 0 4px 10px rgba(0, 123, 255, 0.3); /* Soft blue glow */
        }

        .toast.show {
          opacity: 1;
          transform: translateY(10px);
        }



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
      // Global variable to hold the latest response data from /api/generateShortenedUrl
      let currentQrData = null;
      let isUrlSaved = false;

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

      // Updated API call: returns the entire JSON response including qrCode
      async function generateShortUrl(input) {
        const res = await fetch("/api/generateShortenedUrl", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: input })
        });
        return await res.json();
      }

      async function updateQRCode() {
        const input = document.getElementById("qr-input").value;
        const format = document.getElementById("format").value; // still useful for labeling the download
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

        // Fetch the complete response with shortened URL and QR code data
        currentQrData = await generateShortUrl(input);
        isUrlSaved = false;

        // Use the returned Base64 encoded QR code directly for the image
        img.src = currentQrData.qrCode;
        img.style.display = "block";
        downloadBtn.classList.remove("hidden");

        // Update URL info display
        originalUrlSpan.textContent = input;
        shortUrlSpan.textContent = currentQrData.fullUrl;
        urlInfo.classList.remove("hidden");
      }

      document.getElementById("qr-input").addEventListener("input", () => {
        currentQrData = null;
        isUrlSaved = false;
        debounce(updateQRCode, 50);
      });

      async function saveUrlIfNeeded() {
        if (!isUrlSaved && currentQrData) {
          const input = document.getElementById("qr-input").value;
          // currentQrData.shortenedUrl holds the short code
          const saveResponse = await fetch("/api/saveURL", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ originalUrl: input, shortenedUrl: currentQrData.shortenedUrl }),
          });

          if (saveResponse.ok) {
            isUrlSaved = true;
          }
        }
      }

      async function copyToClipboard() {
        const copyButton = document.querySelector(".copy-btn");
        const shortUrlText = document.getElementById("short-url").textContent;
        if (!shortUrlText.trim()) return;

        await saveUrlIfNeeded();

        navigator.clipboard.writeText(shortUrlText).then(() => {
          showToast("✅ Link copied to clipboard!");

          // Button Animation
          copyButton.classList.add("copied");
          setTimeout(() => {
            copyButton.classList.remove("copied");
          }, 1000);
        });
      }

      function showToast(message) {
        const toast = document.createElement("div");
        toast.className = "toast";
        toast.textContent = message;
        document.body.appendChild(toast);

        setTimeout(() => {
          toast.classList.add("show");
        }, 100); // Small delay to trigger animation

        setTimeout(() => {
          toast.classList.remove("show");
          setTimeout(() => toast.remove(), 300);
        }, 2000);
      }

      // Updated download function uses the Base64 data URL from the API response
      async function downloadQRCode() {
        if (!currentQrData) return;
        await saveUrlIfNeeded();

        const downloadLink = document.createElement("a");
        downloadLink.href = currentQrData.qrCode;
        // Use the format (png or svg) from the selection for the file extension
        const extension = document.getElementById("format").value;
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
  await initializeWasm(); // Ensure WASM is initialized

  const db = drizzle(c.env.DB);
  const { url, size = 600, format = "png" } = await c.req.json();

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

  // Generate QR Code
  const qrCode = new qr({
    content: `${c.env.URL}/${uniqueId}`,
    padding: 4,
    width: Number(size),
    height: Number(size),
    color: "#000000",
    background: "#ffffff",
    ecl: "H",
  });

  let svg = qrCode.svg();
  svg = svg.replace('<svg', `<svg viewBox="0 0 ${size} ${size}" preserveAspectRatio="xMidYMid meet"`);

  let qrBase64: string;

  if (format === "svg") {
    qrBase64 = `data:image/svg+xml;base64,${btoa(svg)}`;
  } else {
    try {
      const pngBuffer = await svg2png(svg, { width: Number(size), height: Number(size) });
      qrBase64 = `data:image/png;base64,${Buffer.from(pngBuffer).toString("base64")}`;
    } catch {
      return c.json({ error: "Error generating QR code" }, 500);
    }
  }

  return c.json({
    shortenedUrl: uniqueId,
    fullUrl: `${c.env.URL}/${uniqueId}`,
    qrCode: qrBase64, // 🔥 Base64 encoded QR Code (PNG or SVG)
  });
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