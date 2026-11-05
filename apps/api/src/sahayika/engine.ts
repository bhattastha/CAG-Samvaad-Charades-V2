import {
  checkTerm, completion, containsHindi, fill, formatClock, matchSourceTerms, normalise, scoreAttempt, words,
  type Answers, type GameConfig, type PageData, type RoundConfig,
} from "@hc/shared";
import { line, script, strings } from "../content.js";
import { glossaryIndex, type PageExtras } from "../pages.js";
import { llm } from "../bhashini/client.js";

export interface Said { id: string; en: string; hi: string; spoken: boolean }
export type Vars = Record<string, string | number | null | undefined>;

/** Fill a script line server-side. `hiVars` overrides vars for the Hindi text (e.g. grammar_tip). */
export function say(id: string, vars: Vars = {}, hiVars: Vars = {}): Said | null {
  const l = line(id);
  if (!l) return null;
  return { id, en: fill(l.en, vars), hi: fill(l.hi, { ...vars, ...hiVars }), spoken: l.spoken };
}

/** A round's line, falling back to the primary round's when the trial script has no such moment. */
export function sayRound(round: string, rest: string, vars: Vars = {}, hiVars: Vars = {}): Said | null {
  return say(`${round}.${rest}`, vars, hiVars) ?? say(`primary.${rest}`, vars, hiVars);
}

export function grammarTip(code: string): { en: string; hi: string } {
  return strings.grammarIssues?.[code] ?? { en: "check this sentence once more.", hi: "इस वाक्य को एक बार और देखिए।" };
}

export interface ChatContext {
  config: GameConfig;
  round: RoundConfig | null;
  page: PageData | null;
  extras: PageExtras | null;
  answers: Answers;
  name: string;
  timeLeftSeconds: number | null;
  chance: number | null;
  totalCredits: number;
}

// ---------------- hint engine (no LLM) ----------------

function allText(page: PageData, answers: Answers) {
  return page.parts.flatMap((p) => p.fields.filter((f) => !f.numeric).map((f) => answers[p.id]?.fields?.[f.key] ?? "")).join(" ");
}

export function hint(ctx: ChatContext): Said {
  const { page, round } = ctx;
  const r = round!.key;
  if (!page) return sayRound(r, "chat.hint_all_good")!;
  const text = allText(page, ctx.answers);
  // 1. a planted slip or avoid form still present
  for (const s of page.slips) {
    const cur = ctx.answers[s.partId] ? Object.values(ctx.answers[s.partId].fields).join(" ") : "";
    if (containsHindi(cur, s.wrongText) && s.enTerm) return sayRound(r, "chat.hint_wrong_word", { wrong_word: s.wrongText, en_term: s.enTerm })!;
  }
  for (const t of page.terms) {
    const c = checkTerm(text, t);
    if (c.avoidFound) return sayRound(r, "chat.hint_wrong_word", { wrong_word: c.avoidFound, en_term: t.en })!;
  }
  // 2. a page term whose Hindi is missing
  for (const t of page.terms) if (!checkTerm(text, t).present) return sayRound(r, "chat.hint_missing_term", { en_term: t.en })!;
  // 3. an open grammar issue from the scorer
  const res = scoreAttempt({ config: ctx.config, round: round!, page, answers: ctx.answers, usedSeconds: 0 });
  const g = res.grammar[0];
  if (g) {
    const part = page.parts.find((p) => p.id === g.partId);
    const en = part?.fields.find((f) => f.key === g.fieldKey)?.en ?? "";
    const term = matchSourceTerms(en, glossaryIndex().byEn)[0]?.entry.en ?? words(en).slice(0, 3).join(" ");
    const said = say(`${r}.chat.hint_grammar`, { en_term: term });
    if (said) return said;
  }
  return sayRound(r, "chat.hint_all_good")!;
}

// ---------------- question routing ----------------

const has = (q: string, ...keys: string[]) => keys.some((k) => q.includes(k));
const TRANSLATE_ASK = /(translate|translation of|अनुवाद कर|अनुवाद बता|अनुवाद लिख|अनुवाद दे|हिंदी में बता|write .* in hindi)/i;
const WHOLE_UNIT = /(paragraph|para\b|sentence|passage|page|whole|line|पैराग्राफ|अनुच्छेद|वाक्य|पूरा|पेज|पंक्ति)/i;

