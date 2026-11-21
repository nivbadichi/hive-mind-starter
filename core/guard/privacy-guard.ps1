# Hive Mind privacy guard. Looks for secrets and personal details in the notebook before it is saved.
# It never prints a secret, only where it found one.
# Exit code 0 = clean. 1 = STOP (a secret was found). 2 = CHECK, a warning only (an email address outside me/, a user-name path).
# What it reads: every file git knows about (saved or new), by its content, not by its ending. It skips only
# what is truly binary (a picture, a font, an archive, or any file with a zero byte in it) and what is generated
# (node_modules, lock files). A file too large to read is named in the output.
# The second look before a push, and the list of saves that skipped this check, are in privacy-guard.mjs.
param(
    [string]$Root = $(if ($env:HIVE_ROOT) { $env:HIVE_ROOT } else { Join-Path $HOME 'hive-mind' }),
    [string]$NamesFile = $(if ($env:HIVE_NAMES_FILE) { $env:HIVE_NAMES_FILE } else { Join-Path $HOME '.claude\hive\protected-names.txt' })
)
$ErrorActionPreference = 'SilentlyContinue'
$privateDir = 'me/'
$maxBytes = 5MB
$rules = New-Object System.Collections.Generic.List[object]
function Add-Rule([string]$name, [string]$pattern, [string]$only = '') {
    $rules.Add(@{ n = $name; only = $only; rx = (New-Object System.Text.RegularExpressions.Regex($pattern)) })
}
Add-Rule 'GitHub token'              'gh[pousr]_[A-Za-z0-9]{30,}'
Add-Rule 'GitHub fine-grained token' 'github_pat_[A-Za-z0-9_]{30,}'
Add-Rule 'API key (sk-)'             'sk-[A-Za-z0-9_-]{20,}'
Add-Rule 'AWS key id'                'AKIA[0-9A-Z]{16}'
Add-Rule 'Private key'               '-----BEGIN [A-Z ]*PRIVATE KEY-----'
Add-Rule 'Slack token'               'xox[baprs]-[A-Za-z0-9-]{10,}'
Add-Rule 'Google API key'            'AIza[0-9A-Za-z_-]{35}'
# [ \t] and not \s: a match must not run across a line break, so the line number stays true.
# In notes and settings the value may be bare; in a program it must be a quoted text, or a program that only reads its key from the settings would be taken for a leak.
Add-Rule 'Password or secret assignment' ('(?i)\b(password|passwd|secret|api[_-]?key|token)\b[ \t]*[:=][ \t]*["'']?[^\s"''<>]{8,}') 'notes'
Add-Rule 'Password or secret assignment' ('(?i)(?<![\w-])(password|passwd|secret|api[_-]?key|token)\b["'']?[ \t]*[:=][ \t]*(["''`])[^"''`\s<>$\\]{8,}\2') 'code'
# A path that holds the user name of this computer, and the chat's scratch folder. The name is never printed.
$me = if ($null -ne $env:HIVE_USER_NAME) { $env:HIVE_USER_NAME } else { $env:USERNAME }
$me = "$me".Trim()
$generic = @('user', 'users', 'admin', 'administrator', 'root', 'runner', 'ubuntu', 'vscode', 'node', 'default', 'public', 'guest')
if ($me.Length -ge 3 -and ($generic -notcontains $me.ToLower())) {
    Add-Rule 'a path that holds the user name of this computer' ('(?i)[\\/](?:Users|home)[\\/]+' + [regex]::Escape($me) + '(?![A-Za-z0-9_-])')
}
Add-Rule 'a path into the chat''s scratch folder' '(?i)AppData[\\/]+Local[\\/]+Temp[\\/]+claude'
# A path holding the user name only warns (the ruling of 2026-11-20, "Warn only, everywhere"): a CHECK at a save (exit 2, the save goes on).
$warnOnly = @('a path that holds the user name of this computer')
# Protected names (employers, clients, people): a list that lives ONLY on this PC, one name per line.
# The file is never part of the notebook. A match stops the save; the name is never printed.
if (Test-Path $NamesFile) {
    foreach ($n in (Get-Content $NamesFile -Encoding UTF8)) {
        $n = $n.Trim()
        if ($n.Length -ge 3 -and -not $n.StartsWith('#')) { Add-Rule 'a protected name' ('(?i)(?<![A-Za-z])' + [regex]::Escape($n) + '(?![A-Za-z])') }
    }
}
# An email address: something before the @, and a domain with a dot and letters after it. Only files with an @ are tried.
$emailRx = New-Object System.Text.RegularExpressions.Regex('[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}')
# Files that are programs get the stricter assignment rule.
$codeExt = '\.(mjs|cjs|js|jsx|ts|tsx|css|scss|html?|svg|sh|bash|py|rb|go|java|rs|c|cc|cpp|h|swift|kt|php|sql|vue|svelte|astro)$'
# Known test files that hold made-up keys on purpose: lines of "path | rule name" in core/guard/allowed-fixtures.txt,
# read from the notebook being checked. Only that rule is allowed in that file.
$allowed = @{}
$allowFile = Join-Path $Root 'core/guard/allowed-fixtures.txt'
if (Test-Path $allowFile) {
    foreach ($l in (Get-Content $allowFile -Encoding UTF8)) {
        $l = $l.Trim()
        if ($l -eq '' -or $l.StartsWith('#')) { continue }
        $parts = $l.Split('|')
        if ($parts.Count -lt 2) { continue }
        $allowed[$parts[0].Trim() + '|' + $parts[1].Trim()] = $true
    }
}
$allowedHits = 0
$generated = '(^|/)(node_modules|\.git|\.next|\.turbo|\.vercel)/|(^|/)(package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock)$'
$binaryExt = '\.(png|jpe?g|gif|webp|avif|ico|bmp|tiff?|psd|pdf|zip|gz|tgz|bz2|xz|7z|rar|woff2?|ttf|otf|eot|mp3|mp4|m4a|mov|wav|ogg|webm|mkv|flac|exe|dll|so|dylib|wasm|class|jar|pyc|node|bin|sqlite)$'

