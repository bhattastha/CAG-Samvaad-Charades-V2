import { useId, useRef, useState } from "react";
import { useReducedMotion } from "framer-motion";

/** Metal palettes (highlight → base → shadow, rim, numeral face) and ribbon accent per level title. */
const METAL: Record<string, { hi: string; base: string; lo: string; rim: string; face: string; ribbon: string; numeral: string; metal: string; royal?: boolean }> = {
  trial: { hi: "#F3C08A", base: "#CD7F32", lo: "#7A4A1E", rim: "#5C3714", face: "#E8A866", ribbon: "#1E3A5F", numeral: "I", metal: "Bronze" },
  primary: { hi: "#FFFFFF", base: "#C0C0C0", lo: "#7D7D7D", rim: "#5E5E5E", face: "#E6E6E6", ribbon: "#1E3A5F", numeral: "II", metal: "Silver" },
  secondary: { hi: "#FFF1A8", base: "#D4A017", lo: "#8A6500", rim: "#6B4E00", face: "#F5CF4A", ribbon: "#1E3A5F", numeral: "III", metal: "Gold" },
  pro: { hi: "#FFFFFF", base: "#E5E4E2", lo: "#A9B4BE", rim: "#6F7C88", face: "#F4F6F8", ribbon: "#1E3A5F", numeral: "IV", metal: "Platinum" },
  varchaspati: { hi: "#B794F6", base: "#6D28D9", lo: "#3B0F7A", rim: "#D4A017", face: "#F5CF4A", ribbon: "#D4A017", numeral: "V", metal: "Royal", royal: true },
};
export const metalOf = (k: string) => METAL[k]?.metal ?? "Bronze";

// shield silhouette (outer rim) and the recessed inner face, in a 64 × 64 box
const SHIELD = "M32 4l22 7.5v15c0 15-9.3 27.2-22 32.8C19.3 53.7 10 41.5 10 26.5V11.5z";
const FACE = "M32 9.4l17 5.8v11.4c0 11.8-7.2 21.4-17 26C22.2 48 15 38.4 15 26.6V15.2z";

export type BadgeState = "won" | "locked" | "phase2";

/**
 * 3D metal badge: bevelled rim around a recessed brushed face, embossed numeral, top-left light with a specular streak,
 * two-tail ribbon and a soft drop shadow. Vector-only, so it stays sharp from 18 px to 96 px.
 * Hover tilts it (max 8°) and the highlight follows; `sweep` plays a one-off 1 s shine (first unlock). Reduced motion: neither.
 */
