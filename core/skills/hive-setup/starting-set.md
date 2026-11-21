# The starting set (step 4a of hive-setup)

Read by Claude when `hive-setup` reaches step 4a, and later when the person asks for another size or kind ("switch to Standard", "I'm a student", "give me the builder set"). The notebook comes with a ready list in `system/registry.json`; the program is `core/engine/registry.mjs`, and the lists made from it are in `system/generated/`. Never state a number or a name you did not read from the program.

The person makes two picks, one at a time: first a size, then a kind. Each can be skipped; a skip is **Light** and **everyday**.

The sizes (the first pick):

- **Light**: the essentials, the fewest extra parts in every chat, the cheapest on the simplest Claude plan.
- **Standard**: the essentials and the next most useful tools for that kind of work.
- **Full**: everything reviewed for that kind of work.

The kinds (the second pick), which shape what is inside each size:

- **Everyday** (`everyday`): tasks, notes, documents, your calendar, mail and files.
- **Student** (`student`): everyday, plus research, slides and Word files.
- **Builder** (`builder`): code review, debugging, tests, docs and checks before going live.
- **Designer** (`designer`): documents, with the design tools.
- **Small business** (`small-business`): spreadsheets, documents, slides, research, simple dashboards, mail and calendar.

Every list holds only free things that are Anthropic's own or official directory connectors (the registry's `check` says so). Every list also holds `simplify`, a coding skill built into Claude Code: writing code waits until a coding skill is loaded, so every person has one to load, with nothing to install. Nothing in any size is installed or connected without its own yes.

## 1. Ask the two picks

1. Ask, in these words: "One choice about how much I bring along. Light keeps every chat small, which matters most on the simplest Claude plan; Standard adds the next most useful tools; Full brings everything reviewed. Which would you like? You can change it any time." Wait for the answer. Done when you hold light, standard, full, or a skip (light).
2. Ask, in these words: "And which sounds most like you: everyday, student, builder, designer, or small business?" Wait. Done when you hold one of the five, or a skip (everyday).
3. A pasted block's `size:` and `kind:` lines answer these; ask only what it left out.

## 2. Apply it

1. Run `node core/engine/registry.mjs` with no arguments: it prints the commands it knows. Done when you know whether `apply` and `sizes` are among them.
2. **With `sizes`:** run `node core/engine/registry.mjs apply <kind> --size <size>`. It marks the set and size and does what needs no yes (helpers, rules, habits); it prints the line saying what a smaller size leaves out, and, in order, the steps that need a yes (installing a skill, linking a connector). None of those is done now: each is asked on its own, in plain words, on the day the person wants it. Then `node core/engine/registry.mjs list --set <kind> --size <size>` for the real counts.
   **Without `sizes`** (an older copy): `node core/engine/registry.mjs apply <kind>`, which has no sizes; tell the person their copy has one size only.
3. Leave the habits in `system/preferences.md` as they are: a line marked `default, not confirmed yet` stays so until the person says yes to it (the start says so in every chat).
4. Run `node core/engine/registry.mjs render`.
5. Write one line in `system/decisions-in-force.md` under `## Your choices` and a dated row in `system/decisions.md`: "Starting set: <size>, <kind>, on your word at set-up (one sentence changes it)" (or "chosen for you" for a skipped pick), reason "the first conversation". Later: the same line with the new picks, replacing it.

Done when `apply` ran, `render` ran, and the choice is written in both decision notes.

## 3. Tell them in one message, no question

Say it in this shape, with the real numbers, no file names:

```
I started you with {Size} for {kind}: my own helpers, {n} skills and {n} connections named for later, and three habits I'll follow until you change them. {For Light or Standard: the program's "leaves out" line, in plain words.} {At every size, Light included: each line the program printed about a service's paid plans, as it printed it.} Nothing is installed or connected until you say yes to that one thing. To change it, just say so, for example "switch to Standard" or "make me a builder".
```

What a size costs, when they ask: `node core/engine/registry.mjs sizes <kind>` prints it in plain words. Never add a number it did not print.

## 4. When they ask to change it

- **Another size or kind:** section 2 with the new picks (the other pick stays as it was); then the same message.
- **Drop something:** for each dropped skill or connector run `node core/engine/registry.mjs remove <id> --reason "dropped on your word"`; for a dropped habit, the same for its id, and delete its line from `system/preferences.md`. A rule changes only with their clear yes, asked on its own.
- **Add something:** the `hive-add` helper. Name it only if they ask.

Done when the decision notes show the size and kind they have now, and `registry.json` shows every dropped item as `removed`.
