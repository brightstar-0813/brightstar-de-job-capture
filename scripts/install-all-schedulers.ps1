# Install both:
#  1) Capture daily at 5:00 AM and 5:00 PM
#  2) Local API at Windows logon (for JobRight extension ingest)
#
#   npm run schedule:install

$ErrorActionPreference = "Stop"
$here = $PSScriptRoot

& "$here\install-scheduler.ps1"
& "$here\install-api-autostart.ps1"

Write-Host ""
Write-Host "All set:"
Write-Host "  - DEJobCapture_5am5pm       (capture daily at 5 AM and 5 PM)"
Write-Host "  - DEJobCapture_API_AtLogon   (npm start equivalent at login)"
Write-Host "Keep Chrome signed in to JobRight; extension runs at 5 AM and 5 PM while Chrome is open."
