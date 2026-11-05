import type { GameConfig, RoundConfig } from "./config.js";
import { checkTerm, containsHindi, type TermCheck } from "./glossary.js";
import { DEPENDENT_SIGN, LATIN_WORD, normalise, numberTokens, numericCore, sentences, words } from "./text.js";
import type { Answers, Flag, PageData, Part } from "./types.js";

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/** Character n-grams with whitespace removed, as in chrF. */
function charNgrams(s: string, n: number): Map<string, number> {
  const chars = [...s.replace(/\s+/g, "")];
  const m = new Map<string, number>();
  for (let i = 0; i + n <= chars.length; i++) {
    const g = chars.slice(i, i + n).join("");
    m.set(g, (m.get(g) ?? 0) + 1);
  }
  return m;
}

/** chrF (Popović 2015): average char n-gram precision and recall over orders 1..N, then F-beta. */
export function chrF(hyp: string, ref: string, order = 6, beta = 2): number {
  const h = normalise(hyp);
  const r = normalise(ref);
  if (!h || !r) return h === r ? 1 : 0;
  let pSum = 0, rSum = 0, k = 0;
  for (let n = 1; n <= order; n++) {
    const hg = charNgrams(h, n);
    const rg = charNgrams(r, n);
    let hTot = 0, rTot = 0, match = 0;
    hg.forEach((c) => (hTot += c));
    rg.forEach((c) => (rTot += c));
    if (hTot === 0 || rTot === 0) continue;
    hg.forEach((c, g) => (match += Math.min(c, rg.get(g) ?? 0)));
    pSum += match / hTot;
    rSum += match / rTot;
    k++;
  }
  if (k === 0) return 0;
  const P = pSum / k, R = rSum / k;
  if (P + R === 0) return 0;
  const b2 = beta * beta;
  return ((1 + b2) * P * R) / (b2 * P + R);
}

export function calibrateChrF(c: number, floor: number, ceil: number): number {
  return clamp01((c - floor) / (ceil - floor));
}

// Hindi inflections and postpositions folded away so "रिपोर्टों में" ~ "रिपोर्ट" (meaning, not exact form)
const HI_SUFFIX = /(ियों|ाओं|ाएं|ाएँ|ियाँ|ियां|ओं|ों|ें|एं|ता|ती|ते|ना|नी|ने|ा|ी|े|ि|ु|ू|ं|ँ)$/u;
const HI_STOP = new Set(["का", "की", "के", "को", "में", "से", "पर", "ने", "है", "हैं", "था", "थी", "थे", "और", "तथा", "एवं", "भी", "यह", "वह", "इस", "उस", "एक", "द्वारा", "लिए", "गया", "गई", "गए", "किया", "हो", "या"]);
function stems(s: string): string[] {
  return words(s).filter((w) => !HI_STOP.has(w)).map((w) => (w.length > 3 ? w.replace(HI_SUFFIX, "") : w).toLowerCase());
}
/** Order-free content-word F-beta on stems: valid reordering or re-inflection is not penalised. */
function stemF(hyp: string, ref: string, beta = 2): number {
  const h = stems(hyp), r = stems(ref);
  if (!h.length || !r.length) return h.length === r.length ? 1 : 0;
  const rc = new Map<string, number>();
  r.forEach((w) => rc.set(w, (rc.get(w) ?? 0) + 1));
  let m = 0;
  for (const w of h) { const c = rc.get(w) ?? 0; if (c > 0) { m++; rc.set(w, c - 1); } }
  const P = m / h.length, R = m / r.length;
  if (!P || !R) return 0;
  return ((1 + beta * beta) * P * R) / (beta * beta * P + R);
}
/** Meaning-oriented similarity to CAG's published Hindi: character n-grams (chrF) blended with order-free stem overlap. */
export function similarity(hyp: string, ref: string, order = 6, beta = 2): number {
  if (!normalise(hyp)) return 0;
  return 0.6 * chrF(hyp, ref, order, beta) + 0.4 * stemF(hyp, ref, beta);
}

