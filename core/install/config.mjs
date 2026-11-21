// Where the notebook is. The installer writes it once to <Claude folder>/hive/config.json, so the notebook can live
// in any folder (Documents, a folder with spaces, another drive), not only in ~/hive-mind.
// Every part that needs the notebook asks in this order: HIVE_ROOT (for test copies), then config.json, then ~/hive-mind.
//   import { notebookRoot } from './config.mjs'      notebookRoot() gives the folder
//   node core/install/config.mjs                     prints the folder (for scripts in other languages)
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

export const ABOUT = 'Where your Hive Mind notebook is. Written by the installer; read by the start step, the gates and the health check. To move the notebook, move the folder and run the installer again from its new place.';

export function configPath(hiveDir) { return path.join(hiveDir, 'config.json'); }

export function configText(root) {
  return JSON.stringify({ _about: ABOUT, root: path.resolve(root) }, null, 2) + '\n';
}

export function readConfig(hiveDir) {
  try {
    const c = JSON.parse(fs.readFileSync(configPath(hiveDir), 'utf8').replace(/^﻿/, ''));
    return c && typeof c === 'object' ? c : null;
  } catch { return null; }
}

export function notebookRoot({ env = process.env, home = env.HIVE_HOME || os.homedir(), hiveDir } = {}) {
  if (env.HIVE_ROOT) return env.HIVE_ROOT;
  const dir = hiveDir || env.HIVE_STATE || path.join(home, '.claude', 'hive');
  const c = readConfig(dir);
  const r = c && (c.root || c.notebook); // "root" is written; "notebook" is read too, as the start step does
  if (typeof r === 'string' && r.trim()) return r;
  return path.join(home, 'hive-mind');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.write(notebookRoot() + '\n');
}
