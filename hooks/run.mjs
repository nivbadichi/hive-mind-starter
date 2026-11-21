#!/usr/bin/env node
// The one door for every hook of the Hive Mind plugin (hooks/hooks.json calls it).
//   node hooks/run.mjs start rules|state|flight     the start step, one part
//   node hooks/run.mjs gates pretool|posttool|prompt|stop|precompact     the checks
// It runs the plugin's own copies of core/start/start.mjs and core/gates/gates.mjs, so nothing is copied into the
// Claude folder. Before that it decides three things:
//   1. Cloud chat (CLAUDE_CODE_REMOTE=true): only the start runs, through core/start/start-cloud.sh, with the notebook
//      being the chat's folder. The checks stay quiet there, as the cloud start says, until it is proven that plugin
//      hooks run in cloud threads.
//   2. The installer already put Hive Mind hook entries into the Claude folder's settings.json: the plugin stands down,
//      so nothing runs twice. Its first start part says so in one line.
//   3. Where the notebook is: the plugin's "notebook" option (CLAUDE_PLUGIN_OPTION_NOTEBOOK). When it is set, it is
//      written into <Claude folder>/hive/config.json, the same file the installer writes, so the helpers and the
//      health check find the notebook too. When it is empty, the usual order holds: config.json, then ~/hive-mind.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OURS = /hive[\\/]+start\.(ps1|mjs)|hive[\\/]+gates[\\/]+gates\.mjs/i;

export function claudeDir(env = process.env) {
  return env.CLAUDE_CONFIG_DIR ? path.resolve(env.CLAUDE_CONFIG_DIR) : path.join(env.HIVE_HOME || os.homedir(), '.claude');
}

/** True when settings.json in the Claude folder already holds a Hive Mind hook entry written by the installer. */
export function installerHooksPresent(dir) {
  let s;
  try { s = JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8').replace(/^﻿/, '')); } catch { return false; }
  const hooks = s && typeof s === 'object' && s.hooks && typeof s.hooks === 'object' ? s.hooks : {};
  for (const entries of Object.values(hooks)) {
    if (!Array.isArray(entries)) continue;
    for (const e of entries) for (const h of (e && e.hooks) || []) {
      if (OURS.test(String(h.command || '')) || (h.args || []).some((a) => OURS.test(String(a)))) return true;
    }
  }
  return false;
}

/** Writes <hive>/config.json when the notebook option is set and the file does not already name that folder. */
export function connectNotebook(hive, notebook) {
  if (!notebook || !notebook.trim()) return false;
  const root = path.resolve(notebook.trim());
  const file = path.join(hive, 'config.json');
  try {
    const cur = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
    if (cur && path.resolve(String(cur.root || cur.notebook || '')) === root) return false;
  } catch {}
  const about = 'Where your Hive Mind notebook is. Written by the installer or by the Hive Mind plugin from its "notebook" option; read by the start step, the gates and the health check.';
  fs.mkdirSync(hive, { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ _about: about, root }, null, 2) + '\n');
  return true;
}

/** True when the plugin's own folder holds someone's filled notebook (their notes), not the public copy. */
export function filledNotebook(root = ROOT) {
  if (fs.existsSync(path.join(root, 'me', 'profile.md'))) return true;
  try { return fs.readdirSync(path.join(root, 'projects'), { withFileTypes: true }).some((d) => d.isDirectory() && fs.existsSync(path.join(root, 'projects', d.name, 'state.md'))); } catch { return false; }
}

