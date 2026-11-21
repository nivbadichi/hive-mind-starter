# The proof check (rule 5)

Rule 5 says: small steps, with proof; say what was checked and what was not; never invent a fact, a number or a result. A reminder alone does not hold a rule like this, so this check holds three parts of it for you.

## What it stops

- **A real publish run as a test.** Some steps would really put something online: a deploy command, a publish or deploy script, `npm run deploy` and its cousins, or a connector's deploy tool. When such a step says it is a test, a try, a smoke run or a "see if", it is refused, unless your latest message asked to publish. The way out is a dry run (`--dry-run`, `-WhatIf`), a copy that cannot reach the live site, or one plain question to you. If this check breaks while it reads a step that looks like a publish, it refuses that one step. On any other step a break lets the step through and is written in the log.

## What it turns into a debt

You already have a reply once it is sent, and it cannot be taken back. So these faults become a debt. Your next message puts the debt in front of Claude, and the next reply must put it right. Otherwise every tool except reading is refused. That rule lives in the shared part of the checks, `core/checks/_lib`.

- **"Done" without proof.** The reply says done, fixed, works, passes, ready, is live, finished, completed, shipped or published, but no test or check passed in that turn after the last change to a code file. These are not proof: a check that failed, a check that ran no test at all, a check that passed before the code changed again, and a command that only reads a test file. Honest wording is fine: "not checked yet", a question ("is it ready?"), a condition ("once it is ready"), "how it works", "almost done", or the word in quotes.
- **A number nobody printed.** Every percentage, and every other number from 10 up, must appear somewhere real. That means what a command or tool of the turn gave back (a test summary, the progress bars, a file that was read), your own latest message, or a note on the list in `settings.json` (`numbers.notes`). A percentage worked out from a printed count ("12 of 15", so 80%) is fine. A number marked "about", "around" or "~" may be up to 10% off a real one. Dates, times, versions, paths, addresses, years, "rule 5" and list markers are left out.
- **A debt that was not put right.** The reply after the debt must say plainly what was not checked or not counted ("it was not checked", "a correction: ..."). For a "done" debt, a check that passes in that turn also clears it. A reply that says nothing about it carries the debt again.

## What it cannot see, and why

- **Failing commands, unless that hook is installed.** Claude Code calls the after-tool step only for a tool that succeeded. A failed one goes to a separate event, PostToolUseFailure, which reaches this check only when that hook is installed. With it, a failed test is recorded as failed. Without it, a failed test looks like "no check ran". The debt is the same either way.
- **Whether the right thing was tested.** Any passing test, build or check of the turn counts as proof for any claim in the reply.
- **Code changed through the shell.** Only the Write and Edit tools count as a change to code. A file changed by a shell command after the check is not seen.
- **Laundered numbers.** A number Claude first writes into a note and then reads back counts as "held by a note".
- **Meaning.** The check reads words, not intent. A claim worded without any of its listed words ("it is all good now") is not seen. Numbers under 10 are not checked.
- **Helpers.** Only the main chat's replies are checked. A helper's own final report is not checked yet.
- **A publish that hides its name.** A deploy run through a variable, a renamed script, or a `git push` to a host that publishes on every push is not recognised. The permission rules in `core/permissions` are what ask you before any publish.

## How you switch it

The mode is `refuse` (the default), `notice` (a reminder only) or `off`. Making it softer or switching it off needs your own words in your own message. The word lists and numbers are in `settings.json` next to this file: which words claim "done", which commands count as checks, the lowest number checked, the notes that hold numbers, the publish commands and the test words. `settings.json` is never the way to switch the check off.

## Three examples

1. An assistant finishes a change and says "Done, it is ready for you" without running any test. Now that reply leaves a debt. The next reply must run the check and say what it showed, or say plainly that it was not checked.
2. Asked how far a piece of work is, an assistant answers "about 80% done", a number it made up. Now that is a debt. A number printed by the progress program (`core/engine/progress.mjs`), which counts real steps, passes.
3. An assistant runs the real publish script "to test it", or wraps it in `npm run deploy` to try it. Both are refused. The dry-run option passes.

## Files

- `check.mjs`: the check. It keeps its own short record of each turn under the Hive folder (`<state>/proof/`).
- `settings.json`: the word lists and numbers.
- `check.test.mjs`: `node --test core/checks/proof/check.test.mjs`. It holds a known-bad and a known-good case for each behaviour, a test of its own error behaviour, and a speed test (under 50 ms a step).
