# The private check

One of your Hive Mind's rules is that no secrets go into notes, and that work for an employer never goes public. The privacy check (`core/guard/privacy-guard.mjs`) holds that when your notes are saved. This check holds it one step earlier: just before a web search, a web fetch, a connector call, a publish or a shell command sends something out of your computer.

It is a safety check: if it breaks on a step, it stops that step and says so, instead of letting it through.

## What it stops

Before the step runs, it reads what would leave and refuses the step when it finds any of these:

- **A protected name** from your list: the file named in `HIVE_NAMES_FILE`, else `~/.claude/hive/protected-names.txt`. A name is matched in any case, with a space, a dash, a dot, a plus or nothing between its words, and also inside a web address after it is decoded.
- **A key shape**: GitHub tokens, `sk-` keys, AWS key ids, private key blocks, Slack and Google keys, payment keys, signed web tokens, a bearer token, a password inside an address, a key in an address (`?api_key=...`), and a "password = ..." whose value looks made up. In search words, also a long made-up string of mixed letters and digits, which is how a key with no known start looks.
- **Text from the private part of your notebook**: the folders `me/` and `private/`, and every project whose state note says `kind: employer` or whose profile says `Employer or shared project: yes`. Six or more words in a row copied from those notes are caught. The check keeps only number fingerprints of those notes, never their words or file names, in `~/.claude/hive/private-index.json`; a note is read again only when it changes, and a note you just wrote is caught at the next step.
- **A private or protected file named by a command that sends something out**: a file or folder in the private part; a folder that holds it, sent with `scp`, `rsync` and the like; `.env` files, `.ssh` keys, `.pem` files, your list of names, the Hive folder, and Claude's sign-in file. Any other file such a command sends is read and checked for the three things above.

| Step | What leaves, and is read |
|---|---|
| A web search | the search words |
| A web fetch | the address |
| A connector call (a tool whose name starts with `mcp__`, except the app's own local tools) | every word it is sent, and any file it is given by its full path |
| A publish (the Artifact tool) | every file of the page, its title and its description |
| A shell command | only a command that sends something out (`curl`, `wget`, `Invoke-WebRequest`, `scp`, `rsync`, `gh gist`, an address, and the others in `settings.json`), also inside quotes (`powershell -Command "..."`): its words and every file it names |
| A helper sent to the cloud (the Agent tool with `isolation: "remote"`) | its instructions and short description |

When it refuses, it says what kind of thing it found and where ("protected name number 3 on the list, in the search words"). It never shows a name, a key or a private sentence, and never writes one to a log.

### Text you mark private is never stored

You can wrap words in `<private>` and `</private>`. Your Hive Mind's own programs never store them. Before the step runs, the check refuses a write into a note those programs keep (the questions list, the lessons, the list of what you send, the answers from your page, the snapshot, the in-flight note, the know-how index, the learning note) when the new text carries the mark, and a run of a program that writes those notes (such as `node core/engine/questions.mjs ingest <report>`) when its words or a file it is given carry the mark. The refusal names the note, never the marked words. Your own notes may hold the mark. The mark and both lists are in `settings.json` under `privateMark`; the check keeps its own floor, so the file can add to them but never take them away. Not seen: a report the gates read into the questions list themselves, a program not on the list, or the mark written another way.

## What it only notes

Nothing: every finding stops the step. If you have no list of names yet, names are not checked (keys and private text still are), and the result says so.

## What it cannot see, and why

- A program that sends by itself (`node send.mjs` with no address in the command): the check reads the command, not what the program does inside.
- A key split into parts, encoded, or kept in a variable (`$TOKEN`). A variable is let through on purpose: it is the safe way to pass a key.
- Fewer than six words copied from a private note, or the same thing said in other words; employer details that are in no note and on no list.
- A bare key with no known start inside a web address or a connector call: those carry long made-up names of their own all the time, so that shape is only used for search words.
- What Claude itself sends to Anthropic while a chat is open, and `git push` (the privacy check holds that at the save).
- A helper sent to the cloud takes more than its instructions with it; only the instructions are read.
- An employer project's code kept outside the notebook is not fingerprinted; only its notes in the notebook are.
- The fingerprints are short numbers, not a lock: someone with that file could test guessed sentences against it. It stays in the Hive folder, which this check refuses to send.
- Connector reads are checked too: a search of your own mail for a protected name is refused, because the check cannot tell your own account from someone else's service. To allow it for your own mail or drive, list that connector's one search tool in `ownAccounts.allowSearchTools` (empty out of the box; your own words are needed). Only the name part is skipped there: keys and private notes' words are still refused, every other tool is read as before, and a wider pattern is dropped.

## How to switch it

Its `settings.json` holds word lists and numbers only; it cannot switch the check off: the program keeps a floor (web search, web fetch, both shells, publishing, `me/` and `private/`) that the settings can add to but never take from. A broken pattern in the settings stops every step that sends something out; reading and editing stay open, so you can mend it. Making it softer, or off, needs your own words in your own message. To add a protected name, add a line of three letters or more to `~/.claude/hive/protected-names.txt`. To add a private folder, add it to `privateDirs` in `settings.json`.

## Three examples

1. A key with no known start, pasted into a web search to ask what it belongs to, is refused.
2. `curl -d @config.txt https://...` where that file holds a key is refused, whatever the file's ending.
3. A search that asks how to set an api key from Python's environment table passes: only a value that looks made up counts as a key.

## Tests

`node --test core/checks/private/check.test.mjs`. Every name, key and note in the tests is made up.
