# Hive Mind: publish your page with the notebook as it is now.
#   1. rewrite the snapshot (system/snapshot.mjs -> app/src/data/snapshot.json)
#   2. run the privacy check on the notebook, the snapshot included; anything but clean stops here
#   3. upload the app folder to Vercel (production)
# It prints one plain line at the end: the address, or why it stopped.
# Run it from anywhere: powershell -NoProfile -ExecutionPolicy Bypass -File system/publish.ps1
# (the bypass is for this run only; the health check inside the snapshot needs it too).
# Nothing is uploaded while the page's code is not in app/ (it is added at release).

param([string]$Root = (Split-Path -Parent $PSScriptRoot))

# Native commands report through exit codes, so errors are checked by hand, not by 'Stop'.
$ErrorActionPreference = 'Continue'

function Write-Outcome([string]$Text) {
    Write-Output $Text
}

# A hold: while the site is being rebuilt, nothing goes online, whoever runs this. The file names why; delete it to resume.
$hold = Join-Path $HOME '.claude\hive\publish-hold'
if (Test-Path $hold) { Write-Outcome ('Held: ' + ((Get-Content $hold -TotalCount 1) -join '')); exit 0 }

$guard = Join-Path $HOME '.claude\hive\privacy-guard.ps1'
$app = Join-Path $Root 'app'

if (-not (Test-Path (Join-Path $app 'package.json'))) {
    Write-Outcome "STOPPED: your page's code is not in the app folder yet. Nothing was uploaded."
    exit 1
}

# 1. The snapshot.
Push-Location $Root
try {
    $snapOut = & node (Join-Path $Root 'system\snapshot.mjs') 2>&1
    $snapCode = $LASTEXITCODE
} finally {
    Pop-Location
}
if ($snapCode -ne 0) {
    $why = ($snapOut | Where-Object { "$_".Trim() } | Select-Object -Last 1)
    Write-Outcome "STOPPED at the snapshot: $why"
    exit 1
}

# 2. The privacy check. 0 = clean; 1 = a secret or protected name; 2 = a personal detail to check.
if (-not (Test-Path $guard)) {
    Write-Outcome "STOPPED: the privacy check was not found at $guard. Nothing was uploaded."
    exit 1
}
$guardOut = & powershell -NoProfile -ExecutionPolicy Bypass -File $guard -Root $Root 2>&1
$guardCode = $LASTEXITCODE
if ($guardCode -eq 1) {
    $guardOut | ForEach-Object { Write-Output "  $_" }
    Write-Outcome "STOPPED by the privacy check: it found a secret or a protected name (where is listed above). Nothing was uploaded."
    exit 1
}
if ($guardCode -ne 0) {
    $guardOut | ForEach-Object { Write-Output "  $_" }
    Write-Outcome "STOPPED by the privacy check (code $guardCode): a personal detail needs a look first (listed above). Nothing was uploaded."
    exit 1
}

# 3. The upload. Vercel receives only the app folder.
Push-Location $app
try {
    $deployOut = & vercel deploy --yes --prod 2>&1
    $deployCode = $LASTEXITCODE
} finally {
    Pop-Location
}
$url = ($deployOut | ForEach-Object { "$_" } | Select-String -Pattern 'https://\S+\.vercel\.app' -AllMatches |
    ForEach-Object { $_.Matches.Value } | Select-Object -Last 1)
if ($deployCode -ne 0 -or -not $url) {
    $why = ($deployOut | ForEach-Object { "$_" } | Where-Object { $_.Trim() } | Select-Object -Last 1)
    Write-Outcome "STOPPED at the upload: $why"
    exit 1
}
# The release record of the private page. It goes to the state folder, not into the notebook: this script runs after every
# save, and a note changed after every save would never stay saved (and would start another save and another publish).
try {
    $stateDir = if ($env:HIVE_STATE) { $env:HIVE_STATE } else { Join-Path $HOME '.claude\hive' }
    $hash = (& git -C $Root rev-parse --short HEAD 2>$null)
    $line = "{0} | private page | {1} | {2}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm'), $hash, $url
    Add-Content -Path (Join-Path $stateDir 'releases.log') -Value $line -Encoding UTF8
} catch {}
Write-Outcome "Published: $url"
exit 0
