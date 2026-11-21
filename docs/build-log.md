# How this starter was checked (the build log)

This is the record kept by the people and Claudes who build Hive Mind. You do not need it to use your Hive Mind; the manuals start at [Your first hour](first-hour.md). It was the file `CHECKS.md` at the top of the folder until 2026-11-19.

Checked on 2026-11-16, on Windows, by the Claude session that built it, in two rounds. Between the rounds a separate tester ran the starter end to end on fresh copies and found ten defects (D1 to D10); round two fixed them and checked again. Nothing was installed, nothing was sent anywhere, and Claude's own settings folder was not changed. Every test ran on a throwaway copy in a temporary place, deleted afterwards. Fake home and Claude folders stood in for the real ones.

## Results (round two)

| Check | How | Result |
| --- | --- | --- |
| Shell scripts are valid | `sh -n` on `core/start/start-cloud.sh`, `core/guard/pre-commit`, `core/guard/post-commit`, `core/guard/cloud-hooks/pre-commit` | Pass, all four |
| Settings snippet | Parsed as JSON | Valid; starts the start step with `-ExecutionPolicy Bypass` |
| Snapshot tests | `node --test system/snapshot.test.mjs` | Pass, 19 of 19 (new: "Stays on your computer", projects in `order:` order, the progress map line from `hive-setup` reads as done, then current) |
| Snapshot of the empty starter | `node system/snapshot.mjs --no-health` on a fresh copy | Valid file, 0 projects, no errors; `git status` stays clean because the file is ignored |
| Privacy check, both forms | `node core/guard/privacy-guard.mjs .` and `privacy-guard.ps1 -Root <copy>` | CLEAN, exit 0 |
| Save hook finds the check inside the notebook | Hook installed in a copy, HOME set to an empty folder, a commit | `PRIVACY GUARD: CLEAN`, commit made |
| Save hook stops a secret | A planted fake key line, then a commit | STOP, value hidden, "save refused", exit 1, no commit |
| Save hook with `HIVE_GUARD` | `HIVE_GUARD` pointed at the Node form | CLEAN, commit made |
| Save hook with no check anywhere | A bare repository, empty HOME | "the privacy check could not run ... refused", exit 1 |
| Cloud save hook | A commit through `core/guard/cloud-hooks` | CLEAN, commit made |
| Start step, day one | `start.ps1` with `HIVE_ROOT` on a copy that has no GitHub link | Banner "[ok] Notes kept on this computer" and "Not set up yet: say Set up my Hive Mind"; no "not refreshed" warning |
| Start step enters project mode from `folder:` | A test project with a `folder:` line, the chat opened in a subfolder of it | "[ok] Project: my-shop", "This chat is in the project: my-shop" |
| Most important first | Three test projects with `order:` 1, 2, 3, folder names in another order | The start step, the cloud start and the snapshot all list them 1, 2, 3 |
| Progress map read as done | The exact line from `hive-setup` step 3.5 put into `start-here.md`, then the snapshot | "done: The first conversation", "current: Notes saved to your private copy" |
| Health check | `system/check.ps1 -Root <copy> -ClaudeDir <fake folder>` | Runs to the end; projects, start note and privacy check OK; lists the parts not installed |
| Nothing personal | A text search of this folder for the maker's name, account, site address, project, course and place names, and email addresses | 0 for each |

## Round three: the gates and the three-part start (2026-11-16, evening)

The discipline gates, the three-part start step, the build brief and the capability map were brought in from the main system, cleaned of everything personal, and merged with the starter's own changes.

