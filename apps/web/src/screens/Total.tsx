import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { Summary } from "@hc/shared";
import { api } from "../lib/api";
import { useConfig } from "../lib/queries";
import { sfx } from "../lib/sfx";
import { lineText, t } from "../lib/strings";
import type { Line } from "../lib/voice";
import { Coin, Confetti, Header, Page, PageTitle, ProgressBar, Spinner, Stars } from "../components/Layout";
import { SahayikaPanel } from "../components/Sahayika";
import { Ambient, CountUp, GameButton, Medal } from "../components/Juice";
import { Icon } from "../components/Icon";

/** §7.8 Total score — design 14, as a Hall of Fame. */
export function Total() {
  const nav = useNavigate();
  const { data: cfg } = useConfig();
  const { data } = useQuery({ queryKey: ["summary"], queryFn: () => api<{ playerName: string; summary: Summary; maxCredits: number; lines: Line[] }>("/me/summary") });
  const [picker, setPicker] = useState(false);
  useEffect(() => { if (data) setTimeout(() => sfx("fanfare"), 300); }, [!!data]);
  if (!data || !cfg) return <><Header /><Spinner /></>;
  const s = data.summary;
  const replayable = s.rounds.filter((r) => r.unlocked && r.chancesLeft > 0);
  const note = data.lines.find((l) => l.id === "end.screen.replay_note");
  const said = data.lines.filter((l) => l.id !== "end.screen.replay_note");
  return (
    <>
      <Header />
      <Ambient density={14} />
      <Confetti run={s.rounds.every((r) => r.titleEarned)} />
      <Page>
        <PageTitle kicker={t("journey.hallOfFame")} hi={t("total.heading")} en={t("total.headingEn")} right={<GameButton variant="ghost" onClick={() => nav("/journey")}><Icon name="map" size={18} /> {t("reportCard.map")}</GameButton>} />
        <div className="grid lg:grid-cols-[1fr_1.15fr] gap-6">
          <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ type: "spring", stiffness: 200, damping: 26 }} className="sahayika-panel hud-grid p-6 sm:p-8 relative overflow-hidden text-center">
            <div className="absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r from-primary via-gold to-transparent" aria-hidden />
            <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 260, damping: 22, delay: 0.2 }} className="mx-auto w-20 h-20 rounded-full grid place-items-center text-gold-light border border-gold/50 bg-white/[0.06] shadow-gold" aria-hidden><Icon name="trophy" size={40} stroke={1.6} /></motion.div>
            <h2 className="mt-4 text-2xl sm:text-3xl font-extrabold tracking-tight">{t("total.congrats", { name: data.playerName })}</h2>
            <div className="mt-3 flex items-center justify-center gap-3">
              <Coin size={48} />
              <span className="text-7xl font-extrabold text-gold-light tnum tracking-tight"><CountUp to={s.totalCredits} decimals={1} duration={1.8} onTick={() => sfx("coin")} /></span>
              <span className="text-2xl text-white/70 tnum">/ {data.maxCredits}</span>
            </div>
            <div className="mt-3 max-w-xs mx-auto"><ProgressBar value={s.totalCredits / data.maxCredits} tone="gold" checkpoints={5} /></div>
            <div className="mt-4 flex justify-center"><Stars n={s.stars} total={s.starsTotal} size={34} animate /></div>
            <p className="mt-4 text-[1.05rem] text-white/90">{t("total.useCredits")}</p>
            <div className="mt-5 flex flex-wrap justify-center gap-3">
              <a className="btn-primary" href="/api/me/certificate?format=pdf" onClick={() => sfx("coin")}><Icon name="file" size={18} /> {t("total.download")}</a>
              {replayable.length > 0 && <GameButton variant="light" onClick={() => setPicker(true)}><Icon name="arrowUp" size={18} /> {t("total.improve")}</GameButton>}
            </div>
            {note && <p className="mt-3 text-sm text-blue-100/80">{lineText(note)}</p>}
          </motion.section>

          <div className="space-y-5">
            <div className="card p-5">
              <h3 className="kicker mb-3">{t("journey.titles")}</h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {cfg.rounds.filter((r) => r.playable !== false).map((r, i) => (
                  <motion.div key={r.key} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 + i * 0.08, duration: 0.3 }}
                    className={`rounded-ui border p-3 text-center ${s.rounds[i].titleEarned ? "border-gold-light bg-gold-soft" : "border-slate-200"}`}>
                    <div className="flex justify-center"><Medal k={r.key} size={56} locked={!s.rounds[i].titleEarned} shine={s.rounds[i].titleEarned} /></div>
                    <div className="mt-1 text-sm font-extrabold text-navy">{r.titleEn}</div>
                    <div className="text-[11px] text-muted">{s.rounds[i].titleEarned ? r.titleMeaning : t("journey.titleLocked")}</div>
                  </motion.div>
                ))}
              </div>
            </div>
            <section className="card p-4 sm:p-5">
              <table className="w-full">
                <thead><tr className="text-[11px] font-bold uppercase tracking-[0.14em] text-navy-600 text-left"><th className="pb-2">{t("total.colRound")}</th><th className="pb-2 text-center">{t("total.colBest")}</th><th className="pb-2 text-right">{t("total.colCredits")}</th></tr></thead>
                <tbody>
                  <tr className="border-t border-slate-100"><td className="py-2.5 font-bold text-navy"><span className="inline-flex items-center gap-2"><Icon name="user" size={16} className="text-navy-600" /> {t("total.registration")}</span></td><td /><td className="text-right font-extrabold text-gold-deep tnum">+{s.registrationCredits}</td></tr>
                  {s.rounds.filter((r) => r.playable).map((r, i) => (
                    <tr key={r.key} className="border-t border-slate-100">
                      <td className="py-2.5"><span className="font-bold text-navy">{cfg.rounds[i].nameEn} Round</span><div className={`text-sm flex items-center gap-1 ${r.titleEarned ? "text-success font-semibold" : "text-muted"}`}>{cfg.rounds[i].titleEn}{r.titleEarned && <><Icon name="check" size={14} stroke={2.4} /><span className="sr-only">{"\u2713"}</span></>}</div></td>
                      <td className="text-center"><span className="font-bold tnum text-navy">{r.best ?? "—"} / 100</span><div className="text-xs text-muted">{t("total.chancesUsed", { n: r.chancesUsed })}</div></td>
                      <td className="text-right font-extrabold text-gold-deep tnum">+{r.credits}</td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-navy/15"><td className="pt-3 text-xl font-extrabold text-navy">{t("total.totalCredits")}</td><td /><td className="pt-3 text-right text-2xl font-extrabold tnum text-navy">{s.totalCredits}</td></tr>
                </tbody>
              </table>
              <p className="mt-2 text-sm text-muted">{t("total.bestAdded")}</p>
            </section>
            <SahayikaPanel lines={said} />
            {cfg.rounds.some((r) => r.playable === false) && (
              <motion.button whileHover={{ y: -2 }} onClick={() => nav("/play/varchaspati")} className="w-full text-left rounded-card bg-gradient-to-r from-purple-950 via-purple-900 to-purple-700 text-white p-5 flex items-center gap-4 shadow-pop border border-purple-400/30">
                <Medal k="varchaspati" size={60} phase2 />
                <span className="flex-1"><span className="block kicker !text-purple-200">{t("varchaspati.kicker")}</span>
                  <span className="block text-xl font-extrabold">{t("varchaspati.teaser")}</span><span className="block text-sm text-purple-100">{t("varchaspati.tagline")}</span></span>
                <Icon name="arrowRight" size={24} />
              </motion.button>
            )}
          </div>
        </div>
      </Page>
      <AnimatePresence>
        {picker && (
          <motion.div className="fixed inset-0 z-[80] bg-navy-900/50 backdrop-blur-sm grid place-items-center p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setPicker(false)}>
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }} transition={{ duration: 0.2 }} className="card shadow-pop w-full max-w-md p-5" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
              <h2 className="text-xl font-bold text-navy">{t("total.pickRound")}</h2>
              <div className="mt-3 space-y-2">
                {replayable.length === 0 && <p className="text-muted">{t("total.nothingToReplay")}</p>}
                {replayable.map((r) => {
                  const rc = cfg.rounds.find((x) => x.key === r.key)!;
                  return (
                    <motion.button key={r.key} whileHover={{ x: 2 }} whileTap={{ scale: 0.98 }} onClick={() => { sfx("whoosh"); nav(`/play/${r.key}`); }}
                      className="w-full text-left rounded-ui border border-slate-200 hover:border-navy-600 hover:bg-navy-50 px-4 py-3 flex items-center gap-3 transition">
                      <Medal k={r.key} size={40} locked={!r.titleEarned} />
                      <span className="flex-1"><span className="font-bold text-navy">{rc.nameEn} Round</span> <span className="text-sm text-muted">· {t("journey.best", { n: r.best ?? "—" })}</span></span>
                      <span className="text-sm font-semibold text-primary-strong inline-flex items-center gap-1"><Icon name="replay" size={14} /> {t("reportCard.replay", { n: r.chancesLeft })}</span>
                    </motion.button>
                  );
                })}
              </div>
              <button className="mt-4 btn-ghost py-2 text-base" onClick={() => setPicker(false)}>{t("common.close")}</button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
