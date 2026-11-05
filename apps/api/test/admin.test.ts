import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { openDb, type Db } from "../src/db.js";
import { seedAll } from "../src/seed.js";

process.env.SEED_ALLOW_UNVERIFIED = "1";
let db: Db;
let app: FastifyInstance;

async function call(method: string, url: string, cookie: string, body?: unknown) {
  const r = await app.inject({ method: method as any, url, headers: cookie ? { cookie } : {}, payload: body as any });
  const set = r.headers["set-cookie"];
  const c = Array.isArray(set) ? set[0] : set;
  return { status: r.statusCode, json: r.headers["content-type"]?.includes("json") ? r.json() : null, cookie: c ? c.split(";")[0] : cookie, body: r.body };
}
async function signIn(email: string) {
  await call("POST", "/api/auth/otp/request", "", { email });
  return (await call("POST", "/api/auth/otp/verify", "", { email, code: "123456" })).cookie;
}
async function registerAndPlayTrial(email: string) {
  const c = await signIn(email);
  const offices = await call("GET", "/api/offices?q=delhi", c);
  const r = await call("POST", "/api/players/register", c, { name: "सीमा शर्मा", mobile: "9876543211", officeId: offices.json[0].id, officeAddress: "नई दिल्ली – 110002" });
  expect(r.status).toBe(200);
  const s = await call("POST", "/api/rounds/trial/attempts", r.cookie, { clientId: "client-admin-test" });
  const parts = await db.query<{ fields: any[] }>("SELECT fields FROM page_parts WHERE page_id=(SELECT page_id FROM attempts WHERE id=$1)", [s.json.id]);
  await call("PUT", `/api/attempts/${s.json.id}/autosave`, r.cookie, { version: 1, clientId: "client-admin-test", answers: { passage: { fields: { t: parts[0].fields[0].hiReference }, done: false } } });
  await call("POST", `/api/attempts/${s.json.id}/events`, r.cookie, { type: "left_tab" });
  expect((await call("POST", `/api/attempts/${s.json.id}/submit`, r.cookie, {})).status).toBe(200);
  const me = await call("GET", "/api/me/progress", r.cookie);
  return { cookie: r.cookie, attemptId: s.json.id as string, playerId: (await db.one<{ id: string }>("SELECT id FROM players WHERE email=$1", [email]))!.id, me };
}

let mgr = "";
let viewer = "";
beforeAll(async () => {
  const { env } = await import("../src/env.js");
  (env as any).SEED_ALLOW_UNVERIFIED = true;
  db = await openDb("pglite:memory");
  await seedAll(db, () => {});
  await db.query("INSERT INTO admin_users (email, role) VALUES ('boss@cag.gov.in','manager'), ('look@cag.gov.in','viewer') ON CONFLICT DO NOTHING");
  app = await buildApp(db, { jobs: false });
  mgr = await signIn("boss@cag.gov.in");
  viewer = await signIn("look@cag.gov.in");
});
afterAll(async () => { await app.close(); await db.close(); });

describe("console analytics", () => {
  it("is closed to players and anonymous users", async () => {
    expect((await call("GET", "/api/admin/analytics/overview", "")).status).toBe(403);
    expect((await call("GET", "/api/admin/players", "")).status).toBe(403);
  });
  it("reports KPIs, funnel, levels, glossary and fair-play signals from real attempts", async () => {
    const empty = await call("GET", "/api/admin/analytics/overview?range=all", viewer);
    expect(empty.status).toBe(200);
    expect(empty.json.kpis.playersRegistered).toBe(0);
    await registerAndPlayTrial("seema.s@cag.gov.in");
    const o = await call("GET", "/api/admin/analytics/overview?range=7d", viewer);
    const k = o.json.kpis;
    expect(k.playersRegistered).toBe(1);
    expect(k.activeToday).toBe(1);
    expect(k.attemptsStarted).toBe(1);
    expect(k.attemptsSubmitted).toBe(1);
    expect(k.completionRate).toBe(100);
    expect(k.trialPassRate).toBe(100);
    expect(k.creditsAwarded).toBeGreaterThan(2);
    expect(o.json.funnel.map((f: any) => f.n).slice(0, 3)).toEqual([1, 1, 1]);
    const trial = o.json.levels.find((l: any) => l.key === "trial");
    expect(trial.submitted).toBe(1);
    expect(trial.avgBest).toBeGreaterThan(33);
    expect(trial.histogram.reduce((n: number, b: any) => n + b.n, 0)).toBe(1);
    expect(trial.measures.quality).toBeGreaterThan(90);
    expect(o.json.fairPlay.leaveEvents).toBe(1);
    expect(o.json.glossary.termsChecked).toBeGreaterThan(0);
    expect(o.json.trend.at(-1).registrations).toBe(1);
    expect(o.json.states[0].players).toBe(1);
    expect(o.json.content.find((c: any) => c.timesUsed === 1)).toBeTruthy();
    expect(JSON.stringify(o.json)).not.toMatch(/hiReference|fixHint|DHRUVA|Authorization/);
    const feed = await call("GET", "/api/admin/activity?limit=10", viewer);
    expect(feed.json.map((x: any) => x.kind)).toEqual(expect.arrayContaining(["registration", "submit", "start"]));
  });
  it("rejects an unknown range", async () => {
    expect((await call("GET", "/api/admin/analytics/overview?range=1y", viewer)).status).toBe(400);
  });
});

