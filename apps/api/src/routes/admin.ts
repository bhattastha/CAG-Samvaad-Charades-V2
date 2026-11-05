import { existsSync, mkdirSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { parseGameConfig, RoundKey, seedToPage, summarise, type PageData, type SeedPage } from "@hc/shared";
import { z } from "zod";
import { requireAdmin } from "../auth.js";
import { health, isConfigured, llm, translateBatch, tts } from "../bhashini/client.js";
import { transliterate } from "../bhashini/xlit.js";
import { allLines, applySettings, baseConfig, config, loadLines, loadOverrides, servicesOf } from "../content.js";
import type { Db } from "../db.js";
import { ROOT } from "../env.js";
import { loadGlossary, loadPage, savePage } from "../pages.js";
import { segmentPdfPage } from "../ingest.js";
import { parse } from "./util.js";
import { activity, overview } from "../admin/analytics.js";
import { listPlayers, playerDetail, resetAllPlayData, resetPlayer } from "../admin/players.js";

export const RESET_ALL_PHRASE = "RESET ALL TEST DATA";

const audit = (db: Db, actor: string, action: string, target: string, meta?: unknown) =>
  db.query("INSERT INTO audit_logs (actor, action, target, meta) VALUES ($1,$2,$3,$4)", [actor, action, target, meta ? JSON.stringify(meta) : null]);

const PartSchema = z.object({
  id: z.string(), order: z.number(), type: z.string(), tickGroup: z.string().nullable(), editable: z.boolean(),
  layout: z.any(), enSentences: z.array(z.string()).optional(), pageNo: z.number().int().positive().optional(),
  fields: z.array(z.object({ key: z.string(), en: z.string(), hiReference: z.string(), draft: z.string().nullable(), locked: z.array(z.string()), numeric: z.boolean() })),
});
const PageSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/), roundKey: RoundKey, label: z.string().min(1),
  printedPageNo: z.string().nullable(), parts: z.array(PartSchema),
  terms: z.array(z.object({ en: z.string(), hi: z.string(), variants: z.array(z.string()), avoid: z.array(z.string()) })),
  slips: z.array(z.object({ partId: z.string(), kind: z.enum(["term", "transliteration", "grammar", "omission"]), wrongText: z.string(), enTerm: z.string().nullable(), fixHint: z.string() })),
});

