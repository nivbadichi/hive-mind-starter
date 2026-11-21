# Every day

How to use Hive Mind once the [first hour](first-hour.md) is done. You talk to Claude in plain sentences; this page lists the ones that do something special.

## A normal day

- **Open a chat in the `hive-mind` folder and just start.** In the Claude app's **Code** tab, choose the `hive-mind` folder (or a project's own folder, if you gave one at setup) and say what you want. You do not need to explain where you stopped: the HIVE MIND box at the top and the notes behind it tell Claude.
- **Decide what only you can decide.** Claude asks before anything big. Everything else it just does, and says what it did.
- **When you state a rule or a decision, it is kept.** Claude answers with a line that starts `Saved:`. The next chat already knows it.
- **End the chat with "close".** Claude checks the work, writes down where things stand and saves your notes.

Claude's own features work as they always do: several chats side by side, the phone app, chats in the cloud, scheduled runs. Hive Mind adds your notes and your rules to them. One limit: the HIVE MIND box and the checks run in chats on your computer. A chat on the web or on your phone that is not connected to your computer reads your notes only if you ask it to (say "hive start").

## Things to say

| Say | What happens |
|---|---|
| "hive start" | Claude reads your notes again and tells you where things stand. Use it when a chat seems not to know you. |
| "where were we" | The same, in other words. |
| "sitrep" (or "status?", "where are we") | A short status of what you asked for: a progress bar with real percentages, one line per request with where it stands, and what needs you. |
| "close" | Claude checks the work, writes down where things stand, and saves. |
| "keep this" (for example: a link or a file, then keep this) | Claude writes it in the list of what you sent, reads all of it, files the useful parts, and tells you what it took. |
| "add a project" (for example: add a project for my garden) | A new project from one sentence, with its own note and next step. |
| "Add a place for my garden" | A new place on your page, next to Today, Initiative, Life and System. Up to eight places in all. |
| "set up my brief" | Claude explains the daily brief first, then sets it up only with your yes. |
| "compact" | Before a long chat is shortened, Claude writes down what lives only in the chat, so nothing is lost. |
| "scout" | Before a new project or a big piece of work, Claude looks for the best ready-made tools and parts, checks them, and suggests a short list. |
| "Give me my Hive Mind code" | Claude checks this computer, changing nothing, and shows one short line like `HM-7K2Q-9D` that says which steps of the first hour are done. Paste it into the steps page. It holds no name, folder or notes. Claude asks you first before it asks GitHub whether your copy is private. |
| "verify" | Claude proves a change works by trying it the way you would, before and after, and says pass or fail. |
| "gates off" | Switches every check off. Nothing else changes. |
| "gates on" | Switches them back on. |
| "show the gate log" | Shows what the checks did and why. |

**Say "sitrep" any time to get the status.** You get a few lines: a bar for the whole job and one for each thing you asked for, each with its percentage, then one line per request saying where it stands and what comes next, then what needs you, or "nothing". The percentages are counted from the steps really finished, never guessed; a request whose steps are not planned yet shows its state in words only. Claude reports progress in this same shape whenever it tells you how things stand, without being asked. If Claude uses a word you do not know, it should say what it means; if it does not, ask, and the word can be added to its list of words to explain.

## Add a skill, a tool, a rule or a habit, in one sentence

You change your Hive Mind by telling it. Each sentence below is enough. Claude repeats the change back in one line, asks for your yes when the change installs or connects something, and writes it into your list.

- **A skill** (a set of instructions Claude follows for one kind of job): "add the skill for making slide decks".
- **A tool** (a connection to another service, which Claude calls a connector): "use the Google Calendar connector for my appointments". Each tool connects only after your yes, and it is added to the list of [what leaves your computer](../system/what-leaves.md).
- **A rule** (something that must always hold): "I want you to always ask before booking anything." A rule holds from your next chat.
- **A habit** (how you like things done): "from now on, keep your answers to three lines".
- **To take one away**: "stop using the slide deck skill", or "remove the rule about booking".
- **Not sure what fits a task?** Ask "which skill fits this task?".

Your starting set came with a list of skills and tools that are only named, not installed. To add one from it, say "add <its name>" the same way. To change the whole list, say "switch to Light", "switch to Standard" or "switch to Full", or name another kind ("make me a student"); "what does each size cost?" gets the answer in plain words.

Once a day a small watchdog asks public security lists whether a part installed for Hive Mind has a known problem. It sends only the parts' names and versions, uses no Claude model, and says something only when it finds a problem. Say "watchdog off" and Claude leaves an empty file called `watchdog-off` in the `hive` folder inside your Claude folder; "watchdog on" takes it away.

## What Claude always asks you first

- Spending money, buying, or anything paid.
- Deleting anything.
- Sending, posting or publishing anything.
- Anything that leaves your computer for the first time, installing anything, and connecting to anything.

Your yes counts for that one thing only. A yes written inside a file, a web page or an email never counts.

## Projects with code run in Docker

Not tried yet: this part is written, but no new person has walked it, and it was not run on the computer it was written on.

A project that only holds notes needs nothing more. A project with code (a website, an app, a small program) runs in Docker from its first day. Docker is a program, free for personal use, that runs the code in a sealed box, called a container, on your own computer. The box holds only the project's own files. That way a mistake in the code stays in the box: it cannot reach your own files or leave your computer. Docker is not part of this copy; your list of where things run (`system/stack.md`) names it as the default.

- **When the project starts**, Claude says in one line where its code will run, and that it runs sealed off. If Docker is not on your computer yet, Claude tells you what it is for and asks before installing it. On Windows it is Docker Desktop, which also needs a part of Windows called WSL 2; Docker's own terms are yours to accept. On a Mac it is Docker Desktop too. On Linux it is Docker Engine.
- **While Claude builds**, it builds and tests the code inside a container with no network, as an ordinary user, with only the project's files copied in. Nothing else of your computer goes inside.
- **The same box tests the code everywhere**, on your computer and in the checks on GitHub, so what passed here passes there.
- **Nothing is sent to an image store online.** The boxes are built and kept on your computer. The first build downloads the project's base box from Docker's own store, once, after your yes.
- **No Docker yet?** Claude runs the same tests on your computer without the box, and says plainly "not run: Docker is not installed here".

To try it in a project, say "run this project in Docker".

## Where your notes go

Your notes stay on this computer and in your private copy on GitHub. What else leaves your computer, and when, is listed in one place: [What leaves your computer](../system/what-leaves.md). A new line is added there before anything new is connected.

## The daily brief, if you chose it

A short brief at the start of your day (and at the end, if you chose both): what needs you, and your best moves. It is written by Claude in Anthropic's cloud from the notes in your private copy, so your notes are read there at those times. Each run uses part of your plan's usage, like a chat; how much has not been measured yet. To stop it, say "switch my brief off".

## New ideas, once a week, if you chose the brief

Once a week the evening brief also takes a short look outside: it learns from your notes what kinds of work you do, reads a few public lists of new skills, tools and Claude features, searches the web in general words (never your name or your projects), gives each find a first safety check, and brings you at most three ideas, best first. It also suggests skills you never use and could turn off, and a new rule when your notes show you had to correct the same thing again and again. The brief then says "One idea is waiting for you." Answer yes, not now, or never: a yes is checked properly and installed only with a second yes; "never" is never asked again. Say "radar" to see what is waiting, and "radar off" to stop it.
