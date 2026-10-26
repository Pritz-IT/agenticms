import { describe, it, expect } from "vitest";
import { decryptSecret, encryptSecret } from "../../../src/services/mail/secret-box.js";

const KEY = "k".repeat(32);

describe("secret-box", () => {
  it("round-trips and never stores the plaintext", () => {
    const sealed = encryptSecret("hunter2-smtp", KEY);
    expect(sealed).not.toContain("hunter2");
    expect(decryptSecret(sealed, KEY)).toBe("hunter2-smtp");
  });

  it("rejects tampered ciphertext and a wrong key", () => {
    const sealed = encryptSecret("value", KEY);
    const parts = sealed.split(".");
    parts[3] = Buffer.from("other").toString("base64url");
    expect(() => decryptSecret(parts.join("."), KEY)).toThrow();
    expect(() => decryptSecret(sealed, "z".repeat(32))).toThrow();
  });

  it("refuses to work without a real key", () => {
    expect(() => encryptSecret("value", "")).toThrow(/SECRETS_KEY/);
  });
});