export async function adminRoutes(app: FastifyInstance, db: Db) {
  const viewer = (req: FastifyRequest, reply: FastifyReply) => requireAdmin(req, reply, "viewer");
  const manager = (req: FastifyRequest, reply: FastifyReply) => requireAdmin(req, reply, "manager");

  app.get("/admin/me", async (req, reply) => {
    if (!viewer(req, reply)) return;
    return { email: req.session!.email, role: req.session!.role };
  });

  // ---------- dashboard ----------
  app.get("/admin/dashboard", async (req, reply) => {
    if (!viewer(req, reply)) return;
    const pages = await db.query<{ round_key: string; status: string; n: number }>("SELECT round_key, status, count(*)::int AS n FROM pages WHERE active GROUP BY 1,2");
    const players = await db.one<{ n: number }>("SELECT count(*)::int AS n FROM players");
    const today = await db.one<{ n: number }>("SELECT count(*)::int AS n FROM attempts WHERE started_at >= current_date");
    const best = await db.query<{ round_key: string; avg: number; n: number }>(
      "SELECT round_key, round(avg(best)::numeric,1)::float AS avg, count(*)::int AS n FROM (SELECT player_id, round_key, max(score) AS best FROM attempts WHERE status='submitted' GROUP BY 1,2) t GROUP BY 1");
    return {
      rounds: config().rounds.map((r) => ({
        key: r.key, name: r.name,
        published: pages.find((p) => p.round_key === r.key && p.status === "published")?.n ?? 0,
        drafts: pages.find((p) => p.round_key === r.key && p.status === "draft")?.n ?? 0,
        avgBest: best.find((b) => b.round_key === r.key)?.avg ?? null,
        playersPlayed: best.find((b) => b.round_key === r.key)?.n ?? 0,
      })),
      players: players?.n ?? 0,
      attemptsToday: today?.n ?? 0,
      services: health(),
    };
  });

  // ---------- pages ----------
  app.get("/admin/pages", async (req, reply) => {
    if (!viewer(req, reply)) return;
    return db.query(`SELECT p.id, p.round_key, p.label, p.printed_page_no, p.status, p.sample, p.version, p.active, p.scope,
      (SELECT count(DISTINCT x.page_no)::int FROM page_parts x WHERE x.page_id=p.id) AS report_pages,
      (SELECT count(*)::int FROM page_parts x WHERE x.page_id=p.id AND x.editable) AS parts,
      (SELECT count(*)::int FROM page_parts x WHERE x.page_id=p.id AND x.editable AND x.reference_verified) AS verified,
      (SELECT count(*)::int FROM attempts a WHERE a.page_id=p.id) AS times_used
      FROM pages p ORDER BY CASE p.round_key WHEN 'trial' THEN 1 WHEN 'primary' THEN 2 WHEN 'secondary' THEN 3 ELSE 4 END, p.id`);
  });

  app.get("/admin/pages/:id", async (req, reply) => {
    if (!viewer(req, reply)) return;
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const p = await loadPage(db, id);
    if (!p) return reply.code(404).send({ error: "not_found" });
    const row = await db.one("SELECT status, sample, source, sector, scope FROM pages WHERE id=$1", [id]);
    const verified = await db.query<{ id: string; reference_verified: boolean }>("SELECT id, reference_verified FROM page_parts WHERE page_id=$1", [id]);
    return { ...p.page, ...row, verified: Object.fromEntries(verified.map((v) => [v.id, v.reference_verified])), extras: p.extras };
  });

  /** Create from a seed-format JSON (the format in seed/pages/*.json) or a PageData body. */
  app.post("/admin/pages", async (req, reply) => {
    const who = manager(req, reply);
    if (!who) return;
    const body = req.body as any;
    let page: PageData, sector = String(body?.sector ?? "");
    if (body?.page_id) ({ page, sector } = seedToPage(body as SeedPage));
    else page = parse(PageSchema, body) as PageData;
    if (await db.one("SELECT 1 FROM pages WHERE id=$1", [page.id])) return reply.code(409).send({ error: "exists" });
    const scope = typeof body?.scope === "string" && body.scope.trim() ? String(body.scope).trim().slice(0, 60) : undefined;
    await savePage(db, page, { sector, source: body?.source ?? {}, status: "draft", scope });
    await audit(db, who, "page.create", page.id);
    return { id: page.id };
  });

  app.put("/admin/pages/:id", async (req, reply) => {
    const who = manager(req, reply);
    if (!who) return;
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const body = parse(PageSchema.extend({ sector: z.string().optional(), scope: z.string().max(60).optional() }), req.body);
    if (body.id !== id) return reply.code(400).send({ error: "id_mismatch" });
    const row = await db.one<{ status: string; sector: string; source: any; sample: boolean }>("SELECT status, sector, source, sample FROM pages WHERE id=$1", [id]);
    if (!row) return reply.code(404).send({ error: "not_found" });
    await savePage(db, body as PageData, { sector: body.sector ?? row.sector, source: row.source, sample: row.sample, scope: body.scope });
    await audit(db, who, "page.update", id);
    return { ok: true };
  });

  app.put("/admin/pages/:id/parts/:partId/verify", async (req, reply) => {
    const who = manager(req, reply);
    if (!who) return;
    const { id, partId } = parse(z.object({ id: z.string(), partId: z.string() }), req.params);
    const { verified } = parse(z.object({ verified: z.boolean() }), req.body);
    await db.query("UPDATE page_parts SET reference_verified=$3 WHERE page_id=$1 AND id=$2", [id, partId, verified]);
    await audit(db, who, verified ? "part.verify" : "part.unverify", `${id}/${partId}`);
    return { ok: true };
  });

  app.put("/admin/pages/:id/slips", async (req, reply) => {
    const who = manager(req, reply);
    if (!who) return;
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const { slips } = parse(z.object({ slips: PageSchema.shape.slips }), req.body);
    const p = await loadPage(db, id);
    if (!p) return reply.code(404).send({ error: "not_found" });
    const row = await db.one<{ sector: string; source: any; sample: boolean }>("SELECT sector, source, sample FROM pages WHERE id=$1", [id]);
    await savePage(db, { ...p.page, slips }, { sector: row!.sector, source: row!.source, sample: row!.sample });
    await audit(db, who, "page.slips", id, { n: slips.length });
    return { ok: true };
  });

  /** BHASHINI draft for every editable non-numeric field (numbers masked before sending, restored after). */
  app.post("/admin/pages/:id/draft", async (req, reply) => {
    const who = manager(req, reply);
    if (!who) return;
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const { overwrite } = parse(z.object({ overwrite: z.boolean().default(false) }), req.body);
    const p = await loadPage(db, id);
    if (!p) return reply.code(404).send({ error: "not_found" });
    if (!isConfigured("translation")) return reply.code(503).send({ error: "nmt_not_configured" });
    const page = structuredClone(p.page);
    const targets = page.parts.flatMap((part) => part.editable ? part.fields.filter((f) => !f.numeric && f.en && (overwrite || !f.draft)).map((f) => ({ part, f })) : []);
    const out = await translateBatch(targets.map(({ f }) => ({ text: f.en, locked: f.locked })));
    const lost: string[] = [];
    targets.forEach(({ part, f }, i) => { f.draft = out[i].text; if (out[i].lost) lost.push(`${part.id}.${f.key}`); });
    const row = await db.one<{ sector: string; source: any; sample: boolean }>("SELECT sector, source, sample FROM pages WHERE id=$1", [id]);
    await savePage(db, page, { sector: row!.sector, source: row!.source, sample: row!.sample });
    await audit(db, who, "page.draft", id, { fields: targets.length, lost });
    return { ok: true, translated: targets.length, needsManualFix: lost };
  });

  app.post("/admin/pages/:id/publish", async (req, reply) => {
    const who = manager(req, reply);
    if (!who) return;
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const open = await db.query<{ id: string }>("SELECT id FROM page_parts WHERE page_id=$1 AND editable AND NOT reference_verified", [id]);
    if (open.length) return reply.code(409).send({ error: "unverified_parts", parts: open.map((o) => o.id) });
    const p = await loadPage(db, id);
    const missingDraft = p!.page.roundKey !== "trial" && p!.page.parts.some((x) => x.editable && x.fields.some((f) => !f.numeric && !f.draft));
    if (missingDraft) return reply.code(409).send({ error: "missing_draft" });
    await db.query("UPDATE pages SET status='published', version=version+1 WHERE id=$1", [id]);
    await audit(db, who, "page.publish", id);
    return { ok: true };
  });

  app.post("/admin/pages/:id/retire", async (req, reply) => {
    const who = manager(req, reply);
    if (!who) return;
    const { id } = parse(z.object({ id: z.string() }), req.params);
    await db.query("UPDATE pages SET status='retired', version=version+1 WHERE id=$1", [id]);
    await audit(db, who, "page.retire", id);
    return { ok: true };
  });

  /** Ingest step b: auto-segment one English PDF page from its text layer into typed parts. */
  app.post("/admin/ingest/segment", async (req, reply) => {
    if (!manager(req, reply)) return;
    const file = await (req as any).file();
    if (!file) return reply.code(400).send({ error: "no_file" });
    const pageNo = Number((file.fields?.page as any)?.value ?? 1);
    const buf = await file.toBuffer();
    return segmentPdfPage(new Uint8Array(buf), pageNo);
  });

  /** Ingest step c: OCR needs tesseract-ocr + hin in the API image (Docker); report clearly when absent. */
  app.post("/admin/pages/:id/ocr", async (req, reply) => {
    if (!manager(req, reply)) return;
    return reply.code(501).send({ error: "ocr_unavailable", message: "Hindi OCR runs in the API Docker image (tesseract-ocr + hin, tessdata_best). Paste the verified Hindi into each part meanwhile." });
  });

  // ---------- glossary ----------
  app.get("/admin/glossary", async (req, reply) => {
    if (!viewer(req, reply)) return;
    const { q, flagged, page, size } = parse(z.object({
      q: z.string().max(80).optional(), flagged: z.string().optional(),
      page: z.coerce.number().int().min(1).optional(), size: z.coerce.number().int().min(10).max(500).default(200),
    }), req.query);
    const s = `%${(q ?? "").toLowerCase()}%`;
    if (page) {
      // paged browse of the whole glossary, A→Z
      const where = `(lower(en) LIKE $1 OR hi LIKE $2 OR EXISTS (SELECT 1 FROM unnest(accepted_variants) v WHERE v LIKE $2))
        AND ($3::boolean = false OR cardinality(flags) > 0 OR override IS NOT NULL)`;
      const args = [s, `%${q ?? ""}%`, flagged === "1"];
      const total = (await db.one<{ n: number }>(`SELECT count(*)::int AS n FROM glossary_terms WHERE ${where}`, args))?.n ?? 0;
      const items = await db.query(
        `SELECT id, en, hi, accepted_variants, avoid_forms, flags, override, sector FROM glossary_terms WHERE ${where}
         ORDER BY lower(en), en_norm LIMIT ${size ?? 200} OFFSET ${(page - 1) * (size ?? 200)}`, args);
      return { items, total, page, size: size ?? 200 };
    }
    return db.query(
      `SELECT id, en, hi, accepted_variants, avoid_forms, flags, override FROM glossary_terms
       WHERE (lower(en) LIKE $1 OR hi LIKE $2) AND ($3::boolean = false OR cardinality(flags) > 0 OR override IS NOT NULL)
       ORDER BY (override IS NOT NULL) DESC, length(en) LIMIT 100`,
      [s, `%${q ?? ""}%`, flagged === "1"],
    );
  });

  app.put("/admin/glossary/:id", async (req, reply) => {
    const who = manager(req, reply);
    if (!who) return;
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const body = parse(z.object({
      hi: z.string().min(1), variants: z.array(z.string()), avoid: z.array(z.string()), flags: z.array(z.string()).optional(),
      override: z.object({ hi: z.string(), variants: z.array(z.string()), avoid: z.array(z.string()), reason: z.string(), status: z.string(), active: z.boolean() }).nullable().optional(),
    }), req.body);
    await db.query("UPDATE glossary_terms SET hi=$2, accepted_variants=$3, avoid_forms=$4, flags=COALESCE($5, flags), override=$6 WHERE id=$1",
      [id, body.hi, body.variants, body.avoid, body.flags ?? null, body.override == null ? null : JSON.stringify(body.override)]);
    await loadGlossary(db);
    await audit(db, who, "glossary.update", id, body);
    return { ok: true };
  });

  app.post("/admin/glossary/import", async (req, reply) => {
    const who = manager(req, reply);
    if (!who) return;
    const { csv, mode } = parse(z.object({ csv: z.string().max(8_000_000), mode: z.enum(["merge", "replace"]).default("merge") }), req.body);
    const { importGlossaryCsv } = await import("../seed.js");
    const r = await importGlossaryCsv(db, csv, mode);
    if (!r.rows) return reply.code(400).send({ error: "no_rows", message: "No usable rows. Expected Anuvaad export columns (Source term, Target term 1, Other target terms) or english_term, hindi_term, accepted_variants." });
    await loadGlossary(db);
    await audit(db, who, "glossary.import", "csv", { ...r, mode });
    return { ok: true, ...r, mode };
  });
  app.get("/admin/glossary/stats", async (req, reply) => {
    if (!viewer(req, reply)) return;
    const r = await db.one<{ n: number; variants: number }>("SELECT count(*)::int AS n, coalesce(sum(cardinality(accepted_variants)),0)::int AS variants FROM glossary_terms");
    const last = await db.one<{ at: string; actor: string; meta: any }>("SELECT at, actor, meta FROM audit_logs WHERE action='glossary.import' ORDER BY at DESC LIMIT 1");
    return { terms: r?.n ?? 0, variants: r?.variants ?? 0, lastImport: last ?? null };
  });

  // ---------- offices ----------
  app.get("/admin/offices", async (req, reply) => {
    if (!viewer(req, reply)) return;
    return db.query("SELECT * FROM offices ORDER BY state, name_en");
  });
  app.put("/admin/offices/:id", async (req, reply) => {
    const who = manager(req, reply);
    if (!who) return;
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const b = parse(z.object({ nameHi: z.string().nullable(), address: z.string().min(3) }), req.body);
    await db.query("UPDATE offices SET name_hi=$2, address=$3 WHERE id=$1", [id, b.nameHi, b.address]);
    await audit(db, who, "office.update", id, b);
    return { ok: true };
  });
  app.post("/admin/offices/translate-names", async (req, reply) => {
    const who = manager(req, reply);
    if (!who) return;
    if (!isConfigured("translation")) return reply.code(503).send({ error: "nmt_not_configured" });
    const rows = await db.query<{ id: string; name_en: string }>("SELECT id, name_en FROM offices WHERE name_hi IS NULL");
    const title = (s: string) => s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
    const out = await translateBatch(rows.map((r) => ({ text: title(r.name_en), locked: [] })));
    for (let i = 0; i < rows.length; i++) if (out[i].text) await db.query("UPDATE offices SET name_hi=$2 WHERE id=$1", [rows[i].id, out[i].text]);
    await audit(db, who, "office.translate_names", "offices", { n: rows.length });
    return { ok: true, translated: rows.length, note: "Review every name before launch." };
  });
  app.post("/admin/offices/import", async (req, reply) => {
    const who = manager(req, reply);
    if (!who) return;
    const { csv } = parse(z.object({ csv: z.string().max(5_000_000) }), req.body);
    const { importOfficesCsv } = await import("../seed.js");
    const n = await importOfficesCsv(db, csv);
    await audit(db, who, "office.import", "csv", { rows: n });
    return { ok: true, rows: n };
  });

  // ---------- Sahayika ----------
  app.get("/admin/sahayika/lines", async (req, reply) => {
    if (!viewer(req, reply)) return;
    return allLines();
  });
  app.put("/admin/sahayika/lines/:id", async (req, reply) => {
    const who = manager(req, reply);
    if (!who) return;
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const b = parse(z.object({ en: z.string().min(1).max(600), hi: z.string().min(1).max(600) }), req.body);
    const l = allLines().find((x) => x.id === id);
    if (!l) return reply.code(404).send({ error: "not_found" });
    await db.query(
      `INSERT INTO sahayika_lines (id, section, part, moment, spoken, en, hi, edited_by, edited_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now())
       ON CONFLICT (id) DO UPDATE SET en=$6, hi=$7, edited_by=$8, edited_at=now()`,
      [id, l.section, l.part, l.moment, l.spoken, b.en, b.hi, who],
    );
    await loadLines(db);
    // the pre-generated voice file still speaks the OLD text: drop it so the new text is voiced (live TTS) until
    // "Regenerate audio" runs again
    const wav = resolve(ROOT, ".data/audio", `${id}.wav`);
    if (existsSync(wav)) unlinkSync(wav);
    await audit(db, who, "sahayika.line", id, b);
    return { ok: true };
  });
  /** Pre-generate audio for every spoken line without placeholders (§10.5). */
  app.post("/admin/sahayika/audio", async (req, reply) => {
    const who = manager(req, reply);
    if (!who) return;
    if (!isConfigured("tts")) return reply.code(503).send({ error: "tts_not_configured" });
    const dir = resolve(ROOT, ".data/audio");
    mkdirSync(dir, { recursive: true });
    let ok = 0, failed = 0;
    const hi = config().bhashiniServices.ttsLanguage === "hi";
    for (const l of allLines().filter((x) => x.spoken && !/\{\w+\}/.test(hi ? x.hi : x.en))) {
      try { writeFileSync(resolve(dir, `${l.id}.wav`), await tts(hi ? l.hi : l.en)); ok++; } catch { failed++; }
    }
    await audit(db, who, "sahayika.audio", "all", { ok, failed });
    return { ok, failed };
  });
  app.get("/admin/chatlog", async (req, reply) => {
    if (!viewer(req, reply)) return;
    return db.query("SELECT c.*, p.email FROM chat_logs c LEFT JOIN players p ON p.id=c.player_id ORDER BY c.blocked DESC, c.at DESC LIMIT 300");
  });

  // ---------- results & export ----------
  const results = async () => {
    const players = await db.query<any>("SELECT p.*, o.name_en AS office_name FROM players p JOIN offices o ON o.id=p.office_id ORDER BY p.registered_at");
    const atts = await db.query<any>("SELECT player_id, round_key, chance_no, status, score FROM attempts");
    return players.map((p) => {
      const s = summarise(config(), atts.filter((a) => a.player_id === p.id).map((a) => ({ roundKey: a.round_key, chanceNo: a.chance_no, status: a.status, score: a.score })), Number(p.registration_credits));
      return { email: p.email, name: p.name, mobile: p.mobile, office: p.office_name, registeredAt: p.registered_at, summary: s };
    });
  };
  app.get("/admin/results", async (req, reply) => {
    if (!viewer(req, reply)) return;
    return results();
  });
  app.get("/admin/exports/credits", async (req, reply) => {
    const who = viewer(req, reply);
    if (!who) return;
    const { default: ExcelJS } = await import("exceljs");
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Credits");
    const rounds = config().rounds;
    ws.columns = [
      { header: "Email", key: "email", width: 30 }, { header: "Name", key: "name", width: 24 }, { header: "Mobile", key: "mobile", width: 14 },
      { header: "Office", key: "office", width: 50 }, { header: "Registration credits", key: "reg", width: 12 },
      ...rounds.flatMap((r) => [{ header: `${r.nameEn} best`, key: `${r.key}_best`, width: 10 }, { header: `${r.nameEn} chances`, key: `${r.key}_ch`, width: 10 }, { header: `${r.nameEn} credits`, key: `${r.key}_cr`, width: 10 }]),
      { header: "Titles", key: "titles", width: 50 }, { header: "Total credits", key: "total", width: 12 },
    ];
    for (const r of await results()) {
      const row: Record<string, unknown> = { email: r.email, name: r.name, mobile: r.mobile, office: r.office, reg: r.summary.registrationCredits, total: r.summary.totalCredits };
      for (const rr of r.summary.rounds) { row[`${rr.key}_best`] = rr.best ?? ""; row[`${rr.key}_ch`] = rr.chancesUsed; row[`${rr.key}_cr`] = rr.credits; }
      row.titles = r.summary.rounds.filter((x) => x.titleEarned).map((x) => x.title).join(", ");
      ws.addRow(row);
    }
    ws.getRow(1).font = { bold: true };
    await audit(db, who, "export.credits", "xlsx");
    const buf = await wb.xlsx.writeBuffer();
    return reply.type("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet").header("Content-Disposition", 'attachment; filename="hindi-charades-credits.xlsx"').send(Buffer.from(buf));
  });

  // ---------- settings ----------
  app.get("/admin/config", async (req, reply) => {
    if (!viewer(req, reply)) return;
    const overrides = await db.query("SELECT * FROM config_overrides");
    return { effective: config(), overrides };
  });
  app.put("/admin/config/credits", async (req, reply) => {
    const who = manager(req, reply);
    if (!who) return;
    const caps = parse(z.record(z.number().nonnegative()), req.body);
    const next = structuredClone(baseConfig);
    next.rounds = next.rounds.map((r) => ({ ...r, creditCap: caps[r.key] ?? r.creditCap }));
    try { parseGameConfig(next); } catch (e: any) { return reply.code(400).send({ error: "invalid", message: e.message }); }
    await db.query("INSERT INTO config_overrides (key, value, by) VALUES ('creditCaps', $1, $2) ON CONFLICT (key) DO UPDATE SET value=$1, by=$2, at=now()", [JSON.stringify(caps), who]);
    await loadOverrides(db);
    await audit(db, who, "config.credits", "creditCaps", caps);
    return { ok: true };
  });
  /** All game settings from the console: time, credits and pages per level, Trial qualifying score, pass mark, weights. */
  app.put("/admin/config/settings", async (req, reply) => {
    const who = manager(req, reply);
    if (!who) return;
    const body = parse(z.object({
      rounds: z.record(z.object({ timeLimitMinutes: z.number().positive().max(6000).optional(), creditCap: z.number().nonnegative().optional(), pages: z.number().int().nonnegative().max(1000).optional() })).optional(),
      trialQualifyingScore: z.number().min(0).max(100).optional(),
      titlePassMark: z.number().min(0).max(100).optional(),
      maxChancesPerRound: z.number().int().min(1).max(10).optional(),
      scoringWeights: z.object({ translationQuality: z.number().min(0), glossary: z.number().min(0), timelinessCompletion: z.number().min(0) }).optional(),
      unlockRule: z.enum(["all-open", "trial-pass-unlocks-all"]).optional(),
      scoring: z.object({ chrfFloor: z.number().min(0).max(1).optional(), chrfCeil: z.number().min(0).max(1).optional(), minWordsPerSentence: z.number().int().min(1).max(20).optional() })
        .refine((x) => x.chrfFloor === undefined || x.chrfCeil === undefined || x.chrfFloor < x.chrfCeil, { message: "chrF floor must be below the ceiling" }).optional(),
      avoidThreshold: z.number().min(0).max(1).optional(),
    }), req.body);
    const caps = await db.query("SELECT key, value FROM config_overrides WHERE key='creditCaps'");
    try { applySettings(baseConfig, [...caps, { key: "settings", value: body }]); } catch (e: any) { return reply.code(400).send({ error: "invalid", message: e.message }); }
    await db.query("INSERT INTO config_overrides (key, value, by) VALUES ('settings', $1, $2) ON CONFLICT (key) DO UPDATE SET value=$1, by=$2, at=now()", [JSON.stringify(body), who]);
    await loadOverrides(db);
    await audit(db, who, "config.settings", "settings", body);
    return { ok: true, effective: config() };
  });

  // ---------- BHASHINI services (service IDs and models, editable) ----------
  const svcId = z.string().trim().min(3).max(160).regex(/^[A-Za-z0-9_./:-]+$/, "Service IDs use letters, digits and - _ . / : only");
  const ServicesBody = z.object({
    translationProvider: z.enum(["anuvaad", "dhruva"]), translation: svcId,
    transliterationProvider: z.enum(["anuvaad", "dhruva"]), transliteration: svcId, transliterationSuggestions: z.number().int().min(1).max(8),
    tts: svcId, ttsGender: z.enum(["female", "male"]), ttsLanguage: z.enum(["en", "hi"]), ttsSamplingRate: z.number().int().min(8000).max(48000),
    asrHindi: svcId, llm: svcId,
  });
  app.get("/admin/config/services", async (req, reply) => {
    if (!viewer(req, reply)) return;
    const row = await db.one<{ by: string; at: string }>("SELECT by, at FROM config_overrides WHERE key='services'");
    return { current: servicesOf(config()), defaults: servicesOf(applySettings(baseConfig, [])), updatedBy: row?.by ?? null, updatedAt: row?.at ?? null, health: health() };
  });
  app.put("/admin/config/services", async (req, reply) => {
    const who = manager(req, reply);
    if (!who) return;
    const body = parse(ServicesBody, req.body);
    const rows = await db.query<{ key: string; value: any }>("SELECT key, value FROM config_overrides WHERE key<>'services'");
    try { applySettings(baseConfig, [...rows, { key: "services", value: body }]); } catch (e: any) { return reply.code(400).send({ error: "invalid", message: e.message }); }
    const before = servicesOf(config());
    await db.query("INSERT INTO config_overrides (key, value, by) VALUES ('services', $1, $2) ON CONFLICT (key) DO UPDATE SET value=$1, by=$2, at=now()", [JSON.stringify(body), who]);
    await loadOverrides(db);
    // a different voice makes the saved Sahayak recordings stale; players fall back to live TTS until regenerated
    const voiceChanged = before.tts !== body.tts || before.ttsGender !== body.ttsGender || before.ttsLanguage !== body.ttsLanguage || before.ttsSamplingRate !== body.ttsSamplingRate;
    const dir = resolve(ROOT, ".data/audio");
    if (voiceChanged && existsSync(dir)) for (const f of readdirSync(dir)) if (f.endsWith(".wav")) unlinkSync(resolve(dir, f));
    await audit(db, who, "config.services", "services", { before, after: body });
    return { ok: true, current: servicesOf(config()), voiceChanged };
  });
  /** Runs one small live call against the saved services so a manager can check an ID before players hit it. */
  app.post("/admin/config/services/test", async (req, reply) => {
    if (!manager(req, reply)) return;
    const { task } = parse(z.object({ task: z.enum(["translation", "transliteration", "tts", "llm"]) }), req.body);
    const t0 = Date.now();
    try {
      let sample = "";
      if (task === "translation") sample = (await translateBatch([{ text: "The audit observed irregularities in procurement.", locked: [] }]))[0]?.text ?? "";
      if (task === "transliteration") { const r = await transliterate("lekha"); if (!r.suggestions.length) throw new Error(r.error ?? "No suggestions returned. Check the service ID."); sample = r.suggestions.join(", "); }
      if (task === "tts") { const b = await tts(config().bhashiniServices.ttsLanguage === "hi" ? "नमस्ते, मैं सहायक हूँ।" : "Hello, I am Sahayak."); sample = `${Math.round(b.length / 1024)} KB of audio`; return { ok: true, ms: Date.now() - t0, sample, audio: b.toString("base64") }; }
      if (task === "llm") sample = await llm("Reply in one short sentence.", "Say hello to a CAG officer.");
      if (!sample) throw new Error("empty response");
      return { ok: true, ms: Date.now() - t0, sample };
    } catch (e: any) {
      const m = String(e?.message ?? e);
      const friendly = /HTTP 401|HTTP 403/.test(m) ? "BHASHINI rejected the key (not authenticated). Re-enter the Dhruva key in the server secrets."
        : /circuit open/.test(m) ? "Paused for 30 s after repeated failures. Try again shortly."
        : /aborted|timeout/i.test(m) ? "No reply from BHASHINI within the time limit. Check the key and service ID, then try again."
        : /HTTP 4\d\d/.test(m) ? `BHASHINI refused the request. Check the service ID. (${m.slice(0, 160)})` : m.slice(0, 300);
      return reply.code(422).send({ ok: false, ms: Date.now() - t0, error: "service_failed", message: friendly });
    }
  });

  app.get("/admin/config/history", async (req, reply) => {
    if (!viewer(req, reply)) return;
    return db.query("SELECT * FROM audit_logs WHERE action LIKE 'config.%' OR action LIKE 'danger.%' ORDER BY at DESC LIMIT 100");
  });

  app.get("/admin/audit", async (req, reply) => {
    if (!viewer(req, reply)) return;
    const { q, action } = parse(z.object({ q: z.string().max(120).optional(), action: z.string().max(60).optional() }), req.query);
    return db.query(
      `SELECT * FROM audit_logs WHERE ($1::text IS NULL OR actor ILIKE $1 OR target ILIKE $1 OR action ILIKE $1) AND ($2::text IS NULL OR action LIKE $2)
       ORDER BY at DESC LIMIT 500`, [q ? `%${q}%` : null, action ? `${action}%` : null]);
  });

  // ---------- analytics (console overview) ----------
  app.get("/admin/analytics/overview", async (req, reply) => {
    if (!viewer(req, reply)) return;
    const { range } = parse(z.object({ range: z.enum(["7d", "30d", "all"]).default("30d") }), req.query);
    return overview(db, range ?? "30d");
  });
  app.get("/admin/activity", async (req, reply) => {
    if (!viewer(req, reply)) return;
    const { limit } = parse(z.object({ limit: z.coerce.number().int().min(1).max(200).default(30) }), req.query);
    return activity(db, limit ?? 30);
  });

  // ---------- players ----------
  app.get("/admin/players", async (req, reply) => {
    if (!viewer(req, reply)) return;
    return listPlayers(db);
  });
  app.get("/admin/players/:id", async (req, reply) => {
    if (!viewer(req, reply)) return;
    const { id } = parse(z.object({ id: z.string().min(1).max(100) }), req.params);
    const d = await playerDetail(db, id);
    return d ?? reply.code(404).send({ error: "not_found" });
  });
  /** Guarded reset: the body must repeat the player's email. Deletes attempts, events and chat; optionally the player. */
  app.post("/admin/players/:id/reset", async (req, reply) => {
    const who = manager(req, reply);
    if (!who) return;
    const { id } = parse(z.object({ id: z.string().min(1).max(100) }), req.params);
    const b = parse(z.object({ confirmEmail: z.string().email(), deletePlayer: z.boolean().default(false), reason: z.string().max(300).optional() }), req.body);
    const p = await db.one<{ email: string }>("SELECT email FROM players WHERE id=$1", [id]);
    if (!p) return reply.code(404).send({ error: "not_found" });
    if (p.email.toLowerCase() !== b.confirmEmail.trim().toLowerCase()) return reply.code(400).send({ error: "confirm_mismatch" });
    const r = await resetPlayer(db, id, !!b.deletePlayer);
    await audit(db, who, b.deletePlayer ? "player.delete" : "player.reset", p.email, { ...r, reason: b.reason ?? null });
    return { ok: true, ...r };
  });
  /** Danger zone: delete every player and all play data; content stays. Typed confirmation required. */
  app.post("/admin/danger/reset-play-data", async (req, reply) => {
    const who = manager(req, reply);
    if (!who) return;
    const b = parse(z.object({ confirm: z.string() }), req.body);
    if (b.confirm !== RESET_ALL_PHRASE) return reply.code(400).send({ error: "confirm_mismatch", expected: RESET_ALL_PHRASE });
    const counts = await resetAllPlayData(db);
    await audit(db, who, "danger.reset_play_data", "all-players", counts);
    return { ok: true, deleted: counts };
  });

  // ---------- content library (reports and the level bundles built from them) ----------
  app.get("/admin/library", async (req, reply) => {
    if (!viewer(req, reply)) return;
    const rows = await db.query<any>(`SELECT p.id, p.round_key, p.label, p.printed_page_no, p.status, p.sample, p.version, p.scope, p.created_at,
      COALESCE(NULLIF(p.source->>'report',''), NULLIF(p.source->>'file',''), 'Unassigned') AS report, p.source->>'file' AS file, p.source->>'hindi_file' AS hindi_file,
      (SELECT count(DISTINCT COALESCE(x.page_no,0))::int FROM page_parts x WHERE x.page_id=p.id) AS report_pages,
      (SELECT count(*)::int FROM page_parts x WHERE x.page_id=p.id AND x.editable) AS parts,
      (SELECT count(*)::int FROM page_parts x WHERE x.page_id=p.id AND x.editable AND x.reference_verified) AS verified,
      (SELECT count(*)::int FROM page_terms t WHERE t.page_id=p.id) AS terms,
      (SELECT count(*)::int FROM planted_slips s WHERE s.page_id=p.id) AS slips,
      (SELECT count(*)::int FROM attempts a WHERE a.page_id=p.id) AS times_used,
      (SELECT round(avg(a.score)::numeric,1)::float FROM attempts a WHERE a.page_id=p.id AND a.score IS NOT NULL) AS avg_score
      FROM pages p ORDER BY p.created_at`);
    const order = config().rounds.map((r) => r.key);
    type Rep = { report: string; scopes: string[]; files: string[]; bundles: any[] };
    const reports = new Map<string, Rep>();
    for (const r of rows) {
      const e: Rep = reports.get(r.report) ?? { report: r.report, scopes: [], files: [], bundles: [] };
      if (!e.scopes.includes(r.scope)) e.scopes.push(r.scope);
      for (const f of [r.file, r.hindi_file]) if (f && !e.files.includes(f)) e.files.push(f);
      e.bundles.push(r);
      reports.set(r.report, e);
    }
    for (const e of reports.values()) e.bundles.sort((a, b) => order.indexOf(a.round_key) - order.indexOf(b.round_key) || a.id.localeCompare(b.id));
    return [...reports.values()];
  });
  /** Light edit of a bundle's catalogue data (label, report name, scope) without resending the page. */
  app.put("/admin/pages/:id/meta", async (req, reply) => {
    const who = manager(req, reply);
    if (!who) return;
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const b = parse(z.object({ label: z.string().min(1).max(200).optional(), report: z.string().max(300).optional(), scope: z.string().min(1).max(60).optional() }), req.body);
    const row = await db.one<{ source: any }>("SELECT source FROM pages WHERE id=$1", [id]);
    if (!row) return reply.code(404).send({ error: "not_found" });
    const source = b.report === undefined ? row.source : { ...(row.source ?? {}), report: b.report };
    await db.query("UPDATE pages SET label=COALESCE($2,label), scope=COALESCE($3,scope), source=$4 WHERE id=$1", [id, b.label ?? null, b.scope ?? null, JSON.stringify(source)]);
    await audit(db, who, "page.meta", id, b);
    return { ok: true };
  });
  /** Map every bundle of one report to Union or a State (office mapping, §22 of DECISIONS). */
  app.put("/admin/reports/scope", async (req, reply) => {
    const who = manager(req, reply);
    if (!who) return;
    const b = parse(z.object({ report: z.string().min(1).max(300), scope: z.string().min(1).max(60) }), req.body);
    const ids = await db.query<{ id: string }>(
      `UPDATE pages SET scope=$2 WHERE COALESCE(NULLIF(source->>'report',''), NULLIF(source->>'file',''), 'Unassigned')=$1 RETURNING id`, [b.report, b.scope]);
    await audit(db, who, "report.scope", b.report, { scope: b.scope, pages: ids.length });
    return { ok: true, pages: ids.length };
  });
}
