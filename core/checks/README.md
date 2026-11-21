# Check modules

Each rule that a program can hold lives in its own folder here, `starter/core/checks/<id>/`. The gates call every folder at every step through the library in `_lib/`. This page is the contract every check follows, as built.

## A check's folder

| File | What it holds |
|---|---|
| `check.mjs` | The check (shape below). |
| `settings.json` | Its numbers and word lists, read as `ctx.settings`. Optional `"mode"` for a discipline check. |
| `check.test.mjs` | Its tests, with Node's test runner and `../_lib/harness.mjs`. |
| `README.md` | In plain words: what it stops, what it only notes, what it cannot see and why, how the person switches it, three real examples. |

In words a person reads, use `ctx.who` ("the person").

Folders whose names start with `_` or `.` are never checks.

## check.mjs

```js
/** @type {import('../_lib/types').Check} */
export default {
  id: 'proof',                       // the folder name: lower-case letters, digits, dashes
  rule: 'rule 5',                    // the rule or protocol it holds
  kind: 'discipline',                // 'safety' or 'discipline' (see "Errors" below)
  mode: 'refuse',                    // optional; 'refuse' is the default; 'notice' and 'off' are for the person's use only
  about: 'A reply that says done with no passing check this turn becomes a debt.',
  steps: {
    stop(ev, ctx) {
      if (!/\bdone\b/i.test(ev.text)) return null;
      if (ctx.events.some((e) => e.kind === 'check' && e.ok)) return null;
      return { debt: { key: 'done-no-proof', text: 'it says done, but no test or check passed in this turn; run one and say what it showed.' } };
    },
  },
};
```

No other fields are allowed; an unknown field makes the check broken. Types for every part are in `_lib/types.d.ts`.

## Steps and what they get

| Step | When | `ev.text` | May return |
|---|---|---|---|
| `pretool(ev, ctx)` | before a tool runs | `''` | `deny`, `say`, `clear` |
| `posttool(ev, ctx)` | after a tool ran (also after a failed one, when the failure hook is installed) | `''` | `say`, `clear` |
| `prompt(ev, ctx)` | at each of the person's messages | the person's message | `say`, `clear` |
| `stop(ev, ctx)` | at the end of a reply | Claude's reply | `debt`, `say`, `clear` |
| `helperstop(ev, ctx)` | when a helper stops | the helper's delivered report (the message of its handback tool, when the after-tool hook saw it; then `ev.report` is true), else its last words | `say`, `clear` |

`ev` is the hook's own input as Claude Code gives it (`session_id`, `cwd`, `agent_id`, `tool_name`, `tool_input`, `tool_response`, `prompt`, `last_assistant_message`, `stop_hook_active` and the rest; see `https://code.claude.com/docs/en/hooks`), plus `ev.step`, `ev.tool`, `ev.input` (the tool's input), `ev.command` (the shell text when the tool is Bash or PowerShell) and `ev.text`.

