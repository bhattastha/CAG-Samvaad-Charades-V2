import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  chrF, parseGameConfig, roundCredits, roundOf, scoreAttempt, seedToPage, summarise, timeMeasure,
  reportCardLines, romanToDevanagari, findForbidden, matchSourceTerms, glossaryKey, entriesForSector, type Answers, type SeedPage, type GlossaryEntry,
} from "../src/index.js";

const root = new URL("../../../", import.meta.url);
const config = parseGameConfig(JSON.parse(readFileSync(new URL("config/game.config.json", root), "utf8")));
// Trial-first unlocking is a console option; the review build ships with every level open ("all-open")
const trialFirst = { ...config, levels: { ...config.levels, unlockRule: "trial-pass-unlocks-all" as const } };
const seed = JSON.parse(readFileSync(new URL("seed/pages/trial_r38_page_v.json", root), "utf8")) as SeedPage;
const { page } = seedToPage(seed);
const trial = roundOf(config, "trial");
const ref = page.parts[0].fields[0].hiReference;
const ans = (t: string): Answers => ({ passage: { fields: { t }, done: false } });
const run = (t: string, used = 8 * 60) => scoreAttempt({ config, round: trial, page, answers: ans(t), usedSeconds: used });

describe("§11 scorer on the seed trial passage", () => {
  it("reference vs itself → translation 1, glossary 7/7", () => {
    const r = run(ref);
    expect(r.measures.translation).toBe(1);
    expect(r.counts.glossaryCorrect).toBe(7);
    expect(r.counts.glossaryTotal).toBe(7);
    expect(r.counts.completionDone).toBe(9);
    expect(r.score).toBe(100);
  });
  it("empty → 0", () => {
    expect(run("").score).toBe(0);
    expect(run("   ‍  ").score).toBe(0);
  });
  it("विपणन → मार्केटिंग gives glossary 6/7 and a term tip", () => {
    const r = run(ref.replaceAll("विपणन", "मार्केटिंग"));
    expect(r.counts.glossaryCorrect).toBe(6);
    expect(r.tip).toMatchObject({ kind: "term", en: "marketing", hi: "विपणन", wrong: "मार्केटिंग" });
  });
  it("time fractions 0.4 / 0.75 / 1.0 → 1.0 / 0.8 / 0.6", () => {
    expect(timeMeasure(0.4 * 1200, 1200)).toBeCloseTo(1.0);
    expect(timeMeasure(0.75 * 1200, 1200)).toBeCloseTo(0.8);
    expect(timeMeasure(1.0 * 1200, 1200)).toBeCloseTo(0.6);
    expect(timeMeasure(2 * 1200, 1200)).toBeCloseTo(0.6);
  });
  it("Latin words and missing danda lower sentence construction", () => {
    const r = run("SAIL ek company hai");
    expect(r.measures.sentence).toBeLessThan(0.9);
    expect(r.grammar.some((g) => g.code === "missing_danda")).toBe(true);
  });
  it("chrF is 1 for identity and lower for a partial", () => {
    expect(chrF("कंपनी के पास", "कंपनी के पास")).toBe(1);
    expect(chrF("कंपनी", "कंपनी के पास खदानें हैं")).toBeLessThan(0.6);
  });
});

describe("credits and totals", () => {
  it("worked examples from design 14", () => {
    expect(roundCredits(84, 3)).toBe(2.5);
    expect(roundCredits(88, 5)).toBe(4.4);
    expect(roundCredits(88, 15)).toBe(13.2);
    expect(roundCredits(92, 25)).toBe(23);
    const s = summarise(config, [
      { roundKey: "trial", chanceNo: 1, status: "submitted", score: 84 },
      { roundKey: "primary", chanceNo: 1, status: "submitted", score: 60 },
      { roundKey: "primary", chanceNo: 2, status: "submitted", score: 88 },
      { roundKey: "secondary", chanceNo: 1, status: "submitted", score: 88 },
      { roundKey: "pro", chanceNo: 1, status: "submitted", score: 92 },
    ]);
    expect(s.totalCredits).toBe(45.1);
    expect(s.stars).toBe(5);
  });
  it("a lower later score never reduces credits; 4th chance refused; rounds unlock in order", () => {
    const s = summarise(trialFirst, [
      { roundKey: "trial", chanceNo: 1, status: "submitted", score: 70 },
      { roundKey: "trial", chanceNo: 2, status: "submitted", score: 20 },
      { roundKey: "trial", chanceNo: 3, status: "submitted", score: 50 },
    ]);
    const t = s.rounds[0];
    expect(t.best).toBe(70);
    expect(t.credits).toBe(2.1);
    expect(t.chancesLeft).toBe(0);
    // Trial passed (70 >= 33): Primary, Secondary and Pro all unlock independently; Varchaspati is preview-only
    expect(s.rounds.slice(1, 4).every((r) => r.unlocked)).toBe(true);
    expect(s.rounds[4].key).toBe("varchaspati");
    expect(s.rounds[4].unlocked).toBe(false);
    expect(s.trialPassed).toBe(true);
  });
  it("a Trial below the qualifying score keeps every other level locked", () => {
    const s = summarise(trialFirst, [{ roundKey: "trial", chanceNo: 1, status: "submitted", score: 20 }]);
    expect(s.trialPassed).toBe(false);
    expect(s.rounds.slice(1).some((r) => r.unlocked)).toBe(false);
    expect(s.nextRound).toBe("trial");
    const lowered = summarise({ ...trialFirst, levels: { ...trialFirst.levels, trialQualifyingScore: 15 } }, [{ roundKey: "trial", chanceNo: 1, status: "submitted", score: 20 }]);
    expect(lowered.rounds[3].unlocked).toBe(true);
  });
  it("all-open: every playable level is open from the start, Trial still suggested first", () => {
    const s = summarise(config, []);
    expect(config.levels.unlockRule).toBe("all-open");
    expect(s.rounds.slice(0, 4).every((r) => r.unlocked)).toBe(true);
    expect(s.rounds[4].unlocked).toBe(false);
    expect(s.nextRound).toBe("trial");
    const after = summarise(config, [{ roundKey: "trial", chanceNo: 1, status: "submitted", score: 10 }]);
    expect(after.nextRound).toBe("primary");
  });
  it("Secondary or Pro can be played without Primary", () => {
    const s = summarise(config, [
      { roundKey: "trial", chanceNo: 1, status: "submitted", score: 40 },
      { roundKey: "pro", chanceNo: 1, status: "submitted", score: 50 },
    ]);
    expect(s.rounds.find((r) => r.key === "secondary")!.unlocked).toBe(true);
    expect(s.totalCredits).toBe(2 + 1.2 + 12.5);
  });
  it("below 33: credits still apply, no title", () => {
    const s = summarise(config, [{ roundKey: "trial", chanceNo: 1, status: "submitted", score: 30 }]);
    expect(s.rounds[0].titleEarned).toBe(false);
    expect(s.rounds[0].credits).toBe(0.9);
    expect(s.stars).toBe(1);
  });
});

