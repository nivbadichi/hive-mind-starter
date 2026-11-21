#!/usr/bin/env node
// The full stack checklist, kept for every project (promise 13, 2026-11-18).
// The list of lines is the table in system/stack.md (one source). Each project keeps its own copy in projects/<name>/stack.md,
// one row per line: used, not needed (with the reason), missing, or not yet (from a stage).
//
//   node core/engine/stack.mjs new <project> [--tags code,web,..]   write projects/<name>/stack.md from the template
//   node core/engine/stack.mjs check [project]                       OK|text or NEEDS|text lines
//   node core/engine/stack.mjs next <project>                        the three most important missing lines, with how to use each
//   node core/engine/stack.mjs summary                               one line per project
//   node core/engine/stack.mjs set <project> <id> <status> "<detail>" [--where ".."] [--from <stage>]
//   node core/engine/stack.mjs sync <project>                        add the lines system/stack.md gained since the note was made
//
// Places: HIVE_ROOT (the notebook), HIVE_DATE (for tests). Reads and writes only inside the notebook; sends nothing anywhere.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.env.HIVE_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const today = () => process.env.HIVE_DATE || (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();

export const STAGES = ['discover', 'define', 'plan', 'design', 'build', 'verify', 'release', 'maintain', 'close'];
export const STATUSES = ['used', 'not needed', 'missing', 'not yet'];
export const TAGS = ['code', 'web', 'data', 'users', 'money', 'email', 'public', 'ai', 'private', 'employer'];
const COLS = ['Id', 'Line', 'Status', 'Detail', 'From', 'Date', 'Where'];
const MIN_REASON = 8;

const readText = (p) => { try { return fs.readFileSync(p, 'utf8').replace(/^﻿/, '').replace(/\r\n/g, '\n'); } catch { return null; } };
const cells = (line) => line.split('|').slice(1, -1).map((c) => c.trim());
const isRule = (c) => /^:?-{2,}/.test(c.replace(/\s/g, ''));
const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').replace(/\|/g, '/').trim();
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const stageIdx = (s) => STAGES.indexOf(s);

// ---------- the kit: the table in system/stack.md ----------
export function parseKit() {
  const text = readText(path.join(ROOT, 'system', 'stack.md'));
  if (text === null) throw new Error('system/stack.md was not found, so there is no list of lines');
  const kit = []; let inTable = false; let group = '';
  for (const line of text.split('\n')) {
    if (!line.startsWith('|')) { inTable = false; continue; }
    const c = cells(line);
    if (!inTable) { if (c[0] === 'Id' && c[1] === 'Line') inTable = true; continue; }
    if (c.every(isRule)) continue;
    if (!c[0]) { if (c[1]) group = c[1].replace(/\*/g, '').replace(/^\d+\.\s*/, '').trim(); continue; }
    kit.push({ id: c[0], line: c[1], what: c[2], for: c[3].split(',').map((t) => t.trim()).filter(Boolean), from: c[4], def: c[5], how: c[6], group });
  }
  if (!kit.length) throw new Error('system/stack.md has no checklist table (header: Id | Line | ...)');
  return kit;
}

