import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { Card, CountUp, Empty, Kpi, PageHeader, Pill, Segmented, GOLD, NAVY, SAFFRON, ago, fmt, fmtDay, th, td, tr } from "./ui";
import { Donut, Funnel, GroupedBars, HBars, Histogram, LEVEL_COLORS, LineTrend, PALETTE, StackedBars } from "./charts";

type Range = "7d" | "30d" | "all";
const MEASURES = [
  { key: "quality", label: "Translation Quality", color: PALETTE[0] },
  { key: "glossary", label: "Glossary Usage", color: PALETTE[3] },
  { key: "timeliness", label: "Timeliness & Completion", color: PALETTE[4] },
];
const KIND: Record<string, { tone: any; label: string }> = {
  registration: { tone: "navy", label: "Registered" }, start: { tone: "slate", label: "Started" }, submit: { tone: "green", label: "Submitted" },
  auto_submit: { tone: "amber", label: "Timed out" }, admin: { tone: "gold", label: "Console" },
};

export function Overview() {
  const [range, setRange] = useState<Range>("30d");
  const { data: d, isLoading, error } = useQuery({ queryKey: ["analytics", range], queryFn: () => api<any>(`/admin/analytics/overview?range=${range}`), refetchInterval: 30_000 });
  const { data: feed = [] } = useQuery({ queryKey: ["activity"], queryFn: () => api<any[]>("/admin/activity?limit=25"), refetchInterval: 15_000 });
  const rangeLabel = range === "all" ? "all time" : `last ${range === "7d" ? "7" : "30"} days`;
  return (
    <div>
      <PageHeader title="Overview" subtitle={<>Live activity across the game · activity figures for <b>{rangeLabel}</b>; totals (players, credits, funnel) are all-time.{d && <> Updated {ago(d.generatedAt)}.</>}</>}
        actions={<Segmented label="Date range" value={range} onChange={setRange} items={[{ key: "7d", label: "7 days" }, { key: "30d", label: "30 days" }, { key: "all", label: "All time" }]} />} />
      {isLoading && <Empty>Loading analytics…</Empty>}
      {error && <Empty>Could not load analytics.</Empty>}
      {d && <Body d={d} feed={feed} />}
    </div>
  );
}

