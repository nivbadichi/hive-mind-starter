# The self-guard check

This check guards the other checks. Its job is to make sure Claude can never weaken its own checks without you knowing. Its kind is safety: if the check itself breaks, it stops the step and says so; it never quietly lets the step through.

## What it stops (before a tool runs)

- **Claude working an off switch.** Claude may not create or delete the gates-off file, the factory-off file or the publish hold, and may not turn every hook off. This is stopped unless your own latest message names the act, for example "gates off". A bare "sure" or "ok" does not count, and nothing said in a helper chat ever counts.
- **Claude making a check softer.** Some edits make a check weaker: turning its mode from "refuse" to "notice" or "off", setting "enabled" to false, taking words out of one of its lists, changing a check from "safety" to "discipline", or taking a step out of a check module. Each of these is stopped unless you asked for it. Making a check stricter is always allowed.
- **Claude taking hooks out of the app's settings.** A hook is the entry that tells the app to run a check. Stopped: removing one of Hive Mind's hooks, turning on the app's switch that disables all hooks, taking rules out of the app's "ask first" and "never" lists, or setting the app to skip every permission question.
- **Claude touching what guards it.** The installed copies, the gates' own records, this check's records and the log are written only by the programs that own them. Claude may read them. Claude may not delete, empty or overwrite them.
- **Running the installer unasked.** The installer swaps the installed copies of the checks, so it runs only when your message asks for it, for example "reinstall the gates". A dry run is always allowed.
- **Working while the installed checks are not the notebook's.** At the start of each chat and at each of your messages, every installed copy is compared with the notebook's by its fingerprint (a hash: a short code that changes when even one letter of the file changes). If a copy differs, is missing, or changed after the install, you are told. Until you rule, every step except reading is stopped. You rule by saying "reinstall the gates" or "accept the installed copies".
- **Changed on 2026-11-20.** Only your own typed message, or your yes on a question card that asked it, rules; a helper's report or a notice never does. A copy that differs only in line ends is the same copy. Reading, the installer's help and dry run, and the installer on your word are never stopped. How hard the lock bites is the setting `held.bite` ("strict" by default; "narrow" stops only publishing, deleting, installing, spending and changes to the checks). Your own phrases from the manuals, such as "add the small parts" and "undo the Hive Mind setup", are words this check accepts. A step that only names the installer's file is not running it, and one aimed at a made-up Claude folder under the system temp folder passes.

## What it only says (at your message)

- A chat with no start record: the start step did not run. The check says so, then writes the record itself, so the checks act from the next step on.
- Hooks that are missing from the app's settings, or that no longer cover a tool they should.
- The canary: each hook leaves a mark when it fires. At your next message, a missing mark is said out loud. For example: the end-of-reply hook did not fire, or the tools ran but the before-a-tool hook did not.
- A switch that changed since your last message, and who changed it. Either Claude changed it because your own words asked for it, or no chat's tools changed it: it was done by hand, by another program, or in a chat without the checks.

## What it cannot see, and why

- **Nothing at all until the gates call it.** The gates must call the module loader, and must run the safety steps before they test for a start record. Until then, the probe command fails, and says so.
- **A program that builds a path in pieces.** For example, a program that glues together "gates" and "-off" from two variables. A shell command is read as text. A program that hides the place it writes to cannot be seen before it runs. The comparison at your next message still notices that the switch changed, and logs it as changed outside the chat.
- **Changes made outside Claude's tools.** A change by hand, or by another program, cannot be stopped. It is seen and logged at your next message.
- **Changes to the notebook's own check files.** Writing a check's files in the notebook is how checks are built, so it is allowed. Only making a check weaker, deleting it, or moving it is stopped. A change to the gates' main program is not judged; it shows up as "differs from the notebook" until the installer runs.
- **Numbers.** Raising a word limit or a time limit is not judged as a weakening.
- **The hook that fires at the start of a chat.** It has no mark of its own. A missing start record stands in for it.
- **At your message, not every file is read again.** A message must stay inside the 200 ms the loader gives one step, so new files are read for at most 50 ms (the gates and the start step first, the skills last), and the rest is finished over the next messages. Files already read are known by their size and time stamp. A copy changed with its size and time stamp put back is therefore missed at a message; the start of a chat and the verify command read every file again and find it. On some computers one file read can stall (a virus scanner looks at new files), so a message can now and then take longer than the loader allows; the loader then reports the check as too slow for that message, and the next message carries on.
- **A command that only reads.** A shell command counts as reading only when every part of it starts with a reading word (`ls`, `cat`, `grep` and the others in the settings). "ls && node x.mjs" is not reading. A reading word that writes in a way the list does not know is still a gap.
- **Hooks switched off where it does not look.** It reads the app's settings in your home folder and the notebook's (and the chat's folder). Hooks switched off for one run from the command line, or by company-wide settings, or added by a plugin, are not seen. The canary still notices when a hook stops firing.

## How you switch it

It is a safety check, so it has no off switch of its own. You can make it softer only in your own words, for example "switch the self-guard check to notice". Its word lists are in its settings file. Taking a word out of a list is itself refused unless you asked for it.

## Commands (for you, the health check and the brief)

    node core/checks/self-guard/cli.mjs start    one line for the start of a chat: every file compared, with its time, and the hooks
    node core/checks/self-guard/cli.mjs verify   the installed copies against the notebook's, by hash, every file read again
    node core/checks/self-guard/cli.mjs hooks    hooks missing from the app's settings
    node core/checks/self-guard/cli.mjs canary   when each hook last left its mark
    node core/checks/self-guard/cli.mjs probe    does the installed gates program stop a made-up write of the off switch?
    node core/checks/self-guard/cli.mjs log      the log in plain words: what was stopped, what is owed, what was switched and by whom
    node core/checks/self-guard/cli.mjs count    one line for the daily brief

Every command takes `--home <folder>` to work on a made-up home instead of the real one. The tests always use one.

The one line the start step needs (it may take a second or more; it says its time, and a difference holds from the first step):

    node "<notebook>/core/checks/self-guard/cli.mjs" start

The one line the daily brief needs (yesterday's count; `--day YYYY-MM-DD` for another day):

    node "<notebook>/core/checks/self-guard/cli.mjs" count

## If the check itself breaks

It is a safety check. Before a tool, its own error stops the step and says so; reading (Read, Grep, Glob) still passes, so the break can be looked into. At your message, its own error is said to Claude.

## Three cases this check is for

1. Claude writes the gates-off file, or edits the gates' settings to "off", while you are away. Before this check, nothing noticed. Now it is stopped, unless your own message asked for it.
2. A chat starts, and the start step fails or times out. Before this check, every check stayed off for that whole chat. Now that is said at your first message, and the checks act from the next step.
3. An installed copy of a check is older than the notebook's, and nobody notices for days. Now the two copies are compared at every message, and work stops until you rule.
