# Daily brief switch

The daily brief run reads this note first. While the word after `engine:` is `off`, the run stops before doing anything. It stays off until you say yes to the brief and its runs are set up. You can switch it off again any time, also from your phone in the GitHub app.

engine: off

empty_runs: 0

max_seconds: 600

retire_on:

## What these lines mean

- `engine:` on or off. Off stops every run before it does anything.
- `empty_runs:` how many runs in a row had nothing to say. At three, the run switches itself off and tells you in that brief.
- `max_seconds:` the longest a run should take. A run that passes it saves what it has and says so.
- `retire_on:` a last day, written like 2026-12-31. From that day the run switches itself off. Empty means no last day.

## What the run costs

One or two runs a day on the smallest model, each well under a minute in the first week of use by the person who built Hive Mind. Each reads your notes and writes one short brief and one ledger line. The runs share your Claude plan's usage with your own chats.

The weekly look for new tools (the radar) is off on its own switch, even when the brief is on: when you switch it on, it adds up to 8 web searches and 12 page reads to one evening run a week (`system/radar/switch.md`). The daily watchdog is not one of these runs: it runs on your computer with no model and costs no usage unless it finds a problem.
