// Merge or remove the Hive Mind hook entries in a Claude settings file. Prints the new file to stdout; changes nothing itself.
//   node settings-merge.mjs merge   <settings.json> <snippet.json> <node.exe> <hive folder> [<notebook folder>]
//   node settings-merge.mjs unmerge <settings.json>          the gates out; the start step back to its one older entry
//   node settings-merge.mjs unmerge <settings.json> --all    every Hive Mind entry out, nothing put back: a merge followed
//                                                            by this gives back the file as it was before the merge
// Hive Mind's own entries are recognised by their command (the start step, the gates script or the factory's two hooks)
// and replaced; every other entry, and every other setting, is kept as it is, in its order.
// Exact on the way back (in step with the main system, 2026-11-20): only an event that held a Hive Mind entry and is
// left empty is taken out, and the "hooks" setting itself only when taking out Hive Mind's entries left it empty; an
// empty event or an empty "hooks" of your own, with nothing of Hive Mind's in it, stays. (Known limit: an empty event or
// an empty "hooks" that you had BEFORE a merge filled it cannot be told apart afterwards; it goes.)
// The factory's hooks (snippet "factory") are merged only when the snippet says "factory": { "enabled": true }; with
// false or no "factory" block they are left out, and any copy of them already in the settings is taken out.
// Placeholders: __NODE__ (node), __HIVE__ (the hive folder), __ROOT__ (the notebook: the fifth argument, else the
// folder two levels above this script, which is where the installer runs it from).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OURS = /hive[\\/]+start\.(ps1|mjs)|gates\.mjs|factory[\\/]+on-(edit|stop)\.mjs/i;
function isOurs(entry) {
  return (entry.hooks || []).some((h) => OURS.test(String(h.command || '')) || (h.args || []).some((a) => OURS.test(String(a))));
}
function read(p) { return JSON.parse(fs.readFileSync(p, 'utf8').replace(/^﻿/, '')); }
const HERE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export function unmerge(settings, restoreStart) {
  const s = structuredClone(settings);
  if (!s.hooks) s.hooks = {};
  let took = false;
  for (const ev of Object.keys(s.hooks)) {
    const before = Array.isArray(s.hooks[ev]) ? s.hooks[ev] : [];
    const kept = before.filter((e) => !isOurs(e));
    if (kept.length === before.length) continue; // nothing of ours here: left exactly as it was
    took = true;
    if (kept.length) s.hooks[ev] = kept; else delete s.hooks[ev];
  }
  if (restoreStart) {
    // This copy starts PowerShell with -ExecutionPolicy Bypass (for that run only), because Windows blocks scripts by default.
    s.hooks.SessionStart = [{ hooks: [{ type: 'command', command: 'powershell -NoProfile -ExecutionPolicy Bypass -File "$HOME\\.claude\\hive\\start.ps1"', shell: 'powershell' }] }, ...(s.hooks.SessionStart || [])];
  } else if (took && !Object.keys(s.hooks).length) {
    delete s.hooks; // it held only Hive Mind's entries, so it was made by a merge
  }
  return s;
}
export function factoryOn(snippet) { return !!(snippet && snippet.factory && snippet.factory.enabled === true); }
export function merge(settings, snippet, nodePath, hiveDir, rootDir = HERE_ROOT) {
  const s = unmerge(settings, false);
  if (!s.hooks) s.hooks = {};
  const lit = (v) => JSON.stringify(String(v).replace(/\\/g, '/')).slice(1, -1);
  const fill = (v) => JSON.parse(JSON.stringify(v).replace(/__NODE__/g, JSON.stringify(nodePath).slice(1, -1)).replace(/__HIVE__/g, lit(hiveDir)).replace(/__ROOT__/g, lit(rootDir)));
  const add = (hooks) => { for (const [ev, entries] of Object.entries(hooks || {})) s.hooks[ev] = [...(s.hooks[ev] || []), ...fill(entries)]; };
  add(snippet.hooks);
  if (factoryOn(snippet)) add(snippet.factory.hooks);
  return s;
}

if (process.argv[1] && process.argv[1].endsWith('settings-merge.mjs')) {
  const [cmd, file, snippetFile, nodePath, hiveDir, rootDir] = process.argv.slice(2);
  const settings = fs.existsSync(file) ? read(file) : {};
  const result = cmd === 'merge' ? merge(settings, read(snippetFile), nodePath, hiveDir, rootDir || HERE_ROOT) : unmerge(settings, !process.argv.includes('--all'));
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}
