# One home for each truth (rule 8)

Rule 8 says: "Stale is dangerous. One home for each truth." A fact written in two notes drifts: one note is updated, the other is forgotten, and the next chat believes the old one. This check holds the part a program can hold.

## What it stops

When Claude saves one of your living notes (the top notes under `system/`, every note under `projects/` and `knowledge/`), the check looks at the lines the save adds. If a line states a fact that another living note already states, the save is stopped and the first home is named:

- the same value: "this would give it a second home; point to the first one instead";
- a different value: "two notes would disagree; change it in its first home and point there";
- a fact with a fixed home in the settings (today: how many rules there are, home `system/rules.md`), written anywhere else.

The facts it knows are in `settings.json`: how many gate tests pass, how many rules there are, how many skill folders, the size of the in-flight note, how many lessons are open, how many questions wait before publishing, and whether the publish hold is on. You can add your own.

## What it only notes

Claude is told, and the save goes through, when the added lines:

- give a count the settings do not name (for example "remote tests 20 of 20") that another living note also gives;
- carry a review day that has already passed;
- point to a file that does not exist, or call an existing file missing;
- leave the note's own "Updated:" line older than the newest day it speaks of.

## The list for the health check

`node core/checks/one-home/scan.mjs` reads the whole notebook and prints one `OK|` or `NEEDS|` line per finding, and a last line that says how many notes it read and how long it took. It changes nothing. The health check (`system/check.ps1`) can run it and show each line.

## What it cannot see, and why

- It knows a fact only by its words. The same truth said in other words is not matched. Only the facts in the settings, and counts written as "N of M", are read.
- History is let through on purpose: the log, notes with a date in their name, the decisions and lessons lists, and the design and plan notes under `system/design/` are records of their time.
- It sees only saves made with the Write and Edit tools. A note changed in an editor or by a shell command is found only by the whole-notebook list.
- It cannot tell which of two values is true. It names both places; you or Claude decide.
- Phrases a later decision made untrue are held by the ends check (`system/ends-check.mjs`), not here.

## Speed

Each gate call is a new program, so the facts of each living note are kept in the Hive folder (`one-home-index.json`) and only a changed note is read again. A save with no fact never reads the other notes.

## How to switch it

Kind: discipline. On its own error it lets the save through and writes `error` to the gates' log. Mode: `refuse` (in `check.mjs`); `notice` turns every stop into a note, `off` switches it off. Only your own words change the mode.

## Three examples of the kind of fault it stops

1. The in-flight note says "Updated:" with an old day while its lines speak of a newer one: the list reports its stamp as behind.
2. A count (for example how many gate tests pass) is written into the start note while the in-flight note already gives another number: the save is stopped and the in-flight note is named.
3. A project note points to a picture that was never saved: the list reports the pointer.

Tests: `node --test core/checks/one-home/check.test.mjs`.
