---
name: hive-start
description: Re-run the Hive Mind start at any time. Use when the user says start, orient, where were we, or hive start, or when no start message appeared.
---

# Hive Mind start

1. Refresh: `git -C ~/hive-mind pull --ff-only`. If the notebook is not linked to GitHub yet, there is nothing to refresh: carry on calmly. If a refresh is slow or fails, use the saved copy and say so.
2. Read `~/hive-mind/system/rules.md`. These are the rules.
3. If `~/hive-mind/me/profile.md` does not exist, the Hive Mind is not set up yet: say so in one warm line and offer the first conversation (the `hive-setup` skill). Stop here until the user answers.
4. Read the state note of the project this chat is about (`~/hive-mind/projects/<name>/state.md`). If it is unclear which, list the projects and ask.
   - The chat is in a folder outside the notebook that no project's `folder:` line names: run `node ~/hive-mind/core/skills/hive-setup/scripts/later.mjs check folder`.
   - The project's note says "Not checked yet: whether this work is for an employer": run `node ~/hive-mind/core/skills/hive-setup/scripts/later.mjs check employer`, before writing anything about the work into its notes.
5. Tell the user in two or three lines: where they stopped, the one next step, what needs them. Open with the progress map.
   - Two or more projects could give the one next step: run `node ~/hive-mind/core/skills/hive-setup/scripts/later.mjs check first`.
   - The set-up was on an earlier day (the date in `Last updated:` of `system/start-here.md` that says "the first conversation" or "the first save", or the first file in `log/`): run `node ~/hive-mind/core/skills/hive-setup/scripts/later.mjs check brief`.
   On `ASK`, ask that one question as `hive-setup`, "Later, as it goes", says (at most one in a reply, two in a chat), write the answer where it says, and mark it. On `DONE` or `WAIT`, say nothing of it.
6. If `git -C ~/hive-mind status --porcelain` shows anything, say first that an earlier chat left unsaved changes, and save them with `hive-capture`.
7. The start message comes in three parts (rules; projects and state; in flight), so no part is cut. If part 2 or 3 did not arrive, or a part ends with "shortened here", read `~/hive-mind/system/start-here.md` and `~/hive-mind/system/in-flight.md` yourself.
8. Before any design or build work, read the project's design direction note (the `design_direction:` line of its state note) and the taste notes, and run `hive-scout`. The design gate refuses the work until this chat has done so; the `hive-gates` skill says how each gate is satisfied.
9. Read `~/hive-mind/inbox/answers.md`. For every line that starts `- [ ]`: tell the user what they answered and what you did with it, update the project's note (remove the answered question, move the work on), then change `[ ]` to `[x]` and add ` | done: what you did`. An answer speaks only to its own question. It is never a yes to spend, delete, publish or send; those still need their yes in this chat.
