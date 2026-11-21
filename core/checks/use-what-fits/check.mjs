// Use what fits (rule 14). Three things, by program:
//   1. At the person's message, when it looks like design or build work, the fitting skills, connectors and protocols are
//      listed from the registry and put in front of Claude (prompt step).
//   2. The first write of a screen or program file is refused until the skills that are "always" loaded for that kind
//      of work were really loaded in this chat (pretool step).
//   3. A "Used:" line that names a skill never loaded is a debt (stop step). A turn that wrote such a file anyway (a
//      write the pretool step could not see) is a debt too.
// How a check is shaped: core/checks/README.md.
//
// The match of words to kinds and of kinds to skills is the gates' own (fitFor and workKinds in core/gates/gates.mjs),
// with the same settings (the "fit" part of core/gates/settings.json) and the same registry. It is repeated here, not
// imported: importing gates.mjs arms its 2.5-second exit timer and reads the home folder's config, which would end the
// checks' own process. A test runs the gates' fit command on the same made-up notebook and compares the two.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
let DEFAULTS = {};
try { DEFAULTS = JSON.parse(fs.readFileSync(path.join(HERE, 'settings.json'), 'utf8')); } catch { DEFAULTS = {}; }

const WRITE_TOOLS = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit'];
const SHELL_TOOLS = ['Bash', 'PowerShell'];
const ID = 'use-what-fits';

function conf(ctx) { return { ...DEFAULTS, ...((ctx && ctx.settings) || {}) }; }
const slash = (p) => String(p || '').replace(/\\/g, '/');
const key = (p) => { const s = slash(path.resolve(p)); return process.platform === 'win32' ? s.toLowerCase() : s; };
const expandHome = (p) => { const s = String(p || '').trim(); return s === '~' || /^~[\\/]/.test(s) ? path.join(os.homedir(), s.slice(1)) : s; };
const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const list = (xs) => xs.join(', ');

// ---------- reading the notebook (cached by text, so a step stays fast) ----------
function readRel(ctx, rel) {
  if (ctx && typeof ctx.read === 'function') { const t = ctx.read(rel); if (typeof t === 'string' && t) return t; }
  try { return fs.readFileSync(path.join(ctx.root, rel), 'utf8'); } catch { return ''; }
}
const parsed = new Map();
function json(text) {
  if (!text) return null;
  if (parsed.has(text)) return parsed.get(text);
  let v = null;
  try { v = JSON.parse(text.replace(/^﻿/, '')); } catch { v = null; }
  if (parsed.size > 8) parsed.clear();
  parsed.set(text, v);
  return v;
}
// The gates' "fit" settings: kinds, always, categories, connectors, protocols. Missing → null (logged by the caller).
export function fitSettings(ctx, c) {
  const s = json(readRel(ctx, c.fitFrom || 'core/gates/settings.json'));
  return s && s.fit && typeof s.fit === 'object' ? s.fit : null;
}
function registry(ctx, c) { const r = json(readRel(ctx, c.registry || 'system/registry.json')); return r && Array.isArray(r.entries) ? r : { entries: [] }; }

// ---------- the match (the gates' own: workKinds and fitFor) ----------
function hasAny(text, words) { const t = ' ' + String(text).toLowerCase() + ' '; return (words || []).some((w) => new RegExp('(^|[^a-z#])' + esc(String(w).toLowerCase()) + '($|[^a-z])').test(t)); }
export function workKinds(text, F) { return Object.entries((F && F.kinds) || {}).filter(([, words]) => hasAny(text, words)).map(([k]) => k); }
const RANK = { active: 0, 'installed-unused': 1, 'listed-not-installed': 2 };
const STOP = new Set(['the', 'and', 'for', 'with', 'this', 'that', 'into', 'from', 'our', 'his', 'new', 'all', 'make']);
export function fitFor(text, reg, F, kindsGiven) {
  const kinds = kindsGiven || workKinds(text, F);
  const entries = ((reg && reg.entries) || []).filter((e) => e.state !== 'removed');
  const byId = new Map(entries.map((e) => [e.id, e]));
  const always = [];
  for (const k of kinds) for (const s of ((F.always || {})[k] || [])) if (!always.includes(s)) always.push(s);
  const cats = kinds.map((k) => ((F.categories || {})[k] || k));
  const stems = String(text).toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOP.has(w)).map((w) => w.slice(0, 5));
  const score = (e) => { const hay = `${e.id} ${e.about || ''} ${e.group || ''}`.toLowerCase(); return stems.filter((s) => hay.includes(s)).length; };
  const skills = entries.filter((e) => e.kind === 'skill' && !always.includes(e.id) && (e.fits || []).some((f) => cats.includes(f)))
    .map((e) => [score(e), e])
    .sort((a, b) => b[0] - a[0] || (RANK[a[1].state] ?? 3) - (RANK[b[1].state] ?? 3) || a[1].id.localeCompare(b[1].id))
    .map(([, e]) => e).slice(0, F.maxSkills || 8);
  const connectors = [];
  for (const k of kinds) for (const id of ((F.connectors || {})[k] || [])) { const e = byId.get(id); if (e && e.kind === 'connector' && !connectors.includes(e)) connectors.push(e); }
  const pids = [];
  for (const k of [...kinds, ...(kinds.length ? ['all'] : [])]) for (const id of ((F.protocols || {})[k] || [])) if (!pids.includes(id)) pids.push(id);
  const protocols = pids.map((id) => byId.get(id)).filter(Boolean);
  return { kinds, always, skills, connectors: connectors.slice(0, F.maxConnectors || 5), protocols };
}

