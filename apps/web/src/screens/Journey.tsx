import { motion } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useNavigate } from "react-router-dom";
import { formatLimit } from "@hc/shared";
import { useConfig, useProgress } from "../lib/queries";
import { sfx } from "../lib/sfx";
import { roundName, t } from "../lib/strings";

const canHover = typeof window !== "undefined" && window.matchMedia?.("(hover: hover) and (pointer: fine)").matches;
import { Coin, Header, Page, PageTitle, ProgressBar, Spinner, Stars } from "../components/Layout";
import { Ambient, GameButton, Medal } from "../components/Juice";
import { SahayikaAvatar } from "../components/SahayikaAvatar";
import { Icon } from "../components/Icon";
import { Link } from "react-router-dom";

/** The level map: transparent progression from Level 1 to the final title. */
export function Journey() {
  const nav = useNavigate();
  const { data: cfg } = useConfig();
  const { data: prog } = useProgress();
  const s = prog?.summary;
  if (!cfg || !s) return <><Header /><Spinner /></>;
  const current = prog?.activeAttempt?.roundKey ?? s.nextRound ?? s.rounds.find((r) => r.unlocked && r.chancesLeft > 0)?.key ?? null;
  const q = s.trialQualifyingScore;
  const trial = s.rounds[0];
  const allOpen = cfg.levels?.unlockRule === "all-open";
  const banner = allOpen ? (trial.played > 0 ? t("journey.openPlayed") : t("journey.openFirst"))
    : s.trialPassed ? t("journey.unlockedAll")
    : trial.chancesLeft === 0 ? t("journey.trialLockedOut")
      : trial.played > 0 ? t("journey.trialRetry", { n: q, left: trial.chancesLeft }) : t("journey.trialFirst", { n: q });
  const open = (key: string) => {
    const r = s.rounds.find((x) => x.key === key)!;
    if (!r.playable) { sfx("whoosh"); nav(`/play/${key}`); return; } // Varchaspati: preview briefing
    if (!r.unlocked) { sfx("error"); return; }
    if (r.active && prog?.activeAttempt) return nav(`/round/${prog.activeAttempt.id}`);
    if (r.chancesLeft === 0) { sfx("error"); return; }
    sfx("whoosh");
    nav(`/play/${key}`);
  };
  return (
    <>
      <Header />
      <Ambient density={10} />
      <Page>
        <PageTitle kicker={t("journey.kicker")} hi={t("journey.heading")} en={t("journey.headingEn")}
          right={s.allPlayed && <GameButton sound="fanfare" variant="gold" onClick={() => nav("/total")}><Icon name="trophy" size={18} /> {t("journey.hallOfFame")}</GameButton>} />
        <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} role="status"
          className={`mb-4 rounded-ui px-4 py-3 font-semibold flex items-center gap-3 border-l-4 bg-white border border-slate-200 shadow-card ${s.trialPassed ? "border-l-success text-navy" : "border-l-primary text-navy"}`}>
          <Icon name={s.trialPassed || (allOpen && trial.played > 0) ? "unlock" : "flame"} size={20} className={s.trialPassed || (allOpen && trial.played > 0) ? "text-success" : "text-primary"} />{banner}
        </motion.div>
        <div className="grid min-[1800px]:grid-cols-[1fr_20rem] gap-6 items-start">
          {/* the trail */}
          <div className="relative card p-5 sm:p-8 overflow-hidden" style={{ backgroundImage: "linear-gradient(rgba(11,37,69,.04) 1px, transparent 1px), linear-gradient(90deg, rgba(11,37,69,.04) 1px, transparent 1px)", backgroundSize: "32px 32px" }}>
            <svg className="absolute inset-0 w-full h-full hidden lg:block" viewBox="0 0 1000 420" preserveAspectRatio="none" aria-hidden>
              <motion.path d="M 40 330 C 140 330, 150 130, 250 140 S 380 320, 450 300 S 560 120, 650 130 S 760 320, 830 290 S 930 120, 980 110" fill="none" stroke="#C49B3D" strokeOpacity=".7" strokeWidth="4" strokeLinecap="round" strokeDasharray="1 14"
                initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.6, ease: "easeInOut" }} />
            </svg>
            <div className="relative grid gap-4 sm:grid-cols-2 lg:grid-cols-5 lg:items-start">
              {cfg.rounds.map((r, i) => {
                const res = s.rounds[i];
                const preview = !res.playable;
                const locked = !res.unlocked && !preview;
                const here = r.key === current;
                const done = res.played > 0;
                return (
                  <motion.button key={r.key} type="button" onClick={() => open(r.key)}
                    initial={{ opacity: 0, y: 40, scale: 0.9 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ type: "spring", stiffness: 160, damping: 16, delay: 0.3 + i * 0.15 }}
                    whileHover={!canHover ? undefined : locked ? { x: [0, -4, 4, 0] } : { y: -8 }} whileTap={locked ? undefined : { scale: 0.96 }}
                    className={`relative text-left rounded-card border p-4 shadow-card ${i % 2 ? "lg:mt-0" : "lg:mt-24"} ${preview ? "bg-gradient-to-br from-purple-50 to-white border-purple-300 border-dashed" : "bg-white"} ${here ? "border-primary ring-4 ring-primary/15" : done ? "border-success/40" : preview ? "" : "border-slate-200"} ${locked ? "opacity-75" : ""}`}
                    aria-label={`${r.levelLabel} ${roundName(r)}${locked ? `, ${t("journey.locked")}` : ""}`}>
                    {here && (
                      <motion.div className="absolute -top-12 left-1/2 -translate-x-1/2 flex flex-col items-center" animate={{ y: [0, -6, 0] }} transition={{ repeat: Infinity, duration: 1.6 }}>
                        <span className="rounded bg-primary text-white text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 whitespace-nowrap shadow-glow">{t("journey.youAreHere")}</span>
                        <SahayikaAvatar size={30} />
                      </motion.div>
                    )}
                    <div className="flex items-center gap-3 lg:flex-col lg:items-start lg:gap-2">
                      <Medal k={r.key} size={54} locked={!res.titleEarned && !preview} phase2={preview} shine={res.titleEarned} />
                      <div>
                        <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-navy-600">{r.levelLabel}</div>
                        <div className="text-lg font-extrabold leading-tight text-navy">{roundName(r)}</div>
                        <div className="text-sm font-semibold text-gold-deep">{r.titleEn}</div>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-1.5 text-xs font-semibold [&>span]:px-2.5 [&>span]:py-1">
                      <span className="chip-plain"><Icon name="files" size={13} /> {r.pages ? t("journey.pagesLabel", { n: r.pages }) : t("journey.wordsLabel", { n: cfg.levels?.trialWords?.min ?? 300 })}</span>
                      {!preview && <span className="chip-plain"><Icon name="clock" size={13} /> {formatLimit(r.timeLimitMinutes)}</span>}
                      {!preview && <span className="chip-credit"><Coin size={13} />{r.creditCap}</span>}
                      {preview && <span className="chip bg-purple-100 border-purple-200 text-purple-800">{r.phase ?? t("journey.phase2")}</span>}
                      {!preview && <span className="chip-plain" title={r.voiceTyping ? t("journey.voiceOk") : t("journey.typingOnly")}><Icon name={r.voiceTyping ? "mic" : "keyboard"} size={13} /></span>}
                    </div>
                    <div className="mt-3 flex items-center justify-between">
                      <div className={`flex gap-1 ${preview ? "invisible" : ""}`} aria-label={t("common.chanceOf", { n: res.chancesUsed, max: 3 })}>
                        {res.chances.map((c, k) => (
                          <span key={k} title={c === null ? "" : String(c)} className={`w-3 h-3 rotate-45 rounded-[2px] border-2 ${c !== null ? (k + 1 === res.bestChance ? "bg-gold border-gold-deep" : "bg-navy-600 border-navy") : k < res.chancesUsed ? "bg-slate-300 border-slate-400" : "bg-white border-slate-300"}`} />
                        ))}
                      </div>
                      {i === 0 && !preview ? <span className="text-[11px] font-bold uppercase tracking-wider text-navy-600">{t("journey.entry")}</span> : null}
                      {preview ? <span className="text-xs font-semibold text-purple-700 inline-flex items-center gap-1"><Icon name="sparkle" size={13} /> {t("journey.comingSoon")}</span>
                        : locked ? <span className="text-xs font-semibold text-muted inline-flex items-center gap-1"><Icon name="lock" size={13} /> {t("journey.locked")}</span>
                        : res.best !== null ? <span className="text-sm font-extrabold text-success tnum">{t("journey.best", { n: res.best })}</span>
                          : null}
                    </div>
                    <div className={`mt-3 rounded-ui py-2 px-1 text-center font-bold text-[0.9rem] inline-flex w-full items-center justify-center gap-1.5 ${preview ? "bg-purple-700 text-white" : locked ? "bg-slate-100 text-muted" : res.active ? "bg-navy text-white" : res.chancesLeft === 0 ? "bg-slate-100 text-muted" : done ? "bg-white border border-navy text-navy" : "bg-primary text-white"}`}>
                      {preview ? <><Icon name="eye" size={15} />{t("journey.preview")}</> : locked ? t("journey.lockedHint", { n: q }) : res.active ? <><Icon name="play" size={14} fill />{t("journey.resume")}</> : res.chancesLeft === 0 ? t("journey.noChances") : done ? <><Icon name="replay" size={15} />{t("journey.replay")}</> : <><Icon name="play" size={14} fill />{t("journey.play")}</>}
                    </div>
                  </motion.button>
                );
              })}
            </div>
          </div>
          {/* stats */}
          <motion.aside initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.4 }} className="card p-5 grid gap-6 md:grid-cols-3 min-[1800px]:grid-cols-1 min-[1800px]:gap-5 items-start">
            <div className="space-y-4">
            <h2 className="kicker">{t("journey.stats")}</h2>
            <div>
              <div className="flex items-end justify-between mb-1.5"><span className="font-semibold text-muted">{t("journey.creditsMeter")}</span>
                <span className="text-3xl font-extrabold text-gold-deep tabular-nums">{s.totalCredits}<span className="text-base text-muted">/50</span></span></div>
              <ProgressBar value={s.totalCredits / 50} tone="gold" checkpoints={5} label={t("journey.creditsMeter")} />
            </div>
            <div className="flex items-center justify-between"><span className="font-semibold text-muted">{t("journey.statsStars")}</span><Stars n={s.stars} total={s.starsTotal} size={24} /></div>
            {s.allPlayed && <p className="text-sm font-semibold text-success">{t("journey.allDone")}</p>}
            </div>
            <div>
              <div className="kicker mb-2">{t("journey.titles")}</div>
              <div className="grid grid-cols-2 gap-3" data-testid="title-collection">
                {/* Varchaspati crown card across the top, then Visheshagya, Vidvaan, Nipun, Pathik */}
                {cfg.rounds.filter((r) => r.playable === false).map((r) => (
                  <div key={r.key} className="col-span-2 rounded-ui border border-dashed border-purple-300 bg-purple-50 p-2 flex items-center justify-center gap-3" data-testid={`title-card-${r.key}`}>
                    <Medal k={r.key} size={44} phase2 />
                    <div className="text-left"><div className="text-xs font-bold">{r.titleEn}</div><div className="text-[11px] text-purple-700 font-semibold">{t("journey.titleComingPhase2")}</div></div>
                  </div>
                ))}
                {cfg.rounds.map((r, i) => ({ r, res: s.rounds[i] })).filter(({ r }) => r.playable !== false).reverse().map(({ r, res }) => (
                  <div key={r.key} className={`rounded-ui border p-2 text-center ${res?.titleEarned ? "border-gold-light bg-gold-soft" : "border-slate-200"}`} data-testid={`title-card-${r.key}`}>
                    <div className="flex justify-center"><Medal k={r.key} size={44} locked={!res?.titleEarned} /></div>
                    <div className="text-xs font-bold mt-1">{r.titleEn}</div>
                    <div className="text-[11px] text-muted">{res?.titleEarned ? r.titleMeaning : t("journey.titleLocked")}</div>
                  </div>
                ))}
              </div>
            </div>
            <Leaderboard />
          </motion.aside>
        </div>
      </Page>
    </>
  );
}

