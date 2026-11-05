import { useState, type ReactNode } from "react";

/**
 * Small inline-SVG charts for the console (no chart library). Colour-blind-safe palette (Okabe–Ito
 * family, tuned for contrast on white); every mark carries a <title> tooltip and every chart has an
 * aria-label plus a visually hidden data table for screen readers.
 */
export const PALETTE = ["#1F5FA8", "#E69F00", "#009E73", "#CC79A7", "#56B4E9", "#D55E00", "#7A5E1C"];
export const LEVEL_COLORS: Record<string, string> = { trial: "#C77B30", primary: "#8A97A8", secondary: "#D6A642", pro: "#2B5FB8", varchaspati: "#7C3AED" };

const AXIS = "#94A3B8";
const GRID = "#E2E8F0";
const LABEL = "#475569";

function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const m = v / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
}
const ticks = (max: number, n = 4) => Array.from({ length: n + 1 }, (_, i) => (max / n) * i);
const fmtTick = (v: number) => (v >= 1000 ? `${Math.round(v / 100) / 10}k` : Number.isInteger(v) ? String(v) : v.toFixed(1));

export function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
      {items.map((i) => (
        <li key={i.label} className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: i.color }} aria-hidden />{i.label}</li>
      ))}
    </ul>
  );
}

function SrTable({ caption, head, rows }: { caption: string; head: string[]; rows: (string | number | null)[][] }) {
  return (
    <table className="sr-only">
      <caption>{caption}</caption>
      <thead><tr>{head.map((h) => <th key={h} scope="col">{h}</th>)}</tr></thead>
      <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c ?? "—"}</td>)}</tr>)}</tbody>
    </table>
  );
}

export interface Series { key: string; label: string; color: string }

/** Multi-series line chart with the first series filled as an area. */
export function LineTrend({ data, series, xKey, label, height = 220, yLabel }: { data: Record<string, any>[]; series: Series[]; xKey: string; label: string; height?: number; yLabel?: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 720, H = height, L = 40, R = 12, T = 12, B = 30;
  const max = niceMax(Math.max(1, ...data.flatMap((d) => series.map((s) => Number(d[s.key]) || 0))));
  const x = (i: number) => L + (data.length <= 1 ? (W - L - R) / 2 : (i / (data.length - 1)) * (W - L - R));
  const y = (v: number) => T + (1 - v / max) * (H - T - B);
  const every = Math.max(1, Math.ceil(data.length / 8));
  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={label} className="overflow-visible">
        {ticks(max).map((t) => (
          <g key={t}><line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke={GRID} /><text x={L - 6} y={y(t) + 4} fontSize="11" textAnchor="end" fill={LABEL}>{fmtTick(t)}</text></g>
        ))}
        <line x1={L} x2={W - R} y1={y(0)} y2={y(0)} stroke={AXIS} />
        {yLabel && <text x={10} y={T + (H - T - B) / 2} fontSize="11" fill={LABEL} transform={`rotate(-90 10 ${T + (H - T - B) / 2})`} textAnchor="middle">{yLabel}</text>}
        {data.map((d, i) => i % every === 0 || i === data.length - 1 ? <text key={i} x={x(i)} y={H - 10} fontSize="11" textAnchor="middle" fill={LABEL}>{String(d[xKey])}</text> : null)}
        {series.map((s, si) => {
          const pts = data.map((d, i) => `${x(i)},${y(Number(d[s.key]) || 0)}`).join(" ");
          return (
            <g key={s.key}>
              {si === 0 && data.length > 1 && <polygon points={`${x(0)},${y(0)} ${pts} ${x(data.length - 1)},${y(0)}`} fill={s.color} opacity={0.12} />}
              <polyline points={pts} fill="none" stroke={s.color} strokeWidth={2.2} strokeLinejoin="round" strokeDasharray={si === 2 ? "5 4" : si === 1 ? undefined : undefined} />
              {data.map((d, i) => <circle key={i} cx={x(i)} cy={y(Number(d[s.key]) || 0)} r={hover === i ? 4 : data.length > 40 ? 0 : 2.5} fill="#fff" stroke={s.color} strokeWidth={2} />)}
            </g>
          );
        })}
        {data.map((d, i) => (
          <rect key={i} x={x(i) - (W - L - R) / Math.max(1, data.length) / 2} y={T} width={(W - L - R) / Math.max(1, data.length)} height={H - T - B} fill="transparent"
            onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            <title>{`${d[xKey]}: ${series.map((s) => `${s.label} ${d[s.key] ?? 0}`).join(" · ")}`}</title>
          </rect>
        ))}
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={T} y2={y(0)} stroke={AXIS} strokeDasharray="3 3" pointerEvents="none" />}
      </svg>
      <figcaption className="mt-2 flex flex-wrap items-center gap-3">
        <Legend items={series.map((s) => ({ label: s.label, color: s.color }))} />
        {hover !== null && <span className="ml-auto text-xs text-slate-600 tabular-nums">{data[hover][xKey]} · {series.map((s) => `${s.label}: ${data[hover][s.key] ?? 0}`).join(" · ")}</span>}
      </figcaption>
      <SrTable caption={label} head={[xKey, ...series.map((s) => s.label)]} rows={data.map((d) => [d[xKey], ...series.map((s) => d[s.key])])} />
    </figure>
  );
}

