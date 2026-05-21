#!/usr/bin/env bash
# Production smoke checks for https://app.c-point.co (cpoint-app).
# Exits non-zero on failure — suitable for CI / post-deploy.
#
# Usage (repo root):
#   bash scripts/smoke_prod.sh

set -euo pipefail

BASE_URL="${PROD_BASE_URL:-https://app.c-point.co}"
FAIL=0

pass() { echo "[PASS] $*"; }
fail() { echo "[FAIL] $*"; FAIL=1; }

echo "Production smoke: ${BASE_URL}"

# 1) Health (no DB)
if curl -fsS -m 20 "${BASE_URL}/health" | grep -q '"status"[[:space:]]*:[[:space:]]*"healthy"'; then
  pass "/health"
else
  fail "/health — expected healthy JSON"
fi

# 2) DB-backed public route
WC_BODY="$(curl -fsS -m 20 "${BASE_URL}/welcome_cards" || true)"
if echo "${WC_BODY}" | grep -q '"success"[[:space:]]*:[[:space:]]*true'; then
  pass "/welcome_cards (MySQL reachable)"
else
  fail "/welcome_cards — expected success:true (got: ${WC_BODY:0:200})"
  echo "  → Likely missing MYSQL_PASSWORD on cpoint-app. See docs/PROD_CLOUD_RUN_RECOVERY.md"
fi

# 3) Invitation verify uses DB (invalid token → 404, not 500)
INV_STATUS="$(curl -sS -m 20 -o /tmp/inv.json -w '%{http_code}' "${BASE_URL}/api/invitation/verify?token=smoke-invalid-token" || echo 000)"
INV_BODY="$(cat /tmp/inv.json 2>/dev/null || true)"
if [[ "${INV_STATUS}" == "404" ]] || echo "${INV_BODY}" | grep -q 'Invalid invitation'; then
  pass "/api/invitation/verify (DB query works)"
elif [[ "${INV_STATUS}" == "500" ]] || echo "${INV_BODY}" | grep -q 'Server error'; then
  fail "/api/invitation/verify — server error (DB/env)"
else
  fail "/api/invitation/verify — unexpected status=${INV_STATUS} body=${INV_BODY:0:120}"
fi

# 4) Session cookie shape on login step 1 (host-only, no Domain= when CANONICAL_HOST=app.c-point.co)
HDR_FILE="$(mktemp)"
curl -sS -m 20 -D "${HDR_FILE}" -o /dev/null -X POST "${BASE_URL}/login" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "username=__smoke_nonexistent_user__" || true
if grep -qi 'set-cookie:.*cpoint_session' "${HDR_FILE}"; then
  if grep -qi 'set-cookie:.*Domain=app\.c-point\.co' "${HDR_FILE}"; then
    fail "login Set-Cookie — invalid Domain=app.c-point.co"
  else
    pass "login issues Set-Cookie (session pipeline alive)"
  fi
else
  fail "login — no cpoint_session Set-Cookie"
fi
rm -f "${HDR_FILE}"

echo ""
if [[ "${FAIL}" -eq 0 ]]; then
  echo "All production smoke checks passed."
  exit 0
fi
echo "One or more checks failed. See docs/PROD_CLOUD_RUN_RECOVERY.md"
exit 1
