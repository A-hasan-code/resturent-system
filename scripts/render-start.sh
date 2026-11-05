#!/usr/bin/env bash
# Start API (serves built web UI). Migrate (+ optional seed) then listen.
# Important: nothing binds PORT until the final `node` line. Keep migrate/seed
# short, or raise Render's health-check grace period — otherwise the UI sticks
# on "Connecting to server…" while /api/health is unreachable.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=neon-direct-url.sh
source "$ROOT/scripts/neon-direct-url.sh"

cd "$ROOT/apps/api"

export NODE_ENV="${NODE_ENV:-production}"
export DISCOVERY_DISABLED="${DISCOVERY_DISABLED:-1}"
export WEB_DIST="${WEB_DIST:-../web/dist}"
export HOTEL_DATA_DIR="${HOTEL_DATA_DIR:-/var/data}"
# SchemaHeal also migrates on boot; skip the duplicate pass there to bind sooner.
export HOTEL_SKIP_SCHEMA_HEAL="${HOTEL_SKIP_SCHEMA_HEAL:-1}"

mkdir -p "$HOTEL_DATA_DIR"

echo "Applying Prisma migrations (directUrl=${DIRECT_DATABASE_URL%%@*}@…)…"
pnpm exec prisma migrate deploy --schema=prisma/schema.prisma

if [ "${HOTEL_SEED_ON_BOOT:-0}" = "1" ]; then
  echo "HOTEL_SEED_ON_BOOT=1 — running prisma seed (demo users/menu/kitchen transfer)…"
  echo "Tip: set HOTEL_SEED_ON_BOOT=0 after the first successful boot (faster restarts)."
  pnpm exec tsx prisma/seed.ts
fi

echo "Starting Hotel System on PORT=${PORT:-10000} (WEB_DIST=$WEB_DIST)…"
exec node dist/main.js
