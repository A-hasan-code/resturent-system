import { existsSync, mkdirSync, readFileSync } from "fs";
import { dirname, isAbsolute, join, resolve } from "path";

const PATH_KEYS = ["HOTEL_DATA_DIR", "PG_BIN", "WEB_DIST", "DOWNLOADS_DIR"];

export const ANDROID_APK = "hotel-system.apk";

/**
 * Installed server: HOTEL_ENV_FILE (written by the installer under ProgramData).
 * Development: apps/api/.env. Values already present in the environment win;
 * relative paths are resolved against the env file's folder.
 */
export function loadEnvFile() {
  const candidates = [
    process.env.HOTEL_ENV_FILE,
    resolve(process.cwd(), ".env"),
    resolve(__dirname, "../../.env"),
  ].filter(Boolean) as string[];

  for (const file of candidates) {
    if (!existsSync(file)) continue;
    for (const raw of readFileSync(file, "utf8").split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq < 1) continue;
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      if (/^".*"$/.test(value) || /^'.*'$/.test(value)) value = value.slice(1, -1);
      if (value && PATH_KEYS.includes(key) && !isAbsolute(value)) value = resolve(dirname(file), value);
      if (process.env[key] === undefined) process.env[key] = value;
    }
    return file;
  }
  return null;
}

export function dataDir(...parts: string[]) {
  const base = process.env.HOTEL_DATA_DIR || resolve(process.cwd(), "data");
  const dir = join(base, ...parts);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

// __dirname is dist/config: installed layout is app/api/{VERSION,dist} and app/web/dist,
// the repo layout is VERSION at the root and apps/web/dist.
export function appVersion(): string {
  if (process.env.APP_VERSION) return process.env.APP_VERSION;
  for (const p of [resolve(__dirname, "../../VERSION"), resolve(__dirname, "../../../../VERSION")]) {
    if (existsSync(p)) return readFileSync(p, "utf8").trim();
  }
  return "1.0.0";
}

export function httpPort() {
  // Production installer sets PORT in hotel.env (usually 3000). Dev defaults to 4000.
  const fallback = process.env.NODE_ENV === "production" ? 3000 : 4000;
  return Number(process.env.PORT || fallback);
}

export function webDistDir(): string | null {
  for (const p of [process.env.WEB_DIST, resolve(__dirname, "../../../web/dist")]) {
    if (p && existsSync(join(p, "index.html"))) return p;
  }
  return null;
}

/** Files offered to staff devices at /downloads (the Android APK). Installed layout: app/downloads. */
export function downloadsDir(): string | null {
  for (const p of [process.env.DOWNLOADS_DIR, resolve(__dirname, "../../../downloads")]) {
    if (p && existsSync(p)) return p;
  }
  return null;
}
