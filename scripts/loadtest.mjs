// Concurrent-player load test against a running deployment.
// Usage: node scripts/loadtest.mjs <baseUrl> <n> [prefix]   (OTP codes must be planted first with scripts/emergent/test-otp.sh)
const [base, nArg, prefix = "qa.lt"] = process.argv.slice(2);
const N = Number(nArg ?? 15);
const CODE = "246810";
const lat = {};
const errors = [];
const rec = (k, ms) => (lat[k] ??= []).push(ms);

async function call(jar, method, path, body, key) {
  const t0 = performance.now();
  const res = await fetch(base + "/api" + path, {
    method, headers: { "Content-Type": "application/json", ...(jar.c ? { cookie: jar.c } : {}) }, body: body ? JSON.stringify(body) : undefined,
  });
  rec(key ?? `${method} ${path.replace(/[0-9a-f-]{36}/g, ":id")}`, performance.now() - t0);
  const sc = res.headers.getSetCookie?.() ?? [];
  if (sc.length) jar.c = sc.map((x) => x.split(";")[0]).join("; ");
  const txt = await res.text();
  let json; try { json = JSON.parse(txt); } catch { json = txt; }
  if (!res.ok) throw Object.assign(new Error(`${method} ${path} ${res.status} ${txt.slice(0, 120)}`), { status: res.status });
  return json;
}

async function player(i) {
  const jar = {};
  const email = `${prefix}${String(i).padStart(2, "0")}@cag.gov.in`;
  const clientId = `load-${i}-${Date.now()}`;
  try {
    const v = await call(jar, "POST", "/auth/otp/verify", { email, code: CODE });
    if (v.status === "new") {
      const offices = await call(jar, "GET", "/offices?q=delhi");
      await call(jar, "POST", "/players/register", { name: `Load Tester ${i}`, mobile: `98${String(10000000 + i)}`, officeId: offices[0].id, officeAddress: "Load test office address, New Delhi" });
    }
    await Promise.all([call(jar, "GET", "/me/progress"), call(jar, "GET", "/config"), call(jar, "GET", "/sahayika/lines?section=trial")]);
    const a = await call(jar, "POST", "/rounds/trial/attempts", { clientId });
    let view = await call(jar, "GET", `/attempts/${a.id}?clientId=${clientId}`);
    const part = view.page.parts.find((p) => p.editable);
    const key = part.fields[0].key;
    let version = view.version;
    const sentences = ["स्टील अथॉरिटी ऑफ इंडिया लिमिटेड भारत की सबसे बड़ी इस्पात उत्पादक कंपनी है।", "कंपनी के पास पाँच एकीकृत इस्पात संयंत्र हैं।", "ब्लास्ट फर्नेस में गर्म धातु का उत्पादन किया जाता है।"];
    let text = "";
    for (let k = 0; k < 6; k++) {
      text += sentences[k % 3] + " ";
      const r = await call(jar, "PUT", `/attempts/${a.id}/autosave`, { version, clientId, answers: { [part.id]: { fields: { [key]: text.trim() }, done: true } } }, "PUT autosave");
      version = r.version;
      await new Promise((r) => setTimeout(r, 700 + Math.random() * 600));
    }
    await call(jar, "POST", `/attempts/${a.id}/submit`, { version, clientId, answers: { [part.id]: { fields: { [key]: text.trim() }, done: true } } });
    const rep = await call(jar, "GET", `/attempts/${a.id}/report`);
    await Promise.all([call(jar, "GET", "/leaderboard"), call(jar, "GET", "/me/profile"), call(jar, "GET", `/attempts/${a.id}/review`)]);
    return rep.score;
  } catch (e) { errors.push(`${email}: ${e.message}`); return null; }
}

const t0 = performance.now();
const scores = await Promise.all(Array.from({ length: N }, (_, i) => player(i + 1)));
const pct = (a, p) => a.sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))];
console.log(`players=${N} ok=${scores.filter((s) => s !== null).length} wall=${((performance.now() - t0) / 1000).toFixed(1)}s`);
for (const [k, a] of Object.entries(lat)) console.log(`${k.padEnd(34)} n=${String(a.length).padStart(3)} p50=${pct(a, 0.5).toFixed(0)}ms p95=${pct(a, 0.95).toFixed(0)}ms max=${Math.max(...a).toFixed(0)}ms`);
console.log("scores", scores.join(", "));
if (errors.length) console.log("ERRORS\n" + errors.join("\n"));