/** Vertical histogram with an optional threshold marker (e.g. the pass mark). */
export function Histogram({ bins, color = PALETTE[0], label, xLabel, yLabel = "Players", markAt, markLabel, height = 170 }: {
  bins: { label: string; n: number; from?: number }[]; color?: string; label: string; xLabel?: string; yLabel?: string; markAt?: number; markLabel?: string; height?: number;
}) {
  const W = 360, H = height, L = 30, R = 8, T = 14, B = xLabel ? 34 : 22;
  const max = niceMax(Math.max(1, ...bins.map((b) => b.n)));
  const bw = (W - L - R) / bins.length;
  const y = (v: number) => T + (1 - v / max) * (H - T - B);
  const mx = markAt !== undefined ? L + (markAt / 100) * (W - L - R) : null;
  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={label}>
        {ticks(max, 2).map((t) => <g key={t}><line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke={GRID} /><text x={L - 5} y={y(t) + 4} fontSize="10" textAnchor="end" fill={LABEL}>{fmtTick(t)}</text></g>)}
        {bins.map((b, i) => (
          <g key={i}>
            <rect x={L + i * bw + 1.5} y={y(b.n)} width={bw - 3} height={Math.max(0, y(0) - y(b.n))} fill={color} rx={1.5}><title>{`${b.label}: ${b.n} ${yLabel.toLowerCase()}`}</title></rect>
            {b.n > 0 && <text x={L + i * bw + bw / 2} y={y(b.n) - 3} fontSize="9.5" textAnchor="middle" fill={LABEL}>{b.n}</text>}
            {(bins.length <= 6 || i % 2 === 0) && <text x={L + i * bw + bw / 2} y={H - (xLabel ? 20 : 8)} fontSize="9.5" textAnchor="middle" fill={LABEL}>{b.label}</text>}
          </g>
        ))}
        <line x1={L} x2={W - R} y1={y(0)} y2={y(0)} stroke={AXIS} />
        {mx !== null && <g><line x1={mx} x2={mx} y1={T - 6} y2={y(0)} stroke="#B42318" strokeWidth={1.5} strokeDasharray="4 3" /><text x={mx + 3} y={T} fontSize="9.5" fill="#B42318">{markLabel}</text></g>}
        {xLabel && <text x={L + (W - L - R) / 2} y={H - 4} fontSize="10" textAnchor="middle" fill={LABEL}>{xLabel}</text>}
      </svg>
      <SrTable caption={label} head={["Range", yLabel]} rows={bins.map((b) => [b.label, b.n])} />
    </figure>
  );
}

