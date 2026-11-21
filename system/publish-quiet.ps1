# Hive Mind: refresh your page in the background after a save. Started by the notebook's
# post-commit step. Never blocks a save. One run at a time; writes one line per run to a log.
$ErrorActionPreference = 'SilentlyContinue'
$root = Split-Path -Parent $PSScriptRoot
$hive = Join-Path $HOME '.claude\hive'
$lock = Join-Path $hive 'publish.lock'
$log  = Join-Path $hive 'publish.log'
if (-not (Test-Path (Join-Path $root 'app\package.json'))) { exit 0 }
# A hold: while the site is being rebuilt, a half-built page must not go online. The file names why; delete it to resume.
$hold = Join-Path $hive 'publish-hold'
if (Test-Path $hold) { Add-Content -Path $log -Value ("{0}  Held: {1}" -f (Get-Date -Format s), ((Get-Content $hold -TotalCount 1) -join '')) -Encoding UTF8; exit 0 }
if ((Test-Path $lock) -and ((Get-Item $lock).LastWriteTime -gt (Get-Date).AddMinutes(-6))) { exit 0 }
Set-Content -Path $lock -Value (Get-Date -Format o) -Encoding UTF8
Start-Sleep -Seconds 20   # let a burst of saves settle, so one upload covers them
$out = & (Join-Path $root 'system\publish.ps1') -Root $root 2>&1 | Select-Object -Last 1
Add-Content -Path $log -Value ("{0}  {1}" -f (Get-Date -Format s), $out) -Encoding UTF8
Remove-Item $lock -Force
exit 0
