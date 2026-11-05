/**
 * Re-score every submitted attempt with the current rules (match with CAG's Hindi + AI judge, no draft-gain gate).
 *   corepack pnpm --filter @hc/api exec tsx --env-file=../../backend/.env src/scripts/rescore.ts [--dry]
 */
import { roundOf, scoreAttempt } from "@hc/shared";
import { config, loadOverrides } from "../content.js";
import { openDb } from "../db.js";
import type { AttemptRow } from "../game.js";
import { judge } from "../judge.js";
import { loadGlossary, loadPage } from "../pages.js";

const dry = process.argv.includes("--dry");
const db = await openDb();
await loadOverrides(db);
await loadGlossary(db);
// already re-scored attempts (counts.matchPct present) are skipped unless --all
const rows = (await db.query<AttemptRow>("SELECT * FROM attempts WHERE status='submitted' ORDER BY submitted_at"))
  .filter((a) => process.argv.includes("--all") || a.result?.counts?.matchPct === undefined);
console.log(`${rows.length} submitted attempts${dry ? " (dry run)" : ""}`);
let i = 0;
async function one(a: AttemptRow) {
  const round = roundOf(config(), a.round_key);
  const { page } = (await loadPage(db, a.page_id))!;
  const limit = round.timeLimitMinutes * 60;
  const usedSeconds = a.auto_submitted ? limit : Math.min(limit, (new Date(a.submitted_at!).getTime() - new Date(a.started_at).getTime()) / 1000);
  const ai = await judge(page, a.answers);
  const res = scoreAttempt({ config: config(), round, page, answers: a.answers, usedSeconds, ai, autoSubmitted: a.auto_submitted });
  const result = { aiModel: ai?.model ?? null, counts: res.counts, weakSpots: res.weakSpots, flags: res.flags, grammar: res.grammar.map((g) => ({ code: g.code, partId: g.partId, fieldKey: g.fieldKey, text: g.text })), termChecks: res.termChecks.map((t) => ({ en: t.term.en, hi: t.term.hi, correct: t.correct, present: t.present, avoidFound: t.avoidFound })) };
  if (!dry) await db.query("UPDATE attempts SET measures=$2, score=$3, tip=$4, result=$5 WHERE id=$1", [a.id, JSON.stringify(res.measures), res.score, JSON.stringify(res.tip), JSON.stringify(result)]);
  console.log(`${++i}/${rows.length} ${a.round_key} #${a.chance_no}: ${a.score} → ${res.score} (match ${res.counts.matchPct}%, AI ${res.counts.aiPct ?? "-"}%)`);
}
const queue = [...rows];
await Promise.all(Array.from({ length: 4 }, async () => { while (queue.length) await one(queue.shift()!); }));
await db.close();
process.exit(0);
