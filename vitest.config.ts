import { defineConfig } from "vitest/config";

process.loadEnvFile?.(".env");

export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.ts"],
  },
});
