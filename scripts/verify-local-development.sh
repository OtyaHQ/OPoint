#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
WRANGLER_VERSION="4.158.0"
PORT="8787"
BASE_URL="http://127.0.0.1:${PORT}"
LOG_FILE="$(mktemp)"
WORKER_PID=""

cleanup() {
  if [[ -n "$WORKER_PID" ]]; then
    kill "$WORKER_PID" >/dev/null 2>&1 || true
    wait "$WORKER_PID" >/dev/null 2>&1 || true
  fi
  rm -f "$LOG_FILE"
}
trap cleanup EXIT

node scripts/check-local-development.mjs
npx --yes "wrangler@${WRANGLER_VERSION}" d1 migrations apply DB --local --config wrangler.local.toml
npx --yes "wrangler@${WRANGLER_VERSION}" d1 execute DB --local --config wrangler.local.toml --file=cloudflare-api/dev/seed-local-owner.sql

npx --yes "wrangler@${WRANGLER_VERSION}" dev --local \
  --config wrangler.local.toml \
  --config wrangler.auth-local.toml \
  --ip 127.0.0.1 \
  --port "$PORT" >"$LOG_FILE" 2>&1 &
WORKER_PID=$!

ready=0
for attempt in $(seq 1 40); do
  if curl --silent --fail --connect-timeout 1 "$BASE_URL/health" >/tmp/otyapoint-local-health.json 2>/dev/null; then
    ready=1
    break
  fi
  sleep 1
done

if [[ "$ready" != "1" ]]; then
  cat "$LOG_FILE"
  echo "Local OtyaPoint Worker did not become ready." >&2
  exit 1
fi

python3 - <<'PY'
import json
from pathlib import Path
data = json.loads(Path('/tmp/otyapoint-local-health.json').read_text())
assert data.get('service') == 'omnipoint-api', data
assert data.get('status') == 'ok', data
assert data.get('schemaReady') is True, data
print('PASS: local D1 migrations and OtyaPoint schema readiness')
PY

me_status="$(curl --silent --show-error --output /tmp/otyapoint-local-me.json --write-out '%{http_code}' \
  --connect-timeout 3 --max-time 10 \
  -H 'Authorization: Bearer otya-local-test-token' "$BASE_URL/api/me")"
test "$me_status" = "200" || {
  cat /tmp/otyapoint-local-me.json
  cat "$LOG_FILE"
  echo "Local synthetic identity verification failed with HTTP $me_status." >&2
  exit 1
}
python3 - <<'PY'
import json
from pathlib import Path
data = json.loads(Path('/tmp/otyapoint-local-me.json').read_text())
profile = data.get('data') or {}
assert profile.get('identitySubject') == 'synthetic-otyapoint-local-owner', data
assert profile.get('companyId') == 'local-company', data
assert profile.get('role') == 'SOVEREIGN', data
print('PASS: API -> synthetic local Auth -> local staff-membership authorization')
PY

agency_status="$(curl --silent --show-error --output /tmp/otyapoint-local-agency.json --write-out '%{http_code}' \
  --connect-timeout 3 --max-time 10 \
  -X POST -H 'Authorization: Bearer otya-local-test-token' \
  -H 'Content-Type: application/json' --data '{}' \
  "$BASE_URL/api/agency-transactions")"
test "$agency_status" = "501" || {
  cat /tmp/otyapoint-local-agency.json
  cat "$LOG_FILE"
  echo "Provider write path must remain disabled (expected HTTP 501, got $agency_status)." >&2
  exit 1
}
python3 - <<'PY'
import json
from pathlib import Path
data = json.loads(Path('/tmp/otyapoint-local-agency.json').read_text())
assert data.get('error') == 'provider_adapter_required', data
assert 'No provider call was made' in data.get('detail', ''), data
print('PASS: agency payment write path remains fail-closed; no provider call is made')
PY

echo "Local OtyaPoint development verification passed. No remote Cloudflare resources were used."
