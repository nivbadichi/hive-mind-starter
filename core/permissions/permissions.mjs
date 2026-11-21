// Hive Mind's entries in Claude Code's own permission lists (ask and deny), merged into a settings file and taken out
// again cleanly. The app itself then asks the person before a publish, a delete, a spend, an install or a change to the
// checks, in every permission mode; see entries.json for the list and the pages it was written from.
//
//   node permissions.mjs show                        print the entries this machine would get
//   node permissions.mjs merge  <settings.json> [--dry-run]
//   node permissions.mjs remove <settings.json> [--dry-run]
//   node permissions.mjs check  <settings.json>      say which entries are missing (exit 1 when any is)
// Options: --root <notebook> --hive <Hive folder> --home <home folder> --record <file> --entries <file>
//
// What was added is written to a record (default <Hive folder>/permissions-record.json). Removal takes out only what the
// record names, so an entry the person had before is never touched, and lists or a "permissions" block that the merge
// created are taken out again when they end up empty. A file that is not valid JSON is never changed.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(HERE, '..', '..');
const LISTS = ['ask', 'deny'];

// ---------- paths ----------
const posix = (p) => {
  let s = path.resolve(p).replace(/\\/g, '/');
  const m = /^([A-Za-z]):\/?(.*)$/.exec(s);
  if (m) s = `/${m[1].toLowerCase()}/${m[2]}`;
  return s.replace(/\/+$/, '') || '/';
};
// A folder written the way permission rules want it: ~/... when it is inside the home folder, else //c/... (the docs:
// a single leading slash anchors at the settings file, // is the filesystem root, Windows paths become /c/...).
export function rulePath(abs, home) {
  const a = posix(abs), h = posix(home);
  const same = process.platform === 'win32' || /^\/[a-z]\//.test(h) ? a.toLowerCase().startsWith(h.toLowerCase() + '/') : a.startsWith(h + '/');
  if (same) return '~/' + a.slice(h.length + 1);
  if (a.toLowerCase() === h.toLowerCase()) return '~';
  return '/' + a;
}

// ---------- the entries ----------
export function readEntries(file = path.join(HERE, 'entries.json')) {
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
}
// The exact strings, per list, in order, without doubles.
export function build({ root = DEFAULT_ROOT, home = os.homedir(), hive, entries } = {}) {
  entries = entries || readEntries();
  hive = hive || path.join(home, '.claude', 'hive');
  const R = rulePath(root, home), H = rulePath(hive, home);
  const fill = (s) => s.split('__ROOT__').join(R).split('__HIVE__').join(H);
  const out = { ask: [], deny: [] };
  for (const g of entries.groups || []) {
    if (!LISTS.includes(g.list)) throw new Error(`entries: group "${g.act}" has list "${g.list}" (ask or deny)`);
    const rules = [];
    for (const s of g.shell || []) rules.push(`Bash(${fill(s)})`, `PowerShell(${fill(s)})`);
    for (const s of g.edit || []) rules.push(`Edit(${fill(s)})`);
    for (const t of g.tools || []) rules.push(fill(t));
    for (const p of g.params || []) rules.push(fill(p));
    for (const r of rules) if (!out[g.list].includes(r)) out[g.list].push(r);
  }
  // A rule in deny needs no copy in ask.
  out.ask = out.ask.filter((r) => !out.deny.includes(r));
  return out;
}

// ---------- merge and remove (pure: they never touch a file) ----------
const clone = (v) => JSON.parse(JSON.stringify(v));
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

export function emptyRecord() { return { version: 1, added: { ask: [], deny: [] }, created: [] }; }

