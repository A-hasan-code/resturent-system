# Hotel System

Offline restaurant POS for a single site: table orders from waiter tablets, kitchen slips, billing, store stock and recipes. It runs entirely on the restaurant's LAN. No internet, no cloud, no Docker.

- **Server:** one Windows PC (usually the cashier counter) runs the database and API as Windows services.
- **Clients:**
  - the Windows desktop app (Electron), which finds the server automatically
  - the Android app (APK, downloaded from the server by QR code), which finds the server automatically
  - any tablet or phone browser, installable as a PWA
- **Staff:** every user has their own login (username + password, or a quick PIN on shared tablets). The name of whoever took an order is printed at the bottom of its kitchen slip.
- **Printing:** every print request goes to the server, which prints on its USB printer or a network printer. Tablets need no drivers. Managers and cashiers can preview a kitchen slip on screen before printing it.

How devices find each other, and what happens when the server's IP changes: **[docs/NETWORKING.md](docs/NETWORKING.md)**.  
Industrial layout (main server + counter network printers): **[docs/INDUSTRIAL-SETUP.md](docs/INDUSTRIAL-SETUP.md)**.

## Repository layout

```
apps/
  api/        NestJS + Prisma (PostgreSQL). REST /api, Socket.IO, LAN discovery, print queue, backups
  web/        React + Vite. Used by browsers, tablets (PWA), the desktop app and the Android app
  desktop/    Electron shell with network discovery (UDP beacon, mDNS, subnet scan)
  mobile/     Capacitor Android app: bundles apps/web/dist + a native UDP discovery plugin
packaging/
  windows/    Offline installer: Build-Release.ps1, install.ps1, uninstall.ps1, HotelSystem.iss
  android/    Build-Apk.ps1 (+ the git-ignored release signing key)
  cache/      Downloaded Node / PostgreSQL / WinSW binaries (git-ignored)
scripts/
  dev-db.ps1      Local development PostgreSQL (portable, no Docker)
  smoke-test.ps1  End-to-end test against a running server
docs/
  NETWORKING.md
VERSION       Release version used by the installer and the server
```

## Development

Requirements: Windows 10/11, Node.js 20+, pnpm 9 (`corepack enable`).

```powershell
pnpm bootstrap   # install deps, start local PostgreSQL, migrate, seed demo data
pnpm dev         # API on :4000 + web on :3000 (watch mode)
```

Open http://localhost:3000. Tablets on the same Wi-Fi can use `http://<this-pc-ip>:3000`.

`pnpm db:start` downloads portable PostgreSQL 16 into `packaging/cache` on first use. It runs on `localhost:5544` with its data in `.dev/pgdata`. Nothing is installed system-wide, and it does not clash with other PostgreSQL instances on 5432/5433. Config comes from `apps/api/.env`, which is created from `apps/api/.env.example`.

| Command | Purpose |
|---------|---------|
| `pnpm dev` | API + web in watch mode |
| `pnpm dev:desktop` | Desktop app against the running dev server |
| `pnpm db:start` / `db:stop` / `db:status` | Local PostgreSQL |
| `pnpm db:reset` | Delete local data and start fresh (then `pnpm db:deploy && pnpm db:seed`) |
| `pnpm db:migrate` | Create a new migration after editing `schema.prisma` |
| `pnpm db:deploy` / `db:seed` | Apply migrations / seed (seed is safe to re-run) |
| `pnpm typecheck` | TypeScript checks for API and web |
| `pnpm smoke` | End-to-end test: waiter order, kitchen slip, bill, payment, backup |
| `pnpm build` | Production build of API + web |
| `pnpm apk` | Build the signed Android app into `releases/android/` (see below) |
| `pnpm release` | Build the Windows installer, including the Android app (see below) |

### Demo users (seed)

| User | Password | PIN | Role |
|------|----------|-----|------|
| admin | admin123 | — | Everything |
| manager | manager123 | 2222 | Everything except server settings and backups; takes orders, manages staff |
| cashier | cashier123 | — | Orders, bills, payments |
| waiter | waiter123 | 1111 | Table orders, kitchen slips, request bill |
| waiter2 | waiter123 | 1112 | Same as waiter (second waiter for testing "Order by") |
| kitchen | kitchen123 | — | Kitchen display |
| store | store123 | — | Store stock |

