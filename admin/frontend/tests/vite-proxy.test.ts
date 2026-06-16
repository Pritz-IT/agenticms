import assert from "node:assert/strict";
import { test } from "vitest";
import { proxy } from "../vite.proxy";

// Mirrors Vite's server/middlewares/proxy.ts `doesProxyContextMatchUrl`:
// a key starting with "^" is a RegExp, otherwise a plain prefix.
function isProxied(url: string): boolean {
  return Object.keys(proxy).some(
    (context) =>
      (context.startsWith("^") && new RegExp(context).test(url)) ||
      url.startsWith(context)
  );
}

test("proxy keeps SPA routes local while forwarding API and uploaded assets", () => {
  // The SPA owns the "/assets" client route (AssetsPage). A hard reload of it
  // must reach Vite's history fallback, NOT be proxied to the admin API.
  assert.equal(isProxied("/assets"), false, "/assets SPA route must not be proxied");
  assert.equal(isProxied("/assets?x=1"), false, "/assets with query must not be proxied");

  // Uploaded files live at /assets/<filename> and MUST still be proxied.
  assert.equal(isProxied("/assets/clh123.png"), true, "uploaded asset file must be proxied");
  assert.equal(isProxied("/assets/nested/dir/pic.webp"), true, "nested uploaded asset must be proxied");

  // API proxy unchanged; other SPA routes were never proxied.
  assert.equal(isProxied("/api/auth/refresh"), true, "/api must still be proxied");
  assert.equal(isProxied("/pages"), false, "/pages SPA route must not be proxied");
  assert.equal(isProxied("/navigation"), false, "/navigation SPA route must not be proxied");
});