// ---------- what is loaded ----------
function loadedList(ctx) { return (Array.isArray(ctx.loaded) ? ctx.loaded : []).map((s) => String(s).toLowerCase()); }
// "testing-strategy" counts for "engineering:testing-strategy", and the other way round.
export function isLoaded(name, ctx) {
  if (typeof ctx.hasLoaded === 'function') return !!ctx.hasLoaded(name);
  const n = String(name).toLowerCase(), tail = (x) => x.split(':').pop();
  return loadedList(ctx).some((l) => l === n || tail(l) === tail(n));
}
// For kinds of work: the "always" skills not loaded, and each "one of" list with none of its skills loaded.
function missingFor(kinds, F, c, ctx) {
  const need = [], oneOf = [];
  for (const k of kinds) {
    for (const s of ((F.always || {})[k] || [])) if (!need.includes(s) && !isLoaded(s, ctx)) need.push(s);
    const any = (c.oneOf || {})[k] || [];
    if (any.length && !any.some((s) => isLoaded(s, ctx))) oneOf.push({ kind: k, any });
  }
  return { need, oneOf };
}

// ---------- the record of this chat's kinds of work (the person's words name motion; a file never does) ----------
function recordPath(ctx, c) { return ctx.state ? path.join(ctx.state, c.recordFile || 'use-what-fits.json') : ''; }
function readRecord(ctx, c) { const f = recordPath(ctx, c); if (!f) return {}; try { return JSON.parse(fs.readFileSync(f, 'utf8')) || {}; } catch { return {}; } }
function chatRecord(ev, ctx, c) {
  const sid = ev.session_id || ctx.sid;
  const r = sid ? readRecord(ctx, c)[sid] : null;
  return r && Date.now() - (r.t || 0) < (c.recordHours || 12) * 3600e3 ? r : { kinds: [], shown: [] };
}
function writeRecord(ev, ctx, c, rec) {
  const sid = ev.session_id || ctx.sid;
  const f = recordPath(ctx, c);
  if (!sid || !f) return;
  const all = readRecord(ctx, c);
  const cutoff = Date.now() - (c.recordHours || 12) * 3600e3;
  for (const k of Object.keys(all)) if (!((all[k] || {}).t > cutoff)) delete all[k];
  all[sid] = { ...rec, t: Date.now() };
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(all));
}

