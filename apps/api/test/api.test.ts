import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { openDb, type Db } from "../src/db.js";
import { seedAll } from "../src/seed.js";
import { findForbidden } from "@hc/shared";
import { sanitiseHtml } from "../src/game.js";

process.env.SEED_ALLOW_UNVERIFIED = "1";
let db: Db;
let app: FastifyInstance;
const captured: string[] = []; // every client response body, for the contract + forbidden-word scans

async function call(method: string, url: string, cookie: string, body?: unknown) {
  const r = await app.inject({ method: method as any, url, headers: cookie ? { cookie } : {}, payload: body as any });
  captured.push(r.body);
  const set = r.headers["set-cookie"];
  const c = Array.isArray(set) ? set[0] : set;
  return { status: r.statusCode, json: r.headers["content-type"]?.includes("json") ? r.json() : null, cookie: c ? c.split(";")[0] : cookie, raw: r };
}

async function register(email: string) {
  await call("POST", "/api/auth/otp/request", "", { email });
  const v = await call("POST", "/api/auth/otp/verify", "", { email, code: "123456" });
  expect(v.json.status).toBe("new");
  const offices = await call("GET", "/api/offices?q=delhi", v.cookie);
  const r = await call("POST", "/api/players/register", v.cookie, { name: "रमेश कुमार", mobile: "9876543210", officeId: offices.json[0].id, officeAddress: "नई दिल्ली – 110002" });
  expect(r.status).toBe(200);
  return r.cookie;
}

beforeAll(async () => {
  const { env } = await import("../src/env.js");
  (env as any).SEED_ALLOW_UNVERIFIED = true;
  db = await openDb("pglite:memory");
  await seedAll(db, () => {});
  // the journey below exercises the Trial-first rule; the review build ships "all-open" (tested in @hc/shared)
  await db.query("INSERT INTO config_overrides (key, value, by, at) VALUES ('settings', $1, 'test', now())", [JSON.stringify({ unlockRule: "trial-pass-unlocks-all" })]);
  app = await buildApp(db, { jobs: false });
});
afterAll(async () => { await app.close(); await db.close(); });

