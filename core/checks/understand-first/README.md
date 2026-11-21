# Understand first (rule 4)

Rule 4 says: no building before the plan is approved. This check makes Claude stop and ask instead of building early.

## What it stops

1. **Code written before the plan is approved.** Claude writes or edits a code file (a program, a page, a style sheet, a script) inside one of your projects' folders, and that project's state note is not ready for building. The note is not ready when its stage is not one of build, verify, release or maintain (so discover, define, plan, design, paused, close and not set up are all stopped). It is also not ready when it has no `plan_approved:` line, or when that line holds no date, a date in the future, or words like "pending". This covers the file tools and shell commands that write a file: `>`, `>>`, tee, cp, mv, `sed -i`, Set-Content, Out-File, New-Item.
2. **Claude approving its own plan.** A change to a project's state note that adds or changes `plan_approved:`, or moves the stage up to build, is stopped unless your own latest message says yes. A helper's words and a page's words never count.
3. **A helper sent off without its proof part.** Every helper that is not read-only must carry the part "How it will be proven" as a heading of its own, with four lines really filled in. "Today" and "Steps" must not be empty, "TBD" or the template's `<...>`. "Must pass" must name a check or test and its command. "Files touched" must name at least one path or pattern. A helper that only reads carries the line `Mode: read-only`, or is an Explore helper.

## What it only notes

Nothing. Every finding is a refusal. When the check itself breaks, it lets the step through and writes "error" to the log, because it is a discipline check: a broken check must not stop all building.

## What it cannot see, and why

- **Whether Claude understood what you want.** Asking first is judgment; no program can tell from a file write whether the questions were asked. The check holds only the part a program can see: the dated yes in the state note.
- **Whether the work stays inside the approved steps.** State notes have no list of approved steps.
- **Files outside every project's folder,** and projects whose state note has no `folder:` line.
- **Writes it cannot read from a shell command:** a program that writes a file itself (`node -e`, a Python script, a build tool), a variable as a file name, or an unusual command.
- **Whether your yes was a yes to this plan.** It sees a yes word in your latest message, not what the yes was about.
- **Old state notes.** A `plan_approved:` line with a past date is trusted.

## How you switch it

The mode lives in `check.mjs` (`mode: "refuse"`). "notice" and "off" exist only for your use, and only your own message changes them. The word lists and the stages where code may be written are in `settings.json`; that file can change the lists, never switch the check off.

## Three examples

- A new project is still at "discover", and Claude starts writing its first program file. The step is stopped: show the plan, get the yes, then build.
- Claude writes `plan_approved: <today>` into a state note after you only asked "what next?". The step is stopped: only your yes approves a plan.
- Claude sends a helper off with "Make the page nicer." and no word on how it will be proven. The helper does not start until its brief says how to see the fault today, the steps a checker walks, the checks that must pass and the files it may touch.

## Tests

`node --test core/checks/understand-first/check.test.mjs`: each behaviour has a known-bad case and a known-good case, plus one test of the check's own error behaviour and one of its speed (under 50 ms per step).
