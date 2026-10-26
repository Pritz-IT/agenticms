import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { config } from "../../config.js";

// AES-256-GCM for mail secrets at rest. Format: v1.<iv>.<tag>.<ciphertext>, base64url.
const VERSION = "v1";

function key(secret: string): Buffer {
  if (secret.length < 32) {
    const err = new Error("SECRETS_KEY must be set (at least 32 characters) to store mail credentials");
    (err as Error & { statusCode?: number }).statusCode = 400;
    throw err;
  }
  return createHash("sha256").update(secret).digest();
}

export function encryptSecret(plain: string, secret = config.SECRETS_KEY): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(secret), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [VERSION, iv, cipher.getAuthTag(), data].map((p) => (typeof p === "string" ? p : p.toString("base64url"))).join(".");
}

export function decryptSecret(sealed: string, secret = config.SECRETS_KEY): string {
  const [version, iv, tag, data] = sealed.split(".");
  if (version !== VERSION || !iv || !tag || data === undefined) {
    throw new Error("Unreadable stored secret");
  }
  const decipher = createDecipheriv("aes-256-gcm", key(secret), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}