/** §11 समय: 1 if f ≤ share, then linear down to `atLimit` at f = 1. */
export function timeMeasure(usedSeconds: number, limitSeconds: number, share = 0.5, atLimit = 0): number {
  const f = clamp01(limitSeconds > 0 ? usedSeconds / limitSeconds : 1);
  if (f <= share) return 1;
  return 1 - ((f - share) / (1 - share)) * (1 - atLimit);
}

/** Credits per round: best × cap / 100, to `decimals` places (1 → Math.round(best × cap / 10) / 10). */
export function roundCredits(best: number, cap: number, decimals = 1): number {
  const p = 10 ** decimals;
  return Math.round((best * cap * p) / 100) / p;
}

export type GrammarCode = "latin_word" | "missing_danda" | "vowel_sign_start" | "repeated_word" | "unbalanced_bracket" | "number_missing";
export interface GrammarIssue {
  code: GrammarCode;
  partId: string;
  fieldKey: string;
  text: string;
  penalty: number;
}

/** Scoring model v2 (55 / 25 / 20). Shares are 0–1; marks = share × weight. */
export interface Measures {
  model: 2;
  /** Translation Quality share (Trial: similarity; draft rounds: gain over the BHASHINI draft) */
  quality: number;
  glossary: number;
  /** Timeliness & Completion share = completion × time (0 when the draft gain gate is not met) */
  timeliness: number;
  similarity: number;
  draftSimilarity: number | null;
  fluency: number;
  completion: number;
  time: number;
}
export interface Counts {
  qualityMarks: number;
  glossaryMarks: number;
  timelinessMarks: number;
  similarityPct: number;
  draftSimilarityPct: number | null;
  gainPct: number | null;
  /** draft rounds: Timeliness & Completion needs a quality gain ≥ the gate */
  timelinessGated: boolean;
  completionDone: number;
  completionTotal: number;
  completionUnit: "sentence" | "paragraph";
  glossaryCorrect: number;
  glossaryTotal: number;
  usedMinutes: number;
  limitMinutes: number;
}
export type Tip =
  | { kind: "term"; en: string; hi: string; wrong: string | null }
  | { kind: "grammar"; code: GrammarCode; text: string }
  | { kind: "praise" };

export interface ScoreResult {
  score: number;
  measures: Measures;
  counts: Counts;
  tip: Tip;
  termChecks: TermCheck[];
  grammar: GrammarIssue[];
  flags: Flag[];
  empty: boolean;
  /** the sentences (Trial) or parts (draft rounds) that lost the most Translation Quality marks, worst first */
  weakSpots: WeakSpot[];
}
export interface WeakSpot { partId: string; sentence: number | null; en: string; similarityPct: number; lostMarks: number }

const fieldText = (answers: Answers, part: Part, key: string) => answers[part.id]?.fields?.[key] ?? "";
const editableFields = (p: Part) => p.fields.filter((f) => !f.numeric);
const partPlayerText = (answers: Answers, p: Part) => editableFields(p).map((f) => fieldText(answers, p, f.key)).join(" ");
const partRefText = (p: Part) => editableFields(p).map((f) => f.hiReference).join(" ");
const SENTENCE_PARTS = new Set(["passage", "body", "headnote", "footnote", "annexure_ref"]);

/** Groups that count for completion: editable parts with a tick group (§6). */
export function tickGroups(parts: Part[]): Map<string, Part[]> {
  const g = new Map<string, Part[]>();
  for (const p of parts) {
    if (!p.editable || !p.tickGroup) continue;
    g.set(p.tickGroup, [...(g.get(p.tickGroup) ?? []), p]);
  }
  return g;
}

export function countFinishedSentences(text: string, minWords: number): number {
  return sentences(text).filter((s) => s.terminated && words(s.text).length >= minWords).length;
}

/** Completion counts for the live progress bar and the report card. */
export function completion(round: RoundConfig, page: PageData, answers: Answers, minWords: number) {
  if (round.completionCountedBy === "sentence") {
    const total = page.parts.reduce((n, p) => n + (p.enSentences?.length ?? 0), 0) || 1;
    const done = Math.min(total, page.parts.reduce((n, p) => n + countFinishedSentences(partPlayerText(answers, p), minWords), 0));
    return { done, total };
  }
  const groups = tickGroups(page.parts);
  let done = 0;
  groups.forEach((ps) => {
    if (ps.every((p) => answers[p.id]?.done && normalise(partPlayerText(answers, p)).length > 0)) done++;
  });
  return { done, total: groups.size };
}

