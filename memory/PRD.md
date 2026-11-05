# Samvaad Charades — hosting task (25 Oct 2026)
Task: host existing pnpm monorepo (Fastify 5 API + React/Vite web, PostgreSQL) without rebuilding. Demo 27 Oct 2026.
User choices: Emergent managed email for OTP; publish seeded Report 38 sample pages (pending: publish gate needs verification); ADMIN_EMAILS=game_admin@cag.gov.in; BHASHINI key not rotated (use current); glossary CSV must drive workbench menus (already in seed/glossary.json, all 11,686 records present).
## Done
- Install, web build, tests: shared 21/21; api 27/27 (needed --hookTimeout=120000 in this pod; default 10s hook times out).
- Preview hosting: /app/frontend/package.json start -> scripts/emergent/start.sh (local PostgreSQL 15, data /app/.data/postgres; API NODE_ENV=production on :3000 serving web+/api). /app/backend/server.py = pass-through proxy for /api (HTTP+WS) to :3000.
- OTP sender: Emergent managed email added in apps/api/src/auth.ts + env.ts (EMERGENT_EMAIL_KEY, EMAIL_FROM_NAME); SMTP path unchanged.
## Blockers / pending decisions
- Emergent native production deploy supports Python/Next.js backends + MongoDB only; no Postgres, ephemeral disk.
- Publishing requires every part verified; no manager inbox access for agent.
- DHRUVA_API_KEY / DHRUVA_TTS_SERVICE_ID not yet entered in secrets.
## 25 Oct 2026 — iteration 2
- ADMIN_EMAILS -> bhattastha.dibd@gmail.com; old game_admin@cag.gov.in admin row removed.
- Published all 5 seeded Report 38 pages (Trial x2, Primary 10pp, Secondary 20pp, Pro 30pp) at owner request: parts marked verified, audit_logs entries "hosting-agent (owner request)" note references NOT manager-verified. 6 fields (pro 4, secondary 2) have no BHASHINI draft.
- Fixed profile dropdown hidden under body: index.css `.ob-bg/.rules-room > :not(header)`; nav no-wrap.
- Glossary: all 11,686 CSV records already in seed/glossary.json (11,389 terms in DB); inline menus verified.
- Office -> address autofill verified.
- BLOCKER: Emergent email proxy now rejects @cag.gov.in (422 undeliverable_recipient). Needs CAG/NIC SMTP_URL.
- Ops: after rebuilding web dist, restart `frontend` supervisor (static routes registered at boot).
## 25 Oct 2026 — iteration 3 (BHASHINI Dhruva + glossary)
- Dhruva for translation (drafts), transliteration, TTS, LLM, ASR. Console page /manager/services edits service IDs/models (config_overrides key "services", audited, Test buttons). Key DHRUVA_API_KEY in secrets — Key re-entered 25 Oct; all 4 service tests pass. 99/100 Sahayak lines regenerated with Dhruva male voice.
- Official glossary = seed/glossary.anuvaad.csv (11,686 rows → 11,389 terms; blank/"-" Target term 1 promotes first other term). All "Other target terms" accepted, no auto-avoid. Console import accepts Anuvaad columns; merge (default) or replace (guarded). Page term snapshots now follow the live glossary (menus + scoring).
- Workbench glossary menu: last option = BHASHINI transliteration of the English term (only shown on a real suggestion).
- Tests: shared 21/21, api 27/27 (hookTimeout 200 s), testing agent iteration_3 100%.
## Backlog
- P0: re-enter correct Dhruva key; CAG/NIC SMTP for @cag.gov.in OTP; production hosting decision (Emergent native can't run Fastify+Postgres).
- P1: "Review build" tag on sample pages; office search ranking; console glossary delete-term action.
- Deferred by user: Claude integration.
- Console glossary page lists ALL terms A→Z with paging (100/200/500 per page), search across English/Hindi/accepted forms (25 Oct).
## 25 Oct 2026 — Emergent publish packaging
- scripts/emergent/package.sh (run before every publish): bundles API → backend/hc/api.mjs (+config/content/seed/assets, vendored pglite & pdfjs), web → frontend/site. frontend `yarn build` copies site→build. backend/server.py spawns bundle with pip Node (nodejs-wheel-binaries) when monorepo absent; watchdog restarts; PGlite fallback if DATABASE_URL unreachable (NON-PERSISTENT); SEED_PUBLISH_SAMPLES publishes 5 samples on fresh DB.
- Certificate PDF/PNG falls back to HTML when playwright-core absent. Glossary override:null fix.
- P0: external PostgreSQL DATABASE_URL (live slot) for persistence in production.
## 26 Oct 2026 — load + cross-browser readiness
- Load test (preview): 10/20/25 concurrent players, 0 app errors, p95 well under 1 s for game calls; BHASHINI stable. Test players qa.load01-25, qa.xb01-15, qa.xc01-07 @gmail.com left in DB.
- Fixes: Esc keyboard lock in fullscreen (Chrome/Edge); Firefox/Safari full-screen exits not counted (tab/blur still are); GlossMenu outside-click listener stable; header nav at lg, name chip at xl; register card fits 360px; landing Sign in on mobile; TTS 30 uncached/user/10 min; xlit timeouts don't trip breaker; /health alias in shim.
- Production deploy: build passes now; pod OOM at tier_0 512Mi because embedded PGlite (peak ~770 MB). With external Postgres the API measured ~100 MB steady / ~190 MB peak. Needs external DATABASE_URL (live) and/or higher tier.
## 26 Oct 2026 — external PostgreSQL (Neon)
- DATABASE_URL (live + test) = Neon pooler (ap-southeast-1). Preview DB copied into Neon (pg_dump→psql). ALTER ROLE/DATABASE search_path=public set (pg_dump had polluted pooled search_path).
- Preview now also uses Neon (shared with live). ~210 ms per DB round trip from this pod; bundle RSS ~140 MB.
- test-otp.sh now targets DATABASE_URL.
## 5 Nov 2026 — CHANGE REQUEST v1.0 (phased; wait for "continue" after each)
- Phase 1 DONE (preview, iteration_9 100%): useProgress no longer treats errors as signed-out (retry + auto-refetch); Player guard shows "Connection problem. You are still signed in."; sliding session (SESSION_HOURS default 12, min 3) renewed at half-life. NOT yet deployed live.
- Phase 1.4 (remove Mark as done) ON HOLD: conflicts with Phase 4.3 + final check (Primary/Secondary keep Mark as done). Autosave already every 10 s.
- Pending phases 2–8: CAG email domain + BHASHINI email relay (needs EMAIL_RELAY_URL/KEY, OTP_ALLOWLIST, reply-to), Trial 200 words, report structure (footnotes/tables/charts), Professional scrolling mode, Sahayika female mascot + voice, script load from docx/review PDF (PDF + note image not received), metal badges.
- Open question from user: Trial "speak" (voice typing, websocket /api/speech/asr/stream → Dhruva socket.io) not working — not yet diagnosed.
## 5 Nov 2026 — CR v1.0 phases 2–8 + scoring v2 + 3D badges (preview only, not published)
- Phase 2: sign-in limited to @cag.gov.in + OTP_ALLOWLIST (bhattastha1520@gmail.com, asthabhatt152000@gmail.com) + ADMIN_EMAILS; OTP sent via BHASHINI relay (EMAIL_RELAY_URL in backend/.env, EMAIL_RELAY_API_KEY secret, Bearer, body {to:[],subject,body,body_type:"html"}). Verified 200 for @cag.gov.in.
- Phase 3: Trial passages trimmed to ~200 words (seed + Neon, glossary terms pruned to those present). Speak: Dhruva Hindi ASR returns DHRUVA-101 upstream for all models; client falls back to browser hi-IN after 8 s of silence.
- Mark as done removed everywhere; a segment counts as reviewed on focus or real edit (unchanged values no longer trigger autosave).
- Phase 4/5: figures shown on both sides; Pro = continuous scroll (config rounds[].scrollMode), lazy editor mount, progress bar.
- Phase 6/7: Sahayika (female) mascot assets + female TTS (ttsGender female, config + DB override); docx script imported via scripts/import-sahayika-docx.py (reference/sahayika/); triggers wired (landing hovers/idle, registration fields, briefing modal W-01..W-11, training lines, pre-round, in-round, chat open/close, report card + buttons); header mute toggle.
- Scoring v2 (new attempts only): Translation Quality 55 (0.6 chrF + 0.4 stem-overlap similarity vs CAG Hindi over full text, × (0.9+0.1·fluency), grammar issues also present in the reference not penalised; draft rounds score gain over draft, unchanged draft = 0) + Glossary 25 + Timeliness&Completion 20 (completion × time factor 1→0 from 50%→100% time; draft rounds only if gain ≥ 10%). Score 1 decimal (attempts.score double precision). Credits = cap × best/100 (1 decimal, total 50).
- 3D metal badges (components/Badge3D.tsx, exported as Medal): I Bronze, II Silver, III Gold, IV Platinum, V Royal; won/locked/phase2 states, hover tilt, shine sweep, reduced-motion respected. Title Collection: Varchaspati full-width first ("Coming in Phase 2"), then IV→I.
- Tests: shared 26/26, api 27/27; testing agent iterations 10–12 (all items verified, follow-ups fixed).
## Backlog
- P0: user review then publish (also run scripts/emergent/package.sh); re-generate failed Sahayika audio lines (some TTS timeouts; live TTS covers them).
- P1: manager console updates (user will specify); BHASHINI ASR recovery check; optional AI meaning-similarity scorer.
- Note: preview and live share the Neon DB (Trial passage change is already live).
## 5 Nov 2026 — iteration 13 (workbench scroll, Sahayika hints, score tips, certificate badge, console)
- Primary/Secondary/Pro all continuous scroll (config scrollMode). In-round Sahayika glossary hint on opening a part (one per part, 40 s apart, remembered per attempt).
- Report card: no glossary hints; tip = motivate_high (≥75) / motivate_mid (won this attempt) / motivate_held (lower re-attempt, title kept) / motivate_low; after = weakest-stat tip, grammar tip, go_next or improve_retry.
- Score Breakdown Tips: weakSpots (top 3 sentences/parts by lost Translation Quality marks; draft rounds by missing gain) on report card + Review (amber highlight).
- Certificate shows highest won 3D badge (certificate/badge.ts). Console: highest badge in Players list, badges on level cards, Q/G/TC measures, funnel % of first step.
- Tests: shared 26/26, api 27/27, testing agent iteration_13 (follow-ups fixed).
## 5 Nov 2026 — load test + publish
- scripts/loadtest.mjs (plant codes with test-otp.sh for qa.ltNN@cag.gov.in, code 246810): 15 concurrent players full Trial flow → 15/15 ok, 0 errors; p50 0.9–3.2 s, dominated by ~200 ms round-trips to Neon in ap-southeast-1 (Singapore). pg pool raised to 20 with keepAlive (≈30–50% faster).
- package.sh run; redeploy queued (job 2bb627e8).
- Recommendation: move Neon to the same region as the hosting cluster to cut latency ~5x.
## 5 Nov 2026 — database moved to Neon us-west-2 (Oregon)
- scripts/copy-db.sh (OLD=… NEW=…): FK-ordered TRUNCATE + \copy of all public tables + sequence reset; all 16 tables row counts matched. DATABASE_URL (test+live) now = Oregon; NEW_DATABASE_URL holds the same. Old Singapore DB kept untouched as backup (URL saved in /root/.old_db_url, mode 600).
- Load test 15 concurrent: 15/15 ok, p50 0.2–0.7 s (was 0.9–3.2 s); DB health latency 43 ms. Redeploy queued for live.
