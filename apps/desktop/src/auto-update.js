// LAN auto-update for Additional (cashier) PCs: download desktop-update.zip from the
// hotel server and replace this install when the server version is newer.
const { app } = require("electron");
const { spawn } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const http = require("http");
const https = require("https");

const UPDATE_JSON = "desktop-update.json";
const UPDATE_ZIP = "desktop-update.zip";

function readVersionFile(file) {
  try {
    const v = fs.readFileSync(file, "utf8").trim();
    return v || null;
  } catch {
    return null;
  }
}

function localVersion() {
  const exeDir = path.dirname(process.execPath);
  for (const p of [
    path.join(exeDir, "VERSION"),
    path.join(exeDir, "..", "VERSION"),
    path.join(__dirname, "..", "VERSION"),
  ]) {
    const v = readVersionFile(p);
    if (v) return v;
  }
  return app.getVersion();
}

/** @returns {number} negative if a<b, 0 if equal, positive if a>b */
function compareVersions(a, b) {
  const pa = String(a || "0")
    .split(/[^\d]+/)
    .filter(Boolean)
    .map((n) => parseInt(n, 10) || 0);
  const pb = String(b || "0")
    .split(/[^\d]+/)
    .filter(Boolean)
    .map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

function installDir() {
  return path.dirname(process.execPath);
}

function fetchJson(url, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith("https") ? https : http;
    const req = mod.get(url, { timeout: timeoutMs }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        fetchJson(res.headers.location, timeoutMs).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("timeout"));
    });
    req.on("error", reject);
  });
}

function downloadFile(url, dest, onProgress) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith("https") ? https : http;
    const file = fs.createWriteStream(dest);
    const req = mod.get(url, { timeout: 120000 }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close();
        fs.unlink(dest, () => {});
        downloadFile(res.headers.location, dest, onProgress).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        file.close();
        fs.unlink(dest, () => {});
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      const total = Number(res.headers["content-length"] || 0);
      let got = 0;
      res.on("data", (chunk) => {
        got += chunk.length;
        if (onProgress && total) onProgress(got, total);
      });
      res.pipe(file);
      file.on("finish", () => file.close((err) => (err ? reject(err) : resolve())));
    });
    req.on("timeout", () => {
      req.destroy();
      file.close();
      fs.unlink(dest, () => {});
      reject(new Error("timeout"));
    });
    req.on("error", (err) => {
      file.close();
      fs.unlink(dest, () => {});
      reject(err);
    });
  });
}

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(file);
    stream.on("data", (d) => hash.update(d));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}

function writeUpdaterScript({ zipPath, destDir, exePath, waitPid, version }) {
  const scriptPath = path.join(app.getPath("temp"), `hotel-desktop-update-${process.pid}.ps1`);
  const parentDir = path.dirname(destDir);
  const lines = [
    "$ErrorActionPreference = 'Stop'",
    `$zip = ${JSON.stringify(zipPath)}`,
    `$dest = ${JSON.stringify(destDir)}`,
    `$exe = ${JSON.stringify(exePath)}`,
    `$parent = ${JSON.stringify(parentDir)}`,
    `$waitPid = ${Number(waitPid)}`,
    `$version = ${JSON.stringify(version)}`,
    "try { Stop-Process -Id $waitPid -Force -ErrorAction SilentlyContinue } catch {}",
    "Start-Sleep -Seconds 2",
    "$extract = Join-Path $env:TEMP ('hotel-desk-extract-' + [guid]::NewGuid().ToString('n'))",
    "New-Item -ItemType Directory -Force -Path $extract | Out-Null",
    "Add-Type -AssemblyName System.IO.Compression.FileSystem",
    "[System.IO.Compression.ZipFile]::ExtractToDirectory($zip, $extract)",
    "$src = $extract",
    "$kids = @(Get-ChildItem -LiteralPath $extract -Force)",
    "if ($kids.Count -eq 1 -and $kids[0].PSIsContainer) { $src = $kids[0].FullName }",
    "New-Item -ItemType Directory -Force -Path $dest | Out-Null",
    "Copy-Item -Path (Join-Path $src '*') -Destination $dest -Recurse -Force",
    "if (Test-Path (Join-Path $src 'VERSION')) {",
    "  Copy-Item (Join-Path $src 'VERSION') (Join-Path $dest 'VERSION') -Force",
    "  Copy-Item (Join-Path $src 'VERSION') (Join-Path $parent 'VERSION') -Force -ErrorAction SilentlyContinue",
    "} elseif ($version) {",
    "  Set-Content -Path (Join-Path $dest 'VERSION') -Value $version -NoNewline -Encoding ascii",
    "  Set-Content -Path (Join-Path $parent 'VERSION') -Value $version -NoNewline -Encoding ascii -ErrorAction SilentlyContinue",
    "}",
    "Remove-Item -LiteralPath $extract -Recurse -Force -ErrorAction SilentlyContinue",
    "Remove-Item -LiteralPath $zip -Force -ErrorAction SilentlyContinue",
    "Start-Process -FilePath $exe",
    "Remove-Item -LiteralPath $PSCommandPath -Force -ErrorAction SilentlyContinue",
  ];
  fs.writeFileSync(scriptPath, lines.join("\r\n"), "utf8");
  return scriptPath;
}

