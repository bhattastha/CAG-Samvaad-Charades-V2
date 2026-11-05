# Test credentials (preview)
- Email OTP only (NODE_ENV=production; dev code 123456 is rejected).
- Sign-in is restricted to @cag.gov.in plus OTP_ALLOWLIST (bhattastha1520@gmail.com, asthabhatt152000@gmail.com) and ADMIN_EMAILS. Any other domain → 403 email_domain.
- Manager: bhattastha.dibd@gmail.com (ADMIN_EMAILS in /app/backend/.env).
- QA: plant a code with `/app/scripts/emergent/test-otp.sh <email> <6-digit code>`, then verify via UI or POST /api/auth/otp/verify (skip /otp/request: it overwrites the code and, until EMAIL_RELAY_API_KEY is set, fails for @cag.gov.in with server_error).
- Test players: use new @cag.gov.in addresses, e.g. qa.cr1@cag.gov.in (register after verify). Older players qa.tester1@cag.gov.in exists; gmail QA players (qa.tester2@gmail.com, qa.load*) can no longer sign in.
