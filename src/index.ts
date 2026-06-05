import { OpenAPIHono } from "@hono/zod-openapi";
import { generateRoute } from "./backend/routes/generate";
import { saveRoute } from "./backend/routes/save";
import { redirectRoute } from "./backend/routes/redirect";
import { compress } from 'hono/compress'
import { secureHeaders } from 'hono/secure-headers'
import { bodyLimit } from 'hono/body-limit'
import type { Bindings } from "./types";

const app = new OpenAPIHono<{ Bindings: Bindings }>();

// Apply security headers (CSP, X-Content-Type-Options, etc.) globally
app.use(secureHeaders({
  contentSecurityPolicy: {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'", "https://challenges.cloudflare.com"],
    styleSrc: ["'self'", "'unsafe-inline'"],
    imgSrc: ["'self'", "data:"],
    connectSrc: ["'self'"],
    frameSrc: ["https://challenges.cloudflare.com"],
  },
}))

// Limit request body size to 8KB to prevent abuse
app.use(bodyLimit({
  maxSize: 8 * 1024, // 8KB
  onError: (c) => c.json({ error: "Request body too large" }, 413),
}))

app.get("/api/config", (c) => {
  return c.json({ sitekey: c.env.TURNSTILE_SITEKEY });
});


app.route("/", generateRoute);
app.route("/", saveRoute);
app.route("/", redirectRoute);

export default app;