function grammarIssues(round: RoundConfig, page: PageData, answers: Answers, minWords: number): GrammarIssue[] {
  const out: GrammarIssue[] = [];
  for (const p of page.parts) {
    if (!p.editable) continue;
    for (const f of editableFields(p)) {
      const text = normalise(fieldText(answers, p, f.key));
      if (!text) continue;
      const refLatin = new Set(words(f.hiReference).filter((w) => LATIN_WORD.test(w)).map((w) => w.toLowerCase()));
      const lockedWords = new Set(f.locked.flatMap((l) => words(l)));
      const ws = words(text);
      for (const w of ws) {
        if (LATIN_WORD.test(w) && !refLatin.has(w.toLowerCase()) && !lockedWords.has(w))
          out.push({ code: "latin_word", partId: p.id, fieldKey: f.key, text: w, penalty: 0.05 });
        if (DEPENDENT_SIGN.test(w)) out.push({ code: "vowel_sign_start", partId: p.id, fieldKey: f.key, text: w, penalty: 0.03 });
      }
      for (let i = 1; i < ws.length; i++)
        if (ws[i] === ws[i - 1] && !/^\d/.test(ws[i]))
          out.push({ code: "repeated_word", partId: p.id, fieldKey: f.key, text: ws[i], penalty: 0.02 });
      if (SENTENCE_PARTS.has(p.type)) {
        for (const s of sentences(text))
          if (!s.terminated && words(s.text).length >= minWords)
            out.push({ code: "missing_danda", partId: p.id, fieldKey: f.key, text: s.text.split(" ").slice(-3).join(" "), penalty: 0.05 });
      }
      const unb = Math.abs((text.match(/\(/g)?.length ?? 0) - (text.match(/\)/g)?.length ?? 0))
        + Math.abs((text.match(/\[/g)?.length ?? 0) - (text.match(/\]/g)?.length ?? 0));
      for (let i = 0; i < unb; i++) out.push({ code: "unbalanced_bracket", partId: p.id, fieldKey: f.key, text: "( )", penalty: 0.05 });
      if (round.key === "trial") {
        const have = new Set(numberTokens(text).map(numericCore));
        for (const n of new Set(numberTokens(f.en).map(numericCore)))
          if (!have.has(n)) out.push({ code: "number_missing", partId: p.id, fieldKey: f.key, text: n, penalty: 0.02 });
      }
    }
  }
  return out;
}

export interface ScoreInput {
  config: GameConfig;
  round: RoundConfig;
  page: PageData;
  answers: Answers;
  usedSeconds: number;
}

const round1 = (x: number) => Math.round(x * 10) / 10;

/** Fluency-adjusted similarity of one set of answers, length-weighted over the FULL source (untranslated parts score 0). */
function docQuality(page: PageData, answers: Answers, grammar: GrammarIssue[], sc: GameConfig["scoring"]) {
  let wSum = 0, sSum = 0, nWords = 0;
  for (const p of page.parts) {
    if (!p.editable) continue;
    const ref = partRefText(p);
    const w = normalise(ref).length;
    if (!w) continue;
    const hyp = partPlayerText(answers, p);
    nWords += words(hyp).length;
    sSum += calibrateChrF(similarity(hyp, ref, sc.chrfOrder, sc.chrfBeta), sc.chrfFloor, sc.chrfCeil) * w;
    wSum += w;
  }
  const sim = wSum ? sSum / wSum : 0;
  // light grammar/fluency check: issues per 100 words; 10 or more per 100 words → fluency 0
  const fluency = nWords ? clamp01(1 - (grammar.length / (nWords / 100)) * 0.1) : 0;
  return { sim, fluency, quality: sim * (0.9 + 0.1 * fluency) };
}

