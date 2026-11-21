// Precedents first (rules 3 and 13): before the first write of a screen or program file, someone in this piece
// of work has looked outside (a web search or fetch) or a precedents note exists for it. Otherwise the write is
// refused, with the one thing to do. How a check is shaped: core/checks/README.md.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
let DEFAULTS = {};
try { DEFAULTS = JSON.parse(fs.readFileSync(path.join(HERE, 'settings.json'), 'utf8')); } catch { DEFAULTS = {}; }

const WRITE_TOOLS = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit'];
const SHELL_TOOLS = ['Bash', 'PowerShell'];

function conf(ctx) { return { ...DEFAULTS, ...((ctx && ctx.settings) || {}) }; }
function slash(p) { return String(p || '').replace(/\\/g, '/'); }
function key(p) { const s = slash(path.resolve(p)); return process.platform === 'win32' ? s.toLowerCase() : s; }
function expandHome(p) { const s = String(p || '').trim(); return s === '~' || /^~[\\/]/.test(s) ? path.join(os.homedir(), s.slice(1)) : s; }
function under(file, dir) { const f = key(file), d = key(dir); return f === d || f.startsWith(d.endsWith('/') ? d : d + '/'); }

// ---------- which files this step writes ----------
// A rough reading of a shell line: the file after > or >>, and every file named after a writing command.
// The gates' own shell reader is finer; this check only needs to notice a write, not every one.
const SHELL_WRITERS = /^(set-content|add-content|out-file|new-item|tee|touch|cp|mv|copy|move|copy-item|move-item|sc|ac)$/i;
const FILEISH = /^["']?([^\s"'<>|;&]+\.[A-Za-z0-9]{1,6})["']?$/;
function shellTargets(cmd) {
  const out = [];
  for (const seg of String(cmd || '').split(/\|\||&&|[|;\n]/)) {
    const redirect = seg.match(/(?:^|[^0-9&])>>?\s*["']?([^\s"'<>|;&]+)/g) || [];
    for (const r of redirect) { const m = r.match(/>>?\s*["']?([^\s"'<>|;&]+)/); if (m) out.push(m[1]); }
    const words = seg.trim().split(/\s+/);
    if (words.length && SHELL_WRITERS.test(words[0])) {
      for (const w of words.slice(1)) { const m = w.match(FILEISH); if (m && !w.startsWith('-')) out.push(m[1]); }
    }
  }
  return out;
}
export function writtenFiles(ev) {
  const tool = ev.tool || ev.tool_name || '';
  const input = ev.input || ev.tool_input || {};
  const cwd = ev.cwd || process.cwd();
  if (WRITE_TOOLS.includes(tool)) {
    const f = input.file_path || input.notebook_path || input.path;
    return f ? [path.resolve(cwd, f)] : [];
  }
  if (SHELL_TOOLS.includes(tool)) return shellTargets(ev.command || input.command).map((f) => path.resolve(cwd, expandHome(f)));
  return [];
}
function gated(file, c) {
  const s = slash(file).toLowerCase();
  if (!(c.extensions || []).some((e) => s.endsWith(String(e).toLowerCase()))) return false;
  if (s.split('/').some((part) => (c.skipFolders || []).includes(part))) return false;
  if (c.skipTempDir !== false && key(file).startsWith(key(os.tmpdir()) + '/')) return false;
  if ((c.tempMarks || []).some((t) => s.includes(String(t).toLowerCase()))) return false;
  return true;
}

// ---------- has anyone looked outside in this piece of work ----------
export function isLook(tool, input, command, c) {
  if (!tool) return false;
  if ((c.lookTools || []).includes(tool)) return true;
  if ((c.lookToolPatterns || []).some((p) => new RegExp(p).test(tool))) return true;
  if ((tool === 'Agent' || tool === 'Task') && (c.lookAgents || []).includes((input || {}).subagent_type)) return true;
  if (SHELL_TOOLS.includes(tool)) {
    const cmd = String(command || (input || {}).command || '');
    return (c.lookCommandPatterns || []).some((p) => new RegExp(p, 'i').test(cmd));
  }
  return false;
}
function eventList(events) {
  if (!events) return [];
  if (Array.isArray(events)) return events;
  return [...(events.tools || []), ...(events.commands || []).map((x) => (typeof x === 'string' ? { tool: 'Bash', command: x } : { tool: 'Bash', ...x }))];
}
function lookedThisTurn(ctx, c) {
  return eventList(ctx.events).some((e) => {
    const tool = e.tool || e.tool_name || e.name;
    const ok = e.ok !== false && (e.exit === undefined || e.exit === 0 || e.exitCode === 0);
    return ok && isLook(tool, e.input || e.tool_input, e.command, c);
  });
}
function recordPath(ctx, c) { return ctx.state ? path.join(ctx.state, c.recordFile || 'precedents-looks.json') : ''; }
function readRecord(ctx, c) {
  const f = recordPath(ctx, c);
  if (!f) return {};
  try { return JSON.parse(fs.readFileSync(f, 'utf8')) || {}; } catch { return {}; }
}
function lookedThisChat(ev, ctx, c) {
  const sid = ev.session_id;
  if (!sid) return false;
  const at = readRecord(ctx, c)[sid];
  return typeof at === 'number' && Date.now() - at < (c.lookHours || 12) * 3600e3;
}

// ---------- the precedents note ----------
function projects(ctx) {
  const dir = path.join(ctx.root, 'projects');
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return []; }
  const out = [];
  for (const name of names) {
    let text = '';
    try { text = readText(ctx, path.join(dir, name, 'state.md')); } catch { continue; }
    const m = text.replace(/^﻿/, '').match(/^---\r?\n([\s\S]*?)\r?\n---/);
    const f = m && m[1].match(/^folder:\s*(.+?)\s*$/m);
    const folders = [];
    if (f && !/^</.test(f[1])) {
      const abs = path.resolve(expandHome(f[1]));
      folders.push(abs);
      // The notebook itself: its folder line says ~/hive-mind, but the notebook may be a copy elsewhere.
      if (key(abs) === key(path.join(os.homedir(), 'hive-mind'))) folders.push(ctx.root);
    }
    out.push({ name, folders, dir: path.join(dir, name) });
  }
  return out;
}
function projectFor(file, ctx) {
  let best = null, bestLen = -1;
  for (const p of projects(ctx)) for (const f of p.folders) {
    if (under(file, f) && key(f).length > bestLen) { best = { ...p, folder: f }; bestLen = key(f).length; }
  }
  return best;
}
function readText(ctx, abs) {
  const rel = path.relative(ctx.root, abs);
  if (typeof ctx.read === 'function' && rel && !rel.startsWith('..') && !path.isAbsolute(rel)) {
    const t = ctx.read(slash(rel));
    if (typeof t === 'string') return t;
  }
  return fs.readFileSync(abs, 'utf8');
}
function globRe(glob) {
  const g = slash(glob).trim();
  let re = '';
  for (let i = 0; i < g.length; i++) {
    const ch = g[i];
    if (ch === '*' && g[i + 1] === '*') { re += '.*'; i++; if (g[i + 1] === '/') i++; }
    else if (ch === '*') re += '[^/]*';
    else if (ch === '?') re += '[^/]';
    else re += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp('^' + re + '$', process.platform === 'win32' ? 'i' : '');
}
function candidateNotes(file, project, ctx, c) {
  const name = String(c.noteName || 'precedent').toLowerCase();
  const seen = new Set(), out = [];
  const add = (dir, needFor) => {
    let list = [];
    try { list = fs.readdirSync(dir); } catch { return; }
    for (const n of list) {
      if (!n.toLowerCase().endsWith('.md') || !n.toLowerCase().includes(name)) continue;
      const abs = path.join(dir, n);
      if (seen.has(key(abs))) continue;
      seen.add(key(abs));
      out.push({ abs, needFor });
    }
  };
  if (project) add(project.dir, false);
  // The file's own folder and its parents, up to the project's folder.
  let d = path.dirname(file);
  for (let i = 0; i < (c.maxParents || 8); i++) {
    add(d, false);
    if (project && key(d) === key(project.folder)) break;
    const up = path.dirname(d);
    if (up === d) break;
    d = up;
  }
  // Shared design notes count only when they say which files they are for.
  for (const nd of c.noteDirs || []) add(path.resolve(ctx.root, nd), true);
  return out;
}
// Why a note does not count, or '' when it does.
export function noteFault(text, mtimeMs, c) {
  const head = /^#{1,6}\s.*precedent/im.test(text) || /^precedents?\b/im.test(text);
  if (!head) return 'it has no "Precedents" heading';
  if (!/https?:\/\/\S+/i.test(text)) return 'it names no outside source with its link';
  const low = text.toLowerCase();
  if (!(c.takenWords || []).some((w) => low.includes(String(w).toLowerCase()))) return 'it does not say what was taken from each source';
  const days = (Date.now() - mtimeMs) / 86400e3;
  if (days > (c.freshDays || 30)) return `it is ${Math.floor(days)} days old (older than ${c.freshDays || 30} days, so it was written for other work)`;
  return '';
}
function covers(text, file, project, ctx) {
  const m = text.match(/^for:\s*(.+?)\s*$/im);
  if (!m) return null;
  const base = project ? project.folder : ctx.root;
  const rel = slash(path.relative(base, file));
  return m[1].split(/[;,]/).map((g) => g.trim()).filter(Boolean).some((g) => {
    const abs = path.isAbsolute(expandHome(g));
    return globRe(abs ? slash(path.resolve(expandHome(g))) : g).test(abs ? slash(path.resolve(file)) : rel);
  });
}
function findNote(file, project, ctx, c) {
  const faults = [];
  for (const n of candidateNotes(file, project, ctx, c)) {
    let text, st;
    try { text = readText(ctx, n.abs); st = fs.statSync(n.abs); } catch { continue; }
    const scope = covers(text, file, project, ctx);
    if (scope === false || (n.needFor && scope !== true)) continue;
    const fault = noteFault(text, st.mtimeMs, c);
    if (!fault) return { ok: n.abs };
    faults.push({ note: n.abs, fault });
  }
  return { faults };
}

// ---------- the steps ----------
function show(abs, ctx) { const r = slash(path.relative(ctx.root, abs)); return r && !r.startsWith('..') ? r : slash(abs); }
function denyText(file, project, found, ctx) {
  const where = project ? `projects/${project.name}/precedents.md` : 'a file called precedents.md next to it';
  const bad = (found.faults || []).map((f) => `${show(f.note, ctx)} does not count yet: ${f.fault}.`).join(' ');
  return `HIVE CHECK (precedents): I stopped this write. ${show(file, ctx)} is screen or program work, and in this piece of work nobody has yet looked at how others already did it (rule 13: precedents first; rule 3: research needs no yes). ` +
    (bad ? bad + ' ' : '') +
    `The one thing to do: search the web for products, designs or programs that already solve this, then write ${where} with a "Precedents" heading and one line per source: its link and what was taken from it. Then try the same write again.`;
}

export function pretool(ev, ctx) {
  try {
    const c = conf(ctx);
    const files = writtenFiles(ev).filter((f) => gated(f, c));
    if (!files.length) return null;
    if (lookedThisTurn(ctx, c) || lookedThisChat(ev, ctx, c)) return null;
    for (const file of files) {
      const project = projectFor(file, ctx);
      const found = findNote(file, project, ctx, c);
      if (found.ok) continue;
      if (ctx.log) ctx.log('precedents-deny', { file: show(file, ctx), project: project ? project.name : '' });
      return { deny: denyText(file, project, found, ctx) };
    }
    return null;
  } catch (err) {
    // A discipline check: on its own error it lets the step through and logs.
    try { ctx.log && ctx.log('error', { check: 'precedents', step: 'pretool', message: String(err && err.message || err) }); } catch { /* nothing more to do */ }
    return null;
  }
}

// A web search or fetch that ran is written down for this chat, so a write in a later turn sees it.
// Only the time is kept: never the words searched, which may be private.
export function posttool(ev, ctx) {
  try {
    const c = conf(ctx);
    const tool = ev.tool || ev.tool_name;
    if (!ev.session_id || !isLook(tool, ev.input || ev.tool_input, ev.command, c)) return null;
    const f = recordPath(ctx, c);
    if (!f) return null;
    const rec = readRecord(ctx, c);
    const cutoff = Date.now() - (c.lookHours || 12) * 3600e3;
    for (const k of Object.keys(rec)) if (!(rec[k] > cutoff)) delete rec[k];
    rec[ev.session_id] = Date.now();
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, JSON.stringify(rec));
    return null;
  } catch (err) {
    try { ctx.log && ctx.log('error', { check: 'precedents', step: 'posttool', message: String(err && err.message || err) }); } catch { /* nothing more to do */ }
    return null;
  }
}

export default {
  id: 'precedents',
  rule: 'rules 3 and 13',
  kind: 'discipline',
  mode: 'refuse',
  about: 'Before the first write of a screen or program file, someone in this piece of work has looked at how others did it (a web search or fetch), or a precedents note with links and what was taken exists for it.',
  steps: { pretool, posttool },
};
