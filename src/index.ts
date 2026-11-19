import { OpenAPIHono } from "@hono/zod-openapi";
import { generateRoute } from "./backend/routes/generate";
import { saveRoute } from "./backend/routes/save";
import { redirectRoute } from "./backend/routes/redirect";
import { secureHeaders } from "hono/secure-headers";
import { bodyLimit } from "hono/body-limit";
import type { Bindings } from "./types";

const app = new OpenAPIHono<{ Bindings: Bindings }>();

app.use("*", secureHeaders({
    strictTransportSecurity: "max-age=31536000; includeSubDomains; preload",
    xFrameOptions: "DENY",
    xContentTypeOptions: "nosniff",
    referrerPolicy: "strict-origin-when-cross-origin",
    xPermittedCrossDomainPolicies: "none",
    contentSecurityPolicy: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "https://challenges.cloudflare.com"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
        frameSrc: ["https://challenges.cloudflare.com"],
        baseUri: ["'none'"],
        formAction: ["'none'"],
        frameAncestors: ["'none'"],
        objectSrc: ["'none'"],
    },
}));

app.use("*", async (c, next) => {
    await next();
    c.res.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
    c.res.headers.set("X-XSS-Protection", "0");
});

app.use("/api/*", bodyLimit({
    maxSize: 8 * 1024,
    onError: (c) => c.json({ error: "Request body too large" }, 413),
}));

app.get("/api/config", (c) => {
    return c.json(
        { sitekey: c.env.TURNSTILE_SITEKEY },
        200,
        {
            "Cache-Control": "no-store",
        }
    );
});

app.route("/", generateRoute);
app.route("/", saveRoute);
app.route("/", redirectRoute);

export default app;