interface Board { top: { rank: number; name: string; office: string; credits: number; stars: number; titles: number; me: boolean }[]; me: { rank: number; credits: number; of: number } | null }

/** Leaderboard: top 10 by credits, with the player's own rank. */
function Leaderboard() {
  const { data } = useQuery({ queryKey: ["leaderboard"], queryFn: () => api<Board>("/leaderboard"), staleTime: 30_000 });
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="kicker">{t("journey.leaderboard")}</span>
        {data?.me && <span className="text-xs font-bold text-navy-600">{t("journey.yourRank", { rank: data.me.rank, of: data.me.of })}</span>}
      </div>
      {!data?.top.length ? <p className="text-sm text-muted">{t("journey.leaderEmpty")}</p> : (
        <ol className="space-y-1">
          {data.top.map((r) => (
            <li key={r.rank} className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-sm ${r.me ? "bg-navy-50 ring-1 ring-navy/20 font-bold" : ""}`}>
              <RankBadge rank={r.rank} />
              <span className="flex-1 min-w-0"><span className="block truncate">{r.name}</span><span className="block text-[11px] text-muted truncate">{r.office}</span></span>
              <span className="font-extrabold tabular-nums text-gold-deep">{r.credits}</span>
            </li>
          ))}
        </ol>
      )}
      <Link to="/leaderboard" className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-navy-600 hover:underline">{t("journey.fullBoard")} <Icon name="chevronRight" size={14} /></Link>
    </div>
  );
}

/** Rank badge: gold / silver / bronze plates for the podium, plain number below. */
export function RankBadge({ rank, size = 24 }: { rank: number; size?: number }) {
  const podium = ["bg-gradient-to-b from-gold-light to-gold text-navy-900", "bg-gradient-to-b from-slate-100 to-slate-300 text-navy", "bg-gradient-to-b from-orange-200 to-[#B87333] text-white"];
  return (
    <span className={`inline-grid place-items-center rounded-md font-extrabold tnum shrink-0 ${rank <= 3 ? podium[rank - 1] : "text-muted"}`} style={{ width: size, height: size, fontSize: size * 0.5 }}>{rank}</span>
  );
}
