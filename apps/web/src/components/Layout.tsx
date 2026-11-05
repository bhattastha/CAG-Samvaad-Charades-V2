import { AnimatePresence, motion } from "framer-motion";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useConfig, useProgress } from "../lib/queries";
import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { Icon } from "./Icon";
import { usePrefs, useToasts } from "../lib/store";
import { stop as stopVoice } from "../lib/voice";
import { t } from "../lib/strings";
import { sfx } from "../lib/sfx";
import { useSettingsOpen } from "./Settings";

export function Stars({ n, total = 5, size = 28, animate = false }: { n: number; total?: number; size?: number; animate?: boolean }) {
  return (
    <div className="flex gap-1" role="img" aria-label={`${n} / ${total} ${t("common.stars")}`}>
      {Array.from({ length: total }, (_, i) => (
        <motion.svg key={i} width={size} height={size} viewBox="0 0 24 24" aria-hidden
          initial={animate && i < n ? { scale: 0, rotate: -90 } : false} animate={{ scale: 1, rotate: 0 }}
          transition={{ type: "spring", stiffness: 400, damping: 12, delay: animate ? 0.4 + i * 0.18 : 0 }}
          onAnimationStart={() => { if (animate && i < n) setTimeout(() => sfx("star"), 400 + i * 180); }}>
          <path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4 6.1 20.5l1.2-6.5L2.5 9.4l6.6-.9z" fill={i < n ? "#C49B3D" : "#E2E8F0"} stroke={i < n ? "#8A6A1F" : "#CBD5E1"} strokeWidth="1" />
          {i < n && <path d="M12 5.5l1.6 3.4" stroke="#FBF6EA" strokeWidth="1.4" strokeLinecap="round" />}
        </motion.svg>
      ))}
    </div>
  );
}

export function Coin({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <circle cx="12" cy="12" r="10" fill="#C49B3D" /><circle cx="12" cy="12" r="7.2" fill="#E9D7A6" stroke="#8A6A1F" strokeWidth="1" />
      <text x="12" y="15.6" textAnchor="middle" fontSize="9" fontWeight="800" fill="#5C4511">C</text>
    </svg>
  );
}

/** The page language (the BHASHINI translation plugin may change <html lang>). */
function useHtmlLang() {
  const [lang, setLang] = useState(document.documentElement.lang || "en");
  useEffect(() => {
    const o = new MutationObserver(() => setLang(document.documentElement.lang || "en"));
    o.observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });
    return () => o.disconnect();
  }, []);
  return lang;
}

/** "Samvaad Charades" is a brand: never translated, only shown in its localised spelling for the page language. */
export function BrandName({ split = false, className = "" }: { split?: boolean; className?: string }) {
  const { data: cfg } = useConfig();
  const lang = useHtmlLang().slice(0, 2);
  const name = cfg?.brand?.localized?.[lang] ?? cfg?.brand?.name ?? t("common.gameName");
  const [first, ...rest] = name.split(" ");
  return (
    <span translate="no" className={`notranslate ${className}`} data-brand>
      {split ? <><span className="text-navy">{first}</span> <span className="text-primary">{rest.join(" ")}</span></> : name}
    </span>
  );
}

/** HUD credits meter: glanceable progress toward 50; gold = reward. */
export function CreditMeter({ value, max = 50, compact = false }: { value: number; max?: number; compact?: boolean }) {
  return (
    <div className={`flex items-center gap-2 rounded-md bg-gold-soft border border-gold-light ${compact ? "px-2 py-1" : "px-2.5 py-1.5"}`} title={`${value} / ${max} ${t("common.credits")}`}>
      <Coin size={compact ? 16 : 18} />
      <div className="hidden sm:block w-16 h-1.5 rounded-full bg-gold-light/60 overflow-hidden">
        <motion.div className="h-full bg-gradient-to-r from-gold to-primary" initial={{ width: 0 }} animate={{ width: `${(value / max) * 100}%` }} transition={{ type: "spring", stiffness: 80, damping: 18 }} />
      </div>
      <span className="font-bold text-gold-deep tnum text-sm">{value}<span className="font-semibold text-gold-deep/60">/{max}</span></span>
    </div>
  );
}

export const initials = (name?: string) => (name ?? "").trim().split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";

