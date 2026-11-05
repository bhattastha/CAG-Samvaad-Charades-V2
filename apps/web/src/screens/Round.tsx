import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { completion, fill, formatClock, type PageData } from "@hc/shared";
import { api } from "../lib/api";
import { useConfig, useLines } from "../lib/queries";
import { useToasts } from "../lib/store";
import { t } from "../lib/strings";
import { announce, type Line } from "../lib/voice";
import { sfx } from "../lib/sfx";
import { Burst, floatText } from "../components/Juice";
import { Hud } from "../round/Hud";
import { Header, Spinner } from "../components/Layout";
import { SahayikaLine } from "../components/Sahayika";
import { TranslationEditor, type EditorHandle } from "../editor/TranslationEditor";
import { FormatToolbar } from "../editor/FormatToolbar";
import type { Editor } from "@tiptap/react";
import { GlossaryDrawer } from "../editor/GlossaryDrawer";
import { VoiceTyping } from "../editor/voice";
import { useAttempt, type SourceTerm as SourceTermT } from "../round/useAttempt";
import { fullscreenExit, useFairPlay } from "../round/useFairPlay";
import { fk, glossFormsFor, pairKey, SourcePanel, type DraftProps, type FieldKey } from "../round/PageViews";
import { SegmentRows } from "../round/Workbench";
import { GlossMenu, PairStyle, type GlossMenuState } from "../round/GlossMenu";
import { PageControl } from "../round/PageControl";
import { Icon } from "../components/Icon";
import { ChatPanel } from "../round/ChatPanel";
import { enterFullscreen } from "./PreRound";

