/**
 * AES-256-GCM encryption utilities using the browser Web Crypto API.
 * Encryption key is derived from a password via PBKDF2-SHA256 (100k iterations).
 */

const ITERATIONS = 100_000;
const SALT_LEN   = 16;
const IV_LEN     = 12;

async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** Encrypt a plaintext string. Returns base64-encoded ciphertext (salt | iv | ciphertext). */
export async function encryptData(plaintext: string, password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LEN));
  const iv   = crypto.getRandomValues(new Uint8Array(IV_LEN));
  const key  = await deriveKey(password, salt);

  const encoded   = new TextEncoder().encode(plaintext);
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);

  const combined = new Uint8Array(SALT_LEN + IV_LEN + encrypted.byteLength);
  combined.set(salt, 0);
  combined.set(iv, SALT_LEN);
  combined.set(new Uint8Array(encrypted), SALT_LEN + IV_LEN);

  return btoa(String.fromCharCode(...combined));
}

/** Decrypt a base64-encoded ciphertext produced by encryptData. */
export async function decryptData(ciphertext: string, password: string): Promise<string> {
  const combined = Uint8Array.from(atob(ciphertext), c => c.charCodeAt(0));

  const salt      = combined.slice(0, SALT_LEN);
  const iv        = combined.slice(SALT_LEN, SALT_LEN + IV_LEN);
  const encrypted = combined.slice(SALT_LEN + IV_LEN);

  const key       = await deriveKey(password, salt);
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, encrypted);

  return new TextDecoder().decode(decrypted);
}

/**
 * Get (or generate) a random device-specific key stored in localStorage.
 * Used to encrypt sensitive local data (API keys) at rest.
 */
export function getDeviceKey(): string {
  const LS_KEY = 'muse-device-key';
  let key = localStorage.getItem(LS_KEY);
  if (!key) {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    key = btoa(String.fromCharCode(...bytes));
    localStorage.setItem(LS_KEY, key);
  }
  return key;
}

/** Encrypt a value with the device key (for local-only storage). */
export async function encryptLocal(value: string): Promise<string> {
  return encryptData(value, getDeviceKey());
}

/** Decrypt a value that was encrypted with encryptLocal. */
export async function decryptLocal(ciphertext: string): Promise<string> {
  return decryptData(ciphertext, getDeviceKey());
}
