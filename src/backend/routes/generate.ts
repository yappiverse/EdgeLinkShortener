import { OpenAPIHono } from "@hono/zod-openapi";
import qr from "qrcode-svg";
import { svg2png } from "svg2png-wasm";
import { initializeWasm } from "../utils/wasm";
import { generateShortUrl, isSafeTargetUrl } from "../utils/url";
import type { Bindings } from "../../types";
import type { TurnstileVerifyResponse } from "../../types";
import { optimize } from "svgo";

const MAX_URL_LENGTH = 8096;
const GENERATE_RATE_LIMIT = 10;
const GENERATE_WINDOW_SECONDS = 60;

export const generateRoute = new OpenAPIHono<{ Bindings: Bindings }>();

generateRoute.post("/api/generateShortenedUrl", async (c) => {
    const ip = c.req.header("CF-Connecting-IP") ?? "unknown";
    const windowKey = Math.floor(Date.now() / (GENERATE_WINDOW_SECONDS * 1000));
    const rateLimitKey = `ratelimit:generate:${ip}:${windowKey}`;

    const currentCount = parseInt(await c.env.EdgeLinkCache.get(rateLimitKey) ?? "0", 10);
    if (currentCount >= GENERATE_RATE_LIMIT) {
        return c.json({ error: "Too many requests. Please try again later." }, 429);
    }
    c.executionCtx.waitUntil(
        c.env.EdgeLinkCache.put(rateLimitKey, String(currentCount + 1), { expirationTtl: GENERATE_WINDOW_SECONDS * 2 })
    );

    let body: { url?: unknown; size?: unknown; format?: unknown; cfToken?: unknown };
    try {
        body = await c.req.json();
    } catch {
        return c.json({ error: "Invalid JSON body" }, 400);
    }

    const { url, size: rawSize = 600, format = "png", cfToken } = body;
    if (typeof url !== "string" || !url.trim()) return c.json({ error: "URL is required" }, 400);
    if (typeof cfToken !== "string" || !cfToken.trim()) return c.json({ error: "CAPTCHA token is required" }, 400);

    if (url.length > MAX_URL_LENGTH) {
        return c.json({ error: `URL exceeds maximum length of ${MAX_URL_LENGTH} characters` }, 400);
    }

    let allowedHost: string | undefined;
    try {
        allowedHost = new URL(c.env.URL).hostname;
    } catch {}

    if (!isSafeTargetUrl(url, allowedHost)) {
        return c.json({ error: "Invalid or prohibited URL destination" }, 400);
    }

    const size = Math.min(Math.max(Number(rawSize) || 600, 100), 2000);

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

    const uniqueId = generateShortUrl(8);

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

    let qrPngBase64: string | undefined;
    if (format !== "svg") {
        try {
            await initializeWasm();
            const pngBuffer = await svg2png(svg, { width: size, height: size });
            qrPngBase64 = `data:image/png;base64,${Buffer.from(pngBuffer).toString("base64")}`;
        } catch {
            return c.json({ error: "Error generating PNG QR code" }, 500);
        }
    }

    const response = new Response(
        JSON.stringify({
            shortenedUrl: uniqueId,
            fullUrl: `${c.env.URL}/${uniqueId}`,
            qrPng: qrPngBase64 ?? null,
            qrSvg: qrSvgUri
        }),
        {
            headers: {
                "Content-Type": "application/json",
                "Cache-Control": "private, no-store",
            }
        }
    );

    return response;
});
