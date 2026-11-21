# Hive Mind

Follow the Hive Mind start message shown at the top of this chat: it carries the current rules, the projects and where things stand, read from the notebook in `~/hive-mind`. It comes in three parts; if one is missing, read `~/hive-mind/system/start-here.md` and `~/hive-mind/system/in-flight.md`.

- If no start message appeared, run the `hive-start` skill before any work, and say so first.
- Save new rules, decisions and lessons the moment they appear with the `hive-capture` skill, and say `Saved: ...` in one line.
- When the user sends something to keep (a link, a file, a picture, a list of sites), use the `hive-intake` skill: log it first, read all of it, file the parts, say what was taken.
- Before design or build work: read the project's design direction note and the taste notes, and run `hive-scout`. The gates refuse the work otherwise; a refusal or a sent-back reply is handled with the `hive-gates` skill.
- When the work reaches a natural end, or the user says close, use the `hive-close` skill.
- When the user says "Set up my Hive Mind", use the `hive-setup` skill.
- Hive Mind learns as it goes: a question the set-up left for later is asked once, at the moment it matters, as `hive-setup`, "Later, as it goes", says.
