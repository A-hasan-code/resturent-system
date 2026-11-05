#!/usr/bin/env bash
# Ensure DIRECT_DATABASE_URL for Prisma Migrate (Neon pooler cannot run migrations).
# Source from render-build.sh / render-start.sh:  source "$(dirname "$0")/neon-direct-url.sh"

if [ -z "${DATABASE_URL:-}" ]; then
  echo "WARNING: DATABASE_URL is not set" >&2
else
  if [ -z "${DIRECT_DATABASE_URL:-}" ]; then
    if [[ "$DATABASE_URL" == *"-pooler."* ]]; then
      export DIRECT_DATABASE_URL="${DATABASE_URL/-pooler./.}"
      echo "Derived DIRECT_DATABASE_URL from Neon pooler host (migrations need direct TCP)"
    else
      export DIRECT_DATABASE_URL="$DATABASE_URL"
    fi
  fi
fi