/** Player avatar: initials on a tier-coloured ring. */
export function Avatar({ name, size = 36, ring = "#C49B3D" }: { name?: string; size?: number; ring?: string }) {
  return (
    <span className="relative inline-grid place-items-center rounded-full bg-navy text-white font-bold shrink-0" style={{ width: size, height: size, fontSize: size * 0.38, boxShadow: `0 0 0 2px #fff, 0 0 0 4px ${ring}` }} aria-hidden>
      {initials(name)}
    </span>
  );
}

function ProfileMenu({ name, office }: { name: string; office?: string }) {
  const [open, setOpen] = useState(false);
  const nav = useNavigate();
  const qc = useQueryClient();
  const openSettings = useSettingsOpen((s) => s.set);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => { if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close); document.addEventListener("keydown", close);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", close); };
  }, [open]);
  const go = (to: string) => { setOpen(false); sfx("tap"); nav(to); };
  const signOut = async () => {
    setOpen(false);
    await api("/auth/logout", { method: "POST", body: {} }).catch(() => undefined);
    qc.clear();
    nav("/", { replace: true });
  };
  const items: [string, string, () => void][] = [
    ["user", t("nav.profile"), () => go("/profile")],
    ["route", t("nav.levels"), () => go("/journey")],
    ["trophy", t("nav.leaderboard"), () => go("/leaderboard")],
    ["award", t("nav.certificate"), () => go("/total")],
    ["settings", t("common.settings"), () => { setOpen(false); openSettings(true); }],
  ];
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open} data-testid="profile-menu"
        className="flex items-center gap-2 rounded-full pl-1 pr-2 py-1 hover:bg-navy-50 transition">
        <Avatar name={name} size={32} />
        <span className="hidden xl:block text-left leading-tight max-w-[150px]">
          <span className="block text-sm font-bold text-navy truncate">{name}</span>
          {office && <span className="block text-[11px] text-muted truncate">{office}</span>}
        </span>
        <Icon name="chevronDown" size={16} className={`text-muted transition ${open ? "rotate-180" : ""}`} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div role="menu" initial={{ opacity: 0, y: -6, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.14 }}
            className="absolute right-0 mt-2 w-64 rounded-card bg-white border border-slate-200 shadow-pop overflow-hidden z-50">
            <div className="px-4 py-3 bg-navy text-white hud-grid flex items-center gap-3">
              <Avatar name={name} size={40} />
              <div className="min-w-0"><div className="font-bold truncate">{name}</div>{office && <div className="text-xs text-blue-100/80 truncate">{office}</div>}</div>
            </div>
            <div className="py-1">
              {items.map(([icon, label, fn]) => (
                <button key={label} role="menuitem" onClick={fn} className="w-full flex items-center gap-3 px-4 py-2.5 text-[15px] text-navy hover:bg-navy-50 text-left">
                  <Icon name={icon} size={17} className="text-navy-600" />{label}
                </button>
              ))}
            </div>
            <button role="menuitem" onClick={signOut} className="w-full flex items-center gap-3 px-4 py-2.5 text-[15px] text-timer-text hover:bg-red-50 border-t border-slate-100 text-left">
              <Icon name="logout" size={17} />{t("nav.signOut")}
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Sahayika's voice on/off from any screen (off = lines show as subtitles only). */
function VoiceMute() {
  const voice = usePrefs((st) => st.voice);
  const set = usePrefs((st) => st.set);
  const unlock = usePrefs((st) => st.unlockAudio);
  const on = voice === "auto";
  return (
    <button role="switch" aria-checked={on} data-testid="voice-mute-toggle" title={on ? t("landing.soundOn") : t("landing.soundOff")} aria-label={t("title.voiceToggle")}
      onClick={() => { unlock(); set("voice", on ? "tap" : "auto"); sfx("tap"); if (on) stopVoice(); }}
      className={`rounded-md border w-9 h-9 grid place-items-center hover:bg-navy-50 ${on ? "border-navy/30 bg-navy-50 text-navy" : "border-slate-200 bg-white text-muted"}`}>
      <Icon name={on ? "volume" : "mute"} size={18} />
    </button>
  );
}