// ---------- which files a step writes, and what kind of work each is ----------
const SHELL_WRITERS = /^(set-content|add-content|out-file|new-item|tee|touch|cp|mv|copy|move|copy-item|move-item|sc|ac)$/i;
const FILEISH = /^["']?([^\s"'<>|;&]+\.[A-Za-z0-9]{1,6})["']?$/;
function shellTargets(cmd) {
  const out = [];
  for (const seg of String(cmd || '').split(/\|\||&&|[|;\n]/)) {
    for (const r of seg.match(/(?:^|[^0-9&])>>?\s*["']?([^\s"'<>|;&]+)/g) || []) { const m = r.match(/>>?\s*["']?([^\s"'<>|;&]+)/); if (m) out.push(m[1]); }
    const words = seg.trim().split(/\s+/);
    if (words.length && SHELL_WRITERS.test(words[0])) for (const w of words.slice(1)) { const m = w.match(FILEISH); if (m && !w.startsWith('-')) out.push(m[1]); }
  }
  return out;
}
export function writtenFiles(ev) {
  const tool = ev.tool || ev.tool_name || '';
  const input = ev.input || ev.tool_input || {};
  const cwd = ev.cwd || process.cwd();
  if (WRITE_TOOLS.includes(tool)) { const f = input.file_path || input.notebook_path || input.path; return f ? [path.resolve(cwd, f)] : []; }
  if (SHELL_TOOLS.includes(tool)) return shellTargets(ev.command || input.command).map((f) => path.resolve(cwd, expandHome(f)));
  return [];
}
// 'design' for a screen file, 'build' for a program file, '' for anything else (notes, data, built folders, temp).
export function fileKind(file, c) {
  const s = slash(file).toLowerCase();
  if (s.split('/').some((part) => (c.skipFolders || []).includes(part))) return '';
  if (c.skipTempDir !== false && key(file).startsWith(key(os.tmpdir()) + '/')) return '';
  if ((c.tempMarks || []).some((t) => s.includes(String(t).toLowerCase()))) return '';
  if ((c.interfaceExtensions || []).some((e) => s.endsWith(String(e).toLowerCase()))) return 'design';
  if ((c.programExtensions || []).some((e) => s.endsWith(String(e).toLowerCase()))) return 'build';
  return '';
}
// The kinds of work a write is: its file's kind, plus the kinds the person's words name that no file shows (motion).
function kindsOfWrite(fk, ev, ctx, c, F, file) {
  const kinds = withCode([fk], file, c);
  const said = new Set([...(chatRecord(ev, ctx, c).kinds || []), ...workKinds(ctx.hisLast || '', F)]);
  for (const k of c.wordKinds || []) if (said.has(k) && !kinds.includes(k)) kinds.push(k);
  return kinds;
}
// A screen file that is also code (.tsx, .css and the like; not .svg) is build work too, so it waits for a coding skill
// as well as the design skills (the ruling of 2026-11-20).
function withCode(kinds, file, c) {
  const s = slash(file).toLowerCase();
  if (kinds.includes('build') || !(c.codeAlso || []).some((e) => s.endsWith(String(e).toLowerCase()))) return kinds;
  return [...kinds, 'build'];
}
function show(abs, ctx) { const r = slash(path.relative(ctx.root || '', abs)); return r && !r.startsWith('..') ? r : slash(abs); }
// Two or three skills of a "one of" list that fit the file best: the settings' suggestions for its ending, else the
// default ones, else the first three of the list.
function suggestFor(file, any, c) {
  const s = slash(file || '').toLowerCase();
  const map = c.suggest || {};
  const byEnd = Object.keys(map).filter((k) => k !== 'default' && s.endsWith(k.toLowerCase())).sort((a, b) => b.length - a.length)[0];
  const picks = (map[byEnd] || map.default || []).filter((x) => any.includes(x));
  return (picks.length ? picks : any).slice(0, 3);
}
const orList = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} or ${xs[xs.length - 1]}`);
function needWords({ need, oneOf }, file, c = {}) {
  const parts = [];
  if (need.length) parts.push(list(need));
  for (const o of oneOf) {
    const label = (c.oneOfLabel || {})[o.kind];
    parts.push(label ? `at least one ${label}, for example ${orList(suggestFor(file, o.any, c))}` : `at least one of ${list(o.any)} (for ${o.kind} work)`);
  }
  return parts.join('; and ');
}

// ---------- the "Used:" line ----------
const USED_LINE = /^\s*[*_>\-#]*\s*(used|skills used|what was used|skills (?:i )?(?:actually |really )?loaded)\s*[*_]*\s*:/i;
// The skills a "Used:" line names (before any "skipped" or "not loaded" part): plugin:skill names, and names the
// registry knows as skills.
export function usedSkills(text, known, ignore) {
  const names = [];
  for (const l of String(text || '').replace(/\r/g, '').split('\n').filter((x) => USED_LINE.test(x))) {
    const body = l.replace(/^[^:]*:/, '').split(/\b(skipped|not used|not loaded|left out)\b/i)[0];
    for (const raw of body.match(/[A-Za-z][\w-]*(?::[A-Za-z][\w-]*)?/g) || []) {
      const t = raw.toLowerCase();
      if ((ignore || []).includes(t)) continue;
      const isSkill = /^[a-z][a-z0-9-]*:[a-z][a-z0-9-]*$/.test(t) || known.has(t);
      if (isSkill && !names.includes(t)) names.push(t);
    }
  }
  return names;
}
function knownSkills(reg) { return new Set(reg.entries.filter((e) => e.kind === 'skill' && e.state !== 'removed').map((e) => String(e.id).toLowerCase())); }

function fail(ctx, step, err) {
  // A discipline check: on its own error it lets the step through and logs.
  try { ctx && ctx.log && ctx.log('error', { check: ID, step, message: String((err && err.message) || err) }); } catch { /* nothing more to do */ }
  return null;
}

// ---------- the steps ----------
// At the person's message: what fits this work, from the registry, in front of Claude. The full list once per kind per chat;
// after that one short line only while an "always" skill is still not loaded.
export function prompt(ev, ctx) {
  try {
    const c = conf(ctx);
    const F = fitSettings(ctx, c);
    if (!F) { ctx.log && ctx.log('fit-missing', { from: c.fitFrom }); return null; }
    const text = String(ev.text || ev.prompt || '');
    const kinds = workKinds(text, F);
    if (!kinds.length) return null;
    const rec = chatRecord(ev, ctx, c);
    const allKinds = [...new Set([...(rec.kinds || []), ...kinds])];
    const sayKinds = kinds.filter((k) => (c.sayKinds || []).includes(k));
    const shown = rec.shown || [];
    const fresh = sayKinds.filter((k) => !shown.includes(k));
    writeRecord(ev, ctx, c, { kinds: allKinds, shown: [...new Set([...shown, ...sayKinds])] });
    if (!sayKinds.length) return null;
    const miss = missingFor(sayKinds, F, c, ctx);
    const missing = needWords(miss);
    if (!fresh.length) {
      if (!missing) return null;
      return { say: `HIVE CHECK (use-what-fits, rule 14): still not loaded for this ${list(sayKinds)} work: ${missing}. Load ${miss.need.length + miss.oneOf.length === 1 ? 'it' : 'them'} with the Skill tool; until then every screen or program write is refused.` };
    }
    const r = fitFor(text, registry(ctx, c), { ...F, maxSkills: c.maxSkills || F.maxSkills, maxConnectors: c.maxConnectors || F.maxConnectors }, sayKinds);
    const loadedNow = r.always.filter((s) => isLoaded(s, ctx));
    const say = (e) => `${e.id}${isLoaded(e.id, ctx) ? ' (loaded)' : ''}`;
    const lines = [
      `HIVE CHECK (use-what-fits, rule 14): this message looks like ${list(sayKinds)} work. What fits it, from the registry:`,
      missing
        ? `- Load first, with the Skill tool: ${missing}. The first screen or program write is refused until ${miss.need.length + miss.oneOf.length === 1 ? 'it is' : 'they are'} loaded.`
        : `- Always for this work: ${r.always.length ? list(r.always) + ' (loaded)' : 'nothing is set as always for this kind'}.`,
      loadedNow.length && missing ? `- Already loaded: ${list(loadedNow)}.` : '',
      `- Other skills that fit: ${r.skills.length ? r.skills.map(say).join(', ') : 'none listed'}.`,
      `- Connectors that fit: ${r.connectors.length ? r.connectors.map((e) => e.id).join(', ') : 'none listed'}.`,
      `- Protocols that apply: ${r.protocols.length ? r.protocols.map((e) => e.id.replace('-', ' ')).join(', ') : 'none listed'}.`,
      '- Use every one that fits; in the report, say which were used and which were skipped and why. A "Used:" line names only skills really loaded.',
    ].filter(Boolean);
    ctx.log && ctx.log('fit-listed', { kinds: sayKinds.join(','), need: miss.need.join(',') });
    return { say: lines.join('\n') };
  } catch (err) { return fail(ctx, 'prompt', err); }
}

// Before a write: a screen or program file waits until this kind of work's "always" skills are really loaded.
export function pretool(ev, ctx) {
  try {
    const c = conf(ctx);
    const files = writtenFiles(ev).map((f) => [f, fileKind(f, c)]).filter(([, k]) => k);
    if (!files.length) return null;
    const F = fitSettings(ctx, c);
    if (!F) { ctx.log && ctx.log('fit-missing', { from: c.fitFrom }); return null; }
    for (const [file, fk] of files) {
      const kinds = kindsOfWrite(fk, ev, ctx, c, F, file);
      const miss = missingFor(kinds, F, c, ctx);
      if (!miss.need.length && !miss.oneOf.length) continue;
      const n = miss.need.length + miss.oneOf.length;
      ctx.log && ctx.log('fit-deny', { file: show(file, ctx), kinds: kinds.join(','), need: miss.need.join(','), oneOf: miss.oneOf.map((o) => o.kind).join(',') });
      return { deny: `HIVE CHECK (use-what-fits): I stopped this write. ${show(file, ctx)} is ${list(kinds)} work, and the skills this work always needs were not loaded in this chat: ${needWords(miss, file, c)} (rule 14: use everything that fits). ` +
        `The one thing to do: load ${n === 1 ? 'it' : 'each'} with the Skill tool and follow ${n === 1 ? 'it' : 'them'}, then try the same write again. The full list of what fits: node core/gates/gates.mjs fit <a few words about the work>.` };
    }
    return null;
  } catch (err) { return fail(ctx, 'pretool', err); }
}

// At the end of a reply: a "Used:" line naming a skill never loaded is a debt; so is a turn that wrote a screen or
// program file (seen in the turn's record) while this kind of work's "always" skills were not loaded.
export function stop(ev, ctx) {
  try {
    const c = conf(ctx);
    const debts = [];
    const reg = registry(ctx, c);
    const named = usedSkills(ev.text || ev.last_assistant_message || '', knownSkills(reg), c.usedIgnoreWords);
    const never = named.filter((s) => !isLoaded(s, ctx));
    if (never.length) {
      ctx.log && ctx.log('used-unloaded', { never: never.join(', ').slice(0, 200) });
      debts.push({ key: 'used-unloaded', text: `The last reply's "Used:" line names ${list(never)}, but ${never.length === 1 ? 'that skill was' : 'those skills were'} never loaded in this chat (rule 14: never claim a skill that was not used). In the next reply, say plainly that ${never.length === 1 ? 'it was' : 'they were'} not used, or load ${never.length === 1 ? 'it' : 'them'} with the Skill tool and check the work against ${never.length === 1 ? 'it' : 'them'}.` });
    }
    const F = fitSettings(ctx, c);
    if (F) {
      const need = new Set(), wrote = [];
      for (const e of Array.isArray(ctx.events) ? ctx.events : []) {
        const p = e && (e.kind === 'write' ? e.path : null);
        const fk = p ? fileKind(p, c) : '';
        if (!fk) continue;
        const miss = missingFor(kindsOfWrite(fk, ev, ctx, c, F, p), F, c, ctx);
        if (miss.need.length || miss.oneOf.length) { wrote.push(show(p, ctx)); needWords(miss, p, c).split('; and ').forEach((x) => need.add(x)); }
      }
      if (wrote.length) {
        ctx.log && ctx.log('always-unloaded', { files: wrote.slice(0, 3).join(', ') });
        debts.push({ key: 'always-unloaded', text: `This turn wrote ${wrote.slice(0, 3).join(', ')}${wrote.length > 3 ? ` and ${wrote.length - 3} more` : ''} while ${[...need].join('; ')} ${need.size === 1 ? 'was' : 'were'} not loaded, though this work always needs ${need.size === 1 ? 'it' : 'them'} (rule 14). Load ${need.size === 1 ? 'it' : 'them'} with the Skill tool and check the work against ${need.size === 1 ? 'it' : 'them'} in the next reply.` });
      }
    }
    return debts.length ? { debt: debts } : null;
  } catch (err) { return fail(ctx, 'stop', err); }
}