function faqMatch(q: string, sections: string[]) {
  const qs = new Set(words(q.toLowerCase()));
  let best: { score: number; item: { q: string; en: string; hi: string } } | null = null;
  for (const s of sections)
    for (const item of script.faq[s] ?? []) {
      const fw = words(item.q.toLowerCase()).filter((w) => w.length > 2);
      if (!fw.length) continue;
      const overlap = fw.filter((w) => qs.has(w)).length / fw.length;
      if (overlap >= 0.6 && (!best || overlap > best.score)) best = { score: overlap, item };
    }
  return best?.item ?? null;
}

export type ChatAnswer = Said & { source: "rule" | "faq" | "llm" | "guard"; blocked: boolean };

export async function answer(ctx: ChatContext, quick: string | null, question: string): Promise<ChatAnswer> {
  const r = ctx.round?.key;
  if (!r) {
    const outside = say("trial.chat.opened_outside_round")!;
    const f = question ? faqMatch(question, ["before_game", "end"]) : null;
    return f ? { id: "faq", spoken: true, en: f.en, hi: f.hi, source: "faq", blocked: false } : { ...outside, source: "rule", blocked: false };
  }
  const q = normalise(question).toLowerCase();
  const kind = quick ?? (
    TRANSLATE_ASK.test(q) && WHOLE_UNIT.test(q) ? "refuse"
      : has(q, "hint", "इशारा", "संकेत", "help me", "मदद") ? "hint"
        : has(q, "score", "marks", "अंक", "स्कोर") ? "score"
          : has(q, "time", "समय", "minutes", "मिनट") ? "time"
            : has(q, "credit", "क्रेडिट") ? "credits"
              : has(q, "glossary", "शब्दावली") ? "glossary" : null);
  const ok = (s: Said | null, source: ChatAnswer["source"] = "rule"): ChatAnswer => ({ ...(s ?? sayRound(r, "chat.unknown_question")!), source, blocked: false });

  switch (kind) {
    case "refuse": {
      const s = sayRound(r, "chat.translate_refused");
      const x = strings.sahayikaExtra?.refuseTranslate;
      return { id: "refuse", spoken: true, en: s?.en ?? x.en, hi: s?.hi ?? x.hi, source: "guard", blocked: true };
    }
    case "hint": return ok(hint(ctx));
    case "score": return ok(sayRound(r, "chat.ask_score"));
    case "time": {
      const left = ctx.timeLeftSeconds ?? 0;
      const c = ctx.page ? completion(ctx.round!, ctx.page, ctx.answers, ctx.config.scoring.minWordsPerSentence) : { done: 0, total: 1 };
      const usedShare = 1 - left / (ctx.round!.timeLimitMinutes * 60);
      const behind = c.done / (c.total || 1) < usedShare - 0.1;
      const vars = { time_left: Math.max(0, Math.ceil(left / 60)), done: c.done, total: c.total };
      return ok((behind ? sayRound(r, "chat.ask_time_behind", vars) : null) ?? sayRound(r, "chat.ask_time", vars) ?? sayRound(r, "chat.ask_time", { time_left: formatClock(left) }));
    }
    case "credits": return ok(sayRound(r, "chat.ask_credits", { total_credits: ctx.totalCredits }));
    case "glossary": return ok(sayRound(r, "chat.ask_glossary"));
  }

  // a question naming a glossary term (English or Hindi) → ask_term
  const term = findTerm(question, ctx);
  if (term) {
    return ok(sayRound(r, "chat.ask_term", { en_term: term.en, hi_term: term.hi, wrong_word: term.avoid[0] ?? "—" }));
  }
  if (has(q, "hindi for", "hindi of", "in hindi", "meaning of", "का हिंदी", "मतलब")) {
    const nf = sayRound(r, "chat.term_not_found");
    if (nf) return ok(nf);
  }
  const f = faqMatch(question, [r, "before_game", "end"]);
  if (f) return { id: "faq", spoken: true, en: f.en, hi: f.hi, source: "faq", blocked: false };
  return askLlm(ctx, question);
}