// ---------- projects ----------
export function stageWord(stateText) {
  const st = ((stateText || '').match(/^stage:\s*(.+?)\s*$/m) || [])[1] || '';
  if (/^not set up/i.test(st)) return 'not set up';
  if (/^paused/i.test(st)) return 'paused';
  const w = st.toLowerCase().match(/^[a-z]+/);
  return w && STAGES.includes(w[0]) ? w[0] : '';
}
export function projectDirs() {
  try { return fs.readdirSync(path.join(ROOT, 'projects'), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort(); } catch { return []; }
}
export function projectInfo(s) {
  const text = readText(path.join(ROOT, 'projects', s, 'state.md'));
  if (text === null) return null;
  const get = (k) => ((text.match(new RegExp(`^${k}:\\s*(.+?)\\s*$`, 'm')) || [])[1] || '');
  return { slug: s, name: get('project') || s, kind: get('kind').toLowerCase(), stage: stageWord(text), text };
}
const needsNote = (info) => info && info.stage && info.stage !== 'not set up' && info.stage !== 'paused';
const notePath = (s) => path.join(ROOT, 'projects', s, 'stack.md');

// A guess from the project's own words; the tags are written in the note and can be changed.
export function inferTags(text, kind = '') {
  const t = String(text || ''); const tags = new Set(['code']);
  const rules = [
    ['web', /\b(web ?site|web app|dashboard|front end|front website|screens?|pages?)\b/i],
    ['data', /\b(database|back end|backend|persist|guest list|rsvp|accounts?|records)\b/i],
    ['users', /\b(sign.?in|log ?in|customers?|guests?|vendors?|roles?)\b/i],
    ['money', /\b(payments?|checkout|billing|subscriptions?|stripe)\b/i],
    ['email', /\b(e-?mail|invitations?|newsletter)\b/i],
    ['public', /\b(public|launch|customers?|front website)\b/i],
    ['ai', /\b(ai model|llm|embeddings?|search by meaning)\b/i],
    ['private', /\b(locked|only the user opens|private page)\b/i],
  ];
  for (const [tag, re] of rules) if (re.test(t)) tags.add(tag);
  if (/^employer/.test(kind)) tags.add('employer');
  return [...tags];
}

// ---------- the note: reading ----------
export function parseNote(text) {
  const t = String(text || '').replace(/^﻿/, '').replace(/\r\n/g, '\n');
  const fm = (t.match(/^---\n([\s\S]*?)\n---/) || [])[1] || '';
  const tags = ((fm.match(/^tags:\s*(.*)$/m) || [])[1] || '').split(',').map((x) => x.trim()).filter(Boolean);
  const rows = []; let inTable = false;
  for (const line of t.split('\n')) {
    if (!line.startsWith('|')) { inTable = false; continue; }
    const c = cells(line);
    if (!inTable) { if (c[0] === 'Id') inTable = true; continue; }
    if (c.every(isRule)) continue;
    const r = {}; COLS.forEach((k, i) => { r[k.toLowerCase()] = c[i] ?? ''; });
    r.cellCount = c.length; rows.push(r);
  }
  return { tags, rows };
}

// ---------- the note: writing ----------
const rowText = (r) => `| ${[r.id, r.line, r.status, r.detail, r.from, r.date, r.where].map(clean).join(' | ')} |`;
function prefill(k, tags, stage, o) {
  const fits = k.for.includes('all') || k.for.some((x) => tags.includes(x));
  const base = { id: k.id, line: k.line, from: k.from, date: today(), where: '-' };
  if (!fits) return { ...base, status: 'not needed', detail: `Not a ${k.for.join(' or ')} project: the tags set when this note was made do not include it. Change the tags if that is wrong.` };
  if (k.id === 'purpose' && o.purposeKnown) return { ...base, status: 'used', detail: 'The project note says what it is for.', where: `projects/${o.slug}/state.md` };
  if (k.id === 'builder') return { ...base, status: 'used', detail: 'Claude builds; the strongest model plans and reviews.', where: 'system/stack.md (the kit, row Building)' };
  if (stageIdx(k.from) > stageIdx(stage)) return { ...base, status: 'not yet', detail: `Needed from ${k.from}.` };
  return { ...base, status: 'missing', detail: 'Not checked yet: say whether it is used or not needed.' };
}
export function renderNote(info, tags, kit, existing, o = {}) {
  const stage = info.stage;
  const lines = [];
  const tpl = readText(path.join(ROOT, 'core', 'templates', 'project-stack.md'));
  const head = (tpl || '---\nproject: <project name>\ntags: <tags>\nupdated: <date>\n---\n\n# Full stack checklist: <project name>\n\n<!-- lines -->\n')
    .replace(/<project name>/g, info.name).replace('<tags>', tags.join(', ')).replace('<date>', today());
  const groups = []; for (const k of kit) { if (!groups.includes(k.group)) groups.push(k.group); }
  groups.forEach((g, i) => {
    lines.push(`## ${i + 1}. ${g}`, '', `| ${COLS.join(' | ')} |`, `| ${COLS.map(() => '---').join(' | ')} |`);
    for (const k of kit.filter((x) => x.group === g)) lines.push(rowText(existing.get(k.id) || prefill(k, tags, stage, { ...o, slug: info.slug })));
    lines.push('');
  });
  const known = new Set(kit.map((k) => k.id)); const extra = [...existing.values()].filter((r) => !known.has(r.id));
  if (extra.length) { lines.push('## Other lines', '', `| ${COLS.join(' | ')} |`, `| ${COLS.map(() => '---').join(' | ')} |`, ...extra.map(rowText), ''); }
  const body = lines.join('\n').replace(/\n+$/, '\n');
  return head.includes('<!-- lines -->') ? head.replace('<!-- lines -->', body) : head + '\n' + body;
}

export function newNote(s, o = {}) {
  const info = projectInfo(s);
  if (!info) throw new Error(`projects/${s}/state.md was not found`);
  if (!needsNote(info)) throw new Error(`${info.name} is "${info.stage || 'no stage'}": a stack note is made once it is set up and not paused`);
  if (fs.existsSync(notePath(s))) throw new Error(`projects/${s}/stack.md already exists; it was not touched (use sync to add new lines)`);
  const kit = parseKit();
  const tags = (o.tags && o.tags.length ? o.tags : inferTags(info.text, info.kind));
  const bad = tags.filter((x) => !TAGS.includes(x));
  if (bad.length) throw new Error(`Unknown tag: ${bad.join(', ')}. Tags: ${TAGS.join(', ')}`);
  if (/^employer/.test(info.kind) && !tags.includes('employer')) tags.push('employer');
  fs.writeFileSync(notePath(s), renderNote(info, tags, kit, new Map(), o));
  return { info, tags, path: notePath(s) };
}
export function syncNote(s) {
  const info = projectInfo(s); const raw = readText(notePath(s));
  if (!info || raw === null) throw new Error(`projects/${s}/stack.md was not found (use new)`);
  const kit = parseKit(); const { tags, rows } = parseNote(raw);
  const existing = new Map(rows.map((r) => [r.id, r]));
  const added = kit.filter((k) => !existing.has(k.id)).map((k) => k.id);
  fs.writeFileSync(notePath(s), renderNote(info, tags, kit, existing));
  return { added };
}
export function setRow(s, id, status, detail, o = {}) {
  const raw = readText(notePath(s));
  if (raw === null) throw new Error(`projects/${s}/stack.md was not found (use new)`);
  if (!STATUSES.includes(status)) throw new Error(`The status must be one of: ${STATUSES.join(', ')}`);
  if (!clean(detail)) throw new Error('Say the detail: what it is, the reason, or what is missing');
  if (o.from && !STAGES.includes(o.from)) throw new Error(`The stage must be one of: ${STAGES.join(', ')}`);
  const lines = raw.split('\n'); let hit = -1; let old = null;
  lines.forEach((l, i) => { if (l.startsWith('|')) { const c = cells(l); if (c[0] === id) { hit = i; old = c; } } });
  if (hit < 0) throw new Error(`The line "${id}" is not in projects/${s}/stack.md (run sync to add new lines)`);
  const where = clean(o.where) || (old[6] && old[6] !== '-' ? old[6] : '-');
  if (status === 'used' && (where === '-' || !where)) throw new Error('A used line says where it lives: add --where "<path or place>"');
  if (status === 'not needed' && clean(detail).length < MIN_REASON) throw new Error('A not needed line carries a real reason (at least a short sentence)');
  lines[hit] = rowText({ id, line: old[1], status, detail, from: o.from || old[4], date: today(), where });
  let out = lines.join('\n').replace(/^(updated:\s*).*$/m, `$1${today()}`);
  fs.writeFileSync(notePath(s), out);
}

// ---------- checking ----------
function read(s) {
  const info = projectInfo(s); const raw = readText(notePath(s));
  return { info, note: raw === null ? null : parseNote(raw) };
}
export function counts(rows) {
  const n = { used: 0, 'not needed': 0, missing: 0, 'not yet': 0 };
  for (const r of rows) if (r.status in n) n[r.status]++;
  return n;
}
const due = (r, stage) => STAGES.includes(r.from) && stageIdx(r.from) <= stageIdx(stage);

export function checkProject(s) {
  const out = []; const say = (ok, t) => out.push(`${ok ? 'OK' : 'NEEDS'}|${t}`);
  const { info, note } = read(s);
  if (!info) { say(false, `Project ${s} has no state note, so its stack checklist cannot be checked`); return out; }
  if (!needsNote(info)) return out;
  const P = `Project ${info.name}`;
  if (!note) { say(false, `${P}: has no full stack checklist (run: node core/engine/stack.mjs new ${s})`); return out; }
  let kit; try { kit = parseKit(); } catch (e) { say(false, `${P}: ${e.message}`); return out; }
  const byId = new Map(); const problems = [];
  const bad = (t) => { problems.push(t); say(false, `${P}: ${t}`); };
  for (const r of note.rows) {
    const label = r.line || r.id || '(unnamed line)';
    const blank = COLS.filter((k, i) => !clean(r[k.toLowerCase()]) || i >= r.cellCount);
    if (blank.length) { bad(`stack line "${label}" is blank (${blank.join(', ')} is empty)`); continue; }
    if (byId.has(r.id)) { bad(`stack line "${label}" appears twice`); continue; }
    byId.set(r.id, r);
    if (!STATUSES.includes(r.status)) { bad(`stack line "${label}" has the status "${r.status}"; it must be used, not needed, missing or not yet`); continue; }
    if (!STAGES.includes(r.from)) { bad(`stack line "${label}" has "${r.from}" in From; it must be a stage (${STAGES.join(', ')})`); continue; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date)) { bad(`stack line "${label}" has no real date`); continue; }
    if (r.status === 'not needed' && r.detail.length < MIN_REASON) bad(`stack line "${label}" is marked not needed with no reason`);
    else if (r.status === 'used' && r.where === '-') bad(`stack line "${label}" is marked used but does not say where it lives`);
    else if (r.status === 'missing' && due(r, info.stage)) bad(`still missing, due since ${r.from}: ${label}`);
    else if (r.status === 'not yet' && due(r, info.stage)) bad(`"${label}" was marked not yet, but the project has reached ${r.from}: mark it used or missing`);
  }
  const lack = kit.filter((k) => !byId.has(k.id) && !note.rows.some((r) => r.id === k.id)).map((k) => k.id);
  if (lack.length) bad(`the note lacks ${lack.length} line(s) the kit has now: ${lack.slice(0, 4).join(', ')}${lack.length > 4 ? ', ...' : ''} (run: node core/engine/stack.mjs sync ${s})`);
  const known = new Set(kit.map((k) => k.id));
  const extra = note.rows.filter((r) => r.id && !known.has(r.id)).map((r) => r.id);
  if (extra.length) bad(`the note has line(s) the kit does not: ${extra.slice(0, 4).join(', ')}`);
  if (!problems.length) {
    const n = counts(note.rows);
    say(true, `${P}: full stack checklist complete for ${info.stage} (${n.used} used, ${n.missing} missing but not due, ${n['not needed']} not needed, ${n['not yet']} not yet)`);
  }
  return out;
}
export function check(only) {
  const dirs = only ? [only] : projectDirs(); const out = [];
  for (const s of dirs) out.push(...checkProject(s));
  return out;
}

