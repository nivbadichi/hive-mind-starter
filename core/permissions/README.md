# The app's own permission entries

This is the strongest of Hive Mind's three layers. Claude Code itself keeps three lists in its settings file: allow, ask and deny. A rule in **ask** makes the app stop and ask you before the step runs. A rule in **deny** refuses the step, and nobody can approve it from the prompt. Claude cannot argue with either. Where each claim was read (2026-11-20):

- Deny is checked first, then ask, then allow: https://code.claude.com/docs/en/permissions, "Manage permissions".
- An ask rule still asks in auto mode and bypass mode; in "don't ask" mode the step is refused instead: https://code.claude.com/docs/en/permission-modes, "Actions no mode auto-approves".
- A hook cannot get a step past a deny or ask rule: the permissions page, "Extend permissions with hooks".
- Lists from your different settings files are joined, so your own entries stay: https://code.claude.com/docs/en/settings, "Lists merge instead of overriding".
- How shell, file-path and tool-name rules match: the permissions page, "Wildcard patterns", "Compound commands", "Wrappers", "PowerShell", "Read and Edit", "Tool name wildcards" and "Match by input parameter".

## What it makes the app ask you about

- **Putting something online**: any command that names vercel, netlify, wrangler, firebase deploy, a package publish, a GitHub release, a new GitHub repository or gist, a publish script, `npm run deploy`, `publish` or `release`, the publish hold file, and the connector tools that deploy, promote or roll back.
- **A force-push**, or deleting a branch on GitHub.
- **Deleting**: rm, rmdir, Remove-Item and its short names, cmd's del and rd, git rm, git clean, git reset --hard, dropping stashes, deleting branches or worktrees, find -delete, the delete calls of Node, Python and .NET, every connector tool whose name holds "delete" or "trash", and deleting a published page.
- **Spending**: buying or moving a domain, and connector tools named for purchases, checkout, payment or subscriptions.
- **Installing**: package installs of every common kind, every npx, dlx, bunx and uvx run, adding a skill, a connector or a plugin, a shell that reads a script from a pipe, git apply, and writing into the skills, plugins, agents or commands folders, `.mcp.json` or `~/.claude.json`.
- **Changing the checks**: writing the app's settings files, the Hive folder, and your notebook's gates, checks, permissions, privacy guard, start step, installer and save-point hooks.

## What it refuses outright

`--no-verify` anywhere in a command (it skips the save-point privacy check) and `disableAllHooks` (it switches every hook off). You can still do either by hand.

## What it cannot match

The app's rules read the words Claude writes, not what a program does. A script or program file that deploys or deletes, a name put together at run time, a paid call made as an ordinary web request, and changes brought in by `git merge` are not caught here; the gates and the self-guard check look at those. A plain `git push` and a helper's own working copy are left open on purpose. Deleting inside a temporary folder and a bare `npm install` ask too, because the rules cannot tell them apart from the dangerous forms. `routes.json` lists each case with a test. The permissions page says it plainly: a shell rule "isn't a security boundary around the program". Two more limits from that page: a mod (a plugin that changes how the app behaves) that you install can approve a step past an ask rule when your computer has no managed settings; and in "don't ask" mode an ask rule refuses the step rather than asking you.

## How to use it

- `node core/permissions/permissions.mjs show`: the entries your computer would get.
- `node core/permissions/permissions.mjs merge <settings.json> --dry-run`: what would be added; nothing changes.
- `... merge <settings.json>`: adds them, and writes down first what it added.
- `... remove <settings.json>`: takes out only what it added; the app asks you before this runs.
- `... check <settings.json>`: says which entries are missing.

## Tests

`node --test core/permissions/` (every test file in the folder), on made-up settings files and a made-up home folder only. The dry run changes nothing, and merge then remove gives back a file with the same hash. The matching in `match.mjs` is a copy written from the permissions page, not the app itself.