/** Donut with centre label and legend with values. */
export function Donut({ parts, label, center, sub, size = 150 }: { parts: { label: string; value: number; color: string }[]; label: string; center?: ReactNode; sub?: string; size?: number }) {
  const total = parts.reduce((a, p) => a + p.value, 0);
  const r = 15.915; // circumference = 100
  let acc = 0;
  return (
    <figure className="flex items-center gap-4">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg viewBox="0 0 42 42" width={size} height={size} role="img" aria-label={label}>
          <circle cx="21" cy="21" r={r} fill="none" stroke={GRID} strokeWidth="6" />
          {total > 0 && parts.map((p) => {
            const len = (p.value / total) * 100;
            const el = <circle key={p.label} cx="21" cy="21" r={r} fill="none" stroke={p.color} strokeWidth="6" strokeDasharray={`${len} ${100 - len}`} strokeDashoffset={25 - acc}><title>{`${p.label}: ${p.value} (${Math.round(len)}%)`}</title></circle>;
            acc += len;
            return el;
          })}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          <div className="text-lg font-bold tabular-nums text-slate-900">{center ?? total}</div>
          {sub && <div className="text-[10px] uppercase tracking-wide text-slate-500">{sub}</div>}
        </div>
      </div>
      <ul className="space-y-1 text-xs">
        {parts.map((p) => (
          <li key={p.label} className="flex items-center gap-2"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: p.color }} aria-hidden />
            <span className="text-slate-600">{p.label}</span><span className="ml-auto pl-3 font-semibold tabular-nums text-slate-900">{p.value}</span>
            <span className="w-10 text-right tabular-nums text-slate-400">{total ? `${Math.round((p.value / total) * 100)}%` : ""}</span></li>
        ))}
      </ul>
    </figure>
  );
}

/** Horizontal bars, one per row; value labels at the bar end. */
export function HBars({ rows, label, max, unit = "", color = PALETTE[0], valueFmt }: {
  rows: { label: ReactNode; value: number | null; color?: string; title?: string; sub?: ReactNode }[]; label: string; max?: number; unit?: string; color?: string; valueFmt?: (v: number) => string;
}) {
  const m = max ?? niceMax(Math.max(1, ...rows.map((r) => r.value ?? 0)));
  return (
    <div role="img" aria-label={label} className="space-y-1.5">
      {rows.map((r, i) => (
        <div key={i} className="grid grid-cols-[minmax(7rem,38%)_1fr_3.5rem] items-center gap-2 text-xs">
          <div className="truncate text-slate-700" title={r.title}>{r.label}{r.sub && <span className="ml-1 text-slate-400">{r.sub}</span>}</div>
          <svg viewBox="0 0 100 10" preserveAspectRatio="none" className="h-3.5 w-full" aria-hidden>
            <rect x="0" y="0" width="100" height="10" fill="#F1F5F9" rx="1.5" />
            <rect x="0" y="0" width={Math.max(0, Math.min(100, ((r.value ?? 0) / m) * 100))} height="10" fill={r.color ?? color} rx="1.5"><title>{`${r.title ?? (typeof r.label === "string" ? r.label : "")}: ${r.value ?? "—"}${unit}`}</title></rect>
          </svg>
          <div className="text-right font-semibold tabular-nums text-slate-900">{r.value === null ? "—" : valueFmt ? valueFmt(r.value) : `${r.value}${unit}`}</div>
        </div>
      ))}
    </div>
  );
}

/** Horizontal stacked bar per row (e.g. measure breakdown per level, attempt outcomes). */
export function StackedBars({ rows, keys, label, unit = "", normalise = false }: {
  rows: { label: string; values: Record<string, number | null> }[]; keys: Series[]; label: string; unit?: string; normalise?: boolean;
}) {
  const totals = rows.map((r) => keys.reduce((a, k) => a + (r.values[k.key] ?? 0), 0));
  const max = normalise ? 1 : niceMax(Math.max(1, ...totals));
  return (
    <figure>
      <div role="img" aria-label={label} className="space-y-2">
        {rows.map((r, i) => {
          let x = 0;
          const tot = totals[i] || 1;
          return (
            <div key={r.label} className="grid grid-cols-[7rem_1fr_3.5rem] items-center gap-2 text-xs">
              <div className="truncate text-slate-700">{r.label}</div>
              <svg viewBox="0 0 100 10" preserveAspectRatio="none" className="h-4 w-full" aria-hidden>
                <rect x="0" y="0" width="100" height="10" fill="#F1F5F9" />
                {keys.map((k) => {
                  const v = r.values[k.key] ?? 0;
                  const w = (normalise ? v / tot : v / max) * 100;
                  const el = <rect key={k.key} x={x} y="0" width={Math.max(0, w)} height="10" fill={k.color} stroke="#fff" strokeWidth="0.3"><title>{`${r.label} · ${k.label}: ${v}${unit}`}</title></rect>;
                  x += w;
                  return el;
                })}
              </svg>
              <div className="text-right font-semibold tabular-nums text-slate-900">{totals[i]}{normalise ? "" : unit}</div>
            </div>
          );
        })}
      </div>
      <figcaption className="mt-2"><Legend items={keys.map((k) => ({ label: k.label, color: k.color }))} /></figcaption>
      <SrTable caption={label} head={["Row", ...keys.map((k) => k.label)]} rows={rows.map((r) => [r.label, ...keys.map((k) => r.values[k.key])])} />
    </figure>
  );
}

