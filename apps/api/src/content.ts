import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseGameConfig, type GameConfig } from "@hc/shared";
import { env, ROOT } from "./env.js";
import type { Db } from "./db.js";

const readJson = (p: string) => JSON.parse(readFileSync(resolve(ROOT, p), "utf8"));

export interface ScriptLine { id: string; section: string; part: string; moment: string; when?: string; spoken: boolean; en: string; hi: string }
export interface Script {
  placeholders: string[];
  lines: ScriptLine[];
  knowledge: Record<string, string[]>;
  faq: Record<string, { q: string; en: string; hi: string }[]>;
  chatbotRules: string[];
}

export const baseConfig: GameConfig = parseGameConfig(readJson("config/game.config.json"));
/** Boot-time load. Throws (and the server refuses to start) if the config is invalid (§5). */
/** Player strings follow config.ui.locale (en by default), falling back to Hindi key-by-key. */
const hiStrings: Record<string, any> = readJson("content/strings.hi.json");
const enStrings: Record<string, any> = readJson("content/strings.en.json");
const merge = (a: any, b: any): any => (a && typeof a === "object" && !Array.isArray(a) ? Object.fromEntries([...new Set([...Object.keys(b ?? {}), ...Object.keys(a)])].map((k) => [k, merge(a[k], b?.[k])])) : a ?? b);
export const strings: Record<string, any> = baseConfig.ui.locale === "en" ? merge(enStrings, hiStrings) : hiStrings;
export const script: Script = readJson("content/sahayika.script.json");

/** Effective config = file + audited credit-cap overrides from the console. */
let effective: GameConfig = baseConfig;
export const config = () => effective;

export async function loadOverrides(db: Db) {
  const rows = await db.query<{ key: string; value: any }>("SELECT key, value FROM config_overrides");
  effective = applySettings(baseConfig, rows);
}

/** BHASHINI service IDs and models, edited in the console ("services" override). */
export interface ServicesOverride {
  translationProvider: "anuvaad" | "dhruva"; translation: string;
  transliterationProvider: "anuvaad" | "dhruva"; transliteration: string; transliterationSuggestions: number;
  tts: string; ttsGender: "female" | "male"; ttsLanguage: "en" | "hi"; ttsSamplingRate: number;
  asrHindi: string; llm: string;
}
export const ENDPOINTS = { dhruva: "https://dhruva-api.bhashini.gov.in/services/inference/pipeline", anuvaad: "https://anuvaad-backend.bhashini.co.in/v1/pipeline" };
export function servicesOf(c: GameConfig): ServicesOverride {
  const b = c.bhashiniServices;
  return {
    translationProvider: b.translationProvider, translation: b.translation,
    transliterationProvider: b.transliterationProvider, transliteration: c.transliteration.serviceId, transliterationSuggestions: c.transliteration.numSuggestions,
    tts: b.ttsEnglish, ttsGender: b.ttsGender, ttsLanguage: b.ttsLanguage, ttsSamplingRate: b.ttsSamplingRate,
    asrHindi: b.asrHindi, llm: c.sahayika.llmServiceId,
  };
}

/** Admin-console overrides on top of the file: credit caps (legacy key) and the full "settings" block. */
export interface SettingsOverride {
  rounds?: Record<string, { timeLimitMinutes?: number; creditCap?: number; pages?: number }>;
  trialQualifyingScore?: number;
  titlePassMark?: number;
  scoringWeights?: GameConfig["scoringWeights"];
  maxChancesPerRound?: number;
  unlockRule?: GameConfig["levels"]["unlockRule"];
  scoring?: Partial<Pick<GameConfig["scoring"], "chrfFloor" | "chrfCeil" | "minWordsPerSentence">>;
  avoidThreshold?: number;
}
export function applySettings(base: GameConfig, rows: { key: string; value: any }[]): GameConfig {
  const caps = rows.find((r) => r.key === "creditCaps")?.value as Record<string, number> | undefined;
  const st = rows.find((r) => r.key === "settings")?.value as SettingsOverride | undefined;
  const sv = rows.find((r) => r.key === "services")?.value as ServicesOverride | undefined;
  const next = structuredClone(base);
  if (env.DHRUVA_TTS_SERVICE_ID) next.bhashiniServices.ttsEnglish = env.DHRUVA_TTS_SERVICE_ID;
  if (sv) {
    next.bhashiniServices = { ...next.bhashiniServices, translationProvider: sv.translationProvider, translation: sv.translation, transliterationProvider: sv.transliterationProvider,
      transliteration: sv.transliteration, ttsEnglish: sv.tts, ttsGender: sv.ttsGender, ttsLanguage: sv.ttsLanguage, ttsSamplingRate: sv.ttsSamplingRate, asrHindi: sv.asrHindi };
    next.transliteration = { ...next.transliteration, serviceId: sv.transliteration, numSuggestions: sv.transliterationSuggestions };
    next.sahayika.llmServiceId = sv.llm;
  }
  next.transliteration.endpoint = ENDPOINTS[next.bhashiniServices.transliterationProvider];
  if (caps) next.rounds = next.rounds.map((r) => ({ ...r, creditCap: caps[r.key] ?? r.creditCap }));
  if (st?.rounds) next.rounds = next.rounds.map((r) => ({ ...r, ...(st.rounds![r.key] ?? {}) }));
  if (typeof st?.trialQualifyingScore === "number") next.levels.trialQualifyingScore = st.trialQualifyingScore;
  if (typeof st?.titlePassMark === "number") next.titlePassMark = st.titlePassMark;
  if (typeof st?.maxChancesPerRound === "number") next.maxChancesPerRound = st.maxChancesPerRound;
  if (st?.scoringWeights && "translationQuality" in st.scoringWeights) next.scoringWeights = st.scoringWeights; // ignore pre-v2 (five-measure) overrides
  if (st?.unlockRule) next.levels.unlockRule = st.unlockRule;
  if (st?.scoring) next.scoring = { ...next.scoring, ...st.scoring };
  if (typeof st?.avoidThreshold === "number") next.glossary.transliterationAvoidThreshold = st.avoidThreshold;
  return parseGameConfig(next); // invariants (50 credits, weights = 100) still hold
}

/** Lines as edited in the console (DB) fall back to the script file. */
const lineCache = new Map<string, ScriptLine>();
export async function loadLines(db: Db) {
  lineCache.clear();
  for (const l of script.lines) lineCache.set(l.id, l);
  const rows = await db.query<ScriptLine>("SELECT id, section, part, moment, spoken, en, hi FROM sahayika_lines");
  for (const r of rows) lineCache.set(r.id, { ...lineCache.get(r.id), ...r });
}
export const line = (id: string) => lineCache.get(id) ?? null;
export const allLines = () => [...lineCache.values()];

/** Look up a nested strings key like "reportCard.tipTerm". */
export function str(key: string): string {
  const v = key.split(".").reduce<any>((o, k) => (o ? o[k] : undefined), strings);
  return typeof v === "string" ? v : key;
}