| Check | How | Result |
| --- | --- | --- |
| Gate test suite, against the starter's own notes | `node core/gates/test.mjs` (temporary folders only; reads the starter's rules and notes to measure the start) | 87 of 87 PASS: every start part under 9,000 characters (rules part 3,356; all-in-one 4,795), all 14 rules arrive whole, design gate, helper gate, reply check, reminder, switch off and on, failing open, timing, installer and uninstaller on a fake Claude folder |
| Snapshot tests | `node --test system/snapshot.test.mjs` | 19 of 19 PASS |
| Shell scripts and settings files | `sh -n` on the four shell scripts; both settings files parsed as JSON | Pass |
| Privacy check, both forms | On a fresh copy | CLEAN, exit 0 |
| Snapshot of the empty starter | `node system/snapshot.mjs --no-health` | Written, 0 projects, no errors |
| Installer, dry run, on a fake Claude folder | `install.ps1 -ClaudeDir <fake> -Root <copy> -DryRun` | Lists the changes, writes nothing |
| Installer on a fake Claude folder with no Hive Mind block | Same without `-DryRun` | Start step, privacy check, gates, 8 helpers installed; hooks merged with a dated copy of the old settings; the Hive Mind block added at the end of an existing CLAUDE.md, the existing lines kept, with a dated copy; the save hook added to the copy's notebook |
| Installer run again | Same | "Nothing to change" |
| Health check before and after | `check.ps1 -ClaudeDir <fake>` | Before: lists what is not installed. After: 42 of 44 pass; the two left are "not on GitHub yet" and "the first conversation is not done", both true for a fresh copy |
| Start step with the gates installed | `start.ps1 -Part rules`, `HIVE_STATE` on the fake folder | "GATES ARE ON" line, the not-set-up offer, the calm "notes kept on this computer" line; a start record written for the gates |
| Uninstaller on the fake folder | `uninstall.ps1 -ClaudeDir <fake>` | Gate hooks removed, start step back to one entry (with the Bypass flag), gates script and its helper set aside |
| Installed save hook | A commit with HOME set to an empty folder, then one with a planted fake key line | CLEAN and saved; then STOP, "save refused", no commit |
| Nothing personal | Text search of this folder: the maker's name, account, site address, project, course and place names, email addresses, their design picks, precedents, component sites and design file | 0 for each |

## Round four: the first real setup trial, and its fixes (2026-11-18)

A trial played a new person (a made-up "Maya") through the setup and found seven defects. All seven were fixed in this copy and checked on a throwaway copy with a fake home folder, a fake Claude folder and a local stand-in for GitHub. Nothing real was touched.

| Fixed | How it was checked | Result |
| --- | --- | --- |
| A new chat did not know who you are: the start now hands over an "About you" block (the first 600 characters of `me/profile.md`, cut at a line end) and your places in one line, in the PC start and the cloud start | New tests in `core/gates/test.mjs` (12 added): a profile with a name and a rule appears in the state part and the one-part start, PC and cloud; a missing profile still works in all four parts; a 60-line profile and a single 3,000-character line are cut at 600 with a pointer; every part stays under 9,000. The new tests fail on the old start files | 99 of 99 PASS |
| The next step stayed old after the first save | `hive-setup` step 5.5 moves the marker and rewrites the next step, then saves again. Replayed by hand on the copy: the map read as done, done, current, and the next step was new. Two new snapshot tests read both marker lines | Pass; 21 of 21 snapshot tests |
| Private names were never asked for; the undo deleted the list | `hive-setup` now asks, and writes `~/.claude/hive/protected-names.txt`, the file both privacy checks read. Planted a name and a fake key (built from parts) in a notes file: both saves refused, by both forms of the check. Full undo on the copy kept the list | Pass |
| The undo did not say which backup to restore | `SETUP.md` says the oldest. On the copy, the oldest settings backup had no gates; the newer one (from the gate remover) had 6 gate lines. The dry runs of the installer and the gate remover now say `.bak-<date-time>` | Pass |
| "Five questions" was not true; the first save did not link the copy | `SETUP.md`, `README.md` and `hive-setup` now say five questions and up to three small ones. On a copy with no link, plain `git push` failed; `git push -u origin main` worked and linked it | Pass |
| A line-ending warning on every save | `.gitattributes` now has `* text=auto eol=lf`. With Git set to convert line endings (as on most Windows computers), the old rules warned; the new ones were silent. Every `.ps1` is plain ASCII and ran with Unix line endings. Helper steps now say to edit one line at a time and read it back. A CRLF copy of the notes reached the start in both forms (test) | Pass |
| Inside words | `SETUP.md` (above "For Claude"), `README.md`, `CLAUDE.md`, `hive-gates`, the start-here note and the brief template: words that spoke of the maker became "you" or "the person"; "gates", "start step", "helper" and the installer are explained where they first appear. Text search of the starter for the maker's name, account, address: only the copyright line in `LICENSE.md` | Pass |

Also run on the copy, all as expected: `node core/gates/test.mjs` (99 of 99), `node --test system/snapshot.test.mjs` (21 of 21), `sh -n` on the four shell scripts, both forms of the privacy check (CLEAN), the installer dry run, the real run and a second run ("Nothing to change"), `system/check.ps1` (47 of 47), the gate remover (dry run and real) and the full undo (settings and instructions back to the originals).

