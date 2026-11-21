#!/usr/bin/env node
// The progress display (rule 11, and the opening of a sitrep). Keeps the list of what was asked for in the current
// piece of work, in system/progress.json, and prints one bar for the whole and one per request. Every percentage is
// COUNTED from steps done over steps planned (rule 5: never invent a number); a request with no steps planned shows
// its state in words and no number.
//
//   node core/engine/progress.mjs new "<the piece of work>"            starts a fresh list
//   node core/engine/progress.mjs add "<request, in their words>" [--steps "a; b; c"]
//   node core/engine/progress.mjs steps "<request>" "a; b; c"          sets its steps (steps already done stay done)
//   node core/engine/progress.mjs done "<request>" [<step name or number> | --all]   (no step: the next one)
//   node core/engine/progress.mjs state "<request>" "<a word or two>"  (stuck, waiting on you; "" clears it)
//   node core/engine/progress.mjs remove "<request>"
//   node core/engine/progress.mjs show                                 prints the display, in a fixed-width block
//   node core/engine/progress.mjs check [<file>]                       checks a display (or stdin): every bar matches its number
//
// A request is named by its words, or by its number in the list (1, 2, ...). The file: HIVE_PROGRESS, else
// system/progress.json in the notebook (HIVE_ROOT, else the folder above core/).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.env.HIVE_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FILE = process.env.HIVE_PROGRESS || path.join(ROOT, 'system', 'progress.json');
export const SEGMENTS = 20;
export const FULL = '█';
export const EMPTY = '░';
const today = () => process.env.HIVE_DATE || new Date().toISOString().slice(0, 10);

// ---------- the numbers: counted, rounded down, never more than was done ----------
export function percent(done, total) {
  if (!total) return null;
  return Math.floor((Math.min(done, total) / total) * 100);
}
export function bar(pct) {
  const full = Math.floor((pct * SEGMENTS) / 100);
  return FULL.repeat(full) + EMPTY.repeat(SEGMENTS - full);
}
const doneCount = (it) => (it.steps || []).filter((s) => s.done).length;
export function stateOf(it) {
  if (it.state) return it.state;
  const n = (it.steps || []).length, d = doneCount(it);
  if (!n) return 'not planned yet';
  if (d === n) return 'done';
  return d === 0 ? 'not started' : 'in work';
}

// ---------- the display ----------
// Two lines per request: its name in full (their words are never cut), then the bar, the number right-aligned in four
// places, and the state in a word or two. 20 + 1 + 4 + 2 + state: it fits a 40-character chat with a state of up to
// 13 letters, and lines up the same in a wide one.
export function render(list) {
  const items = (list && list.items) || [];
  const lines = [];
  const planned = items.filter((it) => (it.steps || []).length);
  const total = planned.reduce((a, it) => a + it.steps.length, 0);
  const done = planned.reduce((a, it) => a + doneCount(it), 0);
  const head = (list && list.work) ? list.work : 'All of it';
  const all = percent(done, total);
  if (all === null) {
    lines.push(head, 'no steps planned yet');
  } else {
    lines.push(`${head}: ${done} of ${total} steps`, `${bar(all)} ${String(all).padStart(3)}%  overall`);
  }
  if (items.length) lines.push('');
  for (const it of items) {
    lines.push(it.name);
    const p = percent(doneCount(it), (it.steps || []).length);
    lines.push(p === null ? stateOf(it) : `${bar(p)} ${String(p).padStart(3)}%  ${stateOf(it)}`);
  }
  return lines.join('\n');
}

// ---------- the program's own check of a display ----------
// Every bar line must hold SEGMENTS segments and a number whose rounded-down share of segments is the filled part;
// a "<n> of <m> steps" line must agree with the overall number under it. Returns the faults ([] when right).
const BAR_LINE = new RegExp(`^([${FULL}${EMPTY}]+)\\s+(\\d{1,3})%`);
export function checkDisplay(text) {
  const faults = [];
  const lines = String(text).replace(/\r/g, '').split('\n');
  lines.forEach((l, i) => {
    const m = l.trim().match(BAR_LINE);
    if (!m) return;
    const segs = m[1], pct = Number(m[2]);
    const filled = [...segs].filter((c) => c === FULL).length;
    if ([...segs].length !== SEGMENTS) faults.push(`line ${i + 1}: the bar has ${[...segs].length} segments, not ${SEGMENTS}`);
    if (pct > 100) faults.push(`line ${i + 1}: ${pct}% is more than the whole`);
    else if (filled !== Math.floor((pct * SEGMENTS) / 100)) faults.push(`line ${i + 1}: the bar shows ${filled} of ${SEGMENTS} segments, but its number is ${pct}%`);
    if (/[^\s]/.test(segs.replace(new RegExp(`^${FULL}*${EMPTY}*$`), ''))) faults.push(`line ${i + 1}: an empty segment comes before a filled one`);
    const prev = (lines[i - 1] || '').match(/(\d+) of (\d+) steps\s*$/);
    if (prev && /overall\s*$/.test(l) && percent(Number(prev[1]), Number(prev[2])) !== pct) faults.push(`line ${i + 1}: ${prev[1]} of ${prev[2]} steps is ${percent(Number(prev[1]), Number(prev[2]))}%, not ${pct}%`);
  });
  return faults;
}

