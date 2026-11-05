import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { PublicConfig } from "@hc/shared";
import { api } from "../lib/api";
import { useConfig, scriptLine, useLines, useProgress } from "../lib/queries";
import { sfx } from "../lib/sfx";
import { useToasts } from "../lib/store";
import { t, tList } from "../lib/strings";
import { Coin, Header, Page, PageTitle } from "../components/Layout";
import { SahayakGuide, VoiceControl } from "../components/Sahayika";
import { CountUp, GameButton, Medal } from "../components/Juice";
import { ObBackdrop, TranslitExplainer, ladderOf } from "../components/Onboarding";
import { TranslationEditor, type EditorHandle } from "../editor/TranslationEditor";
import { VoiceTyping } from "../editor/voice";
import { Icon } from "../components/Icon";
import { Briefing } from "../components/Briefing";
import { announce, type Line } from "../lib/voice";

interface StepDef { title: string; short: string; sub: string }
interface Spoken { id: string; en: string; hi: string }
/** Onboarding copy is spoken through the live TTS path (id "faq" skips the pre-generated-audio lookup). */
const spoken = (en: string): Spoken => ({ id: "faq", en, hi: "" });

// ---------------------------------------------------------------- step 1: mission

function ReportCard({ kind }: { kind: "en" | "hi" }) {
  const en = kind === "en";
  const widths = en ? [92, 78, 88, 62, 84, 70] : [88, 72, 92, 58, 80, 66];
  return (
    <div className={`relative w-full sm:w-36 h-36 sm:h-44 rounded-ui bg-white border shadow-card p-3 ${en ? "border-slate-200" : "border-slate-200 border-t-4 border-t-primary"}`} translate="no">
      <div className={`text-[10px] font-bold tracking-wider ${en ? "text-muted" : "text-primary-strong"}`}>{(en ? t("ob.train.mission.flowEnglish") : t("ob.train.mission.flowHindi")).toUpperCase()}</div>
      <div className="mt-2 space-y-1.5">
        {widths.map((w, i) => en
          ? <div key={i} className="h-1.5 rounded bg-slate-200" style={{ width: `${w}%` }} />
          : <motion.div key={i} className="h-1.5 rounded bg-navy-600/70" initial={{ width: 0 }} animate={{ width: [0, `${w}%`, `${w}%`, 0] }} transition={{ duration: 5, times: [0, 0.35, 0.85, 1], delay: 0.5 + i * 0.18, repeat: Infinity, repeatDelay: 0.4 }} />)}
      </div>
      <div className={`absolute bottom-2 right-3 text-3xl font-bold ${en ? "text-navy" : "text-primary-strong"}`} aria-hidden>{en ? "A" : "अ"}</div>
    </div>
  );
}

function Connector() {
  return (
    <div className="relative grid place-items-center w-10 h-10 sm:w-16 shrink-0 rotate-90 sm:rotate-0" aria-hidden>
      <svg viewBox="0 0 64 20" className="w-full h-5 text-primary"><path d="M2 10h56" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="ob-flow" /><path d="M54 4l8 6-8 6" stroke="currentColor" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
      <motion.span className="absolute top-1/2 left-0 -mt-1 w-2 h-2 rounded-full bg-gold" animate={{ x: [0, 56], opacity: [0, 1, 1, 0] }} transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }} />
    </div>
  );
}

