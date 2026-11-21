# What Claude already does for you

Claude does a lot on its own, with no Hive Mind at all. This page lists it, so you know where Claude ends and Hive Mind begins. The manuals never teach these parts again: each row links to Claude's own help, which stays current when Claude changes.

## Claude's own parts

| Claude's own part | What it does for you | Claude's own help | What Hive Mind adds to it |
|---|---|---|---|
| Instructions file and memory notes | A file of instructions that every chat reads, and short notes Claude writes for itself as it learns | [How Claude remembers](https://code.claude.com/docs/en/memory) | Your notebook is the one place for what is true. Claude's own memory notes can be read into it once, then switched off, after your yes |
| Skills | Instructions for one kind of job, which Claude follows when the job comes up | [Skills](https://code.claude.com/docs/en/skills) | The helpers of Hive Mind are skills, and the list of your skills says which one fits a job |
| Plugins and the plugin marketplace | A set of parts added in one step, from a list of plugins | [Plugins](https://code.claude.com/docs/en/plugins/overview) | Hive Mind can come as a plugin. See [Hive Mind as a plugin](plugin.md) |
| Tools Claude can connect to (connectors) | Claude reads and writes in other apps, such as your mail or your calendar | [Connect Claude to tools](https://code.claude.com/docs/en/mcp) | The list of your tools says which one to use for what, and new ones are checked before they are added |
| The desktop app: chats side by side | Several chats at once, each with its own copy of the folder, a card that offers to start a task in a new chat, and side questions that leave the chat as it was | [The desktop app](https://code.claude.com/docs/en/desktop) | Every chat starts knowing your rules and where things stand. A chat started by another chat works for that chat, and its report goes back to it |
| Messages between chats | One chat can send a message to another, and hear when another one is done | [Messages between chats](https://code.claude.com/docs/en/cross-session-messaging) | A message from another chat never counts as your yes |
| Scheduled runs on this computer | A job that runs at a set time while the app is open | [Scheduled tasks on your computer](https://code.claude.com/docs/en/desktop-scheduled-tasks) | The jobs that need this computer are set up here, after your yes |
| Scheduled runs in the cloud | A job that runs at a set time even when this computer is off | [Scheduled tasks in the cloud](https://code.claude.com/docs/en/routines) | The daily brief runs this way, if you chose it |
| The phone app and Remote Control | You drive a chat on this computer from your phone, and see its questions there | [Remote Control](https://code.claude.com/docs/en/remote-control) | Nothing. Use it as it is |
| Chats in the cloud | A chat that runs on Anthropic's computers and keeps going when yours is shut | [Claude Code on the web](https://code.claude.com/docs/en/claude-code-on-the-web) | A cloud chat on your notebook reads your notes when it starts |
| Projects with threads | One chat that hands out related tasks to chats of their own (a test version that is still reaching every account) | [Projects](https://code.claude.com/docs/en/claude-projects) | Your rules reach them as text. The checks do not run there yet, so work that needs the checks stays on this computer |
| Private pages | A page Claude makes that only you can open, also on your phone | [Artifacts](https://code.claude.com/docs/en/artifacts) | A report meant for you to look at, such as a table, can be shown on one, after your yes |
| Fixes for a change on GitHub | Claude watches a change you sent to GitHub and fixes what its checks find | [Claude Code on the web](https://code.claude.com/docs/en/claude-code-on-the-web) | Nothing. Use it as it is |
| The browser in the app | Claude opens a page or your own site and looks at it | [The desktop app](https://code.claude.com/docs/en/desktop) | Nothing. Use it as it is |

## What Hive Mind adds

Each part below sits on one of Claude's own parts above.

- **Your notes, in one place.** Every chat, every cloud chat and every scheduled run reads and writes the same notebook. Sits on: the instructions file and the start of each chat.
- **Your rules, held by checks.** Small programs stop a step that breaks a rule, or remind Claude of it. Sits on: the steps a chat takes on this computer.
- **A start for every chat.** Each new chat is told your rules, your projects and where things stand. Sits on: the start of each chat on this computer.
- **A front door.** A link or a file you send is read in full and filed. Sits on: the chat.
- **A list of your skills, tools, rules and habits.** Add or remove one in a sentence. Sits on: skills and the tools Claude can connect to.
- **A page at one address.** Your own private page, in a later release. Sits on: nothing of Claude's; it is your own site.

## When Claude changes

Claude's own parts change often. When one of them starts to do something Hive Mind does, Hive Mind stops doing it and uses Claude's own part, after your yes. That keeps one way of doing each thing.