/** Global header (§7): CAG left, brand, BHASHINI right; after sign-in the portal nav, HUD and profile menu. */
export function Header({ compact = false, hud = true, wide = false }: { compact?: boolean; hud?: boolean; wide?: boolean }) {
  const { data } = useProgress();
  const openSettings = useSettingsOpen((s) => s.set);
  const { pathname } = useLocation();
  const s = data?.summary;
  const signedIn = !!data?.registered;
  const navItems: [string, string, string][] = [["/journey", t("nav.levels"), "route"], ["/leaderboard", t("nav.leaderboard"), "trophy"], ["/profile", t("nav.profile"), "user"]];
  return (
    <header className="sticky top-0 z-30 bg-white border-b border-slate-200">
      <div className="h-[3px] bg-gradient-to-r from-primary via-gold to-navy-600" aria-hidden />
      <div className={`mx-auto ${wide ? "max-w-[2000px] px-3 sm:px-5" : "max-w-7xl px-3 sm:px-6"} flex items-center gap-2 sm:gap-4 ${compact ? "h-[60px]" : "h-[72px]"}`}>
        {/* official marks together, exactly as on the landing page (white plate, original colours) */}
        <Link to={signedIn ? "/journey" : "/"} className="flex items-center gap-3 min-w-0 flex-1 md:flex-none" aria-label={t("common.gameName")}>
          <span className={`flex items-center gap-2 sm:gap-3 rounded-xl bg-white ring-1 ring-slate-200 shadow-sm ${compact ? "px-2 py-1" : "px-2.5 py-1.5"}`}>
            <img src="/landing/cag-logo.png" alt="Comptroller and Auditor General of India" className={`${compact ? "h-10" : "h-12"} w-auto`} width={195} height={240} />
            <span className="w-px self-stretch bg-slate-200" aria-hidden />
            <img src="/landing/bhashini-logo.png" alt="Digital India BHASHINI" className={`${compact ? "h-7" : "h-9"} w-auto`} width={330} height={160} />
          </span>
          <span className="leading-tight min-w-0 hidden sm:block">
            <span className={`block ${compact ? "text-base" : "text-lg sm:text-xl"} font-extrabold whitespace-nowrap tracking-tight`}><BrandName split /></span>
            <span className="block en text-[10px] tracking-[0.24em] text-muted">{t("common.brandLine")}</span>
          </span>
        </Link>
        {signedIn && !compact && (
          <nav className="hidden lg:flex items-center gap-1 flex-1 justify-center" aria-label={t("nav.main")}>
            {navItems.map(([to, label, icon]) => {
              const on = pathname === to || (to === "/journey" && pathname.startsWith("/play"));
              return (
                <Link key={to} to={to} aria-current={on ? "page" : undefined}
                  className={`relative inline-flex items-center gap-1.5 whitespace-nowrap px-3 py-2 rounded-md text-[15px] font-semibold transition ${on ? "text-navy bg-navy-50" : "text-muted hover:text-navy hover:bg-slate-50"}`}>
                  <Icon name={icon} size={16} />{label}
                  {/* plain element on purpose: a shared-layout (layoutId) underline registers with the scene's exit
                      presence and, when a loading header unmounts early, leaves the old scene stuck at opacity 0 */}
                  {on && <span className="absolute left-2 right-2 -bottom-[13px] h-[3px] rounded-t bg-primary" />}
                </Link>
              );
            })}
          </nav>
        )}
        <div className="flex items-center gap-2 ml-auto">
          <VoiceMute />
          {hud && s && (
            <>
              <CreditMeter value={s.totalCredits} compact={compact} />
              <span className="hidden xl:inline-flex chip-plain"><Stars n={s.stars} total={s.starsTotal} size={14} /></span>
            </>
          )}
          {signedIn && data?.player ? (
            <ProfileMenu name={data.player.name} office={data.player.office} />
          ) : (
            <button onClick={() => { sfx("tap"); openSettings(true); }}
              className="rounded-md border border-slate-200 bg-white w-9 h-9 grid place-items-center text-navy hover:bg-navy-50" aria-label={t("common.settings")} title={t("common.settings")}>
              <Icon name="settings" size={18} />
            </button>
          )}
        </div>
      </div>
    </header>
  );
}

export function PageTitle({ hi, en, right, kicker }: { hi: string; en?: string; right?: React.ReactNode; kicker?: string }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
      <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ type: "spring", stiffness: 200, damping: 22 }}>
        {kicker && <div className="kicker mb-1.5 flex items-center gap-2"><span className="w-5 h-[2px] bg-primary" />{kicker}</div>}
        <h1 className="text-[1.9rem] sm:text-[2.35rem] font-extrabold text-navy leading-tight tracking-tight">{hi}</h1>
        {en && <div className="text-base sm:text-[1.05rem] text-muted mt-1">{en}</div>}
      </motion.div>
      {right && <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="flex flex-wrap items-center gap-2">{right}</motion.div>}
    </div>
  );
}

