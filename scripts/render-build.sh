#!/usr/bin/env bash
# Build web + API for a single Render web service (API serves apps/web/dist).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# Prisma schema requires DIRECT_DATABASE_URL even for `prisma generate`.
# shellcheck source=neon-direct-url.sh
source "$ROOT/scripts/neon-direct-url.sh"

corepack enable
corepack prepare pnpm@9.15.0 --activate

pnpm install --frozen-lockfile

# Client types must exist before nest/tsc — generate into the resolved @prisma/client.
pnpm --filter @hotel/api run db:generate

pnpm --filter @hotel/web run build
pnpm --filter @hotel/api run build

echo "Render build OK — web dist: apps/web/dist · api dist: apps/api/dist"
