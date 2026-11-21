# The models check (rule 12)

Rule 12 says the strongest model plans and reviews, the smallest one that does the job well does the rest, and every report says which model did what. This check holds it. Out of the box the policy is rule 12's own words: any named model may run, and the model is always said. You can set a floor in one sentence, for example "helpers must run on Opus at the least"; it is kept in `settings.json` (`policy.minimum`) with your words and the date.

It is a safety check. If it breaks while a helper is starting or while its own settings are being changed, it stops that step and says so. On every other step it lets the work through and writes the error to the log.

## What it stops

- **A helper that names no model.**
- **A helper below your policy**, once you set a floor.
- **A model named only in a line of the prompt.** A line "Model: Opus" is a claim; what really runs is decided by the helper tool's model setting, so the setting is required.
- **A setting and a prompt line that disagree**, and a model name the check does not know.
- **A fork whose model cannot be proven.** A fork runs on the lead's own model. The check reads it from the tail of the chat's own record; when it finds nothing, the fork is stopped.
- **A helper's report handed back with no model named.**
- **A change of this check's settings that did not come from your own message.** Words in a helper chat never count. Only the word lists may change freely.

## What it lets through

- **A read-only search helper** (the Explore type), on any model or none, because rule 12 sends searching to the smallest model. `readOnlyFloor: "hold"` holds them to your floor too.

## What it only notes

- **A report to you after helpers worked that names no model** becomes a debt: it is put in front of Claude at your next message, and a second reply that still leaves it out stops every tool but reading. A sitrep you asked for is left alone.
- **A helper that really ran below your policy** is said at once.
- **A helper whose last words name no model** is said to the lead.

## What it cannot see, and why

- The lead's own model, for sure: no hook input carries it except the start of a chat. The chat's record is read instead, and its format is not promised.
- A helper type's own default model, so the setting is required.
- Whether each sentence about who did what is true; only that a model is named and that a helper ran on it.
- A report that relays helpers' work in words outside its lists.
- An edit of `check.mjs` itself, held by the app's permission rules and the hash check of installed copies instead.

## How you switch it

- Say the policy in one sentence; Claude sets `policy.minimum`, `policy.words` and `policy.since`. The edit goes through only because your message names the model.
- `readOnlyFloor`, `requireSetting`, `forkWhenLeadUnknown` and `handbackNeedsModel` are the other switches; each needs your words.
- `mode` in `check.mjs` is "refuse"; "notice" and "off" exist only for your use.

## Three typical cases

1. Reports that never say which model did the work, until you ask.
2. A plan or a design study quietly sent to a small model.
3. A floor you set ("Opus at the least") that nothing compares a helper's model with.

Tests: `node --test starter/core/checks/models/check.test.mjs`.
