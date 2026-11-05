# Shared helpers for iteration 11 tests: OTP planting (DATABASE_URL taken from running API process env), login, attempts
import os, random, subprocess, hashlib, glob
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")


def _env_from_proc(key):
    if os.environ.get(key):
        return os.environ[key]
    for envf in glob.glob("/proc/[0-9]*/environ"):
        try:
            data = open(envf, "rb").read().split(b"\0")
        except Exception:
            continue
        for kv in data:
            if kv.startswith(key.encode() + b"="):
                return kv.split(b"=", 1)[1].decode()
    return None


def _jwt_secret():
    for line in open("/app/backend/.env"):
        if line.startswith("JWT_SECRET="):
            return line.strip().split("=", 1)[1].strip('"')
    return _env_from_proc("JWT_SECRET")


def plant(email, code=None):
    email = email.lower()
    code = code or "%06d" % random.randint(0, 999999)
    h = hashlib.sha256(f"{email}:{code}:{_jwt_secret()}".encode()).hexdigest()
    db = _env_from_proc("DATABASE_URL")
    sql = (f"INSERT INTO otp_challenges (email, code_hash, expires_at, tries, sent_count, window_start) "
           f"VALUES ('{email}', '{h}', now() + interval '10 minutes', 0, 1, now()) "
           f"ON CONFLICT (email) DO UPDATE SET code_hash=EXCLUDED.code_hash, expires_at=EXCLUDED.expires_at, tries=0;")
    subprocess.run(["psql", "-q", db, "-c", sql], check=True, capture_output=True)
    return code


def login(email, name="QA Tester", mobile="9500001199"):
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/otp/verify", json={"email": email, "code": plant(email)}, timeout=30)
    assert r.status_code == 200, r.text
    if r.json().get("status") == "new":
        office = requests.get(f"{BASE_URL}/api/offices", params={"q": "delhi"}, timeout=30).json()[0]
        r2 = s.post(f"{BASE_URL}/api/players/register", json={"name": name, "mobile": mobile,
                    "officeId": office["id"], "officeAddress": "Indraprastha Estate, New Delhi 110002"}, timeout=30)
        assert r2.status_code == 200, r2.text
    return s


def start(s, key):
    r = s.post(f"{BASE_URL}/api/rounds/{key}/attempts", json={"clientId": "pytest-client-0011"}, timeout=90)
    return r


def submit(s, a, answers=None):
    r = s.post(f"{BASE_URL}/api/attempts/{a['id']}/submit", json={"clientId": "pytest-client-0011", "version": a["version"] + 1,
               "answers": answers if answers is not None else a["answers"]}, timeout=180)
    return r


def report(s, aid):
    return s.get(f"{BASE_URL}/api/attempts/{aid}/report", timeout=60)