A step may be async. It must answer within 200 ms (the library's `stepMs`); its tests must show under 50 ms on ordinary input.

## What a step returns

`null`, or an object with any of these together:

- `deny: "<what was stopped, why, the one thing to do>"`: refuses the tool (`pretool` only). The words reach Claude as `HIVE CHECK (<id>): ...`.
- `say: "<words>"`: put in front of Claude. At `pretool`, `posttool` and `prompt` they go at once. At `stop` and `helperstop` they are kept and given at the person's next message, because words at the end of a reply make Claude write a second reply.
- `debt: { key, text, auto?, allow? }`, or a list of them (`stop` only). See "Debts".
- `clear: [key, ...]`: clears this check's own debts with those keys. A check cannot clear another check's debt.

Any other key, a key at the wrong step, or empty words make the answer malformed, which counts as an error of the check.

## ctx

| Field | What it is |
|---|---|
| `root` | the notebook folder |
| `state` | the Hive folder for records (`~/.claude/hive`) |
| `hisLast` | the person's latest own message, in its own case. Empty in a helper chat: a starter chat's words are never the person's. |
| `said(pattern)` | true when the person's latest own message names that act. A word or phrase (whole words, any case), a RegExp, or a list of either. |
| `hisNow` | false at the step "at their message" when the prompt was not theirs: a helper's report, a task notice or another chat's message. Then `hisLast` is still their last OWN message, and nothing at this step may count as their ruling |
| `cards`, `approved(words)` | their answers on question cards since their last own message (only cards the before-a-tool step saw go out with no answers); `approved` is true when their message names one of the words, or they said yes on a card that asked about it (`_lib/his-words.mjs`) |
| `isHelperChat` | the chat was started by another chat (the gates' helper-chat mark) |
| `loaded` | skills really loaded in this chat, by it or its helpers, lower case, as the Skill tool named them |
| `hasLoaded(name)` | true when that skill was loaded; `testing-strategy` matches `engineering:testing-strategy` |
| `events` | what ran in this turn (since the person's last message): `{ kind: 'tool', tool, ok, exit?, command?, path?, agent? }` for every tool the after-tool hook saw; `{ kind: 'write', path }` for every file written, shell writes included (from the gates' record); `{ kind: 'check', ok, command }` for every test, build or check command (from the gates' record) |
| `read(rel)` | a note's text by its path inside the notebook, cached; `''` when missing or outside the notebook |
| `settings` | this check's own `settings.json` |
| `debts` | this check's own debts open now: `{ key, text, status }` |
| `log(event, detail)` | a line in the gates' log (`~/.claude/hive/gates.log`), with the check's id |
| `step`, `sid`, `agentId`, `who` | the step; the chat; the helper that made this tool call (empty for the lead); "the person" |

The facts come from the same records the gates keep (their chat record, their list of loaded skills, their events of the turn) and from the checks' own records under `~/.claude/hive/checks/` (the person's message in its own case, every tool with its command and exit code).

## Debts

A reply cannot be taken back, and sending it twice is forbidden, so a fault in a reply becomes a debt:

1. Reply N carries a fault: the check's `stop` step returns a debt. It is "open".
2. At the person's next message the debt is put in front of Claude ("HIVE DEBT ...").
3. Reply N+1 still carries it: the debt is "overdue". From then on, in the lead's chat, every tool except reading is refused ("HIVE DEBT (overdue) ...").
4. A reply that no longer carries it clears it, and the tools run again.

"Still carries it" has two forms:

- `auto: true` (the default): the check's `stop` step ran on the next reply and raised the same key again. If it ran and did not raise it, the debt is cleared.
- `auto: false`: for a debt that needs an act, not just other words (a rule not saved). It stays until one of the check's steps returns `{ clear: [key] }`, and it is overdue when the next reply ends with it still there. Give it a way out with `allow: { tools: [...], paths: [...] }`: those tools, and writes to those paths inside the notebook, still run while it is overdue. Without a way out, an act-debt can only be paid by reading.

"Reading" means the tools `Read, Glob, Grep, LS, NotebookRead, ToolSearch, Skill, TaskOutput, AskUserQuestion, TodoWrite` and the app's plan tools, and shell commands made only of reading words (`ls`, `cat`, `grep`, `git status`, `git log`, `Get-ChildItem` and the others in `_lib/settings.json`), with no `>`, no `$( )` and no backticks. Anything else is not reading.

A debt of a check in "notice" mode is said at every message and never becomes overdue. A debt whose check folder is gone is dropped. Tools a helper (subagent) runs are not held by the lead's reply debts.

## Kinds, modes and errors

Order: safety checks run first, then discipline checks; by id inside each.

| | safety | discipline |
|---|---|---|
| Its step throws, is too slow, or answers malformed | before a tool: the tool is refused, unless it only reads or it writes into that check's own folder (so it can be mended); at other steps: logged | let through, logged |
| Its folder is broken (no `check.mjs`, it does not load, a bad shape, `settings.json` not valid JSON) | the same as above, at every tool | logged |
| Mode in `settings.json` | ignored (and said by the doctor): a safety check is switched in its `check.mjs`, at the person's word | honoured |

A broken folder whose kind cannot be read is treated as safety. Broken checks, and safety checks not set to refuse, are said at the first message of every chat and again whenever that changes. Modes: `refuse` (the default) stops or makes debts that can become overdue; `notice` turns a `deny` into a `HIVE NOTICE` line and keeps its debts from becoming overdue; `off` does not run the check.

If the program that runs the checks itself breaks, a tool that does not only read is refused.

With no start record in the chat (the start step failed or never ran), only the safety checks run, and Claude is told so at each message.

Limits, in `_lib/settings.json`: 200 ms per step of one check, 1,500 ms for all checks of one step, 9,000 characters of words per answer (Claude Code keeps 10,000). With `"isolate": true` the checks run in a separate thread that is ended at the limit, so a check that never returns cannot hold a step up; it is off by default because it costs about 150 ms more per step (measured on one Windows computer).

## Tests

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import check from './check.mjs';
import { makeEv, makeCtx, runOne, throwing, timeStep, validate } from '../_lib/harness.mjs';

test('shape', () => assert.deepEqual(validate(check, 'proof'), []));
test('known-bad: done with no check is a debt', async () => {
  const r = await runOne(check, 'stop', makeEv('stop', { last_assistant_message: 'It is done.' }), makeCtx());
  assert.equal(r.debts[0].key, 'done-no-proof');
});
test('known-good: done after a passing check', async () => {
  const r = await runOne(check, 'stop', makeEv('stop', { last_assistant_message: 'It is done.' }), makeCtx({ events: [{ kind: 'check', ok: true, command: 'node --test' }] }));
  assert.equal(r.debts.length, 0);
});
test('on its own error it lets the reply through (discipline)', async () => {
  const r = await runOne(throwing(check), 'stop', makeEv('stop', { last_assistant_message: 'done' }), makeCtx());
  assert.equal(r.deny, ''); assert.match(r.error, /made-up failure/);
});
test('fast', async () => assert.ok(await timeStep(check, 'stop', makeEv('stop', { last_assistant_message: 'done' }), makeCtx()) < 50));
```

- `makeEv(step, fields)`: a made-up hook input with the loader's fields. `makeCtx({ hisLast, notes, loaded, events, settings, isHelperChat, debts })`: a made-up ctx; `notes` is served by `read()`; `ctx.logged` collects the logs.
- `runOne(check, step, ev, ctx, { mode })`: runs it exactly as the loader does and returns `{ deny, say, debts, clear, error }`.
- `throwing(check)`: the same check with every step throwing. `timeStep(...)`: the median time in ms. `validate(check, id)`: its shape problems.

Run one check's tests: `node --test core/checks/<id>/check.test.mjs`. Run the library's: `node --test starter/core/checks/_lib/`. Node 24 does not search a folder given to `--test`; it runs the folder as one program, which is `_lib/run-tests.mjs` (named in `_lib/package.json`), and that runs every `_lib/test/*.test.mjs`. A check's own folder has no such file, so give its test file by name.

## list and doctor

- `node starter/core/checks/_lib/cli.mjs list` prints every check with its kind, mode, steps and rule (`--json` for a program).
- `node starter/core/checks/_lib/cli.mjs doctor` names what is broken (exit 1) and notes what is missing: a test, a README, a settings file, the copy in `starter/core/checks/`, a step slower than 50 ms or one that throws on made-up input. The health check and the start can call it.

## How the gates call it: the exact three lines

The gates run once per hook step, as `gates.mjs <mode>` (`pretool`, `posttool`, `prompt`, `stop`, `subagentstop`, and `posttoolfailure` once that hook is added). The same three lines serve every step: the library reads the mode and runs the matching check step. They go in the last block of `starter/core/gates/gates.mjs`, between `try { main(); } ...` and `process.exit(0);`:

```js
  let final = OUTBOX; const lib = path.join(ROOT, 'core', 'checks', '_lib', 'hook.mjs');
  try { if (fs.existsSync(lib) && !fs.existsSync(OFF) && notebookFound()) final = await (await import(pathToFileURL(lib).href)).runChecks({ mode: MODE, input: INPUT, root: ROOT, state: STATE, sid: SID, outbox: OUTBOX, log, deadline: T0 + LIMIT_MS - 400, started: active() }); } catch (e) { log('error', { where: 'checks', kind: 'safety', error: String(e && e.message || e).slice(0, 300) }); }
  for (const o of final) process.stdout.write(typeof o === 'string' ? o : JSON.stringify(o));
```

They need two small changes higher in the same file, so the gates and the checks give Claude Code one answer (Claude Code reads stdout as JSON only when it is one object):

- under `import crypto from 'node:crypto';` add `import { pathToFileURL } from 'node:url';`
- the line `function out(obj) { process.stdout.write(typeof obj === 'string' ? obj : JSON.stringify(obj)); }` becomes `const OUTBOX = []; function out(obj) { OUTBOX.push(obj); }`

The file may have Windows line ends; match the lines without them.

What the hook settings must also carry for every part to work (in the start step's settings snippet, not in this folder): a `SubagentStop` hook calling `gates.mjs subagentstop` (without it `helperstop` steps never run); `SubagentHandback` in the after-tool matcher (so a helper's delivered report is seen); a `PostToolUseFailure` hook calling `gates.mjs posttoolfailure`; and `*` as the before-tool matcher (see below).

The checks run when the notebook is found and the file `gates-off` is absent, even when the chat has no start record (then only the safety checks).

## What this cannot hold

- "Every tool except reading is refused" covers only the tools the before-a-tool hook is set to watch. Today that hook watches `Write|Edit|MultiEdit|NotebookEdit|Artifact|Agent|Bash|PowerShell` and some connector tools, so a web fetch or another connector's tool is not seen. For the rule to hold for every tool, that hook's matcher must be `*` (in the start step's settings snippet, not in this folder).
- The after-a-tool hook watches only `Read|Skill|Write|Edit|MultiEdit|NotebookEdit|Bash|PowerShell`, and Claude Code calls it only after a tool that succeeded, so `ctx.events` misses other tools, and failed tools unless a `PostToolUseFailure` hook with the mode `posttoolfailure` is added.
- Without `"isolate": true`, a check that loops without end (and never gives the program a moment back) holds the step until Claude Code ends the hook at the limit the hook settings give it (10 seconds in the snippet); the tool then runs. That one case fails open. A check that waits without end is cut off at its 200 ms.
- A helper's report is seen as its delivered report only when the after-tool hook watches the handback tool; otherwise its last words are all there is, and they may be only a closing line.
- Words of the checks reach Claude only at the steps the hooks are installed for; with no `SubagentStop` hook, nothing runs when a helper stops.
- If the gates script itself is not installed or not called, nothing here runs. The self-guard check and the health check are what notice that.
- The file `gates-off` switches the checks off with the gates; the app's permission rules are what keep Claude from writing it.
