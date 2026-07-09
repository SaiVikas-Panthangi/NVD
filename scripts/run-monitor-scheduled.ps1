$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

$hour = (Get-Date).Hour
if ($hour -lt 9 -or $hour -gt 23) {
  Write-Output "[$(Get-Date -Format o)] Skipped: outside allowed window (09:00-23:00)."
  exit 0
}

$logDir = Join-Path $repoRoot 'logs'
if (-not (Test-Path $logDir)) {
  New-Item -Path $logDir -ItemType Directory | Out-Null
}

$logFile = Join-Path $logDir ("monitor-schedule-" + (Get-Date -Format 'yyyy-MM-dd') + ".log")
$stamp = Get-Date -Format o

Write-Output "[$stamp] Starting scheduled monitor run..." | Tee-Object -FilePath $logFile -Append

& npm run monitor:run 2>&1 | Tee-Object -FilePath $logFile -Append
$exitCode = $LASTEXITCODE

Write-Output "[$(Get-Date -Format o)] Finished scheduled monitor run. ExitCode=$exitCode" | Tee-Object -FilePath $logFile -Append

exit 0
