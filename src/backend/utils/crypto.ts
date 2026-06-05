/**
 * AES-256-GCM encryption/decryption for URL-at-rest protection in D1.
 *
 * Key is derived once via PBKDF2 and cached in module scope so per-request
 * latency is limited to hardware-accelerated AES-GCM (~microseconds).
 *
 * Format: `AES:<base64-iv>:<base64-ciphertext>`
 * Plaintext URLs (backward compat / no key configured) are stored as-is.
 */

const ENCRYPTION_ALGORITHM = "AES-GCM";
const KEY_LENGTH = 256;
const PBKDF2_ITERATIONS = 100_000;
const IV_LENGTH = 12;
const ENCRYPTED_PREFIX = "AES:";

// --- key cache -----------------------------------------------------------
const keyCache = new Map<string, CryptoKey>();

async function getKey(secret: string): Promise<CryptoKey> {
  const cached = keyCache.get(secret);
  if (cached) return cached;

  // Fixed salt derived from the secret so same secret → same key every time.
  // This lets us cache the key and skip PBKDF2 on every request.
  const encoder = new TextEncoder();
  const secretBytes = encoder.encode(secret);
  const saltHash = await crypto.subtle.digest("SHA-256", secretBytes);
  const salt = new Uint8Array(saltHash).slice(0, 16);

  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    secretBytes,
    "PBKDF2",
    false,
    ["deriveKey"],
  );

  const key = await crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt.buffer as ArrayBuffer,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: ENCRYPTION_ALGORITHM, length: KEY_LENGTH },
    false,
    ["encrypt", "decrypt"],
  );

  keyCache.set(secret, key);
  return key;
}

// --- base64 helpers ------------------------------------------------------
function toBase64(buf: Uint8Array): string {
  return btoa(String.fromCharCode(...buf));
}

function fromBase64(b64: string): Uint8Array {
  return new Uint8Array(atob(b64).split("").map((c) => c.charCodeAt(0)));
}

// --- public API ----------------------------------------------------------

/** Returns true if the value is an encrypted payload. */
export function isEncrypted(value: string): boolean {
  return value.startsWith(ENCRYPTED_PREFIX);
}

/** Encrypt a plaintext URL. Returns the `AES:...` ciphertext string. */
export async function encryptUrl(
  plaintext: string,
  encryptionKey: string,
): Promise<string> {
  const key = await getKey(encryptionKey);
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const data = new TextEncoder().encode(plaintext);

  const ciphertext = await crypto.subtle.encrypt(
    { name: ENCRYPTION_ALGORITHM, iv: iv.buffer as ArrayBuffer },
    key,
    data,
  );

  return `${ENCRYPTED_PREFIX}${toBase64(iv)}:${toBase64(new Uint8Array(ciphertext))}`;
}

/** Decrypt an `AES:...` ciphertext back to a plaintext URL. */
export async function decryptUrl(
  ciphertext: string,
  encryptionKey: string,
): Promise<string> {
  if (!isEncrypted(ciphertext)) {
    throw new Error("Not an encrypted value");
  }

  const payload = ciphertext.slice(ENCRYPTED_PREFIX.length);
  const colonIdx = payload.indexOf(":");
  if (colonIdx === -1) throw new Error("Invalid encrypted format");

  const iv = fromBase64(payload.slice(0, colonIdx));
  const data = fromBase64(payload.slice(colonIdx + 1));
  const key = await getKey(encryptionKey);

  const decrypted = await crypto.subtle.decrypt(
    { name: ENCRYPTION_ALGORITHM, iv: iv.buffer as ArrayBuffer },
    key,
    data,
  );

  return new TextDecoder().decode(decrypted);
}
