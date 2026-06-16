import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { createLocale, deleteLocale, fetchLocales, updateLocale } from "../src/api/locales";

describe("locales api", () => {
  const realFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("uses site-scoped locale endpoints", async () => {
    const calls: Array<{ url: string; method?: string; body?: string }> = [];
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method, body: init?.body as string | undefined });
      return init?.method === "DELETE" ? new Response(null, { status: 204 }) : new Response("[]", { status: 200 });
    }) as typeof fetch;

    await fetchLocales("demo");
    await createLocale("demo", { code: "de", label: "Deutsch" });
    await updateLocale("demo", "locale-1", { code: "fr", label: "Francais", isDefault: true });
    await deleteLocale("demo", "locale-1");

    assert.deepEqual(calls, [
      { url: "/api/sites/demo/locales", method: undefined, body: undefined },
      {
        url: "/api/sites/demo/locales",
        method: "POST",
        body: JSON.stringify({ code: "de", label: "Deutsch" }),
      },
      {
        url: "/api/sites/demo/locales/locale-1",
        method: "PATCH",
        body: JSON.stringify({ code: "fr", label: "Francais", isDefault: true }),
      },
      { url: "/api/sites/demo/locales/locale-1", method: "DELETE", body: undefined },
    ]);
  });
});
