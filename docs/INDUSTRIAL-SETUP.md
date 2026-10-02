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

1. Put each billing printer in **network mode** (not USB-to-cashier-PC). Give it a fixed LAN IP.
2. On the server, **Settings → Printers → Add**:
   - Type: **LAN / network**
   - Target: `192.168.x.x:9100`
   - Tick **Bill**
   - Station: e.g. `Cashier 1`
3. **Test print**.
4. **Users**: edit each cashier → **Bill printer** → assign that counter’s printer.

When that cashier prints a bill, the server sends it to **their** printer.

Kitchen slips: add a printer with **Kitchen slip** ticked (often one shared kitchen printer).

## Do not

- Install “Main PC” on more than one computer.
- Rely on USB printers attached only to Additional PCs — the server cannot see those. Use network printers, or plug USB into the **main server** PC only.
