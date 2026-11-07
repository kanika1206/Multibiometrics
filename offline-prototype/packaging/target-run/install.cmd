@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-candidate.ps1" -PayloadDirectory "%~dp0payload" -Version p1-20261102-r1
pause
