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

## Let's Get Started!

### Quick Setup

1. Clone this repo
2. Install dependencies: `bun install`
3. Set up your local database: `bun run db:setup`
4. Start the dev server: `bun run dev`
5. Open `http://localhost:8787` in your browser

### Deployment

1. Create a D1 database in Cloudflare
2. Update `wrangler.toml` with your database ID
3. Add your Cloudflare credentials in `.prod.vars`
4. Deploy: `bun run deploy`

## Tech Stack

- **Backend**: Hono ([HONC Stack](https://honc.dev))
- **Database**: [Cloudflare D1](https://developers.cloudflare.com/d1/)
- **ORM**: [Drizzle](https://orm.drizzle.team/)
- **QR Code**: [qrcode-svg](https://github.com/papnkukn/qrcode-svg) + [svg2png-wasm](https://github.com/ssssota/svg2png-wasm)
- **Styling**: CSS

## Contributing

Found a bug? Have an idea? We'd love your help!

1. Fork the repo
2. Create a new branch
3. Make your changes
4. Submit a pull request

## License

MIT License - go wild! 🎉