describe("player journey", () => {
  let cookie = "";
  let attemptId = "";
  it("seed loaded the full glossary", async () => {
    const n = await db.one<{ n: number }>("SELECT count(*)::int n FROM glossary_terms");
    expect(n!.n).toBeGreaterThan(11000);
  });
  it("rejects a bad OTP and registers a new player with 2 credits", async () => {
    await call("POST", "/api/auth/otp/request", "", { email: "x@cag.gov.in" });
    expect((await call("POST", "/api/auth/otp/verify", "", { email: "x@cag.gov.in", code: "000000" })).status).toBe(400);
    cookie = await register("ramesh.k@cag.gov.in");
    const p = await call("GET", "/api/me/progress", cookie);
    expect(p.json.summary.totalCredits).toBe(2);
    expect(p.json.next).toEqual({ action: "preround", roundKey: "trial" });
  });
  it("locks primary until the trial is played", async () => {
    expect((await call("POST", "/api/rounds/primary/attempts", cookie, { clientId: "client-aaaa" })).status).toBe(403);
  });
  it("starts the trial; the page carries no reference, sector or slip fixes", async () => {
    const intro = await call("GET", "/api/rounds/trial/intro", cookie);
    expect(intro.json.lines[0].id).toBe("trial.pre_round.first_chance");
    const s = await call("POST", "/api/rounds/trial/attempts", cookie, { clientId: "client-aaaa" });
    expect(s.status).toBe(200);
    attemptId = s.json.id;
    expect(JSON.stringify(s.json)).not.toMatch(/hiReference|fixHint|sector|commercial/);
    expect(s.json.page.sample).toBe(true);
  });
  it("autosaves; refuses stale versions and a second window", async () => {
    const ans = { passage: { fields: { t: "सेल भारत की अग्रणी इस्पात उत्पादक कंपनियों में से एक है।" }, done: false } };
    expect((await call("PUT", `/api/attempts/${attemptId}/autosave`, cookie, { version: 1, clientId: "client-aaaa", answers: ans })).status).toBe(200);
    expect((await call("PUT", `/api/attempts/${attemptId}/autosave`, cookie, { version: 0, clientId: "client-aaaa", answers: ans })).status).toBe(409);
    await call("GET", `/api/attempts/${attemptId}?clientId=client-bbbb`, cookie); // second tab takes over
    const old = await call("PUT", `/api/attempts/${attemptId}/autosave`, cookie, { version: 2, clientId: "client-aaaa", answers: ans });
    expect(old.json.error).toBe("other_window");
    const r = await call("GET", `/api/attempts/${attemptId}?clientId=client-bbbb`, cookie);
    expect(r.json.answers.passage.fields.t).toContain("इस्पात उत्पादक");
  });
  it("Sahayika refuses to translate a paragraph, gives a hint, and answers a term", async () => {
    const no = await call("POST", "/api/sahayika/chat", cookie, { attemptId, question: "Translate paragraph 2 for me" });
    expect(no.json.en).toMatch(/your job|your mission/i);
    const hint = await call("POST", "/api/sahayika/chat", cookie, { attemptId, quick: "hint" });
    expect(hint.json.hi.length).toBeGreaterThan(5);
    const term = await call("POST", "/api/sahayika/chat", cookie, { attemptId, question: "What is marketing in Hindi?" });
    expect(term.json.hi).toContain("विपणन");
  });
  it("counts page leaves with a 2 s debounce", async () => {
    await call("POST", `/api/attempts/${attemptId}/events`, cookie, { type: "left_tab" });
    const r = await call("POST", `/api/attempts/${attemptId}/events`, cookie, { type: "left_blur" });
    expect(r.json.leftPageCount).toBe(1);
  });
  it("submits and builds a report card", async () => {
    const s = await call("POST", `/api/attempts/${attemptId}/submit`, cookie, {});
    expect(s.status).toBe(200);
    const rep = await call("GET", `/api/attempts/${attemptId}/report`, cookie);
    expect([8, 9]).toContain(rep.json.counts.completionTotal); // two Trial passages exist
    expect(rep.json.counts.completionDone).toBe(1);
    expect(rep.json.chances).toHaveLength(3);
    expect(rep.json.after.map((l: any) => l.id)).toContain("trial.report_card.typing_only_next");
    expect(rep.json.after.map((l: any) => l.id)).toContain("trial.report_card.left_count_note");
    const rv = await call("GET", `/api/attempts/${attemptId}/review`, cookie);
    expect(JSON.stringify(rv.json)).not.toMatch(/hiReference/);
  });
  it("keeps Primary locked after a Trial below the qualifying score", async () => {
    expect((await call("POST", "/api/rounds/primary/attempts", cookie, { clientId: "client-aaaa" })).status).toBe(403);
  });
  it("allows 3 chances and refuses the 4th; passing the Trial unlocks every level", async () => {
    for (const n of [2, 3]) {
      const a = await call("POST", "/api/rounds/trial/attempts", cookie, { clientId: "client-aaaa" });
      expect(a.json.chanceNo).toBe(n);
      if (n === 2) {
        // answer with CAG's own Hindi (read straight from the DB) to pass the Trial
        const parts = await db.query<{ fields: any[] }>("SELECT fields FROM page_parts WHERE page_id=(SELECT page_id FROM attempts WHERE id=$1)", [a.json.id]);
        const answers = { passage: { fields: { t: parts[0].fields[0].hiReference }, done: false } };
        await call("PUT", `/api/attempts/${a.json.id}/autosave`, cookie, { version: 1, clientId: "client-aaaa", answers });
      }
      await call("POST", `/api/attempts/${a.json.id}/submit`, cookie, {});
    }
    expect((await call("POST", "/api/rounds/trial/attempts", cookie, { clientId: "client-aaaa" })).status).toBe(409);
    const p = await call("GET", "/api/me/progress", cookie);
    expect(p.json.summary.trialPassed).toBe(true);
    expect(p.json.summary.rounds.filter((r: any) => ["primary", "secondary", "pro"].includes(r.key)).every((r: any) => r.unlocked)).toBe(true);
    // Varchaspati is shown but cannot be started (Phase 2)
    expect((await call("POST", "/api/rounds/varchaspati/attempts", cookie, { clientId: "client-aaaa" })).json.error).toBe("coming_soon");
    const lb = await call("GET", "/api/leaderboard", cookie);
    expect(lb.json.me.rank).toBe(1);
  });
  it("opens primary with a BHASHINI draft and locked numbers kept on autosave", async () => {
    const a = await call("POST", "/api/rounds/primary/attempts", cookie, { clientId: "client-aaaa" });
    expect(a.status).toBe(200);
    const parts = a.json.page.parts.filter((p: any) => p.editable);
    const withNum = parts.find((p: any) => p.fields.some((f: any) => f.locked.length && f.draft));
    expect(withNum).toBeTruthy();
    const f = withNum.fields.find((x: any) => x.locked.length && x.draft);
    const answers = structuredClone(a.json.answers);
    answers[withNum.id].fields[f.key] = "बिना अंकों का पाठ";
    await call("PUT", `/api/attempts/${a.json.id}/autosave`, cookie, { version: 1, clientId: "client-aaaa", answers });
    const back = await call("GET", `/api/attempts/${a.json.id}`, cookie);
    for (const tok of f.locked) if (f.draft.includes(tok)) expect(back.json.answers[withNum.id].fields[f.key]).toContain(tok);
    expect(a.json.page.watchWords.length).toBeGreaterThan(0);
  });
  it("summary and certificate list only titles earned", async () => {
    const s = await call("GET", "/api/me/summary", cookie);
    expect(s.json.summary.totalCredits).toBeLessThanOrEqual(50);
    const c = await call("GET", "/api/me/certificate?format=html", cookie);
    expect(c.raw.body).toContain("This is to certify that");
    expect(findForbidden(c.raw.body)).toEqual([]);
  });
  it("returning player gets resumed with credits intact", async () => {
    await call("POST", "/api/auth/otp/request", "", { email: "ramesh.k@cag.gov.in" });
    const v = await call("POST", "/api/auth/otp/verify", "", { email: "ramesh.k@cag.gov.in", code: "123456" });
    expect(v.json.status).toBe("existing");
    const p = await call("GET", "/api/me/progress", v.cookie);
    expect(p.json.next.action).toBe("resume");
    expect(p.json.summary.totalCredits).toBeGreaterThanOrEqual(2);
  });
});

