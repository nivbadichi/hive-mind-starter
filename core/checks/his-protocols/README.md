# The standing protocols

This check holds five protocols that Hive Mind keeps for you from the first day:

1. A question for you is asked with the app's question card, not in a paragraph.
2. Every update that tells you how your work is going is a sitrep (a short status report): it opens with the progress bars printed by `node core/engine/progress.mjs show` (counted from the steps really done, never typed by hand), then one plain line for each thing you asked for, then what needs you.
3. Claude proves the work, not you: nothing is called "finished", "ready" or "perfect" without a PASS from the checker (the `hive-verify` skill) on record.
4. A recap (a written summary of a stretch of work) mentions everything done: it is not finished while it leaves out a line of the log or a decision of its period.
5. Work that changed files ends with a short learning note of the day in `system/learned.md`, never in the reply.

A reply cannot be taken back once you have it, and sending it twice would only repeat it. So a fault in a reply becomes a debt (see `core/checks/README.md`): at your next message the fault is put in front of Claude; if the next reply still carries it, every tool except reading is refused until a reply clears it.

## What it stops

- **A recap marked finished while something is missing.** A write or edit of `system/recap-<date>.md` that gives it a line `status: finished` (or "final", "complete", "done"; or "This recap is finished") is refused when the recap comparison lists anything missing. The refusal names what is missing and the command that lists it all.
- **A missing or wrong sitrep (debt "sitrep").** When a reply reports progress, it must open with a fixed-width block holding exactly what the program prints now from the list in `system/progress.json`; every bar must match its number; there must be a line `<thing>: <state>` for each thing on the list, and a `Needs you:` line. If not, the debt lists each fault. This debt stays until a reply carries a correct sitrep, so the reply after a bad one must be a correct sitrep, or every tool except reading is refused. While it is owed, your next message puts the display as the program prints it in front of Claude.
- **A question in a paragraph (debt "question-format").** A sentence that ends with a question mark and speaks to you is a debt, unless the same question went into a question card in this turn. On the `Needs you:` line, an open question of the questions list may be named word for word.
- **"Finished", "ready" or "perfect" with no proof (debt "unproven-finished").** It needs a `result.md` with "Verdict: PASS" in the checker's evidence folder (`~/.claude/hive/verify/<date>_<name>/`) whose name shares at least two words with the sentence. "Not ready yet", "when it is finished", "I am ready", "almost finished" and questions are not claims.
- **A recap called finished in a reply (debt "recap-unfinished")** while the comparison lists something missing.

## What it only notes

When a question card runs, its questions are written down for this chat (only the question text, kept two hours). When you ask for the status ("sitrep", "status", "where are we", "how far", "what's left"), the display as the program prints it now is put in front of Claude.

The learning note. When a reply ends a piece of work that changed files (it says done, finished, joined and the other `learned.endWords`) and `system/learned.md` has no heading for today, one reminder is put in front of Claude at your next message: write what was learned, in a few plain lines, under "## <today>" in that file, never in the reply. Once per chat per day; scratch files and helpers' copies do not count as the work; helper chats are not told. Nothing is said at any other step.

## The recap comparison

`recap-compare.mjs` lists every log line and every decision of the recap's period that the recap does not mention:

```
node core/checks/his-protocols/recap-compare.mjs system/recap-<date>.md
```

With no `--log` and `--decisions` it takes the log folder and `system/decisions.md`. The period is `--from`/`--to`, else a line `period: <date> to <date>` in the recap, else the date in the recap's name. It ends with "COMPLETE" (exit 0) or "NOT FINISHED" and the list (exit 1). A log line is mentioned when a recap line starts with its time (one recap line per log line), or names its time and shares two words with it; a decision when one recap line shares at least four of its words, making up a third of that line.

## What it cannot see, and why

- **Whether a word match is a real mention.** It matches words, not meaning: a line that shares enough words counts, and a mention in quite different words is listed as missing.
- **A recap called finished in other words,** a recap file elsewhere, or one written by a shell command.
- **Progress told in plain prose with none of the signs** (a bar, a percentage, a `Needs you:` line, "<thing>: <state>" lines, "3 of 5 steps", or two progress phrases), unless you asked for the status.
- **Whether the list of what you asked for is right,** or whether a step marked done was really done.
- **A question without a question mark;** and a rhetorical question to you is counted as a question.
- **Whether a PASS proves this exact claim:** a PASS for a part with a similar name counts. The checker's evidence stays on the computer where it ran.
- **Other words for finished** ("done", "works", "live"): the proof check holds those.
- **Helper chats** (chats another chat started): their replies are not held to these shapes.
- **The other rules of a sitrep** (its length, no file names or inside words) are held by the gates and the plain-words check.

## How to switch it

The mode is in `check.mjs` (`mode: "refuse"`); "notice" keeps the debts as reminders that never block, "off" stops it. Only you change it, in your own words. This is a discipline check: if it breaks, it lets the step through and writes the error in the log. The word lists and numbers are in `settings.json`.

## Three examples

1. You ask "sitrep" and get one bar and a paragraph. That reply is a debt; the next reply must be a correct sitrep, or work stops until one is given.
2. A reply says "the new page is ready" and the checker never walked it. That is a debt until the checker's verdict is given, or the reply says "not proven yet".
3. The recap of a long day is marked finished, but two late log lines are not in it. The write is refused, and the two lines are named.

## Tests

`node --test core/checks/his-protocols/check.test.mjs`: each behaviour has a case that must be caught and one that must pass, one test for how it behaves on its own error, and one for speed (under 50 ms a step).
