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
# Neon cold-start + Render redeploys: Prisma's 10s advisory-lock wait is too short.
# Single web service start is already serialized; skip the lock to avoid P1002 flakes.
export PRISMA_SCHEMA_DISABLE_ADVISORY_LOCK="${PRISMA_SCHEMA_DISABLE_ADVISORY_LOCK:-1}"

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

wake_neon() {
  echo "Waking database (Neon cold start)…"
  local i
  for i in 1 2 3 4 5 6; do
    if printf 'SELECT 1;\n' | pnpm exec prisma db execute --stdin --schema=prisma/schema.prisma >/dev/null 2>&1; then
      echo "Database is reachable"
      return 0
    fi
    echo "DB not ready yet (attempt $i/6) — waiting…"
    sleep $((i * 2))
  done
  echo "WARNING: DB wake probe failed — continuing to migrate anyway"
  return 0
}

migrate_with_retry() {
  local attempt=1
  local max=6
  local log
  while [ "$attempt" -le "$max" ]; do
    echo "Applying Prisma migrations (attempt $attempt/$max)…"
    if log="$(pnpm exec prisma migrate deploy --schema=prisma/schema.prisma 2>&1)"; then
      echo "$log" | tail -n 20
      echo "migrate deploy OK"
      return 0
    fi
    echo "$log" | tail -n 30
    if echo "$log" | grep -qiE 'P1002|advisory lock|timed out'; then
      echo "P1002 / advisory lock timeout — retrying after backoff…"
      sleep $((attempt * 5))
      attempt=$((attempt + 1))
      continue
    fi
    echo "migrate deploy failed (non-retryable)"
    return 1
  done
  echo "migrate deploy failed after $max attempts"
  return 1
}

wake_neon
migrate_with_retry

if [ "${HOTEL_SEED_ON_BOOT:-0}" = "1" ]; then
  echo "HOTEL_SEED_ON_BOOT=1 — running prisma seed (demo users/menu/kitchen transfer)…"
  echo "Tip: set HOTEL_SEED_ON_BOOT=0 after the first successful boot (faster restarts)."
  pnpm exec tsx prisma/seed.ts
fi

echo "Starting Hotel System on PORT=${PORT:-10000} (WEB_DIST=$WEB_DIST HOTEL_DATA_DIR=$HOTEL_DATA_DIR)…"
exec node dist/main.js
