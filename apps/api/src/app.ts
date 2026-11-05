import compress from "@fastify/compress";
import { existsSync } from "node:fs";
import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import websocket from "@fastify/websocket";
import { readSession, renewSession } from "./auth.js";
import { loadLines, loadOverrides } from "./content.js";
import type { Db } from "./db.js";
import { env } from "./env.js";
import { autoSubmitDue, GameError } from "./game.js";
import { loadGlossary } from "./pages.js";
import { adminRoutes } from "./routes/admin.js";
import { playRoutes } from "./routes/play.js";
import { playerRoutes } from "./routes/player.js";
import { resultRoutes } from "./routes/results.js";
import { serviceRoutes } from "./routes/services.js";
import { BadRequest } from "./routes/util.js";
import { setSectorLookup } from "./sahayika/engine.js";

export async function buildApp(db: Db, opts: { logger?: boolean; jobs?: boolean } = {}): Promise<FastifyInstance> {
  await loadOverrides(db);
  await loadLines(db);
  await loadGlossary(db);
  const sectors = new Map((await db.query<{ id: string; sector: string }>("SELECT id, sector FROM pages")).map((r) => [r.id, r.sector]));
  setSectorLookup((id) => sectors.get(id) ?? "");

  const app = Fastify({ logger: opts.logger ?? false, bodyLimit: 6 * 1024 * 1024, trustProxy: true });
  await app.register(cookie);
  await app.register(multipart, { limits: { fileSize: 60 * 1024 * 1024 } });
  // report bundles are large Hindi JSON (Pro ≈ 1 MB raw): gzip/brotli keeps rounds light on office links (§15.11)
  await app.register(compress, { global: true, threshold: 1024 });
  await app.register(websocket);
  // sendBeacon posts text/plain
  app.addContentTypeParser("text/plain", { parseAs: "string" }, (_req, body, done) => done(null, body));

  app.decorateRequest("session", null);
  app.addHook("onRequest", async (req, reply) => {
    req.session = await readSession(req);
    // a player deleted from the console (reset / danger zone) is signed out, not left half-registered
    if (req.session?.pid && !(await db.one("SELECT 1 FROM players WHERE id=$1", [req.session.pid]))) req.session = { ...req.session, pid: undefined };
    if (req.session && req.url !== "/api/auth/logout") await renewSession(reply, req.session);
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Referrer-Policy", "same-origin");
    reply.header("Permissions-Policy", "microphone=(self), camera=()");
    reply.header("Content-Security-Policy", "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; connect-src 'self' ws: wss:; frame-ancestors 'none'");
    if (env.COOKIE_SECURE) reply.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  });

  app.setErrorHandler((err: any, _req, reply) => {
    if (err instanceof BadRequest) return reply.code(400).send({ error: "bad_request", issues: err.issues });
    if (err instanceof GameError) return reply.code(err.status).send({ error: err.code });
    if (err.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ error: err.code ?? err.message });
    app.log.error(err);
    return reply.code(500).send({ error: "server_error" });
  });

  await app.register(async (api) => {
    await playerRoutes(api, db);
    await playRoutes(api, db);
    await serviceRoutes(api, db);
    await resultRoutes(api, db);
    await adminRoutes(api, db);
    // liveness for uptime monitors: no DB, no auth, nothing sensitive; `ok` kept for existing callers
    const noStore = { "cache-control": "no-store" };
    api.get("/health", async (_req, reply) => {
      reply.headers(noStore);
      return { ok: true, status: "healthy", message: "Samvaad Charades backend is running", timestamp: new Date().toISOString(), uptime: Math.round(process.uptime()) };
    });
    // readiness: one read-only round trip to the database, capped at 3 s
    api.get("/health/db", async (_req, reply) => {
      reply.headers(noStore);
      const t0 = Date.now();
      try {
        await Promise.race([db.query("SELECT 1"), new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 3000))]);
        return { ok: true, status: "healthy", database: "connected", latencyMs: Date.now() - t0, timestamp: new Date().toISOString() };
      } catch {
        return reply.code(503).send({ ok: false, status: "unhealthy", database: "unreachable", timestamp: new Date().toISOString() });
      }
    });
  }, { prefix: "/api" });

  // Production: serve the built web app (player + /manager) from the same origin.
  if (existsSync(env.WEB_DIST)) {
    const { default: statics } = await import("@fastify/static");
    await app.register(statics, { root: env.WEB_DIST, wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith("/api")) return reply.code(404).send({ error: "not_found" });
      return reply.sendFile("index.html");
    });
  }

  if (opts.jobs !== false) {
    const t = setInterval(() => autoSubmitDue(db).catch((e) => app.log.error(e)), 30_000);
    app.addHook("onClose", async () => clearInterval(t));
  }
  return app;
}
