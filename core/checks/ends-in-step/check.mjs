// Ends in step (rule 15): every place that carries the same thing agrees.
// Before a save: a save that changes a file on the list of ends while its other end is ALREADY out of step is refused,
// with each end named (a save that brings the ends into step is never refused).
// At the end of a reply: an end this chat touched that is still out of step is a debt.
// The list of ends is system/ends.json (the same list system/ends-check.mjs reads). The full ends program is slow, so it
// runs in the background and its result is cached; this check never waits for it.
// Contract: system/design/enforcement-2026-11-20.md.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
let DEFAULTS = {};
try { DEFAULTS = JSON.parse(fs.readFileSync(path.join(HERE, 'settings.json'), 'utf8')); } catch { DEFAULTS = {}; }

const WRITE_TOOLS = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit'];
const SHELL_TOOLS = ['Bash', 'PowerShell'];
const WIN = process.platform === 'win32';

function conf(ctx) { return { ...DEFAULTS, ...((ctx && ctx.settings) || {}) }; }
const slash = (p) => String(p || '').replace(/\\/g, '/');
const low = (s) => (WIN ? String(s).toLowerCase() : String(s));
const norm = (t) => (t == null ? null : String(t).replace(/\r\n/g, '\n'));
function readAbs(abs) { try { return fs.readFileSync(abs, 'utf8'); } catch { return null; } }

// ---------- the list of ends ----------
export function loadEnds(root, c) {
  const raw = readAbs(path.join(root, c.endsFile || 'system/ends.json'));
  if (raw == null) return null;
  return JSON.parse(raw.replace(/^﻿/, ''));
}
// The file a step writes, relative to the notebook, or '' when it is outside it.
function relIn(root, abs) {
  const r = slash(path.relative(root, abs));
  return !r || r.startsWith('../') || r === '..' || path.isAbsolute(r) ? '' : r;
}

// Every pair of ends a file belongs to. A pair: { type, main, copy, words? } (paths relative to the notebook).
//   identical: the two files must be the same, byte for byte (line endings aside).
//   mention:   the copy's file must carry each of these words.
//   entry:     a folder entry of the main system must also exist in the copy.
export function pairsFor(rel, ends, c) {
  const copy = ends && ends.copy;
  if (!copy || !copy.folder) return [];
  const folder = slash(copy.folder).replace(/\/$/, '');
  const r = slash(rel);
  const onCopy = low(r).startsWith(low(folder) + '/');
  const base = onCopy ? r.slice(folder.length + 1) : r;
  const lb = low(base);
  const out = [];
  for (const f of copy.identical || []) if (low(f) === lb) out.push({ type: 'identical', main: f, copy: `${folder}/${f}` });
  for (const m of copy.mustMention || []) if (low(m.file) === lb) out.push({ type: 'mention', main: m.file, copy: `${folder}/${m.file}`, words: m.words || [] });
  if (!out.some((p) => p.type === 'identical')) {
    const dirs = [...(copy.sameFolders || []), ...(c.alsoSameFolders || [])];
    for (const d of dirs) {
      const dd = slash(d).replace(/\/$/, '');
      if (!lb.startsWith(low(dd) + '/')) continue;
      const entry = `${dd}/${base.slice(dd.length + 1).split('/')[0]}`;
      if ((copy.notInCopy || []).some((x) => low(x) === low(entry))) continue;
      out.push({ type: 'entry', main: entry, copy: `${folder}/${entry}` });
      break;
    }
  }
  return out;
}

