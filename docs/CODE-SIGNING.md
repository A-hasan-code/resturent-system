# Hotel System — Windows code signing (professional releases)

Professional installers (Chrome, Adobe, Zoom, …) are **Authenticode-signed** with a certificate from a CA in the [Microsoft Trusted Root Program](https://learn.microsoft.com/security/trusted-root/participants-list). That is what lets them install with Smart App Control, SmartScreen, and App Control **enabled**.

Turning off Defender / Smart App Control is **not** a product solution. This project follows Microsoft’s documented path:

> Sign every EXE/DLL/installer/uninstaller you ship with an **RSA** SHA-256 signature and a trusted timestamp.  
> See: [Sign your app for Smart App Control compliance](https://learn.microsoft.com/en-us/windows/apps/develop/smart-app-control/code-signing-for-smart-app-control)

## What gets signed

| Artifact | When |
|----------|------|
| Desktop app `Hotel System.exe` (+ our DLLs if unsigned) | After Electron pack, before Inno |
| WinSW wrapper if unsigned | Stage |
| Inno Setup outer `HotelSystem-Setup-<ver>.exe` | During `ISCC` (`SignTool`) |
| Inno **uninstaller** / inner setup stub | `SignedUninstaller=yes` (same SignTool) |

Vendor binaries that are already validly signed (official Node.js, PostgreSQL, Electron framework) are left as-is.

## Local development signing (this PC only)

For testing on **your** machine without buying a public cert:

```powershell
cd packaging\windows
powershell -ExecutionPolicy Bypass -File .\New-LocalDevCerts.ps1
# Admin once — trusts Pixalbotics Root CA on this PC:
powershell -ExecutionPolicy Bypass -File .\New-LocalDevCerts.ps1 -InstallTrust
```

This creates `certs\Pixalbotics-RootCA.crt` + `Pixalbotics-CodeSign.pfx` and writes `signing.env`.

**Limits:** other hotel PCs and Windows 11 Smart App Control still require a **public** Authenticode certificate. Local CA ≠ customer-ready.

## 1. Obtain a certificate (customer releases)

Pick **one**:

### A) Azure Trusted Signing (recommended)

Microsoft’s cloud signing service — designed for Win32 + Smart App Control.

1. Create an Azure subscription and a Trusted Signing account + certificate profile.  
2. Install the Trusted Signing client / dlib (`Azure.CodeSigning.Dlib.dll`).  
3. Create `metadata.json` for your account/profile/endpoint.  
4. `az login` (or use a service principal).  
5. Fill **Method A** in `packaging/windows/signing.env` (from `signing.env.example`).

Docs: https://learn.microsoft.com/azure/trusted-signing/

### B) OV / EV code signing from a public CA

Buy from DigiCert, Sectigo, SSL.com, GlobalSign, etc.  
Since mid-2023 most CAs require the private key on hardware / cloud HSM (not a loose soft PFX). Follow your CA’s Windows signing instructions, then use **Method B or C** in `signing.env`.

- **EV** — strongest SmartScreen reputation for new publishers.  
- **OV** — valid for SAC when the CA is in the Microsoft Root Program; SmartScreen reputation builds with downloads over time.

### Cost / time (typical)

| Option | Rough cost | Notes |
|--------|------------|--------|
| Azure Trusted Signing | Low monthly Azure cost | Fastest path for many ISVs |
| OV code signing | ~USD 200–400 / year | Identity verification required |
| EV code signing | ~USD 300–600 / year | Stronger immediate SmartScreen trust |

**We cannot generate a publicly trusted cert inside this repo.** That would not be trusted by Windows. You (or your company Pixalbotics) must purchase / enroll for one.

## 2. Install signing tools on the build PC

```powershell
# Windows SDK — includes signtool.exe
winget install Microsoft.WindowsSDK.10.0.26100 --accept-package-agreements
# Or Visual Studio Installer → Individual components → "ClickOnce Publishing" / Windows SDK Signing Tools
```

Confirm:

```powershell
Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin" -Recurse -Filter signtool.exe |
  Where-Object FullName -match '\\x64\\'
```

## 3. Configure this project

```powershell
cd packaging\windows
copy signing.env.example signing.env
# edit signing.env — fill ONE method; never commit signing.env
```

`signing.env` is git-ignored via the usual secrets pattern; keep passwords out of git.

## 4. Build a signed release

```powershell
# Soft mode: signs if configured; warns if not
pnpm release

# Hard mode: fail the build unless signing succeeds
$env:HOTEL_SIGN_REQUIRED = "1"
pnpm release
# or:
.\packaging\windows\Build-Release.ps1 -RequireSign -SkipAndroid
```

## 5. Verify before sending to clients

```powershell
Get-AuthenticodeSignature .\releases\v1.3.0\HotelSystem-Setup-1.3.0.exe |
  Format-List Status, SignerCertificate, TimeStamperCertificate

# Status must be Valid. Signer CA must be publicly trusted (not a self-signed test cert).
```

Self-signed / internal CA certificates **do not** satisfy Smart App Control on customer PCs.

## 6. Test on a clean Windows 11 PC

1. Keep **Smart App Control** On (or Evaluation).  
2. Keep Defender real-time protection On.  
3. Run the signed Setup from USB / email / local disk.  
4. Install should proceed without Error 4551 and without asking to disable security.

Microsoft’s SAC test guidance:  
https://learn.microsoft.com/en-us/windows/apps/develop/smart-app-control/test-your-app-with-smart-app-control

## What we will not do

- Disable Smart App Control / Defender as part of the product install  
- “Bypass” Application Control  
- Ship self-signed EXEs as if they were production releases  

Those break customer trust and fail on locked-down PCs.

## After you have a cert

1. Configure `signing.env`  
2. Rebuild with `-RequireSign`  
3. Verify `Status = Valid`  
4. Distribute only the signed `HotelSystem-Setup-*.exe`  

Until a trusted cert is configured, unsigned builds remain **dev / internal-only**.
