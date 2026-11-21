# The report-shape check

A helper's report that says "done" with no file, no command and no question cannot be checked. This check reads every helper's report when the helper stops, with the program `core/report-shape/report-shape.mjs`, and tells Claude each part that is missing:

- the files it made or changed (or the words "nothing built" or "read-only");
- a command that was run (or "not checked");
- a "Questions for the person" part with the questions, or "none";
- the model that did the work.

It is a discipline check: if it breaks, the work goes on and the error is written to the gates' log.

## What it stops

Nothing. A helper has already stopped when its report arrives, so there is nothing left to refuse.

## What it only notes

A report with a part missing is put in front of Claude at your next message ("HIVE CHECK (report-shape): ..."), with each missing part named and the step to take: send it back to that helper before its work is joined. A whole report passes in silence.

## What it cannot see, and why

- Whether a named file or command is real. It looks for the shape, not the truth; the checker helper (`hive-verify`) proves the work.
- A report the hooks never hand over. It runs only when the stopped-helper hook is installed. When only the helper's last words are there, they may be just its closing line; the note then says so.
- Helpers that only search or read (the types in `skipAgentTypes` of `settings.json`): their answers carry no report shape.

## How you switch it

Say so in one sentence. The parts it asks for are `parts` in `settings.json`; `"mode": "notice"` or `"off"` there softens it or switches it off.

## Three cases it is made for

- A helper ends with questions for you that never reach you, because its report had no questions part to read.
- A helper decides something only you decide, and its report says nothing of it; the questions part must be written, even as "none", so its absence is seen.
- A report with no files, no checks and an empty questions part is joined like any other.

Tests: `node --test core/checks/report-shape/check.test.mjs`.
