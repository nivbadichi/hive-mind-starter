# Putting Hive Mind on this computer: the exact steps

Read by Claude, reached from `hive-setup` (steps 1 and 5) and from `hive-doctor`. The person never sees this file; tell them each step in plain words and ask before it. Back up first; stop if anything looks different from what is written here; never put a secret in a note.

Words used here: the **notebook** is the person's private copy of this starter. **Home** is their home folder (`~`; on Windows `C:\Users\<name>`). Claude's folder is `~/.claude`. Run every command from the notebook unless the step says otherwise.

## Which steps to take

- No notebook yet (the chat is not in a folder with `system/rules.md`): "Missing tools", then "The copy", then "The parts".
- In a notebook, the parts missing (`~/.claude/hive` holds neither `install-record.json` nor `config.json`; the folder itself may already be there, made for the private names list, and proves nothing): "Missing tools", then "The parts".
- The doctor sent you here: only the section it named.
- The Hive Mind plugin is switched on (`~/.claude/settings.json` has an `enabledPlugins` entry starting `hive-mind@`): skip "The parts"; the plugin brings them. Both together put every helper there twice; if both are already in, tell the person to keep one way: remove the plugin (`claude plugin uninstall hive-mind@hive-mind`), or take these parts out ("Undo").
- After the plugin was removed, its run-time files (log, per-chat records) stay in `~/.claude/hive`: `node core/install/install.mjs clear --dry-run`, tell the person, then without `--dry-run` on a yes. It keeps every file of theirs.
- If a HIVE MIND start message already appeared in this chat, the parts are in place (they may have come as a plugin): skip "The parts".

## Missing tools

1. Run `git --version` and `node --version`. Done when you know which of the two is missing.
2. For each missing one, tell the person what it is for, in one line, and that installing it is their choice:
   - Git saves the notes and links them to the private copy online. Without it nothing is saved. Free, from git-scm.com/downloads.
   - Node runs the checks and the start of every chat (the gates, the doctor, the starting set). Without it the notes still work in this folder, but new chats elsewhere will not know them. Free, from nodejs.org (the version marked LTS).
   How it is installed (the same as `docs/first-hour.md`, step 3, tells the person; keep the two the same):
   - **Windows:** with the person's yes for that one program, run Windows' own installer, `winget`: `winget install --id Git.Git -e --source winget` for Git, `winget install --id OpenJS.NodeJS.LTS -e --source winget` for Node. Tell them Windows may ask "Do you want to allow this app to make changes to your device?" and that they click Yes. If `winget` is not recognised, give them the download pages instead (git-scm.com/downloads/win, nodejs.org/en/download) and they install with the default choices. Never download and run an installer file yourself.
   - **Mac:** for Git, the first `git --version` may open Apple's offer of the "command line developer tools"; they click Install. For Node, they download the LTS installer from nodejs.org/en/download and click through.
   - **Linux:** tell them the package for their system (for example `sudo apt install git nodejs`); typing a `sudo` command and its password is theirs to do.
   After it is installed, they quit the Claude app completely (Quit or Exit in its menu, not only the window) and open it again, so it sees the new program.
3. Run the version commands again. Done when each missing tool now answers, or the person chose to go on without it (say what will not work).

## The copy

The notebook must be the person's own **private** copy, made from the starter as a template. A fork of a public repository cannot be made private, and a downloaded ZIP is not a Git folder (nothing saves), so neither is used.

