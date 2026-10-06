# Hotel System v1.4.11 — Release Notes

**Date:** 2026-10-06  
**Targets:** Windows installer + Desktop (Electron) + Android APK + Web/PWA

### v1.4.11
- **Restore harden:** Empty / menu-wiping dumps are **blocked** before swap (users required; live menu protected).
- **Seed safe:** Demo seed no longer deletes or disables restaurant menu items outside the demo catalog.
- **Schema self-heal:** API boot runs migrate deploy with P3009/P3018 recovery (fixes missing-column 500s after drift).
- **Upgrade safety dump:** Installer takes a `pre-upgrade` backup before migrating an existing hotel.
- **Idempotent migrations:** Soft-delete and sell-mode SQL tolerate partial apply / restore.

### v1.4.10
- **Safe restore:** Restore loads the dump into a **temporary** database, runs migrations there, then swaps only after verify. If restore fails, **live data stays unchanged** (no more blank DB / Prisma invalid wipe).
- **Schema upgrades:** Old backups get `migrate deploy` on the temp DB before swap — works across schema changes.
- **API stays up:** Failed restore no longer leaves the live database half-deleted.

### v1.4.9
- **Install fix (P3009):** If a previous update left a failed Prisma migration, Setup now clears/re-applies it so install can finish.
- **Repair script:** `scripts\Repair-Migrations.ps1` on the Main PC if Setup still reports P3009.
- **Firewall:** Desktop firewall rule no longer aborts Setup when it fails.

### v1.4.8
- **Upgrade safety:** Installer seed runs only on a **fresh** database — updates keep existing restaurant data (menu, stock, users, orders).
- **Backup:** Daily auto backup on the server; clearer errors if `pg_dump` / `PG_BIN` is missing.
- **Restore:** Safety pre-backup is best-effort (no longer blocks restore); restore no longer uses a single DB transaction that often failed as “invalid”.

### v1.4.7
- **Hotel open/close:** Admin / System Manager can open or close the hotel from the dashboard; when closed, new orders are blocked and staff see a closed banner.
- **Specials:** Soft-remove pot stays Admin-only after hotel close (open hotel = edit only).
- **Fix:** Connection overlay TypeScript build (offline re-login hint).

### v1.4.6
- **Per head:** Package menu items (search/add in Settings); persons asked first; one “Waiter chooses qty” item; fixed lines name-only in cart; kitchen slip section **PER HEAD ITEMS**.
- **Specials:** Soft-remove pot only by Admin after hotel close; open hotel = edit only (no delete).
- **Build:** API deactivate route `POST /specials/products/:id/deactivate`.

### v1.4.5
- **Billing:** Reverse payment no longer prints a kitchen cancel slip (payment void + stock restore only).
- **Daily Specials:** Cooked pot batches, remaining plates / Rs limits on waiter floor, day-close leftovers.
- **Menu:** Qty rules and list/portion options; mix items (store recipe + special pot).

### v1.4.4
- **Print agents:** Additional PC OS printers sync more reliably (Win32_Printer); virtual PDF/Fax filtered.
- **Counters:** Label each cashier PC (Lawn / Main / Rooftop); bill printer assign shows PC name; print stays on that PC.
- **USB diagnosis:** Settings lists USB/PnP devices on server + Additional PCs, including Unknown USB (missing driver).

### v1.4.1
- **Branding:** New PixalBotics Restaurant app icon applied to desktop, Android APK, and web/PWA icons.

### v1.4.0
- **Expenses:** Hotel expenses tracking with day close and net profit on the dashboard.
- **Credit:** Customer credit sales and repayment flow.
- **Billing:** Bill edit; out-of-stock handling on orders.
- **Inventory / Store:** Purchasing and inventory UI/design improvements.
- **Clients:** Full package — web, desktop app, and Android APK bundled in the release.

### v1.3.2
- **UI:** Mobile/tablet responsive alignment — waiter cart, bills toolbar, audit/settings tables, purchase lines, credit list, close-report meta.
- **Packaging:** Desktop exe name `PixalBotics Restaurant.exe`; release build tolerates locked Electron output dirs.

### v1.3.1
- **Fix:** Desktop app (cashier/kitchen PCs) no longer connects to Hyper-V virtual IPs (e.g. `172.28.x`) — prefers server beacon `192.168.x` like tablets.
- **Fix:** `/api/health` includes `ips` for clients; LAN IP ranking improved on server.

---

