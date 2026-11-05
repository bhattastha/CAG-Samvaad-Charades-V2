import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { Answers, ClientPart } from "@hc/shared";
import { t } from "../lib/strings";
import { Icon } from "../components/Icon";
import { PartEditorBody, PartSource, type DraftProps } from "./PageViews";
import type { SourceTerm } from "./useAttempt";

/** Mounts its children only once they come near the viewport (long scrolling reports keep hundreds of editors cheap). */
function NearView({ eager, children, fallback }: { eager: boolean; children: React.ReactNode; fallback: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState(eager);
  useEffect(() => {
    if (seen || !ref.current) return;
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) setSeen(true); }, { rootMargin: "900px 0px" });
    io.observe(ref.current);
    return () => io.disconnect();
  }, [seen]);
  return <div ref={ref}>{seen ? children : fallback}</div>;
}

/**
 * Translation workbench in the CAG Anuvaad document layout: two "papers" side by side on a grey canvas, one row per segment
 * (English left, Hindi right, always in the same row). Glossary is inline: underlined terms on both sides open a menu.
 * Work autosaves; a segment counts as reviewed once the player opens or edits it (green rail).
 */
export function SegmentRows({ parts, allParts, terms, onTerm, focusedPart, onSelect, d, collapsed = false, lazy = false }: {
  parts: ClientPart[];
  allParts: ClientPart[];
  terms: Record<string, Record<string, SourceTerm[]>>;
  onTerm(partId: string, fieldKey: string, term: SourceTerm, rect: DOMRect): void;
  focusedPart: string | null;
  onSelect(partId: string): void;
  d: DraftProps;
  collapsed?: boolean;
  lazy?: boolean;
}) {
  const number = useMemo(() => new Map(allParts.filter((p) => p.editable).map((p, i) => [p.id, i + 1])), [allParts]);
  const srcCell = collapsed ? "md:hidden" : "";
  const pad = "px-5 md:px-7 xl:px-10";
  return (
    <div className={`hc-papers relative grid ${collapsed ? "md:grid-cols-1" : "md:grid-cols-2"} md:gap-x-6 max-md:bg-white max-md:rounded-lg max-md:shadow-paper`} translate="no" data-testid="workbench-rows">
      {!collapsed && <div className="hc-paper hidden md:block absolute inset-y-0 left-0" style={{ width: "calc(50% - 0.75rem)" }} aria-hidden />}
      <div className="hc-paper hidden md:block absolute inset-y-0 right-0" style={{ width: collapsed ? "100%" : "calc(50% - 0.75rem)" }} aria-hidden />
      <div className={`h-5 md:h-8 ${srcCell}`} aria-hidden /><div className="h-1 md:h-8" aria-hidden />
      {parts.map((p, i) => {
        if (!p.editable) {
          return (
            <Fragment key={p.id}>
              <div className={`relative ${pad} py-1.5 text-right text-[12px] text-muted en ${srcCell}`}>{t("round.pageNumberLabel")} {p.fields[0]?.en}</div>
              <div className="relative h-1" aria-hidden />
              {lazy && <div className="md:col-span-2 relative z-[1] mx-3 my-2 border-t-2 border-dashed border-slate-300" data-testid={`page-break-${p.fields[0]?.en ?? i}`} aria-hidden />}
            </Fragment>
          );
        }
        const done = !!d.answers[p.id]?.done;
        const on = focusedPart === p.id;
        const issues = qaFor(p, d.answers, d.watch).filter((q) => !q.ok).length;
        const tint = on ? "bg-navy-50/80" : done ? "bg-success-soft/30" : "";
        const head = (
          <div className="flex items-center gap-2 min-h-[28px] text-[11px] font-bold uppercase tracking-[0.12em] text-muted">
            <span className={`tnum rounded px-1.5 py-0.5 ${on ? "bg-navy text-white" : "bg-slate-100 text-navy"}`}>#{number.get(p.id)}</span>
            <span>{t(`round.partTypes.${p.type}`)}</span>
            {issues > 0 && <span className="inline-flex items-center gap-1 normal-case tracking-normal text-primary-strong"><Icon name="alert" size={12} />{t("round.qaIssues", { n: issues })}</span>}
          </div>
        );
        const sel = { onFocusCapture: () => onSelect(p.id), onClick: () => onSelect(p.id) };
        const plain = <div className="text-[15px] leading-[1.7] text-navy/80 whitespace-pre-wrap min-h-[2rem]">{p.fields.filter((f) => !f.numeric).map((f) => d.answers[p.id]?.fields[f.key] ?? "").join(" ")}</div>;
        return (
          <Fragment key={p.id}>
            <div data-src={p.id} {...sel} className={`relative min-w-0 ${pad} pt-3 pb-3 transition-colors ${tint} ${srcCell}`}>
              {head}
              <div className="mt-1.5 no-select en text-[15px] leading-[1.7] text-navy" onCopy={(e) => e.preventDefault()}><PartSource p={p} terms={terms} onTerm={onTerm} /></div>
            </div>
            <div data-dst={p.id} data-testid={`segment-${p.id}`} {...sel} className={`relative min-w-0 ${pad} pt-3 pb-3 transition-colors ${tint}`}>
              <span className={`absolute left-0 inset-y-0 w-1 rounded-r ${on ? "bg-primary" : done ? "bg-success" : "bg-transparent"} transition-colors`} aria-hidden />
              <div className="flex items-center justify-end gap-2 mb-1 min-h-[28px]">
                {done && <span className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-success" data-testid={`segment-saved-${p.id}`}><Icon name="check" size={12} stroke={2.6} />{t("round.autoSaved")}</span>}
              </div>
              <NearView eager={!lazy || i < 40} fallback={plain}><PartEditorBody p={p} d={d} /></NearView>
            </div>
          </Fragment>
        );
      })}
      <div className={`h-5 md:h-8 ${srcCell}`} aria-hidden /><div className="h-2 md:h-8" aria-hidden />
    </div>
  );
}

export interface QaCheck { key: string; ok: boolean; label: string; detail?: string }

/** Live QA for one segment, in the spirit of Anuvaad's QA panel: numbers, Latin words, watch-words, full stop, empty. */
export function qaFor(p: ClientPart, answers: Answers, watch: string[]): QaCheck[] {
  const a = answers[p.id];
  const fields = p.fields.filter((f) => !f.numeric && f.en);
  const texts = fields.map((f) => a?.fields[f.key] ?? "");
  const all = texts.join(" ");
  const locked = new Set(fields.flatMap((f) => f.locked));
  const empty = fields.filter((f, i) => f.en.trim() && !texts[i].trim()).length;
  const missingNums = fields.flatMap((f, i) => f.locked.filter((tok) => f.en.includes(tok) && !texts[i].includes(tok)));
  // words inside locked number chips ("83 per cent") are not the player's English
  const unlocked = [...locked].sort((a, b) => b.length - a.length).reduce((x, tok) => x.split(tok).join(" "), all);
  const latin = (unlocked.match(/[A-Za-z][A-Za-z'’-]+/g) ?? []).filter((w) => !/^[IVXLC]+$/.test(w));
  const flagged = watch.filter((w) => w && all.includes(w));
  const needsStop = (p.type === "body" || p.type === "headnote") && /[.]\s*$/.test(fields[0]?.en ?? "") && !!texts[0]?.trim();
  const out: QaCheck[] = [
    { key: "empty", ok: empty === 0, label: t("round.qa.empty"), detail: empty ? t("round.qa.emptyN", { n: empty }) : undefined },
    { key: "numbers", ok: missingNums.length === 0, label: t("round.qa.numbers"), detail: missingNums.slice(0, 4).join(", ") || undefined },
    { key: "latin", ok: latin.length === 0, label: t("round.qa.latin"), detail: latin.slice(0, 4).join(", ") || undefined },
    { key: "watch", ok: flagged.length === 0, label: t("round.qa.watch"), detail: flagged.slice(0, 4).join(", ") || undefined },
  ];
  if (needsStop) out.push({ key: "stop", ok: /[।?!:]\s*$/.test(texts[0]), label: t("round.qa.stop") });
  return out;
}
