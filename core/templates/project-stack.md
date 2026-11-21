---
project: <project name>
tags: <tags>
updated: <date>
---

# Full stack checklist: <project name>

The whole list of what a real product needs (`system/stack.md`), kept for this project. A person reads it; `node core/engine/stack.mjs check` reads it too, so keep the shape: one row per line, the same seven columns.

Each row's **Status** is exactly one of:

- **used**: it is there. Detail says what; Where says where it lives in the project.
- **not needed**: Detail gives the reason. A row with no reason fails the health check.
- **missing**: it is needed and not there. Due when the project reaches the stage in From.
- **not yet**: needed from a later stage. From says which stage. Once the project reaches it, change the row to used or missing.

Change a row with `node core/engine/stack.mjs set <project> <id> <status> "<detail>" [--where ".."] [--from <stage>]`, so the date and the shape stay right. After `system/stack.md` gets new lines, run `node core/engine/stack.mjs sync <project>`.

<!-- lines -->
