# Plain words (rule 6)

This check reads every reply Claude sends you and asks five questions. Is it short? Is it written in whole sentences? Is it easy to read? Does it leave out file names and code you did not ask for? Does it explain every word you may not know?

## What it stops, and what it only notes

A reply is already on your screen when the check reads it, so it cannot hold a reply back. Instead, each fault becomes a debt: a note put in front of Claude at your next message, saying what was wrong. If the next reply still carries the fault, Claude is refused every step except reading until a reply comes out plain. A plain reply clears the debt.

The five measures, with the numbers in this folder's settings file:

1. **Length.** At most 150 words. When your own message asks for a long answer ("recap", "in detail", "full report", "step by step" and the other words in the list), there is no limit. The progress bars, the "Saved:" and "Used:" lines and web addresses are not counted.
2. **Whole sentences.** More than one line that is a label and a fragment ("**Status:** merged", "Next: wiring"), a heading, a bold line alone, a short list line with no full stop, or a table, is a fault. A colon inside a real sentence is fine. A short status reply in the sitrep shape is left to its own check.
3. **Reading ease.** A reply of 30 words or more must score 50 or more on the Flesch reading-ease scale, which counts how long the sentences and the words are. It is the same count the manuals use; the bar is lower than their 60 because a reply names your projects and tools.
4. **File names and code.** None, unless your message asks for a file, a path, a command, a log or code.
5. **Inside words.** A word from the list (helper, worktree, deploy, starter, debt: 70 words in all), a skill's name with a hyphen (such as hive-scout), or a work code (such as E5), with no meaning given right after it. It passes when you used the word yourself, when the reply says what it means in the next few characters, or when the plain words for it appear anywhere in the reply.

## What it cannot see

- It cannot tell whether a reply makes sense to you. A short, easy, well-formed reply can still miss the point. Only you can judge that.
- The reading-ease score counts syllables and sentence length. It does not know meaning.
- It knows only the inside words on its list and the shapes of skill names and codes. A new piece of jargon passes until someone adds it.
- A long reply you asked for in words that are not on the list ("tell me all about it") is counted as too long; add the phrase to the list.
- A chat started by another Claude is skipped, because its reader is a Claude.
- It does not hold the sitrep's own shape, the progress bars, or the "Used:" line: other checks do. A reply with a "Needs you:" line is read as a sitrep and its lines are not judged as labels, so a status report can pass by carrying that line; its length, reading ease, file names and inside words are still checked.
- A listed word used in its everyday sense ("push on", "a brief look") is counted the same as the inside word, and a comma right after a word reads as an explanation. Both are counts of letters, not of meaning.

## How to switch it

Its mode is "refuse" (faults become debts). "notice" notes faults without the debt; "off" stops it. Say which, and Claude changes the one word. The numbers and word lists are in this folder's settings file: change a number, or add a pair "the word": "the plain words to say instead".

If the check itself breaks, it lets the reply through and writes the error in the log. It is a discipline check, so a bug in it never stops your work.

## Three examples of what it catches

- A reply uses the name of a folder ("the starter") as if you knew it. Now that word with no meaning is a debt, and the note says what to call it instead.
- A reply is under the word limit and has the progress bar, and still reads like a status report: bold labels, clipped fragments, inside words, a line listing tools. Now labels and fragments are a fault of their own.
- Asked where things stand, the answer runs long. A reply over 150 words to a short question is a debt; a recap you ask for is not.

## The test

`node --test core/checks/plain-words/check.test.mjs` runs a known-bad and a known-good case for each measure, the case of a recap you asked for, the check's behaviour on its own error, and a speed test (under 50 ms for one reply).
