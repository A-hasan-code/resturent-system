# Hotel System

Offline restaurant/hotel POS for Pakistan (kg-based menu, store stock, kitchen + customer bills).

## Client (non-technical) — Demo installer

### A) Full project + installer (includes source)

1. Give the client the **full project folder** (USB / zip).
2. They open `installer\` and double-click **`HotelSystem-Setup.exe`**.
3. Allow Administrator → Docker + app start → http://localhost:3000

### B) Client pack — **NO source code** (recommended)

**You build a versioned ZIP once:**

1. Set version in root file `VERSION` (e.g. `1.0.0` or `1.0.1`)
2. Run:

```powershell
cd packaging
powershell -ExecutionPolicy Bypass -File .\Build-ClientPack.ps1
```

3. **Send client only this file:**  
   `releases\HotelSystem-v1.0.0.zip`  
   (name follows VERSION)

**Client:** extract ZIP → open folder → `HotelSystem-Setup.exe`

Details: `packaging/client/README.txt`

### Demo logins

| User | Password | Role |
|------|----------|------|
| admin | admin123 | All |
| cashier | cashier123 | Orders + bills |
| kitchen | kitchen123 | Kitchen |
| store | store123 | Store stock |

## Developer

```bash
cp .env.example .env
cd apps/api && npm install && npx prisma generate
cd ../web && npm install
# Postgres:
cd ../../docker && docker compose up -d postgres
cd ../apps/api && npx prisma migrate deploy && npm run db:seed
npm run dev   # NestJS API :4000
# other terminal:
cd apps/web && npm run dev
```

**Backend:** NestJS (TypeScript) + Prisma + PostgreSQL  
**Frontend:** React (web; desktop wrapper later)  
**Client start:** `scripts/Start Hotel System.bat` (Docker one-click)
