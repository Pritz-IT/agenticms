import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  integrations: [react()],
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
