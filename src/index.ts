import { OpenAPIHono } from "@hono/zod-openapi";
import { generateRoute } from "./backend/routes/generate";
import { saveRoute } from "./backend/routes/save";
import { redirectRoute } from "./backend/routes/redirect";
import type { Bindings } from "./types";

const app = new OpenAPIHono<{ Bindings: Bindings }>();

app.get("/", (c) => c.redirect("/index.html"));


app.route("/", generateRoute);
app.route("/", saveRoute);
app.route("/", redirectRoute);

export default app;