function MissionStep() {
  const objectives = tList<{ icon: string; title: string; body: string }>("ob.train.mission.objectives");
  return (
    <>
      <p className="text-[1.04rem] leading-relaxed text-ink/85">{t("ob.train.mission.body")}</p>
      <div className="mt-5 rounded-card bg-navy-50 border border-slate-200 p-4 sm:p-5 flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2" role="img" aria-label={`${t("ob.train.mission.flowEnglish")}, ${t("ob.train.mission.flowHindi")}, ${t("ob.train.mission.flowSubmit")}`}>
        <ReportCard kind="en" />
        <Connector />
        <ReportCard kind="hi" />
        <Connector />
        <div className="relative w-full sm:w-36 h-36 sm:h-44 rounded-ui bg-white border border-success/40 shadow-card p-3 grid place-items-center text-center">
          <div>
            <motion.span className="mx-auto w-14 h-14 rounded-full bg-success text-white grid place-items-center shadow-glow" animate={{ scale: [1, 1.08, 1] }} transition={{ duration: 2.2, repeat: Infinity }}><Icon name="check" size={30} stroke={2.6} /></motion.span>
            <div className="mt-2 text-[13px] font-bold text-navy leading-tight">{t("ob.train.mission.flowSubmit")}</div>
            <div className="text-[11px] text-muted">{t("ob.train.mission.flowSubmitNote")}</div>
          </div>
        </div>
      </div>
      <ul className="mt-4 grid sm:grid-cols-3 gap-2.5">
        {objectives.map((o, i) => (
          <motion.li key={o.title} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 + i * 0.1 }} className="rounded-ui border border-slate-200 bg-white px-3 py-2.5 flex gap-2.5">
            <span className="w-8 h-8 shrink-0 rounded-md bg-navy text-white grid place-items-center"><Icon name={o.icon as any} size={16} /></span>
            <span className="text-[14px] leading-snug text-ink"><span className="block font-bold text-navy">{i + 1}. {o.title}</span>{o.body}</span>
          </motion.li>
        ))}
      </ul>
    </>
  );
}

// ---------------------------------------------------------------- step 2: score

const MEASURE_COLORS = ["bg-primary", "bg-navy-600", "bg-success", "bg-gold", "bg-sky-500"];

function ScoreStep({ cfg }: { cfg: PublicConfig }) {
  const w = cfg.scoringWeights;
  const items: [string, number][] = [
    [t("ob.train.score.measures.translation"), w.translation], [t("ob.train.score.measures.completion"), w.completion],
    [t("ob.train.score.measures.sentence"), w.sentenceConstruction], [t("ob.train.score.measures.glossary"), w.glossary], [t("ob.train.score.measures.time"), w.time],
  ];
  const out = cfg.scoreOutOf;
  const pass = cfg.titlePassMark;
  const rows = ladderOf(cfg);
  const maxW = Math.max(...items.map((x) => x[1]));
  return (
    <>
      <div className="rounded-card bg-navy text-white p-4 sm:p-5 hud-grid relative overflow-hidden">
        <div className="flex items-end justify-between gap-3">
          <div>
            <div className="kicker !text-gold-light">{t("ob.train.score.total")}</div>
            <div className="text-4xl sm:text-5xl font-extrabold tnum leading-none mt-1 whitespace-nowrap"><CountUp to={out} duration={1.4} /><span className="text-lg font-bold text-blue-100/70 ml-1">/ {out}</span></div>
          </div>
          <div className="text-right text-[13px] text-gold-light font-semibold max-w-[14rem]">{t("ob.train.score.passMark", { n: pass })}</div>
        </div>
        <div className="relative mt-5 mb-7">
          <div className="h-5 rounded-full bg-white/10 flex overflow-hidden" role="img" aria-label={items.map(([n, v]) => `${n} ${v}`).join(", ")}>
            {items.map(([n, v], i) => (
              <motion.div key={n} className={`${MEASURE_COLORS[i]} h-full border-r-2 border-navy last:border-0`} initial={{ width: 0 }} animate={{ width: `${(v / out) * 100}%` }} transition={{ delay: 0.2 + i * 0.18, duration: 0.6, ease: "easeOut" }} />
            ))}
          </div>
          <div className="absolute -translate-x-1/2 flex flex-col items-center top-4" style={{ left: `${(pass / out) * 100}%` }} aria-hidden>
            <span className="w-0.5 h-3 bg-gold-light" /><span className="text-[10px] font-bold text-gold-light tnum">{pass}</span>
          </div>
        </div>
      </div>

      <div className="mt-4 space-y-2.5">
        {items.map(([label, pts], i) => (
          <div key={label} className="grid grid-cols-[minmax(0,9.5rem)_1fr_2.5rem] sm:grid-cols-[11rem_1fr_3rem] items-center gap-3">
            <span className="font-semibold text-navy text-[14px] sm:text-[15px] leading-tight">{label}</span>
            <div className="h-3 rounded-full bg-slate-100 overflow-hidden"><motion.div className={`h-full rounded-full ${MEASURE_COLORS[i]}`} initial={{ width: 0 }} animate={{ width: `${(pts / maxW) * 100}%` }} transition={{ delay: 0.3 + i * 0.12, duration: 0.7, ease: "easeOut" }} /></div>
            <span className="font-extrabold tnum text-right text-navy text-lg"><CountUp to={pts} duration={0.9} /></span>
          </div>
        ))}
      </div>

      <div className="mt-5 pt-4 border-t border-slate-200">
        <div className="kicker mb-2">{t("ob.train.score.creditLadder")}</div>
        <div className="flex flex-wrap items-center gap-2">
          <motion.span initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.3 }} className="chip-credit text-[14px]"><Coin size={16} />{t("ob.train.score.joining")} +{cfg.registration.credits}</motion.span>
          {rows.filter((r) => !r.phase2).map((r, i) => (
            <motion.span key={r.key} initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.4 + i * 0.1 }} className="chip-credit text-[14px]">{r.name} +{r.credits}</motion.span>
          ))}
          <span className="font-extrabold text-gold-deep tnum text-lg">= {cfg.maxCredits}</span>
        </div>
      </div>

      <div className="mt-4">
        <div className="kicker mb-2">{t("ob.train.score.titles")}</div>
        <div className="grid grid-cols-5 gap-1 sm:gap-2 [&>*]:min-w-0">
          {rows.map((r, i) => (
            <motion.div key={r.key} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 + i * 0.1 }} whileHover={{ y: -3 }}
              className={`text-center rounded-ui px-1 py-2 border ${r.phase2 ? "border-dashed border-purple-300 bg-purple-50" : "border-slate-200 bg-white"}`}>
              <div className="mx-auto w-fit"><Medal k={r.key} size={48} shine={!r.phase2} /></div>
              <div className="mt-1 text-[10px] sm:text-[12px] font-bold text-navy leading-tight break-words hyphens-auto">{r.title}</div>
              {r.phase2 && <div className="mt-0.5 text-[10px] font-bold uppercase tracking-wide text-purple-700">{t("ob.train.score.phase2")}</div>}
            </motion.div>
          ))}
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------- step 3: toolkit

