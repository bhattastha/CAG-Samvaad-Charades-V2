# helper: submit the given attempt (as-is answers from server state) for the iter13 QA player, print report summary
import os, sys, json
sys.path.insert(0, os.path.dirname(__file__))
from iter11_helpers import login, submit, report, BASE_URL
s = login("qa.cr13a@cag.gov.in")
aid = sys.argv[1]
a = s.get(f"{BASE_URL}/api/attempts/{aid}", timeout=60).json()
import iter11_helpers as h
r = s.post(f"{BASE_URL}/api/attempts/{aid}/submit", json={"clientId": os.environ.get("CID", "pytest-client-0011"), "version": a["version"] + 1, "answers": a["answers"]}, timeout=180)
print("submit", r.status_code, r.text[:150])
rep = report(s, aid).json()
print("score", rep["score"], "title", rep["titleEarned"], "tip", json.dumps(rep["tip"], ensure_ascii=False))
print("after", json.dumps([l["id"] for l in rep["after"]]))
print("weak", json.dumps(rep["weakSpots"], ensure_ascii=False)[:600])
rv = s.get(f"{BASE_URL}/api/attempts/{aid}/review", timeout=60).json()
print("review weak parts", [w["partId"] for w in rv["weakSpots"]])
