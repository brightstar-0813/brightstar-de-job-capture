# Start the local API (npm start / src/server.js) automatically at Windows logon.
# Needed so the Chrome extension can POST JobRight jobs to http://127.0.0.1:3847
#
#   npm run schedule:api
# or:
#   powershell -ExecutionPolicy Bypass -File scripts\install-api-autostart.ps1

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$taskName = "DEJobCapture_API_AtLogon"
$legacyTaskNames = @(
  "AIJobCapture_API_AtLogon",
  "DiceJobCapture_API_AtLogon"
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
  -Argument "src\server.js" `
  -WorkingDirectory $root

$trigger = New-ScheduledTaskTrigger -AtLogOn

$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -RestartCount 3 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -MultipleInstances IgnoreNew

Register-ScheduledTask `
  -TaskName $taskName `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Description "Keep ai-jobs-capture local API running so JobRight Chrome extension can ingest jobs" `
  -Force | Out-Null

foreach ($legacyTaskName in $legacyTaskNames) {
  $legacy = Get-ScheduledTask -TaskName $legacyTaskName -ErrorAction SilentlyContinue
  if ($legacy) {
    Unregister-ScheduledTask -TaskName $legacyTaskName -Confirm:$false
    Write-Host "Removed legacy task '$legacyTaskName'."
  }
}

Write-Host "Scheduled task '$taskName' installed (At logon -> node src/server.js)."
Write-Host "Start now:  Start-ScheduledTask -TaskName '$taskName'"
Write-Host "API will listen on http://127.0.0.1:3847"