function launchElevatedUpdater(scriptPath) {
  // UAC prompt once; Additional PC installs live under Program Files.
  const command =
    "Start-Process -FilePath powershell.exe -Verb RunAs -ArgumentList " +
    `@('-NoProfile','-ExecutionPolicy','Bypass','-File',${JSON.stringify(scriptPath)})`;
  spawn("powershell.exe", ["-NoProfile", "-WindowStyle", "Hidden", "-Command", command], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  }).unref();
}

/**
 * @param {{ origin: string, status?: (t: string) => void }} opts
 * @returns {Promise<'updated'|'current'|'skipped'|'unavailable'|'error'>}
 */
async function checkAndApplyUpdate(opts) {
  const { origin, status = () => {} } = opts;
  if (!app.isPackaged) return "skipped";
  if (!origin) return "skipped";

  const mine = localVersion();
  let meta = null;
  try {
    // Prefer dedicated manifest; fall back to system/info.
    try {
      meta = await fetchJson(`${origin}/downloads/${UPDATE_JSON}`);
    } catch {
      const info = await fetchJson(`${origin}/api/system/info`);
      meta = info && info.desktopUpdate ? info.desktopUpdate : null;
    }
  } catch (e) {
    status(`Update check failed: ${e.message || e}`);
    return "error";
  }

  if (!meta || !meta.version) {
    // No package on server yet (older installer) — UI still loads from the server.
    return "unavailable";
  }

  if (compareVersions(mine, meta.version) >= 0) {
    status(`Desktop up to date (v${mine})`);
    return "current";
  }

  status(`Update available: v${mine} → v${meta.version}. Downloading…`);
  const rel = meta.path || meta.file || `/downloads/${UPDATE_ZIP}`;
  const url = rel.startsWith("http") ? rel : `${origin}${rel.startsWith("/") ? "" : "/"}${rel}`;
  const zipPath = path.join(app.getPath("temp"), `hotel-desktop-${meta.version}.zip`);

  try {
    await downloadFile(url, zipPath, (got, total) => {
      const pct = Math.min(99, Math.round((got / total) * 100));
      status(`Downloading update v${meta.version}… ${pct}%`);
    });
  } catch (e) {
    status(`Download failed: ${e.message || e}`);
    return "error";
  }

  if (meta.sha256) {
    status("Verifying update…");
    const sum = await sha256File(zipPath);
    if (sum.toLowerCase() !== String(meta.sha256).toLowerCase()) {
      try {
        fs.unlinkSync(zipPath);
      } catch {
        /* ignore */
      }
      status("Update file checksum mismatch — cancelled");
      return "error";
    }
  }

  status(`Installing v${meta.version} — approve the Windows permission prompt…`);
  const scriptPath = writeUpdaterScript({
    zipPath,
    destDir: installDir(),
    exePath: process.execPath,
    waitPid: process.pid,
    version: meta.version,
  });
  // Elevated script stops this process after UAC is approved. If the user denies UAC,
  // the app keeps running and will retry on the next check.
  launchElevatedUpdater(scriptPath);
  return "updated";
}

module.exports = {
  localVersion,
  compareVersions,
  checkAndApplyUpdate,
};
