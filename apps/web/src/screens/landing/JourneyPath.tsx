import { useId, useRef } from "react";
import { motion, useMotionValue, useSpring, useTransform } from "framer-motion";
import type { PublicConfig, Summary } from "@hc/shared";
import { t } from "../../lib/strings";
import { sfx } from "../../lib/sfx";
import { Icon } from "../../components/Icon";

export type StageState = "available" | "played" | "completed" | "locked" | "upcoming";

/**
 * Landing design tokens for the journey (one place, so cards, wave and chips stay consistent):
 * type — card title 18/700, achievement 13/600 gold, body 13/400, label 10–11/700 caps; radius 16 (cards) / pill;
 * spacing on an 8-pt grid; each stage owns one hue, used for its emblem, border light and glow only.
 */
const STAGE: Record<string, { icon: string; a: string; b: string; glow: string; edge: string }> = {
  trial: { icon: "book", a: "#FCD34D", b: "#E85A1A", glow: "rgba(245,158,11,.55)", edge: "#F59E0B" },
  primary: { icon: "files", a: "#7DD3FC", b: "#1D4E89", glow: "rgba(56,189,248,.5)", edge: "#38BDF8" },
  secondary: { icon: "chart", a: "#C4B5FD", b: "#6D28D9", glow: "rgba(167,139,250,.5)", edge: "#A78BFA" },
  pro: { icon: "image", a: "#5EEAD4", b: "#0F766E", glow: "rgba(45,212,191,.5)", edge: "#2DD4BF" },
  varchaspati: { icon: "trophy", a: "#FDE68A", b: "#B8862B", glow: "rgba(250,204,21,.6)", edge: "#FACC15" },
};
const GOLD = "#F3D58A";

/** Status of each stage from the real game state (signed in) or the unlock rule (visitor). */
export function stageStates(cfg: PublicConfig, summary?: Summary): Record<string, StageState> {
  const out: Record<string, StageState> = {};
  const allOpen = cfg.levels?.unlockRule === "all-open";
  for (const r of cfg.rounds) {
    if (r.playable === false) { out[r.key] = "upcoming"; continue; }
    const s = summary?.rounds.find((x) => x.key === r.key);
    if (!s) { out[r.key] = allOpen || r.key === "trial" ? "available" : "locked"; continue; }
    out[r.key] = s.titleEarned ? "completed" : !s.unlocked ? "locked" : s.played > 0 ? "played" : "available";
  }
  return out;
}

/** Collectible emblem on a lit pedestal. */
function Emblem({ k, state, size }: { k: string; state: StageState; size: number }) {
  const s = STAGE[k] ?? STAGE.trial;
  const dim = state === "locked";
  // unique per instance: gradients inside a display:none SVG do not paint for another copy
  const uid = useId().replace(/:/g, "");
  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }}>
      <span className="absolute -bottom-[14%] left-1/2 -translate-x-1/2 w-[110%] h-[30%] rounded-[50%] blur-md" style={{ background: dim ? "rgba(148,163,184,.25)" : s.glow }} aria-hidden />
      <svg viewBox="0 0 100 100" width={size} height={size} className="relative drop-shadow-[0_8px_14px_rgba(0,0,0,.45)]" aria-hidden>
        <defs>
          <linearGradient id={`lg${uid}`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor={dim ? "#CBD5E1" : s.a} /><stop offset="1" stopColor={dim ? "#475569" : s.b} /></linearGradient>
          <radialGradient id={`rg${uid}`} cx="35%" cy="28%" r="75%"><stop offset="0" stopColor="#fff" stopOpacity=".6" /><stop offset=".55" stopColor="#fff" stopOpacity="0" /></radialGradient>
        </defs>
        <ellipse cx="50" cy="86" rx="34" ry="9" fill={dim ? "#334155" : s.b} opacity=".9" />
        <ellipse cx="50" cy="83" rx="34" ry="9" fill={dim ? "#64748B" : s.a} opacity=".55" />
        {k === "varchaspati" && !dim && <path d="M33 12l7 8 10-12 10 12 7-8 2 12H31z" fill="#FDE68A" stroke="#B8862B" strokeWidth="1.2" />}
        <circle cx="50" cy="50" r="32" fill={`url(#lg${uid})`} stroke="rgba(255,255,255,.75)" strokeWidth="2" />
        <circle cx="50" cy="50" r="25" fill="rgba(7,26,51,.32)" stroke="rgba(255,255,255,.35)" strokeWidth="1" />
        <circle cx="50" cy="50" r="32" fill={`url(#rg${uid})`} />
      </svg>
      <span className="absolute grid place-items-center text-white" style={{ top: size * 0.2, width: size * 0.6, height: size * 0.6 }}>
        <Icon name={dim ? "lock" : s.icon} size={size * 0.3} stroke={1.9} />
      </span>
    </div>
  );
}

