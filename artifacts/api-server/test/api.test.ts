import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { auditLogsTable, candlesTable, db, engineStateTable, signalsTable, strategyConfigsTable, usersTable } from "@workspace/db";
import { DEFAULT_PARAMS, STRATEGY_ID, STRATEGY_VERSION } from "@workspace/strategy";
import { createApp } from "../src/app.js";
import { hashPassword } from "../src/lib/jwtAuth.js";
import { signFeederRequest } from "../src/middlewares/feederAuth.js";
import { checkBars } from "../src/routes/ingest.js";
import { hasDb, resetDb } from "./helpers.js";

const app = createApp();
const SECRET = process.env.FEEDER_HMAC_SECRET!;
const XRW = { "X-Requested-With": "fetch" };

async function createUser(username: string, role: "admin" | "viewer", password = "correct-horse-battery") {
  await db.insert(usersTable).values({ username, role, passwordHash: await hashPassword(password) });
}

async function login(username: string, password = "correct-horse-battery") {
  const agent = request.agent(app);
  const res = await agent.post("/api/auth/login").send({ username, password });
  expect(res.status).toBe(200);
  return agent;
}

function signed(path: string, body: unknown, opts: { ts?: number; secret?: string } = {}) {
  const raw = JSON.stringify(body);
  const ts = opts.ts ?? Math.floor(Date.now() / 1000);
  return request(app)
    .post(path)
    .set("Content-Type", "application/json")
    .set("X-Feeder-Id", "test-feeder")
    .set("X-Timestamp", String(ts))
    .set("X-Signature", signFeederRequest(opts.secret ?? SECRET, ts, raw))
    .send(raw);
}

describe("feeder signature", () => {
  it("matches the Python feeder's test vector", () => {
    // Same vector as feeder/tests/test_feeder.py::test_signature_matches_the_api_scheme
    expect(signFeederRequest("feeder-test-secret", 1_700_000_000, '{"symbol":"XAUUSD","bars":[]}')).toBe(
      "b1e516448aa5aa01cc145f928d99b71c127b3c024e5fb424a7126853d9d5a954",
    );
  });
});

describe("bar validation (pure)", () => {
  const now = 1_700_000_000 - (1_700_000_000 % 60);
  const bar = (t: number, c = 100) => ({ t, o: c, h: c + 1, l: c - 1, c, spread: 0.3 });
  it("accepts closed, aligned bars and rejects the rest", () => {
    const r = checkBars([bar(now - 120), bar(now - 60), bar(now), bar(now - 90), { ...bar(now - 180), l: 200 }, bar(now - 240, 150)], now, 100);
    expect(r.accepted.map((b) => b.t)).toEqual([now - 120, now - 60]);
    expect(r.rejected.map((x) => x.reason).sort()).toEqual(["bar_not_closed", "inconsistent_ohlc", "not_minute_aligned", "price_jump"]);
  });
});

