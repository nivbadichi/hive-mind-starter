# Hive Mind start step, thin caller. The work is done by start.mjs (Node), the same program on Windows, Mac and Linux.
# Kept so a Claude settings entry that still runs "start.ps1 -Part rules|state|flight" keeps working.
# It finds start.mjs next to itself, else in the notebook (HIVE_ROOT, or "root" in <hive folder>/config.json, or ~/hive-mind).
param([string]$Part = 'all', [switch]$NoRefresh)
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$home1 = if ($env:HIVE_HOME) { $env:HIVE_HOME } else { $HOME }
$hive = if ($env:HIVE_STATE) { $env:HIVE_STATE } else { Join-Path $home1 '.claude\hive' }
$root = $env:HIVE_ROOT
if (-not $root) {
    try { $c = Get-Content (Join-Path $hive 'config.json') -Raw -Encoding UTF8 | ConvertFrom-Json; if ($c.root) { $root = [string]$c.root } elseif ($c.notebook) { $root = [string]$c.notebook } } catch {}
}
if (-not $root) { $root = Join-Path $home1 'hive-mind' }
$mjs = Join-Path $PSScriptRoot 'start.mjs'
if (-not (Test-Path $mjs)) { $mjs = Join-Path $root 'core\start\start.mjs' }
$hasNode = [bool](Get-Command node -ErrorAction SilentlyContinue)
if (-not (Test-Path $mjs) -or -not $hasNode) {
    try { [void][Console]::In.ReadToEnd() } catch {}
    $why = if (-not $hasNode) { 'Node.js is not installed, so the start step cannot run.' } else { "start.mjs was not found (looked next to this file and in $root)." }
    if ($Part -eq 'rules' -or $Part -eq 'all') {
        $o = @{ hookSpecificOutput = @{ hookEventName = 'SessionStart'; additionalContext = "HIVE MIND START: RED. $why Tell the person first, and do not pretend to remember anything." }; systemMessage = "HIVE MIND`n[!!] $why" }
        Write-Output ($o | ConvertTo-Json -Depth 4 -Compress)
    }
    exit 0
}
$a = @($mjs, '--part', $Part)
if ($NoRefresh) { $a += '--no-refresh' }
# node reads the hook's input itself, from this process's own standard input, byte for byte. Never read it here and pipe
# it on: Windows PowerShell 5.1 re-encodes a piped string and, on some computers, puts a byte-order mark before it, so
# start.mjs could not read the JSON and lost the chat's id and "compact" (the compaction notice never came).
& node @a
exit 0