function StateChip({ state }: { state: StageState }) {
  const tone = state === "completed" ? "bg-emerald-400/15 text-emerald-200 ring-emerald-300/30"
    : state === "locked" ? "bg-white/5 text-slate-300 ring-white/15"
      : state === "upcoming" ? "bg-purple-400/15 text-purple-200 ring-purple-300/30"
        : "bg-orange-400/15 text-orange-100 ring-orange-300/30";
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-[0.08em] ring-1 whitespace-nowrap ${tone}`}>
      <Icon name={state === "completed" ? "check" : state === "locked" ? "lock" : state === "upcoming" ? "sparkle" : "play"} size={10} fill={state === "available" || state === "played"} />
      {t(`landing.states.${state}`)}
    </span>
  );
}

/** One level card: glass, stage-tinted edge light, 3D tilt toward the cursor, shine sweep, lift and action reveal. */
function StageCard({ k, n, title, state, here, onPress, compact = false }: {
  k: string; n: number; title: string; state: StageState; here: boolean; onPress(): void; compact?: boolean;
}) {
  const s = STAGE[k] ?? STAGE.trial;
  const ref = useRef<HTMLButtonElement>(null);
  const mx = useMotionValue(0.5), my = useMotionValue(0.5);
  const rx = useSpring(useTransform(my, [0, 1], [7, -7]), { stiffness: 220, damping: 18 });
  const ry = useSpring(useTransform(mx, [0, 1], [-9, 9]), { stiffness: 220, damping: 18 });
  const shine = useTransform(mx, [0, 1], ["-40%", "140%"]);
  const locked = state === "locked";
  const action = state === "upcoming" ? t("landing.preview") : state === "completed" || state === "played" ? t("landing.replay") : t("landing.play");
  const label = `${t("landing.stageLabel", { n })}: ${t(`landing.stages.${k}.name`)}, ${title}, ${t(`landing.states.${state}`)}`;
  return (
    <motion.button ref={ref} type="button" onClick={onPress} aria-label={label} data-state={state}
      onMouseMove={(e) => { const r = ref.current!.getBoundingClientRect(); mx.set((e.clientX - r.left) / r.width); my.set((e.clientY - r.top) / r.height); }}
      onMouseLeave={() => { mx.set(0.5); my.set(0.5); }}
      style={compact ? undefined : { rotateX: rx, rotateY: ry, transformPerspective: 800 }}
      whileHover={locked ? undefined : { y: -10, scale: 1.03 }} whileTap={{ scale: 0.97 }}
      className={`group relative w-full text-left rounded-2xl outline-none focus-visible:ring-4 focus-visible:ring-[#F3D58A]/70 ${locked ? "cursor-not-allowed" : ""}`}>
      {/* glow behind the card, in the stage hue */}
      <span className="absolute -inset-1 rounded-[20px] opacity-60 group-hover:opacity-100 transition-opacity blur-xl" style={{ background: `radial-gradient(60% 70% at 50% 100%, ${s.glow}, transparent 75%)` }} aria-hidden />
      <span className="relative block rounded-2xl overflow-hidden border backdrop-blur-md shadow-[0_18px_40px_-18px_rgba(0,0,0,.8)]"
        style={{ borderColor: `${s.edge}66`, background: "linear-gradient(160deg, rgba(255,255,255,.14), rgba(255,255,255,.04) 45%, rgba(7,26,51,.6))" }}>
        <span className="absolute inset-x-0 top-0 h-[2px]" style={{ background: `linear-gradient(90deg, transparent, ${s.edge}, transparent)` }} aria-hidden />
        {!compact && <motion.span className="absolute inset-y-0 w-1/3 -skew-x-12 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" style={{ left: shine, background: "linear-gradient(90deg, transparent, rgba(255,255,255,.18), transparent)" }} aria-hidden />}
        <span className={`relative flex ${compact ? "items-center gap-3 p-3 pl-4" : "flex-col items-center text-center px-3.5 pt-3.5 pb-3.5"}`}>
          <Emblem k={k} state={state} size={compact ? 58 : 62} />
          <span className={`min-w-0 ${compact ? "flex-1" : "mt-2 w-full"}`}>
            <span className="block text-[18px] font-bold leading-tight text-white">{t(`landing.stages.${k}.name`)}</span>
            <span className="block mt-0.5 text-[13px] font-semibold whitespace-nowrap" style={{ color: GOLD }}>{title}</span>
            {!compact && <span className="block mt-1 text-[12.5px] leading-snug text-blue-50/75 min-h-[2.6em]">{t(`landing.stages.${k}.desc`)}</span>}
            {/* one call to action per card: a stage-coloured "Play" for playable levels, a status chip otherwise */}
            <span className={`flex items-center gap-2 ${compact ? "mt-1.5" : "mt-2.5 justify-center"}`}>
              {state === "completed" && <StateChip state={state} />}
              {(state === "available" || state === "played" || state === "completed") ? (
                <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12.5px] font-bold text-white shadow-md ring-1 ring-white/30 transition group-hover:shadow-lg group-hover:brightness-110 whitespace-nowrap"
                  style={{ background: `linear-gradient(180deg, ${s.edge}, ${s.b})` }}>
                  <Icon name="play" size={10} fill />{action}<Icon name="arrowRight" size={12} className="transition-transform group-hover:translate-x-0.5" />
                </span>
              ) : state === "upcoming" ? (
                <><StateChip state={state} /><span className="inline-flex items-center gap-1 text-[12px] font-bold text-white/85 group-hover:text-white whitespace-nowrap">{action}<Icon name="arrowRight" size={12} /></span></>
              ) : <StateChip state={state} />}
            </span>
          </span>
        </span>
      </span>
      {/* number badge, seated on the card corner */}
      <span className="absolute -top-3 -left-3 w-9 h-9 rounded-full grid place-items-center text-[16px] font-extrabold text-white ring-2 ring-white/80 shadow-lg"
        style={{ background: `linear-gradient(160deg, ${s.a}, ${s.b})` }}>{n}</span>
      {here && (
        <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-gradient-to-b from-[#FF9A3C] to-[#E8590C] px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-white shadow-lg ring-1 ring-white/50 whitespace-nowrap lp-here">
          {n === 1 && state === "available" ? t("landing.startHere") : t("landing.youAreHere")}
        </span>
      )}
    </motion.button>
  );
}

