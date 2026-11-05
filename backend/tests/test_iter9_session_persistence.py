# Iteration 9: session persistence (cookie Max-Age, sliding renewal not re-issued on fresh cookie, logout), admin regression, health
import os, random, re, subprocess
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
EMAIL = "qa.p1s01@gmail.com"
MANAGER = "bhattastha.dibd@gmail.com"


def plant(email):
    code = "%06d" % random.randint(0, 999999)
    subprocess.run(["/app/scripts/emergent/test-otp.sh", email, code], check=True, capture_output=True)
    return code


def login(email):
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/otp/verify", json={"email": email, "code": plant(email)}, timeout=30)
    assert r.status_code == 200, r.text
    return s, r


@pytest.fixture(scope="module")
def player():
    s, r = login(EMAIL)
    if r.json().get("status") == "new":
        office = requests.get(f"{BASE_URL}/api/offices", params={"q": "delhi"}, timeout=30).json()[0]
        r2 = s.post(f"{BASE_URL}/api/players/register", json={"name": "QA Session 01", "mobile": "9500000001",
                    "officeId": office["id"], "officeAddress": "Indraprastha Estate, New Delhi 110002"}, timeout=30)
        assert r2.status_code == 200, r2.text
    return s, r


# Health
def test_health():
    r = requests.get(f"{BASE_URL}/api/health", timeout=30)
    assert r.status_code == 200
    assert r.json().get("status") == "healthy"


# Session cookie Max-Age on login
def test_login_cookie_max_age(player):
    _, r = player
    sc = r.headers.get("set-cookie", "")
    assert "hc_session=" in sc
    m = re.search(r"Max-Age=(\d+)", sc, re.I)
    assert m and int(m.group(1)) == 43200, sc
    assert "HttpOnly" in sc


def test_progress_registered(player):
    s, _ = player
    r = s.get(f"{BASE_URL}/api/me/progress", timeout=30)
    assert r.status_code == 200
    assert r.json()["registered"] is True


# Fresh cookie must not be re-issued (sliding renewal only below half lifetime)
def test_fresh_cookie_not_reissued(player):
    s, _ = player
    for path in ("/api/me/progress", "/api/me/profile", "/api/config"):
        r = s.get(f"{BASE_URL}{path}", timeout=30)
        assert "hc_session" not in r.headers.get("set-cookie", ""), (path, r.headers.get("set-cookie"))


# Logout clears cookie; then signed out
def test_logout_clears_session():
    s, _ = login(EMAIL)
    assert s.get(f"{BASE_URL}/api/me/progress", timeout=30).json()["registered"] is True
    r = s.post(f"{BASE_URL}/api/auth/logout", json={}, timeout=30)
    assert r.status_code == 200
    sc = r.headers.get("set-cookie", "")
    assert "hc_session=" in sc and ("Max-Age=0" in sc or "1970" in sc), sc
    p = s.get(f"{BASE_URL}/api/me/progress", timeout=30).json()
    assert p["registered"] is False


def test_garbage_cookie_signed_out():
    r = requests.get(f"{BASE_URL}/api/me/progress", cookies={"hc_session": "garbage.token.x"}, timeout=30)
    assert r.status_code == 200 and r.json()["registered"] is False


# Admin regression
@pytest.mark.parametrize("path", ["/api/admin/dashboard", "/api/admin/pages", "/api/admin/glossary", "/api/admin/offices"])
def test_admin_anonymous_denied(path):
    r = requests.get(f"{BASE_URL}{path}", timeout=30)
    assert r.status_code in (401, 403), (path, r.status_code)
    if r.status_code != 404:
        assert r.json().get("error")


def test_manager_login():
    s, r = login(MANAGER)
    sc = r.headers.get("set-cookie", "")
    assert "Max-Age=43200" in sc
    p = s.get(f"{BASE_URL}/api/me/progress", timeout=30).json()
    assert p.get("role") == "manager", p
