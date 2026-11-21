---
name: hive-doctor
description: Find and fix what is broken in Hive Mind on this computer. Use when the person says something is broken or not working, "fix my Hive Mind" or "run the doctor"; when no HIVE MIND start message appeared or it says the notebook was not found; after a move, a new computer or a reinstall of Node; and for "Give me my Hive Mind code".
---

# The doctor

Runs the checks, turns each finding into one plain step, fixes what needs no yes, and asks once for the rest. The person hears what was wrong and what changed, in plain words, never the check lines themselves.

The notebook is the folder this chat is in when it holds `system/rules.md`; otherwise the one the start message names; otherwise `~/hive-mind`. Every command below runs from the notebook folder.

## The Hive Mind code

When the person asks for their Hive Mind code, this section is the whole job; skip the rest.

1. Ask once, in one line: "May I ask GitHub whether your copy is private? It asks one question about your copy and sends nothing else." Done when they said yes or no.
2. Run `node core/skills/hive-doctor/scripts/doctor.mjs --code`, adding `--online` only after a yes. Without `--online` nothing leaves the computer. Done when it printed one line starting with `HM-`.
3. Show them that line and nothing else from the run: the ordinary doctor lines hold folder paths with their user name, and the code holds none. Say they can paste it into the steps page. Done when they have the code.

## 1. Run the checks

1. `node --version`. If it fails, Node is missing: that is the finding. Skip to step 3 with the fix `no-node`. Done when you know whether Node runs.
2. `node core/skills/hive-doctor/scripts/doctor.mjs`. It reads only and works on Windows, Mac and Linux. Each line is `OK`, `FIX` or `NOTE`, then an id, then the text; the last line counts the faults. Done when you hold every `FIX` and `NOTE` line.
3. The deeper checks, each only where it runs:
   - `node core/engine/registry.mjs check`: every `NEEDS|` line is a finding. On a computer where the parts were never installed, the line "not found on disk" for a helper is expected; leave it out.
   - Windows only: `powershell -NoProfile -ExecutionPolicy Bypass -File system/check.ps1`. Every `NEEDS YOU` line is a finding. On Mac and Linux this check does not run yet; say so in one line.
   Done when every finding from steps 1 to 3 is in one list.

## 2. Match each finding to its fix

| id | What it means | The fix | Yes needed |
|---|---|---|---|
| `no-node` | Node is not on this computer | `core/skills/hive-setup/install.md`, "Missing tools" | yes (the person installs it) |
| `no-git` | Git is not on this computer | the same section | yes (the person installs it) |
| `notebook-missing` | no notebook where the parts look, and the chat is not in one | `install.md`, "The copy" | yes |
| `notebook-path` | the parts look in one place, the notebook is in another | `install.md`, "The notebook's place" | yes |
| `not-installed` | none of the parts are on this computer | `install.md`, "The parts" (the whole install) | yes |
| `part-missing`, `hook-missing`, `hook-broken`, `skill-missing`, `skill-stale`, `claude-md-block`, `settings-unreadable` | one part is gone, changed or points at something gone | run the installer again (`install.md`, "The parts"): it is safe to run again, keeps a dated copy of each file it replaces, and puts back only what is missing or changed | yes, one for all of these |
| `gates-blind` | the gates do not find the notebook (or are an older version that cannot say where they look), so every gate is off without a word | run the installer again from the notebook (`install.md`, "The parts"; after a move, "The notebook's place") | yes |
| `two-ways` | the installed parts and the plugin are both in, so every helper is there twice | ask which way to keep; the line gives the one step for each (remove the plugin, or `install.md`, "Undo") | yes |
| `not-git` | the notebook is a downloaded copy, not a Git folder, so nothing saves | `install.md`, "The copy" | yes |
| `no-online-copy` | the notes live only on this computer | `hive-setup` step 5.4 (make or link the private copy) | yes |
| `no-save-hook` | the privacy check does not run at saves | run the installer again | yes |
| `copy-public` | anyone can read the online copy, so every note in it is public (found only with `--online`) | on GitHub, the copy's Settings, Change visibility, Private (the person does it) | yes (the person does it) |
| `copy-not-checked` (note) | GitHub did not answer whether the copy is private | ask again later; nothing to fix here | no |
| `privacy-stop` | the privacy check found a key or a protected name in the notes | `docs/when-it-breaks.md`, "A save was refused" | yes |
| `privacy-check` (note) | an email address sits outside `me/` | ask whether it may stay, or move it into `me/` | yes |
| `privacy-not-checked` (note) | the Node form of the privacy check is not in the notebook or the parts | run the installer again (`install.md`, "The parts") | yes |
| `not-saved-online` (note) | the notes are set up but not saved to the online copy yet | `hive-setup` steps 5.2 to 5.4 (the first save) | yes |
| `no-starting-set` (note) | set up, but no "Starting set:" line in `system/decisions-in-force.md` | `hive-setup` step 4a (the starting set) | no |
| `not-started` (note) | no new chat in the notebook has started with Hive Mind since the install | say: "Open a new chat in the hive-mind folder and say hello." | no |
| `gates-off` (note) | the gates are switched off | a choice, not a fault: say it, and ask whether to switch them on (`hive-gates`) | yes |
| `not-set-up` (note) | the first conversation has not happened | offer it: `hive-setup` | no |
| `two-notebooks` (note) | this folder and the one the parts use are both notebooks | ask which is theirs; the other is left alone | yes |
| registry `NEEDS` "lists are behind" | the made lists are older than the registry | `node core/engine/registry.mjs render` | no |
| health check "not saved" | an earlier chat left changes | save them with `hive-capture` | no |
| health check "dashboard refreshes", "not on GitHub yet", "first conversation is done" | true of every fresh copy: the page is not built, the first save online and the first conversation have not happened | not a fault: the matching step of `hive-setup` | no |

After the person said "remove the gates", the gate lines are their choice (`hook-missing` for each gate, `part-missing` for the gates, `skill-missing` for `hive-gates`): say so in one line, and leave them.

A `skill-stale` helper may hold the person's own change: say which helper, and that the installer keeps the old copy beside it as `SKILL.md.bak-<date-time>`.

For a finding not in the table, look for its symptom in `docs/when-it-breaks.md` when that file exists; otherwise explain what the line says in plain words and ask what they want done. Never guess a fix.

Done when every finding has one fix and is marked "no yes" or "yes".

## 3. Fix, then check again

1. Do the fixes that need no yes, one by one.
2. Tell the person in one short message: what is wrong (each in a few plain words), what you already fixed, and the rest as one question, for example: "Two things are off: a helper went missing and one check is not connected. I can put both back by running the setup again; it keeps a copy of everything it replaces. Shall I?" One yes covers the list you named, nothing more.
3. Do the fixes they said yes to. A step the person must take (installing Node or Git, signing in) is theirs: give them the one line from `install.md` and wait.
4. Run step 1.2 again (and 1.3 where it ran). Done when `doctor.mjs` prints `ALL FINE`, or every line left is a `NOTE` or a fix they said no to.

## 4. Report

Two or three plain lines: what was wrong, what is fixed, what is left and why. If a fix needs a new chat to show (the start message, a helper), say: "Open a new chat and say hello: I should greet you by name." Write one line in `log/<today>.md`: "Doctor: found <n>, fixed <n>, left <what>." Done when the person has the two or three lines and the log line is written.
