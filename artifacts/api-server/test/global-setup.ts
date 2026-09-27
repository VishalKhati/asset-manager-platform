import pg from "pg";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { drizzle } from "drizzle-orm/node-postgres";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Resets the test database schema and applies every migration once per run. */
export default async function setup(): Promise<void> {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) return;
  const pool = new pg.Pool({ connectionString: url });
  await pool.query("drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;");
  const here = path.dirname(fileURLToPath(import.meta.url));
  await migrate(drizzle(pool), { migrationsFolder: path.resolve(here, "../../../lib/db/migrations") });
  await pool.end();
}
