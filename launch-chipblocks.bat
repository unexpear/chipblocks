@echo off
title ChipBlocks
rem Launch ChipBlocks (dev build) from wherever this script lives.
cd /d "%~dp0"

rem Self-heal the known "Error: Electron uninstall" state -- the Electron
rem binary occasionally goes missing after npm operations.
if not exist "node_modules\electron\dist\electron.exe" (
  echo Restoring the Electron runtime...
  node node_modules\electron\install.js
)

echo Starting ChipBlocks... closing this window closes the app.
npm run dev
