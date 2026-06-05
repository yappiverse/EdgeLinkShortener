import { OpenAPIHono } from "@hono/zod-openapi";
import qr from "qrcode-svg";
import { svg2png } from "svg2png-wasm";
import { initializeWasm } from "../utils/wasm";
import { generateShortUrl } from "../utils/url";
import type { Bindings } from "../../types";
import type { TurnstileVerifyResponse } from "../../types";
import { optimize } from "svgo";

const MAX_URL_LENGTH = 8096;

export const generateRoute = new OpenAPIHono<{ Bindings: Bindings }>();

generateRoute.post("/api/generateShortenedUrl", async (c) => {
    await initializeWasm();
    const { url, size: rawSize = 600, cfToken } = await c.req.json();
    if (!url) return c.json({ error: "URL is required" }, 400);
    if (!cfToken) return c.json({ error: "CAPTCHA token is required" }, 400);

    // Enforce maximum URL length
    if (url.length > MAX_URL_LENGTH) {
        return c.json({ error: `URL exceeds maximum length of ${MAX_URL_LENGTH} characters` }, 400);
    }

    // Validate URL scheme — only allow http and https
    let parsedUrl: URL;
    try {
        parsedUrl = new URL(url);
    } catch {
        return c.json({ error: "Invalid URL format" }, 400);
    }
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
        return c.json({ error: "Only http and https URLs are allowed" }, 400);
    }

    // Clamp QR size to a safe range
    const size = Math.min(Math.max(Number(rawSize) || 600, 100), 2000);

    const ip = c.req.header("CF-Connecting-IP") ?? "";
    const verifyBody = new URLSearchParams({
        secret: c.env.TURNSTILE_SECRET,
        response: cfToken,
        remoteip: ip,
    });
    const verifyRes = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
        method: "POST",
        body: verifyBody,
    });
    const verification = await verifyRes.json() as TurnstileVerifyResponse;
    if (!verification.success) {
        return c.json({ error: "CAPTCHA verification failed" }, 403);
    }

    const uniqueId = generateShortUrl(url);

    const qrCode = new qr({
        content: `${c.env.URL}/${uniqueId}`,
        padding: 4,
        width: size,
        height: size,
        color: "#000000",
        background: "#ffffff",
        ecl: "H",
        join: true
    });

    let svg = qrCode.svg();
    svg = svg.replace(
        `<svg`,
        `<svg viewBox="0 0 ${size} ${size}" preserveAspectRatio="xMidYMid meet"`
    );

    const optimized = optimize(svg, { multipass: true });
    const qrSvgUri = `data:image/svg+xml;utf8,${encodeURIComponent(optimized.data)}`;

    let qrPngBase64;
    try {
        const pngBuffer = await svg2png(svg, { width: size, height: size });
        qrPngBase64 = `data:image/png;base64,${Buffer.from(pngBuffer).toString("base64")}`;
    } catch {
        return c.json({ error: "Error generating PNG QR code" }, 500);
    }

    const response = new Response(
        JSON.stringify({
            shortenedUrl: uniqueId,
            fullUrl: `${c.env.URL}/${uniqueId}`,
            qrPng: qrPngBase64,
            qrSvg: qrSvgUri
        }),
        {
            headers: { "Content-Type": "application/json" }
        }
    );

    // Cache the QR API response in CDN cache with a prefixed key to avoid collision with redirect cache
    const cacheKey = new Request(`${new URL(c.req.url).origin}/_qr_cache/${uniqueId}`);
    c.executionCtx.waitUntil(
        caches.default.put(cacheKey, response.clone())
    );

    return response;
});
