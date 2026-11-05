#!/usr/bin/env node
/**
 * Release-only code protection: bundle + obfuscate shipped JS, write integrity seal.
 *
 * Usage:
 *   node scripts/protect-release.mjs --stage <build/stage>
 *   node scripts/protect-release.mjs --desktop-src <apps/desktop/src>
 *   node scripts/protect-release.mjs --stage <stage> --desktop-src <src>
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import esbuild from "esbuild";
import JavaScriptObfuscator from "javascript-obfuscator";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const out = { stage: null, desktopSrc: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--stage") out.stage = argv[++i];
    else if (a === "--desktop-src") out.desktopSrc = argv[++i];
    else if (a === "--help" || a === "-h") out.help = true;
  }
  return out;
}

function die(msg) {
  console.error(`[protect-release] ${msg}`);
  process.exit(1);
}

function sha256File(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function walkFiles(dir, pred) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walkFiles(full, pred));
    else if (!pred || pred(full)) out.push(full);
  }
  return out;
}

function relPosix(from, to) {
  return path.relative(from, to).split(path.sep).join("/");
}

/** Strong but Nest/DI-safer options (no renameGlobals / no aggressive flattening). */
const API_OBFUSCATE = {
  compact: true,
  controlFlowFlattening: false,
  deadCodeInjection: false,
  debugProtection: false,
  disableConsoleOutput: false,
  identifierNamesGenerator: "hexadecimal",
  renameGlobals: false,
  rotateStringArray: true,
  selfDefending: false,
  shuffleStringArray: true,
  splitStrings: true,
  splitStringsChunkLength: 6,
  stringArray: true,
  stringArrayCallsTransform: true,
  stringArrayEncoding: ["base64"],
  stringArrayIndexShift: true,
  stringArrayRotate: true,
  stringArrayShuffle: true,
  stringArrayWrappersCount: 2,
  stringArrayWrappersChainedCalls: true,
  stringArrayWrappersParametersMaxCount: 4,
  stringArrayWrappersType: "function",
  stringArrayThreshold: 0.75,
  transformObjectKeys: false,
  unicodeEscapeSequence: false,
};

/** Lighter options for Vite chunks / Electron helpers. */
const WEB_OBFUSCATE = {
  compact: true,
  controlFlowFlattening: false,
  deadCodeInjection: false,
  identifierNamesGenerator: "hexadecimal",
  renameGlobals: false,
  rotateStringArray: true,
  selfDefending: false,
  shuffleStringArray: true,
  splitStrings: false,
  stringArray: true,
  stringArrayEncoding: ["base64"],
  stringArrayThreshold: 0.5,
  transformObjectKeys: false,
  unicodeEscapeSequence: false,
};

const DESKTOP_OBFUSCATE = { ...WEB_OBFUSCATE, stringArrayThreshold: 0.65 };

function obfuscateCode(code, options) {
  return JavaScriptObfuscator.obfuscate(code, options).getObfuscatedCode();
}

function writeBootstrapMain(apiDistDir) {
  // integrity.json lives at app/integrity.json; this file is app/api/dist/main.js
  const bootstrap = `"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

function fail(msg) {
  console.error("[HotelSystem integrity] " + msg);
  process.exit(1);
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

const appRoot = path.join(__dirname, "..", "..");
const integrityPath = path.join(appRoot, "integrity.json");
if (!fs.existsSync(integrityPath)) fail("missing integrity.json");

let manifest;
try {
  manifest = JSON.parse(fs.readFileSync(integrityPath, "utf8"));
} catch {
  fail("invalid integrity.json");
}
if (!manifest || typeof manifest.files !== "object") fail("integrity.json has no files map");

for (const [rel, expected] of Object.entries(manifest.files)) {
  if (typeof expected !== "string" || !/^[a-f0-9]{64}$/i.test(expected)) fail("bad hash for " + rel);
  const abs = path.join(appRoot, rel.split("/").join(path.sep));
  if (!fs.existsSync(abs)) fail("missing protected file: " + rel);
  const actual = sha256(abs);
  if (actual.toLowerCase() !== expected.toLowerCase()) fail("tampered file: " + rel);
}

require("./app.protected.js");
`;
  const out = path.join(apiDistDir, "main.js");
  fs.writeFileSync(out, obfuscateCode(bootstrap, WEB_OBFUSCATE), "utf8");
}

