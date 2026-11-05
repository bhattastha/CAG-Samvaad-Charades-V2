import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Link, useNavigate } from "react-router-dom";
import { scriptLine, useConfig, useLines, useProgress } from "../lib/queries";
import { sfx } from "../lib/sfx";
import { usePrefs } from "../lib/store";
import { t, tList } from "../lib/strings";
import { announce, stop, toggle, useVoice, type Line } from "../lib/voice";
import { fill } from "@hc/shared";
import { Icon } from "../components/Icon";
import { useSettingsOpen } from "../components/Settings";
import { JourneyPath, stageStates, type StageState } from "./landing/JourneyPath";
import { routeFor } from "./flow";

const A = "/landing";
const reducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const saveData = () => typeof navigator !== "undefined" && !!(navigator as any).connection?.saveData;

/** Header: official CAG + BHASHINI marks together on one plate (supplied assets, original colours); sound + settings right. */
function LandingHeader({ signedIn }: { signedIn: boolean }) {
  const voice = usePrefs((s) => s.voice);
  const set = usePrefs((s) => s.set);
  const unlock = usePrefs((s) => s.unlockAudio);
  const openSettings = useSettingsOpen((s) => s.set);
  const on = voice === "auto";
  const glass = "w-11 h-11 rounded-full grid place-items-center bg-white/90 text-[#0F2D5B] shadow-lg shadow-black/20 hover:bg-white transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#F3D58A]/60";
  return (
    <header className="relative z-20 mx-auto w-full max-w-[1440px] px-4 sm:px-8 pt-4 sm:pt-5 flex items-start gap-3">
      <motion.div initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}
        className="flex items-center gap-3 sm:gap-5 rounded-2xl bg-white/95 px-3 sm:px-5 py-2 sm:py-2.5 shadow-xl shadow-black/25 ring-1 ring-white/60">
        <img src={`${A}/cag-logo.png`} alt="Comptroller and Auditor General of India" className="h-11 sm:h-[60px] w-auto" width={195} height={240} />
        <span className="w-px self-stretch bg-slate-300" aria-hidden />
        <img src={`${A}/bhashini-logo.png`} alt="Digital India BHASHINI" className="h-8 sm:h-11 w-auto" width={330} height={160} />
      </motion.div>
      <div className="ml-auto flex items-center gap-2 sm:gap-3">
        {!signedIn && <Link data-testid="landing-signin" to="/register?returning=1" className="px-2 sm:px-3 py-2 text-sm sm:text-[15px] font-semibold text-white/90 hover:text-white drop-shadow">{t("landing.signIn")}</Link>}
        <button role="switch" aria-checked={on} aria-label={t("title.voiceToggle")} title={on ? t("landing.soundOn") : t("landing.soundOff")}
          onClick={() => { unlock(); set("voice", on ? "tap" : "auto"); sfx("tap"); if (on) stop(); }} className={glass}>
          <Icon name={on ? "volume" : "mute"} size={20} />
        </button>
        <button onClick={() => { unlock(); openSettings(true); }} aria-label={t("common.settings")} title={t("common.settings")} className={glass}>
          <Icon name="settings" size={20} />
        </button>
      </div>
    </header>
  );
}

