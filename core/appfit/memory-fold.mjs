#!/usr/bin/env node
// Claude's own memory notes ("auto memory"), folded into the notebook (change C3, decision D6 of
// the app-fit note). Facts from the official memory page (code.claude.com/docs/en/memory, read 2026-11-20):
// the notes live at ~/.claude/projects/<project>/memory/ (MEMORY.md, an index, plus one topic file per memory), or in the
// folder that "autoMemoryDirectory" names; auto memory is on by default; "autoMemoryEnabled": false in the user settings
// (~/.claude/settings.json) switches it off; CLAUDE_CODE_DISABLE_AUTO_MEMORY=1 does the same for one run.
//
//   node core/appfit/memory-fold.mjs list                 the memory files not yet taken into the notebook (paths start at ~)
//   node core/appfit/memory-fold.mjs notice               one line for the start message, or nothing at all
//   node core/appfit/memory-fold.mjs mark --all           record every listed file as taken in (after the front door filed it)
//   node core/appfit/memory-fold.mjs mark <file> ...      the same for some files
//   node core/appfit/memory-fold.mjs status               is auto memory on or off, by the settings file and the variable
//   node core/appfit/memory-fold.mjs off [--apply]        switch it off; without --apply a dry run that only prints the change
//   node core/appfit/memory-fold.mjs on  [--apply]        the undo: puts back the value that was there before "off"
// Options: --claude <dir> (default HIVE_CLAUDE, else ~/.claude), --hive <dir> (default HIVE_STATE, else <claude>/hive),
// --settings <file> (default <claude>/settings.json). The real ~/.claude/settings.json is written only with
// --owner-said-yes as well as --apply: switching the app's memory off changes a setting on your computer. With --apply a dated copy of the settings file is kept beside it.
// It never deletes or moves a memory file: taking a note in is the front door's work (hive-intake); this only keeps the
// record of what was taken (<hive>/appfit/memory-taken.json, one fingerprint per file).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const homeDir = () => process.env.HIVE_HOME || os.homedir();
export const defaultClaude = () => process.env.HIVE_CLAUDE || path.join(homeDir(), '.claude');
const defaultHive = (claude) => process.env.HIVE_STATE || path.join(claude, 'hive');
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8').replace(/^﻿/, ''));
const tilde = (p) => { const h = homeDir(); return p.toLowerCase().startsWith(h.toLowerCase()) ? '~' + p.slice(h.length).replace(/\\/g, '/') : p.replace(/\\/g, '/'); };
const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const takenFile = (hive) => path.join(hive, 'appfit', 'memory-taken.json');

function mdUnder(dir, out = []) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) mdUnder(p, out); else if (e.isFile() && e.name.toLowerCase().endsWith('.md')) out.push(p);
  }
  return out;
}

/** Every memory note on this computer: { abs, rel (from the claude folder, or ~), bytes }. */
export function memoryFiles({ claude = defaultClaude() } = {}) {
  const dirs = [];
  try {
    for (const e of fs.readdirSync(path.join(claude, 'projects'), { withFileTypes: true })) {
      if (e.isDirectory()) dirs.push(path.join(claude, 'projects', e.name, 'memory'));
    }
  } catch {}
  try {
    const s = readJson(path.join(claude, 'settings.json'));
    if (typeof s.autoMemoryDirectory === 'string' && s.autoMemoryDirectory.trim()) {
      const d = s.autoMemoryDirectory.trim().replace(/^~(?=[\\/]|$)/, homeDir());
      dirs.push(path.resolve(d));
    }
  } catch {}
  const seen = new Set(), out = [];
  for (const d of dirs) {
    for (const abs of mdUnder(d)) {
      const key = path.resolve(abs).toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const inside = path.relative(claude, abs);
      const rel = inside.startsWith('..') || path.isAbsolute(inside) ? tilde(abs) : inside.replace(/\\/g, '/');
      out.push({ abs, rel, bytes: fs.statSync(abs).size });
    }
  }
  return out;
}

function readTaken(hive) { try { return readJson(takenFile(hive)); } catch { return {}; } }

/** The memory files not taken in yet, or changed since they were. */
export function pending({ claude = defaultClaude(), hive } = {}) {
  const taken = readTaken(hive || defaultHive(claude));
  return memoryFiles({ claude }).filter((f) => taken[path.resolve(f.abs).toLowerCase()] !== sha(f.abs));
}

/** Record files as taken in. all: every pending file; files: some paths. Returns the number recorded. */
export function mark({ claude = defaultClaude(), hive, all = false, files = [] } = {}) {
  hive = hive || defaultHive(claude);
  const taken = readTaken(hive);
  const want = all ? pending({ claude, hive }).map((f) => f.abs) : files.map((f) => path.resolve(f));
  let n = 0;
  for (const abs of want) { if (!fs.existsSync(abs)) continue; taken[path.resolve(abs).toLowerCase()] = sha(abs); n++; }
  fs.mkdirSync(path.dirname(takenFile(hive)), { recursive: true });
  fs.writeFileSync(takenFile(hive), JSON.stringify(taken, null, 2) + '\n');
  return n;
}

/** On or off: by the variable first (it wins for the run), then the user settings file; the app's default is on. */
export function status({ claude = defaultClaude(), settings } = {}) {
  if (/^(1|true)$/i.test(String(process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY || ''))) return { on: false, why: 'CLAUDE_CODE_DISABLE_AUTO_MEMORY is set' };
  try {
    const s = readJson(settings || path.join(claude, 'settings.json'));
    if (s.autoMemoryEnabled === false) return { on: false, why: 'autoMemoryEnabled is false in the user settings' };
    if (s.autoMemoryEnabled === true) return { on: true, why: 'autoMemoryEnabled is true in the user settings' };
  } catch {}
  return { on: true, why: 'not set, and the app\'s default is on' };
}