# Hotel System v1.3.0 — Release Notes (earlier)

**Date:** 2026-10-02  
**Type:** Offline Windows LAN installer (no Docker, no cloud, no internet required after install)

## What’s in this release

Single-site offline restaurant / hotel POS:

- **Main server PC** — PostgreSQL (localhost only) + Node API as Windows services
- **Desktop app** (Electron) — auto-finds the server on the LAN
- **Android APK** — optional; QR download from Settings (included when built with Android Studio)
- **Browser / PWA** — tablets and phones on the same Wi‑Fi

### Product features

| Area | Capabilities |
|------|----------------|
| **Waiter floor** | Table board, walk-in, add items, KOT, bill request, live “food ready” alerts |
| **Counter POS** | Walk-in / table orders, kg-based qty, kitchen + customer slips |
| **Kitchen** | Live tickets, status (Preparing → Ready), reprint KOT |
| **Billing** | Pay / partial pay, cash handover waiter→cashier, thermal bills |
| **Inventory** | Stock in/out/adjust, low stock, movements, usage by orders |
| **Recipes + Menu** | Live cost from store rates, sell price, profit |
| **Payments / Audit** | Cash ledger, handovers, sales & profit reports, Excel export |
| **Users** | Roles, password + PIN, per-cashier bill printer assignment |
| **Settings** | Branding, tables, printers (USB / LAN :9100), backups, QR codes |
| **Realtime** | Socket.IO rooms for kitchen, cashier, print status |
| **i18n** | English / Urdu |

### Demo logins (change after go-live)

| User | Password | PIN | Role |
|------|----------|-----|------|
| admin | admin123 | — | Full access |
| manager | manager123 | 2222 | Floor orders & payments |
| cashier | cashier123 | — | POS, bills, cash drawer |
| waiter | waiter123 | 1111 | Tables & KOT |
| kitchen | kitchen123 | — | Kitchen display |
| store | store123 | — | Inventory |

## Install summary

1. **One Main PC** → Setup → *Main PC: server + desktop app*  
   - Reserve this PC’s IP in the router (DHCP reservation).
2. **Cashier / kitchen PCs** → same Setup → *Additional PC: desktop app only*
3. **Tablets** → same Wi‑Fi → Android APK (Settings QR) or `http://<server-ip>:3000`
4. **Network bill printers** → fixed IP, port 9100 → Settings → Printers → assign per cashier

See `INDUSTRIAL-SETUP.md` and `README.txt` in the release folder.

## Package contents

| File | Purpose |
|------|---------|
| `HotelSystem-Setup-1.4.10.exe` | Offline installer (required) |
| `hotel-system.apk` | Android app (if present in this package) |
| `README.txt` | Short client install sheet |
| `INDUSTRIAL-SETUP.md` | Main server + counter printers guide |
| `RELEASE-NOTES.md` | This file |

## Upgrade

Run the newer installer over the old install. Data, secrets, and ports under `C:\ProgramData\HotelSystem` are kept. Migrations run automatically. **Seed (demo catalog) does not run on upgrade** — your live menu, stock, and users stay as they are.

## Known limitations

- One Main PC only (do not install “server” mode on two PCs).
- USB on the **main server** works as before. USB on an **Additional PC** works when that PC runs the desktop app (printer appears in Settings automatically). Or use LAN printers at counters.
- Plain-HTTP tablet home-screen shortcuts need a stable server IP (use DHCP reservation).
- Guest Wi‑Fi / client isolation must be off so devices can reach the server.

## Setup Error 4551 (Smart App Control)

On Windows 11, an **unsigned** `HotelSystem-Setup-*.exe` can show:

> Unable to execute file in the temporary directory.  
> Error 4551: An Application Control policy has blocked this file.

**This is expected.** Windows is doing its job. Professional products do **not** ask users to turn off Smart App Control or Defender.

**Correct fix:** Authenticode-sign the installer (and nested EXEs) with a certificate from a CA in the Microsoft Trusted Root Program, then rebuild with `-RequireSign`.

See **[CODE-SIGNING.md](CODE-SIGNING.md)** — Azure Trusted Signing (recommended) or OV/EV code signing from DigiCert / Sectigo / SSL.com / GlobalSign.

Until a trusted cert is configured, treat Setup.exe as **internal/dev only**.

## Build note

This package targets Windows x64. Runtime bundles Node.js 22, PostgreSQL 16, and WinSW. No Docker.