function Get-LineNumber([string]$text, [int]$index) {
    $count = 1
    $at = $text.IndexOf("`n")
    while ($at -ge 0 -and $at -lt $index) { $count++; $at = $text.IndexOf("`n", $at + 1) }
    return $count
}

$names = git -c core.quotepath=off -C $Root ls-files -co --exclude-standard
$stop = New-Object System.Collections.Generic.List[string]
$check = New-Object System.Collections.Generic.List[string]
$tooBig = New-Object System.Collections.Generic.List[string]
foreach ($rel in $names) {
    if ($rel -match $generated -or $rel -match $binaryExt) { continue }
    if ($rel -eq 'core/guard/privacy-guard.ps1') { continue }
    $path = Join-Path $Root $rel
    $info = New-Object System.IO.FileInfo($path)
    if (-not $info.Exists -or $info.Length -eq 0) { continue }
    if ($info.Length -gt $maxBytes) { $tooBig.Add($rel); continue }
    $bytes = [System.IO.File]::ReadAllBytes($path)
    if ([Array]::IndexOf($bytes, [byte]0, 0, [Math]::Min(8000, $bytes.Length)) -ge 0) { continue }
    $text = [System.Text.Encoding]::UTF8.GetString($bytes)
    $seen = New-Object System.Collections.Generic.HashSet[string]
    $kind = if ($rel -match $codeExt) { 'code' } else { 'notes' }
    foreach ($rule in $rules) {
        if ($rule.only -ne '' -and $rule.only -ne $kind) { continue }
        foreach ($m in $rule.rx.Matches($text)) {
            if ($allowed.ContainsKey("$rel|$($rule.n)")) { $allowedHits++; continue }
            $line = Get-LineNumber $text $m.Index
            if (-not $seen.Add("$($rule.n)@$line")) { continue }
            if ($warnOnly -contains $rule.n) { $check.Add("${rel}:$line - $($rule.n) (a warning: the save goes on)") }
            else { $stop.Add("${rel}:$line - looks like: $($rule.n) (value hidden)") }
        }
    }
    # A file listed as "path | email" holds an address its owner chose to make public.
    if ($text.Contains('@') -and -not $rel.StartsWith($privateDir) -and -not $allowed.ContainsKey("$rel|email")) {
        foreach ($m in $emailRx.Matches($text)) {
            # Addresses at domains that are set aside for examples and tests belong to nobody.
            if ($m.Value -match '(?i)@(?:[^@]*\.)?(example(\.(com|org|net))?|invalid|test|localhost)$') { continue }
            $line = Get-LineNumber $text $m.Index
            if ($seen.Add("email@$line")) { $check.Add("${rel}:$line - an email address outside your private notes (me/)") }
        }
    }
}
if ($stop.Count -gt 0) {
    Write-Output 'PRIVACY GUARD: STOP. Do not save or push. Remove these first:'
    $stop | ForEach-Object { Write-Output $_ }
    exit 1
}
if ($check.Count -gt 0) {
    Write-Output 'PRIVACY GUARD: CHECK. Personal details found in the shareable part:'
    $check | ForEach-Object { Write-Output $_ }
    exit 2
}
$notes = @()
if ($allowedHits -gt 0) { $notes += "$allowedHits made-up keys in known test files let through, listed in core/guard/allowed-fixtures.txt" }
$notes += @($tooBig | ForEach-Object { "not read, too large: $_" })
if ($notes.Count -gt 0) { Write-Output ('PRIVACY GUARD: CLEAN (' + ($notes -join '; ') + ')') } else { Write-Output 'PRIVACY GUARD: CLEAN' }
exit 0
