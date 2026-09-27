import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set.");
}

// bigint columns hold epoch seconds, which fit safely in a JS number.
pg.types.setTypeParser(20, (v) => Number(v));

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.DB_POOL_MAX ?? 10),
});
export const db = drizzle(pool, { schema });
export type Db = typeof db;

export * from "./schema";
