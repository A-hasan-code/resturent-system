package com.pixalbotics.hotelsystem;

import android.content.Context;
import android.net.wifi.WifiManager;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONObject;

import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.InterfaceAddress;
import java.net.NetworkInterface;
import java.net.SocketTimeoutException;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.Map;
import java.util.Set;

/**
 * Finds Hotel System servers on the Wi-Fi without scanning: listens for the server's UDP beacon
 * (port 41234) and sends a broadcast probe (port 41235) that the server answers directly.
 * A WebView cannot use UDP, which is why this lives in native code.
 */
@CapacitorPlugin(name = "HotelDiscovery")
public class HotelDiscoveryPlugin extends Plugin {

    private static final String APP_ID = "hotel-system";
    private static final int BEACON_PORT = 41234;
    private static final int PROBE_PORT = 41235;
    /** After the first server answers, wait this long for others (e.g. an old and a new server). */
    private static final long GRACE_MS = 400;

    @PluginMethod
    public void listen(PluginCall call) {
        final int timeoutMs = Math.max(500, Math.min(call.getInt("timeout", 3000), 15000));
        new Thread(() -> {
            try {
                call.resolve(search(timeoutMs));
            } catch (Exception e) {
                call.reject("Discovery failed: " + e.getMessage(), e);
            }
        }, "hotel-discovery").start();
    }

    @PluginMethod
    public void localIps(PluginCall call) {
        JSArray list = new JSArray();
        try {
            for (NetworkInterface nif : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!nif.isUp() || nif.isLoopback()) continue;
                for (InterfaceAddress ia : nif.getInterfaceAddresses()) {
                    InetAddress addr = ia.getAddress();
                    if (!(addr instanceof Inet4Address) || addr.isLinkLocalAddress()) continue;
                    JSObject o = new JSObject();
                    o.put("ip", addr.getHostAddress());
                    o.put("prefixLength", ia.getNetworkPrefixLength());
                    o.put("iface", nif.getName());
                    list.put(o);
                }
            }
        } catch (Exception ignored) {
            // No interfaces readable: the web layer falls back to common subnets.
        }
        JSObject res = new JSObject();
        res.put("addresses", list);
        call.resolve(res);
    }

    private JSObject search(int timeoutMs) throws Exception {
        WifiManager wifi = (WifiManager) getContext().getApplicationContext().getSystemService(Context.WIFI_SERVICE);
        WifiManager.MulticastLock lock = null;
        if (wifi != null) {
            lock = wifi.createMulticastLock("hotel-discovery");
            lock.setReferenceCounted(false);
            lock.acquire();
        }

        Map<String, JSObject> found = new LinkedHashMap<>();
        DatagramSocket beacon = null;
        DatagramSocket prober = null;
        try {
            try {
                beacon = new DatagramSocket(null);
                beacon.setReuseAddress(true);
                beacon.setBroadcast(true);
                beacon.bind(new InetSocketAddress(BEACON_PORT));
                beacon.setSoTimeout(150);
            } catch (Exception e) {
                // Port busy: rely on the probe reply only.
                if (beacon != null) beacon.close();
                beacon = null;
            }

            prober = new DatagramSocket();
            prober.setBroadcast(true);
            prober.setSoTimeout(150);
            byte[] probe = ("{\"app\":\"" + APP_ID + "\",\"probe\":true}").getBytes(StandardCharsets.UTF_8);
            for (InetAddress target : broadcastTargets()) {
                try {
                    prober.send(new DatagramPacket(probe, probe.length, target, PROBE_PORT));
                } catch (Exception ignored) {
                    // Some interfaces refuse broadcast; try the next one.
                }
            }

            long deadline = System.currentTimeMillis() + timeoutMs;
            byte[] buf = new byte[4096];
            while (System.currentTimeMillis() < deadline) {
                for (DatagramSocket s : new DatagramSocket[] {prober, beacon}) {
                    if (s == null) continue;
                    DatagramPacket packet = new DatagramPacket(buf, buf.length);
                    try {
                        s.receive(packet);
                    } catch (SocketTimeoutException timeout) {
                        continue;
                    }
                    JSObject server = parse(packet);
                    if (server == null) continue;
                    if (found.isEmpty()) deadline = Math.min(deadline, System.currentTimeMillis() + GRACE_MS);
                    found.put(server.getString("serverId"), server);
                }
            }
        } finally {
            if (beacon != null) beacon.close();
            if (prober != null) prober.close();
            if (lock != null && lock.isHeld()) lock.release();
        }

        JSArray servers = new JSArray();
        for (JSObject s : found.values()) servers.put(s);
        JSObject res = new JSObject();
        res.put("servers", servers);
        return res;
    }

    private static JSObject parse(DatagramPacket packet) {
        try {
            String text = new String(packet.getData(), packet.getOffset(), packet.getLength(), StandardCharsets.UTF_8);
            JSONObject json = new JSONObject(text);
            if (!APP_ID.equals(json.optString("app")) || json.optBoolean("probe")) return null;
            String serverId = json.optString("serverId", "");
            if (serverId.isEmpty()) return null;
            JSObject o = new JSObject();
            o.put("serverId", serverId);
            o.put("name", json.optString("name", ""));
            o.put("port", json.optInt("port", 3000));
            o.put("host", packet.getAddress().getHostAddress());
            JSArray ips = new JSArray();
            JSONArray raw = json.optJSONArray("ips");
            if (raw != null) for (int i = 0; i < raw.length(); i++) ips.put(raw.optString(i));
            o.put("ips", ips);
            return o;
        } catch (Exception e) {
            return null;
        }
    }

    private static Set<InetAddress> broadcastTargets() {
        Set<InetAddress> out = new LinkedHashSet<>();
        try {
            out.add(InetAddress.getByName("255.255.255.255"));
            for (NetworkInterface nif : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!nif.isUp() || nif.isLoopback()) continue;
                for (InterfaceAddress ia : nif.getInterfaceAddresses()) {
                    if (ia.getBroadcast() != null) out.add(ia.getBroadcast());
                }
            }
        } catch (Exception ignored) {
            // Fall back to the limited broadcast address only.
        }
        return out;
    }
}
