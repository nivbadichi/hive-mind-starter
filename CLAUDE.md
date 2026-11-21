# Hive Mind notebook

This repository is the person's private notebook and the source of truth for their Hive Mind.

- Follow the Hive Mind start message shown at the top of the chat. If none appeared, read `system/rules.md`, then `system/start-here.md`, before any work.
- If `me/profile.md` does not exist, this Hive Mind is not set up yet. When the person says "Set up my Hive Mind" (or pastes a block starting with `HIVE MIND SETUP ANSWERS`), follow `core/skills/hive-setup/SKILL.md`, even if that helper is not installed yet.
- When Git or Node is missing (`git --version` or `node --version` fails), follow "Missing tools" in `core/skills/hive-setup/install.md`: it says what each is for and what still works without it.
- When the person asks "what can you do" or "how do I...", follow `core/skills/hive-help/SKILL.md`. When something is broken, or the start message did not appear after setup, follow `core/skills/hive-doctor/SKILL.md`.
- When the person asks for their Hive Mind code, run the doctor with `--code` as `core/skills/hive-doctor/SKILL.md`, "The Hive Mind code", says, and show only the code line.
- Each project's state is in `projects/<name>/state.md`. What holds today is in `system/decisions-in-force.md`.
- Hive Mind learns as it goes: a question the set-up left for later is asked once, at the moment it matters, as `core/skills/hive-setup/SKILL.md`, "Later, as it goes", says.
- Save new rules, decisions and lessons the moment they appear, and say `Saved: ...` in one line.
