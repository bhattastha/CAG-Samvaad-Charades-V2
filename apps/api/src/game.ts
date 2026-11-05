import { randomUUID } from "node:crypto";
import {
  canStart, choosePage, completion, normalise, reportCardLines, roundCredits, roundOf, scoreAttempt, summarise,
  type Answers, type AttemptLite, type PageData, type RoundKey, type ScoreResult,
} from "@hc/shared";
import { config, strings } from "./content.js";
import type { Db } from "./db.js";
import { env } from "./env.js";
import { loadPage, playerPage } from "./pages.js";
import { grammarTip, say, sayRound, type Said } from "./sahayika/engine.js";

export interface PlayerRow { id: string; email: string; name: string; mobile: string; office_id: string; office_address: string; registration_credits: string | number; registered_at?: string }
export interface AttemptRow {
  id: string; player_id: string; round_key: RoundKey; chance_no: number; page_id: string;
  started_at: Date; deadline_at: Date; last_saved_at: Date | null; submitted_at: Date | null; auto_submitted: boolean;
  status: "active" | "submitted"; answers: Answers; answers_version: number; active_client_id: string | null;
  left_page_count: number; paste_blocked_count: number; measures: any; score: number | null; tip: any; result: any; chat_count: number; session_id: string | null;
}

export const firstName = (n: string) => n.trim().split(/\s+/)[0] ?? n;
const graceMs = () => config().fairPlay.graceSecondsAfterDeadline * 1000;

export async function playerById(db: Db, id: string) {
  return db.one<PlayerRow>("SELECT * FROM players WHERE id=$1", [id]);
}

export async function attemptsOf(db: Db, pid: string): Promise<AttemptRow[]> {
  return db.query<AttemptRow>("SELECT * FROM attempts WHERE player_id=$1 ORDER BY round_key, chance_no", [pid]);
}
const lite = (a: AttemptRow): AttemptLite => ({ roundKey: a.round_key, chanceNo: a.chance_no, status: a.status, score: a.score, submittedAt: a.submitted_at });

export async function summaryFor(db: Db, pid: string) {
  const p = await playerById(db, pid);
  const atts = await attemptsOf(db, pid);
  return { player: p, attempts: atts, summary: summarise(config(), atts.map(lite), Number(p?.registration_credits ?? config().registration.credits)) };
}

function initialAnswers(page: PageData): Answers {
  const a: Answers = {};
  for (const p of page.parts) {
    if (!p.editable) continue;
    const fields: Record<string, string> = {};
    for (const f of p.fields) if (!f.numeric) fields[f.key] = f.draft ?? "";
    a[p.id] = { fields, done: false };
  }
  return a;
}

export class GameError extends Error {
  constructor(public status: number, public code: string) { super(code); }
}

