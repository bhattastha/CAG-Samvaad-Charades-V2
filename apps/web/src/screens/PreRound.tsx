import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { formatLimit, type RoundConfig } from "@hc/shared";
import { api, ApiError, clientId } from "../lib/api";
import { sfx } from "../lib/sfx";
import { usePrefs } from "../lib/store";
import { roundName, t, tList } from "../lib/strings";
import type { Line } from "../lib/voice";
import { Coin, Header, Page, Spinner } from "../components/Layout";
import { SahayikaLine } from "../components/Sahayika";
import { Ambient, Countdown, GameButton, Medal } from "../components/Juice";
import { micCheck } from "../editor/voice";
import { Icon } from "../components/Icon";

interface Intro { round: RoundConfig; chance: number; maxChances: number; unlocked: boolean; playable: boolean; chancesLeft: number; active: boolean; best: number | null; trialQualifyingScore: number; lines: Line[] }

export async function enterFullscreen() {
  const el: any = document.documentElement;
  try {
    if (!document.fullscreenElement) await (el.requestFullscreen?.({ navigationUI: "hide" }) ?? el.webkitRequestFullscreen?.());
    // Chrome/Edge: Esc closes menus and suggestions in the editor instead of dropping out of full screen (hold Esc to exit)
    await (navigator as any).keyboard?.lock?.(["Escape"]).catch(() => {});
  } catch { /* iPhone Safari: no element fullscreen; visibility tracking covers it (§12) */ }
}

/** Mic check before the clock starts (Level 1 only, §15.1). */
function MicCheck() {
  const [state, setState] = useState<"idle" | "on" | "ok" | "denied">("idle");
  const [level, setLevel] = useState(0);
  const stop = useRef<(() => void) | null>(null);
  useEffect(() => () => stop.current?.(), []);
  const start = async () => {
    try {
      stop.current = await micCheck((v) => { setLevel(v); if (v > 0.12) setState((s) => { if (s !== "ok") sfx("success"); return "ok"; }); });
      setState((s) => (s === "ok" ? s : "on"));
    } catch { setState("denied"); sfx("error"); }
  };
  return (
    <div className="rounded-card border border-slate-200 bg-navy-50 p-3.5 flex items-center gap-3 flex-wrap">
      <span className="w-10 h-10 rounded-ui bg-navy text-white grid place-items-center" aria-hidden><Icon name="mic" size={20} /></span>
      {state === "idle" && <GameButton type="button" variant="blue" onClick={start} className="py-2 text-base">{t("preRound.micStart")}</GameButton>}
      {(state === "on" || state === "ok") && (
        <div className="flex-1 min-w-[12rem]">
          <div className="text-sm font-semibold text-navy flex items-center gap-1.5">{state === "ok" && <Icon name="check" size={15} className="text-success" />}{state === "ok" ? t("preRound.micOk") : t("round.micCheck")}</div>
          <div className="mt-1 flex gap-[3px] h-5 items-end">
            {Array.from({ length: 18 }, (_, i) => <span key={i} className={`flex-1 rounded-sm transition-all duration-75 ${level * 18 * 2.2 > i ? (i > 13 ? "bg-primary" : "bg-success") : "bg-slate-200"}`} style={{ height: `${30 + (i % 5) * 15}%` }} />)}
          </div>
        </div>
      )}
      {state === "denied" && <div className="text-[0.95rem] font-semibold text-timer-text">{t("round.micDenied")}</div>}
    </div>
  );
}

