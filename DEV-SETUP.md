# Developer Setup Guide

This project is stored on Google Drive for source-file sync, but must be
developed from a **local drive** — Google Drive's virtual filesystem does not
support the symlinks that pnpm requires.

---

## First-time setup on a new dev machine (Windows)

### 1. Install Node.js
```powershell
winget install OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
```
Restart your terminal after this step.

### 2. Install pnpm
```powershell
npm install -g pnpm
```

### 3. Copy the project to local drive
```powershell
robocopy "G:\My Drive\Claude-code projects\Password vault" "C:\dev\password-vault" /E /XD node_modules .git
```
> Adjust the Google Drive path if your Drive is mounted on a different letter.

### 4. Install dependencies
```powershell
cd C:\dev\password-vault
pnpm install
```

### 5. Open in VS Code
```powershell
code C:\dev\password-vault
```

---

## Keeping in sync with Google Drive

Source files (`.ts`, `.json`, configs) should be kept in sync between
`C:\dev\password-vault` and this Google Drive folder. Use git:

```powershell
# From C:\dev\password-vault
git add .
git commit -m "your message"
```

`node_modules` is never synced — each machine runs its own `pnpm install`.

---

## Uninstall / cleanup (remove the dev environment entirely)

Run these in order in a PowerShell terminal:

```powershell
# 1. Remove project working copy
Remove-Item -Recurse -Force "C:\dev\password-vault"

# 2. Remove pnpm stores
Remove-Item -Recurse -Force "C:\Users\$env:USERNAME\.pnpm-store" -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force "C:\dev-modules" -ErrorAction SilentlyContinue

# 3. Remove pnpm global install
npm uninstall -g pnpm

# 4. Uninstall Node.js
winget uninstall OpenJS.NodeJS.LTS
```

---

## Why local drive?

Google Drive on Windows uses a virtual filesystem that does not support NTFS
symlinks. pnpm uses symlinks internally even with `node-linker=hoisted`.
Installing directly into Google Drive causes `ERR_PNPM_EISDIR` errors.
