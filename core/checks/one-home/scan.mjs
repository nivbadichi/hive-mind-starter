#!/usr/bin/env node
// Rule 8, "one home for each truth", held by a program. It reads notes and reports; it never changes a note.
// Used two ways:
//   1. The health check runs it on the whole notebook:   node core/checks/one-home/scan.mjs
//      It prints "OK|text" or "NEEDS|text" lines and exits 1 when anything needs work.
//   2. The save step (check.mjs, before a Write or Edit) asks it about the lines a save would add.
// What it finds:
//   - the same fact stated in two living notes with different values (a count, a size, a state);
//   - a living note stamped "Updated: <day>" whose own lines are newer than that stamp;
//   - a line older than its own "review by <day>";
//   - a line that says a file is missing when the file exists, and (outside the folders the notes check
//     already covers) a pointer to a file that does not exist.
// Place: HIVE_ROOT (the notebook) and HIVE_TODAY (YYYY-MM-DD), for tests.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULTS = JSON.parse(fs.readFileSync(path.join(HERE, 'settings.json'), 'utf8'));
const DATED = /(20\d\d-\d\d-\d\d)/;
const ISO = /\b(20\d\d)-(\d\d)-(\d\d)\b/g;
// The folders the notes check (core/engine/notes-check.mjs) already covers for missing pointers: not repeated here.
const NOTES_CHECK_SCOPE = ['system/', 'knowledge/', 'core/skills/', 'projects/'];

const posix = (p) => p.split(path.sep).join('/');
const norm = (v) => String(v).replace(/,/g, '').trim().toLowerCase();

// ---------- which notes are living truths, which are history ----------

export function classify(rel, settings = DEFAULTS) {
  rel = posix(rel);
  const parts = rel.split('/');
  if (parts.some((p) => (settings.neverRead || []).includes(p))) return null;
  if (!(settings.noteEndings || ['.md']).some((e) => rel.endsWith(e))) return null;
  if ((settings.historyFolders || []).includes(parts[0])) return { kind: 'history', date: (rel.match(DATED) || [])[1] || null };
  if ((settings.livingExtra || []).includes(rel)) return { kind: 'living', date: null };
  const dir = parts.slice(0, -1).join('/');
  const date = (parts[parts.length - 1].match(DATED) || [])[1];
  const inLiving = (settings.livingFolders || []).some((f) => dir === f || (f === 'projects' && dir.startsWith('projects/')) || (f === 'knowledge' && dir.startsWith('knowledge')));
  // Notes under system/ that are not living (designs, plans, reviews) are history: dated by their name, or undated.
  if (!inLiving) return rel.startsWith('system/') ? { kind: 'history', date: date || null } : null;
  if (date) return { kind: 'history', date };
  if ((settings.historyFiles || []).includes(rel)) return { kind: 'history', date: null };
  return { kind: 'living', date: null };
}

