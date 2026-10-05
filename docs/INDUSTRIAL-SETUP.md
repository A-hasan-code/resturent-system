# Industrial setup: main server + counter printers

One **main server** holds the database and print queue. Cashier / kitchen PCs run only the desktop UI. Each cashier counter has its own **network** billing printer (Wi‑Fi or Ethernet, port **9100**).

```
[Main Server PC] ── LAN ── [Router]
                              │
              ┌───────────────┼───────────────┐
              │               │               │
        Cashier PC      Cashier PC 2     Waiter tablets
        (UI only)         (UI only)        (APK / Wi‑Fi)
              │               │
        Bill printer     Bill printer
        192.168.x.51     192.168.x.52
        (NETWORK)        (NETWORK)
```

## Install

1. **Server PC** (one only): `HotelSystem-Setup-*.exe` → **Main PC: server + desktop app**. Reserve this PC’s IP in the router (DHCP reservation).
2. **Cashier / kitchen PCs**: same installer → **Additional PC: desktop app only**. They find the server on the LAN automatically.
3. **Tablets**: same Wi‑Fi → Android APK or `http://<server-ip>:<port>`.

## Printers (per counter)

### Option A — LAN / network printers (recommended for shared kitchen)

1. Put each billing printer in **network mode**. Give it a fixed LAN IP.
2. On the server, **Settings → Printers → Add**:
   - Type: **LAN / network**
   - Target: `192.168.x.x:9100`
   - Tick **Bill**
   - Station: e.g. `Cashier 1`
3. **Test print**.
4. **Users**: edit each cashier → **Bill printer** → assign that counter’s printer.

### Option B — USB on Additional (cashier) PC

1. Plug the USB printer into the **cashier Additional PC** (not the main server).
2. Install Windows drivers so the printer appears in Windows.
3. Run **Hotel System desktop app** on that PC (Additional PC mode) and leave it open.
4. On the server, **Settings → Printers** — the USB printer appears automatically as **USB (Additional PC)**.
5. Tick **Bill**, set Station (e.g. `Cashier 1`), **Test print**.
6. **Users** → that cashier → **Bill printer** → assign it.

When that cashier prints a bill, the server queues the job and the desktop app on their PC prints to the local USB printer.

Kitchen slips: one printer per station (Beverages / Cooking / BBQ) with **Kitchen slip** ticked and matching station/categories.

- Only one station in the order → that printer only.
- Mixed stations in the same order → each involved printer gets the **full** slip (all items).

## Do not

- Install “Main PC” on more than one computer.
- Expect Additional PC USB printers to work from a browser alone — the **desktop app** must stay open on that PC.
