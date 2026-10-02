import { Capacitor, registerPlugin } from "@capacitor/core";

/** True inside the Android app (Capacitor). The UI is bundled, so the server is never the page origin. */
export const isNative = Capacitor.isNativePlatform();

export type BeaconServer = { serverId: string; name: string; port: number; host: string; ips: string[] };

type HotelDiscoveryPlugin = {
  /** Listens for the server's UDP beacon and sends a broadcast probe. */
  listen(options: { timeout?: number }): Promise<{ servers: BeaconServer[] }>;
  /** IPv4 addresses of this device, used to pick the subnet to scan. */
  localIps(): Promise<{ addresses: { ip: string; prefixLength: number; iface: string }[] }>;
};

export const HotelDiscovery = registerPlugin<HotelDiscoveryPlugin>("HotelDiscovery");