/** §12 Start: resume any active attempt; unlocked; chances < max; pick a page; the chance is used from now. */
export async function startAttempt(db: Db, pid: string, key: RoundKey, clientId: string, sessionId?: string): Promise<AttemptRow> {
  const active = await db.one<AttemptRow>("SELECT * FROM attempts WHERE player_id=$1 AND status='active'", [pid]);
  if (active) {
    if (active.round_key !== key) throw new GameError(409, "other_round_active");
    await db.query("UPDATE attempts SET active_client_id=$2 WHERE id=$1", [active.id, clientId]);
    return { ...active, active_client_id: clientId };
  }
  const { player, attempts, summary } = await summaryFor(db, pid);
  if (!player) throw new GameError(401, "not_registered");
  const check = canStart(summary, key);
  if (!check.ok) throw new GameError(check.status, check.reason);
  const round = roundOf(config(), key);
  const all = await db.query<{ id: string; times_used: number; scope: string }>(
    `SELECT p.id, p.scope, (SELECT count(*)::int FROM attempts a WHERE a.page_id=p.id) AS times_used FROM pages p
     WHERE p.round_key=$1 AND p.active AND (p.status='published' OR ($2::boolean AND p.sample))`,
    [key, env.SEED_ALLOW_UNVERIFIED],
  );
  // office mapping: Union reports for everyone, State reports for officers of that state
  const office = await db.one<{ state: string }>("SELECT state FROM offices WHERE id=$1", [player.office_id]);
  const mapped = all.filter((p) => p.scope === "union" || p.scope.toLowerCase() === (office?.state ?? "").toLowerCase());
  const pages = mapped.length ? mapped : all;
  const chanceNo = attempts.filter((a) => a.round_key === key).length + 1;
  const used = new Set(attempts.filter((a) => a.round_key === key).map((a) => a.page_id));
  const pageId = choosePage(pages.map((p) => ({ id: p.id, timesUsed: p.times_used })), used, `${player.email}|${key}|${chanceNo}`);
  if (!pageId) throw new GameError(503, "no_pages");
  const page = (await loadPage(db, pageId))!.page;
  const now = new Date();
  const deadline = new Date(now.getTime() + round.timeLimitMinutes * 60_000);
  const id = randomUUID();
  try {
    await db.query(
      `INSERT INTO attempts (id, player_id, round_key, chance_no, page_id, started_at, deadline_at, status, answers, active_client_id, session_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'active',$8,$9,$10)`,
      [id, pid, key, chanceNo, pageId, now, deadline, JSON.stringify(initialAnswers(page)), clientId, sessionId ?? null],
    );
  } catch (e: any) {
    // unique (player, round, chance) is the backstop for double clicks and a 4th chance
    throw new GameError(409, "no_chances");
  }
  await logEvent(db, id, "start", { pageId, chanceNo });
  return (await db.one<AttemptRow>("SELECT * FROM attempts WHERE id=$1", [id]))!;
}

export async function ownAttempt(db: Db, pid: string, id: string): Promise<AttemptRow> {
  const a = await db.one<AttemptRow>("SELECT * FROM attempts WHERE id=$1 AND player_id=$2", [id, pid]);
  if (!a) throw new GameError(404, "not_found");
  return a;
}

export async function logEvent(db: Db, attemptId: string, type: string, meta?: unknown) {
  await db.query("INSERT INTO attempt_events (attempt_id, type, meta) VALUES ($1,$2,$3)", [attemptId, type, meta ? JSON.stringify(meta) : null]);
}

/** What GET /attempts/{id} returns. Never includes hiReference, sector or slip fixes. */
export async function attemptView(db: Db, a: AttemptRow, clientId?: string) {
  if (clientId && a.status === "active" && a.active_client_id !== clientId) {
    await db.query("UPDATE attempts SET active_client_id=$2 WHERE id=$1", [a.id, clientId]); // latest window takes over
    a.active_client_id = clientId;
  }
  const p = (await loadPage(db, a.page_id))!;
  const pageRow = await db.one<{ sample: boolean }>("SELECT sample FROM pages WHERE id=$1", [a.page_id]);
  const round = roundOf(config(), a.round_key);
  return {
    id: a.id,
    roundKey: a.round_key,
    chanceNo: a.chance_no,
    status: a.status,
    startedAt: a.started_at,
    deadlineAt: a.deadline_at,
    serverNow: new Date(),
    answers: a.answers,
    version: a.answers_version,
    activeClientId: a.active_client_id,
    leftPageCount: a.left_page_count,
    chatCount: a.chat_count,
    creditCap: round.creditCap,
    page: playerPage(p, !!pageRow?.sample),
  };
}

const BLOCK_TAGS = new Set(["p", "h1", "h2", "h3", "ul", "ol", "li"]);
const MARK_TAGS = new Set(["strong", "b", "em", "i", "u", "br"]);
const FORMAT_RE = /<(strong|em|u|h[1-3]|ul|ol)\b|text-align:\s*(center|right|justify)/;

/**
 * Whitelist sanitiser for the rich-text copy of a field: a handful of formatting tags, text-align on blocks and
 * the locked-number span; everything else is dropped. The HTML is only ever re-parsed by the editor's schema,
 * so this is defence in depth. Returns "" when the field has no formatting worth keeping.
 */
