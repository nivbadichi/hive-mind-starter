#!/usr/bin/env node
// The radar: Hive Mind keeps itself current (wave 8, 2026-11-19). Design: system/design/keeping-current.md.
// It learns its owner from the notes, looks outside on a schedule within a fixed budget, and brings at most three
// suggestions at a time, each waiting for a yes, not now or never. It installs, connects, pays and changes nothing.
//
//   node core/engine/radar.mjs dry                 what it learned and what it would look for; no network, writes nothing
//   node core/engine/radar.mjs check <date>        may a look run today?  "GO" (exit 0) or "STOP: <why>" (exit 3)
//   node core/engine/radar.mjs profile             learn the owner again; kept on this computer only (state folder)
//   node core/engine/radar.mjs plan [--json]       the web searches for this look, within the budget
//   node core/engine/radar.mjs poll [--from dir] [--save dir]   the cheap pass: read the fixed public lists, keep only what is new
//                                                  and fits; prints "NOTHING NEW" when the costly pass need not run
//   node core/engine/radar.mjs new <finds.json>    add the finds of the web searches (and record the searches made)
//   node core/engine/radar.mjs queue               what the costly pass reads, one line each
//   node core/engine/radar.mjs suggest <judged.json>  judged finds in; at most three ideas waiting, best first
//   node core/engine/radar.mjs answer <idea> <yes|not-now|never|more>   record the owner's answer
//   node core/engine/radar.mjs line                one line for the start or a sitrep ("One idea is waiting for you."), or nothing
//   node core/engine/radar.mjs export              the waiting ideas as JSON (for the page's Initiative place)
//   node core/engine/radar.mjs done [--searches n] [--fetches n] [--seconds n]   close the look: the ledger words, budget check
//
// Places: HIVE_ROOT (the notebook), HIVE_STATE (the state folder, default ~/.claude/hive), CLAUDE_DIR (read only),
//         HIVE_DATE (today, for tests), HIVE_OWNER (the owner's name for the privacy screen; default: git's user.name).
// Never reads me/, archive/ or an employer project's notes. Sends nothing anywhere except plain GETs to the fixed lists.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = () => process.env.HIVE_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const STATE = () => process.env.HIVE_STATE || path.join(os.homedir(), '.claude', 'hive');
const CLAUDE = () => process.env.CLAUDE_DIR || path.join(os.homedir(), '.claude');
const RDIR = () => path.join(ROOT(), 'system', 'radar');
const SWITCH = () => path.join(RDIR(), 'switch.md');
const LIST = () => path.join(RDIR(), 'suggestions.md');
const SEEN = () => path.join(RDIR(), 'seen.json');
const LOCAL = () => path.join(STATE(), 'radar');
export const today = () => process.env.HIVE_DATE || (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();
const dayMs = 86400000;
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / dayMs);
const addDays = (d, n) => new Date(Date.parse(d) + n * dayMs).toISOString().slice(0, 10);
const readText = (p) => { try { return fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n'); } catch { return null; } };
const readJson = (p, d) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return d; } };
const writeJson = (p, v) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(v, null, 1) + '\n'); };
export const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

// ---------- the switch and the budget ----------
// Off until the person switches it on (a new copy starts with no weekly web look: it spends their plan's usage).
export const DEFAULTS = { radar: 'off', every_days: 7, searches: 8, fetches: 12, minutes: 8, tokens: 60000, max_open: 3, costly_cap: 6, min_fit: 4, window_days: 28, retire_after_days: 14, snooze_days: 30 };
export function readSwitch(text) {
  const sw = { ...DEFAULTS };
  for (const k of Object.keys(DEFAULTS)) {
    const m = String(text || '').match(new RegExp('^' + k + ':[ \\t]*(\\S+)', 'mi'));
    if (!m) continue;
    sw[k] = typeof DEFAULTS[k] === 'number' ? (/^\d+$/.test(m[1]) ? Number(m[1]) : DEFAULTS[k]) : m[1].toLowerCase();
  }
  return sw;
}
export const SWITCH_TEXT = `# The radar's switch

The radar looks outside for new skills, tools, connectors and better ways of working, and brings you at most three ideas at a time. It installs, connects and pays for nothing; every idea waits for your yes. It starts off. To switch it on, say "switch on the weekly look" (or change the word after \`radar:\` to \`on\`); \`off\` stops it before it does anything. You can edit this note from your phone.

What it costs: it runs only inside the evening brief, once a week, and each look uses up to the searches, page reads and minutes below, which count toward your Claude plan's usage like your own chats.

radar: off

## Its budget for each look

every_days: 7
searches: 8
fetches: 12
minutes: 8
tokens: 60000
max_open: 3
costly_cap: 6
min_fit: 4
window_days: 28
retire_after_days: 14
snooze_days: 30

## What these lines mean

- \`every_days:\` how often it looks (once a week).
- \`searches:\` and \`fetches:\` the most web searches and page reads in one look. \`minutes:\` and \`tokens:\` the most time and words a look may use (it runs inside the evening brief, whose whole run should stay under ten minutes; tokens are a ceiling the run is told, it cannot measure them).
- \`max_open:\` the most ideas waiting for you at once. \`costly_cap:\` the most finds read closely in one look.
- \`min_fit:\` how well a find must fit your kinds of work before it is read closely.
- \`window_days:\` how far back it counts which skills you really used. \`retire_after_days:\` how many days of that count it needs before it suggests a clean-up.
- \`snooze_days:\` after "not now", how long before an idea may come back. "Never" is never asked again.
`;
export function loadSwitch() { return readSwitch(readText(SWITCH()) ?? ''); }

// ---------- what it remembers (the notebook, so a new computer remembers too) ----------
export function loadSeen() {
  const s = readJson(SEEN(), {});
  // held: finds already read closely and judged, waiting for room in the list, so they are never read twice.
  return { version: 1, queries: s.queries || {}, items: s.items || {}, sources: s.sources || {}, held: s.held || {}, runs: s.runs || [] };
}
const saveSeen = (s) => writeJson(SEEN(), s);
// This look's counts, kept on this computer until `done`.
const RUN = () => path.join(LOCAL(), 'run.json');
const bump = (k, n = 1) => { const r = readJson(RUN(), {}); r[k] = (r[k] || 0) + n; writeJson(RUN(), r); };