/** §7.6 Round — designs 05, 08, 10, 12. */
export function Round() {
  const { id = "" } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { data: cfg } = useConfig();
  const at = useAttempt(id, cfg?.fairPlay.autosaveIntervalSeconds ?? 10);
  const { view, answers } = at;
  const round = cfg?.rounds.find((r) => r.key === view?.roundKey);
  const { data: lines } = useLines(view?.roundKey ?? "trial");
  const push = useToasts((s) => s.push);

  const active = view?.status === "active" && at.save !== "closed";
  const readOnly = !active || at.save === "other_window";

  // ---------- Sahayika in-round lines (§10.2) ----------
  const [slim, setSlim] = useState<Line | null>(null);
  const slimTimer = useRef<number>();
  const saidKey = `hc.said.${id}`;
  const said = useRef<Set<string>>(new Set((() => { try { return JSON.parse(sessionStorage.getItem(saidKey) ?? "[]"); } catch { return []; } })()));
  const sayLine = useCallback((moment: string, vars: Record<string, string | number> = {}, once = true) => {
    if (!view || !lines) return;
    if (once && said.current.has(moment)) return;
    const l = lines.find((x) => x.id === `${view.roundKey}.${moment}`) ?? lines.find((x) => x.id === `${view.roundKey}.in_round.${moment}`);
    if (!l) return;
    said.current.add(moment);
    try { sessionStorage.setItem(saidKey, JSON.stringify([...said.current])); } catch { /* ignore */ }
    const filled = { ...l, en: fill(l.en, vars), hi: fill(l.hi, vars) };
    setSlim(filled);
    announce(filled);
    window.clearTimeout(slimTimer.current);
    slimTimer.current = window.setTimeout(() => setSlim(null), 8000); // auto-hide after 8 s
  }, [view, lines, saidKey]);

  // ---------- blocked copy/paste ----------
  const lastBlock = useRef(0);
  const onBlocked = useCallback((kind?: string) => {
    const now = Date.now();
    if (now - lastBlock.current < 700) return;
    lastBlock.current = now;
    if (kind === "locked") { push(t("round.numbersLocked"), "info"); sfx("error"); sayLine("in_round.number_mismatch"); return; }
    push(t("round.copyPasteToast"), "warn");
    sfx("error");
    sayLine("in_round.copy_paste_blocked", {}, false);
    if (view) api(`/attempts/${view.id}/events`, { body: { type: "paste_blocked" } }).catch(() => {});
  }, [push, sayLine, view]);

  const fair = useFairPlay(view?.id ?? null, !!active, () => onBlocked("paste"), view?.leftPageCount ?? 0);

  // ---------- clock ----------
  const [nowMs, setNow] = useState(() => at.now());
  useEffect(() => { const iv = window.setInterval(() => setNow(at.now()), 500); return () => window.clearInterval(iv); }, [at]);
  const deadline = view ? new Date(view.deadlineAt).getTime() : 0;
  const startMs = view ? new Date(view.startedAt).getTime() : 0;
  const remaining = Math.max(0, Math.floor((deadline - nowMs) / 1000));
  const limitS = (round?.timeLimitMinutes ?? 20) * 60;
  const [srNote, setSrNote] = useState("");

  // ---------- completion ----------
  const prog = useMemo(() => {
    if (!view || !round) return { done: 0, total: 1 };
    return completion(round, view.page as unknown as PageData, answers, cfg?.scoring.minWordsPerSentence ?? 2);
  }, [view, round, answers, cfg]);
  const partsLeft = prog.total - prog.done;

  // ---------- triggers ----------
  const lastTyping = useRef(Date.now());
  const onTyping = useCallback(() => { lastTyping.current = Date.now(); }, []);
  useEffect(() => {
    if (!active || !view || !lines) return;
    sayLine("in_round.round_start", { page_no: view.page.printedPageNo ?? "" });
    const tm = window.setTimeout(() => sayLine("in_round.round_start_followup"), 9000);
    return () => window.clearTimeout(tm);
  }, [active, view?.id, lines]);
  useEffect(() => {
    if (!active || !view) return;
    const used = (nowMs - startMs) / 1000;
    if (used >= limitS / 2 && prog.done / (prog.total || 1) < 0.3) sayLine("in_round.half_time");
    const w = cfg?.fairPlay;
    if (w && remaining <= w.warnAtMinutesLeft * 60 && remaining > w.warnAtMinutesLeftSecond * 60) {
      if (!said.current.has("in_round.five_min_left")) { push(t("round.fiveMinToast"), "info"); setSrNote(t("round.fiveMinSr")); sfx("warn"); }
      sayLine("in_round.five_min_left");
    }
    if (w && remaining <= w.warnAtMinutesLeftSecond * 60 && remaining > 0) {
      if (!said.current.has("in_round.one_min_left")) { setSrNote(t("round.oneMinSr")); sfx("warn"); }
      sayLine("in_round.one_min_left");
    }
    if (Date.now() - lastTyping.current > 120_000) { sayLine("in_round.under_source"); lastTyping.current = Date.now(); }
  }, [Math.floor(nowMs / 5000)]);
  // spatial + sound feedback when a sentence/part is cleared; a burst when everything is done
  const prevDone = useRef<number | null>(null);
  const [burst, setBurst] = useState(0);
  useEffect(() => {
    if (prevDone.current !== null && prog.done > prevDone.current && active) {
      const anchor = document.querySelector("[data-hud-progress]")?.getBoundingClientRect() ?? null;
      if (view?.roundKey === "trial") floatText(t("round.sentenceDone"), anchor, "good"); // main rounds show the +1 on the segment itself
      if (view?.roundKey === "trial" && prevDone.current === 0) sayLine("in_round.first_sentence");
      sfx(prog.done >= prog.total ? "fanfare" : "success");
      if (prog.done >= prog.total) { setBurst((b) => b + 1); floatText(t("round.allCleared"), null, "gold"); }
    }
    prevDone.current = prog.done;
  }, [prog.done]);
  useEffect(() => {
    if (!active || prog.total < 2) return;
    if (prog.done >= prog.total) sayLine("in_round.all_done_before_submit");
    else if (prog.done >= Math.ceil(prog.total / 2)) sayLine("in_round.half_parts_done");
  }, [prog.done]);

  // ---------- submit ----------
  const [confirmUntil, setConfirmUntil] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const doSubmit = useCallback(async (auto = false) => {
    if (submitting) return;
    setSubmitting(true);
    voice.current?.stop();
    try {
      await at.submit();
    } catch { /* the server job submits from the last autosave anyway */ }
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    sayLine("in_round.submitted", {}, false);
    await qc.invalidateQueries({ queryKey: ["progress"] });
    nav(`/report/${id}?fx=${auto ? "timeup" : "done"}`, { replace: true });
  }, [at, id, nav, qc, submitting, sayLine]);
  const pressSubmit = () => {
    const win = (cfg?.fairPlay.confirmSubmitWindowSeconds ?? 4) * 1000;
    if (partsLeft > 0 && Date.now() > confirmUntil) {
      setConfirmUntil(Date.now() + win);
      sayLine("in_round.submit_with_parts_left", { parts_left: partsLeft }, false);
      sfx("warn");
      window.setTimeout(() => setConfirmUntil(0), win);
      return;
    }
    doSubmit();
  };
  const timeUpFired = useRef(false);
  useEffect(() => {
    if (active && view && remaining === 0 && deadline > 0 && !timeUpFired.current) {
      timeUpFired.current = true;
      sayLine("in_round.time_up", {}, false);
      push(t("round.timeUp"), "info");
      window.setTimeout(() => doSubmit(true), 1800);
    }
  }, [remaining, active]);

  // ---------- editors registry ----------
  const editors = useRef(new Map<FieldKey, EditorHandle>());
  const register = useCallback((k: FieldKey, h: EditorHandle | null) => { if (h) editors.current.set(k, h); else editors.current.delete(k); }, []);
  const [lastField, setLastField] = useState<FieldKey | null>(null);
  const [focusedPart, setFocusedPart] = useState<string | null>(null);
  // workbench glossary hints: when the player opens a part, Sahayika names one approved term not yet used there (max one per part, 40 s apart)
  const hintKey = `hc.hinted.${id}`;
  const hinted = useRef<{ parts: Set<string>; at: number }>({ parts: new Set((() => { try { return JSON.parse(sessionStorage.getItem(hintKey) ?? "[]"); } catch { return []; } })()), at: 0 });
  useEffect(() => {
    if (!view || !focusedPart || hinted.current.parts.has(focusedPart) || Date.now() - hinted.current.at < 40_000) return;
    const text = Object.values(answers[focusedPart]?.fields ?? {}).join(" ");
    const term = Object.values(view.page.sourceTerms?.[focusedPart] ?? {}).flat().find((x) => x.hi && !text.includes(x.hi) && !x.variants.some((v) => text.includes(v)));
    if (!term) return;
    hinted.current.parts.add(focusedPart);
    try { sessionStorage.setItem(hintKey, JSON.stringify([...hinted.current.parts])); } catch { /* ignore */ }
    hinted.current.at = Date.now();
    sayLine("in_round.glossary_hint", { en_term: term.en, hi_term: term.hi }, false);
  }, [focusedPart]);
  const [sentenceIdx, setSentenceIdx] = useState<number | null>(null);
  const [activeEditor, setActiveEditor] = useState<Editor | null>(null);
  const onFocus = useCallback((partId: string, key: string, ed?: Editor) => { setLastField(fk(partId, key)); setFocusedPart(partId); if (ed) setActiveEditor(ed); }, []);
  const xlitAccept = useCallback((i: number) => { if (view) api(`/attempts/${view.id}/events`, { body: { type: "xlit_accept", meta: { index: i } } }).catch(() => {}); }, [view]);

  // ---------- popovers & drawers ----------
  const [menu, setMenu] = useState<GlossMenuState | null>(null);
  const [hoverPair, setHoverPair] = useState<string | null>(null);
  const hudRef = useRef<HTMLDivElement>(null);
  const [hudH, setHudH] = useState(150);
  useLayoutEffect(() => {
    const el = hudRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setHudH(el.offsetHeight));
    ro.observe(el);
    setHudH(el.offsetHeight);
    return () => ro.disconnect();
  });
  const [glossOpen, setGlossOpen] = useState(false);
  const [glossQuery, setGlossQuery] = useState("");
  const [chatOpen, setChatOpen] = useState(false);
  const [mobilePane, setMobilePane] = useState<"src" | "dst">("dst");
  const [collapsed, setCollapsed] = useState(false);
  const [zoom, setZoomState] = useState(() => { try { const z = Number(localStorage.getItem("hc.wb.zoom")); return z >= 80 && z <= 140 ? z : 100; } catch { return 100; } });
  const setZoom = (z: number) => { const v = Math.max(80, Math.min(140, z)); setZoomState(v); try { localStorage.setItem("hc.wb.zoom", String(v)); } catch { /* ignore */ } };
  const fsSupported = typeof document !== "undefined" && !!(document.documentElement.requestFullscreen || (document.documentElement as any).webkitRequestFullscreen);
  const [isFs, setIsFs] = useState(() => typeof document !== "undefined" && !!document.fullscreenElement);
  useEffect(() => {
    const on = () => setIsFs(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", on);
    return () => document.removeEventListener("fullscreenchange", on);
  }, []);
  const toggleFullscreen = async () => {
    if (document.fullscreenElement) { fullscreenExit.until = Date.now() + 3000; try { await document.exitFullscreen(); } catch { /* ignore */ } }
    else await enterFullscreen();
  };
  const watchWords = view?.page.watchWords ?? [];
  // multi-page report bundles (10/20/30 pages): one printed page at a time in both panels
  const pageNos = useMemo(() => [...new Set((view?.page.parts ?? []).map((p) => p.pageNo).filter((n): n is number => typeof n === "number"))].sort((a, b) => a - b), [view]);
  const [pageIdx, setPageIdx] = useState(0);
  const curPage = pageNos[pageIdx];
  const scrollMode = !!round?.scrollMode;
  const visibleParts = useMemo(() => (pageNos.length > 1 && !scrollMode ? (view?.page.parts ?? []).filter((p) => (p.pageNo ?? pageNos[0]) === curPage) : view?.page.parts ?? []), [view, pageNos, curPage, scrollMode]);
  const pageDone = (n: number) => (view?.page.parts ?? []).filter((p) => p.pageNo === n && p.editable && p.tickGroup).every((p) => answers[p.id]?.done);
  const watchTexts = useMemo(() => watchWords.map((w) => w.text), [watchWords]);
  // words / characters of the Hindi on the focused page (status bar)
  const counts = useMemo(() => {
    const text = visibleParts.filter((p) => p.editable).flatMap((p) => p.fields.filter((f) => !f.numeric).map((f) => answers[p.id]?.fields[f.key] ?? "")).join("\n");
    return { words: text.split(/\s+/).filter(Boolean).length, chars: text.replace(/\s/g, "").length };
  }, [visibleParts, answers]);

  // ---------- voice (परख only) ----------
  const voice = useRef<VoiceTyping | null>(null);
  const [listening, setListening] = useState(false);
  const toggleVoice = () => {
    if (!round?.voiceTyping) return;
    if (listening) { voice.current?.stop(); return; }
    sayLine("in_round.mic_tapped", {}, false);
    const target = () => editors.current.get(fk("passage", "t"));
    voice.current = new VoiceTyping({
      onInterim: (x) => target()?.setInterim(x),
      onFinal: (x) => { target()?.insertText(x + " ", "asr"); onTyping(); },
      onUnavailable: () => push(t("round.voiceUnavailable"), "info"),
      onState: (s) => setListening(s === "listening"),
    });
    voice.current.start();
  };
  useEffect(() => () => voice.current?.stop(), []);

  if (at.error) return <><Header /><div className="p-10 text-center text-lg">{t("common.error")}</div></>;
  if (!view || !round || !cfg) return <><Header /><Spinner /></>;
  if (view.status === "submitted" && !submitting) { nav(`/report/${id}`, { replace: true }); return null; }

  const isTrial = view.roundKey === "trial";
  const confirming = Date.now() < confirmUntil;
  const focusField = (pid: string): FieldKey | null => {
    if (lastField?.startsWith(`${pid}:`)) return lastField;
    const f = view.page.parts.find((p) => p.id === pid)?.fields.find((x) => !x.numeric);
    return f ? fk(pid, f.key) : null;
  };
  const termByPair = new Map<string, SourceTermT>();
  for (const [pid, fields] of Object.entries(view.page.sourceTerms)) for (const [key, list] of Object.entries(fields)) for (const tm of list) termByPair.set(pairKey(pid, key, tm.en), tm);
  const optionsOf = (tm: SourceTermT): GlossMenuState["options"] => [
    { hi: tm.hi, tag: "approved" as const },
    ...tm.variants.filter((v) => v && v !== tm.hi).map((hi) => ({ hi, tag: "variant" as const })),
    ...(tm.alternatives ?? []).filter((x) => x.hi && x.hi !== tm.hi).map((x) => ({ hi: x.hi, tag: "other" as const, area: x.area })),
  ].filter((o, i, all) => o.hi && all.findIndex((x) => x.hi === o.hi) === i);
  const fieldTarget = (pid: string, key: string): FieldKey | null => {
    if (isTrial) return fk("passage", "t");
    return view.page.parts.find((p) => p.id === pid)?.fields.some((f) => f.key === key && !f.numeric) ? fk(pid, key) : null;
  };
  /** English side: open the menu under the underlined term; picking inserts at the cursor of that field. */
  const onTermPick = (pid: string, key: string, tm: SourceTermT, rect: DOMRect) => {
    setMenu({ rect, pair: pairKey(pid, key, tm.en), en: tm.en, area: tm.area, options: optionsOf(tm), avoid: tm.avoid, mode: "insert", target: fieldTarget(pid, key) });
  };
  /** Hindi side: open the menu under the underlined word; picking replaces it. */
  const onGlossClick = (pid: string, key: string, g: { pair: string; word: string; kind: "ok" | "avoid"; from: number; to: number; rect: DOMRect }) => {
    const tm = termByPair.get(g.pair);
    if (!tm) return;
    setMenu({ rect: g.rect, pair: g.pair, en: tm.en, area: tm.area, options: optionsOf(tm), avoid: tm.avoid, mode: "replace", target: fieldTarget(pid, key), range: { from: g.from, to: g.to }, current: g.word, currentKind: g.kind });
  };
  const draftProps: DraftProps = {
    parts: visibleParts, answers, readOnly, watch: watchTexts, focusedPart, register,
    // autosave: a segment counts as reviewed once the player opens or edits it (no "Mark as done")
    onField: (pid, key, v) => { if (v !== (answers[pid]?.fields[key] ?? "")) at.update(pid, { field: [key, v], done: true }); },
    onHtml: (pid, key, h) => at.update(pid, { html: [key, h] }),
    terms: view.page.sourceTerms, rich: true, onGlossClick,
    onFocus: (pid, key, ed) => { onFocus(pid, key, ed); if (!readOnly && !answers[pid]?.done) at.update(pid, { done: true }); },
    onBlocked, onTyping, onXlit: xlitAccept,
    onWatchClick: (pid, key, w) => {
      const ww = watchWords.find((x) => x.text === w.word);
      setMenu({ rect: w.rect, pair: "", en: ww?.en ?? w.word, options: (ww?.options ?? []).map((hi, i) => ({ hi, tag: i === 0 ? "approved" as const : "variant" as const })), avoid: [w.word], mode: "replace", target: fieldTarget(pid, key), range: { from: w.from, to: w.to }, current: w.word, currentKind: "avoid" });
    },
  };
  const leftLine = (moment: string) => lines?.find((l) => l.id === `${view.roundKey}.in_round.${moment}`) ?? null;

  const insertGlossary = (hi: string) => {
    const k = lastField ?? (isTrial ? fk("passage", "t") : null);
    const h = k ? editors.current.get(k) : null;
    if (h && !readOnly) { h.insertText(hi, "glossary"); setGlossOpen(false); }
  };
  const liveEditor = activeEditor && !activeEditor.isDestroyed ? activeEditor : isTrial ? editors.current.get(fk("passage", "t"))?.editor() ?? null : null;
  const mic = round.voiceTyping && (
    <button onClick={toggleVoice} disabled={readOnly} onMouseDown={(e) => e.preventDefault()}
      className={`shrink-0 rounded-md inline-flex items-center gap-1.5 px-3 h-8 text-[13px] font-bold text-white ${listening ? "bg-timer-text animate-pulse" : "bg-primary-strong"}`}>
      <Icon name="mic" size={15} /> {listening ? t("round.listening") : t("round.speak")}
    </button>
  );
  const toolbar = <FormatToolbar editor={liveEditor} disabled={readOnly} />;
  const overPair = (e: React.MouseEvent) => {
    const el = (e.target as HTMLElement).closest?.("[data-pair]") as HTMLElement | null;
    setHoverPair(el?.dataset.pair ?? null);
  };
  const trialTerms = view.page.sourceTerms.passage?.t;
  const stickTop = `calc(63px + ${hudH}px)`;

  const zoomStyle = { zoom: zoom / 100 } as React.CSSProperties;
  const titleCls = "text-[12px] font-extrabold uppercase tracking-[0.14em] text-navy whitespace-nowrap";
  const collapseBtn = (
    <button type="button" onClick={() => setCollapsed(true)} title={t("round.collapseTip")}
      className="ml-auto hidden lg:inline-flex items-center gap-1 rounded-full border border-slate-300 bg-white px-2.5 h-7 text-[12px] font-bold normal-case tracking-normal text-navy hover:bg-slate-50">
      <Icon name="chevronLeft" size={14} />{t("round.collapse")}
    </button>
  );
  const expandBtn = collapsed && (
    <button type="button" onClick={() => setCollapsed(false)}
      className="hidden lg:inline-flex items-center gap-1 rounded-full border border-slate-300 bg-white px-2.5 h-7 text-[12px] font-bold normal-case tracking-normal text-navy hover:bg-slate-50">
      <Icon name="chevronRight" size={14} />{t("round.expand")}
    </button>
  );
    const titles = (
    <div className={`bg-slate-100 border-b border-slate-300/80 px-3 sm:px-5 grid ${isTrial ? (collapsed ? "lg:grid-cols-1" : "lg:grid-cols-2 lg:gap-x-6") : collapsed ? "md:grid-cols-1" : "md:grid-cols-2 md:gap-x-6"}`}>
      {isTrial && (
        <div className="lg:hidden py-1.5">
          <div className="grid grid-cols-2 rounded-ui bg-white border border-slate-200 p-1 text-[14px] font-semibold">
            {(["src", "dst"] as const).map((k) => (
              <button key={k} onClick={() => setMobilePane(k)} className={`rounded-md py-1.5 ${mobilePane === k ? "bg-navy text-white" : "text-muted"}`}>
                {k === "src" ? t("round.originalDoc") : t("round.translatedDoc")}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className={`${collapsed ? "hidden" : isTrial ? "hidden lg:flex" : "hidden md:flex"} items-center gap-2 h-9 min-w-0`}>
        <Icon name="file" size={14} className="text-navy-600" /><span className={titleCls}>{t("round.originalDoc")}</span>
        <span className="en text-[12px] text-muted font-semibold">· {t("round.sourceLabelEn")}</span>
        {collapseBtn}
      </div>
      <div className={`${isTrial ? "hidden lg:flex" : "flex"} items-center gap-2 h-9 min-w-0`}>
        {expandBtn}
        <Icon name="edit" size={14} className="text-navy-600" /><span className={titleCls}>{t("round.translatedDoc")}</span>
        {!isTrial && <span className="text-[12px] text-muted font-semibold truncate">· {t("round.draftLabel")}</span>}
      </div>
    </div>
  );
  const statusBar = (
    <div className="hc-statusbar fixed bottom-0 inset-x-0 z-40 h-9 px-2 sm:px-4 flex items-center gap-3 text-[12.5px] text-navy" role="group" aria-label={t("round.status.label")}>
      {scrollMode ? (
        <div className="shrink-0 flex items-center gap-2 whitespace-nowrap" data-testid="scroll-progress">
          <span className="font-bold text-navy max-sm:hidden">{t("round.scrollMode")}</span>
          <span className="w-24 sm:w-40 h-2 rounded-full bg-slate-200 overflow-hidden"><span className="block h-full bg-success transition-[width] duration-500" style={{ width: `${Math.round((prog.done / (prog.total || 1)) * 100)}%` }} /></span>
          <span className="tnum font-semibold" data-testid="scroll-progress-pct">{t("round.scrollProgress", { pct: Math.round((prog.done / (prog.total || 1)) * 100) })}</span>
        </div>
      ) : <PageControl pageNos={pageNos.length ? pageNos : [1]} idx={pageNos.length ? pageIdx : 0} onChange={(i) => { setPageIdx(i); sfx("whoosh"); }} done={pageDone} />}
      <span className="tnum text-muted truncate whitespace-nowrap">{t("round.status.words", { n: counts.words })}<span className="max-sm:hidden">, {t("round.status.chars", { m: counts.chars })}</span></span>
      <div className="ml-auto inline-flex items-center gap-0.5" role="group" aria-label={t("round.status.zoom")}>
        <span className="hidden sm:inline text-muted mr-1 font-semibold">{t("round.status.zoom")}</span>
        <button type="button" className="hc-zoom-btn" onClick={() => setZoom(zoom - 10)} disabled={zoom <= 80} aria-label={t("round.status.zoomOut")} title={t("round.status.zoomOut")}>–</button>
        <span className="min-w-[3rem] text-center font-bold tnum" aria-live="polite">{t("round.status.zoomValue", { n: zoom })}</span>
        <button type="button" className="hc-zoom-btn" onClick={() => setZoom(zoom + 10)} disabled={zoom >= 140} aria-label={t("round.status.zoomIn")} title={t("round.status.zoomIn")}>+</button>
      </div>
    </div>
  );
  const trialH = "lg:h-[calc(100vh-var(--stick)-2.25rem)]";

  return (
    <div className="min-h-screen flex flex-col" style={{ ["--stick" as any]: stickTop }}>
      <Header compact wide />
      <div className="sr-only" aria-live="assertive">{srNote}</div>
      <PairStyle keys={[hoverPair, menu?.pair]} />

      {/* workbench bar + ribbon + pane titles: one sticky stack (non-diegetic) */}
      <div ref={hudRef} data-hud-progress className="sticky top-[63px] z-20">
        <Hud round={round} chanceNo={view.chanceNo} maxChances={cfg.maxChancesPerRound} remaining={remaining} limit={limitS}
          warn5={cfg.fairPlay.warnAtMinutesLeft * 60} warn1={cfg.fairPlay.warnAtMinutesLeftSecond * 60}
          progress={prog.done} total={prog.total} isTrial={isTrial} creditCap={view.creditCap} save={at.save} sample={view.page.sample}
          onAsk={() => setChatOpen(true)} onSubmit={() => { sfx("tap"); pressSubmit(); }} submitting={submitting} confirming={confirming} partsLeft={partsLeft} readOnly={readOnly}
          onBack={async () => { await at.flush(); nav("/journey"); }} fullscreen={fsSupported ? isFs : null} onFullscreen={toggleFullscreen} />
        <div className="hc-ribbon px-2 sm:px-4 flex items-center gap-2 min-h-[2.75rem]">
          <span className="hc-tab max-sm:hidden" aria-hidden>{t("round.toolbar.tab")}</span>
          <div className="flex-1 min-w-0 flex items-center gap-2 py-1">{toolbar}</div>
          {mic}
          {readOnly && <span className="chip-plain text-xs">{t("round.readOnly")}</span>}
        </div>
        {titles}
      </div>
      {active && remaining > 0 && remaining <= cfg.fairPlay.warnAtMinutesLeftSecond * 60 && (
        <div className="pointer-events-none fixed inset-0 z-[35] animate-pulse" style={{ boxShadow: "inset 0 0 120px 20px rgba(180,35,24,.35)" }} aria-hidden />
      )}
      <Burst fire={burst} count={36} spread={300} />

      {isTrial ? (
      <main className={`hc-canvas w-full flex-1 px-3 sm:px-5 py-3 grid ${collapsed ? "lg:grid-cols-1" : "lg:grid-cols-2"} gap-6 pb-12 lg:pb-0 lg:py-4 lg:grid-rows-[minmax(0,1fr)] lg:overflow-hidden ${trialH}`} data-canvas onMouseOver={overPair} onMouseLeave={() => setHoverPair(null)}>
        <section translate="no" className={`notranslate lg:overflow-y-auto lg:pb-4 min-h-0 ${collapsed ? "lg:hidden" : "lg:block"} ${mobilePane === "src" ? "" : "hidden"}`} aria-label={t("round.originalDoc")}>
          <div className="hc-paper px-5 md:px-8 py-6 md:py-8 min-h-[50vh]" style={zoomStyle}>
            <SourcePanel parts={visibleParts} terms={view.page.sourceTerms} focusedPart={focusedPart} sentenceIndex={isTrial ? sentenceIdx : null}
              onPartClick={(pid) => { setFocusedPart(pid); const f = view.page.parts.find((p) => p.id === pid)?.fields.find((x) => !x.numeric); if (f) editors.current.get(fk(pid, f.key))?.focus(); }}
              onTerm={onTermPick} />
          </div>
        </section>

        <section translate="no" className={`notranslate lg:overflow-y-auto lg:pb-4 min-h-0 lg:block ${mobilePane === "dst" ? "" : "hidden"}`} aria-label={t("round.translatedDoc")}>
          <div className="hc-paper px-5 md:px-8 py-6 md:py-8 min-h-[50vh]" style={zoomStyle}>
            <TranslationEditor
              ref={(h) => register(fk("passage", "t"), h)}
              value={answers.passage?.fields.t ?? ""}
              html={answers.passage?.html?.t}
              rich
              onHtml={(h) => at.update("passage", { html: ["t", h] })}
              gloss={glossFormsFor("passage", "t", trialTerms)}
              onGlossClick={(g) => onGlossClick("passage", "t", g)}
              onChange={(v) => at.update("passage", { field: ["t", v] })}
              readOnly={readOnly}
              sentenceTicks
              showLatin
              ariaLabel={t("round.translatedDoc")}
              placeholder={t("round.xlitHint")}
              onFocus={(ed) => onFocus("passage", "t", ed)}
              onBlocked={onBlocked}
              onTyping={onTyping}
              onCaretSentence={setSentenceIdx}
              onXlitAccept={xlitAccept}
            />
          </div>
        </section>
      </main>
      ) : (
        <main className="hc-canvas w-full flex-1 px-3 sm:px-5 py-3 pb-14" data-canvas onMouseOver={overPair} onMouseLeave={() => setHoverPair(null)} aria-label={t("round.workbench")}>
          <div style={zoomStyle}>
            <SegmentRows parts={visibleParts} allParts={view.page.parts} terms={view.page.sourceTerms} onTerm={onTermPick} focusedPart={focusedPart}
              onSelect={(pid) => setFocusedPart(pid)} d={draftProps} collapsed={collapsed} lazy={scrollMode} />
          </div>
        </main>
      )}

      {menu && (
        <GlossMenu s={menu} readOnly={readOnly} onClose={() => setMenu(null)} onSearch={(q) => { setGlossQuery(q); setGlossOpen(true); setMenu(null); }}
          onPick={(v) => {
            const h = menu.target ? editors.current.get(menu.target) : null;
            if (h && !readOnly) { menu.mode === "replace" && menu.range ? h.replaceRange(menu.range.from, menu.range.to, v) : h.insertText(v, "glossary"); }
            setMenu(null);
          }} />
      )}

      {statusBar}
      {slim && <div className="fixed bottom-12 right-3 z-40 w-[min(34rem,calc(100vw-1.5rem))]"><SahayikaLine line={slim} autoSpeak={false} clamp onClose={() => setSlim(null)} /></div>}

      <GlossaryDrawer open={glossOpen} onClose={() => setGlossOpen(false)} onInsert={insertGlossary} initial={glossQuery} />
      <ChatPanel open={chatOpen} onClose={() => { setChatOpen(false); sayLine("chat.panel_close", {}, false); }} attemptId={view.id} quick={cfg.sahayika.quickQuestions}
        thinking={lines?.find((l) => l.id === `${view.roundKey}.chat.thinking`) ?? null}
        opener={lines?.find((x) => x.id === `${view.roundKey}.chat.panel_open`) ?? null} />

      {/* left the page: warning card on return (§12) */}
      {fair.left && active && (
        <div className="fixed inset-0 z-[95] bg-navy/50 grid place-items-center p-4" role="alertdialog" aria-modal="true">
          <div className="card max-w-md w-full p-6 animate-pop text-center">
            <div className="mx-auto w-14 h-14 rounded-full bg-primary-soft text-primary-strong grid place-items-center"><Icon name="eye" size={28} /></div>
            <h2 className="mt-3 text-2xl font-bold text-navy">{leftLine("left_popup_title")?.hi}</h2>
            <SahayikaLine line={leftLine(fair.left.kind === "left_fullscreen" ? "left_fullscreen" : "left_tab")} />
            <p className="mt-3 text-[16px]">{t("round.leftPageCard")}</p>
            <p className="mt-2 font-semibold text-timer-text">{fill(leftLine("left_count_note")?.hi ?? "", { leaves: fair.count })}</p>
            <button className="btn-primary mt-5" onClick={async () => { await enterFullscreen(); fair.dismiss(); }}>{t("round.backToRound")}</button>
          </div>
        </div>
      )}

      {at.save === "other_window" && view.status === "active" && (
        <div className="fixed top-24 left-1/2 -translate-x-1/2 z-[90] rounded-card bg-navy text-white px-5 py-3 shadow-pop font-semibold inline-flex items-center gap-2"><Icon name="window" size={18} /> {t("round.otherWindow")}</div>
      )}
    </div>
  );
}
