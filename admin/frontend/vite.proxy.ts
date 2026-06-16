// Dev-server proxy rules, extracted so the path-matching can be unit-tested
// in isolation (vite.config.ts pulls in plugins/__dirname and can't be
// imported standalone).
//
// IMPORTANT: a key is treated by Vite as a RegExp when it starts with "^",
// otherwise as a plain URL prefix (url.startsWith(key)). The admin SPA has a
// client route "/assets" (AssetsPage); uploaded files are always served at
// "/assets/<filename>". The asset proxy must therefore match ONLY the
// sub-path form, never the bare "/assets" SPA route — otherwise a hard
// reload of the Assets page gets proxied to the admin API instead of being
// served the SPA shell by Vite's history fallback.

const ADMIN_API_URL = process.env.ADMIN_API_URL ?? "http://localhost:3001";

export const proxy: Record<string, { target: string; changeOrigin: boolean }> = {
  "/api": { target: ADMIN_API_URL, changeOrigin: true },
  // RegExp (leading "^"): matches uploaded files at /assets/<path> but NOT
  // the bare "/assets" SPA route, so reloading the Assets page falls through
  // to Vite's history fallback (index.html) instead of the admin API.
  "^/assets/.+": { target: ADMIN_API_URL, changeOrigin: true },
};