// ---------- learning the owner: a closed vocabulary, so nothing private can come out ----------
// Each kind of work has the words that show it in a note, and the general words a web search may use.
export const KINDS = {
  'interface design': { words: /\b(design|ui|ux|interface|front[- ]?end|website|landing|layout|components?|css|tailwind|react|figma|animation|motion|screens?)\b/i, search: 'interface design and front-end work' },
  'agent systems': { words: /\b(agents?|mcp|hooks?|skills?|subagents?|automation|workflows?|claude code|scheduled|gates)\b/i, search: 'AI agent workflows and automation' },
  'testing and checks': { words: /\b(tests?|testing|playwright|e2e|verify|proof|accessibility)\b/i, search: 'automated testing and browser checks' },
  'deploy and hosting': { words: /\b(deploy\w*|hosting|vercel|publish\w*|domains?)\b/i, search: 'web deployment and hosting' },
  'security and privacy': { words: /\b(security|privacy|secrets?|vulnerab\w*|leaks?)\b/i, search: 'security and privacy checks for code' },
  'documents and study': { words: /\b(documents?|docs|pdf|reports?|writing|course|lectures?|stud(y|ies)|assignments?|requirements|research)\b/i, search: 'technical writing and study documents' },
  'planning and organising': { words: /\b(calendar|e-?mail|tasks?|deadlines?|habits?|brief|organi[sz]\w*)\b/i, search: 'personal planning, tasks and calendar' },
  'data and charts': { words: /\b(data|analytics|charts?|dashboards?|sql|spreadsheets?)\b/i, search: 'data analysis and dashboards' },
};
export const LIKES = [
  ['short, plain replies in everyday words', /\b(plain|simple|short|too long|insider|inside words|jargon|human language)\b/i],
  ['never having to say a thing twice', /\b(repeat\w*|twice|third time|three times|never ask twice)\b/i],
  ['ready-made parts over hand-built ones', /\b(ready-made|use everything|component sites?|precedents?)\b/i],
  ['work that does not look generic', /\b(generic|slop|taste|premium|alive)\b/i],
  ['proof before calling something done', /\b(proof|prove|proven|verify)\b/i],
  ['a yes before anything is installed, paid or sent', /\b(install\w*|connect\w*|pay\w*|spend\w*)\b/i],
];
const front = (t) => { const m = (t || '').match(/^﻿?---\n([\s\S]*?)\n---/); const o = {}; if (m) for (const l of m[1].split('\n')) { const i = l.indexOf(':'); if (i > 0) o[l.slice(0, i).trim()] = l.slice(i + 1).trim(); } return o; };

