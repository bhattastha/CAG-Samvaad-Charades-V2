import { z } from "zod";

export const RoundKey = z.enum(["trial", "primary", "secondary", "pro", "varchaspati"]);
export type RoundKey = z.infer<typeof RoundKey>;

const RoundSchema = z.object({
  key: RoundKey,
  name: z.string().min(1),
  nameEn: z.string().min(1),
  title: z.string().min(1),
  timeLimitMinutes: z.number().positive(),
  creditCap: z.number().nonnegative(),
  bhashiniDraft: z.boolean(),
  voiceTyping: z.boolean(),
  completionCountedBy: z.enum(["sentence", "paragraph"]),
  titleEn: z.string().default(""),
  titleMeaning: z.string().default(""),
  levelLabel: z.string().default(""),
  /** false = shown in the game architecture but not yet playable (Varchaspati, Phase 2) */
  playable: z.boolean().default(true),
  /** report pages per bundle for this level (0 = Trial passage measured in words) */
  pages: z.number().int().nonnegative().default(0),
  /** true = the whole bundle is one continuous scrolling report instead of page-by-page */
  scrollMode: z.boolean().default(false),
  phase: z.string().optional(),
});
export type RoundConfig = z.infer<typeof RoundSchema>;

export const GameConfigSchema = z
  .object({
    game: z.object({ name: z.string(), nameEn: z.string(), guide: z.string(), guideEn: z.string() }),
    registration: z.object({ credits: z.number().nonnegative() }),
    rounds: z.array(RoundSchema).min(4),
    brand: z.object({ name: z.string(), short: z.string(), localized: z.record(z.string()) }).default({ name: "Samvaad Charades", short: "Samvaad", localized: {} }),
    levels: z.object({
      trialQualifyingScore: z.number().min(0).max(100).default(33),
      unlockRule: z.enum(["all-open", "trial-pass-unlocks-all"]).default("all-open"),
      trialWords: z.object({ min: z.number(), max: z.number(), sourceSection: z.string() }).default({ min: 300, max: 400, sourceSection: "Conclusion" }),
    }).default({}),
    maxCredits: z.number().positive(),
    maxChancesPerRound: z.number().int().positive(),
    bestOfChancesCounts: z.boolean(),
    titlePassMark: z.number().min(0).max(100),
    scoreOutOf: z.number().positive(),
    /** v2: Translation Quality (incl. sentence construction) 55, Glossary Usage 25, Timeliness & Completion 20 */
    scoringWeights: z.object({
      translationQuality: z.number(),
      glossary: z.number(),
      timelinessCompletion: z.number(),
    }),
    timeMarks: z.object({
      fullMarksIfFinishedWithinShareOfLimit: z.number().min(0).max(1),
      marksAtTimeLimit: z.number().min(0).max(1),
    }),
    creditDecimals: z.number().int().min(0).max(3),
    creditsBelowPassMark: z.boolean(),
    roundUnlockRule: z.string(),
    fairPlay: z.object({
      warnAtMinutesLeft: z.number(),
      warnAtMinutesLeftSecond: z.number(),
      confirmSubmitWindowSeconds: z.number(),
      autosaveIntervalSeconds: z.number(),
      graceSecondsAfterDeadline: z.number(),
    }),
    stars: z.object({ total: z.number().int() }),
    trialSentenceTerminator: z.string(),
    sahayika: z.object({
      maxSpokenSentences: z.number().int(),
      chatMaxQuestionsPerAttempt: z.number().int(),
      llmServiceId: z.string(),
      quickQuestions: z.array(z.string()),
    }),
    glossary: z.object({ transliterationAvoidThreshold: z.number() }),
    scoring: z.object({
      provider: z.enum(["local", "anuvad"]),
      anuvadTimeoutSeconds: z.number(),
      chrfOrder: z.number().int().positive(),
      chrfBeta: z.number().positive(),
      chrfFloor: z.number(),
      chrfCeil: z.number(),
      minWordsPerSentence: z.number().int(),
      /** draft rounds: Timeliness & Completion counts only when the quality gain is at least this share */
      draftGainGate: z.number().min(0).max(1).default(0.1),
    }),
    auth: z.object({ mode: z.string(), otpLength: z.number().int(), otpTtlMinutes: z.number() }),
    ui: z.object({
      locale: z.enum(["en", "hi"]).default("en"),
      translationPlugin: z.object({ enabled: z.boolean(), scriptUrl: z.string(), languages: z.array(z.string()) }).default({ enabled: false, scriptUrl: "", languages: ["hi", "en"] }),
    }).default({}),
    bhashiniServices: z.object({
      translation: z.string(), translationProvider: z.enum(["anuvaad", "dhruva"]).default("anuvaad"), asrHindi: z.string(), ttsEnglish: z.string(), ttsGender: z.enum(["female", "male"]), transliteration: z.string(),
      transliterationProvider: z.enum(["anuvaad", "dhruva"]).default("dhruva"), ttsLanguage: z.enum(["en", "hi"]).default("en"), ttsSamplingRate: z.number().int().min(8000).max(48000).default(22050),
    }).default({ translationProvider: "anuvaad", translation: "ai4bharat/indictrans-v2-all-gpu--t4", asrHindi: "ai4bharat/conformer-hi-gpu--t4", ttsEnglish: "bhashini/bodhan/indic-tts", ttsGender: "male", transliteration: "ai4bharat/indicxlit--cpu-fsv2", transliterationProvider: "dhruva", ttsLanguage: "en", ttsSamplingRate: 22050 }),
    transliteration: z.object({
      endpoint: z.string().url(),
      serviceId: z.string(),
      sourceLanguage: z.string(),
      targetLanguage: z.string(),
      targetLanguageScriptCode: z.string(),
      isSentence: z.boolean(),
      numSuggestions: z.number().int().min(1).max(8),
      minInputChars: z.number().int(),
      debounceMs: z.number().int(),
      timeoutMs: z.number().int(),
    }),
  })
  .passthrough()
  .superRefine((c, ctx) => {
    const sum = c.registration.credits + c.rounds.reduce((s, r) => s + r.creditCap, 0);
    if (Math.abs(sum - c.maxCredits) > 1e-9) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `registration.credits + Σ creditCap = ${sum}, but maxCredits = ${c.maxCredits}`,
      });
    }
    const keys = c.rounds.map((r) => r.key);
    if (keys[0] !== "trial") ctx.addIssue({ code: z.ZodIssueCode.custom, message: "the first round must be trial (mandatory entry level)" });
    if (new Set(keys).size !== keys.length) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `duplicate round keys: ${keys.join(",")}` });
    const w = c.scoringWeights;
    const ws = w.translationQuality + w.glossary + w.timelinessCompletion;
    if (Math.abs(ws - c.scoreOutOf) > 1e-9) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `scoring weights sum to ${ws}, expected ${c.scoreOutOf}` });
  });

