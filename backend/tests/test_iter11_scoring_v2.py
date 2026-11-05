# Iteration 11: Scoring model v2 (55/25/20), draft-gain gate, one-decimal scores, credits, OTP request, email domain
import os, sys, json, subprocess, re
import pytest
import requests
sys.path.insert(0, os.path.dirname(__file__))
from iter11_helpers import BASE_URL, login, start, submit, report, _env_from_proc

TRIAL_EMAIL = "qa.cr6@cag.gov.in"
PRIMARY_EMAIL = "qa.cr2@cag.gov.in"  # existing QA player (iteration 10) with primary unlocked


def refs_for_page(page_id):
    db = _env_from_proc("DATABASE_URL")
    out = subprocess.run(["psql", "-tA", db, "-c", f"select id, fields::text from page_parts where page_id='{page_id}'"],
                         check=True, capture_output=True, text=True).stdout
    res = {}
    for line in out.strip().splitlines():
        pid, f = line.split("|", 1)
        res[pid] = {x["key"]: x.get("hiReference", "") for x in json.loads(f)}
    return res


def page_id_of(aid):
    db = _env_from_proc("DATABASE_URL")
    return subprocess.run(["psql", "-tA", db, "-c", f"select page_id from attempts where id='{aid}'"],
                          check=True, capture_output=True, text=True).stdout.strip()


def one_decimal(x):
    return abs(round(x, 1) - x) < 1e-9


# Email domain restriction (no OTP request sent for CAG here: only non-CAG path)
class TestEmailDomain:
    def test_request_non_cag_403(self):
        r = requests.post(f"{BASE_URL}/api/auth/otp/request", json={"email": "qa.someone@gmail.com"}, timeout=30)
        assert r.status_code == 403 and r.json()["error"] == "email_domain"


# Scoring v2 – draft rounds: unchanged draft → TQ 0, timeliness gated
class TestPrimaryDraftUnchanged:
    def test_primary_unchanged_draft(self):
        s = login(PRIMARY_EMAIL)
        prog = s.get(f"{BASE_URL}/api/me/progress", timeout=30).json()
        prim = [r for r in prog["summary"]["rounds"] if r["key"] == "primary"][0]
        if prim["chancesLeft"] == 0 and not prim.get("active"):
            pytest.skip("no primary chances left")
        r = start(s, "primary")
        assert r.status_code == 200, r.text
        a = r.json()
        assert not any(v.get("done") for v in a["answers"].values())
        r = submit(s, a)
        assert r.status_code == 200, r.text
        rep = report(s, a["id"]).json()
        m, c = rep["measures"], rep["counts"]
        assert m["model"] == 2
        assert c["qualityMarks"] == 0 and m["quality"] == 0
        assert c["timelinessMarks"] == 0 and c["timelinessGated"] is True
        assert abs(rep["score"] - c["glossaryMarks"]) < 0.11
        assert one_decimal(rep["score"])


# Scoring v2 – Trial: similarity, one-decimal, credits
class TestTrial:
    def test_trial_empty_then_good(self):
        s = login(TRIAL_EMAIL, name="QA Cr Six", mobile="9500001106")
        prog = s.get(f"{BASE_URL}/api/me/progress", timeout=30).json()
        tr = [r for r in prog["summary"]["rounds"] if r["key"] == "trial"][0]
        print("trial before", tr)
        if tr["chancesLeft"] < 2 and not tr.get("active"):
            pytest.skip("not enough trial chances")
        # 1) empty submission → 0
        a = start(s, "trial").json()
        r = submit(s, a)
        assert r.status_code == 200, r.text
        rep = report(s, a["id"]).json()
        print("EMPTY", rep["score"], rep["counts"])
        assert rep["score"] == 0
        # 2) reference-close Hindi (dropping last sentence-part) → passing, one-decimal
        a = start(s, "trial").json()
        refs = refs_for_page(page_id_of(a["id"]))
        ans = a["answers"]
        pids = list(ans.keys())
        for pid in pids[:-1] if len(pids) > 1 else pids:
            for fk in ans[pid]["fields"]:
                ref = refs.get(pid, {}).get(fk, "")
                # drop the last word of each field to avoid a perfect copy
                ans[pid]["fields"][fk] = ref
        r = submit(s, a, ans)
        assert r.status_code == 200, r.text
        rep = report(s, a["id"]).json()
        c, m = rep["counts"], rep["measures"]
        print("GOOD", rep["score"], c, m)
        assert m["model"] == 2
        assert one_decimal(rep["score"])
        assert c["qualityMarks"] <= 55 and c["glossaryMarks"] <= 25 and c["timelinessMarks"] <= 20
        assert abs(c["qualityMarks"] + c["glossaryMarks"] + c["timelinessMarks"] - rep["score"]) <= 0.2
        assert c["draftSimilarityPct"] is None and c["timelinessGated"] is False
        assert rep["score"] >= 33, rep["score"]
        best = max(x for x in rep["chances"] if x is not None)
        assert rep["roundCredits"] == round(best * 3 / 100 + 1e-9, 1)
        prog = s.get(f"{BASE_URL}/api/me/progress", timeout=30).json()
        print("progress after", json.dumps(prog["summary"], ensure_ascii=False)[:800])
        total = prog["summary"]["registrationCredits"] + sum(x["credits"] for x in prog["summary"]["rounds"])
        assert abs(total - prog["summary"]["totalCredits"]) < 0.05
        assert prog["summary"]["trialPassed"] is True
        open("/tmp/trial_attempt.txt", "w").write(a["id"])