export function readProjects() {
  const dir = path.join(ROOT(), 'projects'); const out = [];
  let names = []; try { names = fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch {}
  for (const n of names) {
    const state = readText(path.join(dir, n, 'state.md'));
    if (state === null) continue;
    const f = front(state);
    const employer = /employer|work for|client/i.test(f.kind || '');
    const paused = /paused|frozen/i.test(`${f.stage || ''} ${f.health || ''}`);
    // An employer project is counted, never read; a paused one is skipped.
    const text = employer || paused ? '' : `${state}\n${readText(path.join(dir, n, 'profile.md')) || ''}`;
    out.push({ folder: n, name: f.project || n, employer, paused, text });
  }
  return out;
}

const tail = (s) => String(s).split(':').pop();
export function usage(date, windowDays) {
  const g = path.join(STATE(), 'gates');
  const chat = path.join(g, 'chat');
  if (!fs.existsSync(chat)) return { counted: false, why: 'not counted here: this computer has no record of loaded skills' };
  const from = Date.parse(date) - windowDays * dayMs; const counts = {};
  for (const f of fs.readdirSync(chat)) {
    if (!f.endsWith('.skills')) continue;
    const p = path.join(chat, f);
    if (fs.statSync(p).mtimeMs < from) continue;
    for (const l of (readText(p) || '').split('\n')) { try { const s = JSON.parse(l).s; if (s) counts[s] = (counts[s] || 0) + 1; } catch {} }
  }
  // How many days of record there are: from the oldest line of the gates' log, or the oldest skills file.
  let since = null;
  const log = readText(path.join(STATE(), 'gates.log'));
  if (log) { const m = log.match(/"t":"(\d{4}-\d{2}-\d{2})/); if (m) since = m[1]; }
  if (!since) for (const f of fs.readdirSync(chat)) { const d = new Date(fs.statSync(path.join(chat, f)).mtimeMs).toISOString().slice(0, 10); if (!since || d < since) since = d; }
  const days = since ? Math.max(0, Math.min(windowDays, daysBetween(since, date))) : 0;
  return { counted: true, since, days, counts };
}
export function sendbacks(date, windowDays) {
  const log = readText(path.join(STATE(), 'gates.log'));
  if (!log) return { counted: false, reasons: {} };
  const from = Date.parse(date) - windowDays * dayMs; const reasons = {};
  for (const l of log.split('\n')) {
    if (!l.includes('"stop-sendback"')) continue;
    let e; try { e = JSON.parse(l); } catch { continue; }
    if (Date.parse(e.t) < from) continue;
    for (const p of e.problems || []) { const r = reasonWord(p); reasons[r] = (reasons[r] || 0) + 1; }
  }
  return { counted: true, reasons };
}
// The send-back reasons, in plain words. Anything not known is "other".
export function reasonWord(p) {
  const t = String(p);
  if (/\bis \d+ words\b|too long/i.test(t)) return 'replies too long';
  if (/Used:/.test(t)) return 'no line saying which skills were used';
  if (/progress map/i.test(t)) return 'no progress map';
  if (/file names?|code\b/i.test(t)) return 'file names or code in a reply';
  if (/double|twice|second message/i.test(t)) return 'the same thing said twice';
  return 'other';
}

// The registry entries the program needs: installed skills, connectors in use, every known name.
function registry() { return readJson(path.join(ROOT(), 'system', 'registry.json'), { entries: [] }).entries || []; }
export function knownNames(entries) {
  const s = new Set();
  for (const e of entries) { s.add(slug(e.id)); s.add(slug(tail(e.id))); const pre = String(e.id).split(':'); if (pre.length > 1) s.add(slug(pre[0])); }
  const inst = readJson(path.join(CLAUDE(), 'plugins', 'installed_plugins.json'), {});
  for (const k of Object.keys(inst.plugins || {})) s.add(slug(k.split('@')[0]));
  return s;
}

export function buildProfile(date = today()) {
  const sw = loadSwitch();
  const projects = readProjects();
  const work = Object.fromEntries(Object.keys(KINDS).map((k) => [k, 0]));
  for (const p of projects) for (const line of p.text.split('\n')) for (const [k, v] of Object.entries(KINDS)) if (v.words.test(line)) work[k] += 1;
  const notes = ['lessons.md', 'preferences.md', 'decisions-in-force.md'].map((n) => readText(path.join(ROOT(), 'system', n)) || '').join('\n');
  const likes = [];
  for (const [label, re] of LIKES) { const n = notes.split('\n').filter((l) => re.test(l)).length; if (n >= 2) likes.push({ label, lines: n }); }
  const entries = registry();
  const installed = entries.filter((e) => e.kind === 'skill' && (e.state === 'active' || e.state === 'installed-unused') && (e.source === 'folder' || e.source === 'plugin') && !/^hive-/.test(e.id)).map((e) => e.id);
  const u = usage(date, sw.window_days);
  const loaded = u.counted ? Object.entries(u.counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])) : [];
  const loadedTails = new Set(loaded.map(([s]) => tail(s)));
  const never = u.counted ? installed.filter((id) => !(u.counts[id] || loadedTails.has(tail(id)))).sort() : [];
  const sb = sendbacks(date, sw.window_days);
  return {
    date,
    work: Object.entries(work).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).map(([kind, weight]) => ({ kind, weight })),
    projects: { read: projects.filter((p) => !p.employer && !p.paused).length, employer: projects.filter((p) => p.employer).length, paused: projects.filter((p) => p.paused).length },
    likes,
    usage: u.counted ? { counted: true, since: u.since, days: u.days, loaded: loaded.slice(0, 10).map(([skill, times]) => ({ skill, times })), installed: installed.length, neverLoaded: never.length, never } : { counted: false, why: u.why },
    sendbacks: sb.counted ? sb.reasons : null,
    tools: entries.filter((e) => e.kind === 'connector' && e.state === 'active' && (e.source === 'directory' || e.source === 'plugin')).map((e) => e.id).sort(),
  };
}
export function profileLines(p) {
  const L = [`What Hive Mind knows about your work (${p.date}, rebuilt every look, kept on this computer):`];
  L.push(`- Kinds of work, from ${p.projects.read} project notes${p.projects.employer ? ` (${p.projects.employer} work project counted, not read)` : ''}${p.projects.paused ? `, ${p.projects.paused} paused project skipped` : ''}: ${p.work.length ? p.work.map((w) => `${w.kind} (${w.weight})`).join(', ') : 'none found yet'}.`);
  L.push(`- How you like things: ${p.likes.length ? p.likes.map((l) => l.label).join('; ') : 'nothing clear yet'}.`);
  if (p.usage.counted) {
    L.push(`- Skills really used in the last ${p.usage.days} days (record since ${p.usage.since}): ${p.usage.loaded.length ? p.usage.loaded.map((x) => `${x.skill} ${x.times}`).join(', ') : 'none recorded'}.`);
    L.push(`- Installed skills not used once in that time: ${p.usage.neverLoaded} of ${p.usage.installed}.`);
  } else L.push(`- Skills really used: ${p.usage.why}.`);
  if (p.sendbacks) { const r = Object.entries(p.sendbacks).sort((a, b) => b[1] - a[1]); L.push(`- Replies sent back by the checks: ${r.length ? r.map(([k, n]) => `${k} ${n}`).join(', ') : 'none'}.`); }
  L.push(`- Tools in use it watches for changes: ${p.tools.length ? p.tools.join(', ') : 'none'}.`);
  return L;
}

