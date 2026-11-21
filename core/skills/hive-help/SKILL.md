---
name: hive-help
description: Answer questions about Hive Mind from its manuals, in plain words, then offer to do it. Use when the person asks "what can you do", "how do I...", "what is..." or "where is..." about Hive Mind: adding a place, skill or rule, the brief, the gates, the starting set, undoing the setup, a word, or where their notes are.
---

# Help

The person asks; you answer from the manuals, never from memory, in two to five plain lines, then offer to do it for them. The notebook is the folder this chat is in when it holds `system/rules.md`, otherwise `~/hive-mind`; the manuals are inside it.

## 1. Find the page

| They ask about | Read first | Then, if it is not there |
|---|---|---|
| the first steps, installing, the copy, opening it in Claude | `docs/first-hour.md` | `README.md`, `SETUP.md` |
| what they can say, a normal day, what Claude asks before | `docs/daily-use.md` | `README.md` |
| what a folder, a part or a word is; what leaves the computer | `docs/parts.md` | `system/start-here.md` ("Where things are"), `system/what-leaves.md` |
| something that does not work, an error, a message they saw | `docs/when-it-breaks.md` | offer the doctor (`hive-doctor`) |
| how the pieces fit together | `docs/map.md` | `docs/parts.md` |
| their own projects, places, choices | `system/start-here.md`, `system/places-and-sets.md`, `system/decisions-in-force.md` | the project's `projects/<name>/state.md` |

Read the one page that fits, and only the part that answers. Done when you hold the lines that answer the question, or you know no manual answers it.

## 2. Answer

- Say it in their words, in two to five lines. Lead with what they can say to make it happen, in quotes (for example "Say: add a place for my garden"). No file names or commands unless they ask.
- "What can you do": the short list from `docs/daily-use.md`. Without that page, one line per helper, taken from the `description:` of each `core/skills/*/SKILL.md`, in plain words, at most eight lines.
- A question about Claude itself (the app, its projects, scheduled tasks, connectors in the app, the phone): that is Claude's own feature, not Hive Mind's. Say so in one line and point to Claude's own help (code.claude.com/docs) instead of explaining it.
- No manual answers it: say "The manuals don't cover this yet", answer from the helper that does the thing (its `SKILL.md`), and say that is where the answer came from.

Done when the answer names its source page to you (not to them) and every fact in it is on that page.

## 3. Offer to do it

End with one question that offers the action, for example "Shall I add it now?" On a yes, use the helper that does it:

| To | Helper |
|---|---|
| set up, the starting set, the brief | `hive-setup` |
| add or remove a skill, connector, rule or habit | `hive-add` |
| start a new project | `hive-project` |
| save something they sent | `hive-intake` |
| switch the gates off or on, see their log | `hive-gates` |
| fix something broken, check the setup | `hive-doctor` |
| catch up, where were we | `hive-start` |
| close the session | `hive-close` |

Done when they said yes and the helper took over, or they said no.
