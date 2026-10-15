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
