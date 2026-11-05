# Iteration 12: follow-ups from iteration 11 – test-otp.sh, fluency refKeys filter (reference Hindi ~55 TQ), held-title report data, knowledge text
import os, sys, json, subprocess, random
import pytest
import requests
sys.path.insert(0, os.path.dirname(__file__))
from iter11_helpers import BASE_URL, start, submit, report
from test_iter11_scoring_v2 import refs_for_page, page_id_of

NEW_EMAIL = os.environ.get("ITER12_EMAIL", "qa.cr7@cag.gov.in")
CR6 = "qa.cr6@cag.gov.in"
CR6_WIN, CR6_LOWER = "04b17cf2-ce6b-4858-9c65-f1a9051d1235", "fe904098-fc6e-45a2-9a74-fddac94860bf"
STATE = {}


def script_login(email):
    # test-otp.sh must work without DATABASE_URL in env / backend/.env
    code = "%06d" % random.randint(100000, 999999)
    env = {k: v for k, v in os.environ.items() if k not in ("DATABASE_URL", "JWT_SECRET")}
    out = subprocess.run(["bash", "/app/scripts/emergent/test-otp.sh", email, code], capture_output=True, text=True, env=env)
    assert out.returncode == 0, out.stderr
    assert "planted code" in out.stdout
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/otp/verify", json={"email": email, "code": code}, timeout=30)
    assert r.status_code == 200, r.text
    if r.json().get("status") == "new":
        office = requests.get(f"{BASE_URL}/api/offices", params={"q": "delhi"}, timeout=30).json()[0]
        r2 = s.post(f"{BASE_URL}/api/players/register", json={"name": "TEST_QA Iter12", "mobile": "9500001212",
                    "officeId": office["id"], "officeAddress": "Indraprastha Estate, New Delhi 110002"}, timeout=30)
        assert r2.status_code == 200, r2.text
    return s


# test-otp.sh: plant + verify
class TestOtpScript:
    def test_script_login_existing(self):
        s = script_login(CR6)
        me = s.get(f"{BASE_URL}/api/me/progress", timeout=30)
        assert me.status_code == 200

    def test_wrong_code_rejected(self):
        subprocess.run(["bash", "/app/scripts/emergent/test-otp.sh", CR6, "111111"], check=True, capture_output=True)
        r = requests.post(f"{BASE_URL}/api/auth/otp/verify", json={"email": CR6, "code": "222222"}, timeout=30)
        assert r.status_code in (400, 401, 403)


# Held title on a lower re-attempt (data that drives heldOnly)
class TestHeldTitleReport:
    def test_cr6_reports(self):
        s = script_login(CR6)
        win = report(s, CR6_WIN).json()
        low = report(s, CR6_LOWER).json()
        print("WIN", win["score"], win["best"], win["titleEarned"], win["roundCredits"], [l.get("id") for l in win["announce"]])
        print("LOW", low["score"], low["best"], low["titleEarned"], low["roundCredits"], [l.get("id") for l in low["announce"]])
        assert win["titleEarned"] and low["titleEarned"]
        assert low["score"] == 23.4 and low["score"] < low["best"]
        assert win["score"] >= win["best"]
        assert len(low["announce"]) >= 2


# Fluency: reference Hindi in Primary should reach close to 55 TQ (no penalty for grammar issues present in reference)
class TestPrimaryReferenceFluency:
    def test_primary_reference(self):
        s = script_login(NEW_EMAIL)
        prog = s.get(f"{BASE_URL}/api/me/progress", timeout=30).json()
        prim = [r for r in prog["summary"]["rounds"] if r["key"] == "primary"][0]
        if prim["chancesLeft"] == 0 and not prim.get("active"):
            pytest.skip("no primary chances left")
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
        print("PRIMARY REF", a["id"], rep["score"], json.dumps(m), json.dumps(c))
        STATE["first"] = a["id"]
        assert m["model"] == 2
        assert m["fluency"] >= 0.99, m
        assert c["qualityMarks"] >= 53, c
        assert rep["titleEarned"] is True

    def test_primary_lower_reattempt(self):
        if "first" not in STATE:
            pytest.skip("first attempt not done")
        s = script_login(NEW_EMAIL)
        r = start(s, "primary")
        assert r.status_code == 200, r.text
        a = r.json()
        r = submit(s, a)
        assert r.status_code == 200, r.text
        rep = report(s, a["id"]).json()
        print("PRIMARY LOWER", a["id"], rep["score"], rep["best"], rep["titleEarned"], rep["roundCredits"])
        assert rep["titleEarned"] is True and rep["score"] < rep["best"]


# Sahayika knowledge: no stale weights
class TestKnowledge:
    def test_no_stale_weights(self):
        txt = open("/app/content/sahayika.script.json", encoding="utf-8").read()
        for stale in ["Five measures", "five measures", "five stats", "पाँच मानक"]:
            assert stale not in txt, stale

    def test_chat_faq_how_scored(self):
        s = script_login(CR6)
        r = s.post(f"{BASE_URL}/api/sahayika/chat", json={"question": "How am I scored?"}, timeout=60)
        assert r.status_code == 200
        assert "Five measures" not in r.json()["en"], r.json()["en"]


# Held re-attempt: Sahayika announce must not claim new credits
class TestHeldAnnounce:
    def test_held_announce_no_credit_claim(self):
        s = script_login(CR6)
        low = report(s, CR6_LOWER).json()
        texts = " ".join(l.get("en", "") for l in low["announce"])
        assert "more credits are yours" not in texts, texts