The seed only creates users that do not exist yet, so PINs appear only on a fresh database. On a real installation, create real staff under **Users**, then disable the demo accounts. The quick demo-account buttons on the login page are shown in development builds only.

### Users and roles

- **Users page** (admins and managers): add staff, set role, password and optional PIN, disable accounts. Users are never deleted, so old orders keep their names. Only an admin can create or edit admin accounts, and the last active admin cannot be disabled.
- **PIN login:** staff who have a PIN are listed on the login screen; tap the name and type the PIN. Five wrong attempts lock that account on that device for a minute.
- **My account** (sidebar): everyone can change their own password and set their own PIN.
- Role and permission changes, and disabling an account, take effect on the next request; nobody has to log out.

### Kitchen slips: "Order by" and preview

Every round of items records who added it. The kitchen slip ends with `Order by: <name> (<role>)`, so a waiter, cashier or manager can each be identified. With **Preview kitchen slip before printing** ticked (default for everyone except waiters), sending an order shows the exact slip on screen with *Print kitchen slip* / *Done without printing*. The order reaches the kitchen screen either way.

## Android app

```powershell
pnpm apk
```

Builds `releases/android/hotel-system.apk`: the same web UI bundled into a Capacitor app, plus a native plugin that listens for the server's UDP beacon. It finds the server without anyone typing an IP address, and finds it again when the server's IP changes. See [docs/NETWORKING.md](docs/NETWORKING.md#android-app).

- **Build requirements:** Android Studio (for its JDK 21 and the Android SDK). The script finds both in their default locations, or set `JAVA_HOME` / `ANDROID_HOME`.
- **Signing key:** the first run creates `packaging/android/hotel-release.jks` + `keystore.properties` (git-ignored). **Back them up privately.** Android refuses to update an installed app signed with a different key.
- **Distribution:** `pnpm release` puts the APK into the installer. The server then offers it at `http://<server>:3000/downloads/hotel-system.apk`, and *Settings* shows a QR code for it. In development the API serves `releases/android` (`DOWNLOADS_DIR` in `apps/api/.env`).
- Open the native project in Android Studio with `pnpm --filter @hotel/mobile open`.

## Release (Windows installer)

```powershell
pnpm release
```

Produces `releases/HotelSystem-Setup-<VERSION>.exe`, a single offline installer that bundles:

- **Node.js 22:** the server runtime
- **PostgreSQL 16:** listens on localhost only
- **WinSW:** runs the server as a Windows service
- **the server, web app and desktop app**
- **the Android app**, served to tablets at `/downloads/hotel-system.apk`

You need Inno Setup 6 to build it (`winget install JRSoftware.InnoSetup`), plus Android Studio for the APK. Pass `-SkipAndroid` to `packaging/windows/Build-Release.ps1` to build without it. Bump the version in `VERSION` before building.

### Code signing (required for customer PCs)

Unsigned Setup files are blocked by Windows 11 **Smart App Control** (Error 4551). Professional releases must be **Authenticode-signed** with a certificate from a CA in the Microsoft Trusted Root Program (Azure Trusted Signing, DigiCert, Sectigo, …).

1. Copy `packaging/windows/signing.env.example` → `signing.env` and fill one method  
2. Install Windows SDK Signing Tools (`signtool.exe`)  
3. Build with signing enforced:

```powershell
.\packaging\windows\Build-Release.ps1 -RequireSign
```

Full guide: **[docs/CODE-SIGNING.md](docs/CODE-SIGNING.md)**.

The installer offers two choices:

- **Main PC: server + desktop app.** Install on exactly one PC. It:
  - creates `C:\ProgramData\HotelSystem` (config, database, backups, logs)
  - registers the services **Hotel System Database** and **Hotel System Server**
  - runs migrations and the seed
  - opens the firewall
  - shows the addresses tablets should use
- **Additional PC: desktop app only.** The app finds the server on the network by itself.

Upgrading means running a newer installer over the old one. Data, secrets and ports are kept. Uninstalling asks whether to keep the restaurant data.

## Operations

- **Backups:** manual `pg_dump` (plus a safety copy before restore) in `C:\ProgramData\HotelSystem\backups`. Create and restore under *Settings → Backup*.
- **Logs:** `C:\ProgramData\HotelSystem\logs`
- **Services:** `services.msc` → *Hotel System Server*, *Hotel System Database*
