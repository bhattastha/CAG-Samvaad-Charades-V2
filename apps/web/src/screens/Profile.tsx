import { motion } from "framer-motion";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { Summary } from "@hc/shared";
import { api } from "../lib/api";
import { useConfig } from "../lib/queries";
import { t } from "../lib/strings";
import { Avatar, Coin, Header, Page, ProgressBar, Spinner, Stars } from "../components/Layout";
import { GameButton, Medal } from "../components/Juice";
import { Icon } from "../components/Icon";

interface ProfileData {
  player: { name: string; email: string; mobile: string; office: { name: string; nameHi?: string; city: string; state: string } | null; address: string; registeredAt: string };
  summary: Summary;
  standing: { rank: number; of: number; tier: string | null } | null;
  history: { id: string; roundKey: string; chance: number; status: string; score: number | null; startedAt: string; submittedAt: string | null; minutes: number | null; autoSubmitted: boolean }[];
  achievements: { key: string; earned: boolean }[];
}

const ACH_ICON: Record<string, string> = {
  enlisted: "user", firstClear: "flame", trialCleared: "unlock", glossaryAce: "book", swift: "zap", cleanSheet: "shield",
  comeback: "replay", allRounder: "layers", grandSlam: "crown", topTen: "trophy",
};

/** My profile: player card, standing, level records, achievements and attempt history. */
export function Profile() {
  const nav = useNavigate();
  const { data: cfg } = useConfig();
  const { data } = useQuery({ queryKey: ["profile"], queryFn: () => api<ProfileData>("/me/profile") });
  if (!data || !cfg) return <><Header /><Spinner /></>;
  const s = data.summary;
  const roundCfg = (k: string) => cfg.rounds.find((r) => r.key === k)!;
  const tier = data.standing?.tier ? roundCfg(data.standing.tier).titleEn : t("leaderboard.recruit");
  const earned = data.achievements.filter((a) => a.earned).length;
  const date = (d: string) => new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  return (
    <>
      <Header />
      <Page>
        <div className="grid lg:grid-cols-[22rem_1fr] gap-6 items-start">
          {/* player card */}
          <motion.aside initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }} className="space-y-4 lg:sticky lg:top-24">
            <div className="card-dark hud-grid p-6 relative overflow-hidden">
              <div className="absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r from-primary via-gold to-transparent" aria-hidden />
              <div className="kicker !text-gold-light">{t("profile.card")}</div>
              <div className="mt-4 flex items-center gap-4">
                <Avatar name={data.player.name} size={72} />
                <div className="min-w-0">
                  <h1 className="text-2xl font-extrabold leading-tight">{data.player.name}</h1>
                  <div className="mt-1 inline-flex items-center gap-1.5 rounded bg-white/10 px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.14em] text-gold-light">
                    {data.standing?.tier ? <Medal k={data.standing.tier} size={18} /> : <Icon name="shield" size={12} />} {tier}
                  </div>
                </div>
              </div>
              <div className="mt-5 grid grid-cols-3 gap-2 text-center">
                <Stat label={t("profile.rank")} value={data.standing ? `#${data.standing.rank}` : "—"} />
                <Stat label={t("common.credits")} value={<span className="inline-flex items-center gap-1"><Coin size={15} />{s.totalCredits}</span>} />
                <Stat label={t("profile.titles")} value={`${s.rounds.filter((r) => r.playable && r.titleEarned).length}/4`} />
              </div>
              <div className="mt-4"><ProgressBar value={s.totalCredits / cfg.maxCredits} tone="gold" checkpoints={5} label={t("journey.creditsMeter")} /></div>
              <div className="mt-2 flex justify-between text-xs text-blue-100/70"><span>{t("profile.toMax", { n: Math.round((cfg.maxCredits - s.totalCredits) * 10) / 10 })}</span><Stars n={s.stars} total={s.starsTotal} size={13} /></div>
            </div>
            <div className="card p-5 text-sm space-y-3">
              <div className="kicker">{t("profile.details")}</div>
              <Detail icon="mail" label={t("registration.email")} value={data.player.email} />
              <Detail icon="phone" label={t("registration.mobile")} value={data.player.mobile} />
              <Detail icon="home" label={t("registration.office")} value={data.player.office ? `${data.player.office.name}` : "—"} sub={data.player.office ? `${data.player.office.city}, ${data.player.office.state}` : undefined} />
              <Detail icon="clock" label={t("profile.joined")} value={date(data.player.registeredAt)} />
              <p className="text-xs text-muted pt-1 border-t border-slate-100">{t("profile.privacy")}</p>
            </div>
          </motion.aside>

          <div className="space-y-6">
            {/* level records */}
            <section className="card p-5 sm:p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-extrabold text-navy">{t("profile.levels")}</h2>
                <Link to="/journey" className="text-sm font-semibold text-navy-600 inline-flex items-center gap-1 hover:underline">{t("profile.openMap")} <Icon name="chevronRight" size={14} /></Link>
              </div>
              <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-3">
                {s.rounds.filter((r) => r.playable).map((r) => {
                  const rc = roundCfg(r.key);
                  return (
                    <button key={r.key} onClick={() => nav(`/play/${r.key}`)} disabled={!r.unlocked}
                      className={`text-left rounded-ui border p-3 transition hover:border-navy ${r.titleEarned ? "border-gold-light bg-gold-soft/60" : "border-slate-200"}`}>
                      <div className="flex items-center gap-2"><Medal k={r.key} size={36} locked={!r.titleEarned} />
                        <div className="min-w-0"><div className="text-[11px] font-bold uppercase tracking-wider text-navy-600">{rc.levelLabel}</div><div className="font-bold text-navy truncate">{rc.nameEn}</div></div></div>
                      <div className="mt-3 flex items-end justify-between">
                        <div><div className="text-2xl font-extrabold tnum text-navy">{r.best ?? "—"}<span className="text-sm text-muted">/100</span></div><div className="text-[11px] text-muted">{t("profile.best")}</div></div>
                        <div className="text-right"><div className="font-bold text-gold-deep tnum">+{r.credits}</div><div className="text-[11px] text-muted">{t("profile.chancesUsed", { n: r.chancesUsed })}</div></div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>

            {/* achievements */}
            <section className="card p-5 sm:p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-extrabold text-navy">{t("profile.achievements")}</h2>
                <span className="text-sm font-bold text-muted tnum">{earned} / {data.achievements.length}</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3">
                {data.achievements.map((a, i) => (
                  <motion.div key={a.key} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}
                    className={`rounded-ui border p-3 ${a.earned ? "border-gold-light bg-white" : "border-dashed border-slate-300 bg-slate-50/60"}`} title={t(`profile.ach.${a.key}.body`)}>
                    <span className={`w-10 h-10 rounded-md grid place-items-center ${a.earned ? "bg-navy text-gold-light" : "bg-slate-200 text-slate-400"}`}><Icon name={a.earned ? ACH_ICON[a.key] ?? "award" : "lock"} size={20} /></span>
                    <div className={`mt-2 text-sm font-bold ${a.earned ? "text-navy" : "text-muted"}`}>{t(`profile.ach.${a.key}.title`)}</div>
                    <div className="text-[11px] text-muted leading-snug">{t(`profile.ach.${a.key}.body`)}</div>
                  </motion.div>
                ))}
              </div>
            </section>

            {/* history */}
            <section className="card overflow-hidden">
              <div className="px-5 pt-5 pb-3 flex items-center justify-between">
                <h2 className="text-lg font-extrabold text-navy">{t("profile.history")}</h2>
                <GameButton variant="ghost" className="!py-1.5 !text-sm" onClick={() => nav("/total")}><Icon name="award" size={16} />{t("nav.certificate")}</GameButton>
              </div>
              {data.history.length === 0 ? <p className="px-5 pb-6 text-muted">{t("profile.noHistory")}</p> : (
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-[11px] uppercase tracking-[0.12em] text-muted">
                    <tr><th className="text-left px-5 py-2">{t("profile.colLevel")}</th><th className="text-left px-2 py-2">{t("profile.colChance")}</th><th className="text-left px-2 py-2 hidden sm:table-cell">{t("profile.colDate")}</th><th className="text-left px-2 py-2 hidden sm:table-cell">{t("profile.colTime")}</th><th className="text-right px-5 py-2">{t("profile.colScore")}</th></tr>
                  </thead>
                  <tbody>
                    {data.history.map((h) => (
                      <tr key={h.id} className="border-t border-slate-100 hover:bg-slate-50/70 cursor-pointer" onClick={() => nav(h.status === "active" ? `/round/${h.id}` : `/report/${h.id}`)}>
                        <td className="px-5 py-2.5"><span className="inline-flex items-center gap-2"><Medal k={h.roundKey} size={22} locked={h.status !== "active" && (h.score ?? 0) < cfg.titlePassMark} /><span className="font-semibold text-navy">{roundCfg(h.roundKey)?.nameEn}</span></span></td>
                        <td className="px-2 py-2.5 tnum">{h.chance} / {cfg.maxChancesPerRound}</td>
                        <td className="px-2 py-2.5 hidden sm:table-cell text-muted">{date(h.startedAt)}</td>
                        <td className="px-2 py-2.5 hidden sm:table-cell text-muted tnum">{h.minutes ? `${h.minutes} min` : "—"}{h.autoSubmitted ? ` · ${t("profile.auto")}` : ""}</td>
                        <td className="px-5 py-2.5 text-right">{h.status === "active" ? <span className="chip bg-navy text-white border-navy">{t("profile.inProgress")}</span> : <span className={`font-extrabold tnum ${(h.score ?? 0) >= cfg.titlePassMark ? "text-success" : "text-navy"}`}>{h.score}</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          </div>
        </div>
      </Page>
    </>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-ui bg-white/[0.06] border border-white/10 py-2">
      <div className="text-lg font-extrabold tnum">{value}</div>
      <div className="text-[10px] uppercase tracking-[0.14em] text-blue-100/70">{label}</div>
    </div>
  );
}
function Detail({ icon, label, value, sub }: { icon: string; label: string; value: string; sub?: string }) {
  return (
    <div className="flex items-start gap-3">
      <Icon name={icon} size={16} className="mt-0.5 text-navy-600" />
      <div className="min-w-0"><div className="text-[11px] uppercase tracking-wider text-muted">{label}</div><div className="font-semibold text-navy break-words">{value}</div>{sub && <div className="text-xs text-muted">{sub}</div>}</div>
    </div>
  );
}
