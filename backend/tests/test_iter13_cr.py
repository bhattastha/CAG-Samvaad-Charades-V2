# Iteration 13: report motivation lines, weak spots, certificate badge, manager console (badges + v2 weights)
import os, sys, json, re, random
import pytest
import requests
sys.path.insert(0, os.path.dirname(__file__))
from iter11_helpers import BASE_URL, login, start, submit, report
from test_iter11_scoring_v2 import refs_for_page, page_id_of

NEW = os.environ.get("ITER13_EMAIL", "qa.cr13a@cag.gov.in")
CR6 = "qa.cr6@cag.gov.in"
CR6_WIN, CR6_LOWER = "04b17cf2-ce6b-4858-9c65-f1a9051d1235", "fe904098-fc6e-45a2-9a74-fddac94860bf"
MANAGER = "bhattastha.dibd@gmail.com"
S = {}


def all_lines(rep):
    return [rep.get("tip") or {}] + list(rep.get("announce") or []) + list(rep.get("after") or [])


# New player: certificate without title, then Trial (partial reference) -> report with weakSpots + motivation
class TestTrialFlow:
    def test_cert_no_title(self):
        s = login(NEW, name="TEST_QA Iter13")
        S["s"] = s
        prog = s.get(f"{BASE_URL}/api/me/progress", timeout=30).json()
        trial = [r for r in prog["summary"]["rounds"] if r["key"] == "trial"][0]
        S["trial_won"] = trial["titleEarned"]
        r = s.get(f"{BASE_URL}/api/me/certificate", params={"format": "html"}, timeout=60)
        print("cert status", r.status_code, r.text[:200])
        if not trial["titleEarned"]:
            assert 'class="badge"' not in r.text

    def test_trial_submit_report(self):
        s = S.get("s") or login(NEW)
        r = start(s, "trial")
        if r.status_code != 200:
            pytest.skip(f"cannot start trial: {r.text}")
        a = r.json()
        refs = refs_for_page(page_id_of(a["id"]))
        ans = a["answers"]
        pids = list(ans.keys())
        # fill ~60% of parts with reference, rest left empty -> title (>=33) plus some weak spots
        for i, pid in enumerate(pids):
            for fk in ans[pid]["fields"]:
                ref = refs.get(pid, {}).get(fk) or ""
                sents = [x for x in ref.split("।") if x.strip()]
                keep = max(1, int(len(sents) * 0.6))
                ans[pid]["fields"][fk] = "।".join(sents[:keep]) + "।" if sents else ""
            ans[pid]["done"] = True
        r = submit(s, a, ans)
        assert r.status_code == 200, r.text
        rep = report(s, a["id"]).json()
        S["aid"] = a["id"]
        print("TRIAL", rep["score"], rep["titleEarned"], json.dumps(rep["tip"], ensure_ascii=False))
        print("AFTER", json.dumps(rep["after"], ensure_ascii=False))
        print("WEAK", json.dumps(rep["weakSpots"], ensure_ascii=False)[:800])
        assert isinstance(rep["weakSpots"], list) and 1 <= len(rep["weakSpots"]) <= 3
        w = rep["weakSpots"][0]
        for k in ("partId", "sentence", "en", "similarityPct", "lostMarks"):
            assert k in w
        assert rep["weakSpots"] == sorted(rep["weakSpots"], key=lambda x: -x["lostMarks"])
        assert rep["tip"]["id"] in ("trial.report_card.motivate_high", "trial.report_card.motivate_mid", "trial.report_card.motivate_low")
        for l in all_lines(rep):
            assert "tip_term" not in (l.get("id") or ""), l
            assert "Glossary tip" not in (l.get("en") or "")
        sc = rep["score"]
        en = rep["tip"]["en"]
        if sc >= 75:
            assert en.startswith("Take a bow")
        elif rep["titleEarned"]:
            assert en.startswith("Good job")
        else:
            assert en.startswith("Don't give up") and "more marks" in en
        ids = [l.get("id") for l in rep["after"]]
        if rep["titleEarned"] and rep["nextRound"]:
            assert any(i and i.endswith("go_next") for i in ids), ids
        elif rep["chancesLeft"] > 0:
            assert any(i and i.endswith("improve_retry") for i in ids), ids

    def test_review_weakspots(self):
        if "aid" not in S:
            pytest.skip("no attempt")
        s = S["s"]
        r = s.get(f"{BASE_URL}/api/attempts/{S['aid']}/review", timeout=60)
        assert r.status_code == 200
        rv = r.json()
        rep = report(s, S["aid"]).json()
        assert rv["weakSpots"] == rep["weakSpots"]

    def test_cert_after_title(self):
        s = S.get("s") or login(NEW)
        prog = s.get(f"{BASE_URL}/api/me/progress", timeout=30).json()
        trial = [r for r in prog["summary"]["rounds"] if r["key"] == "trial"][0]
        r = s.get(f"{BASE_URL}/api/me/certificate", params={"format": "html"}, timeout=60)
        if trial["titleEarned"]:
            assert r.status_code == 200
            assert 'class="badge"' in r.text and "<svg" in r.text
            assert "Bronze" in r.text and ">I<" in r.text


