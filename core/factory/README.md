# Factory hooks: checks that run after an edit and at the end of a turn

Two hooks that make Claude fix its own faults before it says "done". Nothing here is switched on by setup; you add the settings lines below when you want them.

| File | What it does |
|---|---|
| `on-edit.mjs` | **After each edit.** A PostToolUse hook for Edit, Write and MultiEdit. When the edited file is TypeScript (`.ts .tsx .mts .cts`) under `<notebook>/app/` and not in `node_modules`, `.next` or `out`, it lints that file (`eslint --max-warnings=0`) and runs an incremental type check of the whole app (`tsc --noEmit --incremental`) at the same time. On a fault it exits 2 and puts the errors on stderr, which Claude Code hands to Claude. Errors in the edited file are listed first. |
| `on-stop.mjs` | **At the end of a turn.** A Stop hook. It asks git which files changed, picks the checks in `impact-map.json` that cover them, runs them side by side, and when one fails it exits 2 with the failing lines, so Claude keeps working. |
| `impact-map.json` | **Which checks cover which files.** For each check: its command, its entry files, and hand-kept `covers` globs. The program also follows the entry files' static imports (relative paths and `@/`), so most links need no hand entry. This copy starts with two checks: the gates test and these hooks' own tests. Add a check for each program or page you build. A check marked `manual` (it needs a running server or a build) is only named, never run. |
| `lib.mjs` | Shared parts: finding the repository and the main checkout, time limits, removing secrets from output, globs, the import walk, fingerprints. |
| `modules-fallback.mjs`, `modules-fallback-hooks.mjs` | In a git worktree that has no `app/node_modules`, node checks look up packages in the main checkout instead. Nothing is installed or copied. |
| `settings.json` | Modes and limits. |
| `test/factory.test.mjs` | The hooks' own tests. Run: `node --test core/factory/test/factory.test.mjs` |

## Rules the programs keep

- **The fast path is fast.** For any file that is not TypeScript under `app/`, the edit hook exits 0 before it loads anything else (the test checks it stays under 250 ms). A notebook with no `app/` folder is never slowed down.
- **Hard time limits.** Lint 20 s, type check 22 s, the whole edit hook 25 s, and each test check its own limit (`timeoutMs` in the map). The whole Stop hook stops at 170 s. A program that runs over is stopped together with its child processes. The hook then warns and lets the work go on.
- **No block for a missing tool.** If eslint, tsc, node_modules or git is missing, or the hook itself crashes, it warns: `additionalContext` reaches Claude after an edit, `systemMessage` reaches you at a stop. Each case is logged.
- **Git worktrees work.** The main checkout is read from the worktree's `.git` file, with no git call. tsc runs through a small config kept in the state folder (`~/.claude/hive/factory/`, never inside `app/`).
- **Nothing private is printed.** eslint's report includes the file's text; the program drops it. tsc runs with `--pretty false`, so no code is shown. Every line goes through `redact()`: tokens and long keys become `[hidden]`, and any line that names the notebook's `me/`, an `.env` file or `snapshot.json` is left out. At most 30 lines are shown.
- **No endless loops.** A check that passed on the very same changed files is not run again. If a stop comes right after a refusal and nothing has changed since, the stop goes through and you get a warning. If Claude did change something, the checks run again.
- **Log.** `~/.claude/hive/factory.log` gets one line per decision: `pass`, `warn`, `refuse`, `timeout` or `error`, with the time each step took.

## Switching on and off

Each hook below is a separate block. Add it to `~/.claude/settings.json` under `"hooks"`. Replace `__NODE__` with the full path of node (Claude can find it: `where node` on Windows, `which node` elsewhere) and `<notebook>` with the full path of your notebook folder, written with forward slashes. Leave the gates' own entries in place: hooks for the same event run side by side.

After each edit:
```json
"PostToolUse": [
  { "matcher": "Edit|Write|MultiEdit", "hooks": [ { "type": "command", "command": "__NODE__", "args": ["<notebook>/core/factory/on-edit.mjs"], "timeout": 30 } ] }
]
```
At the end of a turn:
```json
"Stop": [
  { "hooks": [ { "type": "command", "command": "__NODE__", "args": ["<notebook>/core/factory/on-stop.mjs"], "timeout": 180 } ] }
]
```
- **Off, one hook:** remove its block.
- **Off, both at once:** create the empty file `~/.claude/hive/factory-off`, and delete it to switch them back on. `gates-off` also stops them.
- **Softer or stricter:** set `lint.mode`, `types.mode` and `tests.mode` in `settings.json` to `refuse`, `warn` or `off`.
- **Moving a check to the end of the turn:** set `lint.when` or `types.when` to `stop`. `on-stop.mjs` then checks the changed TypeScript under `app/` once.

The paths point at the notebook's own copy, so a change here takes effect without an install.

**What it costs in time:** a first TypeScript edit under `app/` can hold Claude for several seconds while the linter and the type checker load; later edits are faster. If many small edits in a row feel slow, keep `lint.when` at `stop` (the default) so the linter runs once per turn.
