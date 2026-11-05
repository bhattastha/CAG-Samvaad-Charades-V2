# Iteration 10: Change Request v1.0 – CAG email restriction, trial ~200 words, report structure in bundles, pro scroll config, Sahayika lines, autosave without 'done'
import os, random, subprocess, re
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API_EMAIL = "qa.cr2@cag.gov.in"


def plant(email):
    code = "%06d" % random.randint(0, 999999)
    subprocess.run(["/app/scripts/emergent/test-otp.sh", email, code], check=True, capture_output=True)
    return code


def login(email):
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/otp/verify", json={"email": email, "code": plant(email)}, timeout=30)
    return s, r


@pytest.fixture(scope="module")
def player():
    s, r = login(API_EMAIL)
    assert r.status_code == 200, r.text
    if r.json().get("status") == "new":
        office = requests.get(f"{BASE_URL}/api/offices", params={"q": "delhi"}, timeout=30).json()[0]
        r2 = s.post(f"{BASE_URL}/api/players/register", json={"name": "QA Cr Two", "mobile": "9500001102",
                    "officeId": office["id"], "officeAddress": "Indraprastha Estate, New Delhi 110002"}, timeout=30)
        assert r2.status_code == 200, r2.text
    return s


def start(s, key):
    r = s.post(f"{BASE_URL}/api/rounds/{key}/attempts", json={"clientId": "pytest-client-0001"}, timeout=60)
    assert r.status_code == 200, r.text
    return r.json()


def finish(s, a, answers=None):
    r = s.post(f"{BASE_URL}/api/attempts/{a['id']}/submit", json={"clientId": "pytest-client-0001", "version": a["version"] + 1, "answers": answers or a["answers"]}, timeout=120)
    assert r.status_code == 200, r.text
    return r.json()


def active_cleanup(s):
    prog = s.get(f"{BASE_URL}/api/me/progress", timeout=30).json()
    for rd in prog["summary"]["rounds"]:
        if rd.get("active"):
            a = start(s, rd["key"])  # resumes
            finish(s, a)


# Phase 2: email domain restriction
class TestEmailDomain:
    def test_request_non_cag_403(self):
        r = requests.post(f"{BASE_URL}/api/auth/otp/request", json={"email": "someone@gmail.com"}, timeout=30)
        assert r.status_code == 403 and r.json()["error"] == "email_domain"

    def test_verify_non_cag_403(self):
        r = requests.post(f"{BASE_URL}/api/auth/otp/verify", json={"email": "someone@gmail.com", "code": "123456"}, timeout=30)
        assert r.status_code == 403 and r.json()["error"] == "email_domain"

    def test_subdomain_spoof_403(self):
        r = requests.post(f"{BASE_URL}/api/auth/otp/verify", json={"email": "x@cag.gov.in.evil.com", "code": "123456"}, timeout=30)
        assert r.status_code == 403

    @pytest.mark.parametrize("email", ["bhattastha1520@gmail.com", "asthabhatt152000@gmail.com"])
    def test_allowlisted_verify(self, email):
        _, r = login(email)
        assert r.status_code == 200, r.text
        assert r.json()["status"] in ("new", "existing")

    def test_cag_verify_ok(self):
        _, r = login("qa.cr3@cag.gov.in")
        assert r.status_code == 200

    def test_wrong_code_400(self):
        r = requests.post(f"{BASE_URL}/api/auth/otp/verify", json={"email": "qa.cr4@cag.gov.in", "code": "000001"}, timeout=30)
        assert r.status_code == 400


# Phase 7: Sahayika lines
class TestSahayika:
    def test_before_game_lines(self):
        r = requests.get(f"{BASE_URL}/api/sahayika/lines", params={"section": "before_game"}, timeout=30)
        assert r.status_code == 200
        ids = [l["id"] for l in r.json()]
        for i in range(1, 12):
            assert f"before_game.briefing.w{i:02d}" in ids
        assert any(i.startswith("before_game.training.") for i in ids)
        assert any(i.startswith("before_game.registration.") for i in ids)
        assert not any("Sahayak " in (l.get("en") or "") for l in r.json())

    def test_welcome_line(self):
        lines = requests.get(f"{BASE_URL}/api/sahayika/lines", timeout=30).json()
        assert any("I'm Sahayika" in (l.get("en") or "") for l in lines)


# Phase 3/4/5: round contents
class TestRounds:
    def test_config_pro_scroll(self):
        rounds = requests.get(f"{BASE_URL}/api/rounds", timeout=30).json()
        pro = [r for r in rounds if r["key"] == "pro"][0]
        assert pro.get("scrollMode") is True

    def test_trial_200_words_and_autosave(self, player):
        active_cleanup(player)
        a = start(player, "trial")
        parts = a["page"]["parts"]
        text = " ".join(f["en"] for p in parts for f in p["fields"])
        words = len(text.split())
        sents = [x for p in parts for x in (p.get("enSentences") or [])]
        print("trial words", words, "sentences", len(sents))
        assert 170 <= words <= 240, words
        assert len(sents) in (8, 9)
        ans = a["answers"]
        pid = list(ans.keys())[0]
        fk = list(ans[pid]["fields"].keys())[0]
        ans[pid]["fields"][fk] = "भारतीय इस्पात प्राधिकरण लिमिटेड"
        ans[pid]["done"] = True
        r = player.put(f"{BASE_URL}/api/attempts/{a['id']}/autosave", json={"version": a["version"] + 1, "clientId": "pytest-client-0001", "answers": ans}, timeout=30)
        assert r.status_code == 200, r.text
        g = player.get(f"{BASE_URL}/api/attempts/{a['id']}", params={"clientId": "pytest-client-0001"}, timeout=30).json()
        assert g["answers"][pid]["fields"][fk] == "भारतीय इस्पात प्राधिकरण लिमिटेड"
        res = finish(player, g, g["answers"])
        assert isinstance(res["score"], (int, float))
        rep = player.get(f"{BASE_URL}/api/attempts/{a['id']}/report", timeout=60)
        assert rep.status_code == 200
        print("report keys", list(rep.json().keys()))

    def test_secondary_structure(self, player):
        active_cleanup(player)
        a = start(player, "secondary")
        pages = a.get("pages") or [a["page"]]
        types = {p["type"] for pg in pages for p in pg["parts"]}
        print("secondary part types", types, "pages", len({p.get("pageNo") for p in a["page"]["parts"]}))
        finish(player, a)
        assert "table" in types
        assert any("foot" in t for t in types)
        print("NOTE secondary has figure:", any(t in ("figure", "chart") for t in types))

    def test_pro_structure(self, player):
        active_cleanup(player)
        a = start(player, "pro")
        pages = a.get("pages") or [a["page"]]
        print("pro keys", list(a.keys()), "pages", len(pages))
        types = {p["type"] for pg in pages for p in pg["parts"]}
        print("pro part types", types, "pages", len({p.get("pageNo") for p in a["page"]["parts"]}))
        assert len({p.get("pageNo") for p in a["page"]["parts"]}) == 30
        finish(player, a)
        assert "table" in types
