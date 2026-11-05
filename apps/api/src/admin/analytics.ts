import { summarise, type RoundKey } from "@hc/shared";
import { health } from "../bhashini/client.js";
import { config } from "../content.js";
import type { Db } from "../db.js";

/**
 * Console analytics (CLAUDE.md §8 dashboard, extended). Everything is computed from the live
 * tables; round results are derived from attempts, never stored (§6). Data volumes for the
 * Hindi Pakhwada are small (thousands of rows), so rows are aggregated in memory.
 */

export type Range = "7d" | "30d" | "all";
const IST_MS = 330 * 60_000;
/** Calendar day in India Standard Time (officers play in IST). */
export const istDay = (d: Date | string | number) => new Date(new Date(d).getTime() + IST_MS).toISOString().slice(0, 10);
const startOfIstDay = (now = Date.now()) => new Date(Date.parse(istDay(now) + "T00:00:00Z") - IST_MS);

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const r1 = (x: number | null) => (x === null ? null : Math.round(x * 10) / 10);
const pct = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 10 : null);

interface AttemptAgg {
  id: string; player_id: string; round_key: RoundKey; chance_no: number; page_id: string;
  started_at: Date; deadline_at: Date; last_saved_at: Date | null; submitted_at: Date | null;
  auto_submitted: boolean; status: "active" | "submitted"; left_page_count: number; paste_blocked_count: number;
  measures: Record<string, number> | null; score: number | null; term_checks: { en: string; hi: string; correct: boolean; present: boolean; avoidFound: string | null }[] | null;
  chat_count: number;
}
interface PlayerAgg { id: string; email: string; name: string; registered_at: Date; registration_credits: string | number; office_id: string; office_name: string; city: string; state: string }

export async function loadAgg(db: Db) {
  const players = await db.query<PlayerAgg>(
    "SELECT p.id, p.email, p.name, p.registered_at, p.registration_credits, p.office_id, o.name_en AS office_name, o.city, o.state FROM players p LEFT JOIN offices o ON o.id=p.office_id");
  const attempts = await db.query<AttemptAgg>(
    `SELECT id, player_id, round_key, chance_no, page_id, started_at, deadline_at, last_saved_at, submitted_at, auto_submitted, status,
            left_page_count, paste_blocked_count, measures, score, result->'termChecks' AS term_checks, chat_count FROM attempts`);
  return { players, attempts };
}

export function summariesFor(players: PlayerAgg[], attempts: AttemptAgg[]) {
  const by = new Map<string, AttemptAgg[]>();
  for (const a of attempts) (by.get(a.player_id) ?? by.set(a.player_id, []).get(a.player_id)!).push(a);
  return new Map(players.map((p) => [p.id, summarise(config(), (by.get(p.id) ?? []).map((a) => ({ roundKey: a.round_key, chanceNo: a.chance_no, status: a.status, score: a.score, submittedAt: a.submitted_at })), Number(p.registration_credits))]));
}

const lastActivity = (a: AttemptAgg) => Math.max(+new Date(a.started_at), a.last_saved_at ? +new Date(a.last_saved_at) : 0, a.submitted_at ? +new Date(a.submitted_at) : 0);

