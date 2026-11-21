#!/usr/bin/env node
// The registry: one list of skills, connectors, protocols and preferences (gap review C1, C2, C8).
// A person and a program read the same list; every other list is made from it.
//
//   node core/engine/registry.mjs seed                      fill the list the first time (never overwrites an entry)
//   node core/engine/registry.mjs add --id x --kind skill [--state ..] [--source ..] [--fits a,b] [--model ..]
//                                     [--review ..] [--enforce ..] [--text ".."] [--by ".."] [--about ".."]
//   node core/engine/registry.mjs set <id> <field> <value>
//   node core/engine/registry.mjs remove <id> --reason ".."  (keeps the entry, state removed; deletes no file)
//   node core/engine/registry.mjs list [--kind k] [--state s] [--fits f]
//   node core/engine/registry.mjs find <words>               which entries fit a task
//   node core/engine/registry.mjs render                     writes system/generated/ (never the Claude folder)
//   node core/engine/registry.mjs check                      OK|text or NEEDS|text lines
//   node core/engine/registry.mjs apply <set> [--size light|standard|full] [--dry-run]   a ready-made starting set in one step
//   node core/engine/registry.mjs list --set <set> [--size ..] what a set holds
//   node core/engine/registry.mjs sizes [<set>]              its three sizes in plain words, and what each leaves out
//
// A set (kind "set") names members (skills, connectors, rules, habits) and may extend other sets.
// "apply" does what needs no yes (marks built-in parts, writes a habit line) and PRINTS, in order, each step
// that needs your yes (a marketplace, a plugin, a connector). It installs and connects nothing itself (rule 1).
// Every skill and connector carries an "install" recipe: the exact way to get it.
//
// Places: HIVE_ROOT (the notebook), CLAUDE_DIR (the Claude folder, read only), HIVE_DATE (for tests),
//         HIVE_PLUGIN_LIST (a file holding `claude plugin list` output, or "none"; without it the program asks `claude plugin list`).
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = process.env.HIVE_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLAUDE = process.env.CLAUDE_DIR || path.join(os.homedir(), '.claude');
const REG = path.join(ROOT, 'system', 'registry.json');
const GEN = path.join(ROOT, 'system', 'generated');
const today = () => process.env.HIVE_DATE || (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();

export const KINDS = ['skill', 'connector', 'protocol', 'preference', 'set'];
export const RECIPES = ['plugin', 'built-in', 'connector', 'folder', 'app', 'unconfirmed'];
export const STATES = ['active', 'installed-unused', 'listed-not-installed', 'removed'];
export const SOURCES = ['folder', 'plugin', 'directory', 'vendor', 'third-party', 'owner'];
export const MODELS = ['smallest', 'middle', 'strongest'];
const FIELDS = ['id', 'kind', 'state', 'source', 'fits', 'model', 'review', 'enforce', 'text', 'added', 'by', 'reason', 'about', 'group', 'install', 'members', 'extends', 'after', 'applied', 'default', 'light', 'standard', 'size'];
// A starting set comes in three sizes, picked first; the set itself (the kind of person) is picked second.
// members is the Full list; light and standard are lists inside it (light within standard within full).
export const SIZES = ['light', 'standard', 'full'];
export const SIZE_WORDS = {
  light: 'Light: the essentials, the fewest extra parts in every chat, the cheapest on the simplest Claude plan',
  standard: 'Standard: the essentials and the next most useful tools for this kind of work',
  full: 'Full: everything reviewed for this kind of work',
};
export const TEXT_ONLY = 'text only: nothing checks this yet';

// Skills Claude Code brings with it; they have no folder in the Claude folder (checked against the skill list of 2026-11-18).
const BUILT_IN = ['code-review', 'simplify', 'init', 'security-review', 'run', 'loop', 'schedule', 'update-config',
  'fewer-permission-prompts', 'keybindings-help', 'plugin-authoring', 'claude-api'];
// Skills that arrive with a plugin but carry no prefix in the skill list.
const PLUGIN_BARE = ['dataviz'];
const PLUGIN_PREFIX = /^(anthropic-skills|engineering|productivity|data|vercel|apify):/;
// Rules the gap review (section B, 2026-11-18) says a program holds, and the check that holds each.
const HELD = {
  9: 'privacy check at every save (core/guard/privacy-guard.mjs)',
  11: 'reply check: checkProgressMap (core/gates/gates.mjs)',
  15: 'ends check (system/ends-check.mjs)',
};
const KEYWORDS = [
  ['trading', /\b(stock|trading|trade|trader|portfolio|earnings|futures|market|dividend|options|backtest)/i],
  ['legal', /\b(legal|contract|law)\b/i],
  ['motion', /\b(animation|animate|motion|gsap)/i],
  ['design', /\b(design|UI|interface|frontend)\b/i],
  ['research', /\b(research|scrape|platform)/i],
  ['documents', /\b(docx|pdf|pptx|spreadsheet)/i],
  ['coding', /\b(code|codebase|debug|swift|API)\b/i],
];

// ---------- reading and writing the list ----------
export function load() {
  try { return JSON.parse(fs.readFileSync(REG, 'utf8')); } catch { return { version: 1, entries: [] }; }
}
function order(e) { const o = {}; for (const k of FIELDS) if (k in e) o[k] = e[k]; for (const k of Object.keys(e)) if (!(k in o)) o[k] = e[k]; return o; }
export function save(reg) {
  reg.entries = reg.entries.map(order).sort((a, b) => KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind) || a.id.localeCompare(b.id));
  fs.mkdirSync(path.dirname(REG), { recursive: true });
  fs.writeFileSync(REG, JSON.stringify(reg, null, 2) + '\n');
}
const blank = (id, kind) => ({ id, kind, state: 'active', source: '', fits: [], model: '', review: '', enforce: null, text: '', added: today(), by: '', reason: '' });
const find1 = (reg, id) => reg.entries.find((e) => e.id === id);

