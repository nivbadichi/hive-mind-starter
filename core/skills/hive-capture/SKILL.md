---
name: hive-capture
description: Save new rules, decisions and lessons to the Hive Mind notebook the moment they appear. Use whenever the user states a rule or preference, makes a decision, or a mistake teaches something.
---

# Capture

Save at once, without asking. The notebook is `~/hive-mind`.

1. **Find the home.** One home for each truth:
   - A rule for every chat: `system/rules.md` (changing it changes the protocol: needs the user's yes).
   - A decision: add a row to `system/decisions.md` (date, decision, reason). If it holds from now on, also update `system/decisions-in-force.md`; if it replaces an older one, remove the older one from that list.
   - A lesson: one line in `system/lessons.md`, ending with `closed_by: <the check, helper or rule that changed because of it>`. If nothing changed yet, write `closed_by: open` and add one line to `system/in-flight.md` saying what will close it.
   - A standing wish of the user ("always", "never", "from now on"): one dated line in `system/preferences.md`. If it is a skill, connector or protocol, also run the `hive-add` helper with it.
   - Something about the user (taste, habits, goals): `me/context-map.md`.
   - Where a project stands: that project's `projects/<name>/state.md`. Keep its header current: stage, health, next_step, needs_you, updated. ONE next step.
   - Where the Hive Mind itself stands (setup, page, briefs): `system/start-here.md`.
   - A promise by Claude, a question waiting for the user, or a helper started: one line in `system/in-flight.md`. Remove the line when it is settled.
2. **Never duplicate.** If the note changes an older one, change that one. Edit one line at a time and read it back: a note saved with Windows line endings can make an edit across several lines find nothing. If an edit found nothing, read the file and write the whole file again.
3. **Keep it short and plain.** No secrets. Work for an employer stays high level.
4. **Log it.** Add one line to `log/<today>.md`: the time, the project, what changed.
5. **Save point.** Several chats may be saving at once, so save only this chat's own files, by name.
   1. List the files this chat changed. Run `git -C ~/hive-mind add -- <those paths>` (never `add -A`), then `git -C ~/hive-mind commit -m "<what was saved>"`. The privacy check runs by itself; if it refuses, fix the note and save again.
   2. Anything else that is unsaved belongs to another chat or to nobody: name it to the user in one line and leave it alone.
   3. Run `git -C ~/hive-mind pull --no-rebase --no-edit` (a plain merge: it brings in what other chats saved and leaves their unsaved files exactly where they are; never stash), then `git -C ~/hive-mind push` (approved by the user for the notebook). Never force, never pick a side of a clash.
   4. A clash (the pull stops): stop there. Tell the user in one plain line which note clashed, and write the clash as one line in `system/in-flight.md`.
   5. If the push fails for another reason, say so and carry on; the next start reports it.
6. Tell the user in one line: `Saved: <what>`.