async function protectApiDist(apiDistDir) {
  const entry = path.join(apiDistDir, "main.js");
  if (!fs.existsSync(entry)) die(`API entry missing: ${entry}`);

  const tmpBundle = path.join(apiDistDir, "_bundle.tmp.js");
  const protectedOut = path.join(apiDistDir, "app.protected.js");

  console.log("[protect-release] Bundling API dist with esbuild…");
  await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    platform: "node",
    format: "cjs",
    outfile: tmpBundle,
    packages: "external",
    sourcemap: false,
    legalComments: "none",
    keepNames: true,
    logLevel: "warning",
  });

  console.log("[protect-release] Obfuscating API bundle…");
  const bundled = fs.readFileSync(tmpBundle, "utf8");
  fs.unlinkSync(tmpBundle);
  fs.writeFileSync(protectedOut, obfuscateCode(bundled, API_OBFUSCATE), "utf8");

  // Remove readable Nest emit; keep only the protected blob (+ bootstrap written later).
  for (const file of walkFiles(apiDistDir, (f) => f.endsWith(".js"))) {
    const base = path.basename(file);
    if (base === "app.protected.js") continue;
    fs.unlinkSync(file);
  }
  // Empty leftover dirs from nest emit (optional cleanup)
  for (const dir of walkFiles(apiDistDir, () => false)) {
    /* no-op */
  }
  const dirs = [];
  function collectDirs(d) {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      if (!ent.isDirectory()) continue;
      const full = path.join(d, ent.name);
      collectDirs(full);
      dirs.push(full);
    }
  }
  collectDirs(apiDistDir);
  for (const d of dirs) {
    try {
      if (fs.readdirSync(d).length === 0) fs.rmdirSync(d);
    } catch {
      /* ignore */
    }
  }

  console.log(`[protect-release] API protected → ${protectedOut}`);
}

function protectWebDist(webDistDir) {
  if (!fs.existsSync(webDistDir)) {
    console.warn(`[protect-release] Web dist missing, skip: ${webDistDir}`);
    return;
  }
  const assets = path.join(webDistDir, "assets");
  const files = walkFiles(assets, (f) => f.endsWith(".js"));
  // Also obfuscate root-level JS (e.g. sw / workbox) if present
  for (const f of fs.readdirSync(webDistDir)) {
    const full = path.join(webDistDir, f);
    if (fs.statSync(full).isFile() && f.endsWith(".js")) files.push(full);
  }
  console.log(`[protect-release] Obfuscating ${files.length} web JS file(s)…`);
  for (const file of files) {
    const code = fs.readFileSync(file, "utf8");
    try {
      fs.writeFileSync(file, obfuscateCode(code, WEB_OBFUSCATE), "utf8");
    } catch (err) {
      console.warn(`[protect-release] Web obfuscate skipped ${path.basename(file)}: ${err.message}`);
    }
  }
  // Never ship maps
  for (const map of walkFiles(webDistDir, (f) => f.endsWith(".map"))) {
    fs.unlinkSync(map);
  }
}

function writeIntegrityManifest(appRoot, filesAbs) {
  const files = {};
  for (const abs of filesAbs) {
    const rel = relPosix(appRoot, abs);
    files[rel] = sha256File(abs);
  }
  const manifest = {
    version: 1,
    algorithm: "sha256",
    createdAt: new Date().toISOString(),
    files,
  };
  const out = path.join(appRoot, "integrity.json");
  fs.writeFileSync(out, JSON.stringify(manifest, null, 2), "utf8");
  console.log(`[protect-release] Wrote ${out} (${Object.keys(files).length} files)`);
  return out;
}

