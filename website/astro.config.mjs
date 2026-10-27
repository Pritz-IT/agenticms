import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  // React 18's streaming SSR writer flushes its full 2048-byte buffer when a multi-byte character does not
  // fit the last free byte, which leaves a NUL byte in the page (seen as "Qualit\0ät" on pritz-it.com).
  // The site is static, so streaming buys nothing: render with renderToString, which encodes no bytes.
  integrations: [react({ experimentalDisableStreaming: true })],
  output: "static",
  build: {
    format: "directory",
  },
  vite: {
    resolve: {
      alias: {
        "@agenticms/components": fileURLToPath(new URL("./src/components/index.ts", import.meta.url)),
      },
    },
  },
});