export async function overview(db: Db, range: Range) {
  const cfg = config();
  const now = Date.now();
  const since = range === "all" ? null : new Date(now - (range === "7d" ? 7 : 30) * 86_400_000);
  const inRange = (d: Date | string | null) => !!d && (!since || +new Date(d) >= +since);
  const { players, attempts } = await loadAgg(db);
  const summaries = summariesFor(players, attempts);
  const playable = cfg.rounds.filter((r) => r.playable !== false);
  const atts = attempts.filter((a) => inRange(a.started_at));
  const submitted = atts.filter((a) => a.status === "submitted" && a.score !== null);
  const pastDeadline = (a: AttemptAgg) => a.status === "active" && +new Date(a.deadline_at) < now;

  // ---------- KPI tiles ----------
  const today = +startOfIstDay(now);
  const activeIn = (from: number) => new Set([
    ...attempts.filter((a) => lastActivity(a) >= from).map((a) => a.player_id),
    ...players.filter((p) => +new Date(p.registered_at) >= from).map((p) => p.id),
  ]).size;
  const allSummaries = [...summaries.values()];
  const credits = allSummaries.map((s) => s.totalCredits);
  const titles = allSummaries.reduce((n, s) => n + s.rounds.filter((r) => r.titleEarned).length, 0);
  const kpis = {
    playersRegistered: players.length,
    newPlayers: players.filter((p) => inRange(p.registered_at)).length,
    activeToday: activeIn(today),
    active7d: activeIn(now - 7 * 86_400_000),
    attemptsStarted: atts.length,
    attemptsSubmitted: atts.filter((a) => a.status === "submitted" && !a.auto_submitted).length,
    attemptsAutoSubmitted: atts.filter((a) => a.auto_submitted).length,
    attemptsInProgress: atts.filter((a) => a.status === "active" && !pastDeadline(a)).length,
    attemptsAbandoned: atts.filter((a) => pastDeadline(a) || (a.auto_submitted && (a.score ?? 0) === 0)).length,
    completionRate: pct(atts.filter((a) => a.status === "submitted" && !a.auto_submitted).length, atts.length),
    creditsAwarded: r1(credits.reduce((a, b) => a + b, 0)),
    avgCreditsPerPlayer: r1(avg(credits)),
    maxCredits: cfg.maxCredits,
    titlesEarned: titles,
    trialPassRate: pct(allSummaries.filter((s) => s.trialPassed).length, allSummaries.filter((s) => s.rounds[0]?.played > 0).length),
  };

  // ---------- per level ----------
  const levels = cfg.rounds.map((r) => {
    const mine = atts.filter((a) => a.round_key === r.key);
    const sub = mine.filter((a) => a.status === "submitted" && a.score !== null);
    const bestBy = new Map<string, number>();
    for (const a of sub) bestBy.set(a.player_id, Math.max(bestBy.get(a.player_id) ?? -1, a.score!));
    const bests = [...bestBy.values()];
    const hist = Array.from({ length: 10 }, (_, i) => ({ from: i * 10, to: i === 9 ? 100 : i * 10 + 9, n: 0 }));
    for (const b of bests) hist[Math.min(9, Math.floor(b / 10))].n++;
    // scoring v2 keys; pre-v2 attempts stored "translation" where v2 stores "quality"
    const m = (k: string) => r1((avg(sub.map((a) => Number(a.measures?.[k] ?? (k === "quality" ? a.measures?.translation : undefined) ?? NaN)).filter((x) => !Number.isNaN(x))) ?? NaN) * 100);
    return {
      key: r.key, name: r.nameEn ?? r.name, nameHi: r.name, levelLabel: r.levelLabel, playable: r.playable !== false,
      started: mine.length, submitted: sub.length, players: bests.length,
      avgBest: r1(avg(bests)), medianBest: r1(median(bests)), avgScore: r1(avg(sub.map((a) => a.score!))),
      passRate: pct(bests.filter((b) => b >= cfg.titlePassMark).length, bests.length),
      histogram: hist,
      measures: { quality: m("quality"), glossary: m("glossary"), timeliness: m("timeliness"), completion: m("completion"), time: m("time") },
      avgMinutes: r1(avg(sub.filter((a) => a.submitted_at).map((a) => (+new Date(a.submitted_at!) - +new Date(a.started_at)) / 60_000))),
    };
  });

  // ---------- engagement funnel (all time; each step is a subset of the one before) ----------
  const playedRound = (k: string) => new Set(attempts.filter((a) => a.round_key === k).map((a) => a.player_id));
  const trialStarted = playedRound("trial");
  const trialPassed = new Set(allSummaries.map((s, i) => (s.trialPassed ? players[i]?.id : null)).filter(Boolean) as string[]);
  const funnel = [
    { step: "Registered", n: players.length },
    { step: "Started Trial", n: trialStarted.size },
    { step: `Passed Trial (≥ ${cfg.levels.trialQualifyingScore})`, n: trialPassed.size },
    ...playable.filter((r) => r.key !== "trial").map((r) => ({ step: `Played ${r.nameEn ?? r.name}`, n: playedRound(r.key).size })),
  ];

  // ---------- daily trend ----------
  const firstDay = since ? +since : Math.min(now - 13 * 86_400_000, ...players.map((p) => +new Date(p.registered_at)), ...attempts.map((a) => +new Date(a.started_at)));
  const start = Math.max(firstDay, now - 120 * 86_400_000);
  const days: { day: string; registrations: number; started: number; submitted: number; activePlayers: number }[] = [];
  for (let t = start; istDay(t) <= istDay(now); t += 86_400_000) {
    const d = istDay(t);
    if (days.at(-1)?.day === d) continue;
    days.push({ day: d, registrations: 0, started: 0, submitted: 0, activePlayers: 0 });
  }
  const dayIdx = new Map(days.map((d, i) => [d.day, i]));
  const act = days.map(() => new Set<string>());
  for (const p of players) { const i = dayIdx.get(istDay(p.registered_at)); if (i !== undefined) days[i].registrations++; }
  for (const a of attempts) {
    const i = dayIdx.get(istDay(a.started_at));
    if (i !== undefined) { days[i].started++; act[i].add(a.player_id); }
    if (a.submitted_at) { const j = dayIdx.get(istDay(a.submitted_at)); if (j !== undefined) { days[j].submitted++; act[j].add(a.player_id); } }
  }
  days.forEach((d, i) => (d.activePlayers = act[i].size));

  // ---------- credits distribution vs the 50 maximum ----------
  const step = cfg.maxCredits / 5;
  const creditBins = Array.from({ length: 5 }, (_, i) => ({ from: r1(i * step)!, to: r1((i + 1) * step)!, n: 0 }));
  for (const c of credits) creditBins[Math.min(4, Math.floor(c / step))].n++;

  // ---------- fair play ----------
  const fairPlay = {
    leaveEvents: atts.reduce((n, a) => n + a.left_page_count, 0),
    attemptsWithLeaves: atts.filter((a) => a.left_page_count > 0).length,
    pasteBlocks: atts.reduce((n, a) => n + a.paste_blocked_count, 0),
    attemptsWithPasteBlocks: atts.filter((a) => a.paste_blocked_count > 0).length,
    autoSubmits: atts.filter((a) => a.auto_submitted).length,
    byLevel: cfg.rounds.map((r) => {
      const mine = atts.filter((a) => a.round_key === r.key);
      return { key: r.key, name: r.nameEn ?? r.name, leaves: mine.reduce((n, a) => n + a.left_page_count, 0), pasteBlocks: mine.reduce((n, a) => n + a.paste_blocked_count, 0), autoSubmits: mine.filter((a) => a.auto_submitted).length };
    }),
    watchlist: (() => {
      const m = new Map<string, { leaves: number; pasteBlocks: number; autoSubmits: number }>();
      for (const a of atts) {
        const e = m.get(a.player_id) ?? { leaves: 0, pasteBlocks: 0, autoSubmits: 0 };
        e.leaves += a.left_page_count; e.pasteBlocks += a.paste_blocked_count; e.autoSubmits += a.auto_submitted ? 1 : 0;
        m.set(a.player_id, e);
      }
      return [...m.entries()].map(([id, e]) => { const p = players.find((x) => x.id === id); return { playerId: id, name: p?.name ?? "?", email: p?.email ?? "", ...e }; })
        .filter((x) => x.leaves + x.pasteBlocks > 0).sort((a, b) => b.leaves + b.pasteBlocks - (a.leaves + a.pasteBlocks)).slice(0, 8);
    })(),
  };

  // ---------- geography ----------
  const geo = (key: (p: PlayerAgg) => string) => {
    const g = new Map<string, { label: string; players: number; scores: number[]; credits: number[] }>();
    for (const p of players) {
      const k = key(p) || "Unknown";
      const e = g.get(k) ?? { label: k, players: 0, scores: [], credits: [] };
      e.players++;
      e.credits.push(summaries.get(p.id)?.totalCredits ?? 0);
      g.set(k, e);
    }
    for (const a of submitted) { const p = players.find((x) => x.id === a.player_id); if (p) g.get(key(p) || "Unknown")?.scores.push(a.score!); }
    return [...g.values()].map((e) => ({ label: e.label, players: e.players, attempts: e.scores.length, avgScore: r1(avg(e.scores)), avgCredits: r1(avg(e.credits)) }))
      .sort((a, b) => b.players - a.players || (b.avgScore ?? 0) - (a.avgScore ?? 0)).slice(0, 10);
  };

  // ---------- content usage ----------
  const pages = await db.query<{ id: string; label: string; round_key: string; status: string; sample: boolean }>("SELECT id, label, round_key, status, sample FROM pages");
  const content = pages.map((p) => {
    const used = atts.filter((a) => a.page_id === p.id);
    const sc = used.filter((a) => a.score !== null).map((a) => a.score!);
    return { id: p.id, label: p.label, roundKey: p.round_key, status: p.status, sample: p.sample, timesUsed: used.length, avgScore: r1(avg(sc)) };
  }).sort((a, b) => b.timesUsed - a.timesUsed);
  const pageCounts = cfg.rounds.map((r) => ({
    key: r.key, name: r.nameEn ?? r.name,
    published: pages.filter((p) => p.round_key === r.key && p.status === "published").length,
    draft: pages.filter((p) => p.round_key === r.key && p.status === "draft").length,
    retired: pages.filter((p) => p.round_key === r.key && p.status === "retired").length,
  }));

  // ---------- glossary insights (from the scorer's stored term checks) ----------
  const terms = new Map<string, { en: string; hi: string; seen: number; missed: number; avoid: number }>();
  const avoidForms = new Map<string, { form: string; en: string; hi: string; n: number }>();
  for (const a of submitted) for (const t of a.term_checks ?? []) {
    const e = terms.get(t.en) ?? { en: t.en, hi: t.hi, seen: 0, missed: 0, avoid: 0 };
    e.seen++;
    if (!t.correct) e.missed++;
    if (t.avoidFound) {
      e.avoid++;
      const k = `${t.en}|${t.avoidFound}`;
      const f = avoidForms.get(k) ?? { form: t.avoidFound, en: t.en, hi: t.hi, n: 0 };
      f.n++;
      avoidForms.set(k, f);
    }
    terms.set(t.en, e);
  }
  const glossary = {
    termsChecked: [...terms.values()].reduce((n, t) => n + t.seen, 0),
    correctRate: pct([...terms.values()].reduce((n, t) => n + t.seen - t.missed, 0), [...terms.values()].reduce((n, t) => n + t.seen, 0)),
    mostMissed: [...terms.values()].filter((t) => t.missed > 0).map((t) => ({ ...t, missRate: pct(t.missed, t.seen) })).sort((a, b) => b.missed - a.missed || (b.missRate ?? 0) - (a.missRate ?? 0)).slice(0, 10),
    avoidFormsUsed: [...avoidForms.values()].sort((a, b) => b.n - a.n).slice(0, 10),
  };

  // ---------- Sahayak chat ----------
  const chatRows = await db.query<{ source: string; blocked: boolean; n: number }>(
    "SELECT source, blocked, count(*)::int AS n FROM chat_logs WHERE ($1::timestamptz IS NULL OR at >= $1) GROUP BY 1,2", [since]);
  const chatPlayers = await db.one<{ n: number }>("SELECT count(DISTINCT player_id)::int AS n FROM chat_logs WHERE ($1::timestamptz IS NULL OR at >= $1)", [since]);
  const bySource = new Map<string, number>();
  for (const c of chatRows) bySource.set(c.source, (bySource.get(c.source) ?? 0) + c.n);
  const chat = {
    questions: chatRows.reduce((n, c) => n + c.n, 0),
    blocked: chatRows.filter((c) => c.blocked).reduce((n, c) => n + c.n, 0),
    players: chatPlayers?.n ?? 0,
    bySource: [...bySource.entries()].map(([source, n]) => ({ source, n })).sort((a, b) => b.n - a.n),
  };

  const xlit = await db.query<{ accepted_index: number; n: number }>(
    "SELECT accepted_index, sum(count)::int AS n FROM xlit_stats WHERE ($1::date IS NULL OR day >= $1::date) GROUP BY 1 ORDER BY 1", [since ? istDay(since) : null]);

  return {
    range, generatedAt: new Date(), passMark: cfg.titlePassMark, trialQualifyingScore: cfg.levels.trialQualifyingScore, unlockRule: cfg.levels.unlockRule,
    kpis, levels, funnel, trend: days, creditBins, fairPlay,
    states: geo((p) => p.state), offices: geo((p) => p.office_name),
    content, pageCounts, glossary, chat, xlit: xlit.map((x) => ({ index: x.accepted_index, n: x.n })),
    services: health(),
  };
}

