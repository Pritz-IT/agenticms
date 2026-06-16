import { describe, it, expect } from "vitest";
import { mkdtemp, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  loadCredential,
  normalizeAdminUrl,
  readCredentialStore,
  removeCredential,
  saveCredential,
} from "../src/config";

describe("credential config", () => {
  it("normalizes admin URLs", () => {
    expect(normalizeAdminUrl("https://cms.example.com/")).toBe("https://cms.example.com");
    expect(normalizeAdminUrl("https://cms.example.com/path/?x=1#frag")).toBe("https://cms.example.com/path");
    expect(normalizeAdminUrl("http://localhost:5174/")).toBe("http://localhost:5174");
    expect(() => normalizeAdminUrl("https://user:pass@cms.example.test")).toThrow(/must not contain credentials/);
    expect(() => normalizeAdminUrl("http://cms.example.com")).toThrow(/Refusing non-local HTTP/);
  });

  it("stores credentials with user-only permissions", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sf-cli-config-"));
    const path = join(dir, "credentials.json");

    await saveCredential("https://cms.example.com/", {
      token: "sfcli_token",
      expiresAt: "2030-01-01T00:00:00.000Z",
    }, path);

    const loaded = await loadCredential(undefined, path);
    expect(loaded.adminUrl).toBe("https://cms.example.com");
    expect(loaded.credential.token).toBe("sfcli_token");

    const mode = (await stat(path)).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("removes credentials and advances current admin URL", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sf-cli-config-"));
    const path = join(dir, "credentials.json");

    await saveCredential("https://one.example.com", { token: "one", expiresAt: "2030-01-01T00:00:00.000Z" }, path);
    await saveCredential("https://two.example.com", { token: "two", expiresAt: "2030-01-01T00:00:00.000Z" }, path);

    await removeCredential("https://two.example.com", path);
    const store = await readCredentialStore(path);
    expect(store.credentials["https://two.example.com"]).toBeUndefined();
    expect(store.currentAdminUrl).toBe("https://one.example.com");
  });

  it("drops legacy stored admin URLs containing credentials", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sf-cli-config-"));
    const path = join(dir, "credentials.json");
    await writeFile(path, JSON.stringify({
      currentAdminUrl: "https://user:pass@cms.example.test",
      credentials: {
        "https://user:pass@cms.example.test": {
          token: "legacy",
          expiresAt: "2030-01-01T00:00:00.000Z",
        },
        "https://cms.example.test/": {
          token: "safe",
          expiresAt: "2030-01-01T00:00:00.000Z",
        },
      },
    }));

    const store = await readCredentialStore(path);
    expect(store.currentAdminUrl).toBeUndefined();
    expect(store.credentials["https://user:pass@cms.example.test"]).toBeUndefined();
    expect(store.credentials["https://cms.example.test"]).toMatchObject({ token: "safe" });
    await expect(loadCredential(undefined, path)).rejects.toThrow(/No AgentiCMS admin URL configured/);
  });
});