export function listNotes(root, settings = DEFAULTS) {
  const out = [];
  const walk = (relDir) => {
    let entries = [];
    try { entries = fs.readdirSync(path.join(root, relDir), { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const r = relDir ? `${relDir}/${e.name}` : e.name;
      if (e.isDirectory()) { if (!(settings.neverRead || []).includes(e.name)) walk(r); continue; }
      const c = classify(r, settings);
      if (c) out.push({ rel: r, ...c });
    }
  };
  const tops = new Set([...(settings.livingFolders || []), ...(settings.historyFolders || [])].map((f) => f.split('/')[0]));
  tops.add('system');
  for (const t of tops) walk(t);
  return out;
}

// ---------- facts ----------

const compiled = new WeakMap();
function rx(settings) {
  if (compiled.has(settings)) return compiled.get(settings);
  const c = {
    facts: (settings.facts || []).map((f) => ({ ...f, re: new RegExp(f.pattern, 'gi') })),
    states: (settings.states || []).map((s) => ({ ...s, on: new RegExp(s.on, 'i'), off: new RegExp(s.off, 'i') })),
    stop: new Set(settings.labelStopWords || []),
    planned: new RegExp(settings.plannedWords, 'i'),
    missing: new RegExp(settings.missingWords, 'i'),
    stamp: new RegExp(settings.stampWords, 'im'),
    review: new RegExp(settings.reviewWords, 'gi'),
  };
  compiled.set(settings, c);
  return c;
}

const GENERIC = /\b([a-z][a-z-]{1,30}(?: [a-z][a-z-]{1,30}){0,2}) (\d[\d,]*) of (\d[\d,]*)\b/gi;

// Every fact a line states: { key, value, about }.
export function factsIn(line, settings = DEFAULTS) {
  const c = rx(settings);
  const found = [];
  const taken = [];
  const numbers = /\d/.test(line);
  if (numbers) for (const f of c.facts) {
    f.re.lastIndex = 0;
    for (const m of line.matchAll(f.re)) {
      const value = m.slice(1).filter((x) => x !== undefined).map(norm).join(' of ');
      found.push({ key: f.id, value, about: f.about });
      taken.push([m.index, m.index + m[0].length]);
    }
  }
  if (numbers && line.includes(' of ')) for (const m of line.matchAll(GENERIC)) {
    const end = m.index + m[0].length;
    if (taken.some(([a, b]) => m.index < b && end > a)) continue;
    const words = m[1].toLowerCase().split(' ').filter((w) => !c.stop.has(w));
    if (!words.length || words.join('').length < 4) continue;
    words[words.length - 1] = words[words.length - 1].replace(/s$/, '');
    const label = words.join(' ');
    found.push({ key: `count: ${label}`, value: `${norm(m[2])} of ${norm(m[3])}`, about: `the count "${label}"` });
  }
  for (const s of c.states) {
    if (s.on.test(line)) found.push({ key: s.id, value: 'on', about: s.about, state: true });
    else if (s.off.test(line)) found.push({ key: s.id, value: 'off', about: s.about, state: true });
  }
  return found;
}

function stripCode(text) { return text.replace(/```[\s\S]*?```/g, (b) => b.replace(/[^\n]/g, ' ')); }

// The facts of a whole note, each with its line number.
export function noteFacts(text, settings = DEFAULTS) {
  const out = [];
  stripCode(text).split(/\r?\n/).forEach((line, i) => {
    for (const f of factsIn(line, settings)) out.push({ ...f, line: i + 1 });
  });
  return out;
}

// ---------- dates ----------

export const isoDates = (text) => [...text.matchAll(ISO)].map((m) => `${m[1]}-${m[2]}-${m[3]}`);

export function stampOf(text, settings = DEFAULTS) {
  const head = text.replace(/^﻿/, '').split(/\r?\n/).slice(0, 15).join('\n');
  const m = head.match(rx(settings).stamp);
  return m ? m[1] : null;
}

// A stamp older than the newest day the note itself speaks of (days after today are plans, not news).
export function stampBehind(text, today, settings = DEFAULTS) {
  const stamp = stampOf(text, settings);
  if (!stamp) return null;
  const newest = isoDates(stripCode(text)).filter((d) => d <= today).sort().pop();
  return newest && newest > stamp ? { stamp, newest } : null;
}

export function reviewsPast(text, today, settings = DEFAULTS) {
  const out = [];
  const re = rx(settings).review;
  text.split(/\r?\n/).forEach((line, i) => {
    re.lastIndex = 0;
    for (const m of line.matchAll(re)) if (m[1] < today) out.push({ line: i + 1, date: m[1] });
  });
  return out;
}

// ---------- pointers ----------

export function pointersIn(line, settings = DEFAULTS) {
  const out = new Set();
  for (const m of line.matchAll(/`([^`\n]+)`/g)) out.add(m[1].trim().replace(/^\.\//, ''));
  for (const m of line.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) out.add(m[1].split('#')[0]);
  return [...out].filter((t) => (settings.pointerPrefixes || []).some((p) => t.startsWith(p))
    && !/[\s*<>$~{}|?]|\.\.\./.test(t) && !/YYYY|<|>/.test(t) && /\.[a-z0-9]+$/i.test(t));
}

// The words right around one pointer, inside its clause (cut at a table bar, a semicolon or the end of a
// sentence): up to 25 characters before it and 40 after. A missing-word there speaks of that file.
export function nearOf(line, target) {
  const clause = line.split(/\s\|\s|;|\.\s/).find((p) => p.includes(target)) || '';
  const at = clause.indexOf(target);
  if (at < 0) return '';
  return clause.slice(Math.max(0, at - 25), at) + ' ' + clause.slice(at + target.length, at + target.length + 40);
}

export function pointerProblems(rel, text, root, settings = DEFAULTS, { skipNotesCheckScope = true } = {}) {
  const c = rx(settings);
  const missing = [];
  const claimedMissing = [];
  stripCode(text).split(/\r?\n/).forEach((line, i) => {
    for (const t of pointersIn(line, settings)) {
      const there = fs.existsSync(path.join(root, t));
      if (!there && !c.planned.test(line.replace(/`[^`\n]*`|\]\([^)]*\)/g, ' ')) && !(skipNotesCheckScope && NOTES_CHECK_SCOPE.some((s) => t.startsWith(s)))) missing.push({ line: i + 1, target: t });
      if (there && c.missing.test(nearOf(line, t))) claimedMissing.push({ line: i + 1, target: t });
    }
  });
  return { missing, claimedMissing };
}

