# Installs the feeder as a Windows service with NSSM (https://nssm.cc), so it starts on boot
# and restarts after crashes or Windows Update reboots. Run in an elevated PowerShell from the
# feeder folder after creating .venv and .env (see ../README.md).
#
#   powershell -ExecutionPolicy Bypass -File install\install-service.ps1

param(
  [string]$ServiceName = "mt5feeder",
  [string]$Nssm = "C:\tools\nssm\win64\nssm.exe"
)

$ErrorActionPreference = "Stop"
$root = (Resolve-Path "$PSScriptRoot\..").Path
$python = Join-Path $root ".venv\Scripts\python.exe"

if (-not (Test-Path $Nssm)) { throw "nssm.exe not found at $Nssm. Download it from https://nssm.cc/download." }
if (-not (Test-Path $python)) { throw "Create the virtualenv first: py -3.12 -m venv .venv; .venv\Scripts\pip install -e .[mt5]" }
if (-not (Test-Path (Join-Path $root ".env"))) { throw "Create .env from .env.example first." }

& $Nssm install $ServiceName $python "-m" "mt5feeder.main"
& $Nssm set $ServiceName AppDirectory $root
& $Nssm set $ServiceName AppStdout (Join-Path $root "feeder.log")
& $Nssm set $ServiceName AppStderr (Join-Path $root "feeder.log")
& $Nssm set $ServiceName AppRotateFiles 1
& $Nssm set $ServiceName AppRotateBytes 10485760
& $Nssm set $ServiceName AppRestartDelay 10000
& $Nssm set $ServiceName Start SERVICE_AUTO_START
# The MT5 terminal must run in the same user session as the service account that logs in to it.
Write-Host "Set the service to log on as the Windows user that runs MT5:"
Write-Host "  $Nssm set $ServiceName ObjectName .\<user> <password>"
& $Nssm start $ServiceName
Write-Host "Service $ServiceName installed. Logs: $root\feeder.log"
