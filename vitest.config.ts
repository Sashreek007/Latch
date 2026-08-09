import { existsSync } from "node:fs";
import { defineConfig } from "vitest/config";

// Local runs get DATABASE_URL from .env; CI and containers inject it directly,
// and have no such file.
if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.ts"],
  },
});
