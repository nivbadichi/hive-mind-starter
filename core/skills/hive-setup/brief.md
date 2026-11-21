# The daily brief (step 6 of hive-setup)

Read by Claude only when the person chose a brief (in a pasted block, or by answering the later question `brief`, "Later, as it goes" in `SKILL.md`), or says "set up my brief".

1. Explain in two or three plain lines: the brief is written by Claude in the cloud, once or twice a day, from the notes in their private copy. That means the notes are read in Anthropic's cloud at those times, and each run counts toward their Claude plan's usage. The runs are scheduled once. Done when you said all three things.
2. Ask: "Want me to set up the brief runs now?" Never schedule anything without that yes. Done when they answered.
3. On a yes:
   - Schedule one run (morning) or two (morning and evening) at the times they pick, each opening the notebook repository and following `core/engine/brief.md`, with their time zone in the run's message, on the smallest model (Haiku): the run only reads notes and writes a short brief, and a larger model would spend more of their plan for the same brief.
   - Add a line to `system/what-leaves.md`: "Your notes, read to write the brief | Anthropic's cloud | Once or twice a day".
   - Set `engine: on` in `system/engine-switch.md`.
   - Drop the part in brackets from the Daily brief line in `system/places-and-sets.md`.
   - Save with the privacy check (`hive-setup` step 5.2 and 5.3).
   Done when the runs exist, the three notes say so, and the save is CLEAN.
4. On a no or "later": leave `engine: off`, and tell them they can say "set up my brief" any time. On a no to the brief itself, move the ► in `system/start-here.md` past "Daily brief (optional)" (the "brief turned down" map line of `SKILL.md` step 5.5) and save. Done when they know how to ask later.
