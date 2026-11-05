import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useConfig, useLines } from "../lib/queries";
import { fill } from "@hc/shared";
import { sfx } from "../lib/sfx";
import { lineText, t } from "../lib/strings";
import { announce, type Line } from "../lib/voice";
import { Coin, Header, Page, PageTitle, ProgressBar, Spinner, Stars } from "../components/Layout";
import { SahayikaLine, SahayikaPanel } from "../components/Sahayika";
import { Ambient, Burst, CountUp, GameButton, Medal, Stamp } from "../components/Juice";
import { Icon } from "../components/Icon";

export interface ReportData {
  attemptId: string; roundKey: string; roundName: string; title: string; limitMinutes: number; chanceNo: number; maxChances: number;
  playerName: string; score: number; autoSubmitted: boolean;
  counts: {
    qualityMarks?: number; glossaryMarks?: number; timelinessMarks?: number; gainPct?: number | null; timelinessGated?: boolean;
    completionDone: number; completionTotal: number; completionUnit: "sentence" | "paragraph"; glossaryCorrect: number; glossaryTotal: number; usedMinutes: number; limitMinutes: number;
  };
  /** model 2 = 55/25/20; older attempts keep their five legacy measures */
  measures: { model?: 2; quality?: number; timeliness?: number; glossary: number; completion: number; time: number; translation?: number };
  best: number; chances: (number | null)[]; bestChance: number | null; titleEarned: boolean; roundCredits: number; totalCredits: number; maxCredits: number;
  stars: number; starsTotal: number; chancesLeft: number; leftCount: number;
  announce: Line[]; titleNeeded: Line | null; tip: Line; after: Line[];
  nextRound: { key: string; name: string; unlocked: boolean } | null;
  trialPassed: boolean;
  /** the Trial-first rule is on and the Trial is not yet passed */
  trialGated?: boolean;
  trialQualifyingScore: number;
  sessionId: string | null;
}

type Phase = "stamp" | "scoring" | "card";

/** Copy may end in a text arrow; the button already carries an arrow icon. */
const noArrow = (s: string) => s.replace(/\s*\u2192\s*$/, "");

/** The three scoring measures (55 / 25 / 20) with their marks. */
function bars(r: ReportData, w: { translationQuality: number; glossary: number; timelinessCompletion: number }) {
  const c = r.counts;
  const m = r.measures;
  const v2 = m.model === 2;
  const q = v2 ? m.quality ?? 0 : m.translation ?? 0;
  const tc = v2 ? m.timeliness ?? 0 : m.completion * m.time;
  const marks = (n: number | undefined, share: number, max: number) => t("reportCard.marksOf", { n: n ?? Math.round(share * max * 10) / 10, max });
  const done = c.completionUnit === "sentence" ? t("reportCard.sentencesOf", { n: c.completionDone, total: c.completionTotal }) : t("reportCard.paragraphsOf", { n: c.completionDone, total: c.completionTotal });
  return [
    ["type", t("reportCard.measureQuality"), t("reportCard.measureQualitySub"), q, marks(c.qualityMarks, q, w.translationQuality), "bg-primary"],
    ["book", t("reportCard.measureGlossary"), `${t("reportCard.measureGlossarySub")} · ${t("reportCard.wordsOf", { n: c.glossaryCorrect, total: c.glossaryTotal })}`, m.glossary, marks(c.glossaryMarks, m.glossary, w.glossary), "bg-gold"],
    ["clock", t("reportCard.measureTimeliness"), c.timelinessGated ? t("reportCard.timelinessGated") : `${done} · ${t("reportCard.timeMin", { used: c.usedMinutes, limit: c.limitMinutes })}`, tc, marks(c.timelinessMarks, tc, w.timelinessCompletion), "bg-sky-500"],
  ] as const;
}

