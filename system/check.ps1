# Hive Mind health check. Checks facts, changes nothing.
# Prints one line per check: OK or NEEDS YOU, then a short summary.
# The notebook is ~/hive-mind and Claude's folder is ~/.claude, unless -Root / HIVE_ROOT or -ClaudeDir say otherwise.
param(
    [string]$Root = $(if ($env:HIVE_ROOT) { $env:HIVE_ROOT } else { Join-Path $HOME 'hive-mind' }),
    [string]$ClaudeDir = (Join-Path $HOME '.claude')
)
$ErrorActionPreference = 'SilentlyContinue'
$claude = $ClaudeDir
$hive = Join-Path $claude 'hive'
$bad = New-Object System.Collections.Generic.List[string]
$ok = 0
function Report-Line($pass, $text) {
    if ($pass) { $script:ok++; Write-Output "OK         $text" }
    else { $script:bad.Add($text); Write-Output "NEEDS YOU  $text" }
}
function Same-Text($a, $b) {
    if (-not (Test-Path $a) -or -not (Test-Path $b)) { return $false }
    ((Get-Content $a -Raw) -replace "`r`n", "`n") -eq ((Get-Content $b -Raw) -replace "`r`n", "`n")
}

# 1. Installed parts match the notebook
$pairs = @(
    @('core\start\start.ps1', (Join-Path $hive 'start.ps1')),
    @('core\guard\privacy-guard.ps1', (Join-Path $hive 'privacy-guard.ps1')),
    @('core\gates\gates.mjs', (Join-Path $hive 'gates\gates.mjs'))
)
foreach ($d in (Get-ChildItem (Join-Path $Root 'core\skills') -Directory)) {
    $pairs += , @("core\skills\$($d.Name)\SKILL.md", (Join-Path $claude "skills\$($d.Name)\SKILL.md"))
}
foreach ($p in $pairs) {
    $src = Join-Path $Root $p[0]
    if (-not (Test-Path $p[1])) { Report-Line $false "Not installed: $($p[0])" }
    else { Report-Line (Same-Text $src $p[1]) "Installed copy matches the notebook: $($p[0])" }
}

