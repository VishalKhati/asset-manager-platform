import { defineConfig } from "vitest/config";

// Integration tests need a real PostgreSQL: set TEST_DATABASE_URL (the schema is reset).
export default defineConfig({
  test: {
    setupFiles: ["./test/setup-env.ts"],
    globalSetup: ["./test/global-setup.ts"],
    fileParallelism: false,
    testTimeout: 240_000, // engine replays ~20k bars through Postgres; slow machines need headroom
    hookTimeout: 120_000,
  },
});