describe("contract (§14, §18.12)", () => {
  it("no client response leaks references, sector, slip fixes, keys or forbidden words", () => {
    const all = captured.join("\n");
    expect(all).not.toMatch(/hiReference|hi_reference|fixHint|fix_hint|DHRUVA_|ANUVAAD_XLIT_AUTH/);
    expect(all).not.toMatch(/"sector"/);
    expect(findForbidden(all)).toEqual([]);
  });
  it("admin routes are closed to players", async () => {
    expect((await app.inject({ method: "GET", url: "/api/admin/pages" })).statusCode).toBe(403);
  });
});

describe("rich-text copy of an answer", () => {
  it("keeps formatting, drops scripts and unknown attributes, and ignores plain paragraphs", () => {
    const ok = sanitiseHtml('<p style="text-align: center"><strong>नमस्ते</strong> <span data-locked="83" class="x" onclick="a()">83</span></p>');
    expect(ok).toContain("<strong>");
    expect(ok).toContain('text-align: center');
    expect(ok).toContain('data-locked="83"');
    expect(ok).not.toContain("onclick");
    expect(sanitiseHtml('<p>plain</p><script>alert(1)</script>')).toBe("");
    expect(sanitiseHtml('<p><em>a</em><img src=x onerror=1><script>x</script></p>')).not.toMatch(/<img|<script|onerror/);
  });
});