export function sanitiseHtml(html: unknown): string {
  if (typeof html !== "string" || !html) return "";
  const src = html.slice(0, 60_000);
  let out = "";
  let last = 0;
  for (const m of src.matchAll(/<(\/?)([a-zA-Z0-9]+)([^>]*)>/g)) {
    out += src.slice(last, m.index).replace(/</g, "&lt;");
    last = m.index! + m[0].length;
    const close = m[1] === "/";
    const tag = m[2].toLowerCase();
    if (tag === "span") {
      if (close) { out += "</span>"; continue; }
      const v = /data-locked="([^"<>]{1,40})"/.exec(m[3]);
      out += v ? `<span data-locked="${v[1]}">` : "<span>";
    } else if (BLOCK_TAGS.has(tag) || MARK_TAGS.has(tag)) {
      if (close) { out += `</${tag}>`; continue; }
      const al = BLOCK_TAGS.has(tag) ? /text-align:\s*(left|center|right|justify)/.exec(m[3]) : null;
      out += al ? `<${tag} style="text-align: ${al[1]}">` : `<${tag}>`;
    }
  }
  out += src.slice(last).replace(/</g, "&lt;");
  return FORMAT_RE.test(out) ? out : "";
}

/** Validate an answers payload against the page; re-insert locked tokens a client removed. */
export function sanitiseAnswers(page: PageData, incoming: Answers): Answers {
  const out: Answers = {};
  for (const p of page.parts) {
    if (!p.editable) continue;
    const inc = incoming?.[p.id];
    const fields: Record<string, string> = {};
    const html: Record<string, string> = {};
    for (const f of p.fields) {
      if (f.numeric) continue;
      let t = String(inc?.fields?.[f.key] ?? "").slice(0, 20_000);
      let reinserted = false;
      if (f.draft) for (const tok of f.locked) if (f.draft.includes(tok) && !t.includes(tok)) { t = (t.trimEnd() + " " + tok).trim(); reinserted = true; }
      fields[f.key] = t;
      const h = reinserted ? "" : sanitiseHtml(inc?.html?.[f.key]);
      if (h && t) html[f.key] = h;
    }
    out[p.id] = { fields, done: !!inc?.done, ...(Object.keys(html).length ? { html } : {}) };
  }
  return out;
}

export async function autosave(db: Db, a: AttemptRow, body: { version: number; clientId: string; answers: Answers }) {
  if (a.status !== "active") throw new GameError(409, "submitted");
  if (Date.now() > new Date(a.deadline_at).getTime() + graceMs()) throw new GameError(409, "deadline_passed");
  if (a.active_client_id && a.active_client_id !== body.clientId) throw new GameError(409, "other_window");
  if (body.version < a.answers_version) throw new GameError(409, "stale_version");
  const page = (await loadPage(db, a.page_id))!.page;
  const answers = sanitiseAnswers(page, body.answers);
  const r = await db.one<{ answers_version: number }>(
    "UPDATE attempts SET answers=$2, answers_version=$3, last_saved_at=now() WHERE id=$1 AND status='active' AND answers_version <= $3 RETURNING answers_version",
    [a.id, JSON.stringify(answers), body.version],
  );
  if (!r) throw new GameError(409, "stale_version");
  return { version: r.answers_version, savedAt: new Date() };
}

