import { LocalNotifications } from "@capacitor/local-notifications";
import { alertBeep } from "./printing";
import { isNative } from "./native";

const KEY = "hotel.notify.enabled";
const ANDROID_CHANNEL = "hotel-alerts";
let androidChannelReady = false;
let notifyId = 1;

/** User preference — default ON so bill / kitchen alerts show like a normal app. */
export function notificationsEnabled(): boolean {
  try {
    const v = localStorage.getItem(KEY);
    if (v === null) return true;
    return v === "1" || v === "true";
  } catch {
    return true;
  }
}

export function setNotificationsEnabled(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? "1" : "0");
  } catch {
    /* ignore */
  }
}

async function ensureAndroidChannel() {
  if (androidChannelReady || !isNative) return;
  try {
    await LocalNotifications.createChannel({
      id: ANDROID_CHANNEL,
      name: "Bill & kitchen alerts",
      description: "Bill requests, kitchen ready, and delay alerts",
      importance: 5,
      visibility: 1,
      vibration: true,
      sound: "default",
    });
    androidChannelReady = true;
  } catch {
    /* channel may already exist or plugin unavailable */
    androidChannelReady = true;
  }
}

export async function ensureNotifyPermission(): Promise<boolean> {
  if (typeof window === "undefined") return false;

  // Windows desktop (Electron) — native toasts, no browser permission prompt
  if (window.hotelDesktop?.notify) return true;

  // Android APK — Capacitor local notifications (system tray)
  if (isNative) {
    try {
      const cur = await LocalNotifications.checkPermissions();
      if (cur.display === "granted") {
        await ensureAndroidChannel();
        return true;
      }
      const next = await LocalNotifications.requestPermissions();
      if (next.display === "granted") {
        await ensureAndroidChannel();
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  // Browser (HTTPS / localhost)
  if (!("Notification" in window)) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  try {
    const r = await Notification.requestPermission();
    return r === "granted";
  } catch {
    return false;
  }
}

async function showNativeAndroid(title: string, body: string) {
  await ensureAndroidChannel();
  const id = (notifyId++ % 100000) + 1;
  await LocalNotifications.schedule({
    notifications: [
      {
        id,
        title,
        body,
        channelId: ANDROID_CHANNEL,
      },
    ],
  });
}

async function showWebNotification(title: string, body: string) {
  if (!("Notification" in window)) return;
  if (Notification.permission === "default") {
    await ensureNotifyPermission();
  }
  if (Notification.permission !== "granted") return;
  const n = new Notification(title, {
    body,
    tag: `hotel-${title.slice(0, 24)}`,
  });
  n.onclick = () => {
    try {
      window.focus();
    } catch {
      /* ignore */
    }
    n.close();
  };
}

/**
 * Beep + system notification when enabled:
 * - Windows desktop app → Electron Action Center toast
 * - Android APK → native notification shade
 * - Browser → Web Notification API (needs permission / secure context)
 */
export async function pushNotify(title: string, body: string, opts?: { beep?: boolean }) {
  if (!notificationsEnabled()) return;
  if (opts?.beep !== false) alertBeep();
  if (typeof window === "undefined") return;

  try {
    if (window.hotelDesktop?.notify) {
      await window.hotelDesktop.notify(title, body);
      return;
    }
    if (isNative) {
      const ok = await ensureNotifyPermission();
      if (!ok) return;
      await showNativeAndroid(title, body);
      return;
    }
    await showWebNotification(title, body);
  } catch {
    /* beep/toast still work if system notify fails */
  }
}
