# Ends in step (rule 15)

Rule 15 says: when something changes, every place that carries it changes in the same piece of work. A program can find the places that are behind and tell you at the start of a chat, but finding is not keeping. This check holds the rule while the work is being done.

An "end" is a place that carries the same thing. Your list of ends is `system/ends.json`, the same list the ends program (`system/ends-check.mjs`) reads. For this check, the ends that a save can bring in step are the pairs between your notebook and its empty copy for new people (`starter/`), if you keep one:

- files that must be the same in both (`identical`);
- folders whose every entry must have a twin in the copy (`sameFolders`, plus `core/checks`, which this check's settings add);
- words that prove a newer part reached the copy (`mustMention`).

If your notebook has no copy, there are no pairs, and this check never stops anything.

## What it stops

Before a save, it asks: is this file one end of a pair whose other end is already out of step, and does the save leave them out of step? If both are true, the save is refused, and you are told each end and what is wrong (the two files differ, the twin is missing, or the copy lacks a word). The one thing to do is to bring the other end in step first, then make the change in both places.

A save that brings the ends into step is never refused: copying the newer file across, a plain `cp a b` from one end to the other, or an edit that makes the two agree. A pair that is in step may be changed on one side first; the end of the reply holds the second half.

## What becomes a debt

At the end of a reply, every pair this chat touched that is still out of step becomes a debt: a note put in front of Claude at your next message. If the next reply still ends with it, every step except reading is refused, except saves to the two ends the debt names, so the way out stays open. Staying quiet does not pay it: the chat's touched pairs are remembered until each one is in step.

## What it only notes

Ends a save cannot bring in step (a live site, a copy kept elsewhere) need your yes to be put online, so they are never a debt. When the work changed your public site's code, the end of the reply notes that the site is behind and that you must be asked. The full ends program is too slow to run inside a step, so it runs in the background after a save, and its last result (if under 30 minutes old) is noted too. By hand: `node core/checks/ends-in-step/check.mjs full <notebook> <state folder>`.

## What it CANNOT see, and why

- Ends that are not pairs of files in your notebook, and ends that are not on the list.
- What a shell command will write. A shell write to an end already behind is refused unless it is a plain copy from the other end; a write hidden inside a script is not seen, and a delete is not held before it runs.
- Whether the copy's wording is right: a folder entry only needs a twin to exist.
- Old drift nobody touches: that stays with the start's notice and the health check, so it cannot lock every reply.
- A known fault of the ends program: its search for outdated phrases also reads helpers' own copies under `.claude/worktrees/`, so its count can be far too high. One line fixes it (skip `.claude` in its walk). A test holds the fault.

## How you switch it

The mode is in `check.mjs` (`mode: "refuse"`): "notice" makes it a reminder only, "off" stops it. It is a discipline check: if it breaks, it lets the save through and logs the error. The numbers are in `settings.json`.

## Three examples

1. A rule that depends on memory is not kept: two days after this rule was written, a full check still found stale lines, a public site built from older code and an old copy elsewhere. Now a change that leaves the copy behind ends in a debt.
2. Asked three times in one evening to bring the ends in step, because each fix was done once by hand. Now the second half of a change is held in the same piece of work.
3. The copy lacked a new program and differed in another one. A further change to the one that differs is now refused until the two agree, and a new program with no twin is a debt. Both are tests in `check.test.mjs`.

## Tests

`node --test starter/core/checks/ends-in-step/check.test.mjs`: each behaviour has a case that must be caught and one that must pass, one for its own error, one for speed, and one that holds the ends program's known fault.