// ---------- the privacy screen: nothing private in a search, and nothing private in an idea ----------
export function privateNames() {
  const names = new Set();
  for (const p of readProjects()) { names.add(p.name.toLowerCase()); names.add(p.folder.replace(/-/g, ' ').toLowerCase()); }
  let owner = process.env.HIVE_OWNER;
  if (owner === undefined) { try { owner = spawnSync('git', ['config', 'user.name'], { cwd: ROOT(), encoding: 'utf8', timeout: 3000 }).stdout || ''; } catch { owner = ''; } }
  for (const part of String(owner).trim().toLowerCase().split(/\s+/)) if (part.length >= 3) names.add(part);
  return [...names].filter((n) => n.length >= 3);
}
const SECRET = [/\b(sk|pk|rk)-[A-Za-z0-9_-]{12,}/, /\bgh[pousr]_[A-Za-z0-9]{20,}/, /\bxox[abpr]-/, /\bAKIA[0-9A-Z]{16}\b/, /\b[a-f0-9]{32,}\b/i, /[A-Za-z0-9+/]{40,}={0,2}/, /\b(api[_ -]?key|token|password|passwd|secret)\s*[:=]\s*\S+/i];
export function leaks(text, names = []) {
  const t = String(text || ''); const why = [];
  if (SECRET.some((re) => re.test(t))) why.push('looks like a secret');
  if (/[\w.+-]+@[\w-]+\.[\w.]+/.test(t)) why.push('holds an e-mail address');
  for (const n of names) if (new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(t)) { why.push(`names "${n}"`); break; }
  return why;
}
// Plain words for an idea: a sentence a friend would say.
const INSIDE = /`|\b[\w-]+\.(md|mjs|js|json|ps1|sh)\b|(^|\s)[~.]?\/[\w./-]+|\b(MCP|API|CLI|SDK|repo|npm|JSON|YAML|hook)s?\b/;
export function plainProblem(s, max = 40) {
  const t = String(s || '').trim();
  if (!t) return 'is empty';
  if (t.split(/\s+/).length > max) return `is over ${max} words`;
  if (INSIDE.test(t)) return 'uses an inside word, a file name or code';
  return null;
}

// ---------- the plan: this look's web searches ----------
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const REPEAT_TOPICS = { 'replies too long': 'keeping AI assistant replies short and plain', 'no line saying which skills were used': 'making AI agents report which tools they used', 'no progress map': 'progress updates from AI agents', 'file names or code in a reply': 'plain-language replies from coding agents' };
export function plan(p, seen, sw, names = []) {
  const month = `${MONTHS[Number(p.date.slice(5, 7)) - 1]} ${p.date.slice(0, 4)}`;
  const q = [];
  const top = p.work.slice(0, 3).map((w) => KINDS[w.kind].search);
  for (const k of top) q.push(`new Claude Code skills for ${k} ${month}`);
  for (const k of top.slice(0, 2)) q.push(`new Claude connectors for ${k} ${month}`);
  const rep = Object.entries(p.sendbacks || {}).filter(([r, n]) => REPEAT_TOPICS[r] && n >= 3).sort((a, b) => b[1] - a[1])[0];
  if (rep) q.push(`Claude Code ${REPEAT_TOPICS[rep[0]]} ${month}`);
  for (const t of p.tools.slice(0, 2)) q.push(`${t.replace(/-/g, ' ')} Claude connector changes ${month}`);
  q.push(`Claude Code new features for skills and scheduled tasks ${month}`);
  const out = []; const dropped = [];
  for (const s of q) {
    if (seen.queries[s]) { dropped.push([s, `searched on ${seen.queries[s]}`]); continue; }
    const l = leaks(s, names); if (l.length) { dropped.push([s, l.join(', ')]); continue; }
    if (out.length >= sw.searches) { dropped.push([s, 'over the budget of searches']); continue; }
    out.push(s);
  }
  return { queries: out, dropped };
}

// ---------- the cheap pass: fixed public lists, read by a program, no model ----------
export const SOURCES = [
  { id: 'official-plugins', kind: 'plugin', type: 'marketplace', url: 'https://raw.githubusercontent.com/anthropics/claude-plugins-official/main/.claude-plugin/marketplace.json', page: 'https://github.com/anthropics/claude-plugins-official' },
  { id: 'work-plugins', kind: 'plugin', type: 'marketplace', url: 'https://raw.githubusercontent.com/anthropics/knowledge-work-plugins/main/.claude-plugin/marketplace.json', page: 'https://github.com/anthropics/knowledge-work-plugins' },
  { id: 'vercel-plugins', kind: 'plugin', type: 'marketplace', url: 'https://raw.githubusercontent.com/vercel/vercel-plugin/main/.claude-plugin/marketplace.json', page: 'https://github.com/vercel/vercel-plugin' },
  { id: 'anthropic-skills', kind: 'skill', type: 'dirlist', url: 'https://api.github.com/repos/anthropics/skills/contents/skills', page: 'https://github.com/anthropics/skills' },
  { id: 'claude-code-changes', kind: 'feature', type: 'changelog', url: 'https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md', page: 'https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md' },
];
const FEATURE_WORDS = /\b(hooks?|skills?|plugins?|schedul\w*|routines?|memory|subagents?|worktrees?|artifacts?|connectors?|MCP)\b/i;
export function parseSource(src, text, seen) {
  const items = [];
  if (src.type === 'marketplace') {
    let j; try { j = JSON.parse(text); } catch { return null; }
    for (const p of j.plugins || []) {
      const url = p.homepage || (p.source && p.source.url) || (p.repository) || src.page;
      const maker = (p.author && p.author.name) || '';
      items.push({ key: slug(p.name), name: p.displayName || p.name, kind: src.kind, about: String(p.description || '').slice(0, 300), maker: maker || `not given (listed by ${(j.owner && j.owner.name) || 'the list'})`, url, source: src.id, official: /anthropic/i.test(maker) });
    }
  } else if (src.type === 'dirlist') {
    let j; try { j = JSON.parse(text); } catch { return null; }
    for (const d of Array.isArray(j) ? j : []) if (d.type === 'dir') items.push({ key: slug(d.name), name: d.name, kind: 'skill', about: d.name.replace(/-/g, ' '), maker: 'Anthropic', url: d.html_url || src.page, source: src.id, official: true });
  } else if (src.type === 'changelog') {
    const blocks = String(text).split(/^## /m).slice(1).map((b) => { const [head, ...rest] = b.split('\n'); return { ver: head.trim(), lines: rest.filter((l) => /^\s*-\s/.test(l)).map((l) => l.replace(/^\s*-\s*/, '').trim()) }; }).filter((b) => /^\d+\.\d+\.\d+/.test(b.ver));
    if (!blocks.length) return null;
    const last = seen.sources[src.id];
    const idx = last ? blocks.findIndex((b) => b.ver === last) : -1;
    const fresh = last && idx >= 0 ? blocks.slice(0, idx) : blocks.slice(0, 3);
    // All the versions since the last look make one find: one close read covers them.
    const hits = fresh.flatMap((b) => b.lines.filter((l) => FEATURE_WORDS.test(l)).slice(0, 4));
    if (hits.length) items.push({ key: `claude-code-${slug(fresh[fresh.length - 1].ver)}-to-${slug(fresh[0].ver)}`, name: `Claude Code ${fresh.length > 1 ? fresh[fresh.length - 1].ver + ' to ' : ''}${fresh[0].ver}`, kind: 'feature', about: hits.slice(0, 8).join(' / ').slice(0, 900), maker: 'Anthropic', url: src.page, source: src.id, official: true });
    items.newest = blocks[0].ver;
  }
  return items;
}
// How well a find fits: the distinct words of the owner's main kinds of work it carries (the first kind counts most),
// plus Claude's own changes (every chat runs on them) and official makers; a find that only works with a service
// the owner does not use ("connects Claude to Asana") counts less.
const SERVICE_BOUND = /\b(integration|connects? (claude( code)?|you) to|work with your|your \w+ (account|workspace|content|data))\b/i;
export function fitScore(item, p) {
  const text = `${item.name} ${item.about}`; let s = 0;
  p.work.slice(0, 3).forEach((w, i) => {
    const hits = new Set([...text.matchAll(new RegExp(KINDS[w.kind].words.source, 'gi'))].map((m) => m[0].toLowerCase()));
    s += (3 - i) * Math.min(hits.size, 2);
  });
  if (item.kind === 'feature') s += 6;
  if (item.official) s += 1;
  if (item.kind !== 'feature' && SERVICE_BOUND.test(text)) s -= 3;
  // A product's own plugin names the product in its description ("build on Val Town"): it fits only if the owner uses that product.
  const own = String(item.name).toLowerCase().split(/[^a-z0-9]+/).filter((x) => x.length >= 3 && !/^(claude|code|plugin|skills?|tools?)$/.test(x));
  const proper = (String(item.about).match(/\b[A-Z]\w*(?:\s[A-Z]\w*)*/g) || []).map((x) => x.toLowerCase().replace(/[^a-z0-9]/g, ''));
  if (!item.official && own.some((x) => proper.some((pn) => pn.includes(x)))) s -= 2;
  return s;
}
// What is new and worth a close read. Everything looked at is remembered, so it is never looked at twice.
export function sift(items, p, seen, sw, known, never) {
  const fresh = []; const skipped = [];
  const queued = new Set(readJson(path.join(LOCAL(), 'queue.json'), []).map((q) => q.key));
  for (const it of items) {
    const k = it.key; const prev = seen.items[k];
    if (never.has(k)) { skipped.push([it, 'you said never']); continue; }
    if (known.has(k) || known.has(slug(it.name))) { skipped.push([it, 'already in your list']); continue; }
    if (queued.has(k)) { skipped.push([it, 'already waiting for a close read']); continue; }
    if (seen.held[k]) { skipped.push([it, 'already read closely; waiting for room in the list']); continue; }
    if (prev && prev.s !== 'held') { skipped.push([it, 'seen before']); continue; }
    it.fit = fitScore(it, p);
    if (it.fit < sw.min_fit) { skipped.push([it, 'does not fit your kinds of work']); seen.items[k] = { s: 'low-fit', d: p.date }; continue; }
    fresh.push(it);
  }
  // One budget for the close read: what already waits and the new finds are ranked together; the best stay.
  const queue = readJson(path.join(LOCAL(), 'queue.json'), []);
  const all = queue.map((q) => ({ ...q, was: true })).concat(fresh).sort((a, b) => b.fit - a.fit || a.key.localeCompare(b.key));
  const keep = all.slice(0, sw.costly_cap);
  for (const it of all.slice(sw.costly_cap)) { skipped.push([it, 'over this look\'s budget; kept for the next look']); seen.items[it.key] = { s: 'held', d: p.date }; }
  for (const it of keep) seen.items[it.key] = { s: 'queued', d: p.date };
  writeJson(path.join(LOCAL(), 'queue.json'), keep.map(({ was: _w, ...it }) => it));
  return { take: keep.filter((it) => !it.was), skipped };
}

export async function poll({ from, save } = {}) {
  const p = buildProfile(); const seen = loadSeen(); const sw = loadSwitch();
  const known = knownNames(registry()); const never = neverKeys();
  let all = []; const failed = []; let fetched = 0;
  for (const src of SOURCES) {
    let text = null;
    if (from) text = readText(path.join(from, `${src.id}.txt`));
    else {
      try { const r = await fetch(src.url, { headers: { 'user-agent': 'hive-radar' }, signal: AbortSignal.timeout(20000) }); fetched += 1; text = r.ok ? await r.text() : null; } catch { text = null; }
    }
    if (save && text !== null) { fs.mkdirSync(save, { recursive: true }); fs.writeFileSync(path.join(save, `${src.id}.txt`), text); }
    const items = text === null ? null : parseSource(src, text, seen);
    if (!items) { failed.push(src.id); continue; }
    if (items.newest) seen.sources[src.id] = items.newest;
    all = all.concat(items);
  }
  // One name, one find, even when two lists carry it.
  const byKey = new Map(); for (const it of all) if (!byKey.has(it.key)) byKey.set(it.key, it);
  const { take, skipped } = sift([...byKey.values()], p, seen, sw, known, never);
  saveSeen(seen);
  bump('fetches', fetched); bump('found', take.length); bump('dropped', skipped.length);
  return { take, skipped, failed, lists: SOURCES.length - failed.length };
}
export function addFinds(f) {
  const p = buildProfile(); const seen = loadSeen(); const sw = loadSwitch();
  for (const q of f.queries || []) seen.queries[q] = p.date;
  bump('searches', (f.queries || []).length);
  const items = (f.finds || []).filter((x) => x && x.name).map((x) => ({ key: slug(x.name), name: x.name, kind: x.kind || 'skill', about: String(x.about || '').slice(0, 300), maker: x.maker || '', url: x.url || '', source: 'web', official: /^anthropic$/i.test(String(x.maker || '').trim()) }));
  const { take, skipped } = sift(items, p, seen, sw, knownNames(registry()), neverKeys());
  saveSeen(seen);
  bump('found', take.length); bump('dropped', skipped.length);
  return { take, skipped };
}

// ---------- the list of ideas (system/radar/suggestions.md) ----------
export const LIST_HEAD = `# Ideas to keep Hive Mind current

