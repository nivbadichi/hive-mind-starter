# Precedents first

This check holds rules 3 and 13 of your Hive Mind: look at how others already did a thing before designing or building it, and write down what was taken from whom.

## What it stops

Before Claude writes a screen or program file for you (a page, a style sheet, a script, any file whose ending is in `settings.json`), it asks one question: has anyone in this piece of work looked outside? The write is let through when one of these is true:

- a web search or a web fetch ran earlier in this turn, or earlier in this same chat within the last 12 hours (a page-reading helper, a browser that opened a page, and a `curl` or `gh search` of a web address count too);
- a precedents note exists for the file. That is a note whose name contains "precedent", with a "Precedents" heading, at least one link to an outside source, and words saying what was taken from it, written in the last 30 days. It counts when it sits in the project's own notes folder (`projects/<name>/`), or in the file's own folder or a folder above it. A note in `system/design/` counts only for the files its `for:` line names (for example `for: app/**`). A `for:` line in any note narrows it to those files.

Otherwise the write is refused, and Claude is told the one thing to do: search for products or programs that already solve this, write `projects/<name>/precedents.md` with the links and what was taken, and try again. When a note exists but does not count, the refusal says why (no link, nothing said about what was taken, too old).

Never stopped: notes (`.md`), settings and data files, built folders (`node_modules`, `.next` and the others in the settings), the computer's temporary folder, and every read.

## What it only notes

When a web search or fetch runs, the check writes down the time for that chat, so a write in a later turn sees it. It never writes down the words searched, because they may be private.

## What it cannot see, and why

- It cannot tell a good precedent from a poor one, or whether what was found was really used. A search for anything at all lets the writes through.
- A web search alone lets the write through; it does not demand that the note be written afterwards.
- A helper chat started by another chat is a different chat: the first chat's search does not carry over. The helper needs its own search, or a note.
- It reads a shell line roughly: a file after `>` or `>>`, and files named after a writing command (`Set-Content`, `cp`, `tee` and the like). A write hidden inside a script is not seen. Writes through the Write and Edit tools are always seen.
- It cannot tell a new design from a one-line fix. A small fix in a project with no precedents note and no search is refused too; one note per project ends that.

## How to switch it

The mode is in `check.mjs` (`mode: "refuse"`); "notice" turns a refusal into a reminder, "off" stops it. Tell Claude in your own words if you want it changed. If the check breaks, it lets the write through and logs the error. The numbers (12 hours, 30 days) and the word lists are in `settings.json`.

## Three examples of what it catches

1. You ask for a new landing page and Claude starts writing the page file at once. The write is refused until it has searched for landing pages like yours or written a precedents note.
2. Claude fixes a script in a project that has never had a look outside. The first edit is refused; a short precedents note for the project lets every later edit through.
3. A note named `precedents.md` exists but has no links, only names. The refusal says the note names no outside source, so the links get added.

## Tests

`node --test core/checks/precedents/check.test.mjs`: each behaviour has a case that must be caught and one that must pass, one test for how it behaves on its own error, and one for speed (under 50 ms a step).
