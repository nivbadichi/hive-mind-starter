#!/usr/bin/env node
// The Hive Mind installer, one program for Windows, Mac and Linux.
//   node core/install/install.mjs install        put Hive Mind into your Claude folder
//   node core/install/install.mjs uninstall      put everything back the way it was before the first install
//   node core/install/install.mjs remove-gates   take out only the gates (the start step stays, as one entry)
//   node core/install/install.mjs clear          after the plugin was removed: take out what Hive Mind wrote while it ran
// Options: --dry-run (only list what would change), --claude-dir <folder> (default ~/.claude),
//          --root <folder> (the notebook; default HIVE_ROOT, else the notebook this file sits in), --home <folder>.
// The front doors check for Node and Git first: core/gates/install.ps1 and uninstall.ps1 on Windows,
// core/install/install.sh on Mac and Linux.
//
// What it puts in place: the start step, the gates, the privacy check (in <Claude folder>/hive), the helpers (skills),
// the hook entries in settings.json (merged: your other settings stay), the Hive Mind block in CLAUDE.md (between its
// marker lines), the privacy save hook in the notebook (when it is a Git folder), and hive/config.json, which says
// where the notebook is.
// Safe to run again: a file that already matches is left alone. A file it replaces is kept first as <name>.bak-<date-time>.
// Every change is written down in hive/install-record.json BEFORE it is made, so a run that stopped halfway can be
// finished (run install again) or undone (run uninstall). Uninstall uses that record to put each file back.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { merge, unmerge } from '../gates/settings-merge.mjs';
import { configText, configPath } from './config.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RECORD = 'install-record.json';
const OURS = /hive[\\/]+start\.(ps1|mjs)|gates\.mjs/i;
const GATE = /gates\.mjs/i;
const MARK_RE = /<!-- hive-mind:start -->[\s\S]*?<!-- hive-mind:end -->/;

