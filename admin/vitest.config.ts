import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    setupFiles: ["tests/helpers/setup.ts"],
    fileParallelism: false,
  },
});
