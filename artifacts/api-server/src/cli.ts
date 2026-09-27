/**
 * Operator command line (bundled as dist/cli.mjs):
 *
 *   node dist/cli.mjs migrate
 *   node dist/cli.mjs create-admin <username>        (password read from stdin or ADMIN_PASSWORD)
 *   node dist/cli.mjs upload-report <walkforward.json> [--public]
 */

import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { eq } from "drizzle-orm";
import { backtestRunsTable, db, usersTable } from "@workspace/db";
import { closePool, runMigrations } from "@workspace/db/migrate";
import { hashPassword } from "./lib/jwtAuth.js";

async function readPassword(): Promise<string> {
  if (process.env["ADMIN_PASSWORD"]) return process.env["ADMIN_PASSWORD"];
  const rl = createInterface({ input: process.stdin });
  for await (const line of rl) {
    rl.close();
    return line.trim();
  }
  return "";
}

async function main(): Promise<void> {
  const [cmd, arg, flag] = process.argv.slice(2);
  if (cmd === "migrate") {
    await runMigrations();
    console.log("migrations applied");
  } else if (cmd === "create-admin") {
    if (!arg || !/^[a-zA-Z0-9_.-]{3,32}$/.test(arg)) throw new Error("usage: create-admin <username>");
    const password = await readPassword();
    if (password.length < 12) throw new Error("password must be at least 12 characters");
    const passwordHash = await hashPassword(password);
    const [existing] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.username, arg));
    if (existing) {
      await db.update(usersTable).set({ passwordHash, role: "admin", active: true, failedLogins: 0, lockedUntil: null }).where(eq(usersTable.id, existing.id));
      console.log(`updated ${arg}: admin, password reset`);
    } else {
      await db.insert(usersTable).values({ username: arg, passwordHash, role: "admin" });
      console.log(`created admin ${arg}`);
    }
  } else if (cmd === "upload-report") {
    if (!arg) throw new Error("usage: upload-report <walkforward.json> [--public]");
    const report = JSON.parse(readFileSync(arg, "utf8")) as { strategy: { id: string; version: number }; gate: { pass: boolean }; oos: unknown; holdout?: unknown; data?: unknown; generatedAt?: string };
    const [row] = await db
      .insert(backtestRunsTable)
      .values({
        kind: "walk_forward",
        strategyId: report.strategy.id,
        strategyVersion: report.strategy.version,
        summary: { gatePass: report.gate.pass, oos: report.oos, holdout: report.holdout ?? null, data: report.data ?? null, generatedAt: report.generatedAt ?? null },
        report: report as unknown as Record<string, unknown>,
        isPublic: flag === "--public",
        createdBy: "cli",
      })
      .returning({ id: backtestRunsTable.id });
    console.log(`uploaded report ${row!.id}${flag === "--public" ? " (public)" : ""}`);
  } else {
    console.log("commands: migrate | create-admin <username> | upload-report <file> [--public]");
    process.exitCode = 2;
  }
  await closePool();
}

main().catch(async (err) => {
  console.error(err instanceof Error ? err.message : err);
  await closePool().catch(() => {});
  process.exit(1);
});