The radar adds at most three at a time, best first. Each one says what it would do for you, what it costs and what it needs from you. Answer in a chat ("yes to idea 3", "not now", "never") or on your page. A yes goes through the add helper, with the full safety review first; nothing is installed, connected or paid without your yes for that exact step. "Never" is never asked again. "Not now" may come back after a month.

## Waiting for you

## Answered
`;
const KIND_WORD = { skill: 'skill', plugin: 'tool', connector: 'connector', feature: 'Claude feature', protocol: 'rule or check', retire: 'clean-up' };
export function readList() {
  const t = readText(LIST()) ?? LIST_HEAD; const ideas = [];
  for (const line of t.split('\n')) {
    const m = line.match(/^- \[( |x)\] (r\d+) \| (.*)$/); if (!m) continue;
    const parts = m[3].split(' | ');
    const field = (label) => { const x = parts.find((s) => s.startsWith(label + ': ')); return x ? x.slice(label.length + 2) : ''; };
    const ans = field('Answer').match(/^(yes|not now|never) (\d{4}-\d{2}-\d{2})/);
    ideas.push({ id: m[2], open: m[1] === ' ', date: parts[0], kind: parts[1], name: parts[2], say: parts[3], cost: field('Costs'), needs: field('Needs'), replaces: field('Replaces'), firstRead: field('First read'), from: field('From'), key: field('Key'), answer: ans ? ans[1] : '', answered: ans ? ans[2] : '', more: field('Asked for more'), line });
  }
  return { text: t, ideas };
}
export function neverKeys() { return new Set(readList().ideas.filter((i) => i.answer === 'never').map((i) => i.key)); }
const lineOf = (x) => `- [ ] ${x.id} | ${x.date} | ${KIND_WORD[x.kind] || x.kind} | ${x.name} | ${x.say} | Costs: ${x.cost} | Needs: ${x.needs} | Replaces: ${x.replaces} | First read: ${x.firstRead} | From: ${x.from} | Key: ${x.key}`;
function writeList(text) { fs.mkdirSync(RDIR(), { recursive: true }); fs.writeFileSync(LIST(), text.replace(/\n{3,}/g, '\n\n')); }
function insertWaiting(text, lines) {
  if (!/^## Waiting for you$/m.test(text)) text = LIST_HEAD;
  return text.replace(/^## Waiting for you\n/m, `## Waiting for you\n\n${lines.join('\n')}\n`);
}

