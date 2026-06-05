# 🔗 EdgeLink Shortener

A URL shortener and QR code generator built with Hono on Cloudflare Workers. Generate short links, get QR codes in SVG or PNG, and redirect visitors at the edge — with multi-layer caching for minimal latency.

## Features

### URL Shortening
- Shorten any HTTP/HTTPS URL to a compact `lmpt.in/xxxxxx` link
- Custom short codes supported (alphanumeric, 1–12 characters)
- Automatic URL validation — only `http:` and `https:` schemes allowed

### QR Code Generation
- Real-time QR preview as you type
- SVG and PNG output (PNG via WebAssembly in the Worker runtime)
- Downloadable QR codes
- Server-side SVGO optimization for minimal SVG size

### Security
- **Turnstile CAPTCHA** on both generate and save endpoints to prevent abuse
- **AES-256-GCM encryption** at rest in D1 (opt-in via `ENCRYPTION_KEY`)
- **Rate limiting** on save (5 req/min/IP) and redirect (30 req/min/IP) endpoints
- **Content-Security-Policy** headers, body size limit (8 KB), response compression
- Defensive URL re-validation before issuing redirects

### Multi-Layer Caching Architecture
Every redirect goes through three cache layers before touching the database:

```
Request → CDN Edge Cache (caches.default)  ←  fastest (~27 ms)
       ↘ KV (EdgeLinkCache)                ←  warm (~124 ms)
       ↘ D1 (SQLite)                       ←  cold (~132 ms)
```

- **CDN edge cache** caches the full 302 response — no Worker invocation on hit
- **KV cache** shields D1 from repeated lookups for popular links
- **404 sentinel** prevents D1 queries for known-missing short codes

## Performance

Benchmarked from Southeast Asia against `lmpt.in` (100 requests per scenario with keep-alive, 30 for cold paths).

### Root Page (`GET /`)

| Scenario | Min | Median | Avg | P90 | P99 | Max |
|----------|-----|--------|-----|-----|-----|-----|
| Warm (keep-alive) | 12.2 ms | 22.9 ms | 30.1 ms | 47.2 ms | 147.0 ms | 147.0 ms |
| Cold (new TCP+TLS) | 42.8 ms | 62.3 ms | 75.7 ms | 135.9 ms | — | 196.9 ms |

### Redirect (`GET /:shortUrl` → 302)

| Scenario | Min | Median | Avg | P90 | P99 | Max |
|----------|-----|--------|-----|-----|-----|-----|
| Warm cache + keep-alive | 18.4 ms | 27.3 ms | 30.6 ms | 41.9 ms | 135.6 ms | 135.6 ms |
| New connection (warm cache) | 53.5 ms | 123.7 ms | 137.9 ms | 213.5 ms | — | 429.1 ms |
| Cold cache (cache-bust) | 61.1 ms | 131.6 ms | 158.5 ms | 324.3 ms | — | 489.3 ms |
| Concurrent (10 workers) | 63.8 ms | 166.3 ms | 188.0 ms | 363.5 ms | 451.5 ms | 451.5 ms |

### Cache Layer Efficiency

| Cache Layer | Median Latency | vs Cold D1 |
|-------------|---------------|------------|
| CDN Edge Cache | 27.3 ms | 5.6× faster |
| KV Cache | 123.7 ms | 1.2× faster |
| D1 (cold lookup) | 131.6 ms | baseline |

### API (`GET /api/config`)

| Scenario | Min | Median | Avg | P90 | P99 | Max |
|----------|-----|--------|-----|-----|-----|-----|
| Warm (keep-alive) | 14.7 ms | 24.6 ms | 30.3 ms | 53.2 ms | 89.6 ms | 89.6 ms |

## Architecture