/** The one start line, or '' when every memory file is taken in. Never a full path. */
export function noticeLine({ claude = defaultClaude(), hive } = {}) {
  const p = pending({ claude, hive });
  if (!p.length) return '';
  const st = status({ claude });
  return `NOTICE: Claude's own memory notes hold ${p.length} file${p.length === 1 ? '' : 's'} not yet taken into the notebook (auto memory is ${st.on ? 'on' : 'off'}). ` +
    'Read them with the front door (hive-intake: list them with node core/appfit/memory-fold.mjs list), file what is still true, then run node core/appfit/memory-fold.mjs mark --all. Nothing is deleted.';
}

export const isRealSettings = (p) => path.resolve(p).toLowerCase() === path.join(os.homedir(), '.claude', 'settings.json').toLowerCase();

function readSettings(file) {
  if (!fs.existsSync(file)) return {};
  try { return readJson(file); } catch { throw new Error(`${file} is not valid JSON; nothing was changed`); }
}
const prevFile = (hive) => path.join(hive, 'appfit', 'memory-setting-before.json');

/** The change "off" would make: { file, before, after, record }. Writes nothing. */
export function planOff({ settings, hive }) {
  const before = readSettings(settings);
  const after = { ...before, autoMemoryEnabled: false };
  const had = Object.prototype.hasOwnProperty.call(before, 'autoMemoryEnabled');
  return { file: settings, before, after, record: { had, value: had ? before.autoMemoryEnabled : null, at: new Date().toISOString() }, kind: 'off' };
}

/** The undo: the value from before "off" (or the key taken out if there was none). Writes nothing. */
export function planOn({ settings, hive }) {
  const before = readSettings(settings);
  let rec = null;
  try { rec = readJson(prevFile(hive)); } catch {}
  const after = { ...before };
  if (rec && rec.had) after.autoMemoryEnabled = rec.value; else delete after.autoMemoryEnabled;
  return { file: settings, before, after, record: null, kind: 'on' };
}

const stamp = () => { const d = new Date(), p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`; };

/** Write a plan: a dated copy of the old file first, then the new file, then the record for the undo. */
export function applyPlan(plan, { hive }) {
  if (fs.existsSync(plan.file)) fs.copyFileSync(plan.file, `${plan.file}.${stamp()}.bak`);
  fs.mkdirSync(path.dirname(plan.file), { recursive: true });
  fs.writeFileSync(plan.file, JSON.stringify(plan.after, null, 2) + '\n');
  if (plan.record) {
    const pf = prevFile(hive);
    if (!fs.existsSync(pf)) { fs.mkdirSync(path.dirname(pf), { recursive: true }); fs.writeFileSync(pf, JSON.stringify(plan.record, null, 2) + '\n'); }
  } else {
    try { fs.unlinkSync(prevFile(hive)); } catch {}
  }
}

function main(argv) {
  const opt = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
  const cmd = argv[0] || 'list';
  const claude = path.resolve(opt('--claude') || defaultClaude());
  const hive = path.resolve(opt('--hive') || defaultHive(claude));
  const settings = path.resolve(opt('--settings') || path.join(claude, 'settings.json'));
  if (cmd === 'list') {
    const p = pending({ claude, hive });
    if (!p.length) { console.log('Nothing to take in: every memory note is in the notebook, or there are none.'); return 0; }
    for (const f of p) console.log(`${tilde(f.abs)}  (${f.bytes} bytes)`);
    return 0;
  }
  if (cmd === 'notice') { const l = noticeLine({ claude, hive }); if (l) console.log(l); return 0; }
  if (cmd === 'mark') {
    const files = argv.slice(1).filter((a, i, all) => !a.startsWith('--') && !['--claude', '--hive', '--settings'].includes(all[i - 1]));
    const n = mark({ claude, hive, all: argv.includes('--all'), files });
    console.log(`Recorded ${n} file(s) as taken into the notebook.`);
    return 0;
  }
  if (cmd === 'status') { const s = status({ claude, settings }); console.log(`Auto memory is ${s.on ? 'on' : 'off'}: ${s.why}.`); return 0; }
  if (cmd === 'off' || cmd === 'on') {
    const apply = argv.includes('--apply');
    if (apply && isRealSettings(settings) && !argv.includes('--owner-said-yes')) {
      console.log('Refused: writing the real Claude settings file needs your yes. Run without --apply to see the change.');
      return 2;
    }
    let plan;
    try { plan = cmd === 'off' ? planOff({ settings, hive }) : planOn({ settings, hive }); } catch (e) { console.log(`Refused: ${e.message}`); return 1; }
    const show = (o) => (Object.prototype.hasOwnProperty.call(o, 'autoMemoryEnabled') ? `"autoMemoryEnabled": ${JSON.stringify(o.autoMemoryEnabled)}` : '"autoMemoryEnabled" not set');
    console.log(`${apply ? 'APPLY' : 'DRY RUN'} ${cmd}: ${tilde(plan.file)}: ${show(plan.before)} -> ${show(plan.after)}; every other setting kept.`);
    if (apply) { applyPlan(plan, { hive }); console.log('Written; a dated copy of the old file is beside it.'); }
    return 0;
  }
  console.log('Use: list | notice | mark --all | mark <file>... | status | off [--apply] | on [--apply]');
  return 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
