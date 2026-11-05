#!/usr/bin/env bash
# Ensure DIRECT_DATABASE_URL for Prisma Migrate (Neon pooler cannot run migrations).
# Source from render-build.sh / render-start.sh:  source "$(dirname "$0")/neon-direct-url.sh"

append_connect_timeout() {
  local url="$1"
  case "$url" in
    *connect_timeout=*) echo "$url" ;;
    *\?*) echo "${url}&connect_timeout=30" ;;
    *) echo "${url}?connect_timeout=30" ;;
  esac
}

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
  # Neon cold-start: give the compute time to wake before Prisma gives up.
  export DIRECT_DATABASE_URL="$(append_connect_timeout "$DIRECT_DATABASE_URL")"
  export DATABASE_URL="$(append_connect_timeout "$DATABASE_URL")"
fi