// ---------- small readers ----------
const readText = (p) => { try { return fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n'); } catch { return null; } };
const cells = (line) => line.split('|').slice(1, -1).map((c) => c.trim());
const isRule = (c) => /^:?-{2,}/.test(c.replace(/\s/g, ''));
// Every table in a text, as {header, rows, heading}.
function tables(text) {
  const out = []; let heading = ''; let cur = null;
  for (const line of (text || '').split('\n')) {
    const h = line.match(/^#{1,4}\s+(.*)/);
    if (h) { heading = h[1].trim(); cur = null; continue; }
    if (!line.startsWith('|')) { cur = null; continue; }
    const c = cells(line);
    if (!cur) { cur = { header: c, rows: [], heading }; out.push(cur); continue; }
    if (c.every(isRule)) continue;
    cur.rows.push(c);
  }
  return out;
}
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const ticks = (s) => [...s.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
function descriptionOf(dir) {
  const t = readText(path.join(dir, 'SKILL.md'));
  if (!t) return '';
  const head = t.slice(0, 3000);
  const m = head.match(/^description:[ \t]*(.*)$/m);
  if (!m) return '';
  let v = m[1].trim();
  if (/^[>|][+-]?$/.test(v) || v === '') {
    const rest = head.slice(m.index + m[0].length).split('\n').slice(1);
    const body = []; for (const l of rest) { if (/^\s+\S/.test(l)) body.push(l.trim()); else break; }
    v = body.join(' ');
  }
  return v.replace(/^["']|["']$/g, '').trim();
}
const short = (s, n = 160) => (s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : s);

// ---------- seed ----------
// The install recipe a seeded entry gets: only what is known; the rest says plainly that no route is confirmed.
const OFFICIAL = { engineering: 'knowledge-work-plugins', productivity: 'knowledge-work-plugins', data: 'knowledge-work-plugins' };
const DOCS = ['docx', 'pdf', 'pptx', 'xlsx'];
export function recipeFor(e) {
  const [pre, name] = e.id.split(':');
  if (e.kind === 'skill' && BUILT_IN.includes(e.id)) return { type: 'built-in' };
  if (e.kind === 'skill' && OFFICIAL[pre] && name) return { type: 'plugin', plugin: pre, marketplace: OFFICIAL[pre], source: 'anthropics/knowledge-work-plugins' };
  if (e.kind === 'skill' && pre === 'anthropic-skills' && DOCS.includes(name)) return { type: 'plugin', plugin: 'document-skills', marketplace: 'anthropic-agent-skills', source: 'anthropics/skills', note: `In Claude Code its skills show up as document-skills:${name}.` };
  if (e.kind === 'connector' && e.source === 'directory') return { type: 'connector', directory: e.id, link: 'https://claude.ai/directory' };
  return { type: 'unconfirmed', note: 'No install route is confirmed yet. Ask Claude to look it up before you rely on it.' };
}
export function seed() {
  const reg = load();
  const have = new Set(reg.entries.map((e) => e.id));
  const added = [];
  const put = (e) => {
    if (have.has(e.id)) return;
    if ((e.kind === 'skill' || e.kind === 'connector') && !e.install && e.source !== 'folder' && e.source !== 'owner') e.install = recipeFor(e);
    have.add(e.id); reg.entries.push(e); added.push(e);
  };
  const by = `seeded ${today()}`;

  // skills: folders, the two lists
  const skillsDir = path.join(CLAUDE, 'skills');
  let folders = [];
  try { folders = fs.readdirSync(skillsDir, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith('.')).map((d) => d.name); } catch {}
  const imported = new Map(); // id -> {group, about}
  const imp = readText(path.join(CLAUDE, 'IMPORTED_SKILLS.md'));
  for (const t of tables(imp)) {
    if (!/^skill$/i.test(t.header[0])) continue;
    for (const r of t.rows) for (const id of ticks(r[0] || '')) if (!imported.has(id)) imported.set(id, { group: t.heading.replace(/^Added .*/, 'Added later'), about: r[1] || '' });
  }
  const fitsOf = new Map(); // id -> [category words]
  const mapped = new Set();
  const map = readText(path.join(CLAUDE, 'SKILL_MAP.md'));
  for (const t of tables(map)) {
    const isCat = /^category$/i.test(t.header[0]) && t.header.some((h) => /^skills$/i.test(h));
    const isAgent = /^agent$/i.test(t.header[0]);
    if (!isCat && !isAgent) continue;
    const col = isCat ? t.header.findIndex((h) => /^skills$/i.test(h)) : t.header.findIndex((h) => /core skills/i.test(h));
    for (const r of t.rows) {
      const cat = isCat ? r[0].replace(/\*/g, '').toLowerCase() : '';
      for (let raw of (r[col] || '').split(',')) {
        const id = raw.replace(/\(.*?\)/g, '').replace(/[`*]/g, '').trim();
        if (!id || /\s/.test(id)) continue;
        mapped.add(id);
        if (cat) { if (!fitsOf.has(id)) fitsOf.set(id, []); if (!fitsOf.get(id).includes(cat)) fitsOf.get(id).push(cat); }
      }
    }
  }
  const listed = new Set([...imported.keys(), ...mapped]);
  const folderSet = new Set(folders);
  for (const id of folders) {
    const desc = descriptionOf(path.join(skillsDir, id));
    let fits = fitsOf.get(id) || [];
    if (!fits.length) { const k = KEYWORDS.find(([, re]) => re.test(desc)); if (k) fits = [k[0]]; }
    const e = blank(id, 'skill');
    Object.assign(e, { state: listed.has(id) ? 'active' : 'installed-unused', source: id.startsWith('hive-') ? 'owner' : 'folder', fits, by,
      review: id.startsWith('hive-') ? 'not-applicable' : '', about: short((imported.get(id) || {}).about || desc), group: (imported.get(id) || {}).group || '' });
    put(e);
  }
  for (const id of listed) {
    if (folderSet.has(id)) continue;
    const e = blank(id, 'skill');
    const plugin = PLUGIN_PREFIX.test(id) || PLUGIN_BARE.includes(id), builtIn = BUILT_IN.includes(id);
    Object.assign(e, { state: plugin || builtIn ? 'active' : 'listed-not-installed', source: plugin ? 'plugin' : builtIn ? 'vendor' : '',
      fits: fitsOf.get(id) || [], by, about: short((imported.get(id) || {}).about || ''), group: (imported.get(id) || {}).group || '' });
    put(e);
  }

  // connectors: the catalogue first, then the capability map
  const cat = readText(path.join(ROOT, 'system', 'catalogue.md'));
  const SRC = [[/^directory/i, 'directory'], [/^vendor/i, 'vendor'], [/^third/i, 'third-party'], [/^plugin/i, 'plugin']];
  for (const t of tables(cat)) {
    if (!(t.header[0] === 'Tool' && t.header[2] === 'Source' && t.header[3] === 'Status')) continue;
    for (const r of t.rows) {
      const name = r[0].replace(/\*/g, '').trim();
      if (!name || r[0].startsWith('**') || !r[2]) continue;
      const src = (SRC.find(([re]) => re.test(r[2])) || [, ''])[1];
      const st = r[3];
      const state = /dropped/i.test(st) ? 'installed-unused' : /^(connected|enabled)/i.test(st) ? 'active' : 'listed-not-installed';
      const e = blank(slug(name), 'connector');
      Object.assign(e, { state, source: src, review: src === 'directory' ? 'official' : src === 'plugin' ? '' : src ? 'needed' : '', by, about: short(r[1] || '') });
      put(e);
    }
  }
  const capText = readText(path.join(ROOT, 'system', 'capabilities.md')) || '';
  const notFor = new Set(); const useFor = [];
  for (const m of capText.matchAll(/Use for:\s*(.*?)\.\s*Not for this:\s*(.*?)(?:\.|\|)/gs)) {
    useFor.push(m[1]);
    for (let n of m[2].split(',')) { n = n.replace(/\(.*?\)/g, '').trim(); if (n && !/\s/.test(n)) notFor.add(n); }
  }
  const alias = (n) => (/^(Docs|Sheets|Slides)(\/|$)/.test(n) ? 'Google Docs, Sheets and Slides' : n);
  const names = new Set([...notFor].map(alias));
  if (/built-in browser/i.test(capText)) names.add('Built-in browser');
  if (/\bChrome\b/.test(capText)) names.add('Chrome');
  for (const name of names) {
    const probe = name === 'Google Docs, Sheets and Slides' ? /Docs|Sheets|Slides/ : new RegExp(name.replace(/-/g, '[- ]'), 'i');
    const used = useFor.some((u) => probe.test(u));
    const e = blank(slug(name), 'connector');
    Object.assign(e, { state: used ? 'active' : 'installed-unused', fits: [], by, about: used ? 'Named under "Use for" in system/capabilities.md' : 'Named under "Not for this" in system/capabilities.md; connection not checked' });
    put(e);
  }

  // protocols: the 15 rules
  const rules = readText(path.join(ROOT, 'system', 'rules.md')) || '';
  for (const m of rules.matchAll(/^(\d+)\.\s+(.+)$/gm)) {
    const n = Number(m[1]);
    const e = blank(`rule-${n}`, 'protocol');
    Object.assign(e, { state: 'active', source: 'owner', review: 'not-applicable', enforce: HELD[n] || null, text: short(m[2].split(/(?<=\.)\s/)[0], 200), by });
    put(e);
  }
  save(reg);
  return { added, reg };
}

// ---------- changing the list ----------
function parseFlags(args) {
  const f = {}; const rest = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) { f[args[i].slice(2)] = args[i + 1] !== undefined && !args[i + 1].startsWith('--') ? args[++i] : 'true'; } else rest.push(args[i]);
  }
  return { f, rest };
}
function coerce(field, value) {
  if (field === 'fits') return String(value).split(',').map((s) => s.trim()).filter(Boolean);
  if (field === 'enforce') return value === '' || value === 'null' ? null : value;
  if (field === 'members' || field === 'extends' || field === 'light' || field === 'standard') return String(value).split(',').map((s) => s.trim()).filter(Boolean);
  if (field === 'install' || field === 'after') {
    if (typeof value !== 'string') return value;
    try { return JSON.parse(value); } catch { throw new Error(`The ${field} field takes JSON, for example '{"type":"built-in"}'`); }
  }
  if (field === 'default') return value === true || value === 'true';
  return value;
}
const str = (v) => typeof v === 'string' && v.trim() !== '';
export function validateRecipe(r) {
  if (!r || typeof r !== 'object' || !RECIPES.includes(r.type)) throw new Error(`An install recipe needs a type: ${RECIPES.join(', ')}`);
  const need = { plugin: ['plugin', 'marketplace', 'source'], connector: ['directory', 'link'], folder: ['source', 'licence'], app: ['note'], unconfirmed: ['note'], 'built-in': [] }[r.type];
  const lack = need.filter((k) => !str(r[k]));
  if (lack.length) throw new Error(`A ${r.type} recipe needs: ${lack.join(', ')}`);
}
function validate(e) {
  if (e.install !== undefined && e.install !== null) validateRecipe(e.install);
  if (e.kind === 'set') {
    if (!Array.isArray(e.members) || !e.members.length) throw new Error(`The set "${e.id}" needs members`);
    if (e.after !== undefined && !(Array.isArray(e.after) && e.after.every(str))) throw new Error('"after" is a list of sentences');
    for (const k of ['light', 'standard']) if (e[k] !== undefined && !(Array.isArray(e[k]) && e[k].every(str))) throw new Error(`"${k}" is a list of names`);
    if (e.size !== undefined && e.size !== '' && !SIZES.includes(e.size)) throw new Error(`Size must be one of: ${SIZES.join(', ')}`);
  }
  if (!e.id || !/^[\w:.-]+$/.test(e.id)) throw new Error(`The id "${e.id}" is not valid`);
  if (!KINDS.includes(e.kind)) throw new Error(`Kind must be one of: ${KINDS.join(', ')}`);
  if (!STATES.includes(e.state)) throw new Error(`State must be one of: ${STATES.join(', ')}`);
  if (e.source && !SOURCES.includes(e.source)) throw new Error(`Source must be one of: ${SOURCES.join(', ')}`);
  if (e.model && !MODELS.includes(e.model)) throw new Error(`Model must be one of: ${MODELS.join(', ')} (or empty)`);
}
export function add(f) {
  const reg = load();
  if (find1(reg, f.id)) throw new Error(`"${f.id}" is already in the registry; use set to change it`);
  const e = blank(f.id, f.kind);
  for (const k of FIELDS) if (k in f && k !== 'added') e[k] = coerce(k, f[k]);
  validate(e);
  reg.entries.push(e); save(reg); return e;
}
export function set(id, field, value) {
  const reg = load(); const e = find1(reg, id);
  if (!e) throw new Error(`"${id}" is not in the registry`);
  if (!FIELDS.includes(field)) throw new Error(`Unknown field "${field}". Fields: ${FIELDS.join(', ')}`);
  e[field] = coerce(field, value);
  validate(e); save(reg); return e;
}
export function remove(id, reason) {
  const reg = load(); const e = find1(reg, id);
  if (!e) throw new Error(`"${id}" is not in the registry`);
  if (!reason) throw new Error('Give the reason with --reason');
  e.state = 'removed'; e.reason = reason; save(reg); return e;
}
export function list(f = {}) {
  const reg = load();
  let pool = reg.entries;
  if (f.set) {
    const s = findSet(reg, f.set);
    if (!s) throw new Error(`There is no set called "${f.set}". Sets: ${reg.entries.filter((e) => e.kind === 'set').map((e) => e.id).join(', ') || 'none yet'}`);
    pool = membersOf(reg, s, [], f.size || 'full');
  }
  return pool.filter((e) => (!f.kind || e.kind === f.kind) && (!f.state || e.state === f.state) && (!f.fits || (e.fits || []).includes(f.fits)));
}

// ---------- starting sets ----------
const findSet = (reg, id) => reg.entries.find((e) => e.kind === 'set' && e.id === id);
// The names a set holds at one size: full is members; standard and light are the set's own lists (a set without
// them holds the same at every size).
export function sizeIds(s, size = 'full') {
  if (!SIZES.includes(size)) throw new Error(`There is no size called "${size}". Sizes: ${SIZES.join(', ')}`);
  if (size === 'full') return s.members || [];
  if (size === 'standard') return s.standard || s.members || [];
  return s.light || s.standard || s.members || [];
}
// May a starting list name this entry? Rules and habits always; a skill or connector only when it is free and
// already cleared: Anthropic's own (built in, in the app, or from Anthropic's plugin catalogues) or an official
// directory connector, and never one whose review is still needed or that carries a price.
const OWN_CATALOGUES = ['claude-plugins-official', 'anthropic-agent-skills', 'knowledge-work-plugins'];
export function cleared(e) {
  if (!e) return false;
  if (e.kind === 'protocol' || e.kind === 'preference') return true;
  if (e.review === 'needed' || e.paid || e.cost) return false;
  const r = e.install || {};
  if (e.review === 'official') return true;
  if (r.type === 'built-in' || r.type === 'app') return true;
  return r.type === 'plugin' && (OWN_CATALOGUES.includes(r.marketplace) || /^anthropics\//.test(String(r.source || '')));
}
// The members of a set in order: the sets it extends first, then its own. A name that is not in the registry throws.
export function membersOf(reg, s, seen = [], size = 'full') {
  if (seen.includes(s.id)) throw new Error(`The set "${s.id}" extends itself`);
  const out = []; const have = new Set();
  const put = (e) => { if (!have.has(e.id)) { have.add(e.id); out.push(e); } };
  for (const x of s.extends || []) {
    const base = findSet(reg, x);
    if (!base) throw new Error(`The set "${s.id}" extends "${x}", which is not a set in the registry`);
    membersOf(reg, base, [...seen, s.id], size).forEach(put);
  }
  const missing = [];
  for (const id of sizeIds(s, size)) { const e = find1(reg, id); if (!e) missing.push(id); else put(e); }
  if (missing.length) throw new Error(`The set "${s.id}" names ${missing.join(', ')}, which ${missing.length > 1 ? 'are' : 'is'} not in the registry`);
  return out;
}
// What `claude plugin list` says is installed, as a Set of "name@marketplace"; null when it cannot be known.
export function pluginList() {
  const env = process.env.HIVE_PLUGIN_LIST;
  let text = null;
  if (env === 'none') return null;
  if (env) text = readText(env);
  else {
    try {
      const r = spawnSync('claude', ['plugin', 'list'], { encoding: 'utf8', timeout: 20000, shell: process.platform === 'win32', env: { ...process.env, CLAUDE_CONFIG_DIR: CLAUDE } });
      if (r.status === 0 && r.stdout) text = r.stdout;
    } catch {}
  }
  if (text === null) return null;
  return new Set([...text.matchAll(/([A-Za-z0-9_.-]+)@([A-Za-z0-9_.-]+)/g)].map((m) => m[0]));
}
const pluginPresent = (e, pl) => !!pl && [...pl].some((p) => p === `${e.install.plugin}@${e.install.marketplace}`);
// Is a member that is marked in use really there? true, false, or null when this program cannot tell.
function really(e, folders, pl) {
  const r = e.install || {};
  if (e.kind === 'skill') {
    if (e.source === 'folder' || e.source === 'owner' || r.type === 'folder') return folders.includes(e.id);
    if (r.type === 'built-in') return BUILT_IN.includes(e.id);
    if (r.type === 'plugin') return pl ? pluginPresent(e, pl) : null;
    return null;
  }
  if (e.kind === 'connector' && r.type === 'plugin') return pl ? pluginPresent(e, pl) : null;
  return null;
}
const folderNames = () => { try { return fs.readdirSync(path.join(CLAUDE, 'skills'), { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith('.')).map((d) => d.name); } catch { return []; } };

// Work out what applying a set means, without writing anything.
export function planSet(reg, s, size = 'full') {
  const pl = pluginList(); const folders = folderNames();
  const plan = { set: s, size, marks: [], done: [], already: [], skipped: [], market: [], installs: [], connects: [], copies: [], words: [], habits: [], pluginsKnown: !!pl };
  const plugins = new Map(); const marketsSeen = new Set();
  for (const e of membersOf(reg, s, [], size)) {
    if (e.state === 'removed') { plan.skipped.push(`${e.id}: you removed it (${e.reason || 'no reason kept'}), so it is left out`); continue; }
    if (e.state === 'active') { plan.already.push(e.id); continue; }
    const r = e.install;
    if (e.kind === 'preference' || e.kind === 'protocol') {
      plan.marks.push(e.id); plan.done.push(`${e.kind === 'preference' ? 'Keep the habit' : 'Switch on the rule'} "${e.id}": ${e.text}`);
      if (e.kind === 'preference') plan.habits.push(e); continue;
    }
    if (!r) { plan.words.push(`${e.id}: no install recipe is written for it, so Claude cannot tell you the steps yet`); continue; }
    if (r.type === 'built-in') { plan.marks.push(e.id); plan.done.push(`${e.id} comes built into Claude Code: marked as in use`); }
    else if (r.type === 'plugin') {
      if (pluginPresent(e, pl)) { plan.marks.push(e.id); plan.done.push(`${e.id} is already installed (${r.plugin}): marked as in use`); continue; }
      if (!plugins.has(`${r.plugin}@${r.marketplace}`)) plugins.set(`${r.plugin}@${r.marketplace}`, { r, ids: [] });
      plugins.get(`${r.plugin}@${r.marketplace}`).ids.push(e.id);
      if (r.source !== 'auto' && !marketsSeen.has(r.marketplace)) { marketsSeen.add(r.marketplace); plan.market.push({ marketplace: r.marketplace, source: r.source }); }
    } else if (r.type === 'connector') plan.connects.push({ id: e.id, r });
    else if (r.type === 'folder') plan.copies.push({ id: e.id, r });
    else if (r.type === 'app') plan.words.push(`${e.id}: ${r.note}`);
    else plan.words.push(`${e.id}: no install route is confirmed. ${r.note}`);
  }
  for (const [key, v] of plugins) plan.installs.push({ key, plugin: v.r.plugin, marketplace: v.r.marketplace, ids: v.ids });
  plan.after = s.after || [];
  return plan;
}
const HABIT_DATE = () => today();
export function apply(id, { dry = false, size } = {}) {
  const reg = load(); const s = findSet(reg, id);
  if (!s) throw new Error(`There is no set called "${id}". Sets: ${reg.entries.filter((e) => e.kind === 'set').map((e) => e.id).join(', ') || 'none yet'}`);
  size = size || s.size || 'full';
  const plan = planSet(reg, s, size);
  const lines = []; const say = (t = '') => lines.push(t);
  let changed = false;
  if (!dry) {
    for (const mid of plan.marks) { const e = find1(reg, mid); e.state = 'active'; changed = true; }
    if (!s.applied) { s.applied = today(); changed = true; }
    if (s.size !== size) { s.size = size; changed = true; }
    // One kind is chosen at a time: another set chosen before is no longer the person's (what it put in place stays).
    for (const o of reg.entries) if (o.kind === 'set' && o.id !== s.id && o.size) { delete o.size; changed = true; }
    if (changed) save(reg);
    const prefPath = path.join(ROOT, 'system', 'preferences.md');
    const prefs = readText(prefPath);
    for (const h of plan.habits) {
      if (prefs === null) { plan.words.push(`The habit "${h.id}" is in the list, but system/preferences.md does not exist, so no line was written there`); continue; }
      const cur = readText(prefPath);
      if (!cur.includes(h.text)) { fs.appendFileSync(prefPath, `${cur.endsWith('\n') ? '' : '\n'}- ${HABIT_DATE()}: ${h.text}\n`); changed = true; }
    }
  }
  if (!dry && changed) render(); // keeps system/generated in step; the Claude folder is never touched
  say(`Set "${s.id}"${s.default ? ' (the default)' : ''}, size ${size}: ${s.about || ''}${dry ? '  [dry run: nothing is written]' : ''}`);
  const out = leftOut(reg, s, size);
  if (out.length) say(`${size === 'light' ? 'Light' : 'Standard'} leaves out: ${out.join(', ')}. One sentence adds them ("switch to Full").`);
  const beyond = reg.entries.filter((e) => e.state === 'active' && (e.kind === 'skill' || e.kind === 'connector') && (s.members || []).includes(e.id) && !sizeIds(s, size).includes(e.id)).map((e) => e.id);
  if (beyond.length) say(`Already in use but not in ${size}: ${beyond.join(', ')}. They stay as they are; removing one needs your word.`);
  say(`Already in place: ${plan.already.length} (${plan.already.join(', ') || 'none'}). The rules, the helpers and the three starting habits come with every set.`);
  if (!plan.pluginsKnown && plan.installs.length) say('Note: Claude Code was not found or would not list its plugins, so no plugin could be counted as installed yet.');
  if (plan.skipped.length) { say('Left out:'); plan.skipped.forEach((t) => say(`  - ${t}`)); }
  say(dry ? 'Would do now, with no yes needed:' : 'Done now, with no yes needed:');
  if (!plan.done.length) say('  - nothing');
  plan.done.forEach((t) => say(`  - ${t}`));
  const steps = [];
  for (const m of plan.market) steps.push(`Add the plugin catalogue "${m.marketplace}" (once): /plugin marketplace add ${m.source}`);
  for (const p of plan.installs) steps.push(`Install the plugin "${p.plugin}" ${p.ids.length === 1 && p.ids[0] === p.plugin ? '' : ` (brings ${p.ids.join(', ')})`}: /plugin install ${p.key}`);
  for (const c of plan.connects) {
    const plans = (find1(reg, c.id) || {}).plans;
    steps.push(`Connect "${c.r.directory}" (${c.id}): open ${c.r.link}, find "${c.r.directory}", press Connect, and sign in yourself. ${c.r.note || ''}${plans ? ` ${c.r.directory}: ${plans}` : ''}`.replace(/\s+/g, ' ').trim());
  }
  for (const c of plan.copies) steps.push(`Copy the skill "${c.id}" from ${c.r.source} (licence: ${c.r.licence}) into your Claude folder's skills folder`);
  say(steps.length ? 'Needs your yes, in this order (Claude asks before each one; nothing here was done):' : 'Needs your yes: nothing.');
  steps.forEach((t, i) => say(`  ${i + 1}. ${t}`));
  if (plan.words.length) { say('Worth knowing:'); plan.words.forEach((t) => say(`  - ${t}`)); }
  plan.after.forEach((t) => say(`Also: ${t}`));
  if (!dry) say(changed ? 'Written: system/registry.json' + (plan.habits.length ? ' and system/preferences.md' : '') + '.' : 'Nothing changed: this set was already applied.');
  return { lines, changed, plan, steps };
}
// The skills and connectors a size leaves out of the Full list of that set.
export function leftOut(reg, s, size) {
  if (size === 'full') return [];
  const have = new Set(membersOf(reg, s, [], size).map((e) => e.id));
  return membersOf(reg, s, [], 'full').filter((e) => !have.has(e.id) && (e.kind === 'skill' || e.kind === 'connector')).map((e) => e.id);
}
// What each size of one set holds and costs, in plain words, from the registry alone. The cost is said as what each
// added part brings into every chat; the words a plugin's skills add were not measured in this copy, so it says so.
export function sizes(id) {
  const reg = load(); const s = findSet(reg, id);
  if (!s) throw new Error(`There is no set called "${id}". Sets: ${reg.entries.filter((e) => e.kind === 'set').map((e) => e.id).join(', ') || 'none yet'}`);
  const lines = [`The ${s.id} set, three sizes (${s.about || ''}):`];
  for (const z of SIZES) {
    const m = membersOf(reg, s, [], z);
    const n = (k) => m.filter((e) => e.kind === k).length;
    lines.push(`- ${SIZE_WORDS[z]}. ${n('skill')} skill(s) and ${n('connector')} connection(s), each added only on your yes: ${m.filter((e) => e.kind === 'skill' || e.kind === 'connector').map((e) => e.id + ((e.install || {}).type === 'built-in' ? ' (built into Claude Code)' : '')).join(', ') || 'none'}.`);
    const out = leftOut(reg, s, z);
    if (out.length) lines.push(`  It leaves out: ${out.join(', ')}.`);
    // A service with paid plans of its own says so in one plain line (the ruling of 2026-11-20), wherever it appears,
    // Light included (the ruling of 2026-11-21, "Yes, wherever it appears").
    for (const e of m) if (e.plans) lines.push(`  ${(e.install && e.install.directory) || e.id}: ${e.plans}`);
  }
  lines.push('What it costs on the simplest plan: Hive Mind itself is the same at every size. Each skill you add puts its name and a short description into every chat, and each connection adds its tools; how many words that is for these parts was not measured in this copy. The fewer you add, the more of your plan is left for your own work.');
  lines.push('To change it later, say one sentence ("switch to Standard", "make me a builder").');
  return lines;
}
export function findFor(words) {
  const ws = String(words).toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2);
  const scored = [];
  for (const e of load().entries) {
    if (e.state === 'removed') continue;
    const fits = (e.fits || []).join(' ').toLowerCase(); const id = e.id.toLowerCase(); const body = `${e.about || ''} ${e.text || ''}`.toLowerCase();
    let s = 0;
    for (const w of ws) {
      const stem = w.length > 5 ? w.slice(0, 5) : w;
      if (fits.includes(stem)) s += 3;
      if (id.includes(stem)) s += 3;
      if (body.includes(stem)) s += 1;
    }
    if (s) scored.push([s + (e.state === 'active' ? 0.5 : 0), e]);
  }
  return scored.sort((a, b) => b[0] - a[0] || a[1].id.localeCompare(b[1].id)).slice(0, 12).map(([, e]) => e);
}

// ---------- render ----------
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const STATE_WORDS = { active: 'in use', 'installed-unused': 'installed, not used yet', 'listed-not-installed': 'named, not installed', removed: 'removed' };
const SOURCE_WORDS = { folder: 'skill folder', plugin: 'plugin', directory: 'Claude directory', vendor: 'maker or built in', 'third-party': 'third party', owner: 'yours' };
const REVIEW_WORDS = { official: 'official', needed: 'safety review still needed', 'not-applicable': '' };
const cell = (s) => String(s || '').replace(/\|/g, '/').replace(/\n/g, ' ');

export function renderAll() {
  const reg = load(); const E = reg.entries; const date = today();
  const files = {};
  const kindIntro = {
    skill: 'Skills are packaged instructions Claude loads for a kind of task.',
    connector: 'Connectors and tools are outside services Claude can reach.',
    protocol: 'Protocols are the always-rules. Each says what holds it.',
    preference: 'Preferences are things you said you always or never want.',
    set: 'Starting sets are ready-made groups of skills, connectors and habits, each put in place in one step. Every set also holds the rules, the helpers and the three starting habits.',
  };
  let md = `# Registry: skills, connectors, rules and preferences\n\nMade from system/registry.json on ${date}. Do not edit this page; say what to add, remove or change and it is done in the list.\n\n`;
  const count = (k, s) => E.filter((e) => e.kind === k && e.state === s).length;
  md += `In short: ${E.filter((e) => e.kind === 'skill' && e.state !== 'removed').length} skills (${count('skill', 'active')} in use, ${count('skill', 'installed-unused')} installed but not used yet, ${count('skill', 'listed-not-installed')} named but not installed), ${E.filter((e) => e.kind === 'connector' && e.state !== 'removed').length} connectors and tools, ${E.filter((e) => e.kind === 'protocol').length} rules (${E.filter((e) => e.kind === 'protocol' && e.enforce).length} held by a check, ${E.filter((e) => e.kind === 'protocol' && !e.enforce).length} text only), ${E.filter((e) => e.kind === 'preference').length} preferences.\n\n`;
  for (const k of KINDS) {
    const items = E.filter((e) => e.kind === k);
    md += `## ${cap(k === 'connector' ? 'connectors and tools' : k + 's')}\n\n${kindIntro[k]}\n\n`;
    if (!items.length) { md += '_None yet._\n\n'; continue; }
    if (k === 'protocol' || k === 'preference') {
      for (const e of items) md += `- **${e.id}**${e.state === 'removed' ? ' (removed: ' + e.reason + ')' : ''}: ${e.text || '(no wording yet)'} ${e.enforce ? `Held by: ${e.enforce}.` : `(${TEXT_ONLY})`}\n`;
      md += '\n'; continue;
    }
    if (k === 'set') {
      for (const e of items) {
        let mem, lt = '', st = ''; try { mem = membersOf(reg, e).map((m) => m.id).join(', '); } catch (err) { mem = `(cannot be listed: ${err.message})`; }
        if (e.light || e.standard) { try { lt = membersOf(reg, e, [], 'light').map((m) => m.id).join(', '); st = membersOf(reg, e, [], 'standard').map((m) => m.id).join(', '); } catch {} }
        md += `- **${e.id}**${e.default ? ' (the default)' : ''}: ${e.about || ''} Full holds: ${mem}.${lt ? ` Light: ${lt}. Standard: ${st}.` : ''}${e.applied ? ` Chosen on ${e.applied}${e.size ? `, size ${e.size}` : ''}.` : ''}\n`;
      }
      md += '\n'; continue;
    }
    const groups = new Map();
    for (const e of items) { const g = e.state === 'removed' ? 'removed' : (e.fits || [])[0] || 'not sorted yet'; if (!groups.has(g)) groups.set(g, []); groups.get(g).push(e); }
    for (const g of [...groups.keys()].sort((a, b) => (a === 'removed') - (b === 'removed') || (a === 'not sorted yet') - (b === 'not sorted yet') || a.localeCompare(b))) {
      md += `### ${cap(g)}\n\n| Name | State | From | Review | What it is for |\n| --- | --- | --- | --- | --- |\n`;
      for (const e of groups.get(g)) md += `| ${cell(e.id)} | ${STATE_WORDS[e.state]} | ${SOURCE_WORDS[e.source] || 'not recorded'} | ${e.review === 'needed' ? REVIEW_WORDS.needed : (REVIEW_WORDS[e.review] || (e.review ? 'reviewed ' + e.review : 'not recorded'))} | ${cell(e.state === 'removed' ? 'Removed: ' + e.reason : e.about)} |\n`;
      md += '\n';
    }
  }
  files['registry.md'] = md.trimEnd() + '\n';

  // the two lists in the Claude folder, same shape as today's
  const skills = E.filter((e) => e.kind === 'skill' && e.state !== 'removed' && e.state !== 'listed-not-installed');
  const catUse = {};
  const oldMap = readText(path.join(CLAUDE, 'SKILL_MAP.md')) || '';
  for (const t of tables(oldMap)) if (/^category$/i.test(t.header[0])) for (const r of t.rows) catUse[r[0].replace(/\*/g, '').toLowerCase()] = [r[0], r[1]];
  const cats = new Map();
  for (const e of skills) for (const c of e.fits || []) { if (!cats.has(c)) cats.set(c, []); cats.get(c).push(e.id); }
  const catOrder = [...Object.keys(catUse), ...[...cats.keys()].filter((c) => !(c in catUse)).sort()];
  let sm = `# Skill map by category\n\nMade from the registry (system/registry.json) on ${date}. Used to pick the skills that fit a task. A skill can sit in more than one category.\n\n| Category | Use for | Skills |\n|---|---|---|\n`;
  for (const c of catOrder) if (cats.has(c)) sm += `| **${(catUse[c] || [cap(c)])[0].replace(/\*/g, '')}** | ${(catUse[c] || [])[1] || ''} | ${cats.get(c).sort().join(', ')} |\n`;
  const unsorted = skills.filter((e) => !(e.fits || []).length).map((e) => e.id).sort();
  if (unsorted.length) sm += `| **Not sorted yet** | Installed, with no category | ${unsorted.join(', ')} |\n`;
  // Sections you added under the category table (a "## " heading of your own after it) are kept as they are.
  const own = oldMap.match(/\n## (?![\s\S]*\|\s*\**Category\**\s*\|)[\s\S]*$/i);
  sm += own ? own[0].replace(/\s+$/, '') + '\n' : '';
  files['SKILL_MAP.md'] = sm;

  let im = `# My imported skills (from ~/.claude/skills)\n\nMade from the registry (system/registry.json) on ${date}. Prefer these and invoke every one that fits, quietly. Built-in and plugin skills are the fallback when nothing here fits.\n\n`;
  const groups = new Map();
  for (const e of skills.filter((e) => e.source === 'folder' || e.source === 'owner')) { const g = e.state === 'installed-unused' ? 'Installed, in none of the lists' : e.group || 'Installed, in none of the lists'; if (!groups.has(g)) groups.set(g, []); groups.get(g).push(e); }
  for (const g of groups.keys()) {
    im += `## ${g}\n| Skill | Use it for |\n|---|---|\n`;
    for (const e of groups.get(g).sort((a, b) => a.id.localeCompare(b.id))) im += `| \`${e.id}\` | ${cell(e.about)} |\n`;
    im += '\n';
  }
  files['IMPORTED_SKILLS.md'] = im.trimEnd() + '\n';
  return files;
}
export function render() {
  const files = renderAll();
  fs.mkdirSync(GEN, { recursive: true });
  for (const [n, t] of Object.entries(files)) fs.writeFileSync(path.join(GEN, n), t);
  return Object.keys(files);
}

// ---------- check ----------
export function check() {
  const reg = load(); const E = reg.entries; const out = []; const say = (ok, t) => out.push(`${ok ? 'OK' : 'NEEDS'}|${t}`);
  const skillsDir = path.join(CLAUDE, 'skills');
  let folders = [];
  try { folders = fs.readdirSync(skillsDir, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith('.')).map((d) => d.name); } catch {}
  const ids = new Set(E.map((e) => e.id));
  const unregistered = folders.filter((n) => !ids.has(n));
  say(unregistered.length === 0, `Every installed skill folder is in the registry (${folders.length} folders)` + (unregistered.length ? `; missing: ${unregistered.slice(0, 5).join(', ')}${unregistered.length > 5 ? ', ...' : ''}` : ''));
  const gone = E.filter((e) => e.kind === 'skill' && e.state === 'active' && (e.source === 'folder' || e.source === 'owner') && !folders.includes(e.id)).map((e) => e.id);
  say(gone.length === 0, 'Every active skill from a folder is installed' + (gone.length ? `; not found on disk: ${gone.slice(0, 5).join(', ')}` : ''));
  let gen = renderAll(); const stale = [];
  for (const [n, t] of Object.entries(gen)) { const cur = readText(path.join(GEN, n)); if (cur === null || cur.replace(/on \d{4}-\d{2}-\d{2}/, '') !== t.replace(/on \d{4}-\d{2}-\d{2}/, '')) stale.push(n); }
  say(stale.length === 0, 'The generated lists are up to date with the registry' + (stale.length ? `; behind: ${stale.join(', ')} (run render)` : ''));
  const protos = E.filter((e) => e.kind === 'protocol' && e.state !== 'removed');
  const md = readText(path.join(GEN, 'registry.md')) || '';
  const bad = protos.filter((p) => !p.enforce && (!p.text || !md.includes(`**${p.id}**`) || !md.includes(TEXT_ONLY)));
  say(protos.length > 0 && bad.length === 0, `Every protocol is held by a check or marked text only (${protos.filter((p) => p.enforce).length} held, ${protos.filter((p) => !p.enforce).length} text only)` + (bad.length ? `; unclear: ${bad.map((p) => p.id).join(', ')}` : ''));
  const wrong = E.filter((e) => { try { validate(e); return false; } catch { return true; } }).map((e) => e.id);
  say(wrong.length === 0, 'Every entry has a valid kind, state, source and model' + (wrong.length ? `; check: ${wrong.slice(0, 5).join(', ')}` : ''));
  // install recipes: every skill or connector that is named but not installed says how to get it
  const norecipe = E.filter((e) => (e.kind === 'skill' || e.kind === 'connector') && e.state === 'listed-not-installed' && !e.install).map((e) => e.id);
  say(norecipe.length === 0, 'Every skill and connector that is named but not installed has an install recipe' + (norecipe.length ? `; missing: ${norecipe.slice(0, 5).join(', ')}${norecipe.length > 5 ? ', ...' : ''}` : ''));
  // sets: each names only things in the registry, and exactly one is the default
  const sets = E.filter((e) => e.kind === 'set' && e.state !== 'removed');
  const problems = [];
  for (const s of sets) { try { membersOf(reg, s); } catch (err) { problems.push(err.message); } }
  const defaults = sets.filter((s) => s.default).length;
  if (sets.length) {
    say(problems.length === 0, `Every starting set names only things that are in the registry (${sets.length} sets)` + (problems.length ? `; ${problems[0]}` : ''));
    say(defaults === 1, `Exactly one starting set is the default` + (defaults === 1 ? ` (${sets.find((s) => s.default).id})` : `; found ${defaults}`));
    // the three sizes: light within standard within full, and only free, cleared things in any of them
    const nest = []; const uncleared = [];
    for (const s of sets) {
      const full = new Set(sizeIds(s, 'full')), std = sizeIds(s, 'standard'), lt = sizeIds(s, 'light');
      if (!std.every((x) => full.has(x)) || !lt.every((x) => std.includes(x))) nest.push(s.id);
      // The ready-made sets the copy ships with (by "starting set"); a set the person makes holds what they chose.
      if (s.by === 'starting set') for (const x of full) { const e = find1(reg, x); if (e && !cleared(e)) uncleared.push(`${x} (in ${s.id})`); }
    }
    say(nest.length === 0, 'Every starting set\'s sizes nest: Light within Standard within Full' + (nest.length ? `; not so in: ${nest.join(', ')}` : ''));
    say(uncleared.length === 0, 'Every ready-made starting set names only free things that are Anthropic\'s own or official directory connectors' + (uncleared.length ? `; not cleared: ${uncleared.slice(0, 5).join(', ')}` : ''));
  }
  // what a chosen set marks as in use is really there
  const pl = pluginList(); const fol = folderNames();
  for (const s of sets.filter((x) => x.applied)) {
    let mem; try { mem = membersOf(reg, s); } catch { continue; }
    const live = mem.filter((e) => e.state === 'active' && (e.kind === 'skill' || e.kind === 'connector'));
    const absent = live.filter((e) => really(e, fol, pl) === false).map((e) => e.id);
    const waiting = mem.filter((e) => e.state === 'listed-not-installed').map((e) => e.id);
    say(absent.length === 0, `Set "${s.id}" (chosen ${s.applied}): everything it marks as in use is really there${absent.length ? `; not found: ${absent.join(', ')}` : ''}; ${waiting.length} still waiting for your yes${waiting.length && waiting.length <= 6 ? ` (${waiting.join(', ')})` : ''}`);
  }
  return out;
}

// ---------- command line ----------
function summary() {
  const E = load().entries; const n = (k, s) => E.filter((e) => e.kind === k && (!s || e.state === s)).length;
  return [`skills: ${n('skill', 'active')} in use, ${n('skill', 'installed-unused')} installed not used, ${n('skill', 'listed-not-installed')} named not installed, ${n('skill', 'removed')} removed`,
    `connectors: ${n('connector')} (${n('connector', 'active')} in use)`,
    `protocols: ${n('protocol')} (${E.filter((e) => e.kind === 'protocol' && e.enforce).length} held, ${E.filter((e) => e.kind === 'protocol' && !e.enforce).length} text only)`,
    `preferences: ${n('preference')}`];
}
const line = (e) => `${e.id} | ${e.kind} | ${e.state} | ${(e.fits || []).join(',')}${e.about ? ' | ' + short(e.about, 80) : ''}${e.text ? ' | ' + short(e.text, 80) : ''}`;

function main(argv) {
  const [cmd, ...args] = argv; const { f, rest } = parseFlags(args);
  try {
    if (cmd === 'seed') { const { added } = seed(); console.log(`Seeded: ${added.length} new entries.`); summary().forEach((l) => console.log(l)); }
    else if (cmd === 'add') { const e = add(f); console.log(`Added ${e.kind} ${e.id}.`); }
    else if (cmd === 'set') { const e = set(rest[0], rest[1], rest.slice(2).join(' ')); console.log(`Changed ${e.id}: ${rest[1]}.`); }
    else if (cmd === 'remove') { const e = remove(rest[0], f.reason); console.log(`Removed ${e.id} (kept in the list, with the reason). No file was deleted.`); }
    else if (cmd === 'list') list(f).forEach((e) => console.log(line(e)));
    else if (cmd === 'apply') {
      // `--dry-run` may sit before the name; then parseFlags took the name as its value.
      const dry = f['dry-run'] !== undefined;
      const name = rest[0] || (dry && f['dry-run'] !== 'true' ? f['dry-run'] : undefined);
      if (!name) throw new Error('Say which set: node core/engine/registry.mjs apply <set> [--size light|standard|full] [--dry-run]');
      apply(name, { dry, size: f.size }).lines.forEach((l) => console.log(l));
    }
    else if (cmd === 'sizes') { sizes(rest[0] || (load().entries.find((e) => e.kind === 'set' && e.default) || {}).id).forEach((l) => console.log(l)); }
    else if (cmd === 'find') { const r = findFor(rest.join(' ')); if (!r.length) console.log('Nothing in the registry fits those words.'); r.forEach((e) => console.log(line(e))); }
    else if (cmd === 'render') { console.log(`Wrote ${render().map((n) => 'system/generated/' + n).join(', ')}. The Claude folder was not touched.`); }
    else if (cmd === 'check') { const o = check(); o.forEach((l) => console.log(l)); process.exitCode = o.some((l) => l.startsWith('NEEDS')) ? 1 : 0; }
    else { console.log('Commands: seed, add, set, remove, list, find, render, check, apply, sizes'); process.exitCode = 2; }
  } catch (err) { console.error(`NEEDS|${err.message}`); process.exitCode = 1; }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