```
┌──────────────┐     ┌─────────────────────────────────────┐
│   Browser    │────▶│       Cloudflare Worker              │
│              │     │                                      │
│  GET /:code  │     │  1. CDN Edge Cache (caches.default)  │
│              │     │  2. KV Cache (EdgeLinkCache)         │
│              │     │  3. D1 Database (SQLite)             │
│              │     │                                      │
│              │◀────│  302 Redirect (or cached 302)        │
└──────────────┘     └─────────────────────────────────────┘
```

## How It Works

1. **Generate QR** (`POST /api/generateShortenedUrl`) — validates the URL, verifies Turnstile, generates a short code via SHA-256, renders a QR code (SVG + PNG), and caches the response in the CDN edge cache. Does **not** persist to D1.

2. **Save Link** (`POST /api/saveURL`) — validates both the original and short URL, verifies Turnstile (separate token), optionally encrypts the URL with AES-256-GCM, persists to D1 with `INSERT OR IGNORE`, and pre-warms the KV cache.

3. **Redirect** (`GET /:shortUrl`) — checks CDN cache → KV cache → D1, decrypts if needed, validates the URL scheme, and issues a 302 redirect. The 302 response is cached at the CDN edge for subsequent visitors.

The frontend ties these together: generate first (see the QR + short link), then click "Download & Save" to persist the link. This two-step flow ensures users don't accidentally save unwanted links.

## Setup

### Prerequisites
- [Bun](https://bun.sh)
- Cloudflare account

### Quick Start

```bash
git clone <repo>
cd EdgeLinkShortener
bun install
bun run db:setup
bun run dev
# Open http://localhost:8787
```

### Environment Variables

**`.dev.vars`** (local development):
```env
URL=http://localhost:8787
TURNSTILE_SECRET=1x0000000000000000000000000000000AA  # Turnstile test key
TURNSTILE_SITEKEY=1x00000000000000000000AA             # Turnstile test key
ENCRYPTION_KEY=                                        # optional — generate with: openssl rand -hex 32
```

**`.prod.vars`** (production — keep out of version control):
```env
URL=https://lmpt.in
TURNSTILE_SECRET=<your-turnstile-secret>
TURNSTILE_SITEKEY=<your-turnstile-sitekey>
ENCRYPTION_KEY=<64-char-hex>                           # optional, generate with: openssl rand -hex 32
CLOUDFLARE_D1_TOKEN=<your-api-token>
CLOUDFLARE_ACCOUNT_ID=<your-account-id>
CLOUDFLARE_DATABASE_ID=<your-database-id>
```

### URL Encryption (Optional)

When `ENCRYPTION_KEY` is set, all URLs are encrypted with **AES-256-GCM** before storage in D1. The encryption format is `AES:<base64-iv>:<base64-ciphertext>`. Plaintext URLs (from before encryption was enabled) are handled transparently.

Generate a key:
```bash
openssl rand -hex 32
```

### D1 Database

```bash
# Create the database
bunx wrangler d1 create EdgeLinkDB

# Local development
bun run db:setup       # touch → generate → migrate → seed

# Production
bun run db:migrate:prod
```

### Deploy

```bash
bun run deploy
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | [Cloudflare Workers](https://workers.cloudflare.com) |
| Framework | [Hono](https://hono.dev) (OpenAPI + Zod) |
| Database | [Cloudflare D1](https://developers.cloudflare.com/d1/) (SQLite) |
| Cache | Cloudflare CDN + [Workers KV](https://developers.cloudflare.com/kv/) |
| ORM | [Drizzle ORM](https://orm.drizzle.team) |
| QR Code | [qrcode-svg](https://github.com/papnkukn/qrcode-svg) + [svg2png-wasm](https://github.com/ssssota/svg2png-wasm) |
| CAPTCHA | [Cloudflare Turnstile](https://www.cloudflare.com/products/turnstile/) |
| Crypto | Web Crypto API (AES-256-GCM, PBKDF2) |

## Contributing

Found a bug or have an idea? PRs welcome!

1. Fork the repo
2. Create a branch
3. Make your changes
4. Submit a pull request

## License

MIT
