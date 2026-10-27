import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { candlesTable, db, signalsTable, strategyConfigsTable, tradeTicketsTable, usersTable } from "@workspace/db";
import { DEFAULT_ACCOUNT, DEFAULT_PARAMS, STRATEGY_ID, STRATEGY_VERSION } from "@workspace/strategy";
import { createApp } from "../src/app.js";
import { hashPassword } from "../src/lib/jwtAuth.js";
import { signalOdds } from "../src/services/tradeTools.js";
import { hasDb, resetDb } from "./helpers.js";

const app = createApp();
const XRW = { "X-Requested-With": "fetch" };
const now = () => Math.floor(Date.now() / 1000);

async function login(username: string) {
  const agent = request.agent(app);
  await agent.post("/api/auth/login").send({ username, password: "correct-horse-battery" }).expect(200);
  return agent;
}

async function seedSignal(overrides: Partial<typeof signalsTable.$inferInsert> = {}) {
  const [cfg] = await db.select().from(strategyConfigsTable);
  const t = now() - 60;
  const [s] = await db
    .insert(signalsTable)
    .values({
      publicNo: "XAU-000001", symbol: "XAUUSD", strategyId: STRATEGY_ID, strategyVersion: 1, configId: cfg!.id, mode: "forward", published: true,
      direction: "long", t, entryRef: 4000, sl: 3995.5, tp1: 4004.5, tp2: 4009, risk: 4.5, atr: 3, spread: 0.3, validUntil: t + 1800,
      state: "pending", slCurrent: 3995.5, ...overrides,
    })
    .returning();
  return s!;
}

describe.skipIf(!hasDb)("trade tools", () => {
  beforeEach(async () => {
    await resetDb();
    await db.insert(usersTable).values([
      { username: "admin", role: "admin", passwordHash: await hashPassword("correct-horse-battery") },
      { username: "viewer", role: "viewer", passwordHash: await hashPassword("correct-horse-battery") },
    ]);
    await db.insert(strategyConfigsTable).values({ symbol: "XAUUSD", strategyId: STRATEGY_ID, strategyVersion: STRATEGY_VERSION, params: { ...DEFAULT_PARAMS }, isActive: true });
  });

  it("validates and saves account settings (admin only)", async () => {
    const admin = await login("admin");
    expect((await admin.get("/api/account")).body.account).toEqual(DEFAULT_ACCOUNT);
    expect((await admin.put("/api/account").set(XRW).send({ ...DEFAULT_ACCOUNT, riskPerTradePct: 50 })).status).toBe(400);
    expect((await admin.put("/api/account").set(XRW).send({ ...DEFAULT_ACCOUNT, balance: 5000 })).status).toBe(200);
    expect((await admin.get("/api/account")).body.account.balance).toBe(5000);
    const viewer = await login("viewer");
    expect((await viewer.put("/api/account").set(XRW).send(DEFAULT_ACCOUNT)).status).toBe(403);
  });

  it("builds a sized ticket with a PASS/BLOCK risk check", async () => {
    await seedSignal();
    const res = await (await login("viewer")).get("/api/signals/by-no/XAU-000001/ticket");
    expect(res.status).toBe(200);
    // $1,000 at 1% = $10; $4.50 stop × 100 oz = $450 per lot → 0.02 lots
    expect(res.body.ticket.sizing.lots).toBe(0.02);
    expect(res.body.ticket.pass).toBe(true);
    expect(res.body.ticket.order).toContain("BUY 0.02 lots XAUUSD");
  });

  it("approves only with YES, only for admins, and only once", async () => {
    await seedSignal();
    const admin = await login("admin");
    const viewer = await login("viewer");
    expect((await viewer.post("/api/signals/by-no/XAU-000001/approve").set(XRW).send({ confirm: "YES" })).status).toBe(403);
    expect((await admin.post("/api/signals/by-no/XAU-000001/approve").set(XRW).send({ confirm: "yes please" })).status).toBe(400);
    const ok = await admin.post("/api/signals/by-no/XAU-000001/approve").set(XRW).send({ confirm: "YES" });
    expect(ok.status).toBe(201);
    expect(ok.body.ticket).toMatchObject({ lots: 0.02, approvedBy: "admin", via: "dashboard", sentToBroker: false });
    expect((await admin.post("/api/signals/by-no/XAU-000001/approve").set(XRW).send({ confirm: "YES" })).status).toBe(409);
    expect(await db.select().from(tradeTicketsTable)).toHaveLength(1);
  });

  it("refuses a blocked trade and says why", async () => {
    await seedSignal({ validUntil: now() - 10 }); // entry window closed
    const res = await (await login("admin")).post("/api/signals/by-no/XAU-000001/approve").set(XRW).send({ confirm: "YES" });
    expect(res.status).toBe(409);
    expect(res.body.error).toContain("Entry window");
  });

  it("computes odds only from history before the signal", async () => {
    const s = await seedSignal();
    // 20 past weekdays of flat-ish M1 bars, plus a huge spike after the signal that must be ignored.
    const rows = [];
    for (let d = 20; d >= 1; d--) {
      const day = s.t - d * 86_400;
      for (let m = 0; m < 300; m++) {
        const t = day - (day % 60) + m * 60;
        const p = 4000 + Math.sin(m / 7) * 2;
        rows.push({ symbol: "XAUUSD", t, o: p, h: p + 0.6, l: p - 0.6, c: p + 0.1, spread: 0.3, source: "test" });
      }
    }
    rows.push({ symbol: "XAUUSD", t: s.t + 120, o: 4000, h: 9000, l: 4000, c: 9000, spread: 0.3, source: "test" });
    await db.insert(candlesTable).values(rows).onConflictDoNothing();
    const odds = await signalOdds(s);
    expect(odds).not.toBeNull();
    expect(odds!.paths).toBe(10_000);
    const total = Object.values(odds!.simulated).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1);
    expect(odds!.sessions).toBeGreaterThanOrEqual(10);
    const pub = await request(app).get("/api/public/signals/XAU-000001/odds");
    expect(pub.status).toBe(404); // open forward-test signals stay private
  });
});