type Tool = "roman" | "glossary" | "voice";
const TOOL_ICON: Record<Tool, string> = { roman: "type", glossary: "book", voice: "mic" };

function RomanDemo() {
  const [text, setText] = useState("");
  const push = useToasts((s) => s.push);
  const done = /[\u0900-\u097F]/.test(text);
  const wasDone = useRef(false);
  useEffect(() => { if (done && !wasDone.current) sfx("success"); wasDone.current = done; }, [done]);
  return (
    <>
      <p className="text-[1rem] text-ink/85">{t("ob.train.toolkit.romanBody")}</p>
      <div className="mt-3"><TranslitExplainer /></div>
      <div className="mt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-lg font-extrabold text-navy flex items-center gap-2"><Icon name="keyboard" size={18} className="text-primary-strong" />{t("ob.train.toolkit.tryHeading")}</h3>
          <span className="text-[12px] font-semibold text-muted">{t("ob.train.toolkit.tryLive")}</span>
        </div>
        <p className="text-[0.98rem] text-ink/85 mt-0.5">{t("ob.train.toolkit.tryPrompt", { word: "sarkar" })}</p>
        <div className={`mt-2 rounded-ui border-2 bg-white p-3 min-h-[120px] transition ${done ? "border-success ring-4 ring-green-100" : "border-slate-300 focus-within:border-navy-600 focus-within:ring-4 focus-within:ring-blue-100"}`} translate="no">
          <TranslationEditor value={text} onChange={setText} modeOverride="roman" ariaLabel={t("ob.train.toolkit.romanPlaceholder")} placeholder={t("ob.train.toolkit.romanPlaceholder")}
            onBlocked={() => { push(t("round.copyPasteToast"), "warn"); sfx("error"); }} onXlitAccept={() => sfx("pop")} />
        </div>
        <AnimatePresence>
          {done && (
            <motion.div role="status" initial={{ opacity: 0, y: -6, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0 }}
              className="mt-2 inline-flex items-center gap-2 rounded-ui bg-green-50 border border-green-300 px-3 py-1.5 text-[0.98rem] font-bold text-green-800">
              <span className="w-5 h-5 rounded-full bg-success text-white grid place-items-center"><Icon name="check" size={13} stroke={3} /></span>{t("ob.train.toolkit.trySuccess")}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </>
  );
}

interface GlossHit { en: string; hi: string; variants: string[]; avoid: string[] }
function GlossaryDemo() {
  const [q, setQ] = useState("");
  const [dq, setDq] = useState("");
  useEffect(() => { const id = setTimeout(() => setDq(q.trim()), 250); return () => clearTimeout(id); }, [q]);
  const { data, isFetching } = useQuery({ queryKey: ["ob-glossary", dq], enabled: dq.length >= 2, staleTime: 5 * 60_000, queryFn: () => api<GlossHit[]>(`/glossary?q=${encodeURIComponent(dq)}`) });
  const hits = (data ?? []).slice(0, 5);
  return (
    <>
      <p className="text-[1rem] text-ink/85">{t("ob.train.toolkit.glossaryBody")}</p>
      <div className="relative mt-3">
        <Icon name="search" size={18} className="ob-ico" />
        <input className="input ob-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("ob.train.toolkit.glossarySearch")} aria-label={t("ob.train.toolkit.glossarySearch")} autoComplete="off" spellCheck={false} />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[13px]">
        <span className="text-muted">{t("ob.train.toolkit.glossarySuggested")}:</span>
        {tList("ob.train.toolkit.glossarySuggestions").map((s) => (
          <button key={s} type="button" onClick={() => { setQ(s); sfx("tap"); }} className="chip-plain !py-0.5 hover:border-navy-600 transition">{s}</button>
        ))}
      </div>
      <div className="mt-3 min-h-[8rem] space-y-2" aria-live="polite">
        {dq.length >= 2 && !isFetching && hits.length === 0 && <div className="text-sm text-muted">{t("ob.train.toolkit.glossaryNone")}</div>}
        {hits.map((h, i) => (
          <motion.div key={h.en} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }} className="rounded-ui border border-slate-200 bg-white px-3 py-2">
            <div className="flex flex-wrap items-baseline gap-x-3">
              <span className="font-semibold text-navy">{h.en}</span>
              <span className="text-lg font-bold text-primary-strong" lang="hi" translate="no">{h.hi}</span>
              <span className="text-[10px] font-bold uppercase tracking-wide text-success">{t("ob.train.toolkit.glossaryApproved")}</span>
            </div>
            {(h.variants.length > 0 || h.avoid.length > 0) && (
              <div className="mt-0.5 text-[13px] text-muted" lang="hi" translate="no">
                {h.variants.length > 0 && <span className="mr-3">{t("ob.train.toolkit.glossaryAlso")}: {h.variants.join(", ")}</span>}
                {h.avoid.length > 0 && <span>{t("ob.train.toolkit.glossaryAvoid")}: <s>{h.avoid.join(", ")}</s></span>}
              </div>
            )}
          </motion.div>
        ))}
      </div>
      <p className="mt-2 flex items-start gap-2 text-[13px] text-muted"><Icon name="info" size={15} className="mt-0.5 shrink-0 text-navy-600" />{t("ob.train.toolkit.glossaryInGame")}</p>
    </>
  );
}

