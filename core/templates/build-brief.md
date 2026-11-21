# Build brief (template)

Rule 14. Every helper prompt follows this, in this order. The helper gate refuses a launch whose prompt lacks section 2 (a `.md` path), section 3 (exact skill names, or "none, because ...") or report item 2 ("list the skills you actually loaded"); for design or build work, section 2 must name the project's design direction note. For change work it also checks the part "How it will be proven" (a reminder by default; the setting `ticket.mode` in `core/gates/settings.json` makes it a refusal). A helper that only searches or reads carries the line `Mode: read-only` (or is an Explore helper).

**Proof (protocol).** Every report carries its evidence: the command or check that was run, what it printed (or the screenshot, or the measured number), and what was not checked. A claim with no evidence is reported as "not checked". Fill every section; write "none, because ..." instead of deleting one. Pick skills, connectors, parts and protocols from `system/capabilities.md`. Plain words (rule 6).

## 1. Goal and who it is for
One line each. What is built; who uses or reads it.
- Goal: <...>
- For: <...>

## How it will be proven
How the change will be checked. Required when the helper changes anything (code, a gate, a file it writes); a read-only helper leaves it out. Fill all four lines before the launch; a brief that cannot fill them is not ready. The helper gate checks this part, and `core/engine/handout.mjs` reads "Files touched" to keep two helpers off the same files.
- Today: <how to see the fault, or the missing thing, on today's version>
- Steps: <the exact steps a checker walks, on the old version and then the new one>
- Must pass: <the checks and tests that must pass, with their commands>
- Files touched: <paths or globs, separated by commas>. Out of scope: <what this helper leaves alone>

## 2. Pointers to read first
Name the notes and sections. Never retell them.
- <path>, section <...>

## 3. Skills to load
Exact names. Load each with the Skill tool before any work.
- <skill>: <why it fits this task>

## 4. Connectors to use and what for
- <connector>: use for <...>
- Not used: <connector>, because <...>

## 5. Ready-made parts to use
Use ready parts before building by hand. Record each in `system/catalogue.md` with its licence.
- <part>, from <site>, licence <...>, goes in <...>

## 6. Protocols that apply
- <hive-scout / hive-review / hive-capture / hive-close>, and the life-cycle stage (rule 4)

## 7. Precedents to follow
Rule 13. One line each: what was taken, from where.
- <site or product>: <what to take>

## 8. Rules
- Finished means: every step of the proof part passed. Inside approved work, a routine obstacle (a failing test, a missing folder) is diagnosed and fixed and the work goes on, unless the fix is one of the acts that need the person's yes (deleting, pushing, publishing, installing, connecting, spending); a deliberate barrier (a refused step, a protected file, missing access) is reported as a blocker, never worked around.
- Exact work goes to a program; judgment stays with the helper. If a step must give the same result every time (a count, a format, a file move, a check), write or use a small script for it and run that, instead of doing it by hand each time.
- Before the work, look at `knowledge/INDEX.md` and open the notes that fit the subject.
- Never invent a fact, a number or a result: leave a blank and put the question in the report.
- Edit only: <paths>. Other helpers work elsewhere.
- No commit, push, stash or branch switch.
- Nothing leaves the computer: no upload, send, install, connect or payment without the person's yes (rules 1 and 2).
- No secrets in notes. Do not open `me/` or `archive/`.
- If context is missing, list the question in the report; do not guess and build.
- Work inside the container (added 2026-11-20). Build and test your change in the project's sealed container, not on the computer itself: `docker build -f <the project's Dockerfile> -t <name>:test <its folder>` then `docker run --rm --network none --cap-drop ALL --security-opt no-new-privileges <name>:test`. Write `docker` literally, never through a variable. Never `docker push`, `docker login`, a remote Docker host, `--privileged`, `--network host`, the Docker socket or a folder of the computer mounted in. If `docker --version` fails, say "not run: Docker is not installed here", run the tests on the computer, and never install Docker yourself. Not tried yet in this copy.

## 9. Checks before reporting
Say what each check covered.
- <build passes; sizes and zoom; contrast; reduced motion; keyboard; no real data in a public build; the live address if published>
- <inside the container: the last line of each run, or "not run: Docker is not installed here"; the image's file list searched for private files when container files changed>

## 10. The report
A few plain lines, under 15, no tables. Detail goes in the notebook.
1. What was built, and where (paths).
2. Skills actually loaded (list in your report the skills you actually loaded).
3. Connectors actually used, and what for.
4. Ready-made parts used, with licences recorded.
5. Protocols run.
6. Skipped, and why (any skill, connector, part or protocol from sections 3 to 6 not used).
7. What was not checked.
8. Questions for the person, one topic each, ready to ask in the question format.
9. Which model did the work (rule 12).

A report that omits items 2 to 6 is sent back.
