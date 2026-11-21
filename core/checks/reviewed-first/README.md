# Reviewed first

The rule: outside tools are reviewed first. A reminder does not hold that rule. This check stops the step instead.

## What it stops

Before a tool runs, it looks for five ways an outside tool comes in, and then for that tool's review.

1. **A package is installed**: npm, pnpm, yarn, bun, pip, uv, pipx, cargo, go, gem, brew, choco, scoop and winget. It also looks inside `bash -c "..."` and `powershell -Command "..."`.
2. **An outside package is run without installing it**: npx, bunx, pnpm dlx, yarn dlx, npm exec, uvx, pipx run.
3. **A plugin is installed**: `claude plugin install`, `claude plugin marketplace add`, or a plugin turned on by editing a settings file.
4. **A skill folder is added**: `npx skills add`, a `git clone` or a copy into a `.claude/skills` folder, or a file written into a skills folder that did not exist yet. Calling a skill is checked too.
5. **A connector is connected or used**: `claude mcp add`, a new server written into `.mcp.json` or `.claude.json`, or a call to a connector's tool. Every call is checked, not only the first. The review cannot change between two calls, so the answer is the same each time.

It also stops a script that is downloaded from the web and piped straight into a shell (`curl ... | bash`). No review can see what such a script will run.

It looks for the review in this order:

1. The exact repository (`maker/name`) in your review notes (`system/reviews/*.md`), in your catalogue (`system/catalogue.md`, if you keep one) and in the registry. This comes first because two tools from different makers can share a name.
2. The registry entry with that name (`system/registry.json`, its `review` field).
3. A section of a review note or the catalogue with that name. When the registry already has an entry with that name, a section about one exact repository is skipped, because it may be another maker's tool. Plain words left over from a name, such as "mcp", "cli" or "server", never count as a name.

From the catalogue only two shapes are read: a bold line that names its tool and gives a verdict, and a bold "Verdict:" line inside a "## Review: ..." section.

What it decides:

- **"Do not use"** or **"do not install"** in any review: refused, always. A yes in the chat does not lift it. Only a new review that changes the verdict does.
- **No review**, or a record that says `needed`, `not reviewed` or `not found`: refused. The refusal names the step to take: run the `hive-review` skill, write the verdict in the registry, then ask the person.
- **Reviewed** (`reviewed ...`, `use`, `use with limits`), **official**, or **not-applicable** (your own tools): let through.

## What it lets through on purpose

- Restoring a project (`npm install`, `npm ci`, `pip install -r requirements.txt`), and local folders and files.
- A package that the project's `package.json` already lists, and `npx` of a program the project already has.
- Your own skills, when a folder with that name is in `core/skills`.
- Tools that were in use before reviews began: an active registry entry with an empty review, from any source except third-party. You can switch this with `grandfather` in `settings.json`.
- Connectors, judged by where they came from. Claude Code tells the check where a connector was set up (this needs Claude Code 2.1.274 or later). The app's own connectors pass, and so do connectors added in claude.ai, where the directory lives: directory and official connectors need no review. You can switch the second part with `claudeaiIsDirectory`.
- A connector written into a settings file by hand passes only when the registry clears it. Its name alone is not trusted, because anyone writing a settings file can choose any name.
- When Claude Code does not say where a connector came from: the app's own connectors by name (`builtIn` in `settings.json`), and connectors whose name is a long id like `00000000-0000-0000-0000-000000000003` (a made-up one), which is how claude.ai directory connectors appear.
- A plugin's connector passes when the plugin's skills are cleared in the registry.
- A skill name the registry does not know and that has no folder in `~/.claude/skills`. That is a built-in skill or a plugin's skill.

## What it cannot see, and why

- **A custom connector added by hand in claude.ai** looks the same to the check as a directory connector, so it passes. Claude Code does not tell the two apart.
- **Which source the desktop app's own connectors report** has not been checked in a live chat. If one is refused, give it a registry entry; do not weaken the check.
- **Skills listed in the registry with no source and no review** are refused when called, like any tool of unknown origin. If they are your own, set `source` to `owner` in their entries.
- **Slash commands you type yourself**, such as `/plugin install`, never reach a tool, so no check sees them.
- **Installs hidden inside a script file or inside a package's own install scripts.** The check reads the command, not what the program does when it runs.
- **Unusual shell forms**, such as a command built from variables or aliases. A download followed by a separate run of the file is not caught.
- **Name matching.** A package with the same name as a reviewed tool but from another maker passes when no repository is named. Use the full name to be exact.
- **Whether the review is good.** It checks that a review exists and what its verdict says.
- **Your yes.** The rule also asks for your yes. Other checks and the app's own permission rules hold that part.
- **An opinion on a tool given in a reply before its review.** A reply is not a tool step, so this check does not see it.

## Its own errors

This is a safety check. If it breaks on a step that looks like an install or a first use, or on a step it cannot read at all, it refuses that step and says it broke. It reads the registry and the notes only for such steps, so a broken registry never stops you from reading or mending a note. Either way it writes the error to the log.

Speed: the first step of each hook call reads the registry and the notes. It stays inside the loader's limit of 200 ms; later steps take well under 50 ms.

## How to switch it

- Only you can change its mode (`refuse`, `notice`, `off`), in your own message. The settings file cannot switch it off.
- To clear a tool: run the `hive-review` skill, then write the verdict into the tool's registry entry or into a note in `system/reviews/`.
- To let one outside package be run without a review: add it to `trustedRun` in `settings.json`, with the reason.

## Three examples

1. A tool's review said "do not use in this notebook, it keeps a second lessons file", and it was installed anyway. Now installing it, turning it on as a plugin or calling it as a skill is refused.
2. A memory tool was reviewed "do not use, it hooks every tool call". Installing it or adding it as a connector is refused.
3. A tool with no licence installed itself with `curl ... | bash`. Cloning it and piping its script are both refused.

## Test

`node --test core/checks/reviewed-first/check.test.mjs`: a known-bad and a known-good case for each way a tool comes in, "do not use" even after a yes, two makers with one name, the catalogue's verdicts, where a connector came from, the check's own error, and its speed.