/** §7.5 Before the round — as a mission briefing with a countdown. */
export function PreRound() {
  const { key } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const unlock = usePrefs((s) => s.unlockAudio);
  const { data, error } = useQuery({ queryKey: ["intro", key], queryFn: () => api<Intro>(`/rounds/${key}/intro`), retry: false });
  const [phase, setPhase] = useState<"brief" | "count">("brief");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { if (error && (error as ApiError).status === 401) nav("/register"); }, [error]);
  if (!data) return <><Header /><Spinner /></>;
  const r = data.round;
  const first = r.key === "trial";
  if (data.playable === false) return <VarchaspatiPreview r={r} onBack={() => nav("/journey")} />;

  const begin = async () => {
    unlock();
    await enterFullscreen(); // must run inside the click (user gesture)
    if (data.active) return launch();
    setPhase("count");
  };
  const launch = async () => {
    try {
      const a = await api<{ id: string }>(`/rounds/${key}/attempts`, { body: { clientId } });
      await qc.invalidateQueries({ queryKey: ["progress"] });
      nav(`/round/${a.id}`, { replace: true });
    } catch (e) {
      setErr((e as ApiError).code);
      setPhase("brief");
      sfx("error");
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    }
  };

  const objectives = [
    r.bhashiniDraft ? t("preRound.objMain") : t("preRound.objTrial"),
    t("preRound.objNumbers"),
    t("preRound.fullMeaning"),
    ...(r.key === "primary" ? [t("preRound.typingOnly")] : []),
    t("preRound.cannotLeave"),
    t("preRound.threeChances"),
  ];

  return (
    <>
      <Header />
      <Ambient density={10} />
      {phase === "count" && <Countdown onDone={launch} />}
      <Page>
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ type: "spring", stiffness: 200, damping: 26 }}
          className="relative mx-auto max-w-4xl card shadow-pop overflow-hidden" role="dialog" aria-modal="true" aria-labelledby="pre-title">
          <div className="relative card-dark hud-grid !rounded-none !border-0 !shadow-none text-white px-6 sm:px-8 py-6 flex items-center gap-5">
            <div className="absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r from-primary via-gold to-transparent" aria-hidden />
            <motion.div initial={{ scale: 0.85, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 260, damping: 22, delay: 0.15 }}><Medal k={r.key} size={84} shine /></motion.div>
            <div className="flex-1">
              <div className="kicker text-gold-light">{t("preRound.heading")} · {r.levelLabel}</div>
              <h1 id="pre-title" className="text-3xl sm:text-4xl font-extrabold tracking-tight">{first ? t("ob.pre.heading") : roundName(r)}</h1>
              <div className="text-blue-100/80">{first ? t("ob.pre.sub", { title: r.titleEn }) : t("preRound.headingEn")}</div>
              {first && (
                <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px]">
                  <span className="chip bg-white/10 border-white/20 text-white"><span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />{t("ob.pre.statusKicker")}: {data.active ? t("ob.pre.statusResume") : t("ob.pre.statusReady")}</span>
                  <span className="chip bg-gold/20 border-gold/50 text-gold-light"><Coin size={14} />{t("ob.pre.available")}: {r.creditCap}</span>
                  <span className="chip bg-white/10 border-white/20 text-white">{roundName(r)}</span>
                </div>
              )}
            </div>
            <span className="chip bg-white/10 border-white/20 text-white text-base tnum">{t("common.chanceOf", { n: data.chance, max: data.maxChances })}</span>
          </div>
          <div className="grid md:grid-cols-[1.3fr_1fr] gap-6 p-6 sm:p-8">
            <div>
              <h2 className="kicker">{t("preRound.objectives")}</h2>
              <ul className="mt-3 space-y-2.5">
                {objectives.map((o, i) => (
                  <motion.li key={o} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.25 + i * 0.06, duration: 0.25 }} className="flex gap-3 text-[1rem] text-ink">
                    <span className="w-6 h-6 shrink-0 rounded-md bg-navy text-white grid place-items-center text-xs font-bold tnum">{i + 1}</span>{o}
                  </motion.li>
                ))}
              </ul>
              {r.voiceTyping && <div className="mt-5"><MicCheck /></div>}
            </div>
            <div className="space-y-4">
              <div className="rounded-card bg-white border border-slate-200 border-l-4 border-l-primary px-5 py-4 flex items-center gap-4">
                <span className="w-12 h-12 rounded-ui bg-primary-soft text-primary-strong grid place-items-center"><Icon name="clock" size={24} /></span>
                <div><div className="text-sm text-muted font-semibold">{t("preRound.timeYouHave")}</div><div className="text-4xl font-extrabold text-navy tnum tracking-tight">{formatLimit(r.timeLimitMinutes)}</div></div>
              </div>
              <div className="rounded-card bg-gold-soft border border-gold-light px-5 py-4">
                <div className="kicker !text-gold-deep">{t("preRound.rewards")}</div>
                <div className="mt-2 flex items-center gap-2 font-bold text-navy"><Coin size={22} /> {t("preRound.creditsReward", { n: r.creditCap })}</div>
                <div className="mt-1.5 flex items-center gap-2 font-bold text-navy"><Medal k={r.key} size={26} /> {t("preRound.willBecome", { title: r.titleEn })}</div>
              </div>
              {data.lines.map((l) => <SahayikaLine key={l.id} line={l} />)}
            </div>
          </div>
          <div className="px-6 sm:px-8 pb-6 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-4">
            <button className="inline-flex items-center gap-1 text-muted font-semibold hover:text-navy" onClick={() => nav("/journey")}><Icon name="chevronLeft" size={16} /> {t("common.back")}</button>
            <span className="text-xs text-muted">{t("preRound.fullscreenNote")}</span>
            {!data.unlocked ? <div className="text-muted font-semibold inline-flex items-center gap-1.5"><Icon name="lock" size={16} /> {t("journey.lockedHint", { n: data.trialQualifyingScore })}</div>
              : data.chancesLeft === 0 && !data.active ? <div className="text-muted font-semibold">{t("journey.noChances")}</div>
                : <GameButton sound="pop" className={`px-9 py-4 text-xl ${first ? "ob-pulse" : ""}`} onClick={begin}>{data.active ? (first ? t("ob.pre.resume") : t("journey.resume")) : first ? t("ob.pre.start") : t("preRound.start")} <Icon name="play" size={18} fill /></GameButton>}
          </div>
          {err && <div className="err px-8 pb-4">{t("common.error")} ({err})</div>}
        </motion.div>
      </Page>
    </>
  );
}

