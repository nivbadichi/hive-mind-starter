# Use what fits

This check holds rule 14 of your Hive Mind: before design or build work, match the work to the skills, connectors and protocols you have, and use them; never claim one that was not used.

## What it stops

Before Claude writes a screen file for you (a page, a style sheet, a component) or a program file (a script, a module), it checks that the skills this kind of work always needs were really loaded in this chat with the Skill tool. Out of the box those are `hive-scout` and `impeccable` for design work, and `animate` as well when your message is about motion. If one is missing, the write is refused, the missing ones are named, and Claude is told the one thing to do: load them, follow them, and try the same write again.

Never stopped: notes (`.md`), settings and data files, built folders (`node_modules`, `.next` and the others in `settings.json`), the computer's temporary folder, and every read.

Code waits for know-how too (the ruling of 2026-11-21). Writing a program file, or a screen file that is also code (`codeAlso`; a picture such as `.svg` is not), waits until at least one coding skill of `oneOf.build` in `settings.json` is loaded. That list holds only free skills you really have: `simplify`, `code-review` and `security-review` come built into Claude Code, and every starting package names `simplify`; the `engineering:` ones come with Anthropic's engineering plugin, which the builder package installs on your yes. The refusal names two that fit the file (`suggest`), always ones built into Claude Code. Notes, settings and data files are never code.

## What it puts in front of Claude, and what becomes a debt

- **At your message.** When your words look like design, build or motion work, Claude is given, once per kind per chat, the skills that work always needs (and which are still not loaded), the other skills that fit, the connectors that fit, and the protocols that apply, all from your registry. While an "always" skill is still missing, each later message of that kind gets one short line saying so.
- **At the end of a reply.** A `Used:` line (or "Skills used:", "Skills loaded:") that names a skill never loaded in this chat becomes a debt, something the next reply must put right. So does a turn that wrote a screen or program file while an "always" skill was missing.
- **When a helper stops.** A helper's report that says it used a skill no one in this chat loaded is put in front of Claude, so the claim is not passed on to you as true.

## What it cannot see, and why

- It cannot tell whether a loaded skill was followed. Loading it is all a program can see.
- Connectors and protocols are listed, never checked: a program cannot see whether they were really used.
- The kind of work comes from file endings (screen or program) and from your words (motion). Design work in a program file, or a message with none of the kind words, is not seen as that kind.
- Shell lines are read roughly. A write from inside a script is not seen before it happens; the end-of-reply debt catches it only if the write was recorded.
- A skill loaded by a helper counts for the whole chat, because the record does not say who loaded it.
- The kinds, the "always" skills, the connectors and the protocols live in one place: the "fit" part of `core/gates/settings.json`. If that part is missing, the check stops nothing and logs `fit-missing`.
- The matching is the same as the gates' `fit` command; a test checks that the two agree.

## How to switch it

The mode is in `check.mjs` (`mode: "refuse"`), or `"mode"` in `settings.json`; "notice" turns a refusal into a reminder, "off" stops it. Tell Claude in your own words if you want it changed. If the check breaks, it lets the work through and logs the error. Which skills are "always" for a kind is `fit.always` in `core/gates/settings.json`; the `oneOf` lists, the file endings and the word lists are in this folder's `settings.json`.

## Three examples of what it catches

1. You ask for a new landing page and Claude starts writing the page file at once, without loading the design skills. The write is refused until `hive-scout` and `impeccable` are loaded.
2. Claude ends a reply with "Used: impeccable, emil-design-eng" but only loaded `impeccable`. That becomes a debt, and the next reply must say plainly that the other was not used.
3. You ask Claude to animate a hero section. Besides the design skills, `animate` must be loaded before the first screen write.

## Tests

`node --test starter/core/checks/use-what-fits/check.test.mjs`: each behaviour has a case that must be caught and one that must pass, one test for how it behaves on its own error, one for speed (under 50 ms a step), and one that compares the match with the gates' own `fit` command.