// ---------- next and summary ----------
export function nextLines(s, limit = 3) {
  const { info, note } = read(s);
  if (!info) throw new Error(`projects/${s}/state.md was not found`);
  if (!note) throw new Error(`projects/${s}/stack.md was not found (run: node core/engine/stack.mjs new ${s})`);
  const kit = parseKit(); const order = new Map(kit.map((k, i) => [k.id, i]));
  const open = note.rows.filter((r) => r.status === 'missing' || (r.status === 'not yet' && due(r, info.stage)))
    .filter((r) => order.has(r.id) && STAGES.includes(r.from))
    .sort((a, b) => (due(b, info.stage) - due(a, info.stage)) || (stageIdx(a.from) - stageIdx(b.from)) || (order.get(a.id) - order.get(b.id)));
  if (!open.length) return [`Nothing missing for ${info.name} at ${info.stage}.`];
  return open.slice(0, limit).map((r, i) => {
    const k = kit.find((x) => x.id === r.id);
    return `${i + 1}. ${k.line} (${due(r, info.stage) ? `due since ${r.from}` : `due from ${r.from}`}): ${k.what} Default: ${k.def}. How to use it: ${k.how}`;
  });
}
export function summaryLines() {
  const out = [];
  for (const s of projectDirs()) {
    const info = projectInfo(s); if (!info) continue;
    if (!needsNote(info)) { out.push(`${info.name}: ${info.stage || 'no stage'}, no stack checklist needed yet`); continue; }
    const { note } = read(s);
    if (!note) { out.push(`${info.name}: no stack checklist yet`); continue; }
    const n = counts(note.rows); const d = note.rows.filter((r) => (r.status === 'missing' || r.status === 'not yet') && due(r, info.stage)).length;
    out.push(`${info.name}: ${n.used} used, ${n.missing} missing (${d} due now), ${n['not needed']} not needed, ${n['not yet']} not yet`);
  }
  return out;
}

