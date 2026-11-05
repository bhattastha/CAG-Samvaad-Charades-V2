# Iter 9 setup: register qa.p1s02..p1s04 (new players for session tests), then plant fresh OTPs for browser login; prints codes
import os, random, subprocess, sys, requests
B = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
def plant(e):
    c = "%06d" % random.randint(0, 999999)
    subprocess.run(["/app/scripts/emergent/test-otp.sh", e, c], check=True, capture_output=True); return c
office = requests.get(B + "/api/offices", params={"q": "delhi"}).json()[0]
for e in sys.argv[1:]:
    s = requests.Session(); r = s.post(B + "/api/auth/otp/verify", json={"email": e, "code": plant(e)})
    if r.json().get("status") == "new":
        n = int(e[6:8])
        r2 = s.post(B + "/api/players/register", json={"name": f"QA Session {n:02d}", "mobile": f"95000000{n:02d}", "officeId": office["id"], "officeAddress": "Indraprastha Estate, New Delhi 110002"})
        print("registered", e, r2.status_code)
    print(e, "progress", s.get(B + "/api/me/progress").json().get("registered"), "browser code", plant(e))