const draftAnswers = (page: PageData): Answers =>
  Object.fromEntries(page.parts.filter((p) => p.editable).map((p) => [p.id, { fields: Object.fromEntries(p.fields.filter((f) => !f.numeric).map((f) => [f.key, f.draft ?? ""])), done: false }]));

const splitSentences = (s: string) => s.split(/(?<=[।?!])\s+/u).map((x) => x.trim()).filter(Boolean);

/** Where the Translation Quality marks went: per sentence (Trial) or per part, marks lost = share of the text × (1 − similarity) × weight. */
function weakSpotsOf(round: RoundConfig, page: PageData, answers: Answers, sc: GameConfig["scoring"], weight: number, n = 3): WeakSpot[] {
  const units: { partId: string; sentence: number | null; en: string; ref: string; hyp: string }[] = [];
  for (const p of page.parts) {
    if (!p.editable) continue;
    const ref = partRefText(p), hyp = partPlayerText(answers, p);
    const enS = p.enSentences ?? [], refS = splitSentences(ref);
    if (round.completionCountedBy === "sentence" && enS.length > 1 && enS.length === refS.length) {
      const hypS = splitSentences(hyp);
      enS.forEach((en, i) => units.push({ partId: p.id, sentence: i, en, ref: refS[i]!, hyp: hypS[i] ?? "" }));
    } else units.push({ partId: p.id, sentence: null, en: p.fields.map((f) => f.en).join(" "), ref, hyp });
  }
  const total = units.reduce((t, u) => t + normalise(u.ref).length, 0) || 1;
  return units
    .map((u) => {
      const sim = calibrateChrF(similarity(u.hyp, u.ref, sc.chrfOrder, sc.chrfBeta), sc.chrfFloor, sc.chrfCeil);
      return { partId: u.partId, sentence: u.sentence, en: u.en.length > 160 ? u.en.slice(0, 157) + "…" : u.en, similarityPct: Math.round(sim * 100), lostMarks: Math.round((normalise(u.ref).length / total) * (1 - sim) * weight * 10) / 10 };
    })
    .filter((u) => u.lostMarks >= 0.5)
    .sort((a, b) => b.lostMarks - a.lostMarks)
    .slice(0, n);
}