// ---------- the list ----------
export function load(file = FILE) {
  try { const j = JSON.parse(fs.readFileSync(file, 'utf8')); return { work: j.work || '', updated: j.updated || '', items: Array.isArray(j.items) ? j.items : [] }; }
  catch { return { work: '', updated: '', items: [] }; }
}
function save(list, file = FILE) {
  list.updated = today();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(list, null, 2) + '\n');
}
const splitSteps = (s) => String(s || '').split(/;|\n/).map((x) => x.trim()).filter(Boolean);
function find(list, key) {
  const k = String(key || '').trim();
  if (/^\d+$/.test(k) && list.items[Number(k) - 1]) return list.items[Number(k) - 1];
  const it = list.items.find((x) => x.name.toLowerCase() === k.toLowerCase());
  if (!it) throw new Error(`"${k}" is not in the list. The list: ${list.items.map((x, i) => `${i + 1}. ${x.name}`).join('; ') || 'empty'}`);
  return it;
}
export function apply(list, cmd, args) {
  const flag = (name) => { const i = args.indexOf(name); if (i < 0) return undefined; const v = args[i + 1]; args.splice(i, 2); return v === undefined ? '' : v; };
  if (cmd === 'new') return { work: args.join(' ').trim(), updated: '', items: [] };
  if (cmd === 'add') {
    const steps = flag('--steps');
    const name = args.join(' ').trim();
    if (!name) throw new Error('Give the request in their words: add "<request>"');
    if (list.items.some((x) => x.name.toLowerCase() === name.toLowerCase())) throw new Error(`"${name}" is already in the list`);
    list.items.push({ name, steps: splitSteps(steps).map((s) => ({ name: s, done: false })), state: '' });
    return list;
  }
  const it = find(list, args[0]);
  if (cmd === 'steps') {
    const old = new Map((it.steps || []).map((s) => [s.name.toLowerCase(), s.done]));
    it.steps = splitSteps(args[1]).map((s) => ({ name: s, done: !!old.get(s.toLowerCase()) }));
  } else if (cmd === 'done') {
    const which = args[1];
    if (!(it.steps || []).length) throw new Error(`"${it.name}" has no steps yet; set them first: steps "${it.name}" "a; b; c"`);
    if (which === '--all') it.steps.forEach((s) => { s.done = true; });
    else if (which === undefined) { const next = it.steps.find((s) => !s.done); if (next) next.done = true; }
    else if (/^\d+$/.test(which) && it.steps[Number(which) - 1]) it.steps[Number(which) - 1].done = true;
    else { const s = it.steps.find((x) => x.name.toLowerCase() === String(which).toLowerCase()); if (!s) throw new Error(`"${which}" is not a step of "${it.name}"`); s.done = true; }
  } else if (cmd === 'state') it.state = String(args[1] || '').trim();
  else if (cmd === 'remove') list.items = list.items.filter((x) => x !== it);
  else throw new Error('Commands: new, add, steps, done, state, remove, show, check');
  return list;
}

function main(argv) {
  const [cmd, ...args] = argv;
  if (!cmd || cmd === 'show') { console.log(render(load())); return 0; }
  if (cmd === 'check') {
    const text = args[0] ? fs.readFileSync(args[0], 'utf8') : fs.readFileSync(0, 'utf8');
    const f = checkDisplay(text);
    console.log(f.length ? 'WRONG: ' + f.join('; ') : 'RIGHT: every bar matches its number');
    return f.length ? 1 : 0;
  }
  const list = apply(load(), cmd, args);
  save(list);
  console.log(render(list));
  return 0;
}
const isMain = process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
if (isMain) {
  try { process.exitCode = main(process.argv.slice(2)); } catch (e) { console.error(String(e && e.message || e)); process.exitCode = 2; }
}
