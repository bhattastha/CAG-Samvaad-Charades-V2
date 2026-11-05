import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { numberTokens, type ClientPart, type Field, type GlossaryEntry, type Part, type PlantedSlip } from "@hc/shared";
import { api, ApiError } from "../lib/api";
import { DraftPanel, SourcePanel } from "../round/PageViews";
import { Card, Empty, Kpi, Notice, PageHeader, Pill, ReadOnlyNote, StatusPill, Tabs, btn, fmt, input, th, td, tr, useIsManager, select, inputBase } from "./ui";
import { LEVEL_COLORS, Meter } from "./charts";

const PART_TYPES = ["passage", "header", "heading", "headnote", "body", "footnote", "footer", "page_number", "table", "chart", "annexure_ref"];
const SLIP_KINDS = ["term", "transliteration", "grammar", "omission"] as const;

function useLevels() {
  const { data } = useQuery({ queryKey: ["acfg"], queryFn: () => api<any>("/admin/config") });
  return (data?.effective?.rounds ?? []) as any[];
}
function useStates() {
  const { data = [] } = useQuery({ queryKey: ["offices"], queryFn: () => api<any[]>("/admin/offices") });
  return useMemo(() => [...new Set(data.map((o) => o.state))].sort() as string[], [data]);
}
const levelName = (levels: any[], k: string) => levels.find((l) => l.key === k)?.nameEn ?? k;

