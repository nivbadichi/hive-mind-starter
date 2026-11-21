# Never twice (rule 7)

Rule 7 says you never have to say a thing twice: what you decide is not asked again, what you state is saved at once, a lesson counts as closed only when something real changed, and nothing you send lives only in a chat. This check holds that with refusals and debts, not reminders.

## What it stops

- **A question card you have already answered.** The list of questions (kept by the questions program, `core/engine/questions.mjs`, in `system/questions.json`) holds every answer in your own words. A card whose question shares at least three telling words (five letters or more) with an answered question, and at least half of its telling words, is refused before you see it, with the answer quoted. If the answer truly does not cover the case, Claude says so in the card ("your answer was ..., but ...") and it goes through.
- **A question card that a saved decision already answers.** When Claude is about to show you a question card (the app's question tool) about publishing, installing, the order of work, which model helpers use, or the site's headline, and a saved decision already speaks to it, the card is refused before you see it. The refusal quotes the decision. If the decision truly does not cover the case, Claude says so inside the question ("this is not covered by your decision of ...") and the card goes through.
- **Ending a piece of work while something you sent is missing from the front-door list.** The close step (the hive-close skill, or a closing save) is refused while any link or file you sent in this chat is not in the list of what you send (`inbox/sources.md`). Reading is never stopped.

## What becomes a debt (a fault in a reply, carried to the next reply)

- The reply asks you something a saved decision already answers. The debt quotes the decision. It reads every decision in force and the whole history, not only today's.
- You stated a rule, a wish, a decision or a correction ("from now on", "always ask ...", "I told you", "this is a rule") and nothing was written to the notes in the same turn. It stays owed, reply after reply, until a note is written (rules, decisions, lessons, preferences, the registry, the in-flight note, or the notes about you), or until the reply has a line that starts "Not a rule:" and says why.
- The reply asks you again something you have already answered (the same reading as for the card). The debt quotes the answer.
- The notes were saved in this turn and the reply has no "Saved: ..." line.
- Something you sent in your last message is not in the front-door list.

## What it only says

- At the first message of every chat: the lessons older than a day that nothing real closes (their "closed_by" says open or owed, names a file that does not exist, or is missing). It uses the lessons program (`core/engine/lessons.mjs`), so both always agree.

## What it cannot see, and why

- **A question about a topic not on its list.** It knows five topics (in `settings.json`). A question about anything else that a decision answers is not caught: matching any question to any decision by meaning needs judgment, and a wrong match would refuse good questions. Add a topic when a new case shows up.
- **A question asked in other words.** "Shall we make it public?" is caught only if a word of the topic is in it.
- **Whether the decision really answers the question.** It finds a decision on the same topic and quotes it; Claude may answer that it does not cover the case. That escape is honest only if Claude is.
- **An answer that was never written to the list.** If the app restarts before an answer is recorded (the case of 2026-11-20), the list does not hold it and the question is let through. Recording a card's answers the moment they arrive is the gates' job, not this check's.
- **The same question in other words.** "What should the legal pages call you?" shares too few telling words with "Which name goes on the legal pages as the person who runs the site?" and is not caught. The bar (three words, half of them) was set after a real miss the other way: with two words, "Should the legal pages go live with the site?" was matched to the question about the contact address.
- **A close typed as a command.** The app runs the before-a-tool step only when Claude calls the skill; typing /hive-close yourself skips it (the official hooks page says so). Then only the debt at the reply holds the front door.
- **Whether a saved note says the right thing.** It sees that a note was written in the turn, not what was written.
- **A wish said without its usual words.** "Bars with percentages, please, like we said" carries none of the wish words, so it is not seen.
- **Things you send that are not a link or an attached file.** A pasted list of names, or a picture pasted with no file path, is not seen.
- **Helper chats.** A chat started by another chat is skipped: its replies go to the chat that started it, not to you.
- **Whether a lesson's closing check really works.** It sees that the named file exists, not that it holds the lesson.

## How you switch it

Its mode is "refuse" (it stops and records debts). Say "never-twice to notice" (reminders only) or "off", and Claude changes the mode and tells you in one line. The word lists and numbers are in `settings.json`. It is a discipline check: if it breaks, it lets the step through and writes the error to the log.

## Examples of what it catches

1. You said "finish everything, then I add my things, then we publish". A day later Claude asks "Should I go live now?". That question becomes a debt (in a reply) or is refused (as a question card), with your decision quoted.
2. You say "from now on, always show progress as bars with a percentage". Nothing is written to the notes. The reply becomes a debt, and it stays owed until the wish is saved.
3. You answered a question card; later Claude shows you the same question again. The card is refused, with your answer quoted.
4. You send a link to keep, and the work ends without it in the list of what you send. The close step is refused until the link has its line.

## Tests

`node --test core/checks/never-twice/check.test.mjs`: a known-bad and a known-good case for each behaviour; one test that its own error lets the step through and is logged; one that each step takes under 50 milliseconds (the middle of nine runs, so one pause of the computer does not decide it).
