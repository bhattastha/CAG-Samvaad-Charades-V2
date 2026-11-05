import { t } from "../lib/strings";
import { Icon } from "./Icon";

export interface WeakSpot { partId: string; sentence: number | null; en: string; similarityPct: number; lostMarks: number }

/** Score breakdown tip: the sentences / parts that lost the most Translation Quality marks, worst first. */
export function WeakSpots({ spots, compact = false }: { spots: WeakSpot[]; compact?: boolean }) {
  if (!spots.length) return null;
  return (
    <div className={compact ? "rounded-ui border border-amber-200 bg-amber-50/70 p-3" : "card p-5"} data-testid="weak-spots">
      <div className="font-bold text-navy flex items-center gap-2"><Icon name="target" size={17} className="text-amber-600" /> {t("complete.weakTitle")}</div>
      <div className="text-xs text-muted mt-0.5">{t("complete.weakSub")}</div>
      <ol className="mt-2 space-y-2">
        {spots.map((w, i) => (
          <li key={`${w.partId}-${w.sentence ?? "p"}`} className="flex items-start gap-2 text-sm" data-testid={`weak-spot-${i}`}>
            <span className="shrink-0 tnum rounded bg-amber-500 text-white text-[11px] font-bold px-1.5 py-0.5 mt-0.5">{t("complete.weakLost", { n: w.lostMarks })}</span>
            <span className="min-w-0">
              <span className="en text-ink">{w.sentence !== null && <b className="mr-1">{t("complete.weakSentence", { n: w.sentence + 1 })}:</b>}{w.en}</span>
              <span className="block text-[11.5px] text-muted">{t("complete.weakMatch", { n: w.similarityPct })}</span>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
