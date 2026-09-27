import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "./index";

/**
 * Applies pending SQL migrations. Looks in MIGRATIONS_DIR, then next to the running
 * bundle (dist/migrations), then in lib/db/migrations when run from source.
 */
export function migrationsFolder(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [process.env.MIGRATIONS_DIR, path.resolve(here, "migrations"), path.resolve(here, "../migrations")].filter(
    (c): c is string => Boolean(c),
  );
  const found = candidates.find((c) => existsSync(path.join(c, "meta", "_journal.json")));
  if (!found) throw new Error(`no migrations folder found (tried ${candidates.join(", ")})`);
  return found;
}

export async function runMigrations(dir?: string): Promise<void> {
  await migrate(db, { migrationsFolder: dir ?? migrationsFolder() });
}

export async function closePool(): Promise<void> {
  await pool.end();
}
