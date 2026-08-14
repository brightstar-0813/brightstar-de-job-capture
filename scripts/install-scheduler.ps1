# Register a Windows Scheduled Task to run capture daily at 5:00 AM and 5:00 PM (local time).
#   npm run schedule:install
# or:
#   powershell -ExecutionPolicy Bypass -File scripts\install-scheduler.ps1

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$taskName = "AIJobCapture_5am5pm"
$legacyTaskNames = @(
  "AIJobCapture_Every8Hours",
  "AIJobCapture_Every12Hours",
  "DiceJobCapture_5am5pm",
  "DiceJobCapture_Every8Hours",
  "DiceJobCapture_Every12Hours"
)

$nodeCandidates = @(
  "$env:LOCALAPPDATA\nvm\v20.12.2\node.exe",
  "$env:LOCALAPPDATA\nvm\v20.19.0\node.exe",
  "$env:ProgramFiles\nodejs\node.exe"
)
$cmd = Get-Command node -ErrorAction SilentlyContinue
if ($cmd) { $nodeCandidates += $cmd.Source }

$nodeExe = $nodeCandidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
if (-not $nodeExe) {
  throw "node.exe not found. Install Node 20 / nvm first."
}

Write-Host "Using node: $nodeExe"
Write-Host "Working dir: $root"

$action = New-ScheduledTaskAction `
  -Execute $nodeExe `
  -Argument "src\capture.js" `
  -WorkingDirectory $root

$triggerAm = New-ScheduledTaskTrigger -Daily -At "5:00AM"
$triggerPm = New-ScheduledTaskTrigger -Daily -At "5:00PM"

$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -MultipleInstances IgnoreNew

# Run whether the user is logged on or not (S4U = no stored password needed).
$principal = New-ScheduledTaskPrincipal `
  -UserId "$env:USERDOMAIN\$env:USERNAME" `
  -LogonType S4U `
  -RunLevel Limited

Register-ScheduledTask `
  -TaskName $taskName `
  -Action $action `
  -Trigger @($triggerAm, $triggerPm) `
  -Settings $settings `
  -Principal $principal `
  -Description "Capture US-remote data engineering jobs daily at 5:00 AM and 5:00 PM" `
  -Force | Out-Null

foreach ($legacyTaskName in $legacyTaskNames) {
  $legacy = Get-ScheduledTask -TaskName $legacyTaskName -ErrorAction SilentlyContinue
  if ($legacy) {
    Unregister-ScheduledTask -TaskName $legacyTaskName -Confirm:$false
    Write-Host "Removed legacy task '$legacyTaskName'."
  }
}

Write-Host "Scheduled task '$taskName' installed (daily 5:00 AM and 5:00 PM local, runs whether logged on or not)."
Write-Host "Run now:  Start-ScheduledTask -TaskName '$taskName'"
Write-Host "JobRight: use Chrome extension + API autostart (npm run schedule:api)"
