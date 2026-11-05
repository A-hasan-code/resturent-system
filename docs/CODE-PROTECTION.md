# Release code protection

Practical protection for **shipped Windows installs** only. Dev (`pnpm hotel:dev`) stays clear TypeScript/JS.

## What it does

| Surface | Protection |
|---------|------------|
| `app/api/dist` | esbuild bundle → `app.protected.js` + javascript-obfuscator; `main.js` is an integrity bootstrap |
| `app/web/dist` | Obfuscate JS assets; no source maps |
| `app/integrity.json` | SHA-256 seal over protected API blob + web JS/CSS/HTML |
| Desktop Electron | Obfuscated `src/*.js`, integrity prelude in `main.js`, `asar: true`, Electron fuses (`EnableEmbeddedAsarIntegrityValidation`, `OnlyLoadAppFromAsar`) |

If a sealed file is edited on the hotel PC, the API process exits with `[HotelSystem integrity] tampered file: …`.

## What it does **not** do

- Does not encrypt the GitHub source tree
- Does not make reverse-engineering mathematically impossible (anything that runs can be attacked with enough effort)
- Does not replace Authenticode signing — still configure `packaging/windows/signing.env` for client builds

## Release pipeline

`pnpm release` → [Build-Release.ps1](../packaging/windows/Build-Release.ps1):

1. Build API + web as usual  
2. Stage `app/api` + `app/web`  
3. `node scripts/protect-release.mjs --stage build/stage`  
4. Backup desktop `src` → protect in place → electron-builder → restore clear `src`

Manual:

```powershell
node .\scripts\protect-release.mjs --stage .\build\stage
node .\scripts\protect-release.mjs --desktop-src .\apps\desktop\src
```

## Smoke checks

```powershell
pnpm install
pnpm --filter @hotel/api run build
pnpm --filter @hotel/web run build
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\protect-release-smoke.ps1
```

Expect:

1. Protected stage has `app/api/dist/app.protected.js` (not readable Nest modules)  
2. Bootstrap starts past integrity when files match (may still fail later on missing DB/env — that is OK for this smoke)  
3. One-byte edit to a sealed file → process exits with integrity error  