function findTerm(question: string, ctx: ChatContext) {
  const pageTerms = ctx.page?.terms ?? [];
  const lower = question.toLowerCase();
  for (const t of pageTerms) if (lower.includes(t.en.toLowerCase()) || containsHindi(question, t.hi) || t.avoid.some((a) => containsHindi(question, a))) return t;
  const m = matchSourceTerms(question, glossaryIndex().allByEn);
  if (m.length) return m.sort((a, b) => b.end - b.start - (a.end - a.start))[0].entry;
  return null;
}

// ---------------- LLM with guards ----------------

export function systemPrompt(ctx: ChatContext): string {
  const r = ctx.round!.key;
  const facts = [
    ...script.chatbotRules,
    "Reply ONLY with JSON: {\"en\": \"<at most 3 short sentences>\", \"hi\": \"<same meaning in simple Hindi; you are female, use feminine verbs for yourself>\"}.",
    "General facts:", ...script.knowledge.before_game,
    `Facts for the current round (${ctx.round!.nameEn}):`, ...(script.knowledge[r] ?? []),
    "Ready answers:", ...(script.faq[r] ?? []).map((f) => `Q: ${f.q} A: ${f.en}`),
    "Glossary words for this page (English = CAG Hindi; avoid):",
    ...(ctx.page?.terms ?? []).map((t) => `${t.en} = ${t.hi}${t.avoid.length ? ` (avoid ${t.avoid.slice(0, 2).join(", ")})` : ""}`),
    "Live facts:",
    `Time left: ${formatClock(ctx.timeLeftSeconds ?? 0)}. Chance: ${ctx.chance ?? "-"} of ${ctx.config.maxChancesPerRound}. Credits so far: ${ctx.totalCredits} of ${ctx.config.maxCredits}.`,
  ];
  // Never: the page's English body, its CAG Hindi, the draft text, or the sector (§10.4).
  return facts.join("\n");
}

function runs(text: string, n = 5): Set<string> {
  const w = words(text.toLowerCase());
  const out = new Set<string>();
  for (let i = 0; i + n <= w.length; i++) out.add(w.slice(i, i + n).join(" "));
  return out;
}

/** Output guard: reject leaks of the page, its reference, its sector/report number, or a slip's fix. */
export function guard(ans: { en: string; hi: string }, page: PageData | null, sector: string): boolean {
  const out = `${ans.en} ${ans.hi}`;
  if (/report\s*(no\.?|number)\s*\d+|\b\d+\s+of\s+20\d\d\b|प्रतिवेदन\s*संख्या|प्रतिवेदन\s*सं\./i.test(out)) return false;
  if (sector && new RegExp(`\\b${sector}\\b`, "i").test(out)) return false;
  if (!page) return true;
  const srcRuns = new Set<string>();
  for (const p of page.parts) for (const f of p.fields) {
    runs(f.en).forEach((x) => srcRuns.add(x));
    runs(f.hiReference).forEach((x) => srcRuns.add(x));
    if (f.draft) runs(f.draft).forEach((x) => srcRuns.add(x));
  }
  for (const x of runs(out)) if (srcRuns.has(x)) return false;
  for (const s of page.slips) if (s.fixHint && containsHindi(out, s.fixHint) && !page.terms.some((t) => t.hi === s.fixHint)) return false;
  return true;
}

export function trimSentences(s: string, max: number) {
  const parts = s.match(/[^.!?]+[.!?]+|\S[^.!?]*$/g) ?? [s];
  return parts.slice(0, max).join(" ").trim();
}

let sectorOf: (pageId: string) => string = () => "";
export const setSectorLookup = (f: typeof sectorOf) => (sectorOf = f);

async function askLlm(ctx: ChatContext, question: string): Promise<ChatAnswer> {
  const unknown = sayRound(ctx.round!.key, "chat.unknown_question")!;
  try {
    const raw = await llm(systemPrompt(ctx), question.slice(0, 500));
    const json = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
    const a = { en: trimSentences(String(json.en ?? ""), ctx.config.sahayika.maxSpokenSentences), hi: String(json.hi ?? "") };
    if (!a.en || !a.hi) return { ...unknown, source: "llm", blocked: true };
    if (!guard(a, ctx.page, ctx.page ? sectorOf(ctx.page.id) : "")) return { ...unknown, source: "guard", blocked: true };
    return { id: "llm", spoken: true, ...a, source: "llm", blocked: false };
  } catch {
    return { ...unknown, source: "llm", blocked: false };
  }
}
