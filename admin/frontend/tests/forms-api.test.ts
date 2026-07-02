import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { addForm, fetchForms, removeForm } from "../src/api/forms";

describe("forms api", () => {
  const realFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("uses site-scoped forms endpoints", async () => {
    const calls: Array<{ url: string; method?: string; body?: string }> = [];
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method, body: init?.body as string | undefined });
      return new Response(JSON.stringify({ forms: ["contact"] }), { status: 200 });
    }) as typeof fetch;

    await fetchForms("demo");
    await addForm("demo", "contact");
    await removeForm("demo", "contact");

    assert.deepEqual(calls, [
      { url: "/api/sites/demo/forms", method: undefined, body: undefined },
      { url: "/api/sites/demo/forms", method: "POST", body: JSON.stringify({ form: "contact" }) },
      { url: "/api/sites/demo/forms/contact", method: "DELETE", body: undefined },
    ]);
  });

  it("addForm returns the updated forms array", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ forms: ["contact", "quiz"] }), { status: 200 })) as typeof fetch;

    const result = await addForm("demo", "quiz");

    assert.deepEqual(result, { forms: ["contact", "quiz"] });
  });
});
