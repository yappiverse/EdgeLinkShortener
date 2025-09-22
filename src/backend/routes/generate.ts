import { OpenAPIHono } from "@hono/zod-openapi";
import qr from "qrcode-svg";
import { svg2png } from "svg2png-wasm";
import { initializeWasm } from "../utils/wasm";
import { generateShortUrl } from "../utils/url";
import type { Bindings } from "../../types";
import { optimize } from "svgo";

export const generateRoute = new OpenAPIHono<{ Bindings: Bindings }>();

generateRoute.post("/api/generateShortenedUrl", async (c) => {
    await initializeWasm();
    const { url, size = 600 } = await c.req.json();

    if (!url) return c.json({ error: "URL is required" }, 400);

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

    const optimized = optimize(svg, {
        multipass: true,
        plugins: [
            "removeDoctype",
            "removeComments",
            "removeMetadata",
            "cleanupAttrs",
            "mergePaths",
            "convertShapeToPath",
            "removeUselessDefs",
            "removeEmptyAttrs",
            "removeEmptyContainers",
            "cleanupIds",
            "collapseGroups",
            "convertTransform",
        ],
    });

    const qrSvgUri = `data:image/svg+xml;utf8,${encodeURIComponent(optimized.data)}`;


    let qrPngBase64;
    try {
        const pngBuffer = await svg2png(svg, { width: size, height: size });
        qrPngBase64 = `data:image/png;base64,${Buffer.from(pngBuffer).toString("base64")}`;
    } catch {
        return c.json({ error: "Error generating PNG QR code" }, 500);
    }



    c.executionCtx.waitUntil(
        c.env.EdgeLinkCache.put(uniqueId, url, { expirationTtl: 3600 })
    );
    return c.json({
        shortenedUrl: uniqueId,
        fullUrl: `${c.env.URL}/${uniqueId}`,
        qrPng: qrPngBase64,
        qrSvg: qrSvgUri,
    });
});