/** Grouped vertical bars (e.g. five measures × levels), values 0–100. */
export function GroupedBars({ groups, series, label, max = 100, unit = "%", height = 200 }: {
  groups: { label: string; values: Record<string, number | null> }[]; series: Series[]; label: string; max?: number; unit?: string; height?: number;
}) {
  const W = 720, H = height, L = 34, R = 8, T = 10, B = 26;
  const gw = (W - L - R) / Math.max(1, groups.length);
  const bw = Math.min(22, (gw - 14) / Math.max(1, series.length));
  const y = (v: number) => T + (1 - v / max) * (H - T - B);
  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={label}>
        {ticks(max).map((t) => <g key={t}><line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke={GRID} /><text x={L - 5} y={y(t) + 4} fontSize="10.5" textAnchor="end" fill={LABEL}>{fmtTick(t)}</text></g>)}
        {groups.map((g, gi) => {
          const x0 = L + gi * gw + (gw - bw * series.length) / 2;
          return (
            <g key={g.label}>
              {series.map((s, si) => {
                const v = g.values[s.key];
                return v === null || v === undefined ? null : <rect key={s.key} x={x0 + si * bw + 1} y={y(v)} width={bw - 2} height={y(0) - y(v)} fill={s.color} rx={1.5}><title>{`${g.label} · ${s.label}: ${v}${unit}`}</title></rect>;
              })}
              <text x={L + gi * gw + gw / 2} y={H - 8} fontSize="11" textAnchor="middle" fill={LABEL}>{g.label}</text>
            </g>
          );
        })}
        <line x1={L} x2={W - R} y1={y(0)} y2={y(0)} stroke={AXIS} />
      </svg>
      <figcaption className="mt-1"><Legend items={series.map((s) => ({ label: s.label, color: s.color }))} /></figcaption>
      <SrTable caption={label} head={["Group", ...series.map((s) => s.label)]} rows={groups.map((g) => [g.label, ...series.map((s) => g.values[s.key])])} />
    </figure>
  );
}

/** Engagement funnel: bar width proportional to the first step, with step-to-step conversion. */
export function Funnel({ steps, label }: { steps: { step: string; n: number }[]; label: string }) {
  const top = Math.max(1, steps[0]?.n ?? 1);
  return (
    <figure>
      <ol role="img" aria-label={label} className="space-y-1.5">
        {steps.map((s, i) => {
          const w = (s.n / top) * 100;
          const conv = i > 0 && top ? Math.round((s.n / top) * 100) : null; // share of the first step (levels are all open, so steps are not nested)
          return (
            <li key={s.step} className="grid grid-cols-[10rem_1fr_6rem] items-center gap-2 text-xs">
              <span className="truncate text-slate-700">{s.step}</span>
              <svg viewBox="0 0 100 12" preserveAspectRatio="none" className="h-5 w-full" aria-hidden>
                <rect x={(100 - w) / 2} y="0" width={w} height="12" fill={i === 0 ? "#0B2342" : PALETTE[0]} opacity={1 - i * 0.09} rx="1"><title>{`${s.step}: ${s.n}${conv !== null ? ` (${conv}% of ${steps[0]!.step})` : ""}`}</title></rect>
              </svg>
              <span className="text-right tabular-nums"><b className="text-slate-900">{s.n}</b>{conv !== null && <span className="ml-1 text-slate-500">{conv}%</span>}</span>
            </li>
          );
        })}
      </ol>
      <SrTable caption={label} head={["Step", "Players"]} rows={steps.map((s) => [s.step, s.n])} />
    </figure>
  );
}

/** Tiny inline progress meter (0–100). */
export function Meter({ value, color = PALETTE[2], label }: { value: number; color?: string; label: string }) {
  return (
    <svg viewBox="0 0 100 6" preserveAspectRatio="none" className="h-1.5 w-full" role="img" aria-label={`${label}: ${Math.round(value)}%`}>
      <rect width="100" height="6" fill="#E2E8F0" rx="3" />
      <rect width={Math.max(0, Math.min(100, value))} height="6" fill={color} rx="3" />
    </svg>
  );
}