/** Level 5 (Phase 2): introduction and the proposed assessment framework; not playable yet. */
function VarchaspatiPreview({ r, onBack }: { r: RoundConfig; onBack(): void }) {
  const framework = tList<{ name: string; weight: number; desc: string }>("varchaspati.framework");
  return (
    <>
      <Header />
      <Ambient density={10} />
      <Page>
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ type: "spring", stiffness: 200, damping: 26 }} className="relative mx-auto max-w-4xl card shadow-pop overflow-hidden">
          <div className="bg-gradient-to-r from-purple-950 via-purple-900 to-purple-700 text-white px-6 sm:px-8 py-7 flex items-center gap-5">
            <motion.div initial={{ scale: 0.85, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 260, damping: 22, delay: 0.15 }}><Medal k="varchaspati" size={90} phase2 /></motion.div>
            <div className="flex-1">
              <div className="kicker !text-purple-200">{t("varchaspati.kicker")}</div>
              <h1 className="text-4xl font-extrabold tracking-tight">{t("varchaspati.heading")}</h1>
              <div className="text-purple-100 mt-1">{t("varchaspati.tagline")}</div>
            </div>
          </div>
          <div className="p-6 sm:p-8 grid md:grid-cols-[1fr_1.2fr] gap-6">
            <div className="space-y-4">
              <div className="rounded-card bg-purple-50 border border-purple-200 p-4">
                <div className="kicker !text-purple-700">{t("varchaspati.teaser")}</div>
                <p className="mt-1">{t("varchaspati.teaserBody")}</p>
              </div>
              <ul className="space-y-2">
                {tList("varchaspati.format").map((f) => <li key={f} className="flex gap-2"><Icon name="chevronRight" size={16} className="mt-1 text-purple-600" />{f}</li>)}
              </ul>
              <div className="rounded-ui border border-purple-200 bg-white/70 p-3">
                <div className="kicker !text-purple-800 mb-2">{t("varchaspati.corpusHeading")}</div>
                <ul className="space-y-2 text-sm">
                  {tList<{ title: string; pages: string; note: string }>("varchaspati.corpus").map((c) => (
                    <li key={c.title} className="flex gap-2">
                      <Icon name="file" size={15} className="mt-0.5 text-purple-600" />
                      <span className="flex-1"><span className="font-semibold text-navy">{c.title}</span><span className="block text-xs text-muted">{c.note}</span></span>
                      <span className="text-xs font-bold text-purple-800 whitespace-nowrap">{c.pages}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="flex gap-2 flex-wrap text-sm">
                <span className="chip bg-purple-100 border-purple-200 text-purple-800"><Icon name="files" size={14} /> {t("journey.pagesLabel", { n: r.pages || 300 })}</span>
                <span className="chip bg-purple-100 border-purple-200 text-purple-800">{r.phase ?? t("journey.phase2")}</span>
              </div>
            </div>
            <div>
              <h2 className="font-extrabold text-navy mb-3">{t("varchaspati.frameworkHeading")}</h2>
              <div className="space-y-2.5">
                {framework.map((f, i) => (
                  <motion.div key={f.name} initial={{ opacity: 0, x: 14 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.2 + i * 0.06 }}>
                    <div className="flex justify-between text-sm"><span className="font-semibold">{f.name}</span><span className="font-extrabold tnum">{f.weight}</span></div>
                    <div className="h-2 rounded-full bg-slate-100 overflow-hidden"><motion.div className="h-full bg-gradient-to-r from-purple-600 to-purple-400" initial={{ width: 0 }} animate={{ width: `${f.weight * 4}%` }} transition={{ delay: 0.3 + i * 0.06 }} /></div>
                    <div className="text-xs text-muted">{f.desc}</div>
                  </motion.div>
                ))}
              </div>
            </div>
          </div>
          <div className="px-6 sm:px-8 pb-6 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-4">
            <button className="inline-flex items-center gap-1 text-muted font-semibold hover:text-navy" onClick={onBack}><Icon name="chevronLeft" size={16} /> {t("common.back")}</button>
            <span className="font-semibold text-purple-700 inline-flex items-center gap-1.5"><Icon name="sparkle" size={16} /> {t("varchaspati.notYet")}</span>
          </div>
        </motion.div>
      </Page>
    </>
  );
}
