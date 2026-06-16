import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { fetchPages } from "../src/api/pages";
import { fetchSites } from "../src/api/sites";
import { legacySitePath, replaceSiteKeyInPath, siteSectionPath } from "../src/site-routing";

describe("site routing helpers", () => {
  it("maps legacy pages to the default site pages route", () => {
    assert.equal(legacySitePath("pages"), "/sites/demo/pages");
  });

  it("builds site route paths and falls back from entity details when switching sites", () => {
    assert.equal(siteSectionPath("demo", "assets"), "/sites/demo/assets");
    assert.equal(
      replaceSiteKeyInPath("/sites/demo/pages/page-1", "demo", "demo"),
      "/sites/demo/pages",
    );
    assert.equal(replaceSiteKeyInPath("/submissions", "demo", "demo"), "/sites/demo/pages");
  });
});

describe("site-aware API clients", () => {
  const realFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("fetches sites from the collection endpoint", async () => {
    const paths: string[] = [];
    globalThis.fetch = (async (url: string) => {
      paths.push(url);
      return new Response("[]", { status: 200 });
    }) as typeof fetch;

    await fetchSites();

    assert.deepEqual(paths, ["/api/sites"]);
  });

  it("scopes page requests by site key", async () => {
    const paths: string[] = [];
    globalThis.fetch = (async (url: string) => {
      paths.push(url);
      return new Response("[]", { status: 200 });
    }) as typeof fetch;

    await fetchPages("demo");

    assert.deepEqual(paths, ["/api/sites/demo/pages"]);
  });
});