// settings: the parsed file. wanted: { ask: [...], deny: [...] }. prior: an earlier record (so a second merge adds no
// copies and the record keeps everything this program put there). Returns { settings, record, changed, added }.
export function merge(settings, wanted, prior) {
  if (!isObj(settings)) throw new Error('the settings are not an object');
  const s = clone(settings);
  const rec = prior ? clone(prior) : emptyRecord();
  rec.added = rec.added || { ask: [], deny: [] };
  rec.created = rec.created || [];
  const added = { ask: [], deny: [] };
  for (const list of LISTS) {
    const want = (wanted[list] || []);
    if (!want.length) continue;
    if (s.permissions !== undefined && !isObj(s.permissions)) throw new Error('"permissions" in the settings is not an object');
    if (s.permissions === undefined) { s.permissions = {}; if (!rec.created.includes('permissions')) rec.created.push('permissions'); }
    if (s.permissions[list] !== undefined && !Array.isArray(s.permissions[list])) throw new Error(`"permissions.${list}" in the settings is not a list`);
    if (s.permissions[list] === undefined) { s.permissions[list] = []; if (!rec.created.includes(`permissions.${list}`)) rec.created.push(`permissions.${list}`); }
    for (const r of want) {
      if (s.permissions[list].includes(r)) continue;
      s.permissions[list].push(r);
      added[list].push(r);
      if (!rec.added[list].includes(r)) rec.added[list].push(r);
    }
  }
  return { settings: s, record: rec, changed: added.ask.length + added.deny.length > 0 || JSON.stringify(s) !== JSON.stringify(settings), added };
}

// Takes out exactly what the record says this program added (the last copy of each, the one it appended), and the
// containers it created once they are empty. Returns { settings, removed, changed }.
export function remove(settings, record) {
  if (!isObj(settings)) throw new Error('the settings are not an object');
  const s = clone(settings);
  const removed = { ask: [], deny: [] };
  if (!record || !isObj(s.permissions)) return { settings: s, removed, changed: false };
  for (const list of LISTS) {
    const arr = s.permissions[list];
    if (!Array.isArray(arr)) continue;
    for (const r of (record.added && record.added[list]) || []) {
      const i = arr.lastIndexOf(r);
      if (i >= 0) { arr.splice(i, 1); removed[list].push(r); }
    }
    if (!arr.length && (record.created || []).includes(`permissions.${list}`)) delete s.permissions[list];
  }
  if (isObj(s.permissions) && !Object.keys(s.permissions).length && (record.created || []).includes('permissions')) delete s.permissions;
  return { settings: s, removed, changed: JSON.stringify(s) !== JSON.stringify(settings) };
}

// Which wanted entries the settings do not hold (in the list they belong to, or in deny, which is stronger).
export function missing(settings, wanted) {
  const p = isObj(settings) && isObj(settings.permissions) ? settings.permissions : {};
  const has = (list, r) => Array.isArray(p[list]) && p[list].includes(r);
  return { ask: (wanted.ask || []).filter((r) => !has('ask', r) && !has('deny', r)), deny: (wanted.deny || []).filter((r) => !has('deny', r)) };
}

// For the installer: one call that merges into settings it already holds and gives back what to keep in its record.
export function apply(settings, { root, home, hive, prior } = {}) {
  return merge(settings, build({ root, home, hive }), prior);
}

// ---------- files ----------
function readSettingsFile(file) {
  if (!fs.existsSync(file)) return { exists: false, data: {}, bom: '', eol: '\n' };
  const raw = fs.readFileSync(file, 'utf8');
  const bom = raw.startsWith('﻿') ? '﻿' : '';
  const text = raw.slice(bom.length);
  let data;
  try { data = text.trim() ? JSON.parse(text) : {}; } catch (e) { throw new Error(`${file} is not valid JSON (${e.message}). Nothing was changed.`); }
  if (!isObj(data)) throw new Error(`${file} does not hold settings (an object). Nothing was changed.`);
  return { exists: true, data, bom, eol: /\r\n/.test(text) ? '\r\n' : '\n' };
}
function readSettingsText(raw) {
  const text = raw.replace(/^﻿/, '');
  return text.trim() ? JSON.parse(text) : {};
}
function render(data, bom, eol) { return bom + (JSON.stringify(data, null, 2) + '\n').replace(/\n/g, eol); }
function writeAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}
function readRecord(file) {
  if (!fs.existsSync(file)) return null;
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { throw new Error(`the record ${file} cannot be read. Nothing was changed.`); }
}

