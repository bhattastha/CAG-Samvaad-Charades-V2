# helper: start (or resume) primary + secondary attempts for the iter13 QA player and print their ids
import os, sys, json
sys.path.insert(0, os.path.dirname(__file__))
from iter11_helpers import login, start
s = login("qa.cr13a@cag.gov.in")
for k in sys.argv[1:]:
    r = start(s, k)
    print(k, r.status_code, r.json().get("id") if r.status_code == 200 else r.text[:200])