/** Latest registrations, submissions and console actions, newest first. */
export async function activity(db: Db, limit = 30) {
  const regs = await db.query<{ at: Date; name: string; email: string; state: string | null }>(
    "SELECT p.registered_at AS at, p.name, p.email, o.state FROM players p LEFT JOIN offices o ON o.id=p.office_id ORDER BY p.registered_at DESC LIMIT $1", [limit]);
  const subs = await db.query<{ at: Date; name: string; email: string; round_key: string; chance_no: number; score: number; auto_submitted: boolean }>(
    `SELECT a.submitted_at AS at, p.name, p.email, a.round_key, a.chance_no, a.score, a.auto_submitted FROM attempts a JOIN players p ON p.id=a.player_id
     WHERE a.status='submitted' ORDER BY a.submitted_at DESC LIMIT $1`, [limit]);
  const starts = await db.query<{ at: Date; name: string; email: string; round_key: string; chance_no: number }>(
    `SELECT a.started_at AS at, p.name, p.email, a.round_key, a.chance_no FROM attempts a JOIN players p ON p.id=a.player_id ORDER BY a.started_at DESC LIMIT $1`, [limit]);
  const audits = await db.query<{ at: Date; actor: string; action: string; target: string }>(
    "SELECT at, actor, action, target FROM audit_logs ORDER BY at DESC LIMIT $1", [limit]);
  const name = (k: string) => config().rounds.find((r) => r.key === k)?.nameEn ?? k;
  const items = [
    ...regs.map((r) => ({ at: r.at, kind: "registration", text: `${r.name} registered${r.state ? ` · ${r.state}` : ""}`, who: r.email })),
    ...starts.map((s) => ({ at: s.at, kind: "start", text: `${s.name} started ${name(s.round_key)} · chance ${s.chance_no}`, who: s.email })),
    ...subs.map((s) => ({ at: s.at, kind: s.auto_submitted ? "auto_submit" : "submit", text: `${s.name} ${s.auto_submitted ? "timed out on" : "submitted"} ${name(s.round_key)} · chance ${s.chance_no} · ${s.score}/100`, who: s.email })),
    ...audits.map((a) => ({ at: a.at, kind: "admin", text: `${a.action} · ${a.target}`, who: a.actor })),
  ];
  return items.sort((a, b) => +new Date(b.at) - +new Date(a.at)).slice(0, limit);
}
