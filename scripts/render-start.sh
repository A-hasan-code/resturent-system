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
# SchemaHeal also migrates on boot; skip the duplicate pass there to bind sooner.
export HOTEL_SKIP_SCHEMA_HEAL="${HOTEL_SKIP_SCHEMA_HEAL:-1}"

# Persistent disk (/var/data) is optional — Neon-only deploys often have no disk mount.
# Fall back to a writable temp dir so mkdir never kills the boot.
preferred="${HOTEL_DATA_DIR:-/var/data}"
if mkdir -p "$preferred" 2>/dev/null; then
  export HOTEL_DATA_DIR="$preferred"
else
  fallback="${TMPDIR:-/tmp}/hotel-data"
  mkdir -p "$fallback"
  export HOTEL_DATA_DIR="$fallback"
  echo "HOTEL_DATA_DIR=$preferred not writable — using $HOTEL_DATA_DIR (ephemeral; OK with Neon/external DB)"
fi

echo "Applying Prisma migrations (directUrl=${DIRECT_DATABASE_URL%%@*}@…)…"
pnpm exec prisma migrate deploy --schema=prisma/schema.prisma

if [ "${HOTEL_SEED_ON_BOOT:-0}" = "1" ]; then
  echo "HOTEL_SEED_ON_BOOT=1 — running prisma seed (demo users/menu/kitchen transfer)…"
  echo "Tip: set HOTEL_SEED_ON_BOOT=0 after the first successful boot (faster restarts)."
  pnpm exec tsx prisma/seed.ts
fi

echo "Starting Hotel System on PORT=${PORT:-10000} (WEB_DIST=$WEB_DIST HOTEL_DATA_DIR=$HOTEL_DATA_DIR)…"
exec node dist/main.js