export function Page({ children, wide = false }: { children: React.ReactNode; wide?: boolean }) {
  return <main className={`relative mx-auto ${wide ? "max-w-[1400px]" : "max-w-7xl"} px-4 sm:px-6 py-6 sm:py-8`}>{children}</main>;
}

export function Toasts() {
  const items = useToasts((s) => s.items);
  return (
    <div className="fixed z-[95] left-1/2 -translate-x-1/2 top-20 flex flex-col items-center gap-2 pointer-events-none" aria-live="polite">
      <AnimatePresence>
        {items.map((x) => (
          <motion.div key={x.id} initial={{ y: -30, opacity: 0, scale: 0.9 }} animate={{ y: 0, opacity: 1, scale: 1 }} exit={{ y: -20, opacity: 0 }}
            className={`rounded-md px-4 py-2.5 text-[0.98rem] font-semibold shadow-pop flex items-center gap-2 border-l-4 ${x.tone === "warn" ? "bg-navy text-white border-primary" : x.tone === "good" ? "bg-navy text-white border-success" : "bg-navy text-white border-gold"}`}>
            <Icon name={x.tone === "warn" ? "lock" : x.tone === "good" ? "check" : "info"} size={17} /> {x.text}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

export function Confetti({ run }: { run: boolean }) {
  if (!run) return null;
  const colors = ["#E85A1A", "#C49B3D", "#E9D7A6", "#1D4E89", "#0B2545", "#FFFFFF"];
  return (
    <div className="pointer-events-none fixed inset-0 z-[70] overflow-hidden" aria-hidden>
      <style>{`@keyframes hcfall{0%{transform:translateY(-10vh) rotate(0)}100%{transform:translateY(110vh) rotate(720deg)}}`}</style>
      {Array.from({ length: 60 }, (_, i) => (
        <span key={i} style={{
          position: "absolute", left: `${(i * 37) % 100}%`, top: 0, width: 8 + (i % 4) * 2, height: 12 + (i % 3) * 3,
          background: colors[i % colors.length], borderRadius: i % 3 ? 2 : 99,
          animation: `hcfall ${2.6 + (i % 7) * 0.35}s ${(i % 10) * 0.12}s cubic-bezier(.3,.6,.4,1) forwards`,
        }} />
      ))}
    </div>
  );
}

/** Loading filler: a spinning "अ ↔ A" coin instead of a bare spinner. */
export function Spinner() {
  return (
    <div className="grid place-items-center py-24 text-muted gap-4">
      <div className="relative w-14 h-14">
        <motion.span className="absolute inset-0 rounded-full border-[3px] border-slate-200 border-t-primary" animate={{ rotate: 360 }} transition={{ duration: 0.9, repeat: Infinity, ease: "linear" }} />
        <span className="absolute inset-0 grid place-items-center text-xl font-bold text-navy">अ</span>
      </div>
      <div className="font-semibold">{t("common.loading")}</div>
    </div>
  );
}

export function ProgressBar({ value, tone = "orange", striped = false, label, checkpoints }: { value: number; tone?: "orange" | "blue" | "green" | "soft" | "gold"; striped?: boolean; label?: string; checkpoints?: number }) {
  const c = { orange: "bg-primary", blue: "bg-navy-600", green: "bg-success", soft: "bg-orange-300", gold: "bg-gradient-to-r from-gold to-primary" }[tone];
  return (
    <div className="relative h-2.5 w-full rounded-full bg-slate-100 overflow-hidden" role="progressbar" aria-valuenow={Math.round(value * 100)} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <motion.div className={`h-full rounded-full ${c} ${striped ? "stripe animate-shine" : ""}`} initial={{ width: 0 }} animate={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} transition={{ type: "spring", stiffness: 90, damping: 20 }} />
      {checkpoints && Array.from({ length: checkpoints - 1 }, (_, i) => (
        <span key={i} className="absolute top-0 bottom-0 w-[2px] bg-white/80" style={{ left: `${((i + 1) / checkpoints) * 100}%` }} aria-hidden />
      ))}
    </div>
  );
}