describe("player management", () => {
  it("lists players with computed progress and shows a detail view", async () => {
    const l = await call("GET", "/api/admin/players", viewer);
    const p = l.json.find((x: any) => x.email === "seema.s@cag.gov.in");
    expect(p.trialPassed).toBe(true);
    expect(p.attempts).toBe(1);
    const d = await call("GET", `/api/admin/players/${p.id}`, viewer);
    expect(d.json.history).toHaveLength(1);
    expect(d.json.history[0].leaves).toBe(1);
  });
  it("only managers can reset, and the email must be repeated", async () => {
    const pid = (await db.one<{ id: string }>("SELECT id FROM players WHERE email='seema.s@cag.gov.in'"))!.id;
    expect((await call("POST", `/api/admin/players/${pid}/reset`, viewer, { confirmEmail: "seema.s@cag.gov.in" })).status).toBe(403);
    expect((await call("POST", `/api/admin/players/${pid}/reset`, mgr, { confirmEmail: "other@cag.gov.in" })).json.error).toBe("confirm_mismatch");
    const r = await call("POST", `/api/admin/players/${pid}/reset`, mgr, { confirmEmail: "Seema.S@cag.gov.in", reason: "test run" });
    expect(r.status).toBe(200);
    expect(r.json.attempts).toBe(1);
    expect((await db.one<{ n: number }>("SELECT count(*)::int n FROM attempts WHERE player_id=$1", [pid]))!.n).toBe(0);
    expect(await db.one("SELECT 1 FROM players WHERE id=$1", [pid])).toBeTruthy(); // player kept, registration credits intact
    const audit = await call("GET", "/api/admin/audit?action=player.", viewer);
    expect(audit.json[0].action).toBe("player.reset");
  });
  it("the player can start the Trial again from chance 1 after a reset", async () => {
    const c = await signIn("seema.s@cag.gov.in");
    const s = await call("POST", "/api/rounds/trial/attempts", c, { clientId: "client-admin-test" });
    expect(s.json.chanceNo).toBe(1);
  });
  it("deletes a player entirely", async () => {
    const pid = (await db.one<{ id: string }>("SELECT id FROM players WHERE email='seema.s@cag.gov.in'"))!.id;
    const r = await call("POST", `/api/admin/players/${pid}/reset`, mgr, { confirmEmail: "seema.s@cag.gov.in", deletePlayer: true });
    expect(r.json.playerDeleted).toBe(true);
    expect(await db.one("SELECT 1 FROM players WHERE id=$1", [pid])).toBeNull();
    expect((await call("GET", `/api/admin/players/${pid}`, viewer)).status).toBe(404);
  });
  it("reset-all needs the typed phrase and keeps content", async () => {
    await registerAndPlayTrial("anil.k@cag.gov.in");
    expect((await call("POST", "/api/admin/danger/reset-play-data", mgr, { confirm: "yes" })).status).toBe(400);
    expect((await call("POST", "/api/admin/danger/reset-play-data", viewer, { confirm: "RESET ALL TEST DATA" })).status).toBe(403);
    const r = await call("POST", "/api/admin/danger/reset-play-data", mgr, { confirm: "RESET ALL TEST DATA" });
    expect(r.json.deleted.players).toBe(1);
    expect((await db.one<{ n: number }>("SELECT count(*)::int n FROM players"))!.n).toBe(0);
    expect((await db.one<{ n: number }>("SELECT count(*)::int n FROM pages"))!.n).toBeGreaterThan(0);
    expect((await db.one<{ n: number }>("SELECT count(*)::int n FROM glossary_terms"))!.n).toBeGreaterThan(11000);
  });
});