export function scoreAttempt({ config, round, page, answers, usedSeconds }: ScoreInput): ScoreResult {
  const sc = config.scoring;
  const w = config.scoringWeights;
  const limitSeconds = round.timeLimitMinutes * 60;
  const allText = page.parts.map((p) => partPlayerText(answers, p)).join(" ");
  const empty = normalise(allText).length === 0;

  const grammar = grammarIssues(round, page, answers, sc.minWordsPerSentence);
  // CAG's own Hindi is the benchmark: issues that also occur in the reference (e.g. a heading ending in ':') are not penalised
  const refAnswers: Answers = Object.fromEntries(page.parts.filter((p) => p.editable).map((p) => [p.id, { fields: Object.fromEntries(editableFields(p).map((f) => [f.key, f.hiReference])), done: false }]));
  const refKeys = new Set(grammarIssues(round, page, refAnswers, sc.minWordsPerSentence).map((g) => `${g.code}|${g.partId}|${g.text}`));
  const own = (gs: GrammarIssue[]) => gs.filter((g) => !refKeys.has(`${g.code}|${g.partId}|${g.text}`));
  const mine = docQuality(page, answers, own(grammar), sc);
  // Primary / Secondary / Professional: marks for the improvement over the BHASHINI draft
  const hasDraft = round.bhashiniDraft && page.parts.some((p) => p.fields.some((f) => f.draft));
  let quality = mine.quality, draftSim: number | null = null, gain: number | null = null;
  if (hasDraft) {
    const da = draftAnswers(page);
    draftSim = docQuality(page, da, own(grammarIssues(round, page, da, sc.minWordsPerSentence)), sc).quality;
    gain = draftSim >= 1 ? 0 : clamp01((mine.quality - draftSim) / (1 - draftSim));
    quality = gain;
  }

  const comp = completion(round, page, answers, sc.minWordsPerSentence);
  const termChecks = page.terms.map((t) => checkTerm(allText, t));
  const glossaryCorrect = termChecks.filter((t) => t.correct).length;
  const glossary = page.terms.length ? glossaryCorrect / page.terms.length : 1;
  const tm = config.timeMarks;
  const time = timeMeasure(usedSeconds, limitSeconds, tm.fullMarksIfFinishedWithinShareOfLimit, tm.marksAtTimeLimit);
  const completionShare = comp.done / (comp.total || 1);
  const gated = gain !== null && gain < sc.draftGainGate;
  const timeliness = empty || gated ? 0 : completionShare * time;

  const measures: Measures = {
    model: 2, quality: empty ? 0 : quality, glossary: empty ? 0 : glossary, timeliness, similarity: mine.sim, draftSimilarity: draftSim,
    fluency: mine.fluency, completion: completionShare, time,
  };
  const qualityMarks = round1(measures.quality * w.translationQuality);
  const glossaryMarks = round1(measures.glossary * w.glossary);
  const timelinessMarks = round1(measures.timeliness * w.timelinessCompletion);
  const score = empty ? 0 : round1(measures.quality * w.translationQuality + measures.glossary * w.glossary + measures.timeliness * w.timelinessCompletion);

  const firstBadTerm = termChecks.find((t) => !t.correct);
  const ownGrammar = own(grammar);
  const tip: Tip = firstBadTerm
    ? { kind: "term", en: firstBadTerm.term.en, hi: firstBadTerm.term.hi, wrong: firstBadTerm.avoidFound }
    : ownGrammar[0]
      ? { kind: "grammar", code: ownGrammar[0].code, text: ownGrammar[0].text }
      : { kind: "praise" };

  return {
    weakSpots: empty ? [] : weakSpotsOf(round, page, answers, sc, w.translationQuality),
    score: Math.max(0, Math.min(config.scoreOutOf, score)),
    measures,
    counts: {
      qualityMarks, glossaryMarks, timelinessMarks,
      similarityPct: Math.round(mine.sim * 100),
      draftSimilarityPct: draftSim === null ? null : Math.round(draftSim * 100),
      gainPct: gain === null ? null : Math.round(gain * 100),
      timelinessGated: gated,
      completionDone: comp.done,
      completionTotal: comp.total,
      completionUnit: round.completionCountedBy,
      glossaryCorrect,
      glossaryTotal: page.terms.length,
      usedMinutes: Math.min(round.timeLimitMinutes, Math.round(usedSeconds / 60)),
      limitMinutes: round.timeLimitMinutes,
    },
    tip,
    termChecks,
    grammar,
    flags: buildFlags(page, answers, termChecks, grammar),
    empty,
  };
}

/** Underlines for the player's own review view (§15.6). Never includes the reference or slip fixes. */
export function buildFlags(page: PageData, answers: Answers, termChecks: TermCheck[], grammar: GrammarIssue[]): Flag[] {
  const flags: Flag[] = [];
  for (const p of page.parts) {
    for (const f of editableFields(p)) {
      const text = fieldText(answers, p, f.key);
      if (!text) continue;
      for (const tc of termChecks) {
        if (tc.avoidFound && containsHindi(text, tc.avoidFound))
          flags.push({ partId: p.id, fieldKey: f.key, text: tc.avoidFound, kind: "avoid", enTerm: tc.term.en });
      }
      for (const s of page.slips) {
        if (s.partId === p.id && containsHindi(text, s.wrongText))
          flags.push({ partId: p.id, fieldKey: f.key, text: s.wrongText, kind: "slip", enTerm: s.enTerm ?? undefined });
      }
    }
  }
  for (const g of grammar) {
    if (g.code === "latin_word" || g.code === "repeated_word" || g.code === "vowel_sign_start")
      flags.push({ partId: g.partId, fieldKey: g.fieldKey, text: g.text, kind: g.code === "latin_word" ? "latin" : "grammar" });
  }
  for (const tc of termChecks) {
    if (!tc.present) flags.push({ partId: "", fieldKey: "", text: tc.term.en, kind: "missing_term", enTerm: tc.term.en });
  }
  // de-duplicate
  const seen = new Set<string>();
  return flags.filter((f) => {
    const k = `${f.partId}|${f.fieldKey}|${f.text}|${f.kind}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
