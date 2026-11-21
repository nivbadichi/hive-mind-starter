---
name: hive-add
description: Add, change or remove a skill, connector, rule (protocol) or preference from one sentence of the person. Use when they say add this skill, use this connector for, I want you to always, never, from now on, stop using, remove, or which skill fits this task.
---

# Add, change or remove: one sentence in, the registry updated

The registry is `system/registry.json`; its program is `node core/engine/registry.mjs` (commands: add, set, remove, list, find, render, check). Every list the person or Claude reads is made from it, so each change is made once, there. Read `system/rules.md` rules 1, 7 and 10 first; they decide the order below.

## 1. Work out what they mean

From their sentence decide three things, and ask one short question only when one stays unclear:
- **kind**: skill, connector (a tool or outside service), protocol (a rule that applies every time), or preference (how they like things done).
- **id**: the skill folder name, the connector's plain name, or a short plain slug.
- **action**: add, change (`set`), or remove.

"Which skill fits X?" is a lookup: run `find <words>`, answer in two lines, stop.

## 2. Add or change

**A skill or tool that is not installed.** Propose it in plain words (what it does, what it needs, what it costs) and wait for their yes before anything is installed or connected (rule 1). Until the yes, the entry stands as `listed-not-installed`.

**Anything that is not an official or directory connector** (a vendor, third-party or community tool or skill): run `hive-review` first (rule 10), show them the verdict, and store the result on the entry: `review` = `reviewed <date>: <verdict>`. A tool with the verdict "do not use" is added with state `removed` and the reason, so it is not proposed again.

**A preference.** Add the entry, and add one dated line to `system/preferences.md` with their words: `- <date>: <their words>`. When that note does not exist yet, tell them and keep the entry only.

**A protocol (a rule).** Say plainly whether a check in the gates can hold it. A rule no check holds stays `enforce: null` and is shown as "text only: nothing checks this yet"; tell them that in one sentence. Weakening or removing an existing rule needs their yes in this chat (rule 1).

Fill `fits` (a few plain words: design, motion, coding, research, documents, trading, legal), `model` (smallest, middle or strongest, only when they or a rule says so, else leave empty), `text` (protocol and preference: their wording in one line), `by` (their words, short).

Run, for example:
`node core/engine/registry.mjs add --id <id> --kind <kind> --state <state> --source <source> --fits a,b --text "..." --by "their words"`
or `... set <id> <field> <value>`.

## 3. Remove

`node core/engine/registry.mjs remove <id> --reason "their words"`. The entry stays with state `removed` and the reason, so it can be brought back with `set <id> state active`. Delete a skill's folder or disconnect a connector only after their separate yes; say what exactly would go.

## 4. Finish

Done when all three hold:
1. `node core/engine/registry.mjs render` ran and then `node core/engine/registry.mjs check` printed only `OK|` lines. A `NEEDS|` line is fixed or reported.
2. The new Claude-folder lists are in `system/generated/`; installing them over `~/.claude/SKILL_MAP.md` and `IMPORTED_SKILLS.md` needs their yes (it overwrites).
3. They get two plain lines: what changed, and what waits for them (a yes to install, a review to read, a rule that is text only).

Then save the decision with `hive-capture`, and say `Saved: ...` in one line.