// The wave lives in a 1000 × 200 box stretched to the strip (preserveAspectRatio="none", non-scaling strokes),
// so x maps to % of the width and y to px of the 200-px band: each card's anchor sits exactly on the wave.
const NODES = [{ x: 100, y: 118 }, { x: 300, y: 82 }, { x: 500, y: 118 }, { x: 700, y: 82 }, { x: 900, y: 112 }];
const PATH = "M 0 132 C 40 132, 60 118, 100 118 S 240 82, 300 82 S 440 118, 500 118 S 640 82, 700 82 S 840 112, 900 112 S 975 92, 1000 86";
const WAYPOINTS = [{ x: 200, y: 100 }, { x: 400, y: 100 }, { x: 600, y: 100 }, { x: 800, y: 97 }];
const CARD_TOP = 44; // the wave crosses each card at its emblem // the anchor dot sits this far down the card (on the emblem's horizon)

/** Desktop: five level cards seated on the flowing golden wave. Tablet/phone: the same cards on a vertical trail. */
export function JourneyPath({ cfg, states, next, onStage, onSay }: { cfg: PublicConfig; states: Record<string, StageState>; next: string | null; onStage(key: string, state: StageState): void; onSay?(key: string): void }) {
  const press = (k: string) => {
    if (states[k] === "locked") { sfx("error"); onSay?.("locked"); return; }
    sfx("whoosh");
    onStage(k, states[k]);
  };
  const rounds = cfg.rounds.slice(0, 5);
  return (
    <>
      <div className="relative hidden lg:block w-full h-[290px]" role="list" aria-label={t("landing.journeyLabel")}>
        <svg viewBox="0 0 1000 200" preserveAspectRatio="none" className="absolute inset-x-0 top-0 w-full h-[200px] overflow-visible pointer-events-none" aria-hidden>
          <defs>
            <linearGradient id="trail" x1="0" x2="1"><stop offset="0" stopColor="#F59E0B" stopOpacity=".1" /><stop offset=".07" stopColor="#F59E0B" /><stop offset=".5" stopColor="#FDE68A" /><stop offset=".93" stopColor="#F59E0B" /><stop offset="1" stopColor="#F59E0B" stopOpacity=".15" /></linearGradient>
          </defs>
          <path d={PATH} fill="none" stroke="#F59E0B" strokeOpacity=".3" strokeWidth="14" vectorEffect="non-scaling-stroke" style={{ filter: "blur(6px)" }} />
          <motion.path d={PATH} fill="none" stroke="url(#trail)" strokeWidth="3.5" strokeLinecap="round" vectorEffect="non-scaling-stroke"
            initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.8, ease: [0.4, 0, 0.2, 1], delay: 0.5 }} />
          <path d={PATH} fill="none" stroke="#FFF7D6" strokeWidth="3" strokeLinecap="round" strokeDasharray="34 1200" vectorEffect="non-scaling-stroke" className="lp-pulse" />
        </svg>
        {/* waypoints on the wave between cards (HTML, so they stay round on the stretched SVG); they light in turn */}
        {WAYPOINTS.map((p, i) => (
          <span key={i} className="absolute -translate-x-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full bg-[#FFF3C4] lp-node" style={{ left: `${p.x / 10}%`, top: p.y, animationDelay: `${i * 1.3}s` }} aria-hidden />
        ))}
        {rounds.map((r, i) => {
          const p = NODES[i];
          return (
            // positioning on a plain element: a motion transform would replace the -50% centring
            <div key={r.key} role="listitem" onMouseEnter={() => onSay?.(r.key)} data-testid={`stage-${r.key}`} className="absolute w-[17%] max-w-[240px] -translate-x-1/2" style={{ left: `${p.x / 10}%`, top: p.y - CARD_TOP, zIndex: 2 }}>
              <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ type: "spring", stiffness: 140, damping: 16, delay: 0.8 + i * 0.14 }}>
                <div className="lp-float" style={{ animationDelay: `${i * -0.8}s` }}>
                  <StageCard k={r.key} n={i + 1} title={r.titleEn ?? ""} state={states[r.key]} here={next === r.key} onPress={() => press(r.key)} />
                </div>
              </motion.div>
            </div>
          );
        })}
      </div>

      {/* tablet / phone: vertical trail */}
      <ol className="lg:hidden relative max-w-xl mx-auto space-y-5 pl-7" aria-label={t("landing.journeyLabel")}>
        <span className="absolute left-[10px] top-8 bottom-8 w-[3px] rounded-full bg-gradient-to-b from-[#F59E0B] via-[#FDE68A] to-[#F59E0B] shadow-[0_0_12px_rgba(245,158,11,.6)]" aria-hidden />
        <span className="absolute left-[10px] top-8 bottom-8 w-[3px] lp-flow-v" aria-hidden />
        {rounds.map((r, i) => (
          <motion.li key={r.key} className="relative" initial={{ opacity: 0, x: -12 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.06 }}>
            <span className="absolute -left-[24px] top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full bg-[#FFF3C4] lp-node" style={{ animationDelay: `${i * 1.3}s` }} aria-hidden />
            <StageCard k={r.key} n={i + 1} title={r.titleEn ?? ""} state={states[r.key]} here={next === r.key} onPress={() => press(r.key)} compact />
          </motion.li>
        ))}
      </ol>
    </>
  );
}