# Old attempts (pre-weakSpots) and held-title report lines
class TestCr6:
    def test_old_reports_no_errors(self):
        s = login(CR6)
        for aid in (CR6_WIN, CR6_LOWER):
            rep = report(s, aid)
            assert rep.status_code == 200
            assert rep.json()["weakSpots"] == []
            rv = s.get(f"{BASE_URL}/api/attempts/{aid}/review", timeout=60)
            assert rv.status_code == 200 and rv.json()["weakSpots"] == []

    def test_held_title_low_score_tip(self):
        s = login(CR6)
        low = report(s, CR6_LOWER).json()
        print("CR6 LOW tip", low["score"], json.dumps(low["tip"], ensure_ascii=False))
        print("CR6 LOW after", json.dumps(low["after"], ensure_ascii=False))
        # a 23.4 attempt should not be told that "23.4 wins the title"
        assert "wins the title" not in low["tip"]["en"], low["tip"]["en"]

    def test_cert_primary_silver(self):
        s = login(CR6)
        r = s.get(f"{BASE_URL}/api/me/certificate", params={"format": "html"}, timeout=60)
        assert r.status_code == 200
        assert "Silver" in r.text and ">II<" in r.text


# Manager console: players badges + v2 weights
class TestManager:
    def test_players_and_detail(self):
        s = login(MANAGER)
        S["m"] = s
        r = s.get(f"{BASE_URL}/api/admin/players", timeout=60)
        assert r.status_code == 200, r.text
        data = r.json()
        rows = data if isinstance(data, list) else data.get("players") or data.get("rows") or data.get("items")
        print("PLAYERS sample", json.dumps(rows[:1], ensure_ascii=False)[:800])
        cr6 = [p for p in rows if (p.get("email") or "").lower() == CR6]
        assert cr6, "cr6 not in list"
        S["cr6id"] = cr6[0]["id"]
        d = s.get(f"{BASE_URL}/api/admin/players/{S['cr6id']}", timeout=60)
        assert d.status_code == 200
        print("DETAIL keys", list(d.json().keys()))

    def test_config_weights(self):
        s = S.get("m") or login(MANAGER)
        c = s.get(f"{BASE_URL}/api/admin/config", timeout=60).json()
        cfg = c.get("effective") or c.get("config") or c
        w = cfg["scoringWeights"]
        print("WEIGHTS", w)
        assert w["translationQuality"] == 55 and w["glossary"] == 25 and w["timelinessCompletion"] == 20
        import subprocess
        from iter11_helpers import _env_from_proc
        db = _env_from_proc("DATABASE_URL")
        had = subprocess.run(["psql", "-tA", db, "-c", "select count(*) from config_overrides where key='settings'"], capture_output=True, text=True).stdout.strip()
        r = s.put(f"{BASE_URL}/api/admin/config/settings", json={"scoringWeights": w}, timeout=60)
        if had == "0":  # remove the override row this test created (same values as defaults)
            subprocess.run(["psql", "-q", db, "-c", "delete from config_overrides where key='settings'"], capture_output=True)
        assert r.status_code == 200, r.text
        assert r.json()["effective"]["scoringWeights"] == w

    def test_overview(self):
        s = S.get("m") or login(MANAGER)
        r = s.get(f"{BASE_URL}/api/admin/analytics/overview", timeout=90)
        assert r.status_code == 200
        print("OVERVIEW keys", list(r.json().keys()))
