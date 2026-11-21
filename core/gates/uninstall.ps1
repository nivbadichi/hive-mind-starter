# Take Hive Mind out of a Claude folder on Windows. The work is done by core/install/install.mjs.
#   (no switch)  remove only the gates. The start step stays, as ONE entry (its "all" part, which fits under the cap).
#                Every file it changes is kept first as <name>.bak-<date-time>. The gate log and the per-chat records stay.
#   -All         put everything back the way it was before the first install: every file it replaced comes back from
#                its copy, every file and folder it added goes, and the copies go too. A file you changed after the
#                install is not thrown away: only Hive Mind's part is taken out, and the copy from before is kept.
#   powershell -NoProfile -ExecutionPolicy Bypass -File core\gates\uninstall.ps1 [-All] [-ClaudeDir X] [-DryRun]
param(
    [string]$ClaudeDir = (Join-Path $HOME '.claude'),
    [string]$Root = '',
    [switch]$All,
    [switch]$DryRun
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
if (-not $Root) { $Root = $(if ($env:HIVE_ROOT) { $env:HIVE_ROOT } else { Split-Path (Split-Path $PSScriptRoot) }) }
function Clean-Folder($p) { $t = $p.TrimEnd('\', '/'); if ($t -match ':$') { "$t\." } else { $t } }

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) {
    Write-Output 'STOPPED: node was not found. Nothing was changed.'
    Write-Output 'To take the gates out by hand: in settings.json in your Claude folder, remove every hook entry that names gates.mjs. Or install Node (https://nodejs.org, the LTS version) and run this again.'
    exit 1
}
$a = @((Join-Path (Split-Path $PSScriptRoot) 'install\install.mjs'), $(if ($All) { 'uninstall' } else { 'remove-gates' }), '--claude-dir', (Clean-Folder $ClaudeDir), '--root', (Clean-Folder $Root))
if ($DryRun) { $a += '--dry-run' }
& $node @a
exit $LASTEXITCODE