// ---------------- library ----------------
export function Library() {
  const nav = useNavigate();
  const levels = useLevels();
  const isManager = useIsManager();
  const { data = [], isLoading } = useQuery({ queryKey: ["library"], queryFn: () => api<any[]>("/admin/library") });
  const [level, setLevel] = useState("");
  const [status, setStatus] = useState("");
  const all = data.flatMap((r) => r.bundles);
  const filtered = (b: any) => (!level || b.round_key === level) && (!status || b.status === status);
  return (
    <div>
      <PageHeader title="Content library" subtitle="CAG reports and the level bundles built from them. Players get Union reports plus their office state's reports."
        actions={isManager && <button className={btn.primary} onClick={() => nav("/manager/content/new")}>+ Add a report</button>} />
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-5">
        <Kpi index={0} accent="#2B5FB8" icon={<path d="M6 3h9l4 4v14H6zM14 3v5h5" />} label="Reports" value={data.length} />
        <Kpi index={1} accent="#7C3AED" icon={<path d="M4 4h6v16H4zM14 4h6v16h-6z" />} label="Bundles" value={all.length} />
        <Kpi label="Published" value={all.filter((b) => b.status === "published").length} accent="#16A34A" icon={<path d="M5 12l5 5 9-10" />} />
        <Kpi label="Drafts" value={all.filter((b) => b.status === "draft").length} accent="#D6A642" icon={<path d="M4 20h4L19 9l-4-4L4 16z" />} />
        <Kpi index={4} accent="#F15A24" icon={<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" />} label="Parts verified" value={`${all.reduce((n, b) => n + b.verified, 0)} / ${all.reduce((n, b) => n + b.parts, 0)}`} />
      </div>
      <div className="mb-4 flex flex-wrap gap-2">
        <select className={select} value={level} onChange={(e) => setLevel(e.target.value)} aria-label="Filter by level"><option value="">All levels</option>{levels.map((l) => <option key={l.key} value={l.key}>{l.nameEn}</option>)}</select>
        <select className={select} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status"><option value="">All statuses</option><option value="published">Published</option><option value="draft">Draft</option><option value="retired">Retired</option></select>
      </div>
      {isLoading && <Empty>Loading…</Empty>}
      <div className="space-y-5">
        {data.map((r) => r.bundles.some(filtered) && <ReportCard key={r.report} r={r} levels={levels} filter={filtered} />)}
      </div>
    </div>
  );
}

function ReportCard({ r, levels, filter }: { r: any; levels: any[]; filter(b: any): boolean }) {
  const qc = useQueryClient();
  const nav = useNavigate();
  const isManager = useIsManager();
  const states = useStates();
  const [scope, setScope] = useState(r.scopes.length === 1 ? r.scopes[0] : "");
  const [msg, setMsg] = useState("");
  const saveScope = async () => {
    try { const x = await api<any>("/admin/reports/scope", { method: "PUT", body: { report: r.report, scope } }); setMsg(`Scope set on ${x.pages} bundles.`); qc.invalidateQueries({ queryKey: ["library"] }); }
    catch (e) { setMsg((e as ApiError).code); }
  };
  return (
    <Card title={r.report} subtitle={<>{r.files.length ? `Source files: ${r.files.join(", ")}` : "No source file recorded"} · Scope: {r.scopes.map((s: string) => s === "union" ? "Union" : s).join(", ")}</>}
      actions={isManager && (
        <div className="flex items-center gap-2 text-xs">
          <label className="text-slate-500" htmlFor={`scope-${r.report}`}>Report scope</label>
          <select id={`scope-${r.report}`} className={`${inputBase} w-40 py-1`} value={scope} onChange={(e) => setScope(e.target.value)}>
            {!scope && <option value="">(mixed)</option>}
            <option value="union">Union (all officers)</option>
            {states.map((s) => <option key={s} value={s}>State: {s}</option>)}
          </select>
          <button className={btn.ghost} disabled={!scope} onClick={saveScope}>Apply</button>
          {msg && <span className="text-slate-600">{msg}</span>}
        </div>
      )} pad={false}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50"><tr><th className={th}>Level</th><th className={th}>Bundle</th><th className={th}>Pages</th><th className={th}>Parts verified</th><th className={th}>Terms</th><th className={th}>Slips</th><th className={th}>Used</th><th className={th}>Avg score</th><th className={th}>Status</th></tr></thead>
          <tbody>{r.bundles.filter(filter).map((b: any) => {
            const pctV = b.parts ? (b.verified / b.parts) * 100 : 0;
            return (
              <tr key={b.id} className={`${tr} cursor-pointer`} onClick={() => nav(`/manager/content/${b.id}`)}>
                <td className={td}><span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-sm align-middle" style={{ background: LEVEL_COLORS[b.round_key] }} aria-hidden />{levelName(levels, b.round_key)}</td>
                <td className={td}><Link to={`/manager/content/${b.id}`} className="font-semibold text-[#24558A] hover:underline" onClick={(e) => e.stopPropagation()}>{b.label}</Link>
                  <div className="text-xs text-slate-500">{b.id} · printed p. {b.printed_page_no ?? "—"} {b.sample && <Pill tone="amber">sample</Pill>} {b.scope !== "union" && <Pill tone="navy">{b.scope}</Pill>}</div></td>
                <td className={`${td} tabular-nums`}>{b.report_pages}</td>
                <td className={`${td} w-36`}><div className={`tabular-nums text-xs ${b.verified < b.parts ? "text-red-700" : "text-emerald-700"}`}>{b.verified} / {b.parts} ({Math.round(pctV)}%)</div><Meter label="Verified" value={pctV} color={pctV === 100 ? "#009E73" : "#E69F00"} /></td>
                <td className={`${td} tabular-nums`}>{b.terms}</td><td className={`${td} tabular-nums`}>{b.slips}</td>
                <td className={`${td} tabular-nums`}>{b.times_used}</td><td className={`${td} tabular-nums`}>{fmt(b.avg_score)}</td>
                <td className={td}><StatusPill s={b.status} /></td>
              </tr>
            );
          })}</tbody>
        </table>
      </div>
    </Card>
  );
}

// ---------------- add a report (ingest wizard, steps a–b; c–h continue in the bundle editor) ----------------
/** "27, 29-31" → [27, 29, 30, 31] */
const parsePages = (s: string) => [...new Set(s.split(/[,\s]+/).filter(Boolean).flatMap((t) => {
  const m = t.match(/^(\d+)(?:-(\d+))?$/);
  if (!m) return [];
  const a = Number(m[1]), b = Number(m[2] ?? m[1]);
  return b >= a && b - a < 400 ? Array.from({ length: b - a + 1 }, (_, i) => a + i) : [];
}))];

export function AddReport() {
  const nav = useNavigate();
  const levels = useLevels();
  const states = useStates();
  const isManager = useIsManager();
  const { data: lib = [] } = useQuery({ queryKey: ["library"], queryFn: () => api<any[]>("/admin/library") });
  const [en, setEn] = useState<File | null>(null);
  const [hi, setHi] = useState<File | null>(null);
  const [meta, setMeta] = useState({ report: "", scope: "union", round: "primary", id: "", label: "", printed: "", sector: "", pages: "" });
  const [parts, setParts] = useState<any[] | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const pages = parsePages(meta.pages);
  const target = levels.find((l) => l.key === meta.round)?.pages ?? 0;
  if (!isManager) return <ReadOnlyNote />;
  const segment = async () => {
    if (!en || !pages.length) return;
    setBusy(true); setErr("");
    try {
      const out: any[] = [];
      for (const [i, pg] of pages.entries()) {
        const fd = new FormData();
        fd.append("page", String(pg));
        fd.append("file", en);
        const r = await fetch("/api/admin/ingest/segment", { method: "POST", body: fd });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? "segment_failed");
        setNumPages(j.numPages);
        const pre = pages.length > 1 ? `b${i + 1}-` : "";
        for (const p of j.parts) out.push({ ...p, part_id: pre + p.part_id, tick_group: p.tick_group ? pre + p.tick_group : null, ...(pages.length > 1 ? { page_no: i + 1 } : {}), _pdfPage: pg });
      }
      setParts(out);
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  const move = (i: number, d: number) => setParts((ps) => { const n = [...ps!]; const [x] = n.splice(i, 1); n.splice(i + d, 0, x); return n; });
  const merge = (i: number) => setParts((ps) => { const n = [...ps!]; n[i] = { ...n[i], en: `${n[i].en} ${n[i + 1].en}`, locked_tokens: numberTokens(`${n[i].en} ${n[i + 1].en}`) }; n.splice(i + 1, 1); return n; });
  const split = (i: number) => setParts((ps) => {
    const n = [...ps!];
    const p = n[i];
    const cut = p.en.search(/(?<=[.;:])\s+(?=[A-Z(])/);
    if (cut < 0) return n;
    const a = p.en.slice(0, cut).trim(), b = p.en.slice(cut).trim();
    n.splice(i, 1, { ...p, en: a, locked_tokens: numberTokens(a) }, { ...p, part_id: `${p.part_id}s`, tick_group: p.tick_group ? `${p.tick_group}s` : null, en: b, locked_tokens: numberTokens(b) });
    return n;
  });
  const create = async () => {
    setErr("");
    try {
      await api("/admin/pages", { body: {
        page_id: meta.id, round: meta.round, label: meta.label || meta.id, scope: meta.scope,
        source: { report: meta.report, file: en?.name, hindi_file: hi?.name, english_pdf_pages: pages, english_pdf_page: pages[0], printed_page: meta.printed, sector_hidden_from_player: meta.sector },
        parts: parts!.map(({ _pdfPage, ...p }) => p), planted_slips: [], glossary_terms: [],
      } });
      nav(`/manager/content/${meta.id}`);
    } catch (e) { setErr((e as ApiError).code); }
  };
  const step = !parts ? 1 : 2;
  return (
    <div>
      <PageHeader title="Add a report" subtitle="Build a level bundle from a CAG report pair. After creating the draft you verify the Hindi reference, generate the BHASHINI draft, mark planted slips, choose glossary terms, preview and publish." />
      <ol className="mb-5 flex flex-wrap gap-2 text-xs">
        {["Source & bundle details", "Segment & review parts", "Verify reference (editor)", "Draft, slips, terms", "Preview & publish"].map((s, i) => (
          <li key={s} className={`rounded-full border px-3 py-1 font-semibold ${i + 1 === step ? "border-[#0B2342] bg-[#0B2342] text-white" : i + 1 < step ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-slate-200 bg-white text-slate-500"}`}>{i + 1}. {s}</li>
        ))}
      </ol>
      <div className="space-y-5">
        <Card title="1 · Source report and bundle" subtitle="Upload the English and Hindi editions of the same report. The Hindi PDF's text layer is often broken, so the Hindi reference is pasted or OCR'd and verified part by part.">
          <div className="grid gap-4 md:grid-cols-2">
            <label className="text-sm">Report name<input className={`${input} mt-1`} list="known-reports" value={meta.report} onChange={(e) => setMeta({ ...meta, report: e.target.value })} placeholder="Report No. 38 of 2025 (Performance Audit – Commercial)" />
              <datalist id="known-reports">{lib.map((r) => <option key={r.report} value={r.report} />)}</datalist></label>
            <label className="text-sm">Report scope (office mapping)
              <select className={`${input} mt-1`} value={meta.scope} onChange={(e) => setMeta({ ...meta, scope: e.target.value })}>
                <option value="union">Union (all officers)</option>{states.map((s) => <option key={s} value={s}>State: {s}</option>)}
              </select></label>
            <label className="text-sm">English PDF<input type="file" accept="application/pdf" className="mt-1 block w-full text-sm" onChange={(e) => setEn(e.target.files?.[0] ?? null)} /></label>
            <label className="text-sm">Hindi PDF (reference edition)<input type="file" accept="application/pdf" className="mt-1 block w-full text-sm" onChange={(e) => setHi(e.target.files?.[0] ?? null)} />
              <span className="mt-1 block text-xs text-slate-500">Recorded with the bundle. Hindi OCR runs only in the API Docker image (tesseract + hin); otherwise paste the verified Hindi in the editor.</span></label>
            <label className="text-sm">Level
              <select className={`${input} mt-1`} value={meta.round} onChange={(e) => setMeta({ ...meta, round: e.target.value })}>{levels.filter((l) => l.playable !== false).map((l) => <option key={l.key} value={l.key}>{l.nameEn} {l.pages ? `· ${l.pages} pages per bundle` : "· passage"}</option>)}</select></label>
            <label className="text-sm">English PDF pages for this bundle<input className={`${input} mt-1`} value={meta.pages} onChange={(e) => setMeta({ ...meta, pages: e.target.value })} placeholder="e.g. 27 or 27-36" />
              <span className={`mt-1 block text-xs ${target && pages.length && pages.length !== target ? "text-amber-700" : "text-slate-500"}`}>{pages.length} selected{target ? ` · level setting: ${target} pages per bundle` : ""}{numPages ? ` · PDF has ${numPages} pages` : ""}</span></label>
          </div>
          <div className="mt-4 flex items-center gap-3">
            <button className={btn.navy} disabled={!en || !pages.length || busy} onClick={segment}>{busy ? "Segmenting…" : parts ? "Re-segment" : "Auto-segment English"}</button>
            {err && <span className="text-sm text-red-700">Error: {err}</span>}
          </div>
        </Card>

        {parts && (
          <Card title={`2 · Review parts (${parts.length})`} subtitle="Retype, reorder, merge or split parts before creating the draft. Locked numbers are detected automatically.">
            <ol className="space-y-1.5">
              {parts.map((p, i) => (
                <li key={p.part_id + i} className="grid grid-cols-[6.5rem_8rem_1fr_auto] items-start gap-2 rounded-md border border-slate-100 p-2 text-sm">
                  <span className="text-xs text-slate-500">{p.part_id}{p.page_no ? ` · page ${p.page_no}` : ""}<br />PDF p. {p._pdfPage}</span>
                  <select className={`${input} py-1 text-xs`} value={p.type} aria-label="Part type" onChange={(e) => setParts(parts.map((x, j) => j === i ? { ...x, type: e.target.value, editable: e.target.value !== "page_number" } : x))}>{PART_TYPES.map((t) => <option key={t}>{t}</option>)}</select>
                  <span className="text-slate-800">{p.en.slice(0, 260)}{p.en.length > 260 && "…"}{p.locked_tokens?.length > 0 && <span className="ml-2 text-xs text-slate-500">🔒 {p.locked_tokens.join(", ")}</span>}</span>
                  <span className="flex gap-1">
                    <button className={btn.ghost} disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up">↑</button>
                    <button className={btn.ghost} disabled={i === parts.length - 1} onClick={() => move(i, 1)} aria-label="Move down">↓</button>
                    <button className={btn.ghost} disabled={i === parts.length - 1} onClick={() => merge(i)} title="Merge with next">Merge</button>
                    <button className={btn.ghost} onClick={() => split(i)} title="Split at the first sentence boundary">Split</button>
                    <button className={btn.ghost} onClick={() => setParts(parts.filter((_, j) => j !== i))} aria-label="Remove">✕</button>
                  </span>
                </li>
              ))}
            </ol>
            <div className="mt-4 grid gap-3 md:grid-cols-4">
              <label className="text-sm">Bundle id<input className={`${input} mt-1`} value={meta.id} onChange={(e) => setMeta({ ...meta, id: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-") })} placeholder="primary-r38-p7" /></label>
              <label className="text-sm">Label<input className={`${input} mt-1`} value={meta.label} onChange={(e) => setMeta({ ...meta, label: e.target.value })} placeholder="Report 38 · p. 7" /></label>
              <label className="text-sm">Printed page no.<input className={`${input} mt-1`} value={meta.printed} onChange={(e) => setMeta({ ...meta, printed: e.target.value })} /></label>
              <label className="text-sm">Sector (never shown to players)<input className={`${input} mt-1`} value={meta.sector} onChange={(e) => setMeta({ ...meta, sector: e.target.value })} /></label>
            </div>
            <div className="mt-4 flex items-center gap-3">
              <button className={btn.primary} disabled={!meta.id || !parts.length} onClick={create}>Create draft bundle →</button>
              <span className="text-xs text-slate-500">Next in the editor: paste/verify Hindi per part · check locked numbers · generate BHASHINI draft · planted slips · glossary terms · preview · publish.</span>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}

// ---------------- bundle editor ----------------
interface AdminPage { id: string; roundKey: string; label: string; printedPageNo: string | null; parts: Part[]; terms: GlossaryEntry[]; slips: PlantedSlip[]; status: string; sample: boolean; sector: string; scope: string; source: any; verified: Record<string, boolean> }

export function BundleEditor() {
  const { id = "" } = useParams();
  const qc = useQueryClient();
  const isManager = useIsManager();
  const levels = useLevels();
  const states = useStates();
  const { data, error } = useQuery({ queryKey: ["page", id], queryFn: () => api<AdminPage>(`/admin/pages/${id}`) });
  const [pg, setPg] = useState<AdminPage | null>(null);
  const [msg, setMsg] = useState<{ tone: "green" | "red" | "navy"; text: string } | null>(null);
  const [tab, setTab] = useState<"parts" | "slips" | "terms" | "preview">("parts");
  const [pageFilter, setPageFilter] = useState(0);
  useEffect(() => { if (data) setPg(structuredClone(data)); }, [data]);
  if (error) return <Empty>Bundle not found.</Empty>;
  if (!pg) return <Empty>Loading…</Empty>;
  const dirty = JSON.stringify(pg) !== JSON.stringify(data);
  const save = async () => {
    try {
      await api(`/admin/pages/${id}`, { method: "PUT", body: { id: pg.id, roundKey: pg.roundKey, label: pg.label, printedPageNo: pg.printedPageNo, parts: pg.parts, terms: pg.terms, slips: pg.slips, sector: pg.sector, scope: pg.scope } });
      if ((pg.source?.report ?? "") !== (data?.source?.report ?? "")) await api(`/admin/pages/${id}/meta`, { method: "PUT", body: { report: pg.source?.report ?? "" } });
      setMsg({ tone: "green", text: "Saved." }); qc.invalidateQueries({ queryKey: ["page", id] }); qc.invalidateQueries({ queryKey: ["library"] });
    } catch (e) { setMsg({ tone: "red", text: `Save failed: ${(e as ApiError).code}` }); }
  };
  const action = async (path: string, body: unknown = {}) => {
    try {
      const r = await api<any>(`/admin/pages/${id}/${path}`, { body });
      setMsg({ tone: "green", text: path === "draft" ? `BHASHINI draft generated for ${r.translated} fields${r.needsManualFix?.length ? `; fix manually: ${r.needsManualFix.join(", ")}` : ""}.` : path === "publish" ? "Published. Players can now be served this bundle." : "Retired." });
      qc.invalidateQueries({ queryKey: ["page", id] }); qc.invalidateQueries({ queryKey: ["library"] });
    } catch (e) {
      const err = e as ApiError;
      setMsg({ tone: "red", text: err.code === "unverified_parts" ? `Cannot publish: ${err.body?.parts?.length} parts not reference-verified (${err.body.parts.join(", ")}).` : err.code === "missing_draft" ? "Cannot publish: some fields have no BHASHINI draft." : err.code === "nmt_not_configured" ? "BHASHINI translation key is not configured on the server." : `${path} failed: ${err.code}` });
    }
  };
  const setField = (pi: number, fi: number, patch: Partial<Field>) => setPg((p) => { const n = structuredClone(p!); Object.assign(n.parts[pi].fields[fi], patch); return n; });
  const setPart = (pi: number, patch: Partial<Part>) => setPg((p) => { const n = structuredClone(p!); Object.assign(n.parts[pi], patch); return n; });
  const verify = async (partId: string, v: boolean) => { await api(`/admin/pages/${id}/parts/${partId}/verify`, { method: "PUT", body: { verified: v } }); qc.invalidateQueries({ queryKey: ["page", id] }); };
  const editable = pg.parts.filter((p) => p.editable);
  const verifiedN = editable.filter((p) => data?.verified[p.id]).length;
  const allVerified = verifiedN === editable.length;
  const bundlePages = [...new Set(pg.parts.map((x) => x.pageNo).filter(Boolean))] as number[];
  const ro = !isManager;
  return (
    <div>
      <div className="mb-2 text-xs text-slate-500"><Link to="/manager/content" className="hover:underline">Content library</Link> / {pg.source?.report || "Unassigned"} / {pg.label}</div>
      <PageHeader title={pg.label} subtitle={<>{levelName(levels, pg.roundKey)} · {pg.id} · printed p. {pg.printedPageNo ?? "—"} · {bundlePages.length || 1} report page(s) · {verifiedN}/{editable.length} parts verified</>}
        actions={<>
          <StatusPill s={pg.status} />
          {isManager && <>
            <button className={btn.ghost} disabled={!dirty} onClick={save}>{dirty ? "Save changes" : "Saved"}</button>
            <button className={btn.navy} onClick={() => action("draft", { overwrite: false })}>Generate BHASHINI draft</button>
            <button className={btn.primary} disabled={!allVerified || dirty} title={!allVerified ? "Every editable part must be reference-verified" : dirty ? "Save first" : ""} onClick={() => action("publish")}>Publish</button>
            {pg.status !== "retired" && <button className={btn.dangerGhost} onClick={() => action("retire")}>Retire</button>}
          </>}
        </>} />
      {ro && <div className="mb-4"><ReadOnlyNote /></div>}
      {msg && <div className="mb-4"><Notice tone={msg.tone}>{msg.text}</Notice></div>}
      <Card className="mb-4">
        <div className="grid gap-3 md:grid-cols-4">
          <label className="text-sm">Label<input className={`${input} mt-1`} disabled={ro} value={pg.label} onChange={(e) => setPg({ ...pg, label: e.target.value })} /></label>
          <label className="text-sm">Report<input className={`${input} mt-1`} disabled={ro} value={pg.source?.report ?? ""} onChange={(e) => setPg({ ...pg, source: { ...(pg.source ?? {}), report: e.target.value } })} /></label>
          <label className="text-sm">Report scope (office mapping)
            <select className={`${input} mt-1`} disabled={ro} value={pg.scope ?? "union"} onChange={(e) => setPg({ ...pg, scope: e.target.value })}>
              <option value="union">Union (all officers)</option>{states.map((s) => <option key={s} value={s}>State: {s}</option>)}
              {pg.scope && pg.scope !== "union" && !states.includes(pg.scope) && <option value={pg.scope}>{pg.scope}</option>}
            </select></label>
          <label className="text-sm">Sector (never shown to players)<input className={`${input} mt-1`} disabled={ro} value={pg.sector} onChange={(e) => setPg({ ...pg, sector: e.target.value })} /></label>
        </div>
        <div className="mt-3"><Meter label="Reference verified" value={editable.length ? (verifiedN / editable.length) * 100 : 0} color={allVerified ? "#009E73" : "#E69F00"} /></div>
      </Card>
      <Tabs value={tab} onChange={setTab} items={[
        { key: "parts", label: `Parts & reference (${pg.parts.length})` }, { key: "slips", label: `Planted slips (${pg.slips.length})` },
        { key: "terms", label: `Glossary terms (${pg.terms.length})` }, { key: "preview", label: "Player preview" },
      ]} />

      {tab === "parts" && (
        <div className="space-y-3">
          {bundlePages.length > 1 && (
            <div className="flex flex-wrap items-center gap-1 text-xs"><span className="mr-1 text-slate-500">Report page:</span>
              {[0, ...bundlePages].map((n) => <button key={n} className={`rounded border px-2 py-0.5 ${pageFilter === n ? "border-[#0B2342] bg-[#0B2342] text-white" : "border-slate-300 bg-white"}`} onClick={() => setPageFilter(n)}>{n === 0 ? "All" : n}</button>)}
            </div>
          )}
          {pg.parts.map((p, pi) => (!pageFilter || p.pageNo === pageFilter) && (
            <Card key={p.id} className={data?.verified[p.id] ? "border-l-4 border-l-emerald-500" : p.editable ? "border-l-4 border-l-amber-400" : ""}>
              <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
                <span className="font-mono text-xs font-semibold text-slate-700">{p.id}</span>
                <select className={`${select} py-1 text-xs`} disabled={ro} value={p.type} aria-label="Part type" onChange={(e) => setPart(pi, { type: e.target.value as Part["type"] })}>{PART_TYPES.map((t) => <option key={t}>{t}</option>)}</select>
                <label className="text-xs text-slate-600">tick group <input className={`${inputBase} inline w-24 py-1 text-xs`} disabled={ro} value={p.tickGroup ?? ""} onChange={(e) => setPart(pi, { tickGroup: e.target.value || null })} /></label>
                <label className="text-xs text-slate-600">report page <input type="number" min={1} className={`${inputBase} inline w-16 py-1 text-xs`} disabled={ro} value={p.pageNo ?? ""} onChange={(e) => setPart(pi, { pageNo: e.target.value ? Number(e.target.value) : undefined })} /></label>
                <label className="flex items-center gap-1 text-xs text-slate-600"><input type="checkbox" disabled={ro} checked={p.editable} onChange={(e) => setPart(pi, { editable: e.target.checked })} /> editable</label>
                <span className="flex-1" />
                {p.editable && <label className={`flex items-center gap-1.5 text-xs font-semibold ${data?.verified[p.id] ? "text-emerald-700" : "text-amber-700"}`}>
                  <input type="checkbox" disabled={ro} checked={!!data?.verified[p.id]} onChange={(e) => verify(p.id, e.target.checked)} /> {data?.verified[p.id] ? "✓ Reference verified" : "Reference not verified"}</label>}
              </div>
              <div className="space-y-3">
                {p.fields.map((f, fi) => (
                  <div key={f.key} className="grid gap-2 border-t border-slate-100 pt-2 lg:grid-cols-3">
                    <div><div className="mb-0.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">English · {f.key}{f.numeric ? " · numeric" : ""}</div><textarea className={input} disabled={ro} rows={f.en.length > 120 ? 4 : 2} value={f.en} onChange={(e) => setField(pi, fi, { en: e.target.value })} /></div>
                    {!f.numeric && <div><div className="mb-0.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">CAG Hindi reference</div><textarea lang="hi" className={`${input} text-[15px]`} disabled={ro} rows={f.en.length > 120 ? 4 : 2} value={f.hiReference} onChange={(e) => setField(pi, fi, { hiReference: e.target.value })} /></div>}
                    {!f.numeric && <div><div className="mb-0.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">BHASHINI draft (with planted slips)</div><textarea lang="hi" className={`${input} text-[15px]`} disabled={ro} rows={f.en.length > 120 ? 4 : 2} value={f.draft ?? ""} onChange={(e) => setField(pi, fi, { draft: e.target.value })} /></div>}
                    {!f.numeric && <div className="flex flex-wrap items-center gap-1.5 text-xs lg:col-span-3">
                      <span className="text-slate-500">Locked numbers:</span>
                      {f.locked.map((tk) => <button key={tk} disabled={ro} className="rounded border border-[#C7D3E6] bg-[#F3F6FB] px-1.5 py-0.5 font-mono text-[#0B2342]" title="Click to remove" onClick={() => setField(pi, fi, { locked: f.locked.filter((x) => x !== tk) })}>{tk} ✕</button>)}
                      {!ro && <button className={btn.link} onClick={() => setField(pi, fi, { locked: [...new Set(numberTokens(f.en))] })}>auto-detect</button>}
                      {!ro && <button className={btn.link} onClick={() => { const v = prompt("Add locked token"); if (v) setField(pi, fi, { locked: [...f.locked, v] }); }}>+ add</button>}
                      {f.locked.filter((tk) => f.hiReference && !f.hiReference.includes(tk)).length > 0 && <span className="font-semibold text-red-700">⚠ missing in reference: {f.locked.filter((tk) => !f.hiReference.includes(tk)).join(", ")}</span>}
                    </div>}
                  </div>
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}

      {tab === "slips" && (
        <Card title="Planted slips" subtitle="Wrong words in the draft. They drive the draft highlights and Sahayak's hints; the fix hint is never sent to players. A red border means the text is not found in that part's draft.">
          {pg.slips.length === 0 && <Empty>No slips yet.</Empty>}
          {pg.slips.length > 0 && <div className="mb-1 grid grid-cols-[7rem_9rem_1fr_1fr_1fr_auto] gap-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500"><span>Part</span><span>Kind</span><span>Wrong text</span><span>English term</span><span>Fix hint (hidden)</span><span /></div>}
          {pg.slips.map((s, i) => {
            const part = pg.parts.find((p) => p.id === s.partId);
            const inDraft = part?.fields.some((f) => (f.draft ?? "").includes(s.wrongText));
            const upd = (patch: Partial<PlantedSlip>) => setPg({ ...pg, slips: pg.slips.map((x, j) => j === i ? { ...x, ...patch } : x) });
            return (
              <div key={i} className="mb-2 grid grid-cols-[7rem_9rem_1fr_1fr_1fr_auto] items-center gap-2">
                <select className={input} disabled={ro} value={s.partId} onChange={(e) => upd({ partId: e.target.value })}>{pg.parts.map((p) => <option key={p.id}>{p.id}</option>)}</select>
                <select className={input} disabled={ro} value={s.kind} onChange={(e) => upd({ kind: e.target.value as PlantedSlip["kind"] })}>{SLIP_KINDS.map((k) => <option key={k}>{k}</option>)}</select>
                <input lang="hi" className={`${input} ${inDraft ? "" : "border-red-400"}`} disabled={ro} placeholder="wrong text (in draft)" value={s.wrongText} onChange={(e) => upd({ wrongText: e.target.value })} />
                <input className={input} disabled={ro} placeholder="English term" value={s.enTerm ?? ""} onChange={(e) => upd({ enTerm: e.target.value || null })} />
                <input className={input} disabled={ro} placeholder="fix hint" value={s.fixHint} onChange={(e) => upd({ fixHint: e.target.value })} />
                {!ro && <button className={btn.ghost} onClick={() => setPg({ ...pg, slips: pg.slips.filter((_, j) => j !== i) })} aria-label="Remove slip">✕</button>}
              </div>
            );
          })}
          {!ro && <button className={`${btn.ghost} mt-2`} onClick={() => setPg({ ...pg, slips: [...pg.slips, { partId: pg.parts.find((p) => p.editable)?.id ?? "", kind: "term", wrongText: "", enTerm: null, fixHint: "" }] })}>+ Add slip</button>}
        </Card>
      )}

      {tab === "terms" && <TermsEditor pg={pg} setPg={setPg} ro={ro} />}
      {tab === "preview" && <Preview pg={pg} />}
    </div>
  );
}

function TermsEditor({ pg, setPg, ro }: { pg: AdminPage; setPg(p: AdminPage): void; ro: boolean }) {
  const [q, setQ] = useState("");
  const { data: hits = [] } = useQuery({ queryKey: ["gl", q], queryFn: () => api<GlossaryEntry[]>(`/glossary?q=${encodeURIComponent(q)}`), enabled: q.length > 1 });
  const ref = pg.parts.flatMap((p) => p.fields.map((f) => f.hiReference)).join(" ");
  const enText = pg.parts.flatMap((p) => p.fields.map((f) => f.en)).join(" ").toLowerCase();
  return (
    <Card title="Glossary terms scored on this bundle" subtitle="Each term's Hindi should appear in the CAG reference, and its English on the page." pad={false}>
      {pg.terms.length === 0 ? <div className="p-4"><Empty>No terms yet.</Empty></div> : (
        <table className="w-full text-sm"><thead className="bg-slate-50"><tr><th className={th}>English</th><th className={th}>CAG Hindi / variants</th><th className={th}>Avoid</th><th className={th}>Checks</th><th className={th} /></tr></thead>
          <tbody>{pg.terms.map((t, i) => (
            <tr key={t.en} className={tr}>
              <td className={`${td} font-semibold`}>{t.en}</td><td className={td} lang="hi">{t.hi}{t.variants.length > 0 && <span className="text-slate-500"> / {t.variants.join(", ")}</span>}</td>
              <td className={`${td} text-xs text-slate-500`} lang="hi">{t.avoid.slice(0, 5).join(", ")}</td>
              <td className={td}>{[t.hi, ...t.variants].some((v) => ref.includes(v)) ? <Pill tone="green">✓ in reference</Pill> : <Pill tone="red">⚠ not in reference</Pill>} {!enText.includes(t.en.toLowerCase()) && <Pill tone="amber">not on page</Pill>}</td>
              <td className={td}>{!ro && <button className={btn.ghost} onClick={() => setPg({ ...pg, terms: pg.terms.filter((_, j) => j !== i) })} aria-label={`Remove ${t.en}`}>✕</button>}</td>
            </tr>
          ))}</tbody></table>
      )}
      {!ro && <div className="border-t border-slate-100 p-4">
        <input className={input} placeholder="Search the glossary to add a term…" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="mt-2 flex flex-wrap gap-2">{hits.slice(0, 14).map((h: any) => (
          <button key={h.en} className="rounded-full border border-slate-300 bg-white px-2.5 py-1 text-xs hover:bg-slate-50" onClick={() => setPg({ ...pg, terms: [...pg.terms.filter((x) => x.en !== h.en), { en: h.en, hi: h.hi, variants: h.variants, avoid: h.avoid }] })}>+ {h.en} = <span lang="hi">{h.hi}</span></button>
        ))}</div>
      </div>}
    </Card>
  );
}

function Preview({ pg }: { pg: AdminPage }) {
  const parts = pg.parts.map((p) => ({ ...p, fields: p.fields.map(({ hiReference: _h, ...f }) => f) })) as ClientPart[];
  const answers = Object.fromEntries(pg.parts.filter((p) => p.editable).map((p) => [p.id, { fields: Object.fromEntries(p.fields.filter((f) => !f.numeric).map((f) => [f.key, f.draft ?? ""])), done: false }]));
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="Source page (English)"><SourcePanel parts={parts} terms={{}} focusedPart={null} sentenceIndex={null} onTerm={() => {}} onPartClick={() => {}} /></Card>
      <Card title="What the player edits">{pg.roundKey === "trial" ? <Empty>Trial: the player starts from an empty editor.</Empty> :
        <DraftPanel parts={parts} answers={answers} readOnly watch={pg.slips.map((s) => s.wrongText)} focusedPart={null} register={() => {}} onField={() => {}} onFocus={() => {}} onBlocked={() => {}} onTyping={() => {}} onWatchClick={() => {}} onXlit={() => {}} />}
      </Card>
    </div>
  );
}

