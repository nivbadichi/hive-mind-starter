# Install Hive Mind on Windows. This is the front door: it checks for Node and Git, then hands the work to
# core/install/install.mjs, the one installer for Windows, Mac and Linux (on a Mac or Linux: sh core/install/install.sh).
# What it puts in place: the start step, the privacy check, the gates, the helpers, the hooks in settings.json (merged:
# your other hooks and settings stay), the Hive Mind block in CLAUDE.md, the save hook in the notebook (when it is a Git
# folder), and hive/config.json, which says where the notebook is, so the notebook can be in any folder.
# Safe to run again: a file that already matches is left alone; a file it replaces is kept first as <name>.bak-<date-time>.
# A dry run does not promise a backup name (the real run stamps its own time); it says .bak-<date-time>.
# To undo all of it: core\gates\uninstall.ps1 -All.
#   powershell -NoProfile -ExecutionPolicy Bypass -File core\gates\install.ps1                 (your ~/.claude)
#   powershell -NoProfile -ExecutionPolicy Bypass -File core\gates\install.ps1 -ClaudeDir X     (a test folder)
#   add -DryRun to only list what would change; -Root Y for a notebook in another folder than the one this file is in
param(
    [string]$ClaudeDir = (Join-Path $HOME '.claude'),
    [string]$Root = '',
    [switch]$DryRun
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
# The notebook: -Root, else HIVE_ROOT, else the notebook this file sits in (core\gates\ is two folders down).
if (-not $Root) { $Root = $(if ($env:HIVE_ROOT) { $env:HIVE_ROOT } else { Split-Path (Split-Path $PSScriptRoot) }) }
# A folder name ending in \ would swallow the closing quote when passed on to Node; drop it.
function Clean-Folder($p) { $t = $p.TrimEnd('\', '/'); if ($t -match ':$') { "$t\." } else { $t } }

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) {
    Write-Output 'STOPPED: node was not found. Nothing was changed.'
    Write-Output 'Node is not on this computer yet. Node is a free program that Hive Mind needs for its checks and for the start of every chat. Ask Claude to install Node, or install the LTS version from https://nodejs.org yourself. Then quit the Claude app completely, open it again, and say: add the small parts.'
    exit 1
}
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Output 'Note: Git was not found. The install goes ahead, but saving the notebook (and the privacy check before each save) needs Git, a free program from https://git-scm.com.'
}
$a = @((Join-Path (Split-Path $PSScriptRoot) 'install\install.mjs'), 'install', '--claude-dir', (Clean-Folder $ClaudeDir), '--root', (Clean-Folder $Root))
if ($DryRun) { $a += '--dry-run' }
& $node @a
exit $LASTEXITCODE