# Old attempts (pre-v2) still return a report
class TestOldReport:
    def test_old_attempt_report(self):
        db = _env_from_proc("DATABASE_URL")
        aid = subprocess.run(["psql", "-tA", db, "-c",
            "select a.id from attempts a join players p on p.id=a.player_id where p.email='qa.cr2@cag.gov.in' and a.status<>'active' and (a.measures->>'model') is null limit 1"],
            capture_output=True, text=True).stdout.strip()
        if not aid:
            pytest.skip("no pre-v2 attempt")
        s = login(PRIMARY_EMAIL)
        r = report(s, aid)
        assert r.status_code == 200, r.text
        print("old report", r.json()["score"], r.json()["measures"])


# Scoring v2 – Trial partial (few sentences) → one decimal; lower later attempt keeps credits
class TestTrialPartialKeepsCredits:
    def test_trial_partial(self):
        s = login(TRIAL_EMAIL)
        prog = s.get(f"{BASE_URL}/api/me/progress", timeout=30).json()
        tr = [r for r in prog["summary"]["rounds"] if r["key"] == "trial"][0]
        if tr["chancesLeft"] < 1 and not tr.get("active"):
            pytest.skip("no trial chances")
        credits_before = tr["credits"]
        a = start(s, "trial").json()
        refs = refs_for_page(page_id_of(a["id"]))
        ans = a["answers"]
        pid = list(ans.keys())[0]
        fk = list(ans[pid]["fields"].keys())[0]
        ref = refs[pid][fk]
        ans[pid]["fields"][fk] = " ".join(ref.split()[: max(6, len(ref.split()) // 2)]) + "।"
        rep_s = submit(s, a, ans)
        assert rep_s.status_code == 200, rep_s.text
        rep = report(s, a["id"]).json()
        print("PARTIAL", rep["score"], rep["counts"])
        assert one_decimal(rep["score"]) and 0 < rep["score"] < 60
        prog = s.get(f"{BASE_URL}/api/me/progress", timeout=30).json()
        tr2 = [r for r in prog["summary"]["rounds"] if r["key"] == "trial"][0]
        assert tr2["credits"] == credits_before


# Scoring v2 – Primary with genuine improvement (reference text, all marked done) → TQ > 0, timeliness not gated
class TestPrimaryImproved:
    def test_primary_improved(self):
        s = login(TRIAL_EMAIL)
        r = start(s, "primary")
        assert r.status_code == 200, r.text
        a = r.json()
        refs = refs_for_page(page_id_of(a["id"]))
        ans = a["answers"]
        for pid, v in ans.items():
            for fk in v["fields"]:
                if refs.get(pid, {}).get(fk):
                    v["fields"][fk] = refs[pid][fk]
            v["done"] = True
        r = submit(s, a, ans)
        assert r.status_code == 200, r.text
        rep = report(s, a["id"]).json()
        c, m = rep["counts"], rep["measures"]
        print("PRIMARY IMPROVED", rep["score"], c)
        assert m["model"] == 2 and c["timelinessGated"] is False
        assert c["qualityMarks"] > 40 and c["timelinessMarks"] > 15
        assert rep["roundCredits"] == round(rep["best"] * 5 / 100 + 1e-9, 1) if isinstance(rep["best"], (int, float)) else True