function Body({ d, feed }: { d: any; feed: any[] }) {
  const k = d.kpis;
  const playable = d.levels.filter((l: any) => l.playable);
  const lowContent = d.pageCounts.filter((p: any) => d.levels.find((l: any) => l.key === p.key)?.playable && p.published < 3);
  return (
    <div className="space-y-5">
      {lowContent.length > 0 && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Content gap: {lowContent.map((p: any) => `${p.name} (${p.published} published)`).join(", ")} — each level needs at least 3 published bundles for review. <Link className="font-semibold underline" to="/manager/content">Open content library</Link>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Kpi index={0} label="Registered players" value={k.playersRegistered} sub={`+${k.newPlayers} in range`} accent={LEVEL_COLORS.pro} icon={<path d="M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm-7 10a7 7 0 0 1 14 0zm15-10a3 3 0 1 0 0-6M22 21a6 6 0 0 0-4-5.6" />} />
        <Kpi index={1} label="Active today" value={k.activeToday} sub={`${k.active7d} in last 7 days`} accent={SAFFRON} icon={<path d="M13 2 4 14h7l-1 8 9-12h-7z" />} />
        <Kpi index={2} label="Attempts started" value={k.attemptsStarted} sub={`${k.attemptsInProgress} in progress now`} accent={LEVEL_COLORS.varchaspati} icon={<path d="M8 5v14l11-7z" />} />
        <Kpi index={3} label="Completion rate" value={k.completionRate === null || k.completionRate === undefined ? null : <><CountUp value={k.completionRate} />%</>} sub={`${k.attemptsSubmitted} submitted · ${k.attemptsAutoSubmitted} timed out`} accent="#16A34A" icon={<path d="M5 12l5 5 9-10" />} />
        <Kpi index={4} label="Trial pass rate" value={k.trialPassRate === null || k.trialPassRate === undefined ? null : <><CountUp value={k.trialPassRate} />%</>} sub={`qualifying score ${d.trialQualifyingScore}`} accent={LEVEL_COLORS.trial} icon={<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" />} />
        <Kpi index={5} label="Credits awarded" value={k.creditsAwarded} sub={`avg ${fmt(k.avgCreditsPerPlayer)} / ${k.maxCredits} · ${k.titlesEarned} titles`} accent={GOLD} icon={<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4" />} />
      </div>

      <div className="grid gap-5 xl:grid-cols-3">
        <Card title="Daily activity" subtitle="Registrations, attempts started and submitted per day (IST)" className="xl:col-span-2">
          <LineTrend label="Daily registrations and attempts" xKey="label" data={d.trend.map((t: any) => ({ ...t, label: fmtDay(t.day) }))}
            series={[{ key: "started", label: "Attempts started", color: PALETTE[0] }, { key: "submitted", label: "Submitted", color: PALETTE[2] }, { key: "registrations", label: "Registrations", color: PALETTE[1] }]} />
        </Card>
        <Card title="Engagement funnel" subtitle="All-time; each step counts distinct players">
          <Funnel label="Engagement funnel" steps={d.funnel} />
        </Card>
      </div>

      <Card title="Levels at a glance" subtitle={`Best score per player counts. Pass = title mark ≥ ${d.passMark}.`} pad={false}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50"><tr><th className={th}>Level</th><th className={th}>Started</th><th className={th}>Submitted</th><th className={th}>Players</th><th className={th}>Avg best</th><th className={th}>Median best</th><th className={th}>Pass rate</th><th className={th}>Avg time</th><th className={th}>Published bundles</th></tr></thead>
            <tbody>{d.levels.map((l: any) => {
              const pc = d.pageCounts.find((p: any) => p.key === l.key);
              return (
                <tr key={l.key} className={tr}>
                  <td className={td}><span className="mr-2 inline-block h-2.5 w-2.5 rounded-sm align-middle" style={{ background: LEVEL_COLORS[l.key] }} aria-hidden /><b>{l.name}</b> <span className="text-xs text-slate-500">{l.levelLabel}</span>{!l.playable && <span className="ml-2"><Pill tone="purple">preview</Pill></span>}</td>
                  <td className={`${td} tabular-nums`}>{l.started}</td><td className={`${td} tabular-nums`}>{l.submitted}</td><td className={`${td} tabular-nums`}>{l.players}</td>
                  <td className={`${td} tabular-nums font-semibold`}>{fmt(l.avgBest)}</td><td className={`${td} tabular-nums`}>{fmt(l.medianBest)}</td>
                  <td className={`${td} tabular-nums`}>{fmt(l.passRate, "%")}</td><td className={`${td} tabular-nums`}>{l.avgMinutes === null ? "—" : `${l.avgMinutes} min`}</td>
                  <td className={td}>{l.playable ? <span className={pc.published < 3 ? "font-semibold text-red-700" : "text-slate-700"}>{pc.published}{pc.published < 3 && " · needs ≥ 3"}</span> : "—"}<span className="text-xs text-slate-400"> · {pc.draft} draft</span></td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
      </Card>

      <Card title="Score distribution by level" subtitle={`Best score per player, in bands of 10. Dashed line = title pass mark (${d.passMark}).`}>
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
          {playable.map((l: any) => (
            <div key={l.key}>
              <div className="mb-1 text-xs font-semibold text-slate-700">{l.name} <span className="font-normal text-slate-500">· {l.players} players</span></div>
              <Histogram label={`${l.name} best-score distribution`} color={LEVEL_COLORS[l.key]} markAt={d.passMark} markLabel={`pass ${d.passMark}`} xLabel="Score"
                bins={l.histogram.map((b: any) => ({ label: String(b.from), n: b.n, from: b.from }))} />
            </div>
          ))}
        </div>
      </Card>

      <div className="grid gap-5 xl:grid-cols-3">
        <Card title="Measure breakdown" subtitle="Average of each scoring measure (0–100%) across submitted attempts" className="xl:col-span-2">
          {playable.some((l: any) => l.submitted) ? (
            <GroupedBars label="Average measures per level" series={MEASURES} groups={playable.map((l: any) => ({ label: l.name, values: l.measures }))} />
          ) : <Empty>No submitted attempts in this range.</Empty>}
        </Card>
        <Card title="Credits distribution" subtitle={`Total credits per player out of ${k.maxCredits}`}>
          <Histogram label="Credits per player" color={GOLD} yLabel="Players" xLabel="Credits" bins={d.creditBins.map((b: any) => ({ label: `${b.from}–${b.to}`, n: b.n }))} />
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-600">
            <div>Total awarded <b className="block text-base text-slate-900">{k.creditsAwarded}</b></div>
            <div>Titles earned <b className="block text-base text-slate-900">{k.titlesEarned}</b></div>
          </div>
        </Card>
      </div>

      <div className="grid gap-5 xl:grid-cols-3">
        <Card title="Attempt outcomes" subtitle="Status of attempts started in range">
          <Donut label="Attempt outcomes" sub="attempts" parts={[
            { label: "Submitted", value: k.attemptsSubmitted, color: PALETTE[2] },
            { label: "Timed out (auto-submitted)", value: k.attemptsAutoSubmitted, color: PALETTE[1] },
            { label: "In progress", value: k.attemptsInProgress, color: PALETTE[0] },
            { label: "Abandoned (past deadline)", value: Math.max(0, k.attemptsStarted - k.attemptsSubmitted - k.attemptsAutoSubmitted - k.attemptsInProgress), color: PALETTE[5] },
          ]} />
        </Card>
        <Card title="Fair-play signals" subtitle="Leaving the page, blocked copy/paste and time-outs">
          <StackedBars label="Fair-play signals per level" keys={[{ key: "leaves", label: "Left page", color: PALETTE[5] }, { key: "pasteBlocks", label: "Paste blocked", color: PALETTE[3] }, { key: "autoSubmits", label: "Timed out", color: PALETTE[1] }]}
            rows={d.fairPlay.byLevel.filter((l: any) => d.levels.find((x: any) => x.key === l.key)?.playable).map((l: any) => ({ label: l.name, values: l }))} />
          <p className="mt-3 text-xs text-slate-500">{d.fairPlay.attemptsWithLeaves} attempts with leaves · {d.fairPlay.attemptsWithPasteBlocks} with paste blocks</p>
        </Card>
        <Card title="Watch list" subtitle="Players with the most fair-play signals in range" pad={false}>
          {d.fairPlay.watchlist.length ? (
            <table className="w-full text-sm"><thead className="bg-slate-50"><tr><th className={th}>Player</th><th className={th}>Leaves</th><th className={th}>Paste</th></tr></thead>
              <tbody>{d.fairPlay.watchlist.map((w: any) => (
                <tr key={w.playerId} className={tr}><td className={td}><Link className="font-semibold text-[#24558A] hover:underline" to={`/manager/players?open=${w.playerId}`}>{w.name}</Link><div className="text-xs text-slate-500">{w.email}</div></td>
                  <td className={`${td} tabular-nums`}>{w.leaves}</td><td className={`${td} tabular-nums`}>{w.pasteBlocks}</td></tr>
              ))}</tbody></table>
          ) : <div className="p-4"><Empty>No fair-play signals in range.</Empty></div>}
        </Card>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card title="Participation by state" subtitle="Players registered (bar) with average attempt score and credits">
          {d.states.length ? <HBars label="Players by state" color={NAVY} rows={d.states.map((s: any) => ({ label: s.label, value: s.players, sub: `· avg ${fmt(s.avgScore)} · ${fmt(s.avgCredits)} cr` }))} /> : <Empty>No players yet.</Empty>}
        </Card>
        <Card title="Top offices" subtitle="By players registered, then average score">
          {d.offices.length ? <HBars label="Players by office" color={PALETTE[0]} rows={d.offices.map((s: any) => ({ label: s.label, title: s.label, value: s.players, sub: `· avg ${fmt(s.avgScore)}` }))} /> : <Empty>No players yet.</Empty>}
        </Card>
      </div>

      <div className="grid gap-5 xl:grid-cols-3">
        <Card title="Glossary: most-missed terms" subtitle={`${d.glossary.termsChecked} term checks · ${fmt(d.glossary.correctRate, "%")} correct`} className="xl:col-span-2" pad={false}>
          {d.glossary.mostMissed.length ? (
            <table className="w-full text-sm"><thead className="bg-slate-50"><tr><th className={th}>English</th><th className={th}>CAG Hindi</th><th className={th}>Missed</th><th className={th}>Miss rate</th><th className={th}>Avoid-form used</th></tr></thead>
              <tbody>{d.glossary.mostMissed.map((t: any) => (
                <tr key={t.en} className={tr}><td className={`${td} font-semibold`}>{t.en}</td><td className={td} lang="hi">{t.hi}</td><td className={`${td} tabular-nums`}>{t.missed} / {t.seen}</td><td className={`${td} tabular-nums`}>{fmt(t.missRate, "%")}</td><td className={`${td} tabular-nums`}>{t.avoid}</td></tr>
              ))}</tbody></table>
          ) : <div className="p-4"><Empty>No missed terms yet.</Empty></div>}
        </Card>
        <Card title="Avoid-forms players used" subtitle="Transliterations or non-standard Hindi found in answers">
          {d.glossary.avoidFormsUsed.length ? (
            <HBars label="Avoid forms used" color={PALETTE[5]} rows={d.glossary.avoidFormsUsed.map((f: any) => ({ label: <span lang="hi">{f.form} <span className="text-slate-400">→ {f.hi}</span></span>, title: `${f.en}: ${f.form} instead of ${f.hi}`, value: f.n }))} />
          ) : <Empty>None found yet.</Empty>}
        </Card>
      </div>

      <div className="grid gap-5 xl:grid-cols-3">
        <Card title="Content usage" subtitle="Times each bundle was served and its average score" className="xl:col-span-2" pad={false}>
          <div className="max-h-80 overflow-y-auto">
            <table className="w-full text-sm"><thead className="sticky top-0 bg-slate-50"><tr><th className={th}>Bundle</th><th className={th}>Level</th><th className={th}>Status</th><th className={th}>Used</th><th className={th}>Avg score</th></tr></thead>
              <tbody>{d.content.map((c: any) => (
                <tr key={c.id} className={tr}><td className={td}><Link to={`/manager/content/${c.id}`} className="font-semibold text-[#24558A] hover:underline">{c.label}</Link>{c.sample && <span className="ml-2"><Pill tone="amber">sample</Pill></span>}</td>
                  <td className={td}>{d.levels.find((l: any) => l.key === c.roundKey)?.name ?? c.roundKey}</td><td className={td}><Pill tone={c.status === "published" ? "green" : c.status === "retired" ? "slate" : "amber"}>{c.status}</Pill></td>
                  <td className={`${td} tabular-nums`}>{c.timesUsed}</td><td className={`${td} tabular-nums`}>{fmt(c.avgScore)}</td></tr>
              ))}</tbody></table>
          </div>
        </Card>
        <div className="space-y-5">
          <Card title="Sahayak chat" subtitle={`${d.chat.players} players asked questions`}>
            <div className="mb-3 grid grid-cols-2 gap-2 text-xs text-slate-600">
              <div>Questions <b className="block text-xl text-slate-900">{d.chat.questions}</b></div>
              <div>Blocked answers <b className={`block text-xl ${d.chat.blocked ? "text-red-700" : "text-slate-900"}`}>{d.chat.blocked}</b></div>
            </div>
            {d.chat.bySource.length ? <HBars label="Chat answers by source" color={PALETTE[0]} rows={d.chat.bySource.map((s: any) => ({ label: s.source, value: s.n }))} /> : <Empty>No chat yet.</Empty>}
            <Link to="/manager/sahayak" className="mt-3 inline-block text-xs font-semibold text-[#24558A] underline">Review chat log</Link>
          </Card>
          <Card title="BHASHINI services">
            <ul className="space-y-1.5 text-sm">{d.services.map((s: any) => (
              <li key={s.task} className="flex items-center gap-2"><span className="flex-1 capitalize text-slate-700">{s.task}</span>
                {!s.configured ? <Pill tone="slate">○ key not set</Pill> : s.open ? <Pill tone="red">✕ circuit open</Pill> : <Pill tone="green">✓ healthy</Pill>}
                {s.recentFailures > 0 && <span className="text-xs text-red-700">{s.recentFailures} fails</span>}</li>
            ))}</ul>
            {d.xlit.length > 0 && <p className="mt-3 text-xs text-slate-500">Transliteration picks: {d.xlit.map((x: any) => `#${x.index + 1}: ${x.n}`).join(" · ")}</p>}
          </Card>
        </div>
      </div>

      <Card title="Live activity" subtitle="Latest registrations, attempts and console actions · refreshes every 15 s" pad={false}>
        {feed.length ? (
          <ul className="divide-y divide-slate-100">{feed.map((f, i) => (
            <li key={i} className="flex items-center gap-3 px-4 py-2 text-sm">
              <span className="w-24 shrink-0"><Pill tone={KIND[f.kind]?.tone ?? "slate"}>{KIND[f.kind]?.label ?? f.kind}</Pill></span>
              <span className="min-w-0 flex-1 truncate text-slate-800">{f.text}</span>
              <span className="hidden truncate text-xs text-slate-500 md:block md:max-w-[14rem]">{f.who}</span>
              <span className="w-20 shrink-0 text-right text-xs text-slate-500" title={new Date(f.at).toLocaleString()}>{ago(f.at)}</span>
            </li>
          ))}</ul>
        ) : <div className="p-4"><Empty>No activity yet.</Empty></div>}
      </Card>
    </div>
  );
}