function VoiceDemo() {
  const [text, setText] = useState("");
  const [listening, setListening] = useState(false);
  const ed = useRef<EditorHandle>(null);
  const voice = useRef<VoiceTyping | null>(null);
  const push = useToasts((s) => s.push);
  useEffect(() => () => voice.current?.stop(), []);
  const toggle = () => {
    if (listening) { voice.current?.stop(); return; }
    sfx("pop");
    voice.current = new VoiceTyping({
      onInterim: (x) => ed.current?.setInterim(x),
      onFinal: (x) => ed.current?.insertText(x, "asr"),
      onUnavailable: () => push(t("round.voiceUnavailable"), "info"),
      onState: (s) => setListening(s === "listening"),
    });
    voice.current.start();
  };
  return (
    <>
      <p className="text-[1rem] text-ink/85">{t("ob.train.toolkit.voiceBody")}</p>
      <div className="mt-3 rounded-ui border border-slate-300 bg-white p-3 min-h-[96px]" translate="no">
        <TranslationEditor ref={ed} value={text} onChange={setText} modeOverride="device" ariaLabel={t("ob.train.toolkit.voicePlaceholder")} placeholder={t("ob.train.toolkit.voicePlaceholder")}
          onBlocked={() => { push(t("round.copyPasteToast"), "warn"); sfx("error"); }} />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <GameButton variant="plain" sound={null} onClick={toggle} aria-pressed={listening} className={`btn rounded-ui px-4 py-2.5 font-bold text-white ${listening ? "bg-timer-text" : "bg-navy hover:bg-navy-700"}`}>
          <Icon name={listening ? "stop" : "mic"} size={18} /> {listening ? t("ob.train.toolkit.voiceStop") : t("ob.train.toolkit.voiceStart")}
          {listening && <span className="inline-flex gap-0.5 ml-1" aria-hidden>{[0, 1, 2].map((i) => <motion.span key={i} className="w-[3px] h-3 rounded bg-white" animate={{ scaleY: [0.4, 1, 0.5] }} transition={{ duration: 0.7, repeat: Infinity, delay: i * 0.12 }} />)}</span>}
        </GameButton>
        <span className="chip bg-primary-soft border-primary-ring/60 text-primary-strong text-[12px]">{t("ob.train.toolkit.voiceBadge")}</span>
      </div>
    </>
  );
}

