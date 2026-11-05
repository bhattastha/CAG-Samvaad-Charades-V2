import { readFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "./env.js";

export interface Db {
  query<T = any>(sql: string, params?: unknown[]): Promise<T[]>;
  one<T = any>(sql: string, params?: unknown[]): Promise<T | null>;
  tx<T>(fn: (q: Db) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

type Raw = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> };

function wrap(raw: Raw, txImpl: Db["tx"], close: () => Promise<void>): Db {
  const db: Db = {
    query: async (sql, params) => (await raw.query(sql, params)).rows,
    one: async (sql, params) => (await raw.query(sql, params)).rows[0] ?? null,
    tx: txImpl,
    close,
  };
  return db;
}

/**
 * Postgres via `pg` when DATABASE_URL is a postgres:// URL; otherwise PGlite (embedded
 * Postgres, files under .data/) so the game runs locally with no database install.
 */
export async function openDb(url = env.DATABASE_URL): Promise<Db> {
  if (url.startsWith("postgres")) {
    const { default: pg } = await import("pg");
    // remote managed Postgres: keep warm connections so each request does not pay the TLS handshake
    const pool = new pg.Pool({ connectionString: url, max: 20, keepAlive: true, idleTimeoutMillis: 60_000, connectionTimeoutMillis: 15_000 });
    pool.on("error", () => {}); // an idle client dropped by the server must not crash the process
    const tx: Db["tx"] = async (fn) => {
      const c = await pool.connect();
      try {
        await c.query("BEGIN");
        const r = await fn(wrap(c, () => { throw new Error("nested tx"); }, async () => {}));
        await c.query("COMMIT");
        return r;
      } catch (e) {
        await c.query("ROLLBACK");
        throw e;
      } finally {
        c.release();
      }
    };
    return wrap(pool, tx, () => pool.end());
  }
  const { PGlite } = await import("@electric-sql/pglite");
  const dir = url.replace(/^pglite:/, "");
  let pgl;
  if (dir === "memory") pgl = new PGlite();
  else {
    mkdirSync(dirname(resolve(dir)), { recursive: true });
    pgl = new PGlite(resolve(dir));
  }
  await pgl.waitReady;
  // PGlite is single-connection: serialise transactions so they never interleave.
  let chain: Promise<unknown> = Promise.resolve();
  const tx: Db["tx"] = (fn) => {
    const run = chain.then(() => pgl.transaction((t) => fn(wrap(t as Raw, () => { throw new Error("nested tx"); }, async () => {}))));
    chain = run.catch(() => {});
    return run as any;
  };
  return wrap(pgl as unknown as Raw, tx, () => pgl.close());
}

export async function migrate(db: Db) {
  const sql = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "schema.sql"), "utf8");
  const stmts = sql
    .split("\n").filter((l) => !l.trim().startsWith("--")).join("\n")
    .split(/;\s*(?:\n|$)/).map((s) => s.trim()).filter(Boolean);
  for (const stmt of stmts) await db.query(stmt);
}
