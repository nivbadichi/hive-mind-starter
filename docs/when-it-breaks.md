# When something breaks

Find what you see, then do what it says. Nothing here loses your notes. In almost every case the fix is one sentence to Claude, said in a chat in your `hive-mind` folder. If you cannot find what you see, tell Claude exactly what you see; it will say plainly what it knows and what it does not.

A good first step for anything: say **"run the health check"**. Claude checks every part, and tells you in plain words what needs you.

---

## No HIVE MIND box at the start of a chat

**What you see:** a new chat starts without the small box headed HIVE MIND, and Claude may say "No start message appeared, so I read your notes first".

**Why:** the small parts are not on this computer yet, or the chat was opened outside your notes, or the chat runs somewhere the start step cannot run (on the web or your phone without your computer).

**What to do:**
1. Check that the chat is in the Code tab, in the `hive-mind` folder or a project's folder, on this computer.
2. Say "add the small parts". Claude offers to put them in place (step 5 of [the first hour](first-hour.md)).
3. Until then nothing is lost: Claude reads your notes itself.

## "The notebook was not found"

**What you see:** the HIVE MIND box says `[!!] The notebook was not found at` and a folder. Or, when you send a message, a line says `HIVE MIND: the checks are off` because they cannot find your notebook.

**Why:** your `hive-mind` folder is not where the small parts look for it: it was moved, renamed, or copied somewhere other than your home folder. Until this is fixed, the checks that hold Claude to your rules do not run.

**What to do:** say "my Hive Mind folder was moved; find it and set it right". Claude finds the folder and either moves it back to your home folder or records where it now is, for the start step and the checks alike. Then open a new chat.

## Setup stopped halfway

**What you see:** while Claude was adding the small parts, the app closed, the computer went to sleep or lost power, or Claude says the setup `STOPPED partway`. Afterwards the health check may list many things that are not connected.

**Why:** the parts are added one by one. Some were added and some were not.

**What to do:** say "add the small parts again". Nothing is lost: before each change, setup writes down what it is about to do, so a second run finishes the rest and leaves alone what is already there. If you would rather start clean, say "undo the Hive Mind setup" instead: it puts back everything the stopped run changed. Then say "run the health check" to see that all is well.

## Claude seems not to know you

**What you see:** Claude asks who you are, or does not know your projects.

