import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { tts } from "../bhashini/client.js";
import { allLines, config, loadLines, loadOverrides } from "../content.js";
import { openDb } from "../db.js";
import { ROOT } from "../env.js";
const db = await openDb();
await loadOverrides(db);
await loadLines(db);
console.log("voice", config().bhashiniServices.ttsGender);
const dir = resolve(ROOT, ".data/audio");
mkdirSync(dir, { recursive: true });
let ok = 0, failed = 0;
for (const l of allLines().filter((x) => x.spoken && !/\{\w+\}/.test(x.en))) {
  try { writeFileSync(resolve(dir, `${l.id}.wav`), await tts(l.en)); ok++; } catch (e) { failed++; console.log("fail", l.id, String(e).slice(0, 80)); }
}
console.log({ ok, failed });
process.exit(0);
