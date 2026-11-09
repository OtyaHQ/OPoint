#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
WRANGLER_VERSION="4.158.0"

node scripts/check-local-development.mjs

# These commands explicitly use local D1 state. Do not replace --local with --remote.
npx --yes "wrangler@${WRANGLER_VERSION}" d1 migrations apply DB --local --config wrangler.local.toml
npx --yes "wrangler@${WRANGLER_VERSION}" d1 execute DB --local --config wrangler.local.toml --file=cloudflare-api/dev/seed-local-owner.sql

cat <<'NOTICE'
OtyaPoint local development is starting.
- Local API: http://127.0.0.1:8787
- Synthetic test token: otya-local-test-token
- Synthetic identity: owner@local.invalid
- Data: local Wrangler simulations only
- Agency-provider writes: deliberately disabled (HTTP 501)
- No production D1, R2, KV, Queue, Auth, Resend or payment provider is connected.
NOTICE

exec npx --yes "wrangler@${WRANGLER_VERSION}" dev --local \
  --config wrangler.local.toml \
  --config wrangler.auth-local.toml \
  --ip 127.0.0.1 \
  --port 8787