// ---------- ideas the notes themselves give: a rule for a repeated correction, a clean-up of what is never used ----------
const REPEAT = /\b(third time|again|twice|more than once|three times|had to (say|cut|repeat|correct))\b/i;
export function noteIdeas(p, sw) {
  const out = [];
  for (const [r, n] of Object.entries(p.sendbacks || {})) {
    if (r === 'other' || n < 3) continue;
    out.push({ key: `protocol-sendback-${slug(r)}`, kind: 'protocol', name: `A step against: ${r}`, say: `Claude was sent back ${n} times in ${sw.window_days} days for the same thing: ${r}. A step earlier in the work could stop it before the reply.`, cost: 'nothing to pay; a small change to the checks', needs: 'your yes to the new step', replaces: 'the send-back after the fact', firstRead: 'your own notes; nothing from outside', from: 'the record of the checks', score: 8 + Math.min(n, 9) / 3 });
  }
  const lessons = readText(path.join(ROOT(), 'system', 'lessons.md')) || '';
  for (const l of lessons.split('\n')) {
    if (!/^- /.test(l) || !/closed_by:\s*open/.test(l) || !REPEAT.test(l)) continue;
    const body = l.replace(/^- (\d{4}-\d{2}-\d{2}: )?/, '').split(/closed_by:/)[0].trim();
    const first = body.split(/(?<=\.)\s/)[0].slice(0, 160);
    const words = plainProblem(first, 30) ? 'a correction you gave more than once, written in your lessons note' : `"${first.replace(/"/g, "'")}"`;
    out.push({ key: `protocol-lesson-${slug(first).slice(0, 40)}`, kind: 'protocol', name: 'A check for a repeated correction', say: `You had to say this more than once: ${words}. It could become a check, so you never say it again.`, cost: 'nothing to pay; a small check', needs: 'your yes to the wording', replaces: 'saying it again', firstRead: 'your own notes; nothing from outside', from: 'your lessons note', score: 9 });
  }
  if (p.usage.counted && p.usage.days >= sw.retire_after_days && p.usage.neverLoaded >= 5) {
    out.push({ key: 'retire-unused-skills', kind: 'retire', name: 'Skills you never use', say: `${p.usage.neverLoaded} of your ${p.usage.installed} installed skills were not used once in ${p.usage.days} days, for example ${p.usage.never.slice(0, 3).join(', ')}. Say yes and Claude lists them so you choose which to turn off.`, cost: 'nothing; fewer skills to choose from makes each chat lighter', needs: 'your choice from the list; nothing is deleted without a second yes', replaces: 'nothing', firstRead: 'your own record of what was used', from: 'the record of loaded skills', score: 5 });
  }
  return out;
}

