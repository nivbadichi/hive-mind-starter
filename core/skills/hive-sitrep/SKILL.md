---
name: hive-sitrep
description: Sitrep - the shape of every progress update to the person. Use when they say sitrep, status, where are we, how far, or what's left, and every time you are about to tell them how their request stands without being asked, including when a helper's work comes back.
---

# Sitrep

A sitrep tells the person how far **what they asked for** has come, and nothing about how it is made. Write it the way a good project lead writes to a client: calm, exact, adult, whole sentences.

## The shape

Open with the progress display, pasted as it prints inside a fixed-width block (three backticks above and below): `node core/engine/progress.mjs show`. Its numbers are counted from the steps done; keep the list current with the same program (`add`, `steps`, `done`, `state`) as the work moves, never by hand. When the list is empty, start it with `new` and `add` for each thing they asked for. Then:

```
<Headline: one plain sentence on how far the whole request is.>
- <What they asked for, in their own name for it>: <state>. <One short clause: what that means, or what comes next for it.>
- <... one bullet for each thing they asked for ...>
- Needs you: <what, and why>. | - Needs you: nothing.
<At most one sentence, only if something is important enough that they must know now.>
```

- **Bullet points**: one bullet per thing they asked for, and a bullet for "Needs you:"; it is easier to read. A sitrep without bullets is a fault; the bullets are never read as fragments.
- **State** is one of: done (or chosen, ready), being worked on, not started, stuck (and why, in a few words), not checked.
- One bullet per thing **they** asked for, named as they named it. Their requests, never the steps or the people doing them. Their names are their words: a name such as "Ready for the trip" is not a claim, and is never judged as one.
- **Needs you** always carries every open question for them, word for word (the questions list; the gates hand them over at their message). "Nothing" only when the list holds none. A phrase they are asked to type goes in quotes and is not judged.
- About 120 words at most, counted without the display, the bullets for each thing (about 30 words each) and their open questions under "Needs you:". After "Needs you:" at most one sentence, more only for a question or a fault.

Example:

> Two of your three requests are finished; the third is in its last check.
> - The weekly plan: done. It is in your notes for Monday.
> - The reading list: being worked on. The last two books are being checked.
> - The tidy-up of old notes: not started. It comes after the reading list.
> - Needs you: nothing.

## Words

- Name each thing by what it is for them. The first time a word they may not know is needed, say what it means in half a sentence.
- Leave out: helper names, the names of skills, tools and models, test counts, file names, how the work was done. Those belong in the notebook.

## Where the facts come from

Read them now, never from memory: their request in this chat, the project's state note (stage, the one next step, what needs them), `system/in-flight.md` (what is in work, what waits for them), and the helpers' reports. A thing you did not check is said as "not checked".

## When

- They say sitrep, or ask for the status, where things are, how far, what is left.
- Every time you report progress to them without being asked, including after a helper's work comes back. A sitrep is the progress map of rule 11; it needs no separate map line, no "Used:" line and no model line.

## What it is not

- A question that needs their yes, or a fault they must rule on: write the sitrep lines first, then the few sentences that question or fault needs, with its content inside it.
- The full recap at the natural end of the work: that is a separate, long document they asked for, written with `hive-close`.

A decision that is theirs (going back on what they said, changing what strangers read, spending, deleting, guessing what they meant) is never announced as made: it is asked.

The gates read a reply as a sitrep when it has a "Needs you:" line and at least one "<thing>: <state>" line, with or without a bullet; a sitrep whose lines are not bullets is noted. Their notes on it never send a reply back; they come at the person's next message.