1. Ask whether they have a GitHub account. Making one is theirs to do (github.com, Sign up); wait until they have. Done when they say they are signed in.
2. Make the copy, with their yes (it creates something online). Two ways; use the first that is there:
   - The `gh` tool, if `gh auth status` says signed in. From the home folder: `gh repo create hive-mind --private --template <the starter, written as account/name> --clone`. It makes the private copy and puts it in `~/hive-mind`. (The flags were read from `gh repo create --help`; check it again if this command fails.)
   - By hand, in the browser: on the starter's page, the green **Use this template** button, then **Create a new repository**; name it `hive-mind`; choose **Private**; **Create repository**. Then clone it: from the home folder, `git clone <the new copy's address> hive-mind`.
   - The GitHub connector, if it is connected and can create a repository from a template. Not confirmed; check its tools first.
   Signing in, to `gh` or the browser, is the person's act.
3. Open the new folder: say "In the Claude app, open the Code tab and choose the folder hive-mind in your home folder as this chat's folder." Done when `~/hive-mind/system/rules.md` exists and `git -C ~/hive-mind remote get-url origin` prints their copy's address.

If they keep the notebook somewhere else than `~/hive-mind`, go on with "The notebook's place" after "The parts".

## The parts

The parts are the start step (so each new chat knows the person), the gates (checks that hold Claude to the rules), the helpers, and the save hook (the privacy check at every save). They need Node.

1. Pick the installer:
   - `core/install/install.mjs` exists: it serves Windows, Mac and Linux. The command is `node core/install/install.mjs install`; its dry-run option is `--dry-run`, and `--root <notebook>` gives the notebook's place when it is not the folder the installer sits in. `node core/install/install.mjs --help` lists every option.
   - Otherwise, on Windows: `powershell -NoProfile -ExecutionPolicy Bypass -File core/gates/install.ps1` (add `-Root <notebook>` when the notebook is not `~/hive-mind`). The bypass is for that one run only and changes no setting.
   - Otherwise, on Mac or Linux: the parts cannot be installed from this copy yet. Say so plainly; the notes still work in this folder. Done here.
   Done when you know the one command.
2. **Dry run.** The command with its dry-run option (`-DryRun` for `install.ps1`). Tell the person in plain words what would change: a few small parts are added to Claude on this computer, every file replaced is kept first as `<file>.bak-<date-time>`, nothing of theirs is removed, the gates can be switched off any time. Never paste the path list. Ask. Done when they said yes or no.
3. **Install**, on a yes: the same command without the dry-run option. It copies the start step, the privacy check and the gates into `~/.claude/hive`, each helper's `SKILL.md` into `~/.claude/skills`, merges the hooks into `~/.claude/settings.json` (keeping every other setting), writes the Hive Mind block into `~/.claude/CLAUDE.md` between `<!-- hive-mind:start -->` and `<!-- hive-mind:end -->`, and copies the save hook into the notebook's `.git/hooks/`. It is safe to run again. If it prints `STOPPED:`, read the reason: "node was not found" goes to "Missing tools"; "the notebook was not found" goes to "The notebook's place". Done when it ends without `STOPPED:`.
4. **Prove it.** `node core/gates/test.mjs --quiet` (every line must pass; it works only in temporary folders), then `node core/skills/hive-doctor/scripts/doctor.mjs`. Done when the doctor prints `ALL FINE`, or only `NOTE` lines and `no-online-copy` (fixed by `hive-setup` step 5.4).

## The notebook's place

The start step, the gates and the health check look for the notebook at `~/hive-mind` unless told otherwise.

1. Run the doctor; its `notebook-path` line says where the parts look and where the notebook is. Done when you know both.
2. With the person's yes, one of:
   - `core/install/install.mjs` exists: from the notebook's new place, run `node core/install/install.mjs install --root <the notebook's new folder>` (dry run first, with `--dry-run`); it records the place for every part, the gates included.
   - Otherwise: move the notebook folder to `~/hive-mind` (close other chats in it first), then run "The parts" again. Moving keeps everything, the Git history and the online link too.
3. Done when the doctor's `notebook` line is `OK` and a new chat shows the start message.

## Undo

With `core/install/install.mjs` present (the installer keeps a record of every change it made, in `~/.claude/hive/install-record.json`):

- **Remove only the gates:** `node core/install/install.mjs remove-gates --dry-run`, tell the person, then without `--dry-run` on a yes.
- **Undo everything** ("undo the Hive Mind setup"): `node core/install/install.mjs uninstall --dry-run`, tell the person in plain words, then without `--dry-run` on a yes. It puts back every file it changed as it was before the first install, removes what it added (the save hook in the notebook too, also after a move), and keeps every file it did not write, the protected names list among them; it says which it kept. On Windows, `core/gates/uninstall.ps1 -All` (with `-DryRun` first) runs the same program. Cancel scheduled brief runs with their yes. The notebook folder stays; it is theirs to delete.
- An install that stopped halfway is finished by running the install again, or undone by `uninstall`; both read the record.

Without `core/install/install.mjs` (an older copy):

- **Remove only the gates:** `powershell -NoProfile -ExecutionPolicy Bypass -File core/gates/uninstall.ps1 -DryRun`, tell the person, then without `-DryRun` on a yes.
- **Undo everything:** remove the gates as above; then restore the **oldest** `settings.json.bak-<date-time>` and the **oldest** `CLAUDE.md.bak-<date-time>` in `~/.claude` (the copies made before the first install; a newer one may still hold the gates). If there was no file before the install, remove the Hive Mind entries from `settings.json` and the marked block from `CLAUDE.md` instead. Then delete the contents of `~/.claude/hive` except `protected-names.txt`, the `hive-` folders in `~/.claude/skills`, and the hooks in the notebook's `.git/hooks/`. Ask before removing `protected-names.txt`: it is the person's own list. Cancel scheduled brief runs with their yes. The notebook folder stays; it is theirs to delete.
- Done when the doctor's only `FIX` lines are `not-installed` and `no-save-hook`.

## Test copies

Every part reads the notebook from `HIVE_ROOT` when it is set, and the installer, the health check and the doctor take a test Claude folder (`-ClaudeDir`, `CLAUDE_DIR`, `--claude`). Use these for a test copy; never point a test at the person's real notes or real `~/.claude`.