// Is the pair out of step? With `after` = { rel, content } it answers for the moment after that save
// (content undefined: not known, for a shell write; content null: the file is gone).
// Returns '' when in step, 'unknown' when it cannot tell, or the plain reason.
export function fault(pair, root, after) {
  const has = (rel) => after && low(after.rel) === low(rel);
  const content = (rel) => (has(rel) ? after.content : readAbs(path.join(root, rel)));
  if (pair.type === 'identical') {
    const a = content(pair.main), b = content(pair.copy);
    if (a === undefined || b === undefined) return 'unknown';
    if (a == null && b == null) return '';
    if (a == null) return `${pair.main} is missing`;
    if (b == null) return `${pair.copy} is missing`;
    return norm(a) === norm(b) ? '' : 'the two must be the same, and they are not';
  }
  if (pair.type === 'mention') {
    const t = content(pair.copy);
    if (t === undefined) return 'unknown';
    const lacking = pair.words.filter((w) => !String(t || '').includes(w));
    return lacking.length ? `${pair.copy} does not carry ${lacking.map((w) => `"${w}"`).join(', ')}` : '';
  }
  // entry
  const exists = (rel) => {
    if (after && (low(after.rel) === low(rel) || low(after.rel).startsWith(low(rel) + '/'))) {
      if (after.content !== null) return true;
      if (low(after.rel) === low(rel)) return false;
    }
    return fs.existsSync(path.join(root, rel));
  };
  if (!exists(pair.main)) return '';
  return exists(pair.copy) ? '' : `${pair.main} has no twin ${pair.copy} in the empty copy`;
}