// When a helper stops: its report's "Used:" or "skills loaded" line naming a skill nobody in this chat loaded is put in
// front of Claude, so the claim is not passed on to the person as true.
export function helperstop(ev, ctx) {
  try {
    const c = conf(ctx);
    const never = usedSkills(ev.text || ev.last_assistant_message || '', knownSkills(registry(ctx, c)), c.usedIgnoreWords).filter((s) => !isLoaded(s, ctx));
    if (!never.length) return null;
    ctx.log && ctx.log('helper-used-unloaded', { never: never.join(', ').slice(0, 200) });
    return { say: `HIVE CHECK (use-what-fits, rule 14): the helper's report says it used ${list(never)}, but no load of ${never.length === 1 ? 'that skill' : 'those skills'} was recorded in this chat. Do not pass that claim on as true; say the helper named ${never.length === 1 ? 'it' : 'them'} without a recorded load.` };
  } catch (err) { return fail(ctx, 'helperstop', err); }
}

export default {
  id: ID,
  rule: 'rule 14',
  kind: 'discipline',
  mode: 'refuse',
  about: 'At the start of design or build work the fitting skills, connectors and protocols are listed from the registry; a screen or program write waits until the skills that work always needs are loaded; a "Used:" line naming a skill never loaded is a debt.',
  steps: { prompt, pretool, stop, helperstop },
};
