# Deploy on Render

Single **Web Service** + **Postgres**. The API serves the built React app (same origin `/api`).

## 1. One-click Blueprint

1. Open [https://dashboard.render.com](https://dashboard.render.com) → **New** → **Blueprint**
2. Connect GitHub repo `A-hasan-code/resturent-system`
3. Select branch `improve-the-system` (or the branch that has `render.yaml`)
4. Apply the Blueprint — Render creates:
   - Postgres `hotel-db`
   - Web service `hotel-system`
   - Env vars (including `DATABASE_URL`, generated `JWT_SECRET`, seed flag)

## 2. Env vars (already in `render.yaml`)

| Variable | Source |
|----------|--------|
| `DATABASE_URL` | From `hotel-db` connection string |
| `JWT_SECRET` | Auto-generated |
| `NODE_ENV` | `production` |
| `DISCOVERY_DISABLED` | `1` (no LAN/mDNS on cloud) |
| `HOTEL_DATA_DIR` | `/var/data` (persistent disk) |
| `WEB_DIST` | `../web/dist` |
| `HOTEL_SEED_ON_BOOT` | `1` first time — **set to `0` after first successful login** |
| `TZ` | `Asia/Karachi` |

You do not need to paste secrets manually when using the Blueprint.

## 3. After first deploy

1. Open `https://hotel-system-….onrender.com`
2. Login (seeded):
   - Admin: `admin` / `admin123`
   - Supervisor: `supervisor` / `super123`
   - Cashier: `cashier` / `cashier123`
3. In Render → service → **Environment** → set `HOTEL_SEED_ON_BOOT` = `0` → **Save** (avoids re-seeding every restart)

## 4. Notes

- **Plans:** Blueprint uses paid starter DB/web (`basic-256mb` / `starter`). Free Postgres is no longer available on Render.
- **Printing / LAN tablets:** Cloud URL works in the browser. USB/Windows printers and LAN discovery need the Main-PC Windows install — cloud is for remote demo / admin access.
- **Migrations:** Applied automatically on API boot (`SchemaHeal`).
- **Health check:** `GET /api/health`
- **Redeploy:** Push to the connected branch; `autoDeploy: true`.

## 5. Stuck on “Connecting to server…”

The web UI only continues after `GET /api/health` succeeds. On Render that must be **same origin** (your `*.onrender.com` URL). If health fails once, older builds started a **LAN subnet scan**, which never finds a cloud server — the overlay spins forever.

**Check in order:**

1. Render → **Logs**: service should end with `PixalBotics Restaurant on http://0.0.0.0:…`. If it restarts in a loop, migrate/seed or `DATABASE_URL` is failing.
2. Open `https://YOUR-SERVICE.onrender.com/api/health` — expect JSON with `"app":"hotel-system"`. If this 502/spinning, the process is not up yet (cold start / crash).
3. After first successful login, set `HOTEL_SEED_ON_BOOT=0` and redeploy — seed on every boot delays listen and can trip health checks.
4. Dashboard → service → **Health Check** grace period: raise to **60–120s** so migrate+seed can finish before Render marks the deploy unhealthy.
5. Hard-refresh or clear site data for that URL (stale `hotel.serverOrigin` from local LAN testing).
6. Branch: Blueprint deploys `improve-the-system`. Deploying another branch without the Render scripts will not boot correctly.

**Android / desktop apps** cannot auto-discover a Render URL (UDP/mDNS is LAN-only). Use the browser on the Render link, or enter the HTTPS address manually.
