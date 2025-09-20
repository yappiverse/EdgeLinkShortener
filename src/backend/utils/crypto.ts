import crypto from "crypto";

export async function encrypt(text: string, secretKey: string) {
    const encoder = new TextEncoder();
    const data = encoder.encode(text);
    const key = await crypto.subtle.importKey(
        "raw",
        encoder.encode(secretKey).slice(0, 32),
        { name: "AES-GCM" },
        false,
        ["encrypt"]
    );

    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encryptedData = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, data);

    return `${btoa(String.fromCharCode(...iv))}:${btoa(
        String.fromCharCode(...new Uint8Array(encryptedData))
    )}`;
}

export async function decrypt(encryptedText: string, secretKey: string) {
    const [ivBase64, encryptedBase64] = encryptedText.split(":");
    if (!ivBase64 || !encryptedBase64) throw new Error("Invalid encrypted format");

    const iv = new Uint8Array(atob(ivBase64).split("").map((c) => c.charCodeAt(0)));
    const encryptedData = new Uint8Array(atob(encryptedBase64).split("").map((c) => c.charCodeAt(0)));

    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
        "raw",
        encoder.encode(secretKey).slice(0, 32),
        { name: "AES-GCM" },
        false,
        ["decrypt"]
    );

    const decryptedBuffer = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, encryptedData);
    return new TextDecoder().decode(decryptedBuffer);
}
