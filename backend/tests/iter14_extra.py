# Iteration 14 extra: exact-reference Trial (judge sanity) and auto-submit half-time rule (deadline moved for our own attempt)
import os, sys, json, time, subprocess
sys.path.insert(0, os.path.dirname(__file__))
from iter11_helpers import BASE_URL, login, start, submit, report, _env_from_proc
from test_iter11_scoring_v2 import refs_for_page, page_id_of

DB = _env_from_proc("DATABASE_URL")
mode = sys.argv[1]
email = sys.argv[2]
s = login(email, name="TEST_QA Iter14")
r = start(s, "trial")
print("start", r.status_code)
a = r.json()
refs = refs_for_page(page_id_of(a["id"]))
ans = a["answers"]
for pid in ans:
    for fk in ans[pid]["fields"]:
        ans[pid]["fields"][fk] = refs.get(pid, {}).get(fk) or ""
    ans[pid]["done"] = True
if mode == "exact":
    t0 = time.time()
    r = submit(s, a, ans)
    print("submit", r.status_code, round(time.time() - t0, 1))
else:
    r = s.put(f"{BASE_URL}/api/attempts/{a['id']}/autosave", json={"clientId": "pytest-client-0011", "version": a["version"] + 1, "answers": ans}, timeout=60)
    print("autosave", r.status_code, r.text[:200])
    subprocess.run(["psql", "-q", DB, "-c", f"update attempts set started_at=now()-interval '21 minutes', deadline_at=now()-interval '1 minute' where id='{a['id']}' and status='active'"], check=True)
    for i in range(12):
        time.sleep(10)
        st = subprocess.run(["psql", "-tA", DB, "-c", f"select status, auto_submitted from attempts where id='{a['id']}'"], capture_output=True, text=True).stdout.strip()
        print("poll", st)
        if st.startswith("submitted"):
            break
rep = report(s, a["id"]).json()
print("ID", a["id"], "auto", rep.get("autoSubmitted"), "score", rep.get("score"))
print("counts", json.dumps(rep.get("counts")))
print("measures", json.dumps(rep.get("measures")))