**What to do:** say "hive start". Claude reads your notes again and tells you where things stand. If that happens in every new chat, see [No HIVE MIND box](#no-hive-mind-box-at-the-start-of-a-chat).

A chat on the web or on your phone that is not connected to your computer does not get the start by itself. Say "hive start" there too.

## A step was stopped by a check

**What you see:** Claude mentions `HIVE GATE`, `HIVE NOTICE`, or a note that starts "About your last reply".

**Why:** one of the checks that hold Claude to your rules did its job. For example, Claude tried to work on the look of a project before reading your design picks, or a reply ran long.

**What to do:** usually nothing; Claude reads what the check asks and does it. To know why, say "why was that stopped?" or "show the gate log". To switch every check off for a while, say "gates off", and "gates on" to switch them back. A check that breaks lets the work through and writes it in its log; it never stops you by crashing.

## A save was refused

**What you see:** `PRIVACY GUARD: STOP` or "save refused".

**Why:** the privacy check found something that must never be saved: a password, a key, or one of the private names you gave.

**What to do:** say "remove what the privacy check found and save again". Claude removes it from the notes (it never shows you the secret itself in the chat) and saves.

**If you see `PRIVACY GUARD: CHECK`:** it found something personal, such as an email address, in a part that could be shared. Claude shows you what it is and asks whether it may stay.

**If you see "the privacy check could not run":** neither Node nor Windows PowerShell could start it, so nothing is saved, to be safe. See ["node was not found"](#node-was-not-found).

## "node was not found"

**What you see:** `STOPPED: node was not found`, or Claude says Node is missing.

**Why:** Node, the free program that runs the checks and the privacy check, is not on this computer, or the Claude app was opened before it was installed.

**What to do:** say "install Node". Claude explains and installs it after your yes. Then quit the Claude app completely (use **Quit** or **Exit** in its menu), open it again, and say "add the small parts".

## The checks stopped working after Node was installed again

**What you see:** no notes from the checks any more, or a message that a hook could not run, after you reinstalled or updated Node.

**Why:** setup wrote down where Node was on the day it was installed. If Node now lives in another place, the checks cannot find it.

**What to do:** say "add the small parts again". It is safe to run more than once: parts that already match are left alone.

## Saving online failed

**What you see:** one of these, or Claude says it could not save to your private copy:
- `'origin' does not appear to be a git repository`: this folder is not linked to your private copy. This happens when the folder was made from a ZIP download, or by hand. Say "link my notes to my private copy on GitHub". Claude asks for its address and links it.
- `Authentication failed`, or a sign-in window: GitHub wants you to sign in again. Sign in in the window that opens; signing in is yours to do. On a Mac or Linux, Claude asks you to type `gh auth login` in the Terminal (not tried on a Mac yet).
- `rejected` with `fetch first`: your private copy has a newer save, often from the daily brief. Say "bring my notes up to date and save again".

Your notes are still safe on this computer in every one of these cases.

## The steps page says a step is not done

**What you see:** you pasted your Hive Mind code into the steps page on the Hive Mind site, and a step shows **Not yet** or **Not checked**. Or the page says "That code doesn't add up".

**Why:** the code says only what Claude's check saw on this computer at the moment it ran. A step may not be finished, a code may be from before you finished it, or one letter may have been typed wrong. **Not checked** means the check could not see that step, for example because you said no when Claude asked whether it may ask GitHub about your copy.

**What to do:**
1. Look at the first step that is not done. The page names what is missing and gives one message to paste into Claude. The same step in [the first hour](first-hour.md) says what you should see.
2. If you are not sure what is wrong, say: "Something is not working with my Hive Mind. Please run the doctor and fix what you can." The doctor is the part of Hive Mind that finds what is broken. It fixes what needs no yes, and asks you once for the rest.
3. Then say "Give me my Hive Mind code" again and paste the new code. The page always shows the newest one.

**If the page says "That code doesn't add up":** check for a typing mistake, or ask Claude for a new code. **If it says the code is from a newer Hive Mind:** reload the page.

## A warning about line endings

**What you see:** a line such as `warning: in the working copy of 'log/x.md', CRLF will be replaced by LF the next time Git touches it` (or `LF will be replaced by CRLF`) when Claude saves.

**Why:** Windows and other systems end lines of text differently. Git prints this when a file was written the Windows way.

**What to do:** nothing. It is harmless and the save went through. If it bothers you, say "fix the line endings in my notes".

## "Notebook not refreshed, using the last copy"

**What you see:** the HIVE MIND box says `[..] Notebook not refreshed`.

**Why:** the start step could not reach your private copy in time (no internet, or GitHub was slow), so the chat uses the copy already on this computer.

**What to do:** nothing, unless you made changes on another computer or the daily brief ran. Then say "hive start" once you are online again.

## "Unsaved change(s) from an earlier chat"

**What you see:** the HIVE MIND box says `[!!]` and a number of unsaved changes.

**Why:** an earlier chat changed your notes and ended before it saved them.

**What to do:** say "look at the unsaved changes and save what is right". Claude shows you what changed before it saves.

## Undo everything

To take Hive Mind out of Claude on this computer, say **"undo the Hive Mind setup"**. Claude asks before each step and:

1. puts back Claude's own settings and instruction file from the **oldest** dated copy of each (the one made before Hive Mind was added; a newer copy may still hold the checks);
2. removes the start step, the checks, the privacy check, the save hook and the helpers;
3. keeps your list of private names and any other file you made yourself; Claude asks you about the list, and deletes it only if you clearly say so;
4. cancels any scheduled brief runs, with your yes;
5. leaves your `hive-mind` folder and your private copy on GitHub alone. They are yours; delete them yourself only if you want to.

To remove only the checks and keep the rest, say **"remove the gates"**.

## Still stuck

Say "run the health check" and read Claude's answer together with this page. If a step of [the first hour](first-hour.md) did not match what you saw, tell Claude which step and what you saw instead: that is exactly what this copy needs to get better.