export function run(argv, out = (s) => process.stdout.write(s + '\n')) {
  const args = [...argv];
  const cmd = args.shift();
  const opt = {}; const pos = [];
  while (args.length) {
    const a = args.shift();
    if (a === '--dry-run') opt.dry = true;
    else if (/^--(root|hive|home|record|entries)$/.test(a)) opt[a.slice(2)] = args.shift();
    else pos.push(a);
  }
  const home = opt.home || os.homedir();
  const hive = opt.hive || path.join(home, '.claude', 'hive');
  const record = opt.record || path.join(hive, 'permissions-record.json');
  const wanted = build({ root: opt.root || DEFAULT_ROOT, home, hive, entries: opt.entries ? readEntries(opt.entries) : undefined });
  const n = (o) => o.ask.length + o.deny.length;
  if (cmd === 'show') { out(JSON.stringify(wanted, null, 2)); return 0; }
  const file = pos[0];
  if (!file || !['merge', 'remove', 'check'].includes(cmd)) {
    out('Use: node permissions.mjs show | merge <settings.json> [--dry-run] | remove <settings.json> [--dry-run] | check <settings.json>');
    return 2;
  }
  const cur = readSettingsFile(file);
  // A record names the file it was made for; it is never used on another one (it could take out that file's own entries).
  const recordFor = (rec) => {
    if (rec && rec.settingsFile && path.resolve(rec.settingsFile).toLowerCase() !== path.resolve(file).toLowerCase()) {
      throw new Error(`the record ${record} belongs to ${rec.settingsFile}, not ${path.resolve(file)}. Pass --record <another file>. Nothing was changed.`);
    }
    return rec;
  };
  if (cmd === 'check') {
    const m = missing(cur.data, wanted);
    if (!n(m)) { out(`All ${n(wanted)} of Hive Mind's permission entries are in ${file}.`); return 0; }
    out(`${n(m)} of Hive Mind's ${n(wanted)} permission entries are missing from ${file}:`);
    for (const l of LISTS) for (const r of m[l]) out(`  ${l}: ${r}`);
    return 1;
  }
  if (cmd === 'merge') {
    const prior = recordFor(readRecord(record));
    const r = merge(cur.data, wanted, prior);
    if (opt.dry) {
      out(`Dry run: would add ${n(r.added)} entries to ${file} (${r.added.ask.length} ask, ${r.added.deny.length} deny). Nothing was changed.`);
      for (const l of LISTS) for (const x of r.added[l]) out(`  ${l}: ${x}`);
      return 0;
    }
    if (!n(r.added)) { out(`Nothing to add: every entry is already in ${file}.`); return 0; }
    // The exact bytes from before the first merge, so removal can give back the very same file (same hash) when nothing
    // else in it changed meanwhile, whatever its layout. Kept next to the record, never overwritten by a later merge.
    const before = `${record}.before`;
    if (!prior && cur.exists && !fs.existsSync(before)) writeAtomic(before, fs.readFileSync(file));
    // The record first, so a stop halfway can still be undone.
    writeAtomic(record,JSON.stringify({ _about: 'What Hive Mind added to the permission lists, so removal takes out only that. Do not edit.', settingsFile: path.resolve(file), ...r.record }, null, 2) + '\n');
    writeAtomic(file, render(r.settings, cur.bom, cur.eol));
    out(`Added ${n(r.added)} entries to ${file} (${r.added.ask.length} ask, ${r.added.deny.length} deny). What was added is written down in ${record}.`);
    return 0;
  }
  // remove
  const rec = recordFor(readRecord(record));
  if (!rec) { out(`Nothing to remove: no record at ${record}, so nothing in ${file} is known to be Hive Mind's. Nothing was changed.`); return 0; }
  const r = remove(cur.data, rec);
  if (opt.dry) {
    out(`Dry run: would take ${n(r.removed)} entries out of ${file}. Nothing was changed.`);
    for (const l of LISTS) for (const x of r.removed[l]) out(`  ${l}: ${x}`);
    return 0;
  }
  const beforeFile = `${record}.before`;
  let orig = null;
  if (fs.existsSync(beforeFile)) {
    const raw = fs.readFileSync(beforeFile);
    try { if (JSON.stringify(readSettingsText(raw.toString('utf8'))) === JSON.stringify(r.settings)) orig = raw; } catch { /* not usable: write the plain result */ }
  }
  if (cur.exists && orig) writeAtomic(file, orig);
  else if (r.changed && cur.exists) writeAtomic(file, render(r.settings, cur.bom, cur.eol));
  fs.rmSync(record, { force: true });
  fs.rmSync(beforeFile, { force: true });
  out(`Took ${n(r.removed)} entries out of ${file}; the record is removed.`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = run(process.argv.slice(2)); }
  catch (e) { process.stdout.write(`STOPPED: ${e.message}\n`); process.exitCode = 1; }
}
