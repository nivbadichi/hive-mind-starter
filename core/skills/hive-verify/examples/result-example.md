<!-- A worked example, written by verify.mjs on 2026-11-19 from a made-up repository (a one-file
"Tally" page served by a few lines of Node, one commit that fixes its button), walked with
playwright-cli. The linked screenshots and logs stayed in that run's evidence folder outside the
notebook, as a real run's do; only this page is kept here, to show the shape. -->

# Check: Fix: the tally does not count (made-up example)

**Verdict: PASS**

- Date: 2026-11-19. Kind: fix. Checker: hive-verify, clean context, Opus.
- Before: `HEAD~1` (ce85645). After: `HEAD` (da29b2a).
- Changed files (1): `index.html`
- Proof part: [proof.md](proof.md). Clean-up: clean (2026-11-20T01:02:31.920Z).

| # | Step | Before | After |
|---|---|---|---|
| 1 | Open the page | matches the proof part. Saw: Cups of tea: 0<br>[before-01-open.png](before-01-open.png) | matches the proof part. Saw: Cups of tea: 0<br>[after-01-open.png](after-01-open.png) |
| 2 | Press "Add one" twice | matches the proof part. Saw: Still 0: the fault, as the proof part says<br>[before-02-after-two-presses.png](before-02-after-two-presses.png), [before-console.txt](before-console.txt) | matches the proof part. Saw: Cups of tea: 2<br>[after-02-after-two-presses.png](after-02-after-two-presses.png), [after-console.txt](after-console.txt) |

## Why a pass

Every step was seen on both versions, each behaved as the proof part says, and each has its own kept evidence.

## Notes (seen, not judged)

- No console errors on either version.