describe.skipIf(!hasDb)("HTTP API", () => {
  beforeAll(async () => {
    await resetDb();
  });
  beforeEach(async () => {
    await resetDb();
    await createUser("admin", "admin");
    await createUser("viewer", "viewer");
  });

  describe("auth", () => {
    it("signs in with an httpOnly cookie and reports the user", async () => {
      const res = await request(app).post("/api/auth/login").send({ username: "admin", password: "correct-horse-battery" });
      expect(res.status).toBe(200);
      const cookie = String(res.headers["set-cookie"]);
      expect(cookie).toMatch(/amp_session=/);
      expect(cookie).toMatch(/HttpOnly/i);
      expect(cookie).toMatch(/SameSite=Strict/i);
      const agent = await login("admin");
      const me = await agent.get("/api/auth/me");
      expect(me.body.user).toMatchObject({ username: "admin", role: "admin" });
    });

    it("rejects wrong passwords and unknown users with the same message", async () => {
      const a = await request(app).post("/api/auth/login").send({ username: "admin", password: "wrong-password" });
      const b = await request(app).post("/api/auth/login").send({ username: "nobody", password: "wrong-password" });
      expect([a.status, b.status]).toEqual([401, 401]);
      expect(a.body.error).toBe(b.body.error);
    });

    it("locks the account after 10 failed attempts", async () => {
      for (let i = 0; i < 10; i++) await request(app).post("/api/auth/login").send({ username: "admin", password: "nope" });
      const res = await request(app).post("/api/auth/login").send({ username: "admin", password: "correct-horse-battery" });
      expect(res.status).toBe(429);
    });

    it("keeps registration closed by default", async () => {
      const res = await request(app).post("/api/auth/register").send({ username: "mallory", password: "long-enough-password" });
      expect(res.status).toBe(404);
    });

    it("has no default machine token", async () => {
      const res = await request(app).get("/api/engine/status").set("Authorization", "Bearer changeme");
      expect(res.status).toBe(401);
    });

    it("requires X-Requested-With on cookie-authenticated writes", async () => {
      const agent = await login("admin");
      expect((await agent.post("/api/engine/pause").send({})).status).toBe(403);
      expect((await agent.post("/api/engine/pause").set(XRW).send({})).status).toBe(200);
    });

    it("logout revokes the session everywhere", async () => {
      const a = await login("admin");
      const b = await login("admin");
      expect((await a.post("/api/auth/logout").set(XRW)).status).toBe(200);
      expect((await b.get("/api/auth/me")).status).toBe(401);
    });

    it("suspending a user ends their session immediately", async () => {
      const admin = await login("admin");
      const viewer = await login("viewer");
      const [v] = await db.select().from(usersTable).where(eq(usersTable.username, "viewer"));
      expect((await admin.patch(`/api/admin/users/${v!.id}`).set(XRW).send({ active: false })).status).toBe(200);
      expect((await viewer.get("/api/auth/me")).status).toBe(401);
    });
  });

  describe("roles", () => {
    it("viewers can read but not change anything", async () => {
      const viewer = await login("viewer");
      expect((await viewer.get("/api/engine/status")).status).toBe(200);
      expect((await viewer.post("/api/engine/pause").set(XRW).send({})).status).toBe(403);
      expect((await viewer.get("/api/admin/users")).status).toBe(403);
      expect((await viewer.post("/api/strategy-configs").set(XRW).send({ params: {}, note: "x" })).status).toBe(403);
    });

    it("admins pause and resume the engine, and it is audited", async () => {
      const admin = await login("admin");
      await admin.post("/api/engine/pause").set(XRW).send({ reason: "maintenance" });
      let [state] = await db.select().from(engineStateTable);
      expect(state).toMatchObject({ paused: true, pausedReason: "maintenance", pausedBy: "admin" });
      await admin.post("/api/engine/resume").set(XRW);
      [state] = await db.select().from(engineStateTable);
      expect(state!.paused).toBe(false);
      await new Promise((r) => setTimeout(r, 50)); // audit writes are fire-and-forget
      const actions = (await db.select().from(auditLogsTable)).map((a) => a.action);
      expect(actions).toEqual(expect.arrayContaining(["engine.pause", "engine.resume"]));
    });

    it("validates strategy parameters and activates a new version", async () => {
      const admin = await login("admin");
      const bad = await admin.post("/api/strategy-configs").set(XRW).send({ params: { emaFast: 80 }, note: "bad" });
      expect(bad.status).toBe(400);
      const ok = await admin.post("/api/strategy-configs").set(XRW).send({ params: { slAtrMult: 2 }, note: "wider stops" });
      expect(ok.status).toBe(201);
      const again = await admin.post("/api/strategy-configs").set(XRW).send({ params: { slAtrMult: 2.5 }, note: "wider still" });
      expect(again.status).toBe(201);
      const active = await db.select().from(strategyConfigsTable).where(eq(strategyConfigsTable.isActive, true));
      expect(active).toHaveLength(1);
      expect(active[0]!.params).toMatchObject({ slAtrMult: 2.5, emaFast: 20 });
    });
  });

  describe("ingest", () => {
    const t0 = Math.floor(Date.now() / 1000 / 60) * 60 - 600;
    const bars = [0, 1, 2].map((i) => ({ t: t0 + 60 * i, o: 2400, h: 2401, l: 2399, c: 2400.5, spread: 0.3 }));

    it("rejects unsigned, badly signed and stale requests", async () => {
      expect((await request(app).post("/api/ingest/bars").send({ symbol: "XAUUSD", bars })).status).toBe(401);
      expect((await signed("/api/ingest/bars", { symbol: "XAUUSD", bars }, { secret: "wrong" })).status).toBe(401);
      expect((await signed("/api/ingest/bars", { symbol: "XAUUSD", bars }, { ts: Math.floor(Date.now() / 1000) - 3600 })).status).toBe(401);
    });

    it("stores bars, counts revisions and records the feeder", async () => {
      const r1 = await signed("/api/ingest/bars", { symbol: "XAUUSD", bars, feeder: { serverUtcOffsetMin: 180, terminalConnected: true } });
      expect(r1.body).toMatchObject({ ok: true, inserted: 3, revised: 0 });
      const r2 = await signed("/api/ingest/bars", { symbol: "XAUUSD", bars: [{ ...bars[2], c: 2400.7 }] });
      expect(r2.body).toMatchObject({ inserted: 0, revised: 1 });
      const r3 = await signed("/api/ingest/bars", { symbol: "XAUUSD", bars });
      expect(r3.body.inserted + r3.body.revised).toBe(1); // only the revised bar changes back
      expect(await db.select().from(candlesTable)).toHaveLength(3);
      const hb = await signed("/api/ingest/heartbeat", { feeder: { terminalConnected: false } });
      expect(hb.status).toBe(200);
    });

    it("only accepts the service symbol", async () => {
      const res = await signed("/api/ingest/bars", { symbol: "BTCUSD", bars });
      expect(res.status).toBe(400);
    });
  });

  describe("public track record", () => {
    beforeEach(async () => {
      const [cfg] = await db
        .insert(strategyConfigsTable)
        .values({ symbol: "XAUUSD", strategyId: STRATEGY_ID, strategyVersion: STRATEGY_VERSION, params: { ...DEFAULT_PARAMS }, isActive: true })
        .returning();
      const base = { symbol: "XAUUSD", strategyId: STRATEGY_ID, strategyVersion: 1, configId: cfg!.id, entryRef: 2400, sl: 2397, tp1: 2403, tp2: 2406, risk: 3, atr: 2, spread: 0.3, slCurrent: 2397, validUntil: 0 };
      await db.insert(signalsTable).values([
        { ...base, publicNo: "XAU-000001", mode: "forward", published: true, direction: "long", t: 1_700_000_000, state: "closed", outcome: "tp2", rNet: 1.45 },
        { ...base, publicNo: "XAU-000002", mode: "forward", published: true, direction: "short", t: 1_700_100_000, state: "closed", outcome: "sl", rNet: -1.05 },
        { ...base, publicNo: "XAU-000003", mode: "forward", published: false, direction: "long", t: 1_700_200_000, state: "closed", outcome: "sl", rNet: -1.05 },
        { ...base, publicNo: "XAU-000004", mode: "shadow", published: false, direction: "long", t: 1_700_300_000, state: "closed", outcome: "tp2", rNet: 1.5 },
      ]);
    });

    it("counts only published signals of the public modes", async () => {
      const res = await request(app).get("/api/public/summary");
      expect(res.status).toBe(200);
      expect(res.body.stats.all).toMatchObject({ trades: 2, wins: 1, losses: 1 });
      expect(res.body.stats.all.totalR).toBeCloseTo(0.4);
      expect(res.body.equity).toHaveLength(2);
      const list = await request(app).get("/api/public/signals");
      expect(list.body.signals.map((s: { publicNo: string }) => s.publicNo)).toEqual(["XAU-000002", "XAU-000001"]);
      expect((await request(app).get("/api/public/signals/XAU-000003")).status).toBe(404);
      expect((await request(app).get("/api/public/signals/XAU-000001")).body.signal.outcome).toBe("tp2");
    });

    it("keeps open forward-test signals off the public page (they belong to the private channel)", async () => {
      const [cfg] = await db.select().from(strategyConfigsTable);
      await db.insert(signalsTable).values({
        symbol: "XAUUSD", strategyId: STRATEGY_ID, strategyVersion: 1, configId: cfg!.id, entryRef: 2400, sl: 2397, tp1: 2403, tp2: 2406,
        risk: 3, atr: 2, spread: 0.3, slCurrent: 2397, validUntil: 0, publicNo: "XAU-000009", mode: "forward", published: true,
        direction: "long", t: Math.floor(Date.now() / 1000) - 7200, state: "active",
      });
      const list = await request(app).get("/api/public/signals");
      expect(list.body.signals.map((s: { publicNo: string }) => s.publicNo)).not.toContain("XAU-000009");
      expect((await request(app).get("/api/public/signals/XAU-000009")).status).toBe(404);
    });

    it("shows unpublished and shadow signals to signed-in operators only", async () => {
      expect((await request(app).get("/api/signals")).status).toBe(401);
      const viewer = await login("viewer");
      const res = await viewer.get("/api/signals");
      expect(res.body.signals.length).toBeGreaterThanOrEqual(4);
    });
  });

  it("returns JSON 404s and 400s for malformed input", async () => {
    expect((await request(app).get("/api/nope")).status).toBe(404);
    const res = await request(app).post("/api/auth/login").set("Content-Type", "application/json").send("{bad json");
    expect(res.status).toBe(400);
  });

  it("hides metrics unless a token is configured", async () => {
    expect((await request(app).get("/api/metrics")).status).toBe(404);
  });
});