// ---------- command line ----------
function main(argv) {
  const [cmd, ...args] = argv; const f = {}; const rest = [];
  for (let i = 0; i < args.length; i++) { if (args[i].startsWith('--')) f[args[i].slice(2)] = args[i + 1] !== undefined && !args[i + 1].startsWith('--') ? args[++i] : 'true'; else rest.push(args[i]); }
  try {
    if (cmd === 'new') {
      const r = newNote(slug(rest[0] || ''), { tags: f.tags ? f.tags.split(',').map((x) => x.trim()).filter(Boolean) : null });
      const n = counts(parseNote(fs.readFileSync(r.path, 'utf8')).rows);
      console.log(`Wrote projects/${slug(rest[0])}/stack.md for ${r.info.name} (stage ${r.info.stage}; tags: ${r.tags.join(', ')}): ${n.missing} missing, ${n['not yet']} not yet, ${n['not needed']} not needed, ${n.used} used. Mark each line truthfully with: set.`);
    } else if (cmd === 'check') {
      const o = check(rest[0] && slug(rest[0])); o.forEach((l) => console.log(l)); process.exitCode = o.some((l) => l.startsWith('NEEDS')) ? 1 : 0;
    } else if (cmd === 'next') { nextLines(slug(rest[0] || '')).forEach((l) => console.log(l)); }
    else if (cmd === 'summary') { summaryLines().forEach((l) => console.log(l)); }
    else if (cmd === 'set') {
      // The status may be two words (not needed, not yet), quoted or not.
      const tail = rest.slice(2).join(' '); const st = STATUSES.find((x) => tail === x || tail.startsWith(x + ' ')) || rest[2];
      setRow(slug(rest[0] || ''), rest[1], st, tail.slice(st.length).trim(), { where: f.where, from: f.from }); console.log(`Changed ${rest[1]} in projects/${slug(rest[0])}/stack.md.`); }
    else if (cmd === 'sync') { const r = syncNote(slug(rest[0] || '')); console.log(r.added.length ? `Added ${r.added.length} line(s): ${r.added.join(', ')}.` : 'The note already has every line.'); }
    else { console.log('Commands: new <project> [--tags ..], check [project], next <project>, summary, set <project> <id> <status> "<detail>" [--where ..] [--from ..], sync <project>'); process.exitCode = 2; }
  } catch (e) { console.error(`NEEDS|${e.message}`); process.exitCode = 1; }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