describe("content library and settings", () => {
  it("groups bundles by report and maps a report's scope", async () => {
    const lib = await call("GET", "/api/admin/library", viewer);
    const r38 = lib.json.find((r: any) => /Report No\. 38/.test(r.report));
    expect(r38.bundles.length).toBeGreaterThanOrEqual(4);
    expect(r38.bundles[0].round_key).toBe("trial");
    const s = await call("PUT", "/api/admin/reports/scope", mgr, { report: r38.report, scope: "Bihar" });
    expect(s.json.pages).toBe(r38.bundles.length);
    await call("PUT", "/api/admin/reports/scope", mgr, { report: r38.report, scope: "union" });
    const m = await call("PUT", `/api/admin/pages/${r38.bundles[0].id}/meta`, mgr, { label: "Trial · Summing up" });
    expect(m.status).toBe(200);
  });
  it("validates and stores evaluation settings, including the unlock rule and chrF band", async () => {
    const base = (await call("GET", "/api/admin/config", viewer)).json.effective;
    expect((await call("PUT", "/api/admin/config/settings", mgr, { scoring: { chrfFloor: 0.9, chrfCeil: 0.5 } })).status).toBe(400);
    expect((await call("PUT", "/api/admin/config/settings", mgr, { scoringWeights: { translationQuality: 60, glossary: 25, timelinessCompletion: 20 } })).status).toBe(400);
    const ok = await call("PUT", "/api/admin/config/settings", mgr, { unlockRule: "trial-pass-unlocks-all", scoring: { chrfFloor: 0.25, chrfCeil: 0.8, minWordsPerSentence: 3 }, avoidThreshold: 0.65 });
    expect(ok.status).toBe(200);
    expect(ok.json.effective.levels.unlockRule).toBe("trial-pass-unlocks-all");
    expect(ok.json.effective.scoring.chrfFloor).toBe(0.25);
    expect(ok.json.effective.glossary.transliterationAvoidThreshold).toBe(0.65);
    const h = await call("GET", "/api/admin/config/history", viewer);
    expect(h.json[0].action).toBe("config.settings");
    await call("PUT", "/api/admin/config/settings", mgr, { unlockRule: base.levels.unlockRule });
  });
});

describe("Sahayak script edits reach the player side", () => {
  it("a console edit is served to players straight away, and a stale voice file is removed", async () => {
    const id = "landing.screen.welcome"; // shown on the landing page to visitors
    const before = await call("GET", "/api/sahayika/lines?section=landing", "");
    expect(before.json.some((l: any) => l.id === id)).toBe(true);
    // a pre-generated voice file for this line (as "Regenerate audio" would leave)
    const { mkdirSync, writeFileSync, existsSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const { ROOT } = await import("../src/env.js");
    mkdirSync(resolve(ROOT, ".data/audio"), { recursive: true });
    const wav = resolve(ROOT, ".data/audio", `${id}.wav`);
    writeFileSync(wav, Buffer.from("RIFF"));
    expect((await call("GET", `/api/sahayika/audio/${id}`, "")).status).toBe(200);

    const edit = await call("PUT", `/api/admin/sahayika/lines/${id}`, mgr, { en: "Edited by the manager.", hi: "प्रबंधक द्वारा संपादित।" });
    expect(edit.status).toBe(200);
    const after = await call("GET", "/api/sahayika/lines?section=landing", "");
    expect(after.json.find((l: any) => l.id === id).en).toBe("Edited by the manager.");
    expect(existsSync(wav)).toBe(false);
    expect((await call("GET", `/api/sahayika/audio/${id}`, "")).status).toBe(404); // client falls back to live TTS for the new text
    // a viewer cannot edit
    expect((await call("PUT", `/api/admin/sahayika/lines/${id}`, viewer, { en: "x", hi: "y" })).status).toBe(403);
  });
});
