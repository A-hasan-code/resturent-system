# Hotel System v1.4.69 - Release Notes

**Date:** 2026-11-02  
**Targets:** Windows installer + Desktop (Electron) + Android APK + Web/PWA  
**Branch:** `improve-the-system`

### Data safety (upgrade confirmation)

**Updating to v1.4.69 will NOT remove your live data.**

| What happens on upgrade | Result |
|-------------------------|--------|
| Existing menu, orders, bills, stock, users, expenses, payments, workers, specials | **Kept** |
| Demo seed (catalog / demo users) | **Does not run** on upgrade |
| Database change | Safe Prisma migrate only (new columns/tables; no wipe) |
| Pre-upgrade backup | Written under `C:\ProgramData\HotelSystem\backups` (`*-pre-upgrade.dump`) |

**Do not uninstall first.** Run the newer Setup over the existing install as Administrator (Main PC → server mode). Schema migrate only; live hotel data stays in place.

### Offline install / upgrade

1. Build on a machine with Node: `pnpm release` (or `.\packaging\windows\Build-Release.ps1 -SkipAndroid`)
2. Copy `releases\v1.4.69\HotelSystem-Setup-1.4.69.exe` to the hotel (USB / LAN share) — **no internet required** on the client.
3. On Main PC: run Setup as Administrator over the existing install.
4. After upgrade: open desktop app on each Cashier / Additional PC so print agent reconnects (USB bill printers).
5. Additional PCs: can pull `desktop-update.zip` from the Main server over LAN.

### v1.4.69
- **Bill / KOT preview fit:** Thermal preview no longer clips left text or shows an inner horizontal scrollbar. Slip width matches Courier character grid; preview scales to fit Bills / Settings / KOT modals. Browser/printer print unchanged.

### v1.4.68
- **Kitchen printer stations (multi-select):** Settings → printer → Kitchen slip shows dynamic station checkboxes (from Store → Kitchen stations). Tick several on one printer = **one** KOT slip; put a far station (e.g. BBQ) on its own printer for a separate slip. No more typing `beverages, cooking, bbq`.

### v1.4.67
- **Menu sales PDF — real categories:** Close → Menu sales PDF groups each product under its menu category (Karahi, Drinks, …), not a single “Menu” bucket. Includes paid + credit; Per Head stays its own section; purchase/profit from order costs.

### v1.4.66
- **Takeaway → kitchen again:** Takeaway with menu food goes PENDING, prints KOT, appears on the Kitchen board (Start / Ready / Served). Add/edit/cancel kitchen slips work like tables. Bill still prefers Main Cashier; per-head-only takeaway stays READY at counter.

### v1.4.65
- **Print agent — Additional PC false idle fix:** Cashier/Additional desktops no longer treat `C:\Program Files\HotelSystem` alone as “Main server” (that folder exists for desktop-only installs too). Agent only idles on real server signals (`server-info.txt`, `HotelSystem\app`, `HotelSystemAPI`). Fixes all Cashier PCs stuck Offline and USB bill print not claiming jobs while kitchen LAN KOTs still worked.

### v1.4.64
- **Bill edit cancel slip fix:** When “Print cancel slip to kitchen” is on, the slip lists only the removed/reduced quantities — not the remaining order items stamped CANCELLED.

