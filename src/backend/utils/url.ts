const BASE62 = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
const DISALLOWED_SCHEMES = new Set(["javascript:", "data:", "vbscript:", "file:", "blob:", "about:"]);

export function generateShortUrl(length = 8): string {
    const bytes = new Uint8Array(length);
    crypto.getRandomValues(bytes);
    let result = "";
    for (let i = 0; i < length; i++) {
        result += BASE62[bytes[i] % 62];
    }
    return result;
}

export function isSafeTargetUrl(rawUrl: string, allowedHost?: string): boolean {
    if (!rawUrl || typeof rawUrl !== "string") return false;
    if (rawUrl.length > 8096) return false;

    if (/[\x00-\x1F\x7F]/.test(rawUrl)) return false;

    let parsed: URL;
    try {
        parsed = new URL(rawUrl);
    } catch {
        return false;
    }

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return false;
    }

    if (DISALLOWED_SCHEMES.has(parsed.protocol)) {
        return false;
    }

    const hostname = parsed.hostname.toLowerCase().trim();
    if (!hostname) return false;

    if (
        hostname === "localhost" ||
        hostname.endsWith(".localhost") ||
        hostname.endsWith(".local") ||
        hostname.endsWith(".internal")
    ) {
        return false;
    }

    if (allowedHost && (hostname === allowedHost || hostname === `www.${allowedHost}`)) {
        if (parsed.pathname.startsWith("/api/") || parsed.pathname.startsWith("/_qr_cache/")) {
            return false;
        }
    }

    const ipv4Regex = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
    const ipMatch = hostname.match(ipv4Regex);
    if (ipMatch) {
        const [, a, b, c, d] = ipMatch.map(Number);
        if ([a, b, c, d].some(octet => octet < 0 || octet > 255)) return false;
        if (a === 0) return false;
        if (a === 127) return false;
        if (a === 10) return false;
        if (a === 172 && b >= 16 && b <= 31) return false;
        if (a === 192 && b === 168) return false;
        if (a === 169 && b === 254) return false;
        if (a === 100 && b >= 64 && b <= 127) return false;
    }

    if (
        hostname === "::1" ||
        hostname === "[::1]" ||
        hostname.startsWith("fe80:") ||
        hostname.startsWith("fc00:") ||
        hostname.startsWith("fd00:")
    ) {
        return false;
    }

    return true;
}
