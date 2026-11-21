---
name: hive-close
description: Close a chat properly. Check, hand over, sync. Use when the user says close, wrap up, end, or hive close, or when the work reaches a natural end.
---

# Hive Mind close

Everything was already saved as it happened, so the close is short. Print one line with a tick after each step.

1. **Check.** Show the proof for what changed in this session. List plainly what was not checked. Run `~/hive-mind/system/check.ps1` with the PowerShell tool and report anything that needs the user. Then run `node ~/hive-mind/core/engine/value.mjs week` and show its lines (at most six) as "This week" in the closing summary; a count it cannot make says "not counted here", and time or tokens saved stay "not measured".
2. **Hand over.** Update the state note of each project touched (`~/hive-mind/projects/<name>/state.md`): stage, health, ONE next step, needs_you, today's date. Remove scratch files you made yourself and say so. Write the day's learning note in system/learned.md (a few plain lines), never in the reply.
3. **Sync.** If this is the first save to the private copy online (the notebook has no online branch yet: `git -C ~/hive-mind rev-parse --abbrev-ref --symbolic-full-name @{u}` fails), first run `node ~/hive-mind/core/skills/hive-setup/scripts/later.mjs check names`; on `ASK`, follow `hive-setup` step 5.4.1 (the one question they may skip, the names list, the privacy check again, mark). Then save and push the notebook with the `hive-capture` steps 5 and 6: this chat's own files by name, a plain merge pull before the push (never a stash), and on a clash stop and tell the user which note clashed. Then show the closing summary: done and proven, not done, the next step, what needs the user.