export async function submit(db: Db, a: AttemptRow, auto = false): Promise<AttemptRow> {
  if (a.status === "submitted") return a;
  const round = roundOf(config(), a.round_key);
  const { page } = (await loadPage(db, a.page_id))!;
  const end = auto ? new Date(a.deadline_at) : new Date(Math.min(Date.now(), new Date(a.deadline_at).getTime()));
  const limit = round.timeLimitMinutes * 60;
  const usedSeconds = auto ? limit : Math.min(limit, (end.getTime() - new Date(a.started_at).getTime()) / 1000);
  const res = scoreAttempt({ config: config(), round, page, answers: a.answers, usedSeconds });
  const result = { counts: res.counts, weakSpots: res.weakSpots, flags: res.flags, grammar: res.grammar.map((g) => ({ code: g.code, partId: g.partId, fieldKey: g.fieldKey, text: g.text })), termChecks: res.termChecks.map((t) => ({ en: t.term.en, hi: t.term.hi, correct: t.correct, present: t.present, avoidFound: t.avoidFound })) };
  const row = await db.one<AttemptRow>(
    `UPDATE attempts SET status='submitted', submitted_at=$2, auto_submitted=$3, measures=$4, score=$5, tip=$6, result=$7
     WHERE id=$1 AND status='active' RETURNING *`,
    [a.id, auto ? a.deadline_at : end, auto, JSON.stringify(res.measures), res.score, JSON.stringify(res.tip), JSON.stringify(result)],
  );
  await logEvent(db, a.id, auto ? "auto_submit" : "submit", { score: res.score });
  return row ?? (await db.one<AttemptRow>("SELECT * FROM attempts WHERE id=$1", [a.id]))!;
}

/** Server job (§12): every 30 s submit any attempt past deadline + grace, from its last autosave. */
export async function autoSubmitDue(db: Db) {
  const due = await db.query<AttemptRow>("SELECT * FROM attempts WHERE status='active' AND deadline_at < $1", [new Date(Date.now() - graceMs())]);
  for (const a of due) await submit(db, a, true);
  return due.length;
}

function tipLine(roundKey: RoundKey, tip: ScoreResult["tip"]): Said {
  const rc = strings.reportCard;
  if (tip.kind === "term") {
    const s = sayRound(roundKey, "report_card.tip_term", { en_term: tip.en, hi_term: tip.hi });
    return { id: "tip_term", spoken: true, en: s?.en ?? "", hi: rc.tipTerm.replace("{en}", tip.en).replace("{hi}", tip.hi) };
  }
  if (tip.kind === "grammar") {
    const g = grammarTip(tip.code);
    const s = sayRound(roundKey, "report_card.tip_grammar", { grammar_tip: g.en }, { grammar_tip: g.hi });
    return { id: "tip_grammar", spoken: true, en: s?.en ?? g.en, hi: rc.tipGrammar.replace("{issue}", g.hi) };
  }
  const s = sayRound(roundKey, "report_card.tip_praise");
  return { id: "tip_praise", spoken: true, en: s?.en ?? "", hi: rc.tipPraise };
}