async function protectStage(stageDir) {
  const appRoot = path.join(stageDir, "app");
  const apiDist = path.join(appRoot, "api", "dist");
  const webDist = path.join(appRoot, "web", "dist");
  if (!fs.existsSync(apiDist)) die(`staged API dist missing: ${apiDist}`);

  await protectApiDist(apiDist);
  protectWebDist(webDist);

  const sealed = [];
  const protectedApi = path.join(apiDist, "app.protected.js");
  if (!fs.existsSync(protectedApi)) die("app.protected.js missing after protect");
  sealed.push(protectedApi);
  for (const f of walkFiles(webDist, (p) => p.endsWith(".js") || p.endsWith(".css") || p.endsWith(".html"))) {
    sealed.push(f);
  }

  writeIntegrityManifest(appRoot, sealed);
  writeBootstrapMain(apiDist);
  console.log("[protect-release] Stage API/web protection complete");
}

function protectDesktopSrc(desktopSrc) {
  if (!fs.existsSync(desktopSrc)) die(`desktop src missing: ${desktopSrc}`);

  const jsFiles = ["discovery.js", "print-agent.js", "auto-update.js", "preload.js"].map((n) =>
    path.join(desktopSrc, n),
  );
  for (const f of jsFiles) {
    if (!fs.existsSync(f)) die(`desktop file missing: ${f}`);
  }

  console.log("[protect-release] Obfuscating desktop helpers…");
  for (const f of jsFiles) {
    fs.writeFileSync(f, obfuscateCode(fs.readFileSync(f, "utf8"), DESKTOP_OBFUSCATE), "utf8");
  }

  const hashes = {};
  for (const f of jsFiles) {
    hashes[path.basename(f)] = sha256File(f);
  }

  const mainPath = path.join(desktopSrc, "main.js");
  if (!fs.existsSync(mainPath)) die(`desktop main missing: ${mainPath}`);
  const originalMain = fs.readFileSync(mainPath, "utf8");

  const verifyPrelude = `"use strict";
(function () {
  var fs = require("fs");
  var path = require("path");
  var crypto = require("crypto");
  var expected = ${JSON.stringify(hashes)};
  function fail(msg) {
    console.error("[HotelSystem desktop integrity] " + msg);
    try { require("electron").app.quit(); } catch (_) {}
    process.exit(1);
  }
  function sha256(file) {
    return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  }
  for (var name of Object.keys(expected)) {
    var abs = path.join(__dirname, name);
    if (!fs.existsSync(abs)) fail("missing " + name);
    if (sha256(abs).toLowerCase() !== expected[name].toLowerCase()) fail("tampered " + name);
  }
})();
`;

  console.log("[protect-release] Obfuscating desktop main.js with integrity prelude…");
  // Wrap app body in IIFE so obfuscator can rename top-level helpers (createWindow, etc.).
  const wrappedMain = `${verifyPrelude}\n(function () {\n${originalMain}\n})();\n`;
  fs.writeFileSync(mainPath, obfuscateCode(wrappedMain, DESKTOP_OBFUSCATE), "utf8");
  console.log("[protect-release] Desktop src protection complete");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || (!args.stage && !args.desktopSrc)) {
    console.log(`Usage:
  node scripts/protect-release.mjs --stage <build/stage>
  node scripts/protect-release.mjs --desktop-src <apps/desktop/src>
  node scripts/protect-release.mjs --stage <stage> --desktop-src <src>`);
    process.exit(args.help ? 0 : 1);
  }

  if (args.desktopSrc) {
    protectDesktopSrc(path.resolve(args.desktopSrc));
  }
  if (args.stage) {
    await protectStage(path.resolve(args.stage));
  }
}

main().catch((err) => {
  console.error("[protect-release] FAILED", err);
  process.exit(1);
});