/** Sahayika's speech panel, with a play control and a live waveform while the voice plays. */
function SahayakSpeech({ say }: { say: Line | null }) {
  const st = useVoice();
  const { data: lines } = useLines("landing");
  const body = say ?? scriptLine(lines, "landing.screen.welcome", t("landing.speech")); // edited in the manager console
  const line: Line = useMemo(() => (say ? say : { id: "landing.welcome", en: `${t("landing.greeting")} ${body.en}`, hi: "", spoken: true }), [body.en, say]);
  const playing = st.line?.id === line.id && st.status === "playing";
  return (
    <motion.div initial={{ opacity: 0, scale: 0.9, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={{ type: "spring", stiffness: 180, damping: 18, delay: 0.9 }}
      className="relative w-[158px] min-[400px]:w-[170px] sm:w-[260px] rounded-2xl bg-white/95 p-3 sm:p-4 shadow-2xl shadow-black/30 text-[#0F2D5B]" role="note">
            <span className="absolute -left-2 top-9 w-4 h-4 rotate-45 bg-white/95" aria-hidden />
      <p className="text-[18px] sm:text-[22px] font-extrabold leading-tight whitespace-pre-line">
        {t("landing.greeting").split(/(Sahayika\.?)/).map((part, i) => part.startsWith("Sahayika") ? <span key={i} className="text-[#E8590C]">{part}</span> : <span key={i}>{part.replace("! ", "!\n")}</span>)}
      </p>
      <button onClick={() => { sfx("tap"); toggle(line); }} aria-pressed={playing} aria-label={t("landing.listen")}
        className="mt-2 inline-flex items-center gap-2 rounded-full bg-[#FFF3EB] pl-1 pr-3 py-1 text-[13px] font-semibold text-[#C2410C] hover:bg-orange-100 transition">
        <span className="w-7 h-7 rounded-full bg-gradient-to-b from-[#FF8A00] to-[#E8590C] text-white grid place-items-center"><Icon name={playing ? "pause" : "play"} size={13} fill={!playing} /></span>
        <span className="flex items-end gap-[3px] h-5" aria-hidden>
          {Array.from({ length: 9 }, (_, i) => (
            <motion.span key={i} className="w-[3px] rounded-full bg-[#E8590C]"
              animate={playing ? { height: ["25%", "100%", "40%", "85%", "25%"] } : { height: `${[30, 55, 80, 45, 95, 60, 35, 70, 40][i]}%` }}
              transition={playing ? { duration: 0.8, repeat: Infinity, delay: i * 0.07 } : { duration: 0.3 }} />
          ))}
        </span>
        <span className="sr-only">{t("landing.listen")}</span>
      </button>
      <p className="mt-2 text-[13px] sm:text-[15px] leading-snug text-[#1F3B66]" data-testid="landing-sahayika-line">{body.en}</p>
    </motion.div>
  );
}

/** Background: the CAG-building video (poster when motion is reduced or data saver is on), overlays for depth. */
function HeroBackdrop({ reduce }: { reduce: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  const video = !reduce && !saveData();
  useEffect(() => { ref.current?.play().catch(() => {}); }, [video]);
  return (
    <div className="absolute inset-0 -z-0 overflow-hidden" aria-hidden>
      {video
        ? <video ref={ref} className="absolute inset-0 w-full h-full object-cover" src={`${A}/hero.mp4`} poster={`${A}/hero-poster.jpg`} autoPlay muted loop playsInline preload="auto" />
        : <img className="absolute inset-0 w-full h-full object-cover" src={`${A}/hero-poster.jpg`} alt="" />}
      {/* cinematic grade: navy from the left for the brand, deep fade at the bottom for the journey */}
      <div className="absolute inset-0" style={{ background: "linear-gradient(90deg, rgba(5,16,36,.94) 0%, rgba(7,26,51,.82) 30%, rgba(7,26,51,.25) 58%, rgba(7,26,51,.1) 100%)" }} />
      <div className="absolute inset-0" style={{ background: "linear-gradient(180deg, rgba(5,16,36,.55) 0%, rgba(5,16,36,0) 22%, rgba(5,16,36,0) 46%, rgba(5,16,36,.82) 72%, #051024 100%)" }} />
      <div className="absolute inset-0" style={{ background: "radial-gradient(60% 50% at 70% 45%, rgba(255,170,60,.12), transparent 70%)" }} />
      {!reduce && <Particles />}
    </div>
  );
}

function Particles() {
  const dots = useMemo(() => Array.from({ length: 22 }, (_, i) => ({ l: (i * 47) % 100, s: 2 + (i % 3), d: 9 + (i % 7) * 2, delay: -(i * 1.3) })), []);
  return <>{dots.map((p, i) => <span key={i} className="lp-particle absolute bottom-0 rounded-full bg-[#FFD27A]" style={{ left: `${p.l}%`, width: p.s, height: p.s, animationDuration: `${p.d}s`, animationDelay: `${p.delay}s` }} />)}</>;
}

/** Decorative only: the English → Indian-language idea as two glowing tiles (not interface copy). */
function GlyphTiles() {
  return (
    <div className="absolute right-0 top-[44%] hidden xl:flex flex-col items-center gap-2 pointer-events-none" aria-hidden>
      <motion.span className="lp-glyph grid place-items-center w-16 h-16 rounded-2xl text-white text-4xl font-extrabold en"
        style={{ background: "linear-gradient(145deg,#3B6FD8,#16357A)", boxShadow: "0 0 0 1px rgba(255,255,255,.35), 0 16px 40px rgba(30,76,163,.55)" }}
        animate={{ y: [0, -8, 0] }} transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}>A</motion.span>
      <svg width="20" height="40" viewBox="0 0 20 40" className="opacity-90"><path d="M10 2v30m-7-8 7 9 7-9" stroke="#F3D58A" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
      <motion.span className="lp-glyph grid place-items-center w-16 h-16 rounded-2xl text-[#7A3B00] text-4xl font-bold"
        style={{ background: "linear-gradient(145deg,#FFE7A8,#F5A623)", boxShadow: "0 0 0 1px rgba(255,255,255,.5), 0 16px 40px rgba(245,166,35,.5)" }}
        animate={{ y: [0, -8, 0] }} transition={{ duration: 5, repeat: Infinity, ease: "easeInOut", delay: 0.6 }}>अ</motion.span>
    </div>
  );
}

/** §7.1 Title — the cinematic landing. Start Playing → the existing onboarding (or resume for a signed-in player). */
export function Title() {
  const nav = useNavigate();
  const { data } = useProgress();
  const { data: cfg } = useConfig();
  const unlock = usePrefs((s) => s.unlockAudio);
  const prefReduce = usePrefs((s) => s.reduceMotion);
  const [reduce] = useState(() => reducedMotion() || prefReduce);
  const signedIn = !!data?.registered;
  // Sahayika's home-screen lines (script H-02 … H-09, J-01)
  const { data: homeLines } = useLines("landing");
  const { data: endLines } = useLines("end");
  const [say, setSay] = useState<Line | null>(null);
  const sayId = (id: string, vars: Record<string, string | number> = {}) => {
    const l = [...(homeLines ?? []), ...(endLines ?? [])].find((x) => x.id === id);
    if (!l) return;
    const filled = { ...l, en: fill(l.en, vars), hi: fill(l.hi, vars) };
    setSay(filled); announce(filled);
  };
  useEffect(() => {
    if (!homeLines) return;
    const nextKey = data?.summary?.nextRound;
    if (signedIn && nextKey && endLines) sayId("end.journey.welcome_back", { next_level: cfg?.rounds.find((r) => r.key === nextKey)?.nameEn ?? "" });
    const tm = window.setTimeout(() => sayId("landing.screen.idle"), 15_000);
    return () => window.clearTimeout(tm);
  }, [homeLines, endLines, signedIn]);
  const start = () => {
    unlock(); // first tap: sound may play from now on (§15.9)
    if (!signedIn) sayId("landing.screen.start");
    setTimeout(() => sfx("go"), 30);
    nav(signedIn ? routeFor(data!) : "/register");
  };
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Enter" && !["BUTTON", "A", "INPUT"].includes((e.target as HTMLElement)?.tagName)) start(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  });
  const states = useMemo(() => (cfg ? stageStates(cfg, data?.summary) : {}), [cfg, data?.summary]);
  const openStage = (key: string, st: StageState) => {
    unlock();
    if (!signedIn) return nav("/register");
    if (st === "upcoming" || st === "available" || st === "played" || st === "completed") nav(`/play/${key}`);
  };
  const brand = (cfg?.brand?.name ?? t("common.gameName")).split(" ");
  const features = tList<{ icon: string; title: string; body: string }>("landing.features");

  return (
    <div className="min-h-screen bg-[#051024] text-white overflow-x-clip">
      <section className="relative isolate min-h-screen flex flex-col">
        <HeroBackdrop reduce={reduce} />
        <LandingHeader signedIn={signedIn} />

        {/* hero */}
        <div className="relative z-10 mx-auto w-full max-w-[1440px] px-4 sm:px-8 flex-1 grid lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] items-center gap-6 pt-6 lg:pt-0">
          <div className="max-w-xl">
            <motion.div initial={{ opacity: 0, y: 28 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, ease: [0.2, 0.8, 0.2, 1], delay: 0.15 }}>
              <svg width="120" height="34" viewBox="0 0 120 34" className="ml-[38%] -mb-1" aria-hidden>
                <path d="M60 32 C 48 14, 26 6, 6 10 C 24 14, 40 22, 54 33Z" fill="#F59E0B" opacity=".95" />
                <path d="M60 32 C 72 14, 94 6, 114 10 C 96 14, 80 22, 66 33Z" fill="#E8590C" />
                <path d="M60 32 C 58 18, 60 8, 62 2 C 66 12, 64 22, 61 33Z" fill="#FDBA74" />
              </svg>
              <h1 className="font-extrabold leading-[0.95] tracking-tight text-[3.2rem] sm:text-[4.6rem] xl:text-[5.6rem]">
                <span translate="no" className="notranslate">
                  <span className="block text-white drop-shadow-[0_6px_24px_rgba(0,0,0,.45)]">{brand[0]}</span>
                  <span className="block bg-gradient-to-b from-[#FFD27A] via-[#FF9A3C] to-[#E8590C] bg-clip-text text-transparent drop-shadow-[0_6px_24px_rgba(232,89,12,.35)]">{brand.slice(1).join(" ")}</span>
                </span>
              </h1>
              <svg viewBox="0 0 420 18" className="w-[78%] max-w-[420px] -mt-1" aria-hidden><path d="M4 12 C 120 2, 300 2, 416 10" stroke="url(#sw)" strokeWidth="5" fill="none" strokeLinecap="round" /><defs><linearGradient id="sw" x1="0" x2="1"><stop offset="0" stopColor="#E8590C" stopOpacity="0" /><stop offset=".4" stopColor="#FF8A00" /><stop offset="1" stopColor="#FFD27A" /></linearGradient></defs></svg>
            </motion.div>
            <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.45, duration: 0.6 }}
              className="mt-4 flex items-center gap-3 text-[1.35rem] sm:text-[1.6rem] font-medium tracking-wide text-white/95">
              <span className="h-px w-8 bg-gradient-to-r from-transparent to-[#F3D58A]" aria-hidden />{t("landing.tagline")}<span className="h-px w-8 bg-gradient-to-l from-transparent to-[#F3D58A]" aria-hidden />
            </motion.p>
            <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.6, duration: 0.6 }} className="mt-2 text-[1.05rem] sm:text-lg text-blue-100/85">
              {t("landing.support")}
            </motion.p>
            <motion.button initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.75, type: "spring", stiffness: 160, damping: 16 }}
              whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }} onClick={start} data-testid="start"
              className="lp-cta mt-7 group relative inline-flex items-center gap-4 rounded-full pl-2.5 pr-8 py-2.5 text-[1.3rem] sm:text-[1.45rem] font-bold text-white bg-gradient-to-b from-[#FF9A3C] to-[#E8590C] shadow-[0_14px_40px_-10px_rgba(232,89,12,.8)] ring-1 ring-white/40 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#FFD27A]">
              <span className="w-12 h-12 rounded-full bg-white text-[#E8590C] grid place-items-center shadow-inner"><Icon name="play" size={20} fill /></span>
              {signedIn ? t("landing.ctaContinue") : t("landing.cta")}
              <Icon name="arrowRight" size={24} className="transition-transform group-hover:translate-x-1" />
            </motion.button>
          </div>

          {/* Sahayak: waist-up, centre stage, speech panel beside the head (as the approved reference) */}
          <div className="relative flex items-end justify-start lg:justify-start gap-1 sm:gap-3 min-h-[250px] sm:min-h-[380px] lg:min-h-[min(62vh,570px)]">
            <GlyphTiles />
            <motion.div className="relative z-[1] shrink-0 lg:-ml-[12%] xl:-ml-[8%]"
              initial={{ opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.9, ease: [0.2, 0.8, 0.2, 1], delay: 0.3 }}>
              <img src={`${A}/sahayak-half.webp`} alt="Sahayika, the game companion, welcoming you" width={820} height={877}
                className="h-[200px] min-[400px]:h-[220px] sm:h-[380px] lg:h-[min(62vh,570px)] w-auto drop-shadow-[0_24px_40px_rgba(0,0,0,.5)] lp-breathe" />
            </motion.div>
            <div className="relative z-10 self-start mt-4 lg:mt-0 lg:absolute lg:left-[54%] xl:left-[52%] lg:top-[2%]"><SahayakSpeech say={say} /></div>
          </div>
        </div>

        {/* journey */}
        <div className="relative z-10 mx-auto w-full max-w-[1440px] px-4 sm:px-8 pb-6 lp-journey pointer-events-none [&_button]:pointer-events-auto">
          {cfg && <JourneyPath cfg={cfg} states={states} next={signedIn ? data?.summary?.nextRound ?? null : "trial"} onStage={openStage}
            onSay={(k) => sayId(k === "locked" ? "landing.screen.locked" : `landing.hover.${k}`)} />}
        </div>
      </section>

      {/* feature strip */}
      <section className="relative mx-auto max-w-[1440px] px-4 sm:px-8 pb-10 -mt-2">
        <div className="rounded-2xl border border-[#F3D58A]/25 bg-white/[0.04] backdrop-blur-md shadow-[0_20px_60px_-20px_rgba(0,0,0,.6)] grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 lg:divide-x divide-white/10">
          {features.map((f, i) => (
            <motion.div key={f.title} initial={{ opacity: 0, y: 10 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.08 }} className="flex items-center gap-4 px-6 py-5">
              <span className="shrink-0 w-14 h-14 rounded-full grid place-items-center text-[#F3D58A] ring-1 ring-[#F3D58A]/50 bg-gradient-to-b from-white/10 to-transparent"><Icon name={f.icon} size={24} /></span>
              <span><span className="block font-bold text-white text-[16px]">{f.title}</span><span className="block text-[14px] text-blue-100/75">{f.body}</span></span>
            </motion.div>
          ))}
        </div>
        <p className="mt-6 text-center text-[13px] text-blue-100/50">{t("landing.footer")}</p>
      </section>
    </div>
  );
}