// ---------- the index of living facts, cached for the save step ----------

// Each gate call is a fresh program, so the facts of each living note are kept in the state folder
// (one-home-index.json), keyed by the note's size and time of change; only a changed note is read again.
const CACHE_FILE = 'one-home-index.json';
const memory = new Map();
const fingerprint = (s) => JSON.stringify([s.facts, s.states, s.labelStopWords]);

export function livingIndex(root, settings = DEFAULTS, { state = null } = {}) {
  const fp = fingerprint(settings);
  const cacheFile = state ? path.join(state, CACHE_FILE) : null;
  let stored = memory.get(root);
  if (!stored && cacheFile) { try { stored = JSON.parse(fs.readFileSync(cacheFile, 'utf8')); } catch { stored = null; } }
  if (!stored || stored.fp !== fp || stored.root !== root) stored = { fp, root, notes: {} };
  const notes = {};
  let changed = false;
  for (const n of listNotes(root, settings)) {
    if (n.kind !== 'living') continue;
    let st;
    try { st = fs.statSync(path.join(root, n.rel)); } catch { continue; }
    const old = stored.notes[n.rel];
    if (old && old.m === st.mtimeMs && old.z === st.size) { notes[n.rel] = old; continue; }
    let text = '';
    try { text = fs.readFileSync(path.join(root, n.rel), 'utf8'); } catch {}
    notes[n.rel] = { m: st.mtimeMs, z: st.size, f: noteFacts(text, settings).map((f) => [f.key, f.value, f.line, f.about, f.state ? 1 : 0]) };
    changed = true;
  }
  if (Object.keys(stored.notes).some((r) => !notes[r])) changed = true;
  const next = { fp, root, notes };
  memory.set(root, next);
  if (changed && cacheFile) { try { fs.mkdirSync(state, { recursive: true }); fs.writeFileSync(cacheFile, JSON.stringify(next)); } catch {} }
  const index = new Map(); // fact key -> [{ rel, value, line, about, state }]
  for (const [rel, n] of Object.entries(notes)) for (const [key, value, line, about, isState] of n.f) {
    if (!index.has(key)) index.set(key, []);
    index.get(key).push({ rel, value, line, about, state: !!isState });
  }
  return index;
}
export function clearCache() { memory.clear(); }

// ---------- the whole-notebook run, for the health check ----------