function main(argv, env) {
  const [kind, part] = argv;
  if (kind !== 'start' && kind !== 'gates') return 0;

  // Added from a person's own notebook: Claude Code copied the whole folder, private notes too, into its plugin cache.
  // Run nothing; say it loudly at the first start part.
  if (filledNotebook()) {
    if (kind === 'start' && part === 'rules') {
      const msg = `This plugin was added from a folder that holds private notes (${path.join(ROOT, 'me')}, projects). Claude Code copied that whole folder, notes included, into its plugin folder at ${ROOT}. Add the plugin only from Hive Mind's own public page on GitHub (https://github.com/nivbadichi/hive-mind-starter), never from your own notes folder.`;
      process.stdout.write(JSON.stringify({
        systemMessage: `HIVE MIND PLUGIN: STOPPED. It was added from your own notes folder, so a copy of your private notes now sits in Claude's plugin folder, and it stays there until you delete that copy (${ROOT}), even after the plugin is removed. Nothing of the plugin runs.`,
        hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: `HIVE MIND PLUGIN STOPPED: ${msg} Tell the person first, in plain words. The fix has three steps, each with their yes:\n1. Remove the plugin: claude plugin uninstall hive-mind@hive-mind, then claude plugin marketplace remove hive-mind.\n2. Delete the copy at ${ROOT}. Removing the plugin does not delete it, so the notes stay there until this step is done.\n3. Add the plugin again, from the public address only.` },
      }) + '\n');
    }
    return 0;
  }

  if (env.CLAUDE_CODE_REMOTE === 'true') {
    if (kind !== 'start') return 0;
    const r = spawnSync('sh', [path.join(ROOT, 'core', 'start', 'start-cloud.sh'), part || 'all'], { stdio: 'inherit', env });
    return r.status ?? 0;
  }

  const dir = claudeDir(env);
  if (installerHooksPresent(dir)) {
    if (kind === 'start' && part === 'rules') {
      process.stdout.write('HIVE MIND PLUGIN: standing down. The Hive Mind installer already put its start step and checks into ' + path.join(dir, 'settings.json') + ', so those run and the plugin\'s copies do not. Every helper is there twice, once from each way. Keep one way, and tell the person so in plain words: to keep the installer\'s parts, remove the plugin (claude plugin uninstall hive-mind@hive-mind, or /plugin, Installed, hive-mind, Uninstall); to keep the plugin, take the installed parts out (node core/install/install.mjs uninstall in the notebook, with --dry-run first).\n');
    }
    return 0;
  }

  const hive = env.HIVE_STATE || path.join(dir, 'hive');
  const child = { ...env, HIVE_STATE: hive, HIVE_CLAUDE: dir };
  const option = env.CLAUDE_PLUGIN_OPTION_NOTEBOOK;
  if (option && option.trim()) {
    child.HIVE_ROOT = path.resolve(option.trim());
    try { connectNotebook(hive, option); } catch {}
  }
  const script = kind === 'start' ? path.join(ROOT, 'core', 'start', 'start.mjs') : path.join(ROOT, 'core', 'gates', 'gates.mjs');
  const args = kind === 'start' ? [script, '--part', part || 'all'] : [script, part || ''];
  const withBlock = kind === 'start' && part === 'rules';
  const r = spawnSync(process.execPath, args, { stdio: withBlock ? ['inherit', 'pipe', 'inherit'] : 'inherit', env: child });
  if (r.error) { process.stderr.write(`Hive Mind plugin: ${path.basename(script)} could not start (${r.error.message}).\n`); return 0; }
  if (withBlock) process.stdout.write(addBlock(String(r.stdout || ''), child.HIVE_ROOT));
  return r.status ?? 0;
}

// A plugin cannot carry a CLAUDE.md, so the Hive Mind block the installer writes into <Claude folder>/CLAUDE.md
// (core/claude-md.md) rides at the end of the first start part instead.
export function addBlock(out, notebook) {
  let block;
  try { block = fs.readFileSync(path.join(ROOT, 'core', 'claude-md.md'), 'utf8').replace(/\r\n/g, '\n').trim(); } catch { return out; }
  if (notebook) block = block.split('~/hive-mind').join(notebook.split(path.sep).join('/'));
  try {
    const o = JSON.parse(out);
    const h = o && o.hookSpecificOutput;
    if (!h || typeof h.additionalContext !== 'string') return out;
    h.additionalContext += '\n\n' + block;
    return JSON.stringify(o) + '\n';
  } catch { return out; }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2), process.env);
}
