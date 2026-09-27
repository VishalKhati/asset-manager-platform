import { defineConfig } from "drizzle-kit";
import path from "path";

// `generate` does not need a live database; `check`/`studio` read DATABASE_URL when set.
export default defineConfig({
  schema: path.join(__dirname, "./src/schema/index.ts"),
  out: "./migrations", // relative to lib/db (drizzle-kit mangles absolute paths)
  dialect: "postgresql",
  strict: true,
  dbCredentials: { url: process.env.DATABASE_URL ?? "postgres://localhost/unused" },
});
