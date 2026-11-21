# Hive Mind as a plugin

A plugin is Claude Code's own way to add a set of parts in one step. Hive Mind comes as a plugin too. This page says how to add it, update it and remove it.

## What the plugin is, and what it is not

- **The plugin** brings the programs: the helpers (skills), the start step and the checks. Claude Code keeps them in its own folder and updates them for you.
- **Your notebook** is your notes: your private copy on GitHub and on this computer. The plugin never holds your notes.
- **One small file joins them.** After you add the plugin, you tell it your notebook folder (see "Add it" below). The plugin writes that folder into `~/.claude/hive/config.json`, the same file setup writes. The start step, the checks and the helpers all look there.

## Use one way, not both

There are two ways to get the same parts: step 5 of [Your first hour](first-hour.md#step-5-let-claude-add-the-small-parts-about-5-minutes), or this plugin. Pick one.

If both are in place, the plugin stands down: the parts from step 5 run, the plugin's copies do not, and the first start message says so. Every helper is then there twice, so keep one way. To keep only the plugin, ask Claude to undo step 5 (see [Undo everything](when-it-breaks.md#undo-everything)). To keep only step 5, remove the plugin (see "Remove it" below).

Today the first hour uses step 5. The plugin does not yet add the privacy check to your notebook's saves, so until it does, step 5 is the safer way.

## Add it

In a chat on your computer, type these two lines. The first one is the address of Hive Mind's own page on GitHub.

```
/plugin marketplace add https://github.com/nivbadichi/hive-mind-starter
/plugin install hive-mind@hive-mind
```

Add it only from that public address. Never add it from your own notes folder: Claude Code copies the whole folder it is given into its own plugin folder, so your private notes would be copied there too. If that happens, the plugin stops at once and nothing of it runs. Then take three steps: remove the plugin, delete the copy it names in its message (removing the plugin does not delete that copy, so your notes stay there until you do), and add the plugin again from the public address.

Pick **Install for you**. Then tell the plugin where your notebook is. In a terminal, Claude Code does not ask for it; it says "1 userConfig option not yet set" and points you to `/plugin`. In the app it may ask for **Your notebook folder** straight away. Either way, you can type `/plugin`, open **Installed**, pick `hive-mind` and choose **Configure options**, then choose the folder of your copy. Leave it empty only if your copy is `hive-mind` in your home folder. Then start a new chat.

**You should see:** the HIVE MIND box at the top of the new chat, as after step 5.

## Update it

Claude Code updates the plugin when a new version comes out, if updates are turned on for it: type `/plugin`, open **Marketplaces**, pick `hive-mind` and turn on updates. To update now, pick **Update marketplace** there. Then type `/reload-plugins` or start a new chat.

## Remove it

Type `/plugin`, open **Installed**, pick `hive-mind` and choose **Uninstall**. Or, in a terminal: `claude plugin uninstall hive-mind@hive-mind`. Your notebook is not touched.

What stays after that, in `~/.claude/hive`:
- `config.json`, which says where your notebook is, so step 5 can use it later;
- your list of private names, and any other file you made there;
- the files the plugin wrote while it ran: its log and a small record for each chat. One of these records holds the text of the last message you typed in that chat.

To take out those last files too, say "clear what Hive Mind left on this computer" in a chat in your notebook folder. Claude first shows you what it would remove (`node core/install/install.mjs clear --dry-run`), then removes it after your yes. It removes only the files Hive Mind wrote and keeps everything of yours. It refuses while the plugin is still switched on.

## In the cloud

A chat in the cloud (at claude.ai/code, or a scheduled task in the cloud) does not load plugins from your computer. It gets its start from your notebook itself: the file `.claude/settings.json` in your copy runs the cloud start step when such a chat opens. On your computer that same step stays silent.

A thread of a Claude Code Project in the cloud runs none of your notebook's start steps. You can add a plugin to a Project there. Whether the plugin's start step then runs in its threads is not confirmed yet.
