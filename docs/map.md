# The map

Every part of Hive Mind on one page, and how they connect. Each part is explained in [Every part explained](parts.md). The arrows marked **leaves your computer** are the only ways anything goes out; all of them are listed in [What leaves your computer](../system/what-leaves.md).

```
                         ON YOUR COMPUTER
  +---------------------------------------------------------------+
  |                                                               |
  |   You  --- talk --->  A chat in the Claude app (Code tab)     |
  |                          |        ^                           |
  |                          |        | the start step hands it   |
  |                          |        | your rules, your projects |
  |                          |        | and where things stand    |
  |                          |        |                           |
  |        the checks (gates) watch   |                           |
  |        every step and reply       |                           |
  |                          |        |                           |
  |                          v        |                           |
  |   The helpers  <--- Claude follows one for each job           |
  |                          |                                    |
  |                          v  reads and writes                  |
  |   Your notes: the hive-mind folder                            |
  |   (me, projects, system, inbox, knowledge, log, brief, ...)   |
  |                          |                                    |
  |                          v  every save                        |
  |   The privacy check (through the save hook)                   |
  |                          |                                    |
  +--------------------------|------------------------------------+
                             |
                             v  leaves your computer: your notes
               GitHub: your own private copy
                             |
                             v  leaves your computer: only if you set up the brief
               Anthropic's cloud: the daily brief run
               (it reads your private copy, writes the brief back to it)

  The chat itself  -->  leaves your computer: what you and Claude say, to Anthropic
  A lookup         -->  leaves your computer: only the page Claude opens, to that site
```

## The parts in this picture

- **You** talk to Claude in chats, in the Claude app.
- **A chat** is Claude's own; Hive Mind adds to it. See [Claude's own parts](parts.md#claudes-own-parts-which-hive-mind-uses-and-does-not-replace).
- **The start step** runs when a chat opens on this computer and hands it your notes. See [the small parts](parts.md#the-small-parts-setup-adds-to-claude-on-this-computer).
- **The checks (gates)** hold Claude to your rules. Same section.
- **The helpers** are Claude's instructions for one job each. Same section.
- **Your notes** are the `hive-mind` folder. See [Your notes](parts.md#your-notes-the-hive-mind-folder).
- **The privacy check** runs before every save, through **the save hook**. See [the small parts](parts.md#the-small-parts-setup-adds-to-claude-on-this-computer).
- **GitHub** keeps your private copy. Only you can read it.
- **Anthropic's cloud** runs the daily brief, only if you said yes to it. When you do, a line is added to [What leaves your computer](../system/what-leaves.md) at the same time.

## Arrows that leave your computer

| What | Where it goes | When |
|---|---|---|
| Your notes | GitHub, your own private copy | Every save, after the privacy check |
| The daily brief run reads your notes | Anthropic's cloud | Only if you set up the brief; its line is added to What leaves your computer that day |
| What you and Claude say in a chat | Anthropic | While a chat is open |
| A page Claude opens to look something up | The site that is opened | Only when a chat looks something up |

## What does not leave your computer

Your list of private names, your sign-in details, Claude's settings on this computer, the logs of the checks, and the small parts themselves.