Still not checked after round four: a real chat with the new start; whether the person's name actually comes back in a real first reply; a real first conversation with the new private-names question; real GitHub (the push went to a local stand-in); Windows line endings in a note edited by a real editor and then by Claude's edit tool; the release blanks (the copy's own address, and the GitHub account to write in it) are still blanks; the lines worded for the maker in `gates.mjs`, `rules.md` and `brief.md` (not edited in this round).

## Not checked

- A real first conversation with the `hive-setup` helper, in a real chat.
- The gates inside a real Claude chat (the tests feed the hooks the input Claude Code documents; a live chat was not run).
- Installing the parts into a real Claude settings folder, and the undo.
- A push to a real private copy, and making that copy with the GitHub connector or `gh`.
- Scheduling the daily brief runs, and a real brief run.
- The exact button names in the Claude desktop app for opening a chat in a folder.
- Your page: its code is not in this copy yet.
- Mac and Linux.

## Round five: the front door (2026-11-18)

Brought in from the main system and cleaned of everything personal: a ninth helper (`hive-intake`), the list of what you send (`inbox/sources.md`), the folder of what your Hive Mind has learned (`knowledge/`), a fifth gate that sends a reply back while something you sent is missing from that list, additions inside rules 5, 6 and 7, the daily run's tidy-up look and its Sunday look for notes that disagree, and the start telling every chat what you sent that is still open.

| Check | How | Result |
| --- | --- | --- |
| Gate tests, with the new front-door tests | `node core/gates/test.mjs` | See the count printed by the run; every line PASS on 2026-11-18 |
| Snapshot tests | `node --test system/snapshot.test.mjs` | Pass |
| The start shows an open line | A test line added to `inbox/sources.md`, then the start's second part | The line appears under "Sent by the user, still open" |
| Nothing personal | Text search of this folder | The maker's name appears only in `LICENSE.md` |

Not checked: the front-door gate in a real chat; a real Sunday run.

## Round six: the guards of the daily run (2026-11-18)

A small program now decides whether a run may go ahead: the switch, one run of each kind a day, a last day, three runs with nothing to say, and a ceiling on a run's length. Check: `node --test core/engine/guards.test.mjs`, 10 of 10, in temporary folders. Not checked: a real run in the cloud using it.

## Round seven: keeping every end in step, by a program (2026-11-18)

`system/ends-check.mjs` runs inside the health check. It reads `system/ends.json` (the list of your ends) and `system/dead-phrases.md` (phrases a later decision made untrue) and flags anything behind. Checked: on a fresh copy it prints no failing line; a planted stale phrase is caught. The scouting helper got back its sweep of ready-made-part sites and its bolder push; rule 14 got back its full wording.

## Round eight: the copy brought in step with the main system, and a starting set (2026-11-18)

What is new, in plain words. The copy gained the programs and helpers the main system gained in one night: the list of skills, connectors, rules and habits (`core/engine/registry.mjs`) with two new helpers (`hive-add` adds, changes or removes one thing from one sentence; `hive-project` sets up a project from one sentence), the value and project programs, the newer gates and start (standing wishes, about you, the checks on corrections, proof, yes and long chats), a safer way of saving, the lesson rule (`closed_by`) and the newer health check. It also gained a starting set, `system/registry.json`: the 15 rules (13 held by a check, 2 text only), the 11 helpers, 13 skills and 4 connectors named for design, coding, documents, research and organising (none installed, none connected), and 3 habits marked as defaults. The first conversation shows the set and asks once: keep it all, or drop some.

Left out on purpose: skills the maker imported from other makers (their licences and sources are not recorded, so none is listed or copied), and any connector whose source is not recorded. Nothing under a "no passing on" licence is in this copy.

| Check | How | Result |
| --- | --- | --- |
| Gate tests | `node core/gates/test.mjs` (temporary folders only) | 215 of 215 PASS; before this round 108 of 108. Two tests are new: standing wishes reach the start (PC and cloud), and no wishes note means no block |
| Defect found and fixed | The start step lost two backslashes in its standing-wishes reader (`systempreferences.md`), so wishes never arrived | Fixed; the new tests fail on the old line and pass on the new one |
| The registry programs | `node --test core/engine/registry.test.mjs project.test.mjs value.test.mjs guards.test.mjs` | 9, 5, 12 and 10 tests, all pass |
| Snapshot tests | `node --test system/snapshot.test.mjs` | 21 of 21 |
| Starting set | Made with the registry program's own `add` commands, then `render` and `check` | The five registry lines print OK once the helpers are installed; the privacy check is CLEAN. One id was renamed because the privacy check took `ask-before-...` for a key |
| First setup, as far as it goes without a chat | A throwaway copy, a fake home and a fake Claude folder: installer dry run and real run (11 helpers), registry check, then the keep-or-drop steps by hand with the registry program (two items dropped, habits confirmed), a project made from one sentence, the start step, the health check, a first save through the save hook | The start hands over the confirmed habits and the dropped ones are gone; the save went through; the health check left only the 3 lines that are true of a fresh copy (not on GitHub, first conversation not done, no page) |
| Nothing personal | Text search for the maker's name, account, address, project names and email | Only the copyright line in `LICENSE.md` |

Not checked: the keep-or-drop question asked by the helper in a real chat (the steps were played by hand); a real install into a real Claude folder; `hive-add` and `hive-project` in a real chat; whether each named plugin skill and connector can really be added by a new person on their plan (the notebook records their source, not their price or availability); the stack checklist and remote control, which are not in this copy yet.

## Round nine: the manuals (2026-11-19)

The three mixed files became one set of manuals in `docs/`: the first hour, every day, every part explained, when something breaks, the map, and the words. `README.md` is cut to what Hive Mind is, who it is for, what you need and where to start; `SETUP.md` points to the pages; this log moved here from `CHECKS.md`. The part of `SETUP.md` written for Claude (the exact install and undo steps) was taken out; it moves to the setup helper's own notes (`core/skills/hive-setup/install.md`), written by another helper of the same round, and the two are joined together.

A small program checks the manuals against the copy: `node docs/tools/check-manuals.mjs` (links and headings, every page speaking to "you", every phrase of "Things to say" answered by a helper, every folder and installed file named in `parts.md`, every arrow that leaves the computer listed in `system/what-leaves.md`, every inside word explained in `words.md`, and a reading-ease score). Its tests: `node --test docs/tools/check-manuals.test.mjs`, 11 of 11, each check with a known-bad case that must fail.

The first hour was walked on a throwaway copy with a made-up home folder whose path holds a space, with a local stand-in for GitHub (no real account). Seen, and written into the pages: the `git clone` of the copy; `STOPPED: node was not found` with Node taken off the path; the installer on a test Claude folder; `PRIVACY GUARD: CLEAN` on the first save and `STOP` on a planted fake token; both line-ending warnings; `'origin' does not appear to be a git repository` on a copy made by hand, fixed by linking it; `rejected (fetch first)` after a save from a second copy, fixed by bringing the notes up to date; the HIVE MIND box; and `[!!] The notebook was not found` for a folder moved into Documents.

The twenty places a newcomer got stuck in the first hour (`system/design/newcomer-readiness.md` in the main notebook, section 1), and where each one went:

| # | Stuck at | Now |
|---|---|---|
| S1 | No address to start from | Written into step 1 of the first hour when this copy is published, with the maker's yes; the program that builds the published copy refuses to build while it is missing (later round, 2026-11-20) |
| S2 | "A Claude plan" hid that the free plan has no Claude Code | Said plainly, from Anthropic's setup page |
| S3 | Habits described a page that is not in the copy | Moved under "Coming" in the README |
| S4 | Inside words before their meaning | Explained where they first appear, and all in `words.md` (checked by the program) |
| S5 | No step for the GitHub account, no word on which button | "Before you start" point 3 and step 1, with Fork and ZIP warned against |
| S6 | Making the copy needed the GitHub connector or `gh` | Not needed: you click "Use this template", Claude copies it with Git |
| S7 | Git missing, no way to get it | Step 3: Claude checks and installs it with your yes |
| S8 | The ZIP download not warned against | Step 1, and "Saving online failed" |
| S9 | Any folder other than `hive-mind` in the home folder broke the start | Step 3 says where it must be, and "The notebook was not found" says what to do. The start step reading a recorded place is the start and installer helpers' part of this round |
| S10 | No name for the folder control | Step 2, with the control names from Anthropic's desktop page |
| S11 | The kind of person never asked | Step 4 names the five starting sets; the question itself is the setup helper's part of this round |
| S12 | No way to install what was kept | "Every day" says how to add one in a sentence; installing a whole set in one step is the registry helper's part of this round |
| S13 | Built-in skills listed as not installed | The registry helper's part of this round |
| S14 | Node missing stopped the parts | Step 3 installs Node before setup; "node was not found" covers the rest |
| S15 | The installer's list of long paths | Step 5: Claude tells you in plain words, you need not read the list |
| S16 | The line-ending warning | "A warning about line endings": harmless, with the real message |
| S17 | Saving online failed without a linked copy | The template and clone route links it; "Saving online failed" for the rest |
| S18 | Chats on the web or phone get no start | Said in "Every day" and in "Claude seems not to know you"; the cloud start is the cloud helper's part of this round |
| S19 | What the brief costs not said | Said: each run uses part of your plan, not measured yet |
| S20 | The promised page does not exist | Said plainly under "Coming" |

Not checked in this round: anything on a real Mac or Linux computer; a real GitHub account, the "Use this template" button and the Git sign-in window (the button and field names are GitHub's, as its help pages give them, not re-read today); `winget install` (not run, because it would install; the package names were looked up with `winget show`); a real chat; a real new person following the pages.