export function Medal({ k, size = 72, locked = false, shine = false, phase2 = false, sweep = false }: { k: string; size?: number; locked?: boolean; shine?: boolean; phase2?: boolean; sweep?: boolean }) {
  const m = METAL[k] ?? METAL.trial!;
  const uid = useId().replace(/:/g, "");
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const [tilt, setTilt] = useState({ x: 0, y: 0 });
  const state: BadgeState = phase2 || (k === "varchaspati" && locked) ? "phase2" : locked ? "locked" : "won";
  const interactive = !reduce && size >= 32;
  const onMove = (e: React.MouseEvent) => {
    if (!interactive || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - 0.5, py = (e.clientY - r.top) / r.height - 0.5;
    setTilt({ x: -py * 16, y: px * 16 }); // ±8°
  };
  const blur = size >= 48 ? 10 : Math.max(2, size * 0.2);
  const filter = state === "locked" ? "grayscale(1)" : state === "phase2" ? "saturate(.55) brightness(1.05)" : "none";
  const opacity = state === "locked" ? 0.4 : state === "phase2" ? 0.5 : 1;
  const id = (s: string) => `${uid}-${s}`;
  const off = { x: tilt.y * 0.5, y: tilt.x * -0.5 };
  const n = m.numeral;
  const fs = n.length >= 3 ? 15 : n.length === 2 ? 18 : 21;
  return (
    <div ref={ref} className="relative grid place-items-center shrink-0" style={{ width: size, height: size, perspective: 400 }} aria-hidden
      data-metal={m.metal} data-state={state} data-testid={`medal-${k}`} onMouseMove={onMove} onMouseLeave={() => setTilt({ x: 0, y: 0 })}>
      <div style={{ width: size, height: size, transform: `rotateX(${tilt.x}deg) rotateY(${tilt.y}deg)`, transition: "transform 180ms ease-out", filter, opacity, transformStyle: "preserve-3d" }}>
        <svg viewBox="0 0 64 64" width={size} height={size} style={{ filter: `drop-shadow(0 ${size >= 48 ? 4 : 2}px ${blur}px rgba(0,0,0,.25))`, overflow: "visible" }}>
          <defs>
            <linearGradient id={id("rim")} x1="0.1" y1="0" x2="0.9" y2="1">
              <stop offset="0" stopColor={m.royal ? "#FFE58A" : m.hi} /><stop offset=".45" stopColor={m.royal ? "#D4A017" : m.base} /><stop offset="1" stopColor={m.royal ? "#7A5A0E" : m.lo} />
            </linearGradient>
            <linearGradient id={id("face")} x1="0.15" y1="0" x2="0.85" y2="1">
              <stop offset="0" stopColor={m.hi} /><stop offset=".55" stopColor={m.base} /><stop offset="1" stopColor={m.lo} />
            </linearGradient>
            <linearGradient id={id("num")} x1="0" y1="0" x2="0.4" y2="1"><stop offset="0" stopColor="#FFFFFF" stopOpacity=".9" /><stop offset=".35" stopColor={m.face} /><stop offset="1" stopColor={m.royal ? "#B8860B" : m.base} /></linearGradient>
            <linearGradient id={id("spec")} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#fff" stopOpacity="0" /><stop offset=".45" stopColor="#fff" stopOpacity=".85" /><stop offset=".6" stopColor="#fff" stopOpacity="0" /></linearGradient>
            {/* fine brushed-metal sheen: thin horizontal lines */}
            <pattern id={id("brush")} width="64" height="1.4" patternUnits="userSpaceOnUse"><rect width="64" height=".5" fill="#fff" opacity=".10" /><rect y=".7" width="64" height=".35" fill="#000" opacity=".05" /></pattern>
            {/* recessed face: inner shadow at the top-left edge, light at the bottom-right */}
            <filter id={id("inset")} x="-10%" y="-10%" width="120%" height="120%">
              <feOffset dx=".9" dy="1.1" in="SourceAlpha" result="o" /><feGaussianBlur in="o" stdDeviation=".9" result="b" />
              <feComposite in="SourceAlpha" in2="b" operator="out" result="ring" /><feFlood floodColor="#000" floodOpacity=".45" /><feComposite in2="ring" operator="in" result="shadow" />
              <feMerge><feMergeNode in="SourceGraphic" /><feMergeNode in="shadow" /></feMerge>
            </filter>
            <clipPath id={id("clip")}><path d={SHIELD} /></clipPath>
            {m.metal === "Platinum" && <linearGradient id={id("cool")} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#E0F2FE" stopOpacity=".55" /><stop offset="1" stopColor="#E0F2FE" stopOpacity="0" /></linearGradient>}
          </defs>

          {/* ribbon: two tails behind the bottom of the shield */}
          <g transform={m.royal ? "translate(4.5 8.5) scale(.86)" : undefined}>
            <path d="M20 46l-5 17 6-3.2 4 4.2 4.5-14z" fill={m.ribbon} /><path d="M44 46l5 17-6-3.2-4 4.2-4.5-14z" fill={m.ribbon} />
            <path d="M20 46l-5 17 6-3.2z" fill="#000" opacity=".22" /><path d="M44 46l5 17-6-3.2z" fill="#000" opacity=".12" />
          </g>

          {/* crown for the Royal title */}
          {m.royal && (
            <g>
              <path d="M22.5 9.2l1.6-6.4 4.3 3.6L32 .8l3.6 5.6 4.3-3.6 1.6 6.4z" fill={`url(#${id("rim")})`} stroke="#7A5A0E" strokeWidth=".6" strokeLinejoin="round" />
              <rect x="22.5" y="8.4" width="19" height="2.4" rx=".8" fill="#B8860B" />
              <path d="M24 3.4l.8 4.4M31.4 2.2l.6 5.4" stroke="#FFF7D1" strokeWidth=".7" opacity=".8" strokeLinecap="round" />
              {state === "won" && <path className={reduce ? "" : "badge-sparkle"} d="M45 2.2l.7 1.7 1.7.7-1.7.7-.7 1.7-.7-1.7-1.7-.7 1.7-.7z" fill="#FFF7D1" />}
            </g>
          )}

          <g transform={m.royal ? "translate(4.5 8.5) scale(.86)" : undefined}>
          {/* raised outer rim (bevel) */}
          <path d={SHIELD} fill={`url(#${id("rim")})`} stroke={m.rim} strokeWidth="1.1" strokeLinejoin="round" />
          <path d="M32 5.6l20.4 7" stroke="#fff" strokeOpacity=".7" strokeWidth="1" strokeLinecap="round" />
          <path d="M11.6 12.6L32 5.6" stroke="#fff" strokeOpacity=".9" strokeWidth="1" strokeLinecap="round" />
          {/* recessed inner face with brushed sheen */}
          <g filter={`url(#${id("inset")})`}>
            <path d={FACE} fill={`url(#${id("face")})`} />
            <path d={FACE} fill={`url(#${id("brush")})`} />
            {m.metal === "Platinum" && <path d={FACE} fill={`url(#${id("cool")})`} />}
          </g>
          <path d={FACE} fill="none" stroke={m.rim} strokeOpacity=".55" strokeWidth=".6" />

          {/* embossed numeral: dark offset below-right, light offset above-left, then the bevelled face */}
          <g fontFamily="'Noto Serif', Georgia, serif" fontWeight="800" fontSize={fs} textAnchor="middle" letterSpacing=".4">
            <text x="33" y="37.9" fill={m.royal ? "#3B0F7A" : m.rim} opacity=".9">{n}</text>
            <text x="31.4" y="36.2" fill="#fff" opacity=".75">{n}</text>
            <text x="32" y="36.9" fill={`url(#${id("num")})`} stroke={m.rim} strokeWidth=".9" paintOrder="stroke">{n}</text>
          </g>

          {/* specular highlight streak across the upper-left; shifts with the tilt */}
          <g clipPath={`url(#${id("clip")})`}>
            <path d="M8 26C16 12 30 6 46 6l-2 5C30 12 20 18 13 30z" fill={`url(#${id("spec")})`} opacity={state === "won" ? 0.75 : 0.35} transform={`translate(${off.x} ${off.y})`} style={{ transition: "transform 180ms ease-out" }} />
            <path d={SHIELD} fill="#000" opacity=".12" transform="translate(5 6)" />
            {(sweep || shine) && state === "won" && !reduce && (
              <rect className={sweep ? "badge-sweep-once" : "badge-sweep"} x="-30" y="0" width="22" height="64" fill="#fff" opacity=".55" />
            )}
          </g>
          </g>
        </svg>
      </div>
      {state === "locked" && size >= 24 && (
        <span className="absolute bottom-0 right-0 grid place-items-center rounded-full bg-slate-700 text-white ring-2 ring-white" style={{ width: Math.max(12, size * 0.3), height: Math.max(12, size * 0.3) }} data-testid={`medal-lock-${k}`}>
          <svg viewBox="0 0 16 16" width="60%" height="60%"><path d="M5 7V5.2a3 3 0 016 0V7M4 7h8v6H4z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /></svg>
        </span>
      )}
    </div>
  );
}
