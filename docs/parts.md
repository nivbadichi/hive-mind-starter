# Every part explained

The one page that names every part of your Hive Mind: what it is for, whether it leaves your computer, and how to remove it. There are two groups: the folders of your notes, and the small parts that setup adds to Claude on this computer. [The map](map.md) shows how they connect.

In short: nothing here leaves your computer except your notes, which are saved to your own private copy on GitHub, and what you say in a chat, which Claude (Anthropic) reads to answer you. The full list is in [What leaves your computer](../system/what-leaves.md).

## Your notes: the hive-mind folder

This folder is your Hive Mind. It lives in your home folder, and every save also goes to your private copy on GitHub, after the privacy check. You can open any file in it with a text editor; they are plain text.

| Part | What it is for | Leaves your computer? | To remove it |
|---|---|---|---|
| `me` | Your note about you (`me/profile.md`): what to call you, what fills your days, your habits and your taste. Every new chat is handed its first lines. Never published, and never read by the brief. | Only to your private copy | Ask Claude to change or remove any line |
| `projects` | One folder per project, each with a `state.md` note: where it stands, its next step, what needs you. | Only to your private copy | Say "remove the project <name>"; Claude asks first |
| `system` | How your Hive Mind runs: the rules (`rules.md`), what holds today (`decisions-in-force.md`) and its history (`decisions.md`), lessons (`lessons.md`), your habits (`preferences.md`), your places (`places-and-sets.md`), the list of your skills, tools, rules and habits (`registry.json`, shown readably in `generated`), [what leaves your computer](../system/what-leaves.md), the health check, and the daily brief's switch (`engine-switch.md`). | Only to your private copy | These are part of Hive Mind; change them by telling Claude |
| `inbox` | What you sent to keep (`sources.md`), and answers from your page (`answers.md`, used once the page exists). | Only to your private copy | Ask Claude |
| `knowledge` | What your Hive Mind learned from what you sent, one note per subject, listed in `INDEX.md`. | Only to your private copy | Ask Claude to remove a note |
| `log` | One short line per day of what happened. | Only to your private copy | Safe to delete old days |
| `brief` | Your daily briefs, if you chose them. | Only to your private copy | Switch the brief off ("switch my brief off"), then delete old ones |
| `ledger` | One line per daily run and one per week: what the runs did and what it was worth, so you can see Hive Mind really makes a difference. | Only to your private copy | Safe to leave |
| `core` | Hive Mind's own parts: the helpers (`core/skills`), the checks (`core/gates`), the start step (`core/start`), the privacy check (`core/guard`), the small programs (`core/engine`), the checks that run after an edit (`core/factory`, off unless you switch them on), the forms Claude fills in (`core/templates`), the daily watchdog that asks public security lists about the installed parts (`core/watchdog`, no model; it speaks only when it finds something), the measure of what every chat costs before any work (`core/work-cost`), and the short instruction for Claude (`core/claude-md.md`). Setup copies some of these into Claude (next section). | Only to your private copy | Undo the setup (below); the folder itself stays |
| `app` | Reserved for your page. Empty in this copy. | No | Leave it |
| `docs` | These manuals, and the record of how this copy was checked (`build-log.md`). | Only to your private copy | Safe to keep |
| `.claude-plugin` | Two small files that describe Hive Mind as a plugin, so Claude can add it the ordinary way ([Adding Hive Mind as a plugin](plugin.md)). They hold a name and a version, nothing of yours. | Only to your private copy | Safe to keep; they do nothing unless you add the plugin |
| `hooks` | The plugin's own start and checks. They run only when you added Hive Mind as a plugin, and stand down when the setup in "Your first hour" already put the same parts in. | Only to your private copy | Remove the plugin ([how](plugin.md)); the folder itself stays |
| `CLAUDE.md` | A few lines every chat in this folder reads first: follow the start message, or read the notes if none appeared. | Only to your private copy | Leave it; without it a chat here does not know it is in your Hive Mind |
| `README.md` | The front page of your copy. | Only to your private copy | Safe to keep |
| `SETUP.md` | A short pointer to the setup pages. | Only to your private copy | Safe to keep |
| `LICENSE.md` | The licence: what you may do with Hive Mind's own files. | Only to your private copy | Leave it |
| `.gitignore`, `.gitattributes` | Two small settings files for Git: which files are never saved, and how line endings are written. | Only to your private copy | Leave them |