// ---------- the costly pass ends here: judged finds in, at most three ideas out ----------
const NEED = ['key', 'name', 'kind', 'say', 'cost', 'needs', 'replaces', 'value'];
const NEED_SAFETY = ['maker', 'licence', 'reads', 'sends', 'hooks', 'verdict'];
export function checkJudged(j, names) {
  const lack = NEED.filter((k) => j[k] === undefined || j[k] === '');
  const s = j.safety || {}; const lackS = NEED_SAFETY.filter((k) => !s[k]);
  if (lack.length || lackS.length) return `missing ${[...lack, ...lackS.map((k) => 'safety.' + k)].join(', ')}`;
  if (!['fine', 'care', 'stop'].includes(s.verdict)) return 'safety.verdict must be fine, care or stop';
  if (!(j.value >= 1 && j.value <= 3)) return 'value must be 1, 2 or 3';
  const pp = plainProblem(j.say); if (pp) return `the sentence ${pp}`;
  for (const k of ['cost', 'needs', 'replaces']) { const q = plainProblem(j[k], 20); if (q) return `"${k}" ${q}`; }
  const l = leaks([j.say, j.cost, j.needs, j.replaces].join(' '), names); if (l.length) return `it ${l.join(', ')}`;
  return null;
}
export function suggest(judged, date = today()) {
  const sw = loadSwitch(); const seen = loadSeen(); const names = privateNames(); const p = buildProfile(date);
  const { text, ideas } = readList();
  const taken = new Set(ideas.filter((i) => i.open || i.answer === 'yes' || i.answer === 'never' || (i.answer === 'not now' && daysBetween(i.answered, date) < sw.snooze_days)).map((i) => i.key));
  const refused = []; const dropped = []; const pool = [];
  const queue = readJson(path.join(LOCAL(), 'queue.json'), []); const fit = Object.fromEntries(queue.map((q) => [q.key, q.fit || 0]));
  for (const j of judged || []) {
    // The close read may find it does not fit after all: set aside with the reason, never asked.
    if (j && j.key && j.drop) { dropped.push([j.name || j.key, j.drop]); seen.items[j.key] = { s: 'dropped', d: date, why: String(j.drop) }; continue; }
    const bad = checkJudged(j, names);
    if (bad) { refused.push([j.name || j.key || '(no name)', bad]); continue; }
    if (j.safety.verdict === 'stop') { dropped.push([j.name, j.safety.why || 'the first safety read said do not use']); seen.items[j.key] = { s: 'dropped', d: date, why: j.safety.why || '' }; continue; }
    const s = j.safety;
    pool.push({ key: j.key, kind: j.kind, name: j.name, say: j.say, cost: j.cost, needs: j.needs, replaces: j.replaces, firstRead: `made by ${s.maker}; licence ${s.licence}; reads ${s.reads}; sends ${s.sends}; hooks ${s.hooks}; ${s.verdict === 'fine' ? 'looks fine' : 'use with care' + (s.why ? ': ' + s.why : '')}`, from: j.url || 'not recorded', score: j.value * 3 + Math.min(fit[j.key] || 0, 6) / 2 + (s.verdict === 'fine' ? 1 : 0) }); // 4 to 13, on the same scale as the ideas from the owner's notes
  }
  // Ideas that were held back, or put off long enough ago, come back without a new search.
  for (const i of ideas) if (i.answer === 'not now' && daysBetween(i.answered, date) >= sw.snooze_days && !pool.some((x) => x.key === i.key)) pool.push({ ...i, kind: Object.keys(KIND_WORD).find((k) => KIND_WORD[k] === i.kind) || i.kind, score: 2 });
  for (const h of Object.values(seen.held)) if (!pool.some((x) => x.key === h.key)) pool.push(h);
  for (const n of noteIdeas(p, sw)) pool.push(n);
  const sorted = pool.filter((x) => !taken.has(x.key)).sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));
  // Never a pile of one sort: at most one new rule and one clean-up in a look; the others wait their turn.
  const once = new Set(ideas.filter((i) => i.open).map((i) => ({ 'rule or check': 'protocol', 'clean-up': 'retire' })[i.kind]).filter(Boolean));
  const fresh = []; const later = [];
  for (const x of sorted) { if ((x.kind === 'protocol' || x.kind === 'retire') && once.has(x.kind)) later.push(x); else { once.add(x.kind); fresh.push(x); } }
  const open = ideas.filter((i) => i.open).length;
  const room = Math.max(0, sw.max_open - open);
  let n = Math.max(0, ...ideas.map((i) => Number(i.id.slice(1))));
  const add = fresh.slice(0, room).map((x) => ({ ...x, id: `r${++n}`, date }));
  const held = fresh.slice(room).concat(later);
  for (const x of add) { seen.items[x.key] = { s: 'suggested', d: date }; delete seen.held[x.key]; }
  for (const x of held) {
    if (!(seen.items[x.key] && seen.items[x.key].s === 'suggested')) seen.items[x.key] = { s: 'held', d: date };
    // A judged find is kept whole; ideas from the owner's notes are made again each look, so they are not kept.
    if (x.kind !== 'protocol' && x.kind !== 'retire' && !x.id) { const { line: _l, ...keep } = x; seen.held[x.key] = keep; }
  }
  if (add.length) writeList(insertWaiting(text, add.map(lineOf)));
  // The costly pass is done with the queue.
  const done = new Set((judged || []).map((j) => j.key));
  writeJson(path.join(LOCAL(), 'queue.json'), queue.filter((q) => !done.has(q.key)));
  saveSeen(seen); bump('suggested', add.length); bump('dropped', dropped.length);
  return { add, held, refused, dropped };
}

// ---------- the owner's answers ----------
export function answer(id, word, date = today()) {
  const w = { yes: 'yes', 'not-now': 'not now', 'not now': 'not now', later: 'not now', never: 'never', more: 'more', 'tell-me-more': 'more' }[String(word).toLowerCase()];
  if (!w) throw new Error('The answer is yes, not-now, never or more');
  const { text, ideas } = readList();
  const i = ideas.find((x) => x.id === id);
  if (!i) throw new Error(`There is no idea called ${id}`);
  if (!i.open) throw new Error(`${id} was already answered: ${i.answer} on ${i.answered}`);
  let out;
  if (w === 'more') out = text.replace(i.line, `${i.line.replace(/ \| Asked for more: [^|]*/, '')} | Asked for more: ${date}`);
  else {
    const done = `${i.line.replace('- [ ]', '- [x]')} | Answer: ${w} ${date}`;
    out = text.replace(i.line + '\n', '').replace(i.line, '');
    out = /^## Answered$/m.test(out) ? out.replace(/^## Answered\n/m, `## Answered\n\n${done}\n`) : `${out.trimEnd()}\n\n## Answered\n\n${done}\n`;
  }
  writeList(out);
  const seen = loadSeen(); if (w !== 'more') { seen.items[i.key] = { s: `answered ${w}`, d: date }; saveSeen(seen); }
  const kind = i.kind;
  const next = {
    yes: kind === 'rule or check' ? 'Next: add it as a rule with the add helper, in these words, and say whether a check can hold it.'
      : kind === 'clean-up' ? 'Next: list the unused skills so you can choose; each one is removed with the add helper, and nothing is deleted without a second yes.'
        : kind === 'Claude feature' ? 'Next: read the change and show where it fits; nothing changes without a yes for that step.'
          : `Next: the add helper for "${i.name}", which runs the full safety review first when it is not official, then asks the yes to install.`,
    'not now': `Put away. It may come back after ${loadSwitch().snooze_days} days.`,
    never: 'It will not be suggested again.',
    more: `Next: the full 10-point safety review of "${i.name}" (the review helper), then show what it found.`,
  }[w];
  return { idea: i, w, next };
}

// ---------- where the owner sees it ----------
const NUM = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];
export function line() {
  if (loadSwitch().radar !== 'on') return '';
  const n = readList().ideas.filter((i) => i.open).length;
  if (!n) return '';
  return n === 1 ? 'One idea is waiting for you.' : `${NUM[n] || n} ideas are waiting for you.`;
}
export function exportOpen() { return readList().ideas.filter((i) => i.open).map(({ line: _l, open: _o, answer: _a, answered: _d, ...rest }) => rest); }

