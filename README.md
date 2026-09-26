# Hotel System

Offline restaurant/hotel POS for Pakistan (kg-based menu, store stock, kitchen + customer bills).

## Client (non-technical) — Demo installer

1. Give the client the **full project folder** (USB / zip).
2. They open `installer\` and double-click **`HotelSystem-Setup.exe`**  
   (or `Setup Hotel System.bat`).
3. Allow Administrator → wait. Installer will:
   - Install/start **Docker Desktop** if missing
   - Create Docker **network** + database + API + web
   - Put **Start / Stop Hotel System** on the Desktop
   - Open http://localhost:3000
4. If Docker was installed the first time → **reboot once**, then use Desktop **Start Hotel System**.

Build the `.exe` launcher (on your PC once):

```powershell
cd installer
powershell -ExecutionPolicy Bypass -File .\Build-SetupExe.ps1
```

Details: `installer/DEMO-INSTALL.txt`

Stop: Desktop **Stop Hotel System** (or `scripts/Stop Hotel System.bat`)

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