export async function report(db: Db, a: AttemptRow) {
  if (a.status !== "submitted") throw new GameError(409, "not_submitted");
  const { player, attempts, summary } = await summaryFor(db, a.player_id);
  const r = summary.rounds.find((x) => x.key === a.round_key)!;
  const others = attempts.filter((x) => x.round_key === a.round_key && x.id !== a.id && x.status === "submitted" && x.submitted_at && new Date(x.submitted_at) < new Date(a.submitted_at!));
  const priorBest = others.length ? Math.max(...others.map((x) => x.score ?? 0)) : null;
  const firstOfRound = !others.length;
  const sel = reportCardLines({
    roundKey: a.round_key, chanceNo: a.chance_no, score: a.score ?? 0, priorBest, chancesLeft: r.chancesLeft,
    passMark: config().titlePassMark, leftCount: a.left_page_count, // rounds unlock in order, so the first time all are played is the first submission that completes the set
    firstTimeAllPlayed: summary.allPlayed && firstOfRound,
  });
  const name = firstName(player!.name);
  const vars = {
    name, score: a.score, best_score: sel.best, chance: a.chance_no, chances_left: r.chancesLeft,
    marks_short: Math.max(0, Math.round((config().titlePassMark - sel.best) * 10) / 10), credits: r.credits, total_credits: summary.totalCredits, leaves: a.left_page_count,
    old_best: priorBest ?? 0,
  };
  // one tip from the weakest stat (Sahayika script, report card part 5)
  const m = (a.measures ?? {}) as Record<string, number>;
  const stat: Record<string, number | undefined> = { translation: m.quality ?? m.translation, completion: m.completion, sentence: m.fluency ?? m.sentence, time: m.time };
  const weakest = Object.keys(stat).filter((k) => typeof stat[k] === "number").sort((x, y) => stat[x]! - stat[y]!)[0];
  if (weakest && stat[weakest]! < 0.9) sel.after.unshift(`${a.round_key}.report_card.tip_weak_${weakest}`);
  const round = roundOf(config(), a.round_key);
  const idx = config().rounds.findIndex((x) => x.key === a.round_key);
  // suggest the next step: under the Trial-first rule, retry the Trial until it is passed; then (or always,
  // when every level is open) the first playable level not yet played
  const trialGated = config().levels.unlockRule !== "all-open" && !summary.trialPassed;
  const next = trialGated ? undefined
    : config().rounds.find((x, i) => x.playable !== false && summary.rounds[i].played === 0 && summary.rounds[i].unlocked) ?? undefined;
  return {
    attemptId: a.id,
    sessionId: a.session_id,
    roundKey: a.round_key,
    roundName: round.name,
    title: round.title,
    limitMinutes: round.timeLimitMinutes,
    chanceNo: a.chance_no,
    maxChances: config().maxChancesPerRound,
    playerName: player!.name,
    score: a.score,
    autoSubmitted: a.auto_submitted,
    counts: a.result.counts,
    weakSpots: a.result.weakSpots ?? [],
    measures: a.measures,
    best: r.best,
    chances: r.chances,
    bestChance: r.bestChance,
    titleEarned: r.titleEarned,
    roundCredits: r.credits,
    creditCap: round.creditCap,
    totalCredits: summary.totalCredits,
    maxCredits: config().maxCredits,
    stars: summary.stars,
    starsTotal: summary.starsTotal,
    chancesLeft: r.chancesLeft,
    leftCount: a.left_page_count,
    announce: sel.announce.map((id) => say(id, vars)).filter(Boolean),
    titleNeeded: sel.titleEarned ? null : say(`${a.round_key}.report_card.title_needed_note`, vars),
    // report card: praise or motivation (no glossary hints here), then how to score better and what to do next
    tip: say(`${a.round_key}.report_card.${(a.score ?? 0) >= 75 ? "motivate_high" : (a.score ?? 0) >= config().titlePassMark ? "motivate_mid" : sel.titleEarned ? "motivate_held" : "motivate_low"}`, vars) ?? tipLine(a.round_key, { kind: "praise" } as ScoreResult["tip"]),
    after: [
      ...sel.after.map((id) => say(id, vars)),
      a.tip?.kind === "grammar" ? tipLine(a.round_key, a.tip) : null,
      next && sel.titleEarned ? say(`${a.round_key}.report_card.go_next`, vars) : r.chancesLeft > 0 ? say(`${a.round_key}.report_card.improve_retry`, vars) : null,
    ].filter(Boolean),
    nextRound: next ? { key: next.key, name: next.name, unlocked: true } : null,
    trialPassed: summary.trialPassed,
    trialGated,
    trialQualifyingScore: summary.trialQualifyingScore,
  };
}

/** §15.6: the player's own text with flags. Never the CAG reference. */
export async function review(db: Db, a: AttemptRow) {
  if (a.status !== "submitted") throw new GameError(409, "not_submitted");
  const p = (await loadPage(db, a.page_id))!;
  return {
    roundKey: a.round_key,
    page: playerPage(p, false),
    answers: a.answers,
    flags: a.result.flags,
    weakSpots: a.result.weakSpots ?? [],
    termChecks: a.result.termChecks.map((t: any) => ({ en: t.en, hi: t.hi, correct: t.correct })),
  };
}

/** Live counts for an attempt (used by Sahayika's submit warning and the progress bar). */
export async function progressOf(db: Db, a: AttemptRow) {
  const { page } = (await loadPage(db, a.page_id))!;
  const round = roundOf(config(), a.round_key);
  return completion(round, page, a.answers, config().scoring.minWordsPerSentence);
}

export { roundCredits, normalise };