## The small parts setup adds to Claude on this computer

Setup adds these only after your yes (step 5 of [the first hour](first-hour.md)). They live in Claude's own folder on this computer, `.claude` in your home folder. Before changing any file there, setup keeps a dated copy of it (the copy's name ends in `.bak-` and the date and time), so everything can be put back.

| Part | Where | What it is for | Leaves your computer? | To remove it |
|---|---|---|---|---|
| The start step | `.claude/hive` (the file `start.ps1`, or `start.mjs` where the Node version is installed) | Makes every new chat on this computer read your notes before it answers, and shows the HIVE MIND box. | No | [Undo everything](when-it-breaks.md#undo-everything) |
| The checks (gates) | `.claude/hive/gates` (the file `gates.mjs`) | Hold Claude to your rules: research before design, proper instructions for helpers, your yes before anything public or paid, and notes on replies that run long. | No | Say "remove the gates", or switch them off with "gates off" |
| The privacy check | `.claude/hive` (the file `privacy-guard.ps1`); a Node version, `privacy-guard.mjs`, stays in your notes under `core/guard` | Runs before every save and refuses passwords, keys and the private names you gave. | No | [Undo everything](when-it-breaks.md#undo-everything) |
| The save hook | `.git/hooks/pre-commit` inside your `hive-mind` folder | Runs the privacy check by itself every time your notes are saved. | No | [Undo everything](when-it-breaks.md#undo-everything) |
| The helpers | `.claude/skills`, one folder per helper, each named `hive-` and a word (for example `hive-setup`, `hive-start`, `hive-close`) | Short instruction files Claude follows for one job each: set up, start, save a note, close, shorten a long chat, take in what you send, add a project, add or remove a skill or a tool, look for ready-made parts, check a tool is safe, explain the checks, prove a change works. | No | [Undo everything](when-it-breaks.md#undo-everything) |
| Claude's settings | `.claude/settings.json` | Setup adds the start step and the checks to the list of things Claude runs at set moments (called hooks). Everything else in the file stays. | No | [Undo everything](when-it-breaks.md#undo-everything) |
| A short instruction for Claude | `.claude/CLAUDE.md`, between the lines `<!-- hive-mind:start -->` and `<!-- hive-mind:end -->` | Tells every chat on this computer to use your notes and save what you decide. Everything else in the file stays. | No | [Undo everything](when-it-breaks.md#undo-everything) |
| Where your notes are | `.claude/hive/config.json`, where the installer writes it | Records the folder of your notes, so the start step and the checks find it. | No | [Undo everything](when-it-breaks.md#undo-everything) |
| Your private names | `.claude/hive/protected-names.txt` | The names you said must never be saved (an employer, clients, people). Only on this computer. | No, never | Yours: the undo asks before touching it |
| The off switch | `.claude/hive/gates-off` | An empty file. While it exists, every check is off. | No | Say "gates on", or delete the file |
| The logs | `.claude/hive` (files ending in `.log`) | Plain lists of what the checks and the start step did, for when you ask why something happened. | No | Safe to delete |

## Claude's own parts, which Hive Mind uses and does not replace

Chats, the Code tab, side-by-side chats, the phone app, chats in the cloud, scheduled runs, skills from Anthropic's own list, tools (connectors) and private pages are Claude's own. Hive Mind adds your notes and checks to them and never copies them. Claude's own help is at [code.claude.com/docs](https://code.claude.com/docs).