/** Interstitial: the stamp, then the "scoring machine" filling the five stats one by one. */
function Interstitial({ r, phase, onNext, roundLabel }: { r: ReportData; phase: Phase; onNext(): void; roundLabel: string }) {
  const w = useWeights();
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (phase === "stamp") { sfx(r.autoSubmitted ? "warn" : "success"); const tm = setTimeout(onNext, 1700); return () => clearTimeout(tm); }
    if (phase === "scoring") {
      if (shown < 3) { const tm = setTimeout(() => { setShown(shown + 1); sfx("tick"); }, 450); return () => clearTimeout(tm); }
      const tm = setTimeout(onNext, 900);
      return () => clearTimeout(tm);
    }
  }, [phase, shown]);
  return (
    <div className="fixed inset-0 z-[90] card-dark hud-grid !rounded-none !border-0 text-white grid place-items-center p-6" onClick={onNext} role="status" aria-live="polite">
      <Ambient density={12} />
      <AnimatePresence mode="wait">
        {phase === "stamp" ? (
          <motion.div key="stamp" exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.25 }} className="text-center">
            <Stamp text={r.autoSubmitted ? t("complete.timeUp") : t("complete.missionComplete")} tone={r.autoSubmitted ? "warn" : "good"} />
            <div className="mt-6 kicker text-gold-light">{roundLabel}</div>
          </motion.div>
        ) : (
          <motion.div key="scoring" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }} className="w-full max-w-lg card-dark p-6">
            <div className="text-center kicker text-gold-light">{t("complete.measuring")}</div>
            <div className="mt-2 text-center text-lg font-semibold">{t("complete.scoring")}</div>
            <div className="mt-6 space-y-3">
              {bars(r, w).map(([ic, label, , v, count, c], i) => (
                <motion.div key={label} initial={{ opacity: 0, x: -8 }} animate={i < shown ? { opacity: 1, x: 0 } : { opacity: 0.3, x: 0 }} transition={{ duration: 0.25 }} className="grid grid-cols-[2rem_7rem_1fr_8.5rem] items-center gap-3">
                  <span className="grid place-items-center w-8 h-8 rounded-ui bg-white/10 border border-white/10 text-gold-light"><Icon name={ic} size={16} /></span><span className="font-bold">{label}</span>
                  <div className="h-2 rounded-full bg-white/15 overflow-hidden"><motion.div className={`h-full rounded-full ${c}`} initial={{ width: 0 }} animate={{ width: i < shown ? `${v * 100}%` : 0 }} transition={{ duration: 0.5, ease: "easeOut" }} /></div>
                  <span className="text-right font-extrabold tnum">{i < shown ? count : "…"}</span>
                </motion.div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <button className="absolute bottom-6 right-6 inline-flex items-center gap-1.5 rounded-ui border border-white/20 bg-white/5 px-3 py-1.5 text-white/80 font-semibold hover:bg-white/10" onClick={(e) => { e.stopPropagation(); onNext(); }}>{t("common.skip")} <Icon name="chevronRight" size={15} /></button>
    </div>
  );
}

/** §7.7 Report card — designs 06, 09, 11, 13. */
const W0 = { translationQuality: 55, glossary: 25, timelinessCompletion: 20 };
const useWeights = () => useConfig().data?.scoringWeights ?? W0;

export function Report() {
  const w = useWeights();
  const { id = "" } = useParams();
  const [sp, setSp] = useSearchParams();
  const nav = useNavigate();
  const { data: cfg } = useConfig();
  const { data: r } = useQuery({ queryKey: ["report", id], queryFn: () => api<ReportData>(`/attempts/${id}/report`) });
  const { data: roundLines } = useLines(r?.roundKey ?? "trial");
  const sayBtn = (moment: string, vars: Record<string, string | number> = {}) => {
    const l = roundLines?.find((x) => x.id === `${r?.roundKey}.report_card.${moment}`);
    if (l) announce({ ...l, en: fill(l.en, vars), hi: fill(l.hi, vars) });
  };
  // the mission-complete sequence plays once per attempt (not again on Back / refresh)
  const seenKey = `hc.fx.${id}`;
  const seen = (() => { try { return sessionStorage.getItem(seenKey) === "1"; } catch { return false; } })();
  const [phase, setPhase] = useState<Phase>(sp.get("fx") && !seen ? "stamp" : "card");
  const [burst, setBurst] = useState(0);
  useEffect(() => {
    if (phase !== "card" || !r) return;
    try { sessionStorage.setItem(seenKey, "1"); } catch { /* ignore */ }
    if (sp.get("fx")) setSp({}, { replace: true });
    if (r.titleEarned) { const tm = setTimeout(() => { setBurst(1); sfx("fanfare"); }, 700); return () => clearTimeout(tm); }
    sfx("coin");
  }, [phase, r]);
  if (!r) return <><Header /><Spinner /></>;
  const round = cfg?.rounds.find((x) => x.key === r.roundKey);
  if (phase !== "card") return <Interstitial r={r} phase={phase} roundLabel={round ? `${round.nameEn} Round` : ""} onNext={() => setPhase(phase === "stamp" ? "scoring" : "card")} />;

  const next = r.nextRound ? cfg?.rounds.find((x) => x.key === r.nextRound!.key) : null;
  const titleLine = r.announce[0];
  const restLines = r.announce.slice(2);
  return (
    <>
      <Header />
      <Burst fire={burst} count={48} spread={360} />
      <Page>
        <PageTitle kicker={round?.levelLabel} hi={t("reportCard.heading", { roundName: round ? `${round.nameEn} Round` : r.roundName })} en={t("reportCard.headingEn")}
          right={<span className="chip-plain text-base">{t("common.chanceOf", { n: r.chanceNo, max: r.maxChances })}</span>} />
        <div className="grid lg:grid-cols-[1fr_1.35fr] gap-6">
          <SahayikaPanel lines={[titleLine, ...restLines]} title={t("reportCard.sahayikaAnnounces")}>
            {r.titleEarned ? (
              <motion.div initial={{ scale: 0.92, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 260, damping: 24, delay: 0.6 }}
                className="flex items-center gap-4 rounded-card bg-white/[0.07] border border-gold/40 p-4">
                <Medal k={r.roundKey} size={96} sweep />
                <div>
                  <div className="kicker text-gold-light">{t("complete.titleUnlocked")}</div>
                  <div className="text-3xl font-extrabold tracking-tight">{round?.titleEn ?? r.title}</div>
                  <div className="text-blue-100">{round?.titleMeaning}</div>
                </div>
              </motion.div>
            ) : (
              <div className="rounded-card bg-white/[0.07] border border-white/15 text-center py-4 px-3 flex items-center gap-3"><Medal k={r.roundKey} size={48} locked /><span className="text-left">{lineText(r.titleNeeded)}</span></div>
            )}
            <div className="flex items-center justify-between gap-3">
              <motion.span initial={{ y: 8, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.9, duration: 0.3 }}
                className="inline-flex items-center gap-2 rounded-ui text-navy-900 px-4 py-2 text-xl font-extrabold tnum shadow-gold" style={{ background: "linear-gradient(180deg, #E9D7A6, #C49B3D)" }}>
                <Coin size={24} /> +<CountUp to={r.roundCredits} decimals={1} />
              </motion.span>
              <span className="text-lg font-bold tnum">{t("reportCard.runningTotal", { n: r.totalCredits })}</span>
            </div>
            <div className="flex items-center justify-between"><Stars n={r.stars} total={r.starsTotal} size={34} animate /><span className="text-sm text-blue-100">{t("reportCard.starsLabel")}</span></div>
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.4, duration: 0.3 }} className="mt-auto rounded-card bg-white text-navy p-4 flex items-center gap-3 shadow-card border-l-4 border-l-primary">
              <Medal k={!r.titleEarned ? r.roundKey : next?.key ?? r.roundKey} size={52} locked={!r.titleEarned || !!next} />
              <div className="flex-1">
                <div className="kicker flex items-center gap-1.5"><Icon name="target" size={13} /> {t("reportCard.nextGoal")}</div>
                <div className="font-bold leading-snug">
                  {r.roundKey === "trial" && r.trialGated ? t("reportCard.goalTrial", { n: Math.max(0, r.trialQualifyingScore - r.best) })
                    : !r.titleEarned ? t("reportCard.goalTitle", { n: Math.max(0, (cfg?.titlePassMark ?? 33) - r.best), title: round?.titleEn ?? r.title })
                      : next ? t("reportCard.goalNext", { title: next.titleEn, round: `${next.nameEn} Round` }) : t("reportCard.goalDone")}
                </div>
              </div>
            </motion.div>
          </SahayikaPanel>

          <motion.section initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="card p-5 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="text-2xl font-bold text-navy">{r.playerName}</div>
                <div className="text-muted">{round ? `${round.nameEn} Round` : r.roundName} · {r.limitMinutes} min · {t("common.chanceOf", { n: r.chanceNo, max: r.maxChances })}</div>
                {r.autoSubmitted && <div className="text-sm text-timer-text font-semibold mt-1 inline-flex items-center gap-1.5"><Icon name="clock" size={15} /> {t("reportCard.autoSubmitted")}</div>}
                {r.roundKey === "trial" && r.trialPassed && r.trialGated === false && cfg?.levels?.unlockRule !== "all-open" && <div className="text-sm text-success font-bold mt-1 flex items-center gap-1.5"><Icon name="unlock" size={15} /> {t("reportCard.trialUnlocked")}</div>}
                {r.sessionId && <div className="text-[11px] text-muted mt-1">{t("reportCard.sessionId")}: <span className="font-mono">{r.sessionId.slice(0, 8)}</span></div>}
              </div>
              <motion.div initial={{ scale: 0.94, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 280, damping: 24 }}
                className="relative rounded-card bg-navy-50 border border-slate-200 border-t-4 border-t-primary px-6 py-3 text-center">
                {r.chanceNo === r.bestChance && r.chanceNo > 1 && <span className="absolute -top-3 -right-3 rounded-md bg-gold text-navy-900 text-xs font-extrabold uppercase tracking-wider px-2 py-0.5 shadow-gold">{t("complete.newBest")}</span>}
                <div className="text-6xl font-extrabold text-navy tnum leading-none tracking-tight"><CountUp to={r.score} onTick={() => sfx("tick")} /><span className="text-xl text-muted"> / 100</span></div>
                <div className="text-sm font-semibold text-primary-strong mt-1">{t("reportCard.thisTime")}</div>
              </motion.div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {r.chances.map((s, i) => (
                <span key={i} className={`chip ${i + 1 === r.chanceNo ? "bg-primary-soft border-primary-ring text-primary-strong" : "bg-white border-slate-200 text-navy"} tnum`}>
                  {s === null ? t("reportCard.chancePending", { n: i + 1 }) : t("reportCard.chanceScore", { n: i + 1, score: s })}
                  {r.bestChance === i + 1 && <span className="text-gold" title={t("reportCard.bestStar")} aria-label={t("reportCard.bestStar")}><Icon name="star" size={14} fill /></span>}
                </span>
              ))}
            </div>
            <h3 className="mt-6 pt-4 border-t border-slate-200 text-lg font-bold text-navy">{t("reportCard.howYouDid")}</h3>
            <div className="mt-2 space-y-3">
              {bars(r, w).map(([ic, hi, sub, v, count], i) => (
                <motion.div key={hi} initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.3 + i * 0.08, duration: 0.3 }} className="grid grid-cols-[1.75rem_7.5rem_1fr_auto] sm:grid-cols-[1.75rem_10rem_1fr_9rem] items-center gap-3">
                  <span aria-hidden className="grid place-items-center w-7 h-7 rounded-ui bg-navy-50 border border-slate-200 text-navy-600"><Icon name={ic} size={15} /></span>
                  <div><div className="font-semibold text-navy">{hi}</div><div className="text-xs text-muted">{sub}</div></div>
                  <ProgressBar value={v} tone={i === 2 ? "orange" : "blue"} label={hi} />
                  <div className="text-right font-semibold tnum text-navy">{count}</div>
                </motion.div>
              ))}
            </div>
            <div className="mt-5 space-y-2">
              <SahayikaLine line={r.tip} />
              {r.after.map((l) => <div key={l.id} className="text-[0.95rem] text-muted flex items-start gap-2"><Icon name="info" size={16} className="mt-0.5 text-navy-600" /> {lineText(l)}</div>)}
            </div>
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <Link to={`/review/${r.attemptId}`} onClick={() => sayBtn("btn_review")} data-testid="report-review-link" className="inline-flex items-center gap-1.5 text-navy-600 font-semibold hover:underline"><Icon name="search" size={16} /> {t("reportCard.reviewOwn")}</Link>
              <Link to="/journey" className="inline-flex items-center gap-1.5 text-muted font-semibold hover:underline"><Icon name="map" size={16} /> {t("reportCard.map")}</Link>
              <span className="flex-1" />
              {r.chancesLeft > 0 && (r.roundKey === "trial" && r.trialGated
                ? <GameButton onClick={() => { sayBtn("btn_retry", { next_chance: r.chanceNo + 1 }); nav("/play/trial"); }}><Icon name="replay" size={18} /> {t("reportCard.retryTrial", { n: r.chancesLeft })}</GameButton>
                : <GameButton variant="ghost" onClick={() => { sayBtn("btn_retry", { next_chance: r.chanceNo + 1 }); nav(`/play/${r.roundKey}`); }}><Icon name="replay" size={18} /> {t("reportCard.replay", { n: r.chancesLeft })}</GameButton>)}
              {r.trialGated ? null
                : next ? <GameButton sound="whoosh" onClick={() => { sayBtn("btn_next", { next_level: next.nameEn }); nav(`/play/${next.key}`); }}>{noArrow(t("reportCard.nextRound", { roundName: `${next.nameEn} Round` }))} <Icon name="arrowRight" size={18} /></GameButton>
                  : <GameButton sound="fanfare" onClick={() => nav("/total")}><Icon name="trophy" size={18} /> {noArrow(t("reportCard.totalScore"))}</GameButton>}
            </div>
          </motion.section>
        </div>
      </Page>
    </>
  );
}
