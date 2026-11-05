import { randomUUID } from "node:crypto";
import { RoundKey as RoundKeySchema } from "@hc/shared";
import type { FastifyInstance } from "fastify";
import { publicConfig, roundOf, summarise, totalScreenLines, type RoundKey } from "@hc/shared";
import { z } from "zod";
import { adminRole, clearSession, emailAllowed, normEmail, requestOtp, requirePlayer, setSession, verifyOtp } from "../auth.js";
import { allLines, config, strings } from "../content.js";
import type { Db } from "../db.js";
import { firstName, summaryFor } from "../game.js";
import { searchGlossary } from "../pages.js";
import { say } from "../sahayika/engine.js";
import { parse } from "./util.js";

const Email = z.string().trim().toLowerCase().email().max(120);

export async function playerRoutes(app: FastifyInstance, db: Db) {
  // ---------- auth ----------
  app.post("/auth/otp/request", async (req, reply) => {
    const { email } = parse(z.object({ email: Email }), req.body);
    if (!emailAllowed(email)) return reply.code(403).send({ error: "email_domain" });
    const r = await requestOtp(db, normEmail(email));
    if (!r.ok) return reply.code(r.status).send({ error: r.error });
    return { ok: true, devCode: r.devCode };
  });

  app.post("/auth/otp/verify", async (req, reply) => {
    const { email, code } = parse(z.object({ email: Email, code: z.string().regex(/^\d{4,8}$/) }), req.body);
    const e = normEmail(email);
    if (!emailAllowed(e)) return reply.code(403).send({ error: "email_domain" });
    if (!(await verifyOtp(db, e, code))) return reply.code(400).send({ error: "otp_invalid" });
    const p = await db.one<{ id: string }>("SELECT id FROM players WHERE email=$1", [e]);
    const role = await adminRole(db, e);
    await setSession(reply, { email: e, pid: p?.id, role, sid: randomUUID() });
    return { status: p ? "existing" : "new", role: role ?? null };
  });

  app.post("/players/register", async (req, reply) => {
    const s = req.session;
    if (!s?.email) return reply.code(401).send({ error: "verify_email_first" });
    if (s.pid) return { ok: true, existing: true };
    const body = parse(z.object({
      name: z.string().trim().min(2).max(80),
      mobile: z.string().regex(/^[6-9]\d{9}$/),
      officeId: z.string().min(1),
      officeAddress: z.string().trim().min(5).max(300),
    }), req.body);
    const office = await db.one("SELECT id FROM offices WHERE id=$1", [body.officeId]);
    if (!office) return reply.code(400).send({ error: "office_unknown" });
    const id = randomUUID();
    const existing = await db.one<{ id: string }>("SELECT id FROM players WHERE email=$1", [s.email]);
    if (!existing) {
      await db.query(
        "INSERT INTO players (id, email, name, mobile, office_id, office_address, registration_credits) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (email) DO NOTHING",
        [id, s.email, body.name, body.mobile, body.officeId, body.officeAddress, config().registration.credits],
      );
    }
    const p = await db.one<{ id: string }>("SELECT id FROM players WHERE email=$1", [s.email]);
    await setSession(reply, { ...s, pid: p!.id });
    return { ok: true, existing: !!existing, line: say("before_game.screen.registration_done") };
  });

  app.post("/auth/logout", async (_req, reply) => {
    clearSession(reply);
    return { ok: true };
  });

  app.get("/offices", async (req) => {
    const { q } = parse(z.object({ q: z.string().max(80).optional() }), req.query);
    const s = `%${(q ?? "").trim().toLowerCase()}%`;
    const rows = await db.query(
      `SELECT id, name_en, name_hi, city, state, pincode, address FROM offices
       WHERE lower(name_en) LIKE $1 OR coalesce(name_hi,'') LIKE $2 OR lower(city) LIKE $1 OR lower(state) LIKE $1
       ORDER BY (type LIKE 'HQ%') DESC, name_en LIMIT 30`,
      [s, `%${(q ?? "").trim()}%`],
    );
    return rows.map((o: any) => ({ id: o.id, name: o.name_hi || o.name_en, nameEn: o.name_en, city: o.city, state: o.state, address: o.address }));
  });

  // ---------- content ----------
  app.get("/config", async () => publicConfig(config()));
  app.get("/rounds", async () => config().rounds);
  app.get("/content/strings", async () => {
    const { _comment, _authoredInSpec_reviewBeforeLaunch, ...rest } = strings;
    return rest;
  });

  app.get("/sahayika/lines", async (req) => {
    const { section } = parse(z.object({ section: z.string().max(40).optional() }), req.query);
    let vars: Record<string, string | number> = {};
    if (req.session?.pid) {
      const { player, summary } = await summaryFor(db, req.session.pid);
      if (player) vars = { name: firstName(player.name), total_credits: summary.totalCredits };
    }
    return allLines()
      .filter((l) => !section || l.section === section)
      .map((l) => say(l.id, vars));
  });

  app.get("/glossary", async (req) => {
    const { q } = parse(z.object({ q: z.string().max(80) }), req.query);
    return searchGlossary(q, 25).map((e) => ({ en: e.en, hi: e.hi, variants: e.variants.slice(0, 4), avoid: e.avoid.slice(0, 3) }));
  });

  // ---------- me ----------
  app.get("/me/progress", async (req, reply) => {
    // a visitor on the landing page is a normal state, not an error (no 401 noise in the console)
    if (!req.session?.email) return { registered: false, role: null };
    if (!req.session.pid) return { registered: false, email: req.session.email, role: req.session.role ?? null };
    const { player, attempts, summary } = await summaryFor(db, req.session.pid);
    if (!player) return reply.code(401).send({ error: "not_registered" });
    const active = attempts.find((a) => a.status === "active");
    const office = await db.one<{ city: string; state: string }>("SELECT city, state FROM offices WHERE id=$1", [player.office_id]);
    return {
      registered: true,
      role: req.session.role ?? null,
      player: { name: player.name, email: player.email, officeId: player.office_id, office: office ? `${office.city}, ${office.state}` : undefined },
      summary,
      activeAttempt: active ? { id: active.id, roundKey: active.round_key } : null,
      next: active ? { action: "resume", roundKey: active.round_key } : summary.nextRound ? { action: "preround", roundKey: summary.nextRound } : { action: "total" },
    };
  });

  app.get("/me/summary", async (req, reply) => {
    const pid = requirePlayer(req, reply);
    if (!pid) return;
    const { player, summary } = await summaryFor(db, pid);
    const vars = { name: firstName(player!.name), total_credits: summary.totalCredits };
    return { playerName: player!.name, summary, maxCredits: config().maxCredits, lines: totalScreenLines(summary).map((id) => say(id, vars)).filter(Boolean) };
  });

  /** Everyone's standings, computed (never stored). Names are shown as first name + initial; offices as "city, state". */
  async function standings() {
    const players = await db.query<any>("SELECT p.id, p.name, p.registration_credits, p.registered_at, p.office_id, o.name_en AS office_name, o.city, o.state FROM players p JOIN offices o ON o.id=p.office_id");
    const atts = await db.query<any>("SELECT player_id, round_key, chance_no, status, score FROM attempts");
    const byPlayer = new Map<string, any[]>();
    for (const a of atts) byPlayer.set(a.player_id, [...(byPlayer.get(a.player_id) ?? []), { roundKey: a.round_key, chanceNo: a.chance_no, status: a.status, score: a.score }]);
    return players.map((p) => {
      const s = summarise(config(), byPlayer.get(p.id) ?? [], Number(p.registration_credits));
      const [first, ...rest] = String(p.name).trim().split(/\s+/);
      const bestSum = s.rounds.reduce((t, r) => t + (r.best ?? 0), 0);
      const top = [...s.rounds].reverse().find((r) => r.playable && r.titleEarned);
      return {
        id: p.id, officeId: p.office_id, state: p.state, name: rest.length ? `${first} ${rest[rest.length - 1][0]}.` : first,
        office: `${p.city}, ${p.state}`, credits: s.totalCredits, stars: s.stars, titles: s.rounds.filter((r) => r.titleEarned).length,
        bestSum, tier: top?.key ?? null, levelsPlayed: s.rounds.filter((r) => r.played > 0).length,
      };
    }).sort((a, b) => b.credits - a.credits || b.bestSum - a.bestSum || b.stars - a.stars || a.name.localeCompare(b.name));
  }
  const rankOf = <T extends { id: string }>(rows: T[]) => rows.map((r, i) => ({ ...r, rank: i + 1 }));

  /** Leaderboard (§ portal): overall, my state or my office; top N plus your own row and the gap to the next rank. */
  app.get("/leaderboard", async (req, reply) => {
    const pid = requirePlayer(req, reply);
    if (!pid) return;
    const { scope, limit } = parse(z.object({ scope: z.enum(["all", "state", "office"]).default("all"), limit: z.coerce.number().int().min(3).max(100).default(10) }), req.query);
    const all = await standings();
    const mine = all.find((r) => r.id === pid);
    const pool = scope === "office" ? all.filter((r) => r.officeId === mine?.officeId) : scope === "state" ? all.filter((r) => r.state === mine?.state) : all;
    const ranked = rankOf(pool);
    const me = ranked.find((r) => r.id === pid);
    const ahead = me && me.rank > 1 ? ranked[me.rank - 2] : null;
    const strip = ({ id, officeId: _o, state: _s, ...r }: (typeof ranked)[number]) => ({ ...r, me: id === pid });
    return {
      scope,
      top: ranked.slice(0, limit).map(strip),
      me: me ? { ...strip(me), of: ranked.length, gap: ahead ? Math.round((ahead.credits - me.credits) * 10) / 10 : 0 } : null,
    };
  });

  /** Public, aggregate-only numbers for the landing page (no personal data). */
  app.get("/stats/public", async () => {
    const all = await standings();
    const offices = new Set(all.map((r) => r.officeId)).size;
    const credits = Math.round(all.reduce((t, r) => t + r.credits, 0) * 10) / 10;
    const titles = all.reduce((t, r) => t + r.titles, 0);
    const pages = await db.one<{ n: string }>("SELECT count(*)::text AS n FROM pages WHERE active AND (status='published' OR sample)");
    return { players: all.length, offices, credits, titles, bundles: Number(pages?.n ?? 0) };
  });

  /** My profile: player card, standing, history and achievements. */
  app.get("/me/profile", async (req, reply) => {
    const pid = requirePlayer(req, reply);
    if (!pid) return;
    const { player, attempts, summary } = await summaryFor(db, pid);
    const office = await db.one<any>("SELECT name_en, name_hi, city, state FROM offices WHERE id=$1", [player!.office_id]);
    const all = rankOf(await standings());
    const me = all.find((r) => r.id === pid);
    const done = attempts.filter((a) => a.status === "submitted");
    const has = (f: (a: any) => boolean) => done.some(f);
    const achievements = [
      { key: "enlisted", earned: true },
      { key: "firstClear", earned: has((a) => (a.score ?? 0) >= config().titlePassMark) },
      { key: "trialCleared", earned: summary.trialPassed },
      { key: "glossaryAce", earned: has((a) => a.measures?.glossary === 1 && (a.score ?? 0) > 0) },
      { key: "swift", earned: has((a) => a.measures?.time === 1 && (a.score ?? 0) >= config().titlePassMark) },
      { key: "cleanSheet", earned: has((a) => a.left_page_count === 0 && a.paste_blocked_count === 0 && (a.score ?? 0) > 0) },
      { key: "comeback", earned: summary.rounds.some((r) => r.bestChance !== null && r.bestChance > 1 && (r.chances[0] ?? 0) < (r.best ?? 0)) },
      { key: "allRounder", earned: summary.allPlayed },
      { key: "grandSlam", earned: summary.rounds.filter((r) => r.playable).every((r) => r.titleEarned) },
      { key: "topTen", earned: !!me && me.rank <= 10 && me.credits > summary.registrationCredits },
    ];
    return {
      player: {
        name: player!.name, email: player!.email, mobile: `+91 ••••• ${String(player!.mobile).slice(-5)}`,
        office: office ? { name: office.name_en, nameHi: office.name_hi, city: office.city, state: office.state } : null,
        address: player!.office_address, registeredAt: player!.registered_at,
      },
      summary,
      standing: me ? { rank: me.rank, of: all.length, tier: me.tier } : null,
      history: attempts.map((a) => ({
        id: a.id, roundKey: a.round_key, chance: a.chance_no, status: a.status, score: a.score,
        startedAt: a.started_at, submittedAt: a.submitted_at, minutes: a.submitted_at ? Math.max(1, Math.round((+new Date(a.submitted_at) - +new Date(a.started_at)) / 60000)) : null,
        measures: a.measures, autoSubmitted: a.auto_submitted,
      })).sort((x, y) => +new Date(y.startedAt) - +new Date(x.startedAt)),
      achievements,
    };
  });

  /** Pop-up lines (§7.5): first_chance or retry (+ best), typing-only notice before प्राथमिक, rotating tip. */
  app.get("/rounds/:key/intro", async (req, reply) => {
    const pid = requirePlayer(req, reply);
    if (!pid) return;
    const key = parse(z.object({ key: RoundKeySchema }), req.params).key as RoundKey;
    const { player, summary } = await summaryFor(db, pid);
    const r = summary.rounds.find((x) => x.key === key)!;
    const chance = r.active ? r.chancesUsed : r.chancesUsed + 1;
    const vars = { name: firstName(player!.name), chance, best_score: r.best ?? 0 };
    const lines = [];
    const moment = r.best === null || chance <= 1 ? "first_chance" : chance === 2 ? "retry" : r.titleEarned ? "retry_last_won" : "retry_last";
    lines.push(say(`${key}.pre_round.${moment}`, vars) ?? say(`${key}.pre_round.retry`, vars));
    if (moment === "first_chance") lines.push(say(`${key}.pre_round.encourage`, vars));
    const tips = allLines().filter((l) => l.id.startsWith(`${key}.pre_round.tip.`));
    if (tips.length) lines.push(say(tips[(chance - 1) % tips.length].id, vars));
    const round = roundOf(config(), key);
    return { round, chance, maxChances: config().maxChancesPerRound, unlocked: r.unlocked, playable: r.playable, chancesLeft: r.chancesLeft, active: r.active, best: r.best, trialPassed: summary.trialPassed, trialQualifyingScore: summary.trialQualifyingScore, lines: lines.filter(Boolean) };
  });
}
