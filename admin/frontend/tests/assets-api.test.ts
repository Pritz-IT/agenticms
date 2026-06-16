import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { copyGlobalAssetToSite, fetchAssetLibrary, migrateLegacyAssets } from "../src/api/assets";

describe("assets api", () => {
  const realFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("uses the site-scoped legacy asset migration endpoint", async () => {
    const calls: Array<{ url: string; method?: string }> = [];
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method });
      return new Response(
        JSON.stringify({
          scanned: 1,
          migrated: 1,
          filesCopied: 1,
          filesAlreadyPresent: 0,
          missingFiles: [],
          contentUpdated: 0,
          layoutsUpdated: 0,
        }),
        { status: 200 }
      );
    }) as typeof fetch;

    await migrateLegacyAssets("demo");

    assert.deepEqual(calls, [
      { url: "/api/sites/demo/assets/migrate-legacy", method: "POST" },
    ]);
  });

  it("uses the site-scoped asset library endpoint", async () => {
    const calls: Array<{ url: string; method?: string }> = [];
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method });
      return new Response(JSON.stringify([]), { status: 200 });
    }) as typeof fetch;

    await fetchAssetLibrary("demo");

    assert.deepEqual(calls, [
      { url: "/api/sites/demo/assets/library", method: undefined },
    ]);
  });

  it("uses the site-scoped global asset copy endpoint", async () => {
    const calls: Array<{ url: string; method?: string }> = [];
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method });
      return new Response(
        JSON.stringify({
          id: "asset-1",
          filename: "logo.png",
          mimeType: "image/png",
          filePath: "/assets/demo/logo.png",
          uploadedAt: "2026-06-09T00:00:00.000Z",
          uploadedBy: "test",
        }),
        { status: 200 }
      );
    }) as typeof fetch;

    await copyGlobalAssetToSite("demo", "global-1");

    assert.deepEqual(calls, [
      { url: "/api/sites/demo/global-assets/global-1/copy", method: "POST" },
    ]);
  });
});