// ---------- what a step writes ----------
const SHELL_WRITERS = /^(set-content|add-content|out-file|new-item|tee|touch|cp|mv|copy|move|copy-item|move-item|sc|ac|rm|del|remove-item|ri)$/i;
const COPIERS = /^(cp|copy|copy-item|cpi)$/i;
const FILEISH = /^["']?([^\s"'<>|;&]+\.[A-Za-z0-9]{1,6})["']?$/;
const unq = (w) => w.replace(/^["']|["']$/g, '');
function segments(cmd) { return String(cmd || '').split(/\|\||&&|[|;\n]/); }
function shellTargets(cmd) {
  const out = [];
  for (const seg of segments(cmd)) {
    for (const r of seg.match(/(?:^|[^0-9&=])>>?\s*["']?([^\s"'<>|;&]+)/g) || []) { const m = r.match(/>>?\s*["']?([^\s"'<>|;&]+)/); if (m) out.push(m[1]); }
    const words = seg.trim().split(/\s+/);
    if (words.length && SHELL_WRITERS.test(words[0])) for (const w of words.slice(1)) { const m = w.match(FILEISH); if (m && !w.startsWith('-')) out.push(m[1]); }
  }
  return out;
}
// Copies a shell line makes: [from, to], for a plain "cp a b" / "Copy-Item a b".
function shellCopies(cmd) {
  const out = [];
  for (const seg of segments(cmd)) {
    const words = seg.trim().split(/\s+/).filter((w) => !w.startsWith('-'));
    if (words.length === 3 && COPIERS.test(words[0])) out.push([unq(words[1]), unq(words[2])]);
  }
  return out;
}
// The new text of the file after an Edit or MultiEdit; undefined when it cannot be known.
function editResult(current, edits) {
  if (current == null) return undefined;
  let t = current;
  for (const e of edits) {
    const o = String(e.old_string ?? ''), n = String(e.new_string ?? '');
    if (!o || !t.includes(o)) return undefined;
    t = e.replace_all ? t.split(o).join(n) : t.replace(o, () => n);
  }
  return t;
}
// What this step will write: [{ abs, content }] (content undefined when not known, null for a delete).
export function plannedWrites(ev) {
  const tool = ev.tool || ev.tool_name || '';
  const input = ev.input || ev.tool_input || {};
  const cwd = ev.cwd || process.cwd();
  if (WRITE_TOOLS.includes(tool)) {
    const f = input.file_path || input.notebook_path;
    if (!f) return [];
    const abs = path.resolve(cwd, f);
    if (tool === 'Write') return [{ abs, content: String(input.content ?? '') }];
    if (tool === 'Edit') return [{ abs, content: editResult(readAbs(abs), [input]) }];
    if (tool === 'MultiEdit') return [{ abs, content: editResult(readAbs(abs), input.edits || []) }];
    return [{ abs, content: undefined }];
  }
  if (SHELL_TOOLS.includes(tool)) {
    const cmd = ev.command || input.command || '';
    const copies = shellCopies(cmd).map(([a, b]) => [path.resolve(cwd, a), path.resolve(cwd, b)]);
    const sources = new Set(copies.map(([a]) => low(slash(a))));
    return shellTargets(cmd).map((f) => path.resolve(cwd, f)).filter((abs) => !sources.has(low(slash(abs)))).map((abs) => {
      const from = copies.find(([, b]) => low(slash(b)) === low(slash(abs)));
      return { abs, content: from ? readAbs(from[0]) ?? undefined : undefined, fromCopy: !!from };
    });
  }
  return [];
}

// ---------- the record of ends this chat touched ----------
function openPath(ctx, c) { return ctx.state ? path.join(ctx.state, c.openFile || 'ends-in-step-open.json') : ''; }
function readOpen(ctx, c) { try { return JSON.parse(fs.readFileSync(openPath(ctx, c), 'utf8')) || {}; } catch { return {}; } }
function writeOpen(ctx, c, rec) {
  const f = openPath(ctx, c);
  if (!f) return;
  const cutoff = Date.now() - (c.openHours || 48) * 3600e3;
  for (const k of Object.keys(rec)) if (!rec[k] || !(rec[k].at > cutoff) || !Object.keys(rec[k].files || {}).length) delete rec[k];
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(rec));
}
const sidOf = (ev, ctx) => ev.session_id || ctx.sid || 'chat';
function writtenThisTurn(ctx, root) {
  const out = [];
  for (const e of ctx.events || []) {
    const p = e.path || (e.input && (e.input.file_path || e.input.notebook_path));
    if (!p || (e.kind && e.kind !== 'write' && e.kind !== 'tool') || e.ok === false) continue;
    if (e.kind === 'tool' && !WRITE_TOOLS.includes(e.tool)) continue;
    const r = relIn(root, path.resolve(root, p));
    if (r) out.push(r);
  }
  return out;
}

// ---------- the full ends program, cached ----------
function cachePath(ctx, c) { return ctx.state ? path.join(ctx.state, c.fullCacheFile || 'ends-in-step-full.json') : ''; }
export function readCache(ctx, c) { try { return JSON.parse(fs.readFileSync(cachePath(ctx, c), 'utf8')); } catch { return null; } }
// Runs system/ends-check.mjs once and caches its lines with the time it took. Slow: never called inside a step.
export function runFull(root, state, settings = {}) {
  const c = { ...DEFAULTS, ...settings };
  const t0 = Date.now();
  let text = '', ok = true;
  try {
    text = execFileSync(process.execPath, [path.join(root, c.endsProgram || 'system/ends-check.mjs')], {
      encoding: 'utf8', timeout: c.fullRunTimeoutMs || 120000, stdio: ['ignore', 'pipe', 'ignore'],
      env: { ...process.env, HIVE_ROOT: root, HIVE_STATE: state },
    });
  } catch (e) { ok = false; text = String((e && e.stdout) || ''); }
  const lines = text.split(/\r?\n/).filter((l) => /^(OK|NEEDS)\|/.test(l));
  const res = { at: Date.now(), ms: Date.now() - t0, ok, needs: lines.filter((l) => l.startsWith('NEEDS|')).map((l) => l.slice(6)), okCount: lines.filter((l) => l.startsWith('OK|')).length };
  if (state) { fs.mkdirSync(state, { recursive: true }); fs.writeFileSync(path.join(state, c.fullCacheFile || 'ends-in-step-full.json'), JSON.stringify(res)); }
  return res;
}
function refreshInBackground(ctx, c) {
  if (!c.backgroundRefresh || !ctx.state) return;
  const lock = path.join(ctx.state, (c.fullCacheFile || 'ends-in-step-full.json') + '.running');
  try { if (Date.now() - fs.statSync(lock).mtimeMs < 5 * 60e3) return; } catch { /* no run going */ }
  fs.mkdirSync(ctx.state, { recursive: true });
  fs.writeFileSync(lock, String(Date.now()));
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), 'full', ctx.root, ctx.state], { detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();
}
// The known fault of the ends program: its search for outdated phrases also walks the helpers' own copies.
const FAULT_NOTE = ' (this count also reads the helpers\' own copies under .claude/worktrees, a known fault of the ends program, so it is too high)';
function cachedLines(ctx, c) {
  const cache = readCache(ctx, c);
  if (!cache || !Array.isArray(cache.needs)) return { lines: [], cache };
  const lines = cache.needs
    .filter((l) => !/^The empty copy|^The programs that must be the same/.test(l)) // held exactly by this check's own pairs
    .map((l) => (/a later decision made untrue/.test(l) && /\.claude\//.test(l) ? l + FAULT_NOTE : l));
  return { lines, cache };
}

// ---------- the words ----------
function list(items) { return items.map((x, i) => `(${i + 1}) ${x}.`).join(' '); }
function pairWhy(p, why) { return `${p.main} and its end ${p.copy}: ${why}`; }

// ---------- the steps ----------
export function pretool(ev, ctx) {
  try {
    const c = conf(ctx);
    const planned = plannedWrites(ev);
    if (!planned.length) return null;
    const ends = loadEnds(ctx.root, c);
    if (!ends) return null;
    const behind = [];
    for (const w of planned) {
      const rel = relIn(ctx.root, w.abs);
      if (!rel) continue;
      for (const p of pairsFor(rel, ends, c)) {
        const before = fault(p, ctx.root, null);
        if (!before) continue; // in step now: this save may put it out; the end of the reply holds that
        const after = fault(p, ctx.root, { rel, content: w.content });
        if (!after) continue; // this save brings the ends into step: never refused
        behind.push(pairWhy(p, before));
      }
    }
    if (!behind.length) return null;
    if (ctx.log) ctx.log('ends-deny', { count: behind.length });
    return { deny: `HIVE CHECK (ends in step): I stopped this save. It changes a file whose other end is already out of step (rule 15: keep every end in step), and the save does not bring them together: ${list(behind)} The one thing to do: bring the other end in step first (copy the newer version across, or make both say the same), then make this change in both places. A save that makes the ends agree is always let through.` };
  } catch (err) {
    try { ctx.log && ctx.log('error', { check: 'ends-in-step', step: 'pretool', message: String((err && err.message) || err) }); } catch { /* nothing more to do */ }
    return null; // a discipline check lets the step through on its own error
  }
}

// After a save: remember which ends this chat touched, so the end of the reply can hold them.
export function posttool(ev, ctx) {
  try {
    const c = conf(ctx);
    const planned = plannedWrites(ev);
    if (!planned.length) return null;
    const ends = loadEnds(ctx.root, c);
    if (!ends) return null;
    const rec = readOpen(ctx, c);
    const sid = sidOf(ev, ctx);
    const mine = rec[sid] || { at: Date.now(), files: {} };
    let changed = false;
    for (const w of planned) {
      const rel = relIn(ctx.root, w.abs);
      if (!rel) continue;
      const pairs = pairsFor(rel, ends, c);
      if (!pairs.length) continue;
      if (pairs.some((p) => fault(p, ctx.root, null))) mine.files[rel] = Date.now(); else delete mine.files[rel];
      changed = true;
    }
    if (changed) { mine.at = Date.now(); rec[sid] = mine; writeOpen(ctx, c, rec); }
    return null;
  } catch (err) {
    try { ctx.log && ctx.log('error', { check: 'ends-in-step', step: 'posttool', message: String((err && err.message) || err) }); } catch { /* nothing more to do */ }
    return null;
  }
}

// The end of a reply: every end this chat touched that is still out of step is a debt.
export function stop(ev, ctx) {
  try {
    const c = conf(ctx);
    const ends = loadEnds(ctx.root, c);
    if (!ends) return null;
    const rec = readOpen(ctx, c);
    const sid = sidOf(ev, ctx);
    const mine = rec[sid] || { at: Date.now(), files: {} };
    const turn = writtenThisTurn(ctx, ctx.root);
    for (const r of turn) mine.files[r] = mine.files[r] || Date.now();
    const out = new Map();
    for (const rel of Object.keys(mine.files)) {
      const pairs = pairsFor(rel, ends, c);
      let any = false;
      for (const p of pairs) {
        const why = fault(p, ctx.root, null);
        if (why) { any = true; out.set(p.type + '|' + p.main, { p, why }); }
      }
      if (!any) delete mine.files[rel];
    }
    rec[sid] = { at: Date.now(), files: mine.files };
    if (ctx.state) writeOpen(ctx, c, rec);

    const result = {};
    if (out.size) {
      const items = [...out.values()];
      const paths = [...new Set(items.flatMap(({ p }) => [p.main, p.copy]))];
      if (ctx.log) ctx.log('ends-debt', { count: items.length });
      result.debt = {
        key: c.debtKey || 'ends-in-step',
        text: `this piece of work changed ends that are still out of step (rule 15): ${list(items.map(({ p, why }) => pairWhy(p, why)))} Bring each pair into step (the change in both places), and say in the reply which ends were checked.`,
        allow: { paths },
      };
    }
    // The ends a save cannot bring in step (a live site, a copy kept elsewhere): noted, never a debt, because putting
    // them online needs a yes. Taken from the cached full run of the ends program.
    if (turn.length) {
      const { lines: all, cache } = cachedLines(ctx, c);
      // Files were saved, so the cache is older than the notebook now: start a fresh run for the next reply.
      try { refreshInBackground(ctx, c); } catch { /* the next run tries again */ }
      const fresh = cache && Date.now() - cache.at <= (c.fullCacheMinutes || 30) * 60e3;
      const lines = fresh ? all : [];
      const site = (ends.publicSite && ends.publicSite.watch) || [];
      const priv = (ends.publicSite && ends.publicSite.privateOnly) || [];
      const touchesSite = turn.some((r) => site.some((w) => low(r) === low(w) || low(r).startsWith(low(w).replace(/\/$/, '') + '/')) && !priv.some((p) => low(r).startsWith(low(p))));
      const notes = [];
      if (touchesSite) notes.push(`this work changed the code of the public site, so the public site is behind until it is put online; that needs ${c.theirYes || 'a yes'}, so ${c.askWho || 'ask'} whether to put it online now`);
      if (lines.length) notes.push(`the last full run of the ends program (${Math.round((Date.now() - cache.at) / 60e3)} minutes ago) also found: ${lines.slice(0, 4).join('; ')}`);
      if (notes.length) result.say = `HIVE NOTICE (ends in step): ${notes.join('. ')}.`;
    }
    return result.debt || result.say ? result : null;
  } catch (err) {
    try { ctx.log && ctx.log('error', { check: 'ends-in-step', step: 'stop', message: String((err && err.message) || err) }); } catch { /* nothing more to do */ }
    return null;
  }
}

export default {
  id: 'ends-in-step',
  rule: 'rule 15',
  kind: 'discipline',
  mode: 'refuse',
  about: 'A save to a file on the list of ends whose other end is already out of step is refused, and a piece of work that leaves ends it touched out of step becomes a debt.',
  steps: { pretool, posttool, stop },
};

// node core/checks/ends-in-step/check.mjs full [root] [state]: one full run of the ends program, cached, with its time.
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url && process.argv[2] === 'full') {
  const root = process.argv[3] || path.resolve(HERE, '..', '..', '..');
  const state = process.argv[4] || '';
  try {
    const r = runFull(root, state);
    process.stdout.write(`${r.okCount} in step, ${r.needs.length} behind, in ${r.ms} ms\n${r.needs.map((l) => 'NEEDS ' + l).join('\n')}\n`);
  } finally { if (state) { try { fs.unlinkSync(path.join(state, (DEFAULTS.fullCacheFile || 'ends-in-step-full.json') + '.running')); } catch { /* none */ } } }
}
