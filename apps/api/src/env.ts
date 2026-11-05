import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
// HC_ROOT: where config/, content/ and seed/ live when the API runs as a single bundle (Emergent hosting)
export const ROOT = process.env.HC_ROOT ?? resolve(here, "../../..");

const e = process.env;
export const env = {
  NODE_ENV: e.NODE_ENV ?? "development",
  isDev: ["development", "test"].includes(e.NODE_ENV ?? "development"),
  PORT: Number(e.PORT ?? 8787),
  HOST: e.HOST ?? "127.0.0.1",
  DATABASE_URL: e.DATABASE_URL ?? `pglite:${resolve(ROOT, ".data/pglite")}`,
  JWT_SECRET: e.JWT_SECRET ?? (e.NODE_ENV === "production" ? "" : "dev-only-secret-change-me-dev-only-secret"),
  PUBLIC_ORIGIN: e.PUBLIC_ORIGIN ?? "http://localhost:5173",
  COOKIE_SECURE: (e.COOKIE_SECURE ?? (e.NODE_ENV === "production" ? "1" : "0")) === "1",
  SMTP_URL: e.SMTP_URL ?? "",
  EMERGENT_EMAIL_KEY: e.EMERGENT_EMAIL_KEY ?? "",
  EMAIL_RELAY_URL: e.EMAIL_RELAY_URL ?? "",
  EMAIL_RELAY_API_KEY: e.EMAIL_RELAY_API_KEY ?? "",
  EMAIL_REPLY_TO: e.EMAIL_REPLY_TO ?? "",
  OTP_ALLOWLIST: e.OTP_ALLOWLIST ?? "",
  EMAIL_FROM_NAME: e.EMAIL_FROM_NAME ?? "",
  OTP_FROM: e.OTP_FROM ?? "Samvaad Charades <no-reply@cag.gov.in>",
  ADMIN_EMAILS: (e.ADMIN_EMAILS ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean),
  // One ULCA "Inference API key" (Authorization value) works for every Dhruva task; per-task keys override it.
  DHRUVA_ASR_KEY: e.DHRUVA_ASR_KEY || e.DHRUVA_API_KEY || "",
  DHRUVA_NMT_KEY: e.DHRUVA_NMT_KEY || e.DHRUVA_API_KEY || "",
  DHRUVA_TTS_KEY: e.DHRUVA_TTS_KEY || e.DHRUVA_API_KEY || "",
  DHRUVA_LLM_KEY: e.DHRUVA_LLM_KEY || e.DHRUVA_API_KEY || "",
  DHRUVA_TTS_SERVICE_ID: e.DHRUVA_TTS_SERVICE_ID ?? "",
  ANUVAAD_XLIT_AUTH: e.ANUVAAD_XLIT_AUTH ?? "",
  EMERGENT_LLM_KEY: e.EMERGENT_LLM_KEY ?? "",
  INTEGRATION_PROXY_URL: e.INTEGRATION_PROXY_URL || "https://integrations.emergentagent.com",
  SEED_ALLOW_UNVERIFIED: e.SEED_ALLOW_UNVERIFIED === "1",
  CHROME_PATH: e.CHROME_PATH ?? "",
  WEB_DIST: e.WEB_DIST ?? resolve(ROOT, "apps/web/dist"),
};

if (!env.JWT_SECRET) throw new Error("JWT_SECRET must be set in production");
if (!env.isDev && env.SEED_ALLOW_UNVERIFIED) throw new Error("SEED_ALLOW_UNVERIFIED is development-only");
