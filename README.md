# 🦆 QR Code & URL Shortener

Hey there! 👋 This is a fun little project that lets you create QR codes and shorten URLs right from your browser. It's built using HONC Stack and runs on Cloudflare's edge network, making it super fast and reliable.

## What can it do?

### 🔗 URL Shortening

- Make long URLs short and sweet
- Get a unique, memorable short link
- Automatic URL validation and cleanup

### ✨ QR Code Magic

- Turn any URL or text into a QR code
- Choose between SVG or PNG formats
- Get a real-time preview as you type
- Download your QR codes or copy the image link

### ⚡️ Built for Speed

- Runs on Cloudflare Workers (edge computing)
- Uses D1 database for persistent storage
- Serverless architecture means it scales automatically
- Secure HTTPS connections for all requests

## How does it work?

### Behind the Scenes

1. When you enter a URL:

   - It gets validated and cleaned up
   - A unique short code is generated using SHA-256 hashing
   - The mapping is stored in a Cloudflare D1 database
   - You get back a short URL like `https://shortener.web.id/abc1234`

2. When someone scans a QR code or clicks a short URL:

   - The system looks up the original URL
   - Redirects the user instantly

3. QR codes are generated using:

   - `qrcode-svg` for SVG output
   - `svg2png-wasm` for PNG conversion using WebAssembly (WASM)
   - Real-time preview updates as you type

   ### Why WebAssembly for PNG?

   Cloudflare Workers (edge computing) environments don't have native PNG support. To provide PNG output:

   - I use WebAssembly (WASM) to run a lightweight PNG encoder directly in the edge environment
   - The SVG output from qrcode-svg is converted to PNG using svg2png-wasm
   - This approach provides PNG support without requiring native libraries
   - WASM is initialized once at startup for optimal performance

## Security Features

### URL Encryption

All URLs are encrypted before being stored in the database using AES-GCM encryption with a 256-bit key. This ensures that even if someone gains access to the database, they cannot read the original URLs without the secret key.

To generate a secure secret key:

1. Open your terminal
2. Run the following command:
   ```bash
   openssl rand -hex 32
   ```
3. This will generate a 64-character hexadecimal string (32 bytes) that you can use as your secret key

### Setting Up Encryption

1. Add the generated secret key to your environment variables:

   - For development: Add to `.dev.vars`
     ```
     secretKey=your_generated_secret_key_here
     ```
   - For production: Add to `.prod.vars`
     ```
     secretKey=your_generated_secret_key_here
     ```

2. The system will automatically use this key to encrypt and decrypt URLs

## Let's Get Started!

### Quick Setup

1. Clone this repo
2. Install dependencies: `bun install`
3. Set up your local database: `bun run db:setup`
4. Start the dev server: `bun run dev`
5. Open `http://localhost:8787` in your browser

### Deployment

#### Setting Up D1 Database

1. Create a D1 database:

   Using Wrangler CLI:

   ```bash
   bunx wrangler d1 create EdgeLinkDB
   ```

   Or via Cloudflare Dashboard:

   - Go to Cloudflare Dashboard → Workers → D1
   - Click "Create Database"
   - Name your database (e.g., `EdgeLinkDB`)
   - Select your preferred region
   - Click "Create"

2. Bind Database to Worker:

   - In your Cloudflare Dashboard, go to Workers → your-worker → Settings → Variables
   - Under D1 Database Bindings, click "Edit Bindings"
   - Add a new binding:
     - Variable name: `DB`
     - Select your created database
   - Save changes

3. Update Database Name in package.json:

   After creating your database, make sure to update the database name in package.json. Replace "EdgeLinkDB" with your actual database name in these commands:

   ```json
   "db:touch": "wrangler d1 execute YOUR_DB_NAME --local --command='SELECT 1'",
   "db:generate": "drizzle-kit generate",
   "db:migrate": "wrangler d1 migrations apply YOUR_DB_NAME --local"
   ```

4. Update Configuration:

   - In `wrangler.toml`, add:
     ```toml
     [[d1_databases]]
     binding = "DB"
     database_name = "your-database-name"
     database_id = "your-database-id"
     ```
   - In `.prod.vars`, add:
     ```
     CLOUDFLARE_D1_TOKEN=your_api_token
     CLOUDFLARE_ACCOUNT_ID=your_account_id
     CLOUDFLARE_DATABASE_ID=your_database_id
     ```

5. Run Migrations:

   For local development:

   ```bash
   bun run db:setup
   ```

   For production:

   ```bash
   bun run db:migrate:prod
   ```

6. Deploy:
   ```bash
   bun run deploy
   ```
   Verify deployment in Cloudflare Dashboard

## Tech Stack

- **Backend**: Hono ([HONC Stack](https://honc.dev))
- **Database**: [Cloudflare D1](https://developers.cloudflare.com/d1/)
- **ORM**: [Drizzle](https://orm.drizzle.team/)
- **QR Code**: [qrcode-svg](https://github.com/papnkukn/qrcode-svg) + [svg2png-wasm](https://github.com/ssssota/svg2png-wasm)
- **Styling**: CSS

## Contributing

Found a bug? Have an idea? I'd love your help!

1. Fork the repo
2. Create a new branch
3. Make your changes
4. Submit a pull request

## License

MIT License - go wild! 🎉
