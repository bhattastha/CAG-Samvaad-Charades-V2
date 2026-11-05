# Iteration 14: Translation Quality = 0.5*match with CAG Hindi + 0.5*AI judge; Timeliness not gated; credits per level
import os, sys, json, time
import pytest
sys.path.insert(0, os.path.dirname(__file__))
from iter11_helpers import BASE_URL, login, start, submit, report
from test_iter11_scoring_v2 import refs_for_page, page_id_of

EMAIL = os.environ.get("ITER14_EMAIL", "qa.cr20@cag.gov.in")
CAPS = {"trial": 3, "primary": 5, "secondary": 15, "pro": 25}
S = {}


def sess():
    if "s" not in S:
        S["s"] = login(EMAIL, name="TEST_QA Iter14")
    return S["s"]


def check_blend(rep, label):
    c, m = rep["counts"], rep["measures"]
    print(label, "score", rep["score"], "counts", json.dumps(c), "measures", json.dumps(m))
    assert "matchPct" in c and "aiPct" in c
    assert m["model"] == 2
    if m["ai"] is not None:
        exp = 0.5 * m["match"] + 0.5 * m["ai"]
        assert abs(m["quality"] - exp) < 1e-6, (m["quality"], exp)
        assert abs(c["qualityMarks"] - round(exp * 55, 1)) <= 0.11
        assert abs(c["qualityMarks"] - 55 * (0.5 * c["matchPct"] + 0.5 * c["aiPct"]) / 100) <= 0.6
    else:
        assert abs(m["quality"] - m["match"]) < 1e-6


# Primary: untouched BHASHINI draft (all parts ticked) -> non-zero TQ, timeliness not gated
class TestPrimaryUntouched:
    def test_primary_submit_untouched(self):
        s = sess()
        r = start(s, "primary")
        if r.status_code != 200:
            pytest.skip(f"cannot start primary: {r.status_code} {r.text}")
        a = r.json()
        ans = a["answers"]
        for pid in ans:
            ans[pid]["done"] = True
        t0 = time.time()
        r = submit(s, a, ans)
        lat = time.time() - t0
        print("PRIMARY submit latency", round(lat, 1), "s")
        assert r.status_code == 200, r.text
        rep = report(s, a["id"]).json()
        S["primary"] = rep
        check_blend(rep, "PRIMARY")
        c = rep["counts"]
        assert c["qualityMarks"] > 0, "TQ still 0 for untouched draft"
        assert 20 <= c["qualityMarks"] <= 50, c["qualityMarks"]
        assert c["timelinessMarks"] > 0, "Timeliness still gated"
        assert c["aiPct"] is not None, "AI judge did not answer"
        assert rep["autoSubmitted"] is False
        # submitted in time -> full time marks x completion share
        assert abs(rep["measures"]["time"] - 1) < 1e-9
        assert abs(c["timelinessMarks"] - round(20 * c["completionDone"] / c["completionTotal"], 1)) <= 0.11
        assert len(rep["weakSpots"]) <= 3
        assert lat < 90

    def test_primary_credits(self):
        s = sess()
        prog = s.get(f"{BASE_URL}/api/me/progress", timeout=30).json()
        rd = [x for x in prog["summary"]["rounds"] if x["key"] == "primary"][0]
        print("PRIMARY round summary", json.dumps(rd))
        assert abs(rd["credits"] - round(rd["best"] * CAPS["primary"] / 100, 1)) <= 0.051

    def test_primary_review_weakspots(self):
        rep = S.get("primary") or pytest.skip("no primary")
        rv = sess().get(f"{BASE_URL}/api/attempts/{rep['attemptId']}/review", timeout=60).json()
        assert rv["weakSpots"] == rep["weakSpots"]


# Trial: reasonable translation (reference sentences, a few dropped words) -> blend consistent
class TestTrialReasonable:
    def test_trial_submit(self):
        s = sess()
        r = start(s, "trial")
        if r.status_code != 200:
            pytest.skip(f"cannot start trial: {r.status_code} {r.text}")
        a = r.json()
        refs = refs_for_page(page_id_of(a["id"]))
        ans = a["answers"]
        for pid in ans:
            for fk in ans[pid]["fields"]:
                ref = refs.get(pid, {}).get(fk) or ""
                ws = ref.split(" ")
                # drop every 9th word to make it "reasonable" not identical
                ans[pid]["fields"][fk] = " ".join(w for i, w in enumerate(ws) if i % 9 != 4)
            ans[pid]["done"] = True
        t0 = time.time()
        r = submit(s, a, ans)
        print("TRIAL submit latency", round(time.time() - t0, 1), "s")
        assert r.status_code == 200, r.text
        rep = report(s, a["id"]).json()
        S["trial"] = rep
        check_blend(rep, "TRIAL")
        c = rep["counts"]
        assert c["aiPct"] is not None
        assert c["matchPct"] >= 60 and c["aiPct"] >= 50
        assert c["timelinessMarks"] > 0

    def test_trial_credits(self):
        s = sess()
        prog = s.get(f"{BASE_URL}/api/me/progress", timeout=30).json()
        rd = [x for x in prog["summary"]["rounds"] if x["key"] == "trial"][0]
        print("TRIAL round summary", json.dumps(rd))
        assert abs(rd["credits"] - round(rd["best"] * CAPS["trial"] / 100, 1)) <= 0.051