export function scan(root, { today = new Date().toISOString().slice(0, 10), settings = DEFAULTS } = {}) {
  const t0 = performance.now();
  const notes = listNotes(root, settings);
  const texts = new Map();
  for (const n of notes) { try { texts.set(n.rel, fs.readFileSync(path.join(root, n.rel), 'utf8')); } catch {} }
  const living = notes.filter((n) => n.kind === 'living' && texts.has(n.rel));
  const found = { differ: [], behind: [], stamps: [], reviews: [], missing: [], claimedMissing: [] };

  // 1. The same fact with different values in two living notes.
  const byKey = new Map();
  for (const n of living) for (const f of noteFacts(texts.get(n.rel), settings)) {
    if (!byKey.has(f.key)) byKey.set(f.key, []);
    byKey.get(f.key).push({ rel: n.rel, ...f });
  }
  for (const [key, list] of byKey) {
    const values = [...new Set(list.map((x) => x.value))];
    if (values.length < 2) continue;
    const firsts = values.map((v) => list.find((x) => x.value === v));
    found.differ.push({ key, about: list[0].about, places: firsts.map((x) => ({ rel: x.rel, line: x.line, value: x.value })) });
  }

  // 2. A living note with a stamp, and a newer dated note that states the same fact differently.
  for (const n of living) {
    const stamp = stampOf(texts.get(n.rel), settings);
    if (!stamp) continue;
    // The note is as new as its stamp or the newest day it speaks of, whichever is later.
    const own = [stamp, ...isoDates(texts.get(n.rel)).filter((d) => d <= today)].sort().pop();
    const mine = noteFacts(texts.get(n.rel), settings).filter((f) => !f.key.startsWith('count: '));
    for (const h of notes.filter((x) => x.kind === 'history' && x.date && x.date > own && x.date <= today && texts.has(x.rel))) {
      for (const g of noteFacts(texts.get(h.rel), settings)) {
        const f = mine.find((x) => x.key === g.key && x.value !== g.value);
        if (f) found.behind.push({ rel: n.rel, line: f.line, value: f.value, stamp, newer: h.rel, newerLine: g.line, newerValue: g.value, about: f.about });
      }
    }
  }

  // 3. Stamps behind their own lines; lines past their own review day; pointers.
  for (const n of living) {
    const t = texts.get(n.rel);
    const s = stampBehind(t, today, settings);
    if (s) found.stamps.push({ rel: n.rel, ...s });
    for (const r of reviewsPast(t, today, settings)) found.reviews.push({ rel: n.rel, ...r });
    const p = pointerProblems(n.rel, t, root, settings);
    for (const m of p.missing) found.missing.push({ rel: n.rel, ...m });
    for (const m of p.claimedMissing) found.claimedMissing.push({ rel: n.rel, ...m });
  }
  found.read = { notes: notes.length, living: living.length, ms: Math.round(performance.now() - t0) };
  return found;
}

export function lines(found) {
  const out = [];
  const where = (p) => `${p.rel} line ${p.line} says ${p.value}`;
  for (const d of found.differ) out.push(`NEEDS|Two living notes disagree on ${d.about}: ${d.places.map(where).join('; ')}. Keep it in one note and point to it from the others.`);
  for (const b of found.behind) out.push(`NEEDS|${b.rel} (stamped ${b.stamp}) line ${b.line} says ${b.value} for ${b.about}, but the newer note ${b.newer} line ${b.newerLine} says ${b.newerValue}.`);
  for (const s of found.stamps) out.push(`NEEDS|${s.rel} says it was updated on ${s.stamp}, but it speaks of ${s.newest}: its stamp is behind its own lines.`);
  for (const r of found.reviews) out.push(`NEEDS|${r.rel} line ${r.line} was due for review on ${r.date}, and that day has passed.`);
  for (const m of found.claimedMissing) out.push(`NEEDS|${m.rel} line ${m.line} says ${m.target} is missing or owed, but that file exists.`);
  for (const m of found.missing) out.push(`NEEDS|${m.rel} line ${m.line} points to ${m.target}, which does not exist.`);
  if (!out.length) out.push('OK|No truth has two homes, no stamp is behind, no review day has passed and every pointer checked leads somewhere.');
  // The whole-notebook run may take longer than a save step, so it says its time.
  if (found.read) out.push(`OK|The one-home list read ${found.read.notes} notes (${found.read.living} of them living) in ${found.read.ms} ms.`);
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = process.env.HIVE_ROOT || path.resolve(HERE, '..', '..', '..');
  const today = process.env.HIVE_TODAY || new Date().toISOString().slice(0, 10);
  const out = lines(scan(root, { today }));
  process.stdout.write(out.join('\n') + '\n');
  process.exit(out.some((l) => l.startsWith('NEEDS|')) ? 1 : 0);
}
