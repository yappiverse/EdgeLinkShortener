import { createHash } from "crypto";

const BASE62 = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

function toBase62(num: number): string {
    if (num === 0) return BASE62[0];
    let result = "";
    while (num > 0) {
        result = BASE62[num % 62] + result;
        num = Math.floor(num / 62);
    }
    return result;
}

export function generateShortUrl(url: string): string {
    const input = url + Date.now().toString();
    const hash = createHash("sha256").update(input).digest("hex");
    const num = parseInt(hash.substring(0, 9), 16);
    return toBase62(num);
}
