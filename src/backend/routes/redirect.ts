import { OpenAPIHono } from "@hono/zod-openapi";
import { drizzle } from "drizzle-orm/d1";
import { urlsTable } from "../../db/schema";
import { eq } from "drizzle-orm";
import { cache } from "hono/cache";
// import { decrypt } from "../utils/crypto";
import type { Bindings } from "../../types";

export const redirectRoute = new OpenAPIHono<{ Bindings: Bindings }>();

redirectRoute.get("/:shortUrl", async (c) => {
  const shortUrl = c.req.param("shortUrl");
  const cache = caches.default;
  const cacheKey = new Request(c.req.url);

  const cachedResponse = await cache.match(cacheKey);
  if (cachedResponse) {
    const newResponse = new Response(cachedResponse.body, {
      status: cachedResponse.status,
      headers: {
        ...Object.fromEntries(cachedResponse.headers),
        "X-Cache-Hit": "true",
      },
    });
    return newResponse;
  }


  let originalUrl = await c.env.EdgeLinkCache.get(shortUrl);
  if (!originalUrl) {
    const db = drizzle(c.env.DB);
    const result = await db
      .select({ originalUrl: urlsTable.originalUrl })
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
              * {
                box-sizing: border-box;
                font-family: "Arial", sans-serif;
                margin: 0;
                padding: 0;
              }

              body {
                display: flex;
                align-items: center;
                justify-content: center;
                height: 100vh;
                background: #f8f9fa;
                padding: 20px;
                text-align: center;
              }

              .container {
                background: white;
                padding: 30px;
                border-radius: 12px;
                box-shadow: 0px 4px 15px rgba(0, 0, 0, 0.1);
                max-width: 450px;
                width: 100%;
                transition: transform 0.2s ease-in-out;
              }

              .container:hover {
                transform: translateY(-3px);
              }

              .sad-face {
                font-size: 70px;
                color: #ff3b30;
                margin-bottom: 15px;
                animation: shake 1.5s infinite alternate ease-in-out;
              }

              h1 {
                font-size: 28px;
                color: #333;
                margin-bottom: 10px;
              }

              p {
                font-size: 16px;
                color: #555;
                margin-bottom: 20px;
                line-height: 1.5;
              }

              a {
                display: inline-block;
                padding: 12px 20px;
                background: #007bff;
                color: white;
                text-decoration: none;
                border-radius: 6px;
                font-weight: bold;
                transition: background 0.3s ease, transform 0.2s ease-in-out;
              }

              a:hover {
                background: #0056b3;
                transform: scale(1.05);
              }

              @keyframes shake {
                0% { transform: rotate(-3deg); }
                100% { transform: rotate(3deg); }
              }

              @media (max-width: 480px) {
                .container {
                  padding: 20px;
                  max-width: 90%;
                }

                h1 {
                  font-size: 24px;
                }

                p {
                  font-size: 14px;
                }

                .sad-face {
                  font-size: 60px;
                }
              }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="sad-face">😢</div>
              <h1>404 - Not Found</h1>
              <p>Oops! The shortened URL you are looking for does not exist.</p>
              <a href="/">🔗 Go Back Home</a>
            </div>
          </body>
          </html>`,
        404
      );
    }

    originalUrl = result.originalUrl;

    c.executionCtx.waitUntil(
      c.env.EdgeLinkCache.put(shortUrl, originalUrl, { expirationTtl: 3600 })
    );
  }

  const baseResponse = Response.redirect(originalUrl, 301);
  const response = new Response(baseResponse.body, {
    status: baseResponse.status,
    headers: {
      ...Object.fromEntries(baseResponse.headers),
      "Cache-Control": "public, immutable, max-age=31536000",
      "X-Cache-Hit": "false",
    },
  });
  response.headers.set("Cache-Control", "public, immutable, max-age=31536000"); // 1 year
  response.headers.set("X-Cache-Hit", "false");

  c.executionCtx.waitUntil(cache.put(cacheKey, response.clone()));

  return response;
});
