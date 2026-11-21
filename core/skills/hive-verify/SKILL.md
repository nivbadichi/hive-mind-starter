---
name: hive-verify
description: Prove a change works by walking the real thing before and after, as a person would, and report PASS, FAIL or NOTHING PROVEN. Use before joining a helper's change, when a brief's "How it will be proven" part needs checking, or when the person says verify, prove it, or check it as me.
---

# The checker

You are a different agent from the builder, with a clean context, and your job is **proof**: what you saw on the old version, what you saw on the new one, and the evidence for both. You read and report. A fault you find goes back to the builder in the result page; the code stays exactly as you found it.

The exact parts live in `scripts/verify.mjs` (copies, ports, stopping, cleaning up, evidence folder, verdict). Its commands are listed at the top of the file. Run it with Node from the notebook.

## What you are given, and what stays closed

Given: the **proof part** of the brief (its "How it will be proven" section), the **list of changed files**, and the **two versions** (two git refs). That is enough to check, and it keeps you honest: the builder's report and reasoning would tell you what to expect to see. If the lead hands you more, read only the proof part and say so in the notes.

A brief with no proof part cannot be checked: report NOTHING PROVEN at once, with that reason.

## Safe ground, every run

- Only this computer: both versions run on `localhost`, and the browser goes only there. The live site is out of bounds.
- Only made-up data: the made-up test sign-in (`--made-up-sign-in`) and the made-up notebook (`--made-up-snapshot`, a copy of the site's own example). The real keys, `.env` files and `app/src/data/snapshot.json` stay untouched; the program strips real key names from each copy's settings and refuses an `.env` file in a copy.
- Evidence stays on this computer: `<state>/verify/<date>_<slug>/` (the state folder is `~/.claude/hive`, or `HIVE_STATE`). Screenshots of your pages are private, so none of it goes into the notebook or to GitHub; the program refuses a folder inside the repository.

## Steps

1. **Prepare.** `node core/skills/hive-verify/scripts/verify.mjs prepare --repo <notebook> --before <ref> --after <ref> --slug <short-name> --brief <brief file>`. It makes two detached worktrees, writes `changed-files.txt` and cuts the proof part into `proof.md`. Done when both copies exist and `proof.md` holds the steps.
2. **Plan the walk.** From `proof.md` write the numbered steps a person would take: where to go, what to press or type, and what today's version shows versus what done looks like. Same steps on both versions, nothing added for one side. Done when every line of the proof part maps to at least one step.
3. **Start both.** `start --run <evidence> --side before --port 4701 --cmd "<start command>"`, then `--side after --port 4702`. Each gets its own port; a port in use is refused. The program waits until the page answers and keeps the server log. If a version will not start, that is the finding: keep the log.
4. **Walk the old version.** With `playwright-cli`, one named session per side, working from inside the evidence folder so files land there:
   `playwright-cli -s=before open http://localhost:4701/<path>`, then `snapshot`, `click <ref>`, `fill <ref> "<text>"`, `press Enter`, and after each step `screenshot --filename=before-<nn>-<what>.png`. Read the text you judge by with `--raw eval "<expression>"`. At the end keep `console` and `requests` output in `before-console.txt`, then `close`. For a fix, the fault must show here: that is what makes the after side mean something.
5. **Walk the new version** the same way, same steps, `-s=after`, files named `after-<nn>-<what>.png`.
6. **Clean up.** `cleanup --run <evidence>`: stops both servers, unlinks any linked folder, removes both worktrees and checks that neither is listed and both ports are free. `playwright-cli list` should show no browsers. Done when it prints `clean`.
7. **Record and decide.** Write `steps.json` in the evidence folder (shape below), then `result --run <evidence> --steps <evidence>/steps.json`. The program writes `result.md` and works out the verdict.
8. **Report** to the lead: the verdict line, the path of `result.md`, and for FAIL or NOTHING PROVEN the reasons it lists. The lead writes one line into the notebook; the evidence stays where it is.

`steps.json`: `{ "change", "kind": "fix|feature|program", "checker", "steps": [ { "do", "before": { "seen", "ok", "saw", "evidence": [files] }, "after": {...} } ], "notes": [] }`. `seen` is true only for a step you watched happen. `ok` on the before side means the old version showed what the proof part says today's code shows (the fault, or the feature missing); on the after side, what done looks like. `saw` is what was on the screen, in a few words. `evidence` names files in the evidence folder, different files for each side. A worked example of the page: `examples/result-example.md`.

## The three verdicts

- **PASS**: every step seen on both versions, each matching the proof part, each with its own kept evidence. One step you did not see is enough to lose it; the program refuses a PASS otherwise.
- **FAIL**: the new version, seen, did not do what done looks like. Say what it did instead.
- **NOTHING PROVEN**: anything else. The fault would not show on the old version, a version would not start, a step could not be walked, evidence is missing, the brief has no proof part. This verdict is honest and useful: it says the proof part or the setup needs work, and it goes back to the lead as such.

Things noticed outside the steps (a console error, a broken layout elsewhere) go under `notes`, plainly, without changing the verdict.

## A change with no page

A program, a gate, a hook or a script: run its tests on both versions instead of walking a page. `tests --run <evidence> --side before --cmd "node --test <file>" --name <name>`, then the same with `--side after`. Each run's output is kept as `<side>-<name>.log` with its exit code in `run.json`. For a fix with a new test, the test should go red on the old version and green on the new one; a test that is green on both proves nothing about the change. Where the proof part names an input (a sample hook payload, a made-up brief), feed the same input to both versions and keep both outputs. A test you only read is a step not seen.

## Your page (`app/`), once your notebook has one

- Start with `--cwd app --link app/node_modules=<notebook>/app/node_modules --made-up-snapshot --made-up-sign-in --cmd "npm run dev -- --port <port>"`. The link lends the installed packages to the copy without installing anything; cleanup unlinks it and leaves the packages alone.
- The public build: add `--env HIVE_PUBLIC=1`; it reads the example notebook on its own.
- A step that needs the person signed in: make the session cookie the way the page's own sign-in check does, with the made-up values the program kept in `run.json` for that side, and set it with `playwright-cli cookie-set`. A page with no sign-in check of its own: that step is NOTHING PROVEN, with that reason.
- Phone width first: `playwright-cli resize 390 844` before the first screenshot, unless the proof part says otherwise.