describe("report card line selection (Sahayika script)", () => {
  const base = { roundKey: "primary" as const, passMark: 33, leftCount: 0, firstTimeAllPlayed: false };
  const ids = (x: Parameters<typeof reportCardLines>[0]) => reportCardLines(x).announce.map((s) => s.replace("primary.report_card.", ""));
  it("opening line, then the level line; outstanding score adds high_score", () => {
    expect(ids({ ...base, chanceNo: 1, score: 50, priorBest: null, chancesLeft: 2 })).toEqual(["opening", "title_earned_first_chance"]);
    expect(ids({ ...base, chanceNo: 1, score: 80, priorBest: null, chancesLeft: 2 })).toEqual(["opening", "title_earned_first_chance", "high_score"]);
  });
  it("chance 2 or 3 adds new best / lower than best", () => {
    expect(ids({ ...base, chanceNo: 2, score: 60, priorBest: 40, chancesLeft: 1 })).toEqual(["opening", "title_earned_first_chance", "new_best"]);
    expect(ids({ ...base, chanceNo: 3, score: 30, priorBest: 40, chancesLeft: 0 })).toEqual(["opening", "title_earned_first_chance", "not_new_best"]);
  });
  it("so close (25-32) / under 25 / no chances", () => {
    expect(ids({ ...base, chanceNo: 1, score: 26, priorBest: null, chancesLeft: 2 })[1]).toBe("so_close");
    expect(ids({ ...base, chanceNo: 1, score: 10, priorBest: null, chancesLeft: 2 })[1]).toBe("below_pass_chances_left");
    expect(ids({ ...base, chanceNo: 3, score: 10, priorBest: 5, chancesLeft: 0 })[1]).toBe("below_pass_no_chances");
  });
});

describe("glossary matching (Anuvaad algorithm)", () => {
  const e = (en: string, hi: string, sector: string | null = null): GlossaryEntry => ({ en, hi, variants: [], avoid: [], sector });
  const idx = new Map([e("foreign exchange regulation act", "विदेशी मुद्रा विनियमन अधिनियम"), e("foreign exchange", "विदेशी मुद्रा"), e("exchange", "विनिमय"), e("F.E.-R.A.", "फेरा")].map((x) => [glossaryKey(x.en), x]));
  it("one normaliser: punctuation separates", () => {
    expect(glossaryKey("F.E.-R.A.")).toBe("f e r a");
    expect(glossaryKey("CAG’s  (DPC) Act")).toBe("cag s dpc act");
  });
  it("longest match wins and no token is matched twice", () => {
    const m = matchSourceTerms("Breach of the Foreign Exchange Regulation Act and foreign exchange, exchange.", idx);
    expect(m.map((x) => x.entry.en)).toEqual(["foreign exchange regulation act", "foreign exchange", "exchange"]);
    expect(m[0].start).toBe(14);
  });
  it("punctuated terms match when stored the same way", () => {
    expect(matchSourceTerms("under F.E.-R.A. rules", idx)[0].entry.hi).toBe("फेरा");
  });
  it("sector widens, never narrows; sector entry first", () => {
    const all = [e("staff", "कर्मचारी वर्ग"), e("staff", "कार्मिक", "Railways")];
    expect(entriesForSector(all, "Railways").map((x) => x.hi)).toEqual(["कार्मिक", "कर्मचारी वर्ग"]);
    expect(entriesForSector(all, "commercial").map((x) => x.hi)).toEqual(["कर्मचारी वर्ग"]);
  });
});

describe("helpers", () => {
  it("fallback transliteration gives Devanagari", () => {
    expect(romanToDevanagari("sarkaar")).toBe("सरकार");
    expect(romanToDevanagari("sarkar")).toBe("सरकर");
    expect(romanToDevanagari("mera")).toBe("मेरा");
    expect(romanToDevanagari("hindi")).toBe("हिंदी");
    expect(romanToDevanagari("vistaar")).toBe("विस्तार");
    expect(romanToDevanagari("pradesh")).toBe("प्रदेश");
  });
  it("forbidden scan", () => {
    expect(findForbidden("अनुवाद पथिक")).toEqual([]);
    expect(findForbidden("Become a Guru")).toEqual(["Guru"]);
    expect(findForbidden("gurudwara")).toEqual([]);
  });
});
