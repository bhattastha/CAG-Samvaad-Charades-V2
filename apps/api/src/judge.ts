import { normalise, type AiJudgement, type Answers, type PageData } from "@hc/shared";
import { env } from "./env.js";

// Claude judges the player's final Hindi against CAG's published Hindi; Opus first, Sonnet as the fallback
const MODELS: { id: string; timeoutMs: number }[] = [
  { id: "claude-opus-5-5", timeoutMs: 35_000 },
  { id: "claude-sonnet-5-5", timeoutMs: 20_000 },
];
const MAX_ITEMS = 40;
const MAX_REF_CHARS = 16_000;
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) + "…" : s);

const SYSTEM = `You are a senior Hindi translator and reviewer at the Comptroller and Auditor General of India (Rajbhasha cell).
For each item you get the English source, CAG's officially published Hindi (the benchmark) and a candidate Hindi translation written by an officer.
Score the candidate 0-100 for how well it matches the benchmark in meaning and accuracy (facts, numbers, names, audit sense), CAG's official terminology, Hindi grammar and sentence construction, and natural official-Hindi fluency.
Valid rewording, reordering or synonyms that keep the same meaning and register must NOT be penalised. Missing, wrong or untranslated content must be.
100 = as good as the benchmark; 70 = meaning fully kept with minor wording or grammar issues; 40 = partly correct; 0 = empty, unrelated or untranslated.
Reply with JSON only: {"scores":[{"id":"<item id>","score":<0-100>}]}`;

interface Item { id: string; en: string; ref: string; hyp: string; weight: number }

function itemsOf(page: PageData, answers: Answers): Item[] {
  const all: Item[] = [];
  for (const p of page.parts) {
    if (!p.editable) continue;
    const fs = p.fields.filter((f) => !f.numeric);
    const ref = fs.map((f) => f.hiReference).join(" ").trim();
    if (normalise(ref).length < 20) continue;
    const hyp = fs.map((f) => answers[p.id]?.fields?.[f.key] ?? "").join(" ").trim();
    all.push({ id: p.id, en: fs.map((f) => f.en).join(" "), ref, hyp, weight: normalise(ref).length });
  }
  // long pages: judge the largest parts (most of the text) within a fixed budget
  const picked: Item[] = [];
  let chars = 0;
  for (const it of [...all].sort((a, b) => b.weight - a.weight)) {
    if (picked.length >= MAX_ITEMS || chars >= MAX_REF_CHARS) break;
    picked.push(it);
    chars += it.ref.length;
  }
  return picked;
}

async function ask(model: string, timeoutMs: number, items: Item[]): Promise<Record<string, number>> {
  const user = items.map((it) => `### id: ${it.id}\nEnglish: ${clip(it.en, 1200)}\nCAG Hindi (benchmark): ${clip(it.ref, 1500)}\nCandidate Hindi: ${clip(it.hyp, 1800) || "(empty)"}`).join("\n\n");
  const res = await fetch(`${env.INTEGRATION_PROXY_URL}/llm/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.EMERGENT_LLM_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, max_tokens: 4000, messages: [{ role: "system", content: SYSTEM }, { role: "user", content: user }] }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`judge ${model} http ${res.status}`);
  const text: string = (await res.json())?.choices?.[0]?.message?.content ?? "";
  const start = text.indexOf("{"), end = text.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error(`judge ${model} gave no JSON: ${text.slice(0, 120)}`);
  const json = JSON.parse(text.slice(start, end + 1));
  const out: Record<string, number> = {};
  for (const s of json.scores ?? []) if (typeof s?.score === "number") out[String(s.id)] = Math.max(0, Math.min(100, s.score)) / 100;
  if (!Object.keys(out).length) throw new Error(`judge ${model} returned no scores`);
  return out;
}

/** AI judgement of the final Hindi; null when the judge is not configured or every model fails (scoring then uses the match only). */
export async function judge(page: PageData, answers: Answers): Promise<AiJudgement | null> {
  if (!env.EMERGENT_LLM_KEY) return null;
  const items = itemsOf(page, answers);
  if (!items.length) return null;
  // empty candidates are 0 without asking
  const ask4 = items.filter((it) => normalise(it.hyp));
  for (const m of MODELS) {
    try {
      const parts = ask4.length ? await ask(m.id, m.timeoutMs, ask4) : {};
      for (const it of items) parts[it.id] ??= 0;
      const w = items.reduce((t, it) => t + it.weight, 0);
      const overall = items.reduce((t, it) => t + parts[it.id]! * it.weight, 0) / w;
      return { overall, parts, model: m.id };
    } catch (e) {
      console.warn(`[judge] ${m.id} failed: ${(e as Error).message}`);
    }
  }
  return null;
}
