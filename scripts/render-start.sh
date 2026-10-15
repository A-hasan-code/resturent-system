#!/usr/bin/env bash
# Start API (serves built web UI). Migrate (+ optional seed) then listen.
set -euo pipefail

cd "$(dirname "$0")/../apps/api"

export NODE_ENV="${NODE_ENV:-production}"
export DISCOVERY_DISABLED="${DISCOVERY_DISABLED:-1}"
export WEB_DIST="${WEB_DIST:-../web/dist}"
export HOTEL_DATA_DIR="${HOTEL_DATA_DIR:-/var/data}"

mkdir -p "$HOTEL_DATA_DIR"

echo "Applying Prisma migrations…"
pnpm exec prisma migrate deploy --schema=prisma/schema.prisma

if [ "${HOTEL_SEED_ON_BOOT:-0}" = "1" ]; then
  echo "HOTEL_SEED_ON_BOOT=1 — running prisma seed (demo users/menu)…"
  pnpm exec tsx prisma/seed.ts
fi

echo "Starting Hotel System on PORT=${PORT:-10000}…"
exec node dist/main.js