// ---------- small tools ----------
const norm = (s) => s.replace(/\r\n/g, '\n');
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const isText = (buf) => !buf.includes(0);
// The comparison the self-guard check makes too (core/checks/self-guard/lib.mjs, textSha): line ends made the same and a
// leading byte-order mark taken off. What is written is not changed by it.
const sameText = (s) => String(s).replace(/^﻿/, '').replace(/\r\n?/g, '\n');
const textSha = (buf) => sha(isText(buf) ? Buffer.from(sameText(buf.toString('utf8'))) : buf);
function readBuf(p) { try { return fs.readFileSync(p); } catch { return null; } }
function sameContent(a, b) {
  if (a === null || b === null) return false;
  if (isText(a) && isText(b)) return sameText(a.toString('utf8')) === sameText(b.toString('utf8'));
  return a.equals(b);
}
function isDir(p) { try { return fs.statSync(p).isDirectory(); } catch { return false; } }
function exists(p) { try { fs.lstatSync(p); return true; } catch { return false; } }
function walk(dir, base = dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, base, out); else if (e.isFile()) out.push(path.relative(base, p));
  }
  return out;
}
// ---------- what Hive Mind's own programs write in the Hive folder while they run ----------
// The one list the undo removes from (besides the files in the install record). Anything else in the Hive folder is
// the person's (or a helper's evidence, verify/) and is kept. Paths are relative to the Hive folder; * stays inside one
// folder. The writers, each checked against this list by install.test.mjs: core/gates/gates.mjs, core/start/start.mjs,
// core/factory/lib.mjs, core/engine/value.mjs, core/engine/handout.mjs, system/ends-check.mjs, system/publish-quiet.ps1.
export const RUNTIME = [
  'gates.log', 'gates.log.1', 'corrections.log', 'publish.log', 'publish.lock', 'publish-hold', 'ends.log',
  'factory.log', 'factory.log.1', 'gates-off', 'factory-off', 'gates-test.stamp', '*.hive-tmp-*',
  'gates/pull.stamp', 'gates/pull.lock', 'gates/rec/*.json', 'gates/chat/*.json', 'gates/chat/*.skills', 'gates/chat/*.writes',
  'gates/chat/*.helpers', 'gates/turn/*.json', 'gates/turn/*.events', 'gates/start/*.json', 'gates/blind/*.json', 'gates/refresh/*.json',
  'claims/*.json', 'gates/docker-images.jsonl',
  // The check modules' records (core/checks/_lib: the person's own words, their card answers, the lines of helper
  // reports, debts).
  'gates/chat/*.cards-seen', 'checks/*.json', 'checks/chat/*.json', 'checks/chat/*.reportlines', 'checks/chat/*.cards-seen', 'checks/chat/*.carry', 'checks/turn/*.events', 'checks/debts/*.json',
  'factory/*.lock', 'factory/tsconfig-*.json', 'factory/tsc-*.tsbuildinfo', 'factory/stop-*.json',
  // The daily watchdog, started by core/start/start.mjs: its day stamp, what it already told, what it saw, its hand-overs.
  'watchdog/last-run.txt', 'watchdog/*.json', 'watchdog/state/*.json', 'watchdog/out/*.md', 'watchdog-off',
];
// The folders those files live in: removed when the undo leaves them empty, never when something of yours is inside.
// Written by Hive Mind (the installer or the plugin) and kept on purpose when it is not in the install record:
// it says where the notebook is, so the other way in still finds the notes.
const KEPT_ON_PURPOSE = ['config.json'];
const RUNTIME_DIRS = ['gates/rec', 'gates/chat', 'gates/turn', 'gates/start', 'gates/blind', 'gates/refresh', 'gates', 'claims', 'factory', 'checks/chat', 'checks/turn', 'checks/debts', 'checks', 'watchdog/state', 'watchdog/out', 'watchdog'];
const RUNTIME_RE = RUNTIME.map((g) => new RegExp('^' + g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*') + '$', 'i'));
export const isRuntime = (rel) => RUNTIME_RE.some((re) => re.test(String(rel).split(path.sep).join('/')));

// What the undo (and clear) does in the Hive folder: the files it removes, the files it keeps, and the folders of its
// own to tidy. A file on the run-time list is Hive Mind's, whenever it was written and whichever way in wrote it (the
// installer's parts or the plugin); every other file is kept.
function hivePlan(c, rec) {
  const plan = { remove: [], keep: [], onPurpose: [], groups: [], ownDirs: RUNTIME_DIRS.map((d) => path.join(c.hive, ...d.split('/'))) };
  if (!isDir(c.hive)) return plan;
  const key = (f) => path.resolve(f).toLowerCase();
  const handled = new Set([path.join(c.hive, RECORD), ...Object.keys(rec.files), ...Object.values(rec.files).map((r) => r.before).filter((b) => b && b !== 'absent'), ...(rec.extraBackups || [])].map(key));
  const count = new Map();
  for (const rel of walk(c.hive)) {
    const f = path.join(c.hive, rel);
    if (handled.has(key(f))) continue;
    if (isRuntime(rel)) { plan.remove.push(f); const d = path.dirname(f); count.set(d, [...(count.get(d) || []), f]); }
    else if (KEPT_ON_PURPOSE.includes(rel.split(path.sep).join('/'))) plan.onPurpose.push(f);
    else plan.keep.push(f);
  }
  for (const [d, fs_] of count) { if (fs_.length === 1 || path.resolve(d) === path.resolve(c.hive)) for (const f of fs_) plan.groups.push([f, 1]); else plan.groups.push([d, fs_.length]); }
  return plan;
}
function which(cmd) {
  const exts = process.platform === 'win32' ? (process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';') : [''];
  for (const d of (process.env.PATH || '').split(path.delimiter)) {
    if (!d) continue;
    for (const x of exts) { const p = path.join(d.replace(/^"|"$/g, ''), cmd + x); try { if (fs.statSync(p).isFile()) return p; } catch {} }
  }
  return '';
}
function readJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8').replace(/^﻿/, '')); }
function stampNow() {
  const d = new Date(); const z = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}-${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}`;
}
function freeName(p) { if (!exists(p)) return p; for (let i = 2; ; i++) if (!exists(`${p}-${i}`)) return `${p}-${i}`; }
function writeAtomic(dst, buf, mode) {
  const tmp = `${dst}.hive-tmp-${process.pid}`;
  if (!mode) { try { mode = fs.statSync(dst).mode & 0o7777; } catch {} } // a replaced file keeps its permissions
  fs.writeFileSync(tmp, buf, mode ? { mode } : undefined);
  if (mode) { try { fs.chmodSync(tmp, mode); } catch {} }
  fs.renameSync(tmp, dst);
}
const mentions = (e, re) => (e.hooks || []).some((h) => re.test(String(h.command || '')) || (h.args || []).some((a) => re.test(String(a))));
// The settings with every Hive Mind hook entry taken out (and nothing else touched).
function withoutOurs(settings, re = OURS) {
  const s = JSON.parse(JSON.stringify(settings));
  if (!s.hooks || typeof s.hooks !== 'object') return s;
  for (const ev of Object.keys(s.hooks)) {
    if (!Array.isArray(s.hooks[ev])) continue;
    const had = s.hooks[ev].length;
    s.hooks[ev] = s.hooks[ev].filter((e) => !mentions(e, re));
    if (had && !s.hooks[ev].length) delete s.hooks[ev];
  }
  return s;
}
function stop(msg) { const e = new Error(msg); e.stopped = true; throw e; }

// ---------- options ----------
export function parseArgs(argv) {
  // No command at all prints the help and changes nothing (2026-11-20: a run meant to read the help made a real install).
  // A real install needs the word install; --dry-run alone lists what an install would change.
  const o = { cmd: '', dryRun: false };
  const rest = [...argv];
  if (rest.some((a) => ['--help', '-h', 'help', '/?'].includes(a))) return { cmd: 'help', dryRun: true };
  if (rest[0] && !rest[0].startsWith('--')) o.cmd = rest.shift();
  if (!o.cmd) { if (rest.includes('--dry-run')) o.cmd = 'install'; else return { cmd: 'help', dryRun: true }; }
  const keys = { '--claude-dir': 'claudeDir', '--root': 'root', '--home': 'home' };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--dry-run') o.dryRun = true;
    else if (keys[a]) { const v = rest[++i]; if (!v) stop(`STOPPED: ${a} needs a folder after it. Nothing was changed.`); o[keys[a]] = v.replace(/"+$/, ''); }
    else stop(`STOPPED: "${a}" is not something this installer knows. Use install, uninstall or remove-gates, with --dry-run, --claude-dir, --root or --home (--help lists them). Nothing was changed.`);
  }
  if (!['install', 'uninstall', 'remove-gates', 'clear'].includes(o.cmd)) stop(`STOPPED: "${o.cmd}" is not something this installer knows. Use install, uninstall, remove-gates or clear. Nothing was changed.`);
  return o;
}

function context(o) {
  const env = process.env;
  const platform = env.HIVE_INSTALL_PLATFORM || process.platform;
  const home = path.resolve(o.home || os.homedir());
  const claudeDir = path.resolve(o.claudeDir || path.join(home, '.claude'));
  const root = path.resolve(o.root || env.HIVE_ROOT || path.resolve(HERE, '..', '..'));
  const hive = path.join(claudeDir, 'hive');
  const stamp = stampNow();
  return { ...o, env, platform, isWin: platform === 'win32', home, claudeDir, root, hive, stamp, bakShown: o.dryRun ? '.bak-<date-time>' : `.bak-${stamp}` };
}

function preflight(c) {
  const major = Number(process.versions.node.split('.')[0]);
  if (major < 18) stop(`STOPPED: this Node is version ${process.versions.node}; Hive Mind needs version 18 or newer. Install the LTS version from nodejs.org, then run this again. Nothing was changed.`);
  if (typeof process.getuid === 'function' && process.getuid() === 0 && !c.env.HIVE_INSTALL_ALLOW_ROOT) stop('STOPPED: this was started as the administrator (root, for example with sudo). Run it as yourself, without sudo, so it changes your own Claude folder. Nothing was changed.');
  const real = path.resolve(os.homedir(), '.claude');
  if (c.env.HIVE_INSTALL_TEST && path.resolve(c.claudeDir).toLowerCase() === real.toLowerCase()) stop('STOPPED: a test run pointed at the real Claude folder. Nothing was changed.');
  if (exists(c.claudeDir) && !isDir(c.claudeDir)) stop(`STOPPED: ${c.claudeDir} is a file, not a folder. Nothing was changed.`);
}

// ---------- the record ----------
function loadRecord(c) {
  const p = path.join(c.hive, RECORD);
  if (!exists(p)) return null;
  try { return readJson(p); } catch { stop(`STOPPED: the install record ${p} cannot be read. Nothing was changed.`); }
}
function newRecord(c) { return { _about: 'What the Hive Mind installer changed, so uninstall can put it back. Do not edit.', version: 1, notebook: c.root, claudeDir: c.claudeDir, createdDirs: [], files: {}, extraBackups: [], settingsEntries: {} }; }
// The notebook was moved after the install: what the record says about files inside the notebook (the save hook and
// the copy kept before it) now lives under the new folder. Follow the move, so the undo still finds them.
function followMove(c, rec) {
  const from = rec.notebook && path.resolve(rec.notebook);
  const to = path.resolve(c.root);
  if (!from || from.toLowerCase() === to.toLowerCase() || exists(path.join(from, 'system', 'rules.md'))) return false;
  const moved = (p) => {
    if (typeof p !== 'string' || !(path.resolve(p).toLowerCase().startsWith(from.toLowerCase() + path.sep))) return p;
    const q = path.join(to, path.resolve(p).slice(from.length + 1));
    return !exists(p) && exists(q) ? q : p;
  };
  let changed = false;
  for (const [dst, r] of Object.entries(rec.files)) {
    const nd = moved(dst);
    const nb = r.before && r.before !== 'absent' ? moved(r.before) : r.before;
    if (nd !== dst || nb !== r.before) { delete rec.files[dst]; rec.files[nd] = { ...r, before: nb }; changed = true; }
  }
  rec.extraBackups = (rec.extraBackups || []).map((b) => { const n = moved(b); if (n !== b) changed = true; return n; });
  return changed;
}
function saveRecord(c, rec) { writeAtomic(path.join(c.hive, RECORD), Buffer.from(JSON.stringify(rec, null, 2) + '\n')); }

// ---------- install: what should be where ----------
function displayRoot(c) {
  const rel = path.relative(c.home, c.root);
  if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) return '~/' + rel.split(path.sep).join('/');
  return c.root.split(path.sep).join('/');
}

function adjustSnippet(c, snippet, notes) {
  const s = JSON.parse(JSON.stringify(snippet));
  delete s._about;
  const defaultHive = path.resolve(c.home, '.claude', 'hive');
  const starts = s.hooks.SessionStart || [];
  const kept = [];
  for (const entry of starts) {
    const hooks = entry.hooks || [];
    const ps1 = hooks.some((h) => /start\.ps1/i.test(String(h.command || '')));
    if (!ps1) { kept.push(entry); continue; }
    if (c.isWin) {
      if (path.resolve(c.hive).toLowerCase() !== defaultHive.toLowerCase()) {
        for (const h of hooks) h.command = String(h.command).replace(/\$HOME\\\.claude\\hive/g, () => c.hive);
      }
      kept.push(entry);
      continue;
    }
    // Mac and Linux: the PowerShell start step runs only through PowerShell 7 (pwsh).
    const pwsh = c.env.HIVE_INSTALL_PWSH !== undefined ? (c.env.HIVE_INSTALL_PWSH === 'none' ? '' : c.env.HIVE_INSTALL_PWSH) : which('pwsh');
    if (!pwsh) continue;
    for (const h of hooks) {
      const part = (String(h.command).match(/-Part\s+(\w+)/) || [])[1];
      h.command = `"${pwsh}" -NoProfile -File "${path.join(c.hive, 'start.ps1')}"` + (part ? ` -Part ${part}` : '');
      delete h.shell;
    }
    kept.push(entry);
  }
  if (starts.length && !kept.length) notes.push('The start step was not added: on this computer it needs PowerShell 7 (the command pwsh), or the Node start step, which this notebook does not have yet. The gates and the helpers are installed; the gates stay quiet until a chat has a Hive Mind start.');
  if (kept.length) s.hooks.SessionStart = kept; else delete s.hooks.SessionStart;
  return s;
}

function desired(c, notes) {
  const R = (...a) => path.join(c.root, ...a);
  const want = [];
  const file = (src, dst, opt = {}) => { const b = readBuf(src); if (b !== null) want.push({ dst, buf: isText(b) ? Buffer.from(norm(b.toString('utf8'))) : b, what: opt.what, mode: opt.mode }); };
  // 1. The scripts
  file(R('core', 'start', 'start.ps1'), path.join(c.hive, 'start.ps1'));
  if (isDir(R('core', 'start'))) for (const f of fs.readdirSync(R('core', 'start'))) if (f.endsWith('.mjs') && !f.endsWith('.test.mjs')) file(R('core', 'start', f), path.join(c.hive, f));
  file(R('core', 'gates', 'gates.mjs'), path.join(c.hive, 'gates', 'gates.mjs'));
  file(R('core', 'guard', 'privacy-guard.ps1'), path.join(c.hive, 'privacy-guard.ps1'));
  file(R('core', 'guard', 'privacy-guard.mjs'), path.join(c.hive, 'privacy-guard.mjs'));
  // 2. Where the notebook is
  want.push({ dst: configPath(c.hive), buf: Buffer.from(configText(c.root)), what: 'wrote where the notebook is into' });
  // 3. The helpers (skills), each folder whole
  if (isDir(R('core', 'skills'))) for (const d of fs.readdirSync(R('core', 'skills'), { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    for (const rel of walk(R('core', 'skills', d.name))) file(R('core', 'skills', d.name, rel), path.join(c.claudeDir, 'skills', d.name, rel));
  }
  // 4. settings.json: merge the hook entries
  const settingsFile = path.join(c.claudeDir, 'settings.json');
  let settings = {};
  if (exists(settingsFile)) {
    try { settings = readJson(settingsFile); } catch { stop(`STOPPED: ${settingsFile} is not valid JSON, so the hooks cannot be merged into it. Fix or move that file, then run this again. Nothing was changed.`); }
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) stop(`STOPPED: ${settingsFile} does not hold settings (an object). Nothing was changed.`);
  }
  // The Node form of the hooks (the start step and the gates in node) works on all three systems; it is used whenever
  // the notebook has it. The older PowerShell form is the fallback.
  const nodeForm = exists(R('core', 'start', 'settings-snippet.node.json')) && exists(R('core', 'start', 'start.mjs'));
  const snippetName = nodeForm ? 'settings-snippet.node.json' : 'settings-snippet.json';
  let snippet;
  try { snippet = readJson(R('core', 'start', snippetName)); } catch { stop(`STOPPED: the hook list core/start/${snippetName} is missing or broken in the notebook. Nothing was changed.`); }
  // Take out every earlier Hive Mind entry first (start.ps1, start.mjs, gates.mjs), so a second install adds no copies.
  const clean = withoutOurs(settings);
  const merged = merge(clean, adjustSnippet(c, snippet, notes), process.execPath, c.hive);
  const base = unmerge(clean, false);
  const added = {};
  for (const ev of Object.keys(merged.hooks || {})) {
    const n = (base.hooks[ev] || []).length;
    const extra = merged.hooks[ev].slice(n);
    if (extra.length) added[ev] = extra;
  }
  want.push({ dst: settingsFile, buf: Buffer.from(JSON.stringify(merged, null, 2) + '\n'), what: 'merged the hooks into', settingsEntries: added });
  // 5. The Hive Mind block in CLAUDE.md
  const cm = path.join(c.claudeDir, 'CLAUDE.md');
  const srcBlock = readBuf(R('core', 'claude-md.md'));
  if (srcBlock !== null) {
    let block = norm(srcBlock.toString('utf8')).trim();
    const shown = displayRoot(c);
    if (shown !== '~/hive-mind') block = block.split('~/hive-mind').join(shown);
    const cur = readBuf(cm);
    let text, what;
    if (cur !== null) {
      const t = cur.toString('utf8');
      const nl = t.includes('\r\n') ? '\r\n' : '\n';
      const b = `<!-- hive-mind:start -->${nl}${block.replace(/\n/g, nl)}${nl}<!-- hive-mind:end -->`;
      if (MARK_RE.test(t)) { text = t.replace(MARK_RE, () => b); what = 'updated the Hive Mind block in'; }
      else { const sep = !t ? '' : t.endsWith('\n') ? nl : nl + nl; text = t + sep + b + nl; what = 'added the Hive Mind block at the end of'; }
      want.push({ dst: cm, buf: Buffer.from(text), what, raw: true });
    } else {
      want.push({ dst: cm, buf: Buffer.from(`<!-- hive-mind:start -->\n${block}\n<!-- hive-mind:end -->\n`), what: 'wrote the Hive Mind block into' });
    }
  }
  // 6. The save hook in the notebook (only when it is a Git folder)
  const hooksDir = R('.git', 'hooks');
  if (isDir(hooksDir)) file(R('core', 'guard', 'pre-commit'), path.join(hooksDir, 'pre-commit'), { mode: 0o755 });
  return want;
}

function missingDirs(dir) {
  const out = [];
  let d = dir;
  while (!exists(d)) { out.push(d); const up = path.dirname(d); if (up === d) break; d = up; }
  return out; // deepest first
}

function install(c) {
  if (!exists(path.join(c.root, 'system', 'rules.md'))) stop(`STOPPED: the notebook was not found at ${c.root} (its file system/rules.md is missing). Run this from inside your notebook, or give its folder with --root. Nothing was changed.`);
  const notes = [];
  const want = desired(c, notes);
  const changes = [];
  const todo = [];
  for (const w of want) {
    const cur = readBuf(w.dst);
    if (cur !== null && (w.raw ? cur.equals(w.buf) : sameContent(cur, w.buf))) {
      if (w.mode && process.platform !== 'win32') { try { if ((fs.statSync(w.dst).mode & 0o111) === 0) todo.push({ ...w, chmodOnly: true }); } catch {} }
      continue;
    }
    todo.push({ ...w, existed: cur !== null });
    const what = w.what || (cur !== null ? 'replaced' : 'added');
    changes.push(cur !== null ? `${what} ${w.dst} (old copy kept as ${path.basename(w.dst)}${c.bakShown})` : `${what} ${w.dst}${w.what ? ' (new file)' : ''}`);
  }
  const crashAfter = Number(c.env.HIVE_INSTALL_CRASH_AFTER || 0);
  if (!c.dryRun && todo.length) {
    const rec = loadRecord(c) || newRecord(c);
    followMove(c, rec);
    rec.notebook = c.root;
    const ensureDir = (d) => { for (const m of missingDirs(d).reverse()) { fs.mkdirSync(m); if (!rec.createdDirs.includes(m)) rec.createdDirs.push(m); } };
    ensureDir(c.hive);
    saveRecord(c, rec);
    let done = 0;
    for (const w of todo) {
      if (w.chmodOnly) { fs.chmodSync(w.dst, w.mode); continue; }
      ensureDir(path.dirname(w.dst));
      const r = rec.files[w.dst];
      if (w.existed) {
        const bak = freeName(`${w.dst}.bak-${c.stamp}`);
        fs.copyFileSync(w.dst, bak);
        if (!r) rec.files[w.dst] = { before: bak };
        else rec.extraBackups.push(bak);
      } else if (!r) rec.files[w.dst] = { before: 'absent' };
      if (w.settingsEntries) rec.settingsEntries = w.settingsEntries;
      const f = rec.files[w.dst];
      if (f.wrote) f.prev = f.wrote;
      f.wrote = sha(w.buf);
      f.wroteText = textSha(w.buf); // what the self-guard check compares: the text with line ends made the same
      saveRecord(c, rec);                     // written down first, then changed
      writeAtomic(w.dst, w.buf, w.mode);
      if (crashAfter && ++done >= crashAfter) { process.stdout.write(`(test) stopped on purpose after ${done} changes\n`); process.exit(3); }
    }
  }
  const out = [];
  if (!changes.length) out.push('Nothing to change: everything already matches the notebook.');
  else { out.push(c.dryRun ? 'Would change:' : 'Changed:'); for (const x of changes) out.push(`- ${x}`); }
  if (pluginOn(c)) notes.push(BOTH_WAYS(c));
  for (const n of notes) out.push(n);
  out.push(`The notebook: ${c.root}`);
  out.push(`Switch every gate off: create the empty file ${path.join(c.hive, 'gates-off')}. Delete it to switch them on again.`);
  out.push(c.isWin ? 'To undo all of it: powershell -NoProfile -ExecutionPolicy Bypass -File core\\gates\\uninstall.ps1 -All' : 'To undo all of it: sh core/install/install.sh uninstall');
  return out;
}

// ---------- uninstall: put it all back ----------
function sameJson(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function cleanSettings(cur, rec) {
  const s = withoutOurs(cur);
  const ours = Object.values(rec.settingsEntries || {}).flat().map((e) => JSON.stringify(e));
  for (const ev of Object.keys(s.hooks || {})) {
    if (!Array.isArray(s.hooks[ev])) continue;
    s.hooks[ev] = s.hooks[ev].filter((e) => !ours.includes(JSON.stringify(e)));
    if (!s.hooks[ev].length) delete s.hooks[ev];
  }
  if (s.hooks && !Object.keys(s.hooks).length) delete s.hooks;
  return s;
}

function uninstall(c) {
  const rec = loadRecord(c);
  if (!rec) return [`Nothing to undo: no install record was found in ${c.hive}. If Hive Mind was put in by an older installer, take the gates out with remove-gates (on Windows: core\\gates\\uninstall.ps1).`];
  followMove(c, rec); // a move without a second install: the save hook is found in the notebook's new place
  const act = [];
  const kept = [];
  const leftAlone = [];
  const D = c.dryRun;
  const say = (s) => act.push(s);
  const settingsFile = path.join(rec.claudeDir || c.claudeDir, 'settings.json');
  const cmFile = path.join(rec.claudeDir || c.claudeDir, 'CLAUDE.md');
  for (const [dst, r] of Object.entries(rec.files)) {
    const cur = readBuf(dst);
    const hasBak = r.before && r.before !== 'absent' && exists(r.before);
    const beforeBuf = hasBak ? readBuf(r.before) : null;
    const putBack = () => {
      if (hasBak) { if (!D) fs.renameSync(r.before, dst); say(`put back ${dst} as it was before`); }
      else if (cur !== null) { if (!D) fs.rmSync(dst, { force: true }); say(`removed ${dst}`); }
    };
    if (cur === null) { if (hasBak) putBack(); continue; }
    // Ours when it holds what the install wrote (this run or the one before, in case a run stopped halfway),
    // or still what was there before (a run that stopped before writing it).
    const h = sha(cur);
    const unchanged = h === r.wrote || h === r.prev || (!!r.wroteText && textSha(cur) === r.wroteText) || (beforeBuf ? cur.equals(beforeBuf) : false);
    if (unchanged) { putBack(); continue; }
    // Changed since the install (by you or by Claude): take out only Hive Mind's part and keep the rest.
    if (path.resolve(dst) === path.resolve(settingsFile)) {
      let curJson; try { curJson = readJson(dst); } catch { curJson = null; }
      if (curJson) {
        const cleaned = cleanSettings(curJson, rec);
        let beforeJson = null; if (beforeBuf) { try { beforeJson = JSON.parse(beforeBuf.toString('utf8').replace(/^﻿/, '')); } catch {} }
        if ((beforeJson && sameJson(cleaned, beforeJson)) || (!hasBak && !Object.keys(cleaned).length)) { putBack(); continue; }
        if (!D) writeAtomic(dst, Buffer.from(JSON.stringify(cleaned, null, 2) + '\n'));
        say(`took the Hive Mind hooks out of ${dst}; your other changes since the install stay`);
        if (hasBak) kept.push(r.before);
        continue;
      }
    }
    if (path.resolve(dst) === path.resolve(cmFile)) {
      const t = cur.toString('utf8');
      const cleaned = t.replace(/(\r?\n){0,2}<!-- hive-mind:start -->[\s\S]*?<!-- hive-mind:end -->\r?\n?/, '');
      if ((beforeBuf && norm(cleaned) === norm(beforeBuf.toString('utf8'))) || (!hasBak && !cleaned.trim())) { putBack(); continue; }
      if (!D) writeAtomic(dst, Buffer.from(cleaned));
      say(`took the Hive Mind block out of ${dst}; your other lines stay`);
      if (hasBak) kept.push(r.before);
      continue;
    }
    say(`left ${dst} as it is: it was changed after the install`);
    leftAlone.push(dst);
    if (hasBak) kept.push(r.before);
  }
  for (const b of rec.extraBackups || []) if (exists(b)) { if (!D) fs.rmSync(b, { force: true }); say(`removed the in-between copy ${b}`); }
  // The Hive folder: the same plan serves the dry run and the real run. It removes only what Hive Mind's programs are
  // known to write there (RUNTIME), by either way in, and keeps and names every other file, whatever its name, type or
  // depth: yours, or a helper's evidence (verify/).
  const plan = hivePlan(c, rec);   // made before the record is removed, so the record is never counted as yours
  if (!D) fs.rmSync(path.join(c.hive, RECORD), { force: true });
  sweep(plan, D, say);
  const dirs = [...(rec.createdDirs || [])].sort((a, b) => b.length - a.length);
  for (const d of dirs) {
    if (!isDir(d)) continue;
    if (D) {
      const goes = new Set([...plan.remove, ...Object.keys(rec.files), path.join(c.hive, RECORD)].map((f) => path.resolve(f).toLowerCase()));
      if (walk(d).every((f) => goes.has(path.resolve(d, f).toLowerCase()))) say(`removed the empty folder ${d}`);
      continue;
    }
    try { fs.rmdirSync(d); say(`removed the empty folder ${d}`); } catch { /* not empty: something of yours is in it */ }
  }
  const out = [];
  out.push(act.length ? (D ? 'Would change:' : 'Changed:') : 'Nothing to undo.');
  for (const a of act) out.push(`- ${a}`);
  if (kept.length) { out.push('Kept, because the file was changed after the install (the copy from before the install is here, if you want it):'); for (const k of kept) out.push(`- ${k}`); }
  const notLeft = (f) => !leftAlone.some((l) => path.resolve(l) === path.resolve(f));
  sayYours(out, plan.keep.filter(notLeft), plan.onPurpose.filter(notLeft));
  return out;
}

// Remove what the plan names, say it, and tidy Hive Mind's own folders when they are left empty.
function sweep(plan, D, say) {
  for (const f of plan.remove) if (!D) fs.rmSync(f, { force: true });
  for (const [where, n] of plan.groups) say(n === 1 ? `removed ${where} (written by Hive Mind while it ran)` : `removed ${n} files in ${where} (written by Hive Mind while it ran: logs, per-chat records)`);
  if (!D) for (const d of [...plan.ownDirs].sort((a, b) => b.length - a.length)) { try { fs.rmdirSync(d); } catch { /* not empty: something of yours is in it */ } }
}
function sayYours(out, yours, onPurpose = []) {
  if (yours.length) {
    out.push('Yours, kept: Hive Mind did not write these files, so they stay (delete them yourself only if you no longer want them):');
    for (const k of yours) out.push(`- ${k}${/[\\/]verify[\\/]/i.test(k) ? ' (evidence of a check)' : ''}`);
  }
  if (onPurpose.length) {
    out.push('Kept on purpose: Hive Mind wrote this file. It says where your notebook is, so the other way in (the plugin, or setting the parts up again) still finds your notes. Delete it only if you use neither:');
    for (const k of onPurpose) out.push(`- ${k}`);
  }
}

// The Hive Mind plugin switched on in Claude's settings (Claude Code writes enabledPlugins when it is added).
function pluginOn(c) {
  try { const s = readJson(path.join(c.claudeDir, 'settings.json')); return Object.entries(s.enabledPlugins || {}).some(([k, v]) => /^hive-mind@/i.test(k) && v); } catch { return false; }
}
const BOTH_WAYS = (c) => 'The Hive Mind plugin is also switched on here, so every helper is now there twice (once from the plugin, once from these parts; the plugin\'s start and checks stand down). Keep one way. To keep these parts, remove the plugin: claude plugin uninstall hive-mind@hive-mind (or type /plugin, open Installed, pick hive-mind, Uninstall). To keep the plugin, take these parts out: ' + (c.isWin ? 'powershell -NoProfile -ExecutionPolicy Bypass -File core\\gates\\uninstall.ps1 -All' : 'node core/install/install.mjs uninstall') + '.';

// ---------- clear: what Hive Mind wrote while it ran, after the plugin was removed ----------
function clear(c) {
  if (exists(path.join(c.hive, RECORD))) stop('STOPPED: the parts from the installer are still in place, and they use these files. To take everything out, run uninstall instead (node core/install/install.mjs uninstall --dry-run first). Nothing was changed.');
  if (pluginOn(c)) stop('STOPPED: the Hive Mind plugin is still switched on, and it uses these files. Remove the plugin first (claude plugin uninstall hive-mind@hive-mind), then run this again. Nothing was changed.');
  const plan = hivePlan(c, { files: {}, extraBackups: [] });
  const act = [];
  sweep(plan, c.dryRun, (s) => act.push(s));
  const out = [act.length ? (c.dryRun ? 'Would change:' : 'Changed:') : 'Nothing to clear: Hive Mind left no files of its own here.'];
  for (const a of act) out.push(`- ${a}`);
  sayYours(out, plan.keep, plan.onPurpose);
  return out;
}

// ---------- remove only the gates ----------
function removeGates(c) {
  const rec = loadRecord(c);
  const changes = [];
  const settingsFile = path.join(c.claudeDir, 'settings.json');
  if (exists(settingsFile)) {
    let s; try { s = readJson(settingsFile); } catch { stop(`STOPPED: ${settingsFile} is not valid JSON. Nothing was changed. Remove the gate entries by hand (every entry that names gates.mjs).`); }
    // Windows: the start step goes back to one entry (the thin start.ps1, "all" part), as before. Mac and Linux:
    // only the gate entries go; the start entries stay as they are.
    const next = c.isWin ? unmerge(withoutOurs(s, /hive[\\/]+start\.mjs/i), true) : withoutOurs(s, GATE);
    const buf = Buffer.from(JSON.stringify(next, null, 2) + '\n');
    if (!sameContent(readBuf(settingsFile), buf)) {
      if (!c.dryRun) {
        const bak = freeName(`${settingsFile}.bak-${c.stamp}`);
        fs.copyFileSync(settingsFile, bak);
        if (rec) { rec.extraBackups.push(bak); saveRecord(c, rec); }
        writeAtomic(settingsFile, buf);
        if (rec && rec.files[settingsFile]) { rec.files[settingsFile].wrote = sha(buf); rec.files[settingsFile].wroteText = textSha(buf); saveRecord(c, rec); }
      }
      changes.push(`removed the gate hooks from ${settingsFile}; the start step ${c.isWin ? 'is one entry again' : 'stays'} (old copy kept as settings.json${c.bakShown})`);
    }
  }
  for (const f of [path.join(c.hive, 'gates', 'gates.mjs'), path.join(c.claudeDir, 'skills', 'hive-gates', 'SKILL.md')]) {
    if (!exists(f)) continue;
    if (!c.dryRun) {
      const bak = freeName(`${f}.bak-${c.stamp}`);
      if (rec) { rec.extraBackups.push(bak); saveRecord(c, rec); }
      fs.renameSync(f, bak);
    }
    changes.push(`set aside ${f} as ${path.basename(f)}${c.bakShown}`);
  }
  if (!changes.length) return ['Nothing to remove: the gates are not installed here.'];
  return [c.dryRun ? 'Would change:' : 'Changed:', ...changes.map((x) => `- ${x}`)];
}

// ---------- help ----------
export const HELP = [
  'The Hive Mind installer. It changes nothing when asked for this help, or when it is started with no command.',
  '  node core/install/install.mjs install        put Hive Mind into your Claude folder',
  '  node core/install/install.mjs uninstall      put everything back the way it was before the first install',
  '  node core/install/install.mjs remove-gates   take out only the gates (the start step stays)',
  '  node core/install/install.mjs clear          after the plugin was removed: take out the files Hive Mind wrote',
  '                                               while it ran (logs, per-chat records); your own files stay',
  'Options:',
  '  --dry-run              only list what would change; nothing is written',
  '  --root <folder>        the notebook (default: HIVE_ROOT, else the notebook this installer sits in)',
  '  --claude-dir <folder>  Claude\'s folder (default: .claude in your home folder)',
  '  --home <folder>        a made-up home folder, for test copies only',
  '  --help                 this list',
  'On Windows the same program runs through core\\gates\\install.ps1 and core\\gates\\uninstall.ps1 (-All for uninstall);',
  'on Mac and Linux through core/install/install.sh.',
];

// ---------- main ----------
export function run(argv) {
  const o = parseArgs(argv);
  if (o.cmd === 'help') return HELP;
  const c = context(o);
  preflight(c);
  if (o.cmd === 'install') return install(c);
  if (o.cmd === 'uninstall') return uninstall(c);
  if (o.cmd === 'clear') return clear(c);
  return removeGates(c);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.stdout.write(run(process.argv.slice(2)).join('\n') + '\n');
    process.exit(0);
  } catch (e) {
    if (e.stopped) { process.stdout.write(e.message + '\n'); process.exit(1); }
    process.stdout.write(`STOPPED partway: ${e.message}\nWhat was done so far is written down in the install record; run the same command again to finish it, or run uninstall to put everything back.\n`);
    process.exit(2);
  }
}