function ToolkitStep({ tool, setTool }: { tool: Tool; setTool(x: Tool): void }) {
  const tools: Tool[] = ["roman", "glossary", "voice"];
  return (
    <>
      <div className="flex flex-wrap items-center gap-2 text-[13px] text-muted mb-3"><Icon name="info" size={15} className="text-navy-600" />{t("ob.train.practiceOnly")}</div>
      <div className="grid sm:grid-cols-3 gap-2.5" role="tablist" aria-label={t("ob.train.toolkitTabs")}>
        {tools.map((k) => (
          <button key={k} role="tab" id={`tool-${k}`} aria-selected={tool === k} aria-controls="tool-panel" onClick={() => { setTool(k); sfx("toggle"); }}
            className={`text-left rounded-ui border px-3 py-2.5 flex items-center gap-3 transition ${tool === k ? "border-navy bg-navy text-white shadow-card" : "border-slate-200 bg-white text-navy hover:border-navy-600"}`}>
            <span className={`w-9 h-9 shrink-0 rounded-md grid place-items-center ${tool === k ? "bg-white/15" : "bg-navy-50"}`}><Icon name={TOOL_ICON[k] as any} size={18} /></span>
            <span className="min-w-0"><span className="block font-bold text-[14px] leading-tight">{t(`ob.train.toolkit.tabs.${k}`)}</span><span className={`block text-[12px] ${tool === k ? "text-blue-100/80" : "text-muted"}`}>{t(`ob.train.toolkit.tabNotes.${k}`)}</span></span>
          </button>
        ))}
      </div>
      <div id="tool-panel" role="tabpanel" aria-labelledby={`tool-${tool}`} className="mt-4">
        <AnimatePresence mode="wait">
          <motion.div key={tool} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.18 }}>
            {tool === "roman" ? <RomanDemo /> : tool === "glossary" ? <GlossaryDemo /> : <VoiceDemo />}
          </motion.div>
        </AnimatePresence>
      </div>
    </>
  );
}

// ---------------------------------------------------------------- step 4: coach