// ---------- the guard, and the end of a look ----------
export function check(date, sw = loadSwitch(), seen = loadSeen()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return { go: false, why: 'the look was not given a date like 2026-11-19' };
  if (sw.radar !== 'on') return { go: false, why: 'the switch is off' };
  const last = seen.runs.length ? seen.runs[seen.runs.length - 1].date : null;
  if (last && daysBetween(last, date) < sw.every_days) return { go: false, why: `it last looked on ${last}; the next look is on or after ${addDays(last, sw.every_days)}` };
  return { go: true };
}
export function finish(date, f = {}) {
  const sw = loadSwitch(); const seen = loadSeen(); const r = readJson(RUN(), {});
  const run = { date, searches: Number(f.searches ?? r.searches ?? 0), fetches: Number(f.fetches ?? 0) + (r.fetches || 0), seconds: Number(f.seconds || 0), found: r.found || 0, dropped: r.dropped || 0, suggested: r.suggested || 0 };
  seen.runs = seen.runs.concat([run]).slice(-26); saveSeen(seen);
  try { fs.rmSync(RUN(), { force: true }); } catch {}
  const over = [];
  if (run.searches > sw.searches) over.push(`${run.searches} searches, over the budget of ${sw.searches}`);
  if (run.fetches > sw.fetches) over.push(`${run.fetches} page reads, over the budget of ${sw.fetches}`);
  if (run.seconds > sw.minutes * 60) over.push(`${Math.round(run.seconds / 60)} minutes, over the budget of ${sw.minutes}`);
  const ledger = `Radar: ${run.searches} searches, ${run.fetches} page reads, ${run.found} new finds, ${run.dropped} set aside, ${run.suggested} suggested, ${run.seconds} seconds. Tokens: not measured.`;
  return { run, over, ledger };
}

// ---------- command line ----------
function flags(args) { const f = {}; const rest = []; for (let i = 0; i < args.length; i++) { if (args[i].startsWith('--')) { f[args[i].slice(2)] = args[i + 1] !== undefined && !args[i + 1].startsWith('--') ? args[++i] : 'true'; } else rest.push(args[i]); } return { f, rest }; }
async function main(argv) {
  const [cmd, ...args] = argv; const { f, rest } = flags(args);
  try {
    if (cmd === 'dry') {
      const p = buildProfile(); const sw = loadSwitch(); const pl = plan(p, loadSeen(), sw, privateNames());
      profileLines(p).forEach((l) => console.log(l));
      console.log(`\nThe switch: radar ${sw.radar}; one look every ${sw.every_days} days; at most ${sw.searches} searches, ${sw.fetches} page reads, ${sw.minutes} minutes, ${sw.max_open} ideas waiting.`);
      console.log('\nIt would read these public lists first (the cheap pass, no model):'); SOURCES.forEach((s) => console.log(`- ${s.id}: ${s.url}`));
      console.log('\nAnd only if they or the notes give something new, it would search the web for:'); pl.queries.forEach((q) => console.log(`- ${q}`));
      pl.dropped.forEach(([q, why]) => console.log(`  (not searched: "${q}", ${why})`));
      const ni = noteIdeas(p, sw); console.log(`\nIdeas from your own notes it would weigh: ${ni.length ? ni.map((x) => x.name).join('; ') : 'none today'}.`);
      console.log('\nDry run: nothing was searched, fetched or written.');
    } else if (cmd === 'check') { const d = check(rest[0]); if (d.go) console.log('GO'); else { console.log('STOP: ' + d.why); process.exitCode = 3; } }
    else if (cmd === 'profile') { const p = buildProfile(); writeJson(path.join(LOCAL(), 'profile.json'), p); profileLines(p).forEach((l) => console.log(l)); }
    else if (cmd === 'plan') { const pl = plan(buildProfile(), loadSeen(), loadSwitch(), privateNames()); if (f.json) console.log(JSON.stringify(pl, null, 1)); else pl.queries.forEach((q) => console.log(q)); }
    else if (cmd === 'poll') {
      if (!fs.existsSync(SWITCH())) { fs.mkdirSync(RDIR(), { recursive: true }); fs.writeFileSync(SWITCH(), SWITCH_TEXT); }
      const r = await poll({ from: f.from, save: f.save });
      if (r.failed.length) console.log(`NOTE: could not read ${r.failed.join(', ')}`);
      if (!r.take.length) console.log(`NOTHING NEW (${r.lists} lists read, ${r.skipped.length} set aside)`);
      else { console.log(`NEW ${r.take.length} (${r.skipped.length} set aside):`); r.take.forEach((x) => console.log(`- ${x.key} | ${x.kind} | fit ${x.fit} | ${x.url} | ${x.about.slice(0, 120)}`)); }
    } else if (cmd === 'new') {
      const r = addFinds(readJson(rest[0], null) || (() => { throw new Error('Give a finds file: {"queries": [...], "finds": [{"name", "kind", "url", "about", "maker"}]}'); })());
      console.log(`${r.take.length} new to read closely; ${r.skipped.length} set aside.`); r.skipped.forEach(([x, why]) => console.log(`  set aside: ${x.name} (${why})`));
    } else if (cmd === 'queue') { const q = readJson(path.join(LOCAL(), 'queue.json'), []); if (!q.length) console.log('The queue is empty.'); q.forEach((x) => console.log(`${x.key} | ${x.kind} | fit ${x.fit} | ${x.maker} | ${x.url} | ${x.about.slice(0, 160)}`)); }
    else if (cmd === 'suggest') {
      const r = suggest(readJson(rest[0], []));
      r.refused.forEach(([n, why]) => console.log(`NEEDS|${n}: ${why}`));
      r.dropped.forEach(([n, why]) => console.log(`DROPPED|${n}: ${why}`));
      r.add.forEach((x) => console.log(`ADDED|${x.id}: ${x.say}`));
      if (r.held.length) console.log(`HELD|${r.held.length} kept for later (at most ${loadSwitch().max_open} wait at once)`);
      if (r.refused.length) process.exitCode = 1;
    } else if (cmd === 'answer') { const r = answer(rest[0], rest.slice(1).join('-')); console.log(`${r.idea.id}: ${r.w}. ${r.next}`); }
    else if (cmd === 'line') { const l = line(); if (l) console.log(l); }
    else if (cmd === 'export') console.log(JSON.stringify(exportOpen(), null, 1));
    else if (cmd === 'done') { const r = finish(today(), f); console.log(r.ledger); r.over.forEach((o) => console.log(`OVER BUDGET: ${o}`)); }
    else { console.log('Commands: dry, check, profile, plan, poll, new, queue, suggest, answer, line, export, done'); process.exitCode = 2; }
  } catch (err) { console.error(`NEEDS|${err.message}`); process.exitCode = 1; }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
