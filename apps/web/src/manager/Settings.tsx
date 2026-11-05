import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../lib/api";
import { Card, ConfirmDanger, Notice, PageHeader, Pill, ReadOnlyNote, btn, fmtDate, input, th, td, tr, useIsManager, inputBase } from "./ui";
import { PALETTE } from "./charts";

const WEIGHTS = [
  { key: "translationQuality", label: "Translation Quality (incl. sentence construction)", help: "Half: match of the final Hindi with CAG's published Hindi (+ light grammar check); half: AI review of meaning, grammar and fluency" },
  { key: "glossary", label: "Glossary Usage", help: "Approved Shabd Udyan terms used ÷ terms in the source" },
  { key: "timelinessCompletion", label: "Timeliness & Completion", help: "Completion × time factor (full within half the limit)" },
] as const;
const RESET_PHRASE = "RESET ALL TEST DATA";

type RoundEdit = { timeLimitMinutes: number; creditCap: number; pages: number };

export function Settings() {
  const qc = useQueryClient();
  const isManager = useIsManager();
  const { data } = useQuery({ queryKey: ["acfg"], queryFn: () => api<any>("/admin/config") });
  const { data: history = [] } = useQuery({ queryKey: ["cfg-history"], queryFn: () => api<any[]>("/admin/config/history") });
  const [rounds, setRounds] = useState<Record<string, RoundEdit>>({});
  const [w, setW] = useState<Record<string, number>>({});
  const [qual, setQual] = useState(33);
  const [pass, setPass] = useState(33);
  const [chances, setChances] = useState(3);
  const [unlock, setUnlock] = useState<"all-open" | "trial-pass-unlocks-all">("all-open");
  const [chrf, setChrf] = useState({ floor: 0.2, ceil: 0.85 });
  const [minWords, setMinWords] = useState(2);
  const [avoidT, setAvoidT] = useState(0.7);
  const [msg, setMsg] = useState<{ tone: "green" | "red"; text: string } | null>(null);
  const [showJson, setShowJson] = useState(false);
  const [danger, setDanger] = useState(false);
  const load = () => {
    if (!data) return;
    const e = data.effective;
    setRounds(Object.fromEntries(e.rounds.map((r: any) => [r.key, { timeLimitMinutes: r.timeLimitMinutes, creditCap: r.creditCap, pages: r.pages ?? 0 }])));
    setW({ ...e.scoringWeights }); setQual(e.levels?.trialQualifyingScore ?? 33); setPass(e.titlePassMark); setChances(e.maxChancesPerRound);
    setUnlock(e.levels?.unlockRule ?? "all-open"); setChrf({ floor: e.scoring.chrfFloor, ceil: e.scoring.chrfCeil }); setMinWords(e.scoring.minWordsPerSentence);
    setAvoidT(e.glossary.transliterationAvoidThreshold);
  };
  useEffect(load, [data]);
  if (!data) return null;
  const e = data.effective;
  const ro = !isManager;
  const credits = Math.round((e.registration.credits + Object.values(rounds).reduce((a, r) => a + (Number(r.creditCap) || 0), 0)) * 10) / 10;
  const wsum = Object.values(w).reduce((a, b) => a + (Number(b) || 0), 0);
  const errors = [
    credits !== e.maxCredits && `Registration + credit caps must total ${e.maxCredits} (now ${credits}).`,
    wsum !== e.scoreOutOf && `Scoring weights must total ${e.scoreOutOf} (now ${wsum}).`,
    !(chrf.floor < chrf.ceil) && "chrF floor must be below the ceiling.",
    Object.values(rounds).some((r) => !(r.timeLimitMinutes > 0)) && "Every time limit must be above 0.",
  ].filter(Boolean) as string[];
  const body = {
    rounds, scoringWeights: w, trialQualifyingScore: qual, titlePassMark: pass, maxChancesPerRound: chances, unlockRule: unlock,
    scoring: { chrfFloor: chrf.floor, chrfCeil: chrf.ceil, minWordsPerSentence: minWords }, avoidThreshold: avoidT,
  };
  const save = async () => {
    try {
      await api("/admin/config/settings", { method: "PUT", body });
      setMsg({ tone: "green", text: "Saved and audited. Players see the new settings on their next screen; attempts already running keep their deadline." });
      qc.invalidateQueries({ queryKey: ["acfg"] }); qc.invalidateQueries({ queryKey: ["cfg-history"] }); qc.invalidateQueries({ queryKey: ["analytics"] });
    } catch (err) { setMsg({ tone: "red", text: (err as ApiError).body?.message ?? (err as ApiError).body?.issues?.map((i: any) => i.message).join("; ") ?? "Save failed" }); }
  };
  const num = (v: number, on: (n: number) => void, opts: { step?: number; min?: number; max?: number; w?: string; label: string }) => (
    <input type="number" aria-label={opts.label} disabled={ro} step={opts.step ?? 1} min={opts.min} max={opts.max} className={`${inputBase} ${opts.w ?? "w-24"} tabular-nums`} value={v} onChange={(ev) => on(Number(ev.target.value))} />
  );
  return (
    <div>
      <PageHeader title="Evaluation & game settings" subtitle="Every value here overrides config/game.config.json, is validated on the server and recorded in the audit trail."
        actions={isManager && <><button className={btn.ghost} onClick={load}>Discard changes</button><button className={btn.primary} disabled={errors.length > 0} onClick={save}>Save settings</button></>} />
      {ro && <div className="mb-4"><ReadOnlyNote /></div>}
      {msg && <div className="mb-4"><Notice tone={msg.tone}>{msg.text}</Notice></div>}
      {errors.length > 0 && <div className="mb-4"><Notice tone="red"><ul className="list-disc pl-4">{errors.map((x) => <li key={x}>{x}</li>)}</ul></Notice></div>}
      <div className="space-y-5">
        <Card title="Levels" subtitle="Time limit, credit cap and report pages per bundle (Trial is a passage measured in words)." pad={false}>
          <table className="w-full text-sm">
            <thead className="bg-slate-50"><tr><th className={th}>Level</th><th className={th}>Time limit (min)</th><th className={th}>Credit cap</th><th className={th}>Report pages per bundle</th><th className={th}>Status</th></tr></thead>
            <tbody>{e.rounds.map((r: any) => rounds[r.key] && (
              <tr key={r.key} className={tr}>
                <td className={td}><b>{r.nameEn}</b> <span className="text-xs text-slate-500">{r.levelLabel} · title “{r.titleEn || r.title}”</span></td>
                <td className={td}>{num(rounds[r.key].timeLimitMinutes, (n) => setRounds({ ...rounds, [r.key]: { ...rounds[r.key], timeLimitMinutes: n } }), { min: 1, label: `${r.nameEn} time` })}</td>
                <td className={td}>{num(rounds[r.key].creditCap, (n) => setRounds({ ...rounds, [r.key]: { ...rounds[r.key], creditCap: n } }), { min: 0, step: 0.5, label: `${r.nameEn} credit cap` })}</td>
                <td className={td}>{r.key === "trial" ? <span className="text-xs text-slate-500">~{e.levels?.trialWords?.min}–{e.levels?.trialWords?.max} words</span> : num(rounds[r.key].pages, (n) => setRounds({ ...rounds, [r.key]: { ...rounds[r.key], pages: n } }), { min: 0, label: `${r.nameEn} pages` })}</td>
                <td className={td}>{r.playable === false ? <Pill tone="purple">{r.phase ?? "preview"}</Pill> : <Pill tone="green">playable</Pill>}</td>
              </tr>
            ))}</tbody>
          </table>
          <div className="flex items-center gap-2 border-t border-slate-100 px-4 py-3 text-sm">
            Registration <b>{e.registration.credits}</b> + level caps = <b className={credits === e.maxCredits ? "text-emerald-700" : "text-red-700"}>{credits}</b> / {e.maxCredits}
            {credits === e.maxCredits ? <Pill tone="green">✓ balanced</Pill> : <Pill tone="red">✕ must equal {e.maxCredits}</Pill>}
          </div>
        </Card>

        <div className="grid gap-5 xl:grid-cols-2">
          <Card title="Progression" subtitle="How levels open and how many tries each officer gets.">
            <fieldset className="space-y-2" disabled={ro}>
              <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Unlock rule</legend>
              {[
                { k: "trial-pass-unlocks-all", t: "Trial first", d: `Trial is mandatory. A best Trial score of at least the qualifying score unlocks Primary, Secondary and Pro, each playable independently. Recommended for the contest.` },
                { k: "all-open", t: "All levels open", d: "Every playable level is open from the start (Trial is still suggested first). Use for demos and review builds." },
              ].map((o) => (
                <label key={o.k} className={`flex cursor-pointer gap-3 rounded-md border p-3 ${unlock === o.k ? "border-[#0B2342] bg-[#F3F6FB]" : "border-slate-200"}`}>
                  <input type="radio" name="unlock" checked={unlock === o.k} onChange={() => setUnlock(o.k as any)} className="mt-1" />
                  <span><b className="text-sm text-slate-900">{o.t}</b><span className="block text-xs text-slate-600">{o.d}</span></span>
                </label>
              ))}
            </fieldset>
            <div className="mt-4 grid grid-cols-3 gap-3 text-sm">
              <label>Trial qualifying score<span className="block text-xs text-slate-500">unlocks the other levels</span>{num(qual, setQual, { min: 0, max: 100, label: "Trial qualifying score", w: "w-full" })}</label>
              <label>Title pass mark<span className="block text-xs text-slate-500">best score ≥ this earns the title</span>{num(pass, setPass, { min: 0, max: 100, label: "Title pass mark", w: "w-full" })}</label>
              <label>Chances per level<span className="block text-xs text-slate-500">best one counts</span>{num(chances, setChances, { min: 1, max: 10, label: "Chances per level", w: "w-full" })}</label>
            </div>
          </Card>

          <Card title="Scoring weights" subtitle={`Score = Σ measure × weight; weights must total ${e.scoreOutOf}.`}>
            <div className="space-y-3">
              {WEIGHTS.map((m, i) => (
                <div key={m.key} className="grid grid-cols-[11rem_1fr_5rem] items-center gap-3 text-sm">
                  <label htmlFor={`w-${m.key}`}><span className="flex items-center gap-1.5 font-semibold text-slate-800"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: PALETTE[i] }} aria-hidden />{m.label}</span><span className="block text-[11px] text-slate-500">{m.help}</span></label>
                  <input id={`w-${m.key}`} type="range" min={0} max={100} disabled={ro} value={w[m.key] ?? 0} onChange={(ev) => setW({ ...w, [m.key]: Number(ev.target.value) })} className="accent-[#0B2342]" />
                  {num(w[m.key] ?? 0, (n) => setW({ ...w, [m.key]: n }), { min: 0, max: 100, label: `${m.label} weight`, w: "w-full" })}
                </div>
              ))}
            </div>
            <svg viewBox="0 0 100 6" preserveAspectRatio="none" className="mt-4 h-3 w-full" role="img" aria-label={`Weights total ${wsum}`}>
              {(() => { let x = 0; return WEIGHTS.map((m, i) => { const v = ((w[m.key] ?? 0) / Math.max(wsum, e.scoreOutOf)) * 100; const el = <rect key={m.key} x={x} width={v} height="6" fill={PALETTE[i]}><title>{`${m.label}: ${w[m.key]}`}</title></rect>; x += v; return el; }); })()}
            </svg>
            <p className="mt-2 text-sm">Total <b className={wsum === e.scoreOutOf ? "text-emerald-700" : "text-red-700"}>{wsum}</b> / {e.scoreOutOf}</p>
          </Card>
        </div>

        <Card title="Evaluation constants" subtitle="Advanced. Change only with the CAG Hindi cell; they affect every new score.">
          <div className="grid gap-4 text-sm md:grid-cols-4">
            <label>chrF floor<span className="block text-xs text-slate-500">chrF at or below → translation 0</span>{num(chrf.floor, (n) => setChrf({ ...chrf, floor: n }), { step: 0.01, min: 0, max: 1, label: "chrF floor", w: "w-full" })}</label>
            <label>chrF ceiling<span className="block text-xs text-slate-500">chrF at or above → translation 1</span>{num(chrf.ceil, (n) => setChrf({ ...chrf, ceil: n }), { step: 0.01, min: 0, max: 1, label: "chrF ceiling", w: "w-full" })}</label>
            <label>Min words per sentence<span className="block text-xs text-slate-500">for Trial completion</span>{num(minWords, setMinWords, { min: 1, max: 20, label: "Minimum words per sentence", w: "w-full" })}</label>
            <label>Glossary avoid threshold<span className="block text-xs text-slate-500">transliteration similarity (0–1) for new imports</span>{num(avoidT, setAvoidT, { step: 0.05, min: 0, max: 1, label: "Avoid threshold", w: "w-full" })}</label>
          </div>
        </Card>

        <div className="grid gap-5 xl:grid-cols-2">
          <Card title="Change history" subtitle="Settings changes and danger-zone actions" pad={false}>
            {history.length === 0 ? <p className="p-4 text-sm text-slate-500">No changes yet — the file defaults are in effect.</p> : (
              <div className="max-h-80 overflow-y-auto"><table className="w-full text-sm"><thead className="sticky top-0 bg-slate-50"><tr><th className={th}>When</th><th className={th}>By</th><th className={th}>Action</th><th className={th}>Detail</th></tr></thead>
                <tbody>{history.map((h) => (
                  <tr key={h.id} className={tr}><td className={`${td} whitespace-nowrap text-xs`}>{fmtDate(h.at)}</td><td className={`${td} text-xs`}>{h.actor}</td><td className={`${td} text-xs font-semibold`}>{h.action}</td>
                    <td className={`${td} max-w-xs truncate font-mono text-[11px] text-slate-500`} title={JSON.stringify(h.meta)}>{h.meta ? JSON.stringify(h.meta) : ""}</td></tr>
                ))}</tbody></table></div>
            )}
          </Card>
          <Card title="Effective configuration" subtitle="Read-only: file defaults plus the overrides above" actions={<button className={btn.ghost} onClick={() => setShowJson(!showJson)}>{showJson ? "Hide JSON" : "Show JSON"}</button>}>
            {showJson ? <pre className="max-h-80 overflow-auto rounded-md bg-slate-50 p-3 font-mono text-[11px] text-slate-700">{JSON.stringify(e, null, 2)}</pre> : (
              <dl className="grid grid-cols-2 gap-2 text-sm">
                <dt className="text-slate-500">Unlock rule</dt><dd>{e.levels.unlockRule}</dd>
                <dt className="text-slate-500">Max credits</dt><dd>{e.maxCredits}</dd>
                <dt className="text-slate-500">Credits below pass mark</dt><dd>{String(e.creditsBelowPassMark)}</dd>
                <dt className="text-slate-500">Scoring provider</dt><dd>{e.scoring.provider}</dd>
                <dt className="text-slate-500">Autosave / grace</dt><dd>{e.fairPlay.autosaveIntervalSeconds}s / {e.fairPlay.graceSecondsAfterDeadline}s</dd>
                <dt className="text-slate-500">Overrides stored</dt><dd>{data.overrides.map((o: any) => o.key).join(", ") || "none"}</dd>
              </dl>
            )}
          </Card>
        </div>

        {isManager && (
          <Card title="Danger zone" subtitle="For clearing test data before the contest opens." className="border-red-200">
            <div className="flex flex-wrap items-center gap-4">
              <p className="flex-1 text-sm text-slate-700">Delete <b>every player</b> with their attempts, scores, events, chat and transliteration stats. Content bundles, glossary, offices, Sahayak lines, settings and the audit log are kept.</p>
              <button className={btn.danger} onClick={() => setDanger(true)}>Reset all test data…</button>
            </div>
          </Card>
        )}
      </div>
      <ConfirmDanger open={danger} onClose={() => setDanger(false)} title="Reset all test data" phrase={RESET_PHRASE} action="Delete all player data"
        body={<>This permanently deletes all players and all play data. It cannot be undone. Export credits first if you need a record.</>}
        onConfirm={async () => { const r = await api<any>("/admin/danger/reset-play-data", { body: { confirm: RESET_PHRASE } }); setMsg({ tone: "green", text: `Deleted ${r.deleted.players} players, ${r.deleted.attempts} attempts, ${r.deleted.chats} chat messages.` }); qc.invalidateQueries(); }} />
    </div>
  );
}