### v1.4.63
- **Reverse payment:** Clears payment/tip only — same order stays Unpaid and editable; Close/Finance/Payments totals drop; table reopens if the visit was completed. No cancel/void, no stock restore.
- **Bill edit → kitchen:** New / extra items print only that KOT round (order # + new lines), not a full-order reprint.
- **Bill edit qty down/remove:** Optional “Print cancel slip to kitchen” checkbox (default off).

### v1.4.62
- **Settings → Payment closes kitchen:** Optional toggle (default off). When on, a full cashier payment marks the order completed/served and removes it from the kitchen board immediately.

### v1.4.61
- **Settings → Network health & machine logs:** Check DB, LAN IPs, mDNS, Cashier PCs online/offline, LAN printer TCP reachability. Per-machine logs (Main + Additional PCs) for login, hotel open/close, API actions (orders/pay/settings…), printer Active on/off, print OK/FAIL, Cashier register/reconnect.
- **Readable log panel** on light background.

### v1.4.60
- **Business shift open → close (HRMS-style):** Settings → **Shift opens** + **Shift closes** (e.g. 10:00 → 03:00). Dashboard, Audit, Close, Billing, Payments, Finance, Expenses, Menu sales use that window only — not open→next-open 24h. Stops overnight mix (15th into 16th).
- **Hotel Open/Close ≠ day change:** Manual hotel close does not move the business date; only the open/close clocks do.
- **Gap after close:** Between shift close and next open, activity belongs to the upcoming day (out of yesterday’s locked report).

### v1.4.59
- **Business day boundary (no previous-day mix):** “Today” is Settings → **Business day starts** (opening) until the next opening — not calendar midnight and not a widened ±14h pad. Dashboard, Sale Audit, Close, Menu sales PDF, Billing, Payments/Cash, Finance, Hotel Expenses, Store purchases, and Workers all use the same window.
- **Menu sales PDF:** Close → Menu sales PDF lists paid + credit items for that business day only (Per Head section unchanged); previous business day dishes stay out.
- **Expense / purchase / worker date stamps:** Saved on dayStart of the chosen business date so they never fall into yesterday when day start is afternoon.
- **UI defaults:** Purchasing, Workers, Hotel Expenses month/year, Audit year presets use the current business date.

### v1.4.58
- **Reverse payment → Unpaid:** Main Cashier reverse clears payments/tips and reopens the bill as **Unpaid** (editable / payable again). No cancel, no stock restore, no kitchen cancel slip. Closed (Completed) bills reopen as Served; blocked if the table already has another open bill.

### v1.4.57
- **Takeaway → kitchen:** New / added takeaway items print KOT and ping the Kitchen board (was blocked before). Cancel / bill-edit kitchen slips work for takeaway too.
- **Takeaway KOT printers:** Kitchen slips skip cashier / counter / Other-print printers; prefer station-tagged or kitchen-named printers.
- **Kitchen board:** Takeaway tickets appear on Kitchen (Start / Ready / Served); Main Cashier still has the same buttons on Waiter.
- **Pay → Served:** Full payment on takeaway closes as Completed; paying a table still cooking moves it to **Served**.
- **Notifications On/Off:** My account → Notifications — system alerts for bill requests / kitchen (phone & tablet APK). Default On.
- **Admin → cashier kitchen access:** Users → edit cashier/waiter → **Kitchen board access** On — they can Start / Ready / Served on the Kitchen screen (no role change to Kitchen).

### v1.4.56
- **Close — Menu sales PDF:** Download **Menu sales PDF** on Close — category-wise product report (Qty, Sale, T.Sale, Purchase, Profit). Includes **paid + credit** sales up to that moment; open table unpaid excluded. **Per Head** cover charges get their own section.
- **Close — Items sold:** List now counts credit invoices as sold (not only PAID bills).
- **Admin dashboard — sales/values blank:** Cost repair no longer blocks `/dashboard`. Inactive store ingredients (e.g. Cooking Oil on a recipe) are skipped so Orders / Sales / Tips / Overview cards load again.

### v1.4.55
- **Print — Main server ≠ Cashier PC (hard block):** Reject register when hostname is this server or the request comes from this PC’s own IP; purge on every Settings refresh. Desktop idles when HotelSystem server install / hostname / hotel.local / LAN IP matches.
- **Print — Windows / USB Online status:** Server Windows printers show Online from spooler (not stuck Offline waiting for desktop agent). AGENT printers also Online if the same name exists on Main PC.
- **Print — USB list noise:** Mouse/keyboard no longer flagged as “need printer driver”.
- **Takeaway — cashier kitchen steps:** Takeaway starts PENDING; cashier can Start → Ready → Served on the order screen (same as kitchen). Close takeaway only after Ready/Served.
- **Bill edit — total & stock:** Removing/reducing a line recalculates bill total from line amounts (modifiers included); MIX/deal stock restores like cancel; live total while editing.
- **Bill edit — kitchen slips:** Removed/qty-down lines print a CANCELLED kitchen slip, then a reprint of remaining items.

### v1.4.54
- **Print — Main server is never a Cashier PC:** Desktop agent idles when this PC has the HotelSystem server install, or when the URL is hostname / hotel.local / LAN IP of this machine. Fixes `siteserver` appearing under Cashier PCs.
- **Print — auto-purge self-agent:** On API start, any print agent whose hostname matches the Main server is deleted (and its AGENT printers).
- **Print — server rejects self-register:** Register from Main hostname returns idle (no Cashier row).
- **Settings — Remove PC:** Delete a Cashier / Additional PC from Cashier PCs (and its AGENT printers).

### v1.4.53
- **Print — manual Additional PC printers:** Settings → + Add printer → **USB (Additional PC)**. Pick Cashier PC + Windows printer name. Still needs desktop app Online to print; auto-sync remains.
- **Print — LAN Online/Offline:** LAN (IP) printers show Online when TCP port 9100 answers, or Offline with a clear hint. Refreshes with the printers list (~15s).
- **Print — manual flag:** Admin-added Additional PC printers are not auto-removed when USB briefly disconnects from that PC.

### v1.4.52
- **Table reservation (Supervisor / Cashier / Admin):** Hold a free table for a guest (name, phone, party, arrival time, notes). Waiter cannot reserve. Board shows Reserved (blue). Long-press / right-click a free table, or use Reserve on the order screen. Admin can view and edit.
- **Advance (pre) order:** After reserving, add menu items — order is saved but kitchen slip + timers stay off until guest arrives.
- **Guest arrived:** Supervisor / Cashier presses **Guest arrived — start kitchen** → KOT prints and kitchen timers start.
- **Cancel reservation:** From the reserved table order screen.

### v1.4.51
- **Print — Kitchen/Bar no longer take guest bills:** Agent USB printers named Kitchen / Bar / KOT auto-heal to KOT-only (bill off). Bills prefer non-kitchen printers (e.g. LaserJet / cashier).
- **Print — server prints when Windows has the printer:** If Additional PC desktop is offline but the same printer name is installed on the Main PC (network/shared Windows printer), the server prints it — no “open desktop app” fail.
- **Print — remove is undoable:** Remove turns Active off (keeps the row). Tick **Active** to restore. Additional PC USB printers also return when the desktop app opens.
- **Print — offline Additional PC:** Pending AGENT jobs only fail when the desktop is offline *and* the printer is not on the Main PC spooler.
- **Close report credit:** Credit sales separated from expected cash; today’s credit new / paid / outstanding shown clearly.
- **Takeaway credit:** Credit payment allowed on takeaway orders.
- **Cashier per-head:** Cashiers can charge per-head (not Supervisor-only).

### v1.4.50
- **Production empty dashboard / billing fix:** Windows service TZ (`Asia/Karachi` default + installer `TZ`) and shared business-day query pad across Dashboard, Bills, Payments, Finance, Close, Audit, Expenses — empty “today” on installed servers is fixed.
- **Takeaway → Main Cashier (not kitchen):** Takeaway orders skip kitchen board / KOT, auto-assign Main Cashier, stay READY for pay/close. Edit/cancel no longer bounce takeaway back to kitchen.
- **Prod-ready check script:** `scripts/prod-ready-check.ps1` for regression before ship.

### v1.4.49
- **Business day (midnight fix):** Payments, Cash Record, Finance, Audit, and Expenses use the restaurant business day (`dayStart` → next `dayStart`, default 11:00) — not calendar midnight. Cashier 1 records match Close for overnight sales.
- **Billing history by day:** Paid / Cancelled / Unpaid / All honor the business-day picker. Paid = payment time; Cancelled = cancel time; Unpaid today = all open tables; past unpaid = opened that day still unpaid.
- **Admin cash → Counter 1:** Admin / System Manager cash collections count on Cash counter 1 (with Main Cashier) on the Close report.
- **Credit person change:** Move an open credit invoice to another credit customer (Credit Customers → open bill → Change credit person).
- Hotel status API exposes `businessDate` so UIs default to the correct day after midnight.

### v1.4.48
- **Recipes Off = fully manual billing:** When Recipes stock toggle is Off, orders no longer check recipe exists/active, inactive store ingredients, recipe cost, kitchen stock, or pot stock. Pure menu price billing; stock/recipes stay manual.
- **Soft recipe cost (try/catch):** Even when Recipes are On, missing/inactive recipe or inactive store items no longer crash order costing — cost becomes 0 and billing continues (stock gate still applies only when On).
- Continues v1.4.47 Additional PC LAN auto-update.

### v1.4.47
- **Additional PC auto-update:** After upgrading the Main PC, cashier/kitchen desktop apps download `desktop-update.zip` from the server over the LAN and replace themselves (one Windows UAC prompt). UI already loads from the server; this updates the Electron shell / print agent.
- Installer ships `/downloads/desktop-update.zip` + `desktop-update.json` for LAN clients.

### v1.4.46
- **Fresh installer rebuild:** Complete Setup.exe re-packaged (full stage + Inno) after a corrupt/incomplete v1.4.45 copy was reported. Same cook date/time, orphan→carry, and Admin past-close edit as 1.4.45.

### v1.4.45
- **Cook date/time:** Cook modal picks business date + time (shared DateField / TimeField). After leftover close / day-start, defaults to the **new** date so morning cook is not lost on the closed day.
- **Orphan pot → carry:** Remaining from a previous-day pot (e.g. cook after close) auto-moves to today’s **Carry** — no second kitchen stock cut.
- **Close Report — Admin past edit:** Admin can unlock and edit previous days’ close + leftover; other roles stay view-only on past dates.
- **Leftover close:** No longer auto-wipes the saved leftover close row (keeps audit / closing list).

### v1.4.44
- **Specials cook (simple):** Click Cook → recipe ingredients appear. Enter how much you put in today (e.g. 2 kg rice, 2 kg meat), then finished pot kg after cooking. Kitchen stock deducts what you entered — not recipe × finished weight.
- **Cook cost:** Tracks actual ingredient cost for the day’s cook log.

### v1.4.43
- **Recipes → stock check On/Off:** Toggle whether orders require kitchen stock per recipe. **On** (default) = sell only when station has ingredients. **Off** = place menu/orders without kitchen stock check or auto-deduct.

### v1.4.42
- **Worker ledger (Excel-style):** Per-worker Date / Detail / Debit / Credit / Balance / Credit|Debit status. Opening balance, salary credit, net cash, other (food bill).
- **Pay salary (cash):** One action posts salary credit + cash out (hotel Salary expense) — paid to employee now, not kept on books.
- **Close hotel = shift end:** While closed: no new orders, no day close, no expenses, no store/kitchen inventory close (open bills can still be paid).
- **Other print (server Windows printers):** Tick Other print on a server Windows printer; Print (Other) on close / audit / kitchen PDF / supplier ledger.
- **Worker modals:** Save / Cancel stay visible (sticky footer).

### v1.4.41
- **Stock item rename:** Anyone with Inventory manage can rename stock items (Edit rate → Name). No longer Admin-only.
- **Kitchen stations — edit all:** Rename / sort any station (including built-in). Code stays locked; built-in cannot be deleted.

### v1.4.40
- **Kitchen stations — edit all:** Inventory → Kitchen stations — rename / sort any station (including built-in Cooking, BBQ, Beverages). Code stays locked (menu / KOT / stock). Activate / deactivate unchanged; built-in still cannot be deleted.

### v1.4.39
- **Worker advances & opening balances (data shift):** Opening **lena** (advance already given) and **dena** (salary already due) per worker.
- **Give advance:** Cash advance → hotel expense (`Salary advance`); remaining lena increases.
- **Pay salary with recover / settle:** Cut from remaining advance; optionally settle old dena; cash-out preview; only cash portion hits Salary expense.
- **Balances on Worker record:** Total remaining lena / dena, per-worker columns, edit-only after pay (no delete).
- **Safe migration:** New ledger table + columns only; no wipe of live sales/stock/users.

### v1.4.38
- **Worker record (new Admin tab):** Staff salary ledger — add workers (no login needed), pay daily/monthly salary, see who was paid each day / month / year.
- **Salary = expense:** Every payment is saved as a Hotel expense (category `Salary`) and counts in day close / profit.
- **After pay: edit only, no delete** — salary payments cannot be removed (Worker record or Hotel expenses); edit updates the linked expense.
- **Safe migration:** Creates new tables only; does not alter or delete existing sales/stock/user rows.

### v1.4.37
- **Table badge readability:** Customer + kitchen slips use solid black raster badge (white letters) — fixes dim / unreadable GS B inverse on many thermal printers. Larger scale for SoftInfinity-style `TABLE NO. …`.
- **Bill preview:** Pure black Courier text + high-contrast table pill so preview matches thermal design.
- **Full release pack:** Setup includes server + desktop app + APK.

### v1.4.36
- **Release packaging:** Windows Setup includes the **PixalBotics Restaurant** desktop app again (local Electron dist — no GitHub download required offline).
- Same SoftInfinity-style customer bill + PAID/UNPAID stamp + kitchen slip from v1.4.35.

### v1.4.35
- **Customer bill (SoftInfinity-style clone):** Layout matches SoftInfinity reference — logo (restaurant branding), Provisional Bill, Date/Time, Serving Area, Table No. white-on-black pill (Font A, double-height), Party Name, Description, items, Gross Total, Cash Received box, Order Taker / Login, thanks line, **Powered by Pixalbotics**.
- **PAID / UNPAID stamp:** Prints again on cashier thermal bills (was preview-only after compact pass).
- **Kitchen slip:** Compact header (no logo), readable table badge, PixalBotics footer, less feed before cut.

### v1.4.34
- **Mix = Deal:** One deal price with **multiple store recipes** (each part its own qty). Cooked pot is **optional** (store-only deals allowed).
- **Safe upgrade:** New `MenuDealPart` table; existing Mix rows are **backfilled** (not deleted). Order cancel restores multi-pot takes via `dealTakesJson`.
- Menu UI: add/remove deal parts; Waiter allows store-only deals and pot shortfall → store-only fallback when pots are included.

### v1.4.33
- **Bill print alignment:** Customer bills use Font A (fixed character grid) so Product / Qty / Rate / Amount stay in columns. Item headers are no longer bold (bold glyphs were shifting numbers on many thermal printers).
- **Bill totals:** Payment and Balance Due use the same left/right pair layout as Gross / Grand Total.
- **Safer updates:** Setup welcome text warns not to uninstall first; post-install status says data is kept; README upgrade steps include reboot guidance for locked Windows services.

### v1.4.32 (final ship)
- **Installer seed safety:** First install seeds demo catalog/users. Upgrades only run migrations + pre-upgrade backup — **no seed** on live hotels (menu, orders, stock, users kept).
- **Incomplete first install:** If `pgdata` exists but the DB has **0 users**, Setup seeds once (fixes retry after a failed first install).
- **ASCII-safe install.ps1:** Removed non-ASCII dashes that could break PowerShell parse on some Windows locales.
- Live data stays in `C:\ProgramData\HotelSystem` (separate from developer `.dev` test DB).

### v1.4.31
- **Installer upgrade:** Do not unregister/reinstall HotelSystemDB / API on every upgrade (avoids Windows 1072 marked-for-delete timeout). Clear reboot guidance if a service is still locked.

### v1.4.30
- **Bill print:** Table No. prints as a readable white-on-black raster badge (fixes black-on-black inverse on many thermal printers).
- **Bill print:** Order type / Payment / Party use left-right pairs; PAID/UNPAID stamp sits in the totals block so amounts stay readable.
- **Bill preview:** Settings thermal preview matches the same table badge + stamp placement.

### v1.4.29
- **Installer fix:** `install.ps1` had a Unicode dash that broke PowerShell parse on Windows - server configuration failed with a generic error. Fixed to ASCII; server services now install correctly when run as Administrator.

### v1.4.28
- **Installer server step:** Setup shows the real error from `last-error.txt` (not a generic box). WinSW service XML written without UTF-8 BOM so the API service can start. Pack-unit / kitchen-timer migrations are safe to re-run on upgrade.

### v1.4.27
- **Menu seed (Quetta Sangat card):** Live Kitchen, BBQ, Karahi/Handi Half-Full KG rates, Chinese, salads, and Chaye Khana aligned to the printed menu (half = 500g rate x2 /kg).
- **Pakistani Special pots:** Bannu Palao (KG), daal/sabzi/qorma as daily pots with Full + Half plate prices, plate weight (kg), and optional sell by Rs.
- **Specials UI / Waiter:** Set half vs full plate Rs on the pot; waiter picks Half plate / Full plate (and Rs when enabled).
- **Store purchase Add item search:** Fixed overlapping search/clear icons inside the field (padding + no double browser X).
- **Inventory:** PDF Active Stock import into Baverage / Main Kitchen store categories (remaining qty + rates).

### v1.4.26
- **Bill / KOT preview logo:** After uploading a new logo, Settings and Billing thermal previews show the new image (no more stuck browser cache). Print already used the file on disk.

### v1.4.25 (final ship)
- **Bill preview:** Works even when no bill printer is registered (defaults to 80 mm). No more stuck “Loading preview…” on Billing.
- **Protected accounts:** `admin`, `sysmanager`, `maincashier`, `cashier2` cannot be deleted or renamed.
- **Smoke E2E:** API smoke script for pack verification.

### v1.4.24
- Built-in user lock (API + Users UI): delete button hidden; reserved usernames blocked on create.

### v1.4.23
- **Kitchen SERVED ≠ COMPLETED:** Floor “Served” does not close the bill; COMPLETED is billing/payment close.
- Kitchen list + supervisor floor ready beep; paid order can still finish kitchen → SERVED → COMPLETED when paid.
- Credit settle due includes tax + discount; release-credit gate; PARTIAL bills in Unpaid + PayModal tip/partial UX.
- Dashboard business-day collected totals; served / stale counts; SUPERVISOR gate.

### v1.4.22 – v1.4.17
- Store movement semantics; special kitchen station; finance pack wire-up polish; close PDF / expenses / credit billing hardening.

### v1.4.16
- **Daily Specials (hotel POS):** KPI strip (cook / sold / remaining / margin / waste); pot status; cook cost on board; day-lock blocks cook/reopen/close.
- **Leftover close:** Shrink vs system folds into waste + cost; waste note required; ±50g tolerance aligned; Close PDF specials section.
- **Cook recipe required** for pot create/cook so store deduct and waste costing always work.

### v1.4.15
- **Customer bill / receipt:** Payment mode (Cash/Card/Wallet/Bank or Credit); method-aware “Received” lines; unpaid bills show live tax; credit address; Grand Total.
- **Bill preview:** NTN/STRN + tax + payment mode parity with thermal print; Bills payment log shows method.

### v1.4.14
- **Payments & Cash:** Method column + filter (cash/card/wallet/bank); tender mix cards; cash drawers use amount+tip; handover filters are cash-only.
- **Credit settle:** Explicit CASH method; blocked when the invoice’s business day is locked.
- **Cash record / handovers:** Tip-aware drawer totals and confirm amounts; credit badge on settlement rows.
- **Pay modal:** Clear day-lock message when taking payment on a locked day.

### v1.4.13
- **Close report:** Drawer expected = opening float + cash sales + tips − cash out (C1); miss + surplus; non-cash tender (card/wallet/bank).
- **Close lock / freeze:** Save locks the day; past days show frozen snapshot; Admin unlock from Close or Finance.
- **Close PDF:** Download day close PDF (EN layout) with counters, cash-out, sold items, pending.

### v1.4.12
- **Finance pack:** Payment methods (cash/card/wallet/bank), exclusive sales tax on bills, day P&L + exceptions + unlock, credit aging.
- **Day lock:** Closing the day locks further payments for that business date (Admin can unlock).
- **Legal IDs:** NTN / STRN in Settings; printed on receipts.
- **Menu modifiers:** Optional add-ons on menu items; waiter can pick when ordering.

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
| **Kitchen** | Live tickets, status (Preparing → Ready → Served), reprint KOT |
| **Billing** | Pay / partial pay, cash handover waiter→cashier, thermal bills |
| **Inventory** | Stock in/out/adjust, low stock, movements, usage by orders |
| **Recipes + Menu** | Live cost from store rates, sell price, profit |
| **Finance** | Day P&L, tax, payment methods, credit aging, close PDF |
| **Payments / Audit** | Cash ledger, handovers, sales & profit reports, Excel export |
| **Users** | Roles, password + PIN, per-cashier bill printer assignment; core accounts protected |
| **Settings** | Branding, tables, printers (USB / LAN :9100), backups, QR codes |
| **Realtime** | Socket.IO rooms for kitchen, cashier, print status |
| **i18n** | English / Urdu |

### Demo logins (change after go-live)

| User | Password | PIN | Role |
|------|----------|-----|------|
| admin | admin123 | — | Full access (protected) |
| sysmanager | sys123 | 5555 | System Manager (protected) |
| maincashier | main123 | 3333 | Main Cashier (protected) |
| cashier2 | cashier123 | 4445 | Cashier (protected) |
| cashier | cashier123 | 4444 | Cashier |
| supervisor | super123 | 2222 | Floor supervisor |
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
| `HotelSystem-Setup-1.4.25.exe` | Offline installer (required) |
| `hotel-system.apk` | Android app (if present in this package) |
| `README.txt` | Short client install sheet |
| `INDUSTRIAL-SETUP.md` | Main server + counter printers guide |
| `RELEASE-NOTES.md` | This file |

## Upgrade

**Do not uninstall first.** Run the newer installer over the old install as Administrator (Main PC → server mode). Data, secrets, and ports under `C:\ProgramData\HotelSystem` are kept. Migrations run automatically. **Seed (demo catalog) does not run on upgrade** — your live menu, stock, and users stay as they are. If Windows reports a service “marked for deletion”, restart the PC and run Setup again.

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
