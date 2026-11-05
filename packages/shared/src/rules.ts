import type { GameConfig, RoundKey } from "./config.js";
import { roundCredits } from "./scoring.js";

export interface AttemptLite {
  roundKey: RoundKey;
  chanceNo: number;
  status: "active" | "submitted";
  score: number | null;
  submittedAt?: string | Date | null;
}

export interface RoundResult {
  key: RoundKey;
  name: string;
  title: string;
  creditCap: number;
  unlocked: boolean;
  chancesUsed: number;
  chancesLeft: number;
  played: number;
  best: number | null;
  /** score of every chance, in order; null = not yet submitted or not played */
  chances: (number | null)[];
  bestChance: number | null;
  titleEarned: boolean;
  playable: boolean;
  credits: number;
  active: boolean;
}

export interface Summary {
  rounds: RoundResult[];
  registrationCredits: number;
  totalCredits: number;
  stars: number;
  starsTotal: number;
  allPlayed: boolean;
  nextRound: RoundKey | null;
  trialPassed: boolean;
  trialQualifyingScore: number;
}

/** Round results are computed from attempts, never stored (§6). */
export function summarise(config: GameConfig, attempts: AttemptLite[], registrationCredits = config.registration.credits): Summary {
  const max = config.maxChancesPerRound;
  const rounds: RoundResult[] = [];
  // Trial is the mandatory entry level: passing it unlocks every other playable level, each independently.
  const qualify = config.levels.trialQualifyingScore;
  const trialBest = (() => {
    const t = attempts.filter((a) => a.roundKey === "trial" && a.status === "submitted" && a.score !== null);
    return t.length ? Math.max(...t.map((a) => a.score!)) : null;
  })();
  const trialPassed = trialBest !== null && trialBest >= qualify;
  // "all-open" (demo/review builds): every playable level is open from the start; the Trial is still suggested first.
  const allOpen = config.levels.unlockRule === "all-open";
  for (const r of config.rounds) {
    const mine = attempts.filter((a) => a.roundKey === r.key);
    const submitted = mine.filter((a) => a.status === "submitted" && a.score !== null);
    const best = submitted.length ? Math.max(...submitted.map((a) => a.score!)) : null;
    const chances: (number | null)[] = Array.from({ length: max }, (_, i) => {
      const a = mine.find((x) => x.chanceNo === i + 1);
      return a && a.status === "submitted" ? a.score : null;
    });
    const bestChance = best === null ? null : chances.findIndex((s) => s === best) + 1;
    const titleEarned = best !== null && best >= config.titlePassMark;
    const credits = best === null || (!titleEarned && !config.creditsBelowPassMark) ? 0 : roundCredits(best, r.creditCap, config.creditDecimals);
    const playable = r.playable !== false;
    rounds.push({
      key: r.key,
      name: r.name,
      title: r.title,
      creditCap: r.creditCap,
      unlocked: playable && (allOpen || r.key === "trial" || trialPassed),
      chancesUsed: mine.length,
      chancesLeft: playable ? Math.max(0, max - mine.length) : 0,
      played: submitted.length,
      best,
      chances,
      bestChance,
      titleEarned,
      credits,
      active: mine.some((a) => a.status === "active"),
      playable,
    });
  }
  const p = 10 ** config.creditDecimals;
  const totalCredits = Math.min(config.maxCredits, Math.round((registrationCredits + rounds.reduce((s, r) => s + r.credits, 0)) * p) / p);
  // until the Trial is passed, the Trial is always the next step
  const next = !trialPassed && !(allOpen && rounds[0].played > 0) ? (rounds[0].chancesLeft > 0 ? rounds[0] : undefined) : rounds.find((r) => r.unlocked && r.played === 0 && r.chancesLeft > 0);
  return {
    rounds,
    registrationCredits,
    totalCredits,
    stars: Math.min(config.stars.total, 1 + rounds.filter((r) => r.playable && r.titleEarned).length),
    starsTotal: config.stars.total,
    allPlayed: rounds.filter((r) => r.playable).every((r) => r.played > 0),
    nextRound: next?.key ?? null,
    trialPassed,
    trialQualifyingScore: qualify,
  };
}

export type StartCheck = { ok: true } | { ok: false; status: 403 | 404 | 409; reason: "locked" | "no_chances" | "coming_soon" | "unknown_round" };

export function canStart(summary: Summary, key: RoundKey): StartCheck {
  const r = summary.rounds.find((x) => x.key === key);
  if (!r) return { ok: false, status: 404, reason: "unknown_round" };
  if (!r.playable) return { ok: false, status: 403, reason: "coming_soon" };
  if (!r.unlocked) return { ok: false, status: 403, reason: "locked" };
  if (r.chancesLeft <= 0) return { ok: false, status: 409, reason: "no_chances" };
  return { ok: true };
}

/** Stable small hash (FNV-1a) used to spread players across pages. */
export function stableHash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** §12 page choice: one the player has not used (hash-spread), else the least-used. */
export function choosePage(
  pages: { id: string; timesUsed: number }[],
  usedByPlayer: Set<string>,
  seed: string,
): string | null {
  if (!pages.length) return null;
  const sorted = [...pages].sort((a, b) => a.id.localeCompare(b.id));
  const fresh = sorted.filter((p) => !usedByPlayer.has(p.id));
  if (fresh.length) return fresh[stableHash(seed) % fresh.length].id;
  return [...sorted].sort((a, b) => a.timesUsed - b.timesUsed)[0].id;
}

export interface ReportLineInput {
  roundKey: RoundKey;
  chanceNo: number;
  score: number;
  /** best before this attempt (null if none) */
  priorBest: number | null;
  chancesLeft: number;
  passMark: number;
  leftCount: number;
  firstTimeAllPlayed: boolean;
}

/** §10.3: which Sahayika lines the report card shows, in order. */
export function reportCardLines(i: ReportLineInput): { announce: string[]; after: string[]; titleEarned: boolean; best: number } {
  const p = `${i.roundKey}.report_card.`;
  const best = Math.max(i.score, i.priorBest ?? -1);
  // Sahayika script order: opening praise, the level line by best score, then the chance-2/3 comparison
  const announce: string[] = [p + "opening"];
  const titleEarned = best >= i.passMark;
  if (titleEarned) {
    announce.push(p + "title_earned_first_chance");
    if (i.score >= 75) announce.push(p + "high_score");
  } else if (i.chancesLeft > 0 && best >= 25) announce.push(p + "so_close");
  else if (i.chancesLeft > 0) announce.push(p + "below_pass_chances_left");
  else announce.push(p + "below_pass_no_chances");
  if (i.chanceNo > 1 && i.priorBest !== null) announce.push(p + (i.score > i.priorBest ? "new_best" : "not_new_best"));
  const after: string[] = [];
  if (i.roundKey === "trial") after.push(p + "typing_only_next");
  if (i.leftCount > 0) after.push(p + "left_count_note");
  if (i.firstTimeAllPlayed) after.push("pro.report_card.all_rounds_played");
  return { announce, after, titleEarned, best };
}

/** §10.1 end screen lines. */
export function totalScreenLines(summary: Summary): string[] {
  const lines = ["end.screen.total_open"];
  if (summary.rounds.every((r) => r.titleEarned)) lines.push("end.screen.all_titles_won");
  else if (summary.rounds.some((r) => !r.titleEarned && r.chancesLeft > 0)) lines.push("end.screen.titles_missing");
  else lines.push("end.screen.total_open.2");
  if (summary.rounds.some((r) => r.chancesLeft > 0)) lines.push("end.screen.replay_note");
  return lines;
}
