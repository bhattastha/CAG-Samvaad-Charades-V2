import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { Card, ConfirmDanger, Drawer, Empty, Kpi, PageHeader, Pill, ago, btn, fmt, fmtDate, input, th, td, tr, useIsManager, select } from "./ui";
import { LEVEL_COLORS, Meter } from "./charts";
import { Medal } from "../components/Juice";

const LEVELS = [
  { key: "trial", label: "Trial" }, { key: "primary", label: "Primary" }, { key: "secondary", label: "Secondary" }, { key: "pro", label: "Professional" },
];
type Sort = "lastActive" | "credits" | "name" | "registered";

export function Players() {
  const { data = [], isLoading } = useQuery({ queryKey: ["admin-players"], queryFn: () => api<any[]>("/admin/players"), refetchInterval: 30_000 });
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState("");
  const [state, setState] = useState("");
  const [stage, setStage] = useState("");
  const [sort, setSort] = useState<Sort>("lastActive");
  const openId = params.get("open");
  const states = useMemo(() => [...new Set(data.map((p) => p.state).filter(Boolean))].sort(), [data]);
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    const out = data.filter((p) =>
      (!s || [p.name, p.email, p.office, p.mobile, p.city].some((v) => String(v ?? "").toLowerCase().includes(s))) &&
      (!state || p.state === state) &&
      (!stage || (stage === "not_started" ? p.attempts === 0 : stage === "trial_failed" ? p.attempts > 0 && !p.trialPassed : stage === "trial_passed" ? p.trialPassed : stage === "flagged" ? p.leaves + p.pasteBlocks > 0 : stage === "in_progress" ? p.inProgress : true)));
    const by: Record<Sort, (a: any, b: any) => number> = {
      lastActive: (a, b) => +new Date(b.lastActiveAt) - +new Date(a.lastActiveAt),
      credits: (a, b) => b.totalCredits - a.totalCredits,
      name: (a, b) => a.name.localeCompare(b.name),
      registered: (a, b) => +new Date(b.registeredAt) - +new Date(a.registeredAt),
    };
    return [...out].sort(by[sort]);
  }, [data, q, state, stage, sort]);
  const passed = data.filter((p) => p.trialPassed).length;
  return (
    <div>
      <PageHeader title="Players" subtitle="Every registered officer with computed progress. Click a row for attempt history and reset options."
        actions={<a className={btn.ghost} href="/api/admin/exports/credits">Export credits (xlsx)</a>} />
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi index={0} label="Players" value={data.length} accent="#2B5FB8" icon={<path d="M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm-7 10a7 7 0 0 1 14 0z" />} />
        <Kpi index={1} accent="#8A97A8" icon={<path d="M12 7v5l3 2M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z" />} label="Not started" value={data.filter((p) => p.attempts === 0).length} />
        <Kpi index={2} accent="#16A34A" icon={<path d="M5 12l5 5 9-10" />} label="Passed Trial" value={passed} />
        <Kpi index={3} accent="#F15A24" icon={<path d="M8 5v14l11-7z" />} label="In a round now" value={data.filter((p) => p.inProgress).length} />
      </div>
      <Card pad={false}>
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-3">
          <input className={`${input} max-w-xs`} placeholder="Search name, email, office, mobile" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search players" />
          <select className={select} value={state} onChange={(e) => setState(e.target.value)} aria-label="Filter by state"><option value="">All states</option>{states.map((s) => <option key={s}>{s}</option>)}</select>
          <select className={select} value={stage} onChange={(e) => setStage(e.target.value)} aria-label="Filter by progress">
            <option value="">All progress</option><option value="not_started">Not started</option><option value="in_progress">In a round now</option>
            <option value="trial_failed">Trial not yet passed</option><option value="trial_passed">Trial passed</option><option value="flagged">Fair-play signals</option>
          </select>
          <select className={select} value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort">
            <option value="lastActive">Sort: last active</option><option value="credits">Sort: credits</option><option value="registered">Sort: newest</option><option value="name">Sort: name</option>
          </select>
          <span className="ml-auto text-xs text-slate-500">{rows.length} of {data.length}</span>
        </div>
        {isLoading ? <div className="p-4"><Empty>Loading…</Empty></div> : rows.length === 0 ? <div className="p-4"><Empty>No players match.</Empty></div> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50"><tr>
                <th className={th}>Player</th><th className={th}>Office · State</th>
                {LEVELS.map((l) => <th key={l.key} className={th}>{l.label}</th>)}
                <th className={th}>Credits</th><th className={th}>Signals</th><th className={th}>Last active</th>
              </tr></thead>
              <tbody>{rows.map((p) => (
                <tr key={p.id} className={`${tr} cursor-pointer`} onClick={() => setParams({ open: p.id })} tabIndex={0} onKeyDown={(e) => e.key === "Enter" && setParams({ open: p.id })}>
                  <td className={td}><div className="flex items-center gap-2">{(() => { const top = [...p.rounds].reverse().find((x: any) => x.titleEarned); return top ? <span title={`Highest title: ${top.key}`}><Medal k={top.key} size={28} /></span> : null; })()}<div><div className="font-semibold text-slate-900">{p.name}</div><div className="text-xs text-slate-500">{p.email}</div></div></div></td>
                  <td className={`${td} max-w-[16rem]`}><div className="truncate text-xs text-slate-700" title={p.office}>{p.office}</div><div className="text-xs text-slate-500">{p.state}</div></td>
                  {LEVELS.map((l) => {
                    const r = p.rounds.find((x: any) => x.key === l.key);
                    return <td key={l.key} className={`${td} tabular-nums`}>{r?.chancesUsed ? <><b className={r.titleEarned ? "text-emerald-700" : "text-slate-900"}>{r.best ?? "…"}</b><div className="text-[11px] text-slate-500">{r.chancesUsed} used{r.titleEarned && " · title"}</div></> : <span className="text-slate-300">—</span>}</td>;
                  })}
                  <td className={`${td} w-28`}><div className="font-semibold tabular-nums">{p.totalCredits}<span className="text-xs font-normal text-slate-400"> / 50</span></div><Meter label="Credits" value={(p.totalCredits / 50) * 100} color="#D6A642" /></td>
                  <td className={td}>{p.inProgress && <Pill tone="navy">● playing</Pill>} {p.leaves + p.pasteBlocks > 0 && <Pill tone="amber" title="left page · paste blocked">⚑ {p.leaves}·{p.pasteBlocks}</Pill>}</td>
                  <td className={`${td} whitespace-nowrap text-xs text-slate-600`} title={new Date(p.lastActiveAt).toLocaleString()}>{ago(p.lastActiveAt)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </Card>
      {openId && <PlayerDrawer id={openId} onClose={() => setParams({})} />}
    </div>
  );
}

function PlayerDrawer({ id, onClose }: { id: string; onClose(): void }) {
  const qc = useQueryClient();
  const isManager = useIsManager();
  const { data: p, error } = useQuery({ queryKey: ["admin-player", id], queryFn: () => api<any>(`/admin/players/${id}`) });
  const [confirm, setConfirm] = useState<null | "reset" | "delete">(null);
  const [reason, setReason] = useState("");
  const [done, setDone] = useState("");
  const run = async (deletePlayer: boolean) => {
    const r = await api<any>(`/admin/players/${id}/reset`, { body: { confirmEmail: p.email, deletePlayer, reason: reason || undefined } });
    setDone(deletePlayer ? `Player deleted (${r.attempts} attempts, ${r.chats} chat messages removed).` : `Progress reset: ${r.attempts} attempts, ${r.events} events and ${r.chats} chat messages removed.`);
    qc.invalidateQueries({ queryKey: ["admin-players"] });
    qc.invalidateQueries({ queryKey: ["analytics"] });
    if (deletePlayer) onClose(); else qc.invalidateQueries({ queryKey: ["admin-player", id] });
  };
  return (
    <Drawer open onClose={onClose} title={p ? <>{p.name} <span className="ml-2 text-sm font-normal text-slate-500">{p.email}</span></> : "Player"}>
      {error && <Empty>Player not found (it may have been deleted).</Empty>}
      {p && (
        <div className="space-y-4">
          {done && <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{done}</div>}
          <Card>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm md:grid-cols-3">
              <div><dt className="text-xs text-slate-500">Office</dt><dd className="text-slate-900">{p.office}</dd></div>
              <div><dt className="text-xs text-slate-500">State · city</dt><dd>{p.state} · {p.city}</dd></div>
              <div><dt className="text-xs text-slate-500">Mobile</dt><dd className="tabular-nums">{p.mobile}</dd></div>
              <div><dt className="text-xs text-slate-500">Registered</dt><dd>{fmtDate(p.registeredAt)}</dd></div>
              <div><dt className="text-xs text-slate-500">Last active</dt><dd>{fmtDate(p.lastActiveAt)}</dd></div>
              <div><dt className="text-xs text-slate-500">Total credits</dt><dd className="font-bold">{p.totalCredits} / 50 · {p.stars} ★</dd></div>
              <div><dt className="text-xs text-slate-500">Fair play</dt><dd>{p.leaves} leaves · {p.pasteBlocks} paste blocks · {p.autoSubmits} time-outs</dd></div>
              <div><dt className="text-xs text-slate-500">Sahayak chat</dt><dd>{p.chat.n} questions{p.chat.blocked ? ` · ${p.chat.blocked} blocked` : ""}</dd></div>
              <div className="col-span-2 md:col-span-3"><dt className="text-xs text-slate-500">Office address</dt><dd className="text-slate-700">{p.officeAddress}</dd></div>
            </dl>
          </Card>
          <Card title="Levels">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {p.rounds.filter((r: any) => r.playable).map((r: any) => (
                <div key={r.key} className="rounded-md border border-slate-200 p-3">
                  <div className="flex items-center gap-1.5 text-xs font-semibold uppercase text-slate-500"><Medal k={r.key} size={24} locked={!r.titleEarned} />{r.key}</div>
                  <div className="mt-1 text-xl font-bold tabular-nums">{fmt(r.best)}</div>
                  <div className="text-xs text-slate-500">{r.chancesUsed} chances used · {r.credits} cr</div>
                  {r.titleEarned && <div className="mt-1"><Pill tone="gold">Title earned</Pill></div>}
                </div>
              ))}
            </div>
          </Card>
          <Card title="Attempt history" pad={false}>
            {p.history.length ? (
              <div className="overflow-x-auto max-w-full"><table className="w-full min-w-max text-sm">
                <thead className="bg-slate-50"><tr><th className={th}>Level · chance</th><th className={th}>Bundle</th><th className={th}>Started</th><th className={th}>Time</th><th className={th}>Score</th><th className={th} title="v2: Translation Quality / Glossary / Timeliness & Completion (older attempts: T/C/S/G/Ti)">Measures (Q/G/TC)</th><th className={th}>Signals</th></tr></thead>
                <tbody>{p.history.map((a: any) => (
                  <tr key={a.id} className={tr}>
                    <td className={td}><b>{a.roundName}</b> · {a.chanceNo}<div>{a.status === "active" ? <Pill tone="navy">in progress</Pill> : a.autoSubmitted ? <Pill tone="amber">timed out</Pill> : <Pill tone="green">submitted</Pill>}</div></td>
                    <td className={`${td} max-w-[12rem] truncate text-xs`} title={a.page}>{a.page}</td>
                    <td className={`${td} whitespace-nowrap text-xs`}>{fmtDate(a.startedAt)}</td>
                    <td className={`${td} tabular-nums text-xs`}>{a.minutes === null ? "—" : `${a.minutes} min`}</td>
                    <td className={`${td} font-bold tabular-nums`}>{fmt(a.score)}</td>
                    <td className={`${td} tabular-nums text-xs text-slate-600`}>{a.measures ? (a.measures.model === 2 ? ["quality", "glossary", "timeliness"] : ["translation", "completion", "sentence", "glossary", "time"]).map((k) => Math.round((a.measures[k] ?? 0) * 100)).join(" / ") : "—"}</td>
                    <td className={`${td} text-xs`}>{a.leaves} left · {a.pasteBlocks} paste · {a.chat} chat</td>
                  </tr>
                ))}</tbody>
              </table></div>
            ) : <div className="p-4"><Empty>No attempts yet.</Empty></div>}
          </Card>
          {isManager && (
            <Card title="Danger zone" subtitle="Audited. Use for test accounts or when CAG approves a fresh start for an officer.">
              <label className="mb-3 block text-sm">Reason (recorded in the audit log)<input className={`${input} mt-1`} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. test account / approved by Hindi cell" /></label>
              <div className="flex flex-wrap gap-2">
                <button className={btn.dangerGhost} onClick={() => setConfirm("reset")}>Reset progress…</button>
                <button className={btn.danger} onClick={() => setConfirm("delete")}>Delete player…</button>
              </div>
            </Card>
          )}
          <ConfirmDanger open={confirm === "reset"} onClose={() => setConfirm(null)} title="Reset player progress" phrase={p.email} action="Reset progress"
            body={<>Deletes all of <b>{p.name}</b>'s attempts, scores, events and chat messages. Registration (and its {p.registrationCredits} credits) is kept; all chances become available again. This cannot be undone.</>}
            onConfirm={() => run(false)} />
          <ConfirmDanger open={confirm === "delete"} onClose={() => setConfirm(null)} title="Delete player" phrase={p.email} action="Delete player"
            body={<>Deletes <b>{p.name}</b>'s registration and all their play data. They would need to register again. This cannot be undone.</>}
            onConfirm={() => run(true)} />
        </div>
      )}
    </Drawer>
  );
}
