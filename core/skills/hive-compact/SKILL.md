---
name: hive-compact
description: Make a long conversation safe to shorten. Use when the chat is long, when the user says compact, or before suggesting a compaction or a fresh chat.
---

# Hive Mind compact

A compaction shortens the older part of a conversation. Anything that lives only in the conversation can be lost. The notebook is `~/hive-mind`.

1. **Choose.** A step just closed: recommend a NEW chat (use `hive-close`). In the middle of a step: recommend a compaction. Say which, in one line.
2. **In flight.** Rewrite `system/in-flight.md`: what we are in the middle of, what waits for the user, helpers running, what Claude owes. Remove settled lines. Nothing secret.
3. **State.** Update the state note of each project touched (`projects/<name>/state.md`) and, for Hive Mind's own work, `system/start-here.md`: ONE next step.
4. **Save** with the `hive-capture` save steps (this chat's own files by name; a plain merge pull before the push, never a stash; on a clash stop and name the note).
5. **Tell the user** it is safe, in one line. The user starts the compaction; Claude cannot.

After any compaction the start message says so. Then: read `system/in-flight.md` and the state note before doing anything, and tell the user in one line that the conversation was shortened and what you re-read.

Keep `system/in-flight.md` current all the time, not only here: add a line when a promise, a question to the user or a helper appears, and remove it when settled.