function CoachStep() {
  const { data: scriptLines } = useLines("before_game");
  const returning = !!useProgress().data?.summary?.rounds.some((r) => r.chancesUsed > 0);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<Spoken | null>(null);
  const ask = async (question: string) => {
    if (!question.trim() || busy) return;
    setBusy(true); sfx("tap");
    try {
      const r = await api<{ en: string; hi: string }>("/sahayika/chat", { body: { question: question.trim() } });
      setAnswer(spoken(r.en || ""));
    } catch { setAnswer(spoken(t("common.error"))); }
    finally { setBusy(false); }
  };
  return (
    <>
      <SahayakGuide bob lines={[scriptLine(scriptLines, returning ? "before_game.screen.how_to_play_returning" : "before_game.screen.how_to_play_new", t("ob.train.coach.dialogue"))]} />
      <p className="mt-3 flex items-center gap-2 text-[14px] font-semibold text-navy"><Icon name="shield" size={16} className="text-success" />{t("ob.train.coach.never")}</p>
      <div className="mt-4 rounded-card border border-slate-200 bg-white p-4">
        <div className="kicker mb-2">{t("ob.train.coach.askHeading")}</div>
        <div className="flex flex-wrap gap-1.5">
          {tList("ob.train.coach.quick").map((s) => <button key={s} type="button" onClick={() => { setQ(s); ask(s); }} className="chip-plain !py-1 hover:border-navy-600 transition text-[13px]">{s}</button>)}
        </div>
        <form className="mt-2.5 flex gap-2" onSubmit={(e) => { e.preventDefault(); ask(q); }}>
          <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("ob.train.coach.askPlaceholder")} aria-label={t("ob.train.coach.askPlaceholder")} maxLength={200} />
          <GameButton type="submit" variant="blue" disabled={busy || !q.trim()}>{t("ob.train.coach.askSend")}</GameButton>
        </form>
        <div className="mt-2.5 min-h-[3rem]" aria-live="polite">
          {busy && <span className="text-sm text-muted">{t("ob.train.coach.askThinking")}</span>}
          {!busy && answer && (
            <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="rounded-ui bg-navy-50 border border-slate-200 px-3 py-2 text-[15px] text-navy flex items-start gap-2">
              <p className="flex-1 leading-relaxed">{answer.en}</p><VoiceControl line={answer} compact />
            </motion.div>
          )}
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------- contextual right panel

function Panel({ kicker, heading, children, speak }: { kicker: string; heading: string; children: React.ReactNode; speak?: string }) {
  return (
    <div className="card-dark hud-grid relative overflow-hidden p-5">
      <div className="absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r from-primary via-gold to-transparent" aria-hidden />
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0"><div className="kicker !text-gold-light">{kicker}</div><h2 className="mt-1 text-xl font-extrabold tracking-tight">{heading}</h2></div>
        {speak && <VoiceControl line={spoken(speak)} dark compact />}
      </div>
      <div className="mt-3">{children}</div>
    </div>
  );
}

function ContextPanel({ i, cfg, tool }: { i: number; cfg: PublicConfig | undefined; tool: Tool }) {
  if (i === 0) {
    const pts = tList("ob.train.mission.briefPoints");
    return (
      <Panel kicker={t("ob.train.mission.briefKicker")} heading={t("ob.train.mission.briefHeading")} speak={`${t("ob.train.mission.briefBody")} ${pts.join(". ")}.`}>
        <p className="text-blue-50/90 leading-relaxed">{t("ob.train.mission.briefBody")}</p>
        <ul className="mt-3 space-y-2">
          {pts.map((p) => <li key={p} className="flex gap-2.5 text-[15px] text-blue-50/95"><span className="mt-0.5 w-5 h-5 shrink-0 rounded-full bg-gold/25 text-gold-light grid place-items-center"><Icon name="check" size={12} stroke={2.6} /></span>{p}</li>)}
        </ul>
      </Panel>
    );
  }
  if (i === 1) {
    const keys = ["translation", "completion", "sentence", "glossary", "time"] as const;
    const w = cfg?.scoringWeights;
    const pts = w ? [w.translation, w.completion, w.sentenceConstruction, w.glossary, w.time] : [];
    return (
      <Panel kicker={t("ob.train.score.criteriaKicker")} heading={t("ob.train.score.criteriaHeading")} speak={keys.map((k) => `${t(`ob.train.score.measures.${k}`)}. ${t(`ob.train.score.criteria.${k}`)}`).join(" ")}>
        <ul className="space-y-2.5">
          {keys.map((k, n) => (
            <li key={k} className="flex gap-3">
              <span className={`mt-1.5 w-2.5 h-2.5 rounded-full shrink-0 ${MEASURE_COLORS[n]}`} aria-hidden />
              <span className="text-[14.5px] leading-snug text-blue-50/90"><span className="font-bold text-white">{t(`ob.train.score.measures.${k}`)}{pts[n] != null && <span className="text-gold-light tnum"> {"·"} {pts[n]}</span>}</span><br />{t(`ob.train.score.criteria.${k}`)}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 pt-3 border-t border-white/15 text-[13px] text-blue-100/80">{t("ob.train.score.creditsNote")}</p>
      </Panel>
    );
  }
  if (i === 2) {
    return (
      <Panel kicker={t("ob.train.toolkit.rightKicker")} heading={t("ob.train.toolkit.rightHeading")}>
        <ul className="space-y-2">
          {(["roman", "glossary", "voice"] as Tool[]).map((k) => (
            <li key={k} className={`rounded-ui border px-3 py-2.5 flex gap-3 transition ${tool === k ? "border-gold/60 bg-gold/10" : "border-white/10 bg-white/[0.04]"}`}>
              <span className="w-8 h-8 shrink-0 rounded-md bg-white/10 grid place-items-center"><Icon name={TOOL_ICON[k] as any} size={16} /></span>
              <span className="text-[14px] leading-snug text-blue-50/90"><span className="block font-bold text-white">{t(`ob.train.toolkit.tabs.${k}`)}</span>{t(`ob.train.toolkit.right${k[0]!.toUpperCase()}${k.slice(1)}`)}</span>
            </li>
          ))}
        </ul>
      </Panel>
    );
  }
  const roles = tList<{ icon: string; title: string; body: string }>("ob.train.coach.roles");
  return (
    <Panel kicker={t("ob.train.coach.rightKicker")} heading={t("ob.train.coach.rolesHeading")} speak={roles.map((r) => `${r.title}. ${r.body}`).join(" ")}>
      <ul className="space-y-2">
        {roles.map((r) => (
          <li key={r.title} className="flex gap-3 rounded-ui border border-white/10 bg-white/[0.04] px-3 py-2">
            <span className="w-8 h-8 shrink-0 rounded-md bg-gold/20 text-gold-light grid place-items-center"><Icon name={r.icon as any} size={16} /></span>
            <span className="text-[14px] leading-snug text-blue-50/90"><span className="block font-bold text-white">{r.title}</span>{r.body}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[13px] text-blue-100/80">{t("ob.train.coach.rightBody")}</p>
    </Panel>
  );
}

// ---------------------------------------------------------------- screen

/** Training ground: four short steps (mission, scoring, toolkit, guide) with a panel that follows the step. */
export function HowToPlay() {
  const nav = useNavigate();
  const { data: cfg } = useConfig();
  const steps = tList<StepDef>("ob.train.steps");
  const [i, setI] = useState(0);
  const [tool, setTool] = useState<Tool>("roman");
  const { data: lines } = useLines("before_game");
  const byId = (id: string) => lines?.find((l) => l.id === id) ?? null;
  const briefing = (lines ?? []).filter((l) => l.id.startsWith("before_game.briefing.")).sort((a, b) => a.id.localeCompare(b.id));
  const [briefOpen, setBriefOpen] = useState(false);
  useEffect(() => {
    if (!briefing.length) return;
    try { if (localStorage.getItem("hc.briefing.v1") !== "1") { localStorage.setItem("hc.briefing.v1", "1"); setBriefOpen(true); } } catch { /* ignore */ }
  }, [briefing.length]);
  // Sahayika's training lines (script M, S, T): one on each step, one per toolkit tab, a nudge after 20 s idle
  const STEP_LINE = ["m01", "s01", "t01", "t07"];
  const TOOL_LINE: Record<string, string> = { roman: "t02", glossary: "t04", voice: "t05" };
  const [coach, setCoach] = useState<Line | null>(null);
  const sayT = (k: string) => { const l = byId(`before_game.training.${k}`); if (l) { setCoach(l); announce(l); } };
  useEffect(() => {
    if (briefOpen) return;
    sayT(STEP_LINE[i]);
    const idle = i === 0 ? "m04" : i === 2 ? "t06" : null;
    const tm = idle ? window.setTimeout(() => sayT(idle), 20_000) : 0;
    return () => window.clearTimeout(tm);
  }, [i, lines, briefOpen]);
  useEffect(() => { if (i === 2 && TOOL_LINE[tool]) sayT(TOOL_LINE[tool]); }, [tool]);
  const go = (n: number) => { if (n > i) sayT(["m06", "s08", "t07"][i] ?? STEP_LINE[n]); setI(n); sfx("whoosh"); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const last = i === steps.length - 1;
  return (
    <ObBackdrop>
      <Header />
      <Page>
        <PageTitle kicker={`${t("ob.train.kicker")} · ${t("ob.train.stepOf", { n: i + 1, total: steps.length })}`} hi={steps[i]?.title ?? ""} en={steps[i]?.sub}
          right={<span className="inline-flex items-center gap-4">
            {briefing.length > 0 && <button data-testid="hear-briefing-btn" className="inline-flex items-center gap-1 text-primary-strong font-semibold hover:underline" onClick={() => setBriefOpen(true)}><Icon name="volume" size={16} /> {t("ob.briefing.hear")}</button>}
            <button className="inline-flex items-center gap-1 text-muted font-semibold hover:text-navy" onMouseEnter={() => sayT("m05")} onClick={() => nav("/rules")}>{t("ob.train.skip")} <Icon name="chevronRight" size={16} /></button>
          </span>} />
        <div className="grid lg:grid-cols-[1.4fr_1fr] gap-6 items-start">
          <div className="card p-5 sm:p-7 overflow-hidden">
            <div className="flex gap-2 mb-5" role="tablist" aria-label={t("ob.train.kicker")}>
              {steps.map((s, n) => (
                <button key={n} role="tab" aria-selected={n === i} onClick={() => go(n)} className="flex-1 group text-left">
                  <div className={`h-1.5 rounded-full transition ${n < i ? "bg-success" : n === i ? "bg-primary" : "bg-slate-200 group-hover:bg-slate-300"}`} />
                  <div className={`mt-1.5 text-xs font-bold ${n === i ? "text-navy" : "text-muted"}`}><span className="tnum">{String(n + 1).padStart(2, "0")}</span><span className="hidden sm:inline"> {"·"} {s.short}</span></div>
                </button>
              ))}
            </div>
            <AnimatePresence mode="wait">
              <motion.div key={i} initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} transition={{ duration: 0.22, ease: "easeOut" }}>
                {i === 0 ? <MissionStep /> : i === 1 ? (cfg ? <ScoreStep cfg={cfg} /> : null) : i === 2 ? <ToolkitStep tool={tool} setTool={setTool} /> : <CoachStep />}
              </motion.div>
            </AnimatePresence>
            <div className="mt-6 pt-4 border-t border-slate-200 flex justify-between gap-3">
              <GameButton variant="ghost" disabled={i === 0} onClick={() => go(i - 1)}><Icon name="chevronLeft" size={18} /> {t("common.back")}</GameButton>
              {last ? <GameButton sound="success" onClick={() => nav("/rules")}>{t("ob.train.finish")} <Icon name="check" size={18} /></GameButton>
                : <GameButton onClick={() => go(i + 1)}>{t("common.next")} <Icon name="arrowRight" size={18} /></GameButton>}
            </div>
          </div>
          <div className="lg:sticky lg:top-24 space-y-4">
            {coach && <SahayakGuide lines={[coach]} figure={false} />}
            <AnimatePresence mode="wait">
              <motion.div key={i} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2 }}>
                <ContextPanel i={i} cfg={cfg} tool={tool} />
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </Page>
      <Briefing lines={briefing} open={briefOpen} onClose={() => setBriefOpen(false)} />
    </ObBackdrop>
  );
}