export type GameConfig = z.infer<typeof GameConfigSchema>;

/** Throws with a readable message if the config is invalid. */
export function parseGameConfig(raw: unknown): GameConfig {
  const r = GameConfigSchema.safeParse(raw);
  if (!r.success) {
    throw new Error("Invalid game.config.json:\n" + r.error.issues.map((i) => ` - ${i.path.join(".")}: ${i.message}`).join("\n"));
  }
  return r.data;
}

/** The subset safe to expose at GET /config. */
export function publicConfig(c: GameConfig) {
  return {
    game: c.game,
    registration: c.registration,
    rounds: c.rounds,
    maxCredits: c.maxCredits,
    maxChancesPerRound: c.maxChancesPerRound,
    titlePassMark: c.titlePassMark,
    scoreOutOf: c.scoreOutOf,
    scoringWeights: c.scoringWeights,
    creditDecimals: c.creditDecimals,
    fairPlay: c.fairPlay,
    stars: c.stars,
    trialSentenceTerminator: c.trialSentenceTerminator,
    sahayika: { quickQuestions: c.sahayika.quickQuestions, chatMaxQuestionsPerAttempt: c.sahayika.chatMaxQuestionsPerAttempt },
    transliteration: { debounceMs: c.transliteration.debounceMs, numSuggestions: c.transliteration.numSuggestions },
    auth: { otpLength: c.auth.otpLength },
    scoring: { minWordsPerSentence: c.scoring.minWordsPerSentence },
    ui: c.ui,
    brand: c.brand,
    levels: { trialQualifyingScore: c.levels.trialQualifyingScore, unlockRule: c.levels.unlockRule, trialWords: c.levels.trialWords },
  };
}
export type PublicConfig = ReturnType<typeof publicConfig>;

export function roundOf(c: { rounds: RoundConfig[] }, key: string): RoundConfig {
  const r = c.rounds.find((x) => x.key === key);
  if (!r) throw new Error(`Unknown round ${key}`);
  return r;
}