# 2. The start step, the rule block and the privacy check are connected
$settings = Get-Content (Join-Path $claude 'settings.json') -Raw
foreach ($p in @('rules', 'state', 'flight')) { Report-Line ($settings -match "hive\\\\start\.ps1\\`" -Part $p") "The start step part '$p' is connected" }
foreach ($m in @('pretool', 'posttool', 'prompt', 'stop', 'precompact')) { Report-Line ($settings -match "gates\.mjs`",\s*`"$m`"") "The gate '$m' is connected" }
$rulesFile = Get-Content (Join-Path $claude 'CLAUDE.md') -Raw
Report-Line ([bool]$rulesFile) 'The Claude rules file can be read'
Report-Line ([bool]$rulesFile -and -not ($rulesFile -match '@~/hive-mind/(memory|system)/rules\.md')) 'The rules are handed over by the start step, not loaded early'
Report-Line (($rulesFile -match 'hive-mind:start') -and ($rulesFile -match 'hive-mind:end')) 'The rule block is in the Claude rules file'
Report-Line (Test-Path (Join-Path $Root '.git\hooks\pre-commit')) 'The privacy check runs at every save point'
Report-Line (Test-Path (Join-Path $Root '.git\hooks\post-commit')) 'The dashboard refreshes after every save point'
$pl = Join-Path $hive 'publish.log'
if (Test-Path $pl) { $last = Get-Content $pl -Tail 1; Report-Line ($last -match 'Published:|Held:') ('The last dashboard refresh worked' + $(if ($last -notmatch 'Published:') { ' (' + $last + ')' })) }

# 3b. The gates: on, not broken, and how often they had to act this week
#     Only measured where the gates are installed: a count over a gate that never ran would pass on nothing.
if (Test-Path (Join-Path $hive 'gates\gates.mjs')) {
Report-Line (-not (Test-Path (Join-Path $hive 'gates-off'))) 'The gates are switched on (no gates-off file)'
$gl = Join-Path $hive 'gates.log'
$week = (Get-Date).AddDays(-7)
$ev = @()
if (Test-Path $gl) { $ev = @(Get-Content $gl -Encoding UTF8 | ForEach-Object { try { $_ | ConvertFrom-Json } catch {} } | Where-Object { $_ -and ([datetime]$_.t) -gt $week }) }
$broken = @($ev | Where-Object { $_.event -eq 'error' -or $_.event -eq 'timeout' })
Report-Line ($broken.Count -eq 0) ("No gate broke in the last 7 days" + $(if ($broken.Count) { " ($($broken.Count) times; it let the work through each time; see gates.log)" }))
$gs = Get-Content (Join-Path $Root 'core\gates\settings.json') -Raw | ConvertFrom-Json
$max = 20; if ($gs -and $gs.health.maxMissesPerWeek) { $max = [int]$gs.health.maxMissesPerWeek }
$denies = @($ev | Where-Object { $_.event -eq 'deny' }).Count
$sendbacks = @($ev | Where-Object { $_.event -eq 'stop-sendback' }).Count
Report-Line (($denies + $sendbacks) -le $max) "Discipline this week: $denies steps refused, $sendbacks replies sent back (the line is $max)"
}

# 3. No installed helper calls a helper that is not installed
$installed = (Get-ChildItem (Join-Path $claude 'skills') -Directory).Name
foreach ($d in (Get-ChildItem (Join-Path $claude 'skills') -Directory -Filter 'hive-*')) {
    $text = Get-Content (Join-Path $d.FullName 'SKILL.md') -Raw
    $missing = @([regex]::Matches($text, '`(hive-[a-z]+)`') | ForEach-Object { $_.Groups[1].Value } | Sort-Object -Unique | Where-Object { $installed -notcontains $_ })
    Report-Line ($missing.Count -eq 0) ("Helper $($d.Name) calls only installed helpers" + $(if ($missing.Count) { " (missing: $($missing -join ', '))" }))
}

# 3b. The gates: on, not broken, and how often they had to act this week.
#     Only measured where the gates are installed: a count over a gate that never ran would pass on nothing.
if (Test-Path (Join-Path $hive 'gates\gates.mjs')) {
    Report-Line (-not (Test-Path (Join-Path $hive 'gates-off'))) 'The gates are switched on (no gates-off file)'
    $gl = Join-Path $hive 'gates.log'
    $week = (Get-Date).AddDays(-7)
    $ev = @()
    if (Test-Path $gl) { $ev = @(Get-Content $gl -Encoding UTF8 | ForEach-Object { try { $_ | ConvertFrom-Json } catch {} } | Where-Object { $_ -and ([datetime]$_.t) -gt $week }) }
    $broken = @($ev | Where-Object { $_.event -eq 'error' -or $_.event -eq 'timeout' })
    Report-Line ($broken.Count -eq 0) ("No gate broke in the last 7 days" + $(if ($broken.Count) { " ($($broken.Count) times; it let the work through each time; see gates.log)" }))
    $gs = Get-Content (Join-Path $Root 'core\gates\settings.json') -Raw | ConvertFrom-Json
    $max = 20; if ($gs -and $gs.health.maxMissesPerWeek) { $max = [int]$gs.health.maxMissesPerWeek }
    $denies = @($ev | Where-Object { $_.event -eq 'deny' }).Count
    $sendbacks = @($ev | Where-Object { $_.event -eq 'stop-sendback' }).Count
    Report-Line (($denies + $sendbacks) -le $max) "Discipline this week: $denies steps refused, $sendbacks replies sent back (the line is $max)"
}

# 4. The notebook and GitHub
$status = @(git -C $Root status --porcelain)
Report-Line ($status.Count -eq 0) ("Everything in the notebook is saved" + $(if ($status.Count) { " ($($status.Count) unsaved)" }))
$branch = (git -C $Root branch --show-current)
$upstream = (git -C $Root rev-parse --abbrev-ref '@{u}' 2>$null)
if ($upstream) {
    $ahead = [int](git -C $Root rev-list --count '@{u}..HEAD')
    Report-Line ($ahead -eq 0) ("The notebook matches GitHub" + $(if ($ahead) { " ($ahead save points not on GitHub)" }))
} else { Report-Line $false "Branch '$branch' is not on GitHub yet" }

# 5. Set up, and every project has a short, dated state with a next step
Report-Line (Test-Path (Join-Path $Root 'me\profile.md')) 'The first conversation is done (me/profile.md exists)'
foreach ($d in (Get-ChildItem (Join-Path $Root 'projects') -Directory)) {
    $s = Join-Path $d.FullName 'state.md'
    if (-not (Test-Path $s)) { Report-Line $false "Project $($d.Name) has no state note"; continue }
    $t = Get-Content $s -Raw
    $hasAll = $true
    foreach ($k in @('project', 'kind', 'stage', 'health', 'next_step', 'needs_you', 'updated')) { if ($t -notmatch "(?m)^${k}:\s*\S") { $hasAll = $false } }
    Report-Line $hasAll "Project $($d.Name): state has every field"
    Report-Line ($t.Length -le 2500) "Project $($d.Name): state is short"
    # The stage starts with one of the fixed stage words (the life cycle).
    $stage = ''; if ($t -match '(?m)^stage:\s*(.+?)\s*$') { $stage = $Matches[1] }
    Report-Line ($stage -match '^(?i)(discover|define|plan|design|build|verify|release|maintain|close|paused|not set up)\b') "Project $($d.Name): stage starts with a stage word (discover, define, plan, design, build, verify, release, maintain, close, paused, not set up)$(if ($stage) { " [now: $stage]" })"
    if ($t -match '(?m)^updated:\s*(\d{4}-\d{2}-\d{2})') {
        $age = [int]((Get-Date) - [datetime]::ParseExact($Matches[1], 'yyyy-MM-dd', $null)).TotalDays
        Report-Line ($age -le 14) "Project $($d.Name): state updated in the last 14 days"
    }
}

# 6b. Lessons must close: a lesson dated more than three days ago needs "closed_by: <the check, helper or rule that changed>" on its line.
#     Old lessons are not edited by this check; it only counts them.
$lessonFile = Join-Path $Root 'system\lessons.md'
if (Test-Path $lessonFile) {
    $cut3 = (Get-Date).Date.AddDays(-3); $open = 0
    foreach ($l in (Get-Content $lessonFile -Encoding UTF8)) {
        if ($l -notmatch '^\s*-\s' -or $l -match 'closed_by:') { continue }
        if ($l -match '(\d{4}-\d{2}-\d{2})') { try { if ([datetime]::ParseExact($Matches[1], 'yyyy-MM-dd', $null) -lt $cut3) { $open++ } } catch {} }
    }
    Report-Line ($open -eq 0) ("Every lesson older than 3 days is closed (has closed_by:)" + $(if ($open) { " ($open still open: each needs the check, helper or rule that changed because of it)" }))
}

# 7. The start message fits. Repaired 2026-11-16: this used to compare the start note with 6,000 characters while the start
#    step cut it at 3,500, and never measured the whole message against the app's 10,000 limit. Now it builds every part
#    from the notebook as it is (no refresh, no record written) and measures what Claude would receive.
$startScript = Join-Path $Root 'core\start\start.ps1'
$probe = (@{ session_id = ''; cwd = $Root; source = 'startup' } | ConvertTo-Json -Compress)
$rulesText = ''
$env:HIVE_ROOT = $Root
foreach ($p in @('rules', 'state', 'flight', 'all')) {
    $raw = $probe | powershell -NoProfile -ExecutionPolicy Bypass -File $startScript -Part $p -NoRefresh
    $ctx = ''
    try { $ctx = (($raw -join "`n") | ConvertFrom-Json).hookSpecificOutput.additionalContext } catch {}
    if ($p -eq 'rules') { $rulesText = $ctx }
    if ($p -eq 'flight' -and -not $ctx) { Report-Line $true "Start part '$p' is empty here (not a Hive Mind folder)"; continue }
    Report-Line ($ctx.Length -gt 0 -and $ctx.Length -le 9000) "Start part '$p' fits: $($ctx.Length) of 9000 characters"
}
$ruleLines = @((Get-Content (Join-Path $Root 'system\rules.md') -Encoding UTF8) | Where-Object { $_ -match '^\d+\.\s' })
$lost = @($ruleLines | Where-Object { -not $rulesText.Contains($_.Trim()) })
Report-Line ($ruleLines.Count -ge 1 -and $lost.Count -eq 0) ("All $($ruleLines.Count) rules arrive whole in the first start part" + $(if ($lost.Count) { " (missing: $($lost.Count))" }))

# 6b. Every project at a design or build stage names its design direction (the design gate reads it)
foreach ($d in (Get-ChildItem (Join-Path $Root 'projects') -Directory)) {
    $s = Join-Path $d.FullName 'state.md'
    if (-not (Test-Path $s)) { continue }
    $t = Get-Content $s -Raw
    if ($t -match '(?m)^stage:\s*(design|build)') {
        $dd = ''; if ($t -match '(?m)^design_direction:\s*(.+?)\s*$') { $dd = $Matches[1] }
        $okDir = ($dd -match '^none\b') -or ($dd -and (Test-Path (Join-Path $Root $dd)))
        Report-Line $okDir "Project $($d.Name): names its design direction note ($(if ($dd) { $dd } else { 'missing: add design_direction: to its state header' }))"
    }
}

# 6c. The gates pass their own tests (temporary folders only), where Node is available
$gt = Join-Path $Root 'core\gates\test.mjs'
if ((Test-Path $gt) -and (Get-Command node -ErrorAction SilentlyContinue)) { node $gt --quiet | Out-Null; Report-Line ($LASTEXITCODE -eq 0) 'The gates pass their own tests' }

# 6d. The guards of the daily run pass their own tests, and every end is in step (rule 15), where Node is available
if (Get-Command node -ErrorAction SilentlyContinue) {
    $gdt = Join-Path $Root 'core\engine\guards.test.mjs'
    if (Test-Path $gdt) { node --test $gdt 2>&1 | Out-Null; Report-Line ($LASTEXITCODE -eq 0) 'The guards of the daily run pass their own tests' }
    $ec = Join-Path $Root 'system\ends-check.mjs'
    if (Test-Path $ec) {
        $env:HIVE_ROOT = $Root
        foreach ($l in (node $ec)) { $parts = "$l" -split '\|', 2; if ($parts.Count -eq 2) { Report-Line ($parts[0] -eq 'OK') $parts[1] } }
    }
}

# 7. Privacy
$guard = Join-Path $hive 'privacy-guard.ps1'
if (-not (Test-Path $guard)) { $guard = Join-Path $Root 'core\guard\privacy-guard.ps1' }
if (Test-Path $guard) { & $guard -Root $Root | Out-Null; Report-Line ($LASTEXITCODE -eq 0) 'The privacy check is clean' }
else { Report-Line $false 'The privacy check is not installed' }

Write-Output ''
if ($bad.Count -eq 0) { Write-Output "ALL FINE: $ok of $ok checks passed." }
else { Write-Output "NEEDS YOU: $($bad.Count) of $($ok + $bad.Count) checks. $ok passed." }
exit 0
