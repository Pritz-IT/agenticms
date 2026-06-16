import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { proxy } from "./vite.proxy";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@agenticms/components": path.resolve(
        __dirname,
        "src/components/visual-editor/agenticms-shims.tsx"
      ),
    },
  },
  server: {
    port: 5173,
    proxy,
  },
  build: {
    outDir: "../dist/public",
    emptyOutDir: true,
  },
});
