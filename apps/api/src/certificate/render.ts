import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { fill, type Summary } from "@hc/shared";
import { config, strings } from "../content.js";
import { env, ROOT } from "../env.js";
import { badgeMetal, badgeSvg } from "./badge.js";

const dataUrl = (p: string, type: string) => `data:${type};base64,${readFileSync(p).toString("base64")}`;

function fontFaces(): string {
  const dir = resolve(ROOT, "assets/fonts");
  if (!existsSync(dir)) return "";
  return readdirSync(dir)
    .filter((f) => f.endsWith(".woff2"))
    .map((f) => {
      const family = f.startsWith("noto-sans-devanagari") ? "Noto Sans Devanagari" : "Noto Sans";
      const weight = /-(\d00)-/.exec(f)?.[1] ?? "400";
      return `@font-face{font-family:"${family}";font-weight:${weight};src:url(${dataUrl(resolve(dir, f), "font/woff2")}) format("woff2");}`;
    })
    .join("\n");
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export function verificationId(email: string, total: number, issued: string) {
  return createHash("sha256").update(`${email}|${total}|${issued}|${env.JWT_SECRET}`).digest("hex").slice(0, 12).toUpperCase();
}

export function certificateHtml(p: { name: string; office: string; email: string; summary: Summary; issuedOn: Date }) {
  const c = strings.certificate;
  const titles = p.summary.rounds.filter((r) => r.titleEarned); // only titles earned, in round order
  const en = config().ui.locale === "en";
  const issued = p.issuedOn.toLocaleDateString(en ? "en-IN" : "hi-IN", { day: "numeric", month: "long", year: "numeric" });
  const vid = verificationId(p.email, p.summary.totalCredits, p.issuedOn.toISOString().slice(0, 10));
  const brand = (f: string) => dataUrl(resolve(ROOT, "assets/brand", f), "image/png");
  return `<!doctype html><html lang="${en ? "en" : "hi"}"><head><meta charset="utf-8"><title>${esc(c.docTitle)}</title><style>
${fontFaces()}
@page{size:A4 landscape;margin:0}
*{box-sizing:border-box}
html,body{margin:0;width:297mm;height:210mm;font-family:"Noto Sans Devanagari","Noto Sans",sans-serif;color:#1f2937;background:#fff}
.frame{position:absolute;inset:8mm;border:3px solid #E8590C;border-radius:6mm;padding:10mm 16mm;display:flex;flex-direction:column;align-items:center;text-align:center;
  background:radial-gradient(circle at 0 0,#FFF1E6 0,transparent 35%),radial-gradient(circle at 100% 100%,#E8F0FF 0,transparent 35%)}
.frame:before{content:"";position:absolute;inset:3mm;border:1px solid #2563EB55;border-radius:4mm;pointer-events:none}
.top{width:100%;display:flex;justify-content:space-between;align-items:center}
.top img{height:22mm}
h1{margin:0;font-size:34pt;line-height:1.2}
h1 .a{color:#22293B}h1 .b{color:#E8590C}
.brand{letter-spacing:.3em;font-size:9pt;color:#6B7280;font-family:"Noto Sans"}
.lead{margin-top:6mm;font-size:15pt;color:#374151}
.name{font-size:30pt;font-weight:700;color:#C2410C;margin:2mm 0 0;border-bottom:2px solid #FDBA74;padding:0 10mm 1mm}
.office{font-size:12pt;color:#374151;margin-top:2mm}
.body{font-size:13pt;margin-top:5mm;max-width:210mm;line-height:1.7}
.titles{display:flex;gap:4mm;justify-content:center;flex-wrap:wrap;margin-top:4mm}
.pill{background:#E8590C;color:#fff;border-radius:99px;padding:2mm 7mm;font-size:15pt;font-weight:700}
.credits{margin-top:5mm;font-size:14pt}.credits b{font-size:22pt;color:#1D4ED8}
.foot{margin-top:auto;width:100%;display:flex;justify-content:space-between;align-items:flex-end;font-size:10pt;color:#4B5563}
.sign{border-top:1px solid #9CA3AF;padding-top:1mm;min-width:60mm}
.badge{position:absolute;right:20mm;top:44mm;width:44mm;text-align:center}
.badge-t{font-family:"Noto Sans",sans-serif;font-weight:700;font-size:11pt;color:#1E3A5F;margin-top:1mm}
.badge-m{font-family:"Noto Sans",sans-serif;font-size:8.5pt;letter-spacing:.2em;text-transform:uppercase;color:#6B7280}
</style></head><body><div class="frame">
<div class="top"><img src="${brand("cag-logo.png")}" alt=""><img src="${brand("bhashini-logo.png")}" alt=""></div>
${(() => { const b = config().brand; const name = en ? b.name : b.localized.hi ?? b.name; const [w1, ...rest] = name.split(" "); return `<h1><span class="a">${esc(w1)}</span> <span class="b">${esc(rest.join(" "))}</span></h1>`; })()}
<div class="brand">CAG × BHASHINI · HINDI PAKHWADA</div>
<div class="lead">${esc(c.certify)}</div>
<div class="name">${esc(p.name)}</div>
<div class="office">${esc(p.office)}</div>
<div class="body">${esc(titles.length ? c.bodyTitles : c.bodyNoTitles)}</div>
${titles.length ? (() => { const top = titles[titles.length - 1]!; const rc = config().rounds.find((r) => r.key === top.key); return `<div class="badge">${badgeSvg(top.key)}<div class="badge-t">${esc(rc?.titleEn || top.title)}</div><div class="badge-m">${esc(badgeMetal(top.key))}</div></div>`; })() : ""}
${titles.length ? `<div class="titles">${titles.map((t) => { const rc = config().rounds.find((r) => r.key === t.key); return `<span class="pill">${esc(en ? rc?.titleEn || t.title : t.title)}</span>`; }).join("")}</div>` : ""}
<div class="credits">${esc(c.creditsLabel)} <b>${p.summary.totalCredits}</b> / ${config().maxCredits}</div>
<div class="foot">
  <div style="text-align:left">${esc(c.date)}: ${esc(issued)}<br>${esc(c.verification)}: ${vid}</div>
  <div class="sign">${esc(c.signatory)}</div>
</div></div></body></html>`;
}

function chromePath(): string | undefined {
  const candidates = [env.CHROME_PATH, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome"];
  return candidates.find((p) => p && existsSync(p));
}

/** Playwright (headless Chromium) renders HTML → PDF/PNG; pdf-lib/pdfkit mis-shape Devanagari conjuncts. */
export async function renderCertificate(html: string, format: "pdf" | "png"): Promise<Buffer | null> {
  const exe = chromePath();
  if (!exe) return null;
  // the published bundle ships without playwright-core: fall back to the HTML certificate
  const pw = await import("playwright-core").catch(() => null);
  if (!pw) return null;
  const { chromium } = pw;
  const browser = await chromium.launch({ executablePath: exe, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1123, height: 794 }, deviceScaleFactor: format === "png" ? 2 : 1 });
    await page.setContent(html, { waitUntil: "load" });
    await page.evaluate(() => (document as any).fonts.ready);
    return format === "pdf"
      ? Buffer.from(await page.pdf({ format: "A4", landscape: true, printBackground: true }))
      : Buffer.from(await page.screenshot({ type: "png", fullPage: true }));
  } finally {
    await browser.close();
  }
}

export const certificateFileName = (format: string) => fill("hindi-charades-certificate.{f}", { f: format });
