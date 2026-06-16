import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { copyGlobalTemplateToSite, copyLayoutFromGlobal, fetchGlobalLayoutTemplates } from "../src/api/layouts";

describe("layout global template api", () => {
  const realFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("uses global template endpoints", async () => {
    const calls: Array<{ url: string; method?: string; body?: string }> = [];
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method, body: init?.body as string | undefined });
      return new Response("[]", { status: 200 });
    }) as typeof fetch;

    await fetchGlobalLayoutTemplates();
    await copyGlobalTemplateToSite("sample", "template-1", "Home.tsx");
    await copyLayoutFromGlobal("sample", "layout-1");

    assert.deepEqual(calls, [
      { url: "/api/global-layout-templates", method: undefined, body: undefined },
      {
        url: "/api/sites/sample/global-layout-templates/template-1/copy",
        method: "POST",
        body: JSON.stringify({ destinationPath: "Home.tsx" }),
      },
      {
        url: "/api/sites/sample/layouts/layout-1/copy-from-global",
        method: "POST",
        body: undefined,
      },
    ]);
  });
});
