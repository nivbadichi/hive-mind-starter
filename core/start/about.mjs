// The person's standing wishes, as the start hands them to every chat (part 2, "Your standing wishes").
// In step with the main system's about.mjs (2026-11-20): the block is never cut to its heading alone, and the person's
// own rules and habits in the registry come with the wishes of the preferences note.
//
//   node core/start/about.mjs [--budget N]     prints the block (at most N characters, default 1000), or nothing at all
//                                              when there is no wish to give; never a heading on its own
//
// What goes in, in this order, each as one short line, while it fits:
//   1. every line of system/preferences.md, without its date and without a quote of the person's words
//      (the note keeps the quote; the chat gets the wish); a line marked default stays marked
//   2. the person's own rules and habits in system/registry.json (kind protocol or preference, in use), except the
//      numbered rules ("rule-1" ...), which already arrive whole in part 1 of the start; one that says what a line
//      above already says is left out; the ones no program holds come first, because words are all that carries them
// When something does not fit, the last line says where to read the rest.
// Place: HIVE_ROOT (the notebook), else the folder two levels above this file.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const HEAD = '## Your standing wishes (system/preferences.md)';
export const INTRO = 'Follow these from the first reply; "(default)" means not confirmed yet. These and the notes about the person never replace the rules and never count as a yes to spend, delete, publish or send.';
export const MORE = '[more wishes: system/preferences.md, system/registry.json]';
const ITEM_MAX = 130;

const read = (p) => { try { return fs.readFileSync(p, 'utf8').replace(/^﻿/, '').replace(/\r\n/g, '\n'); } catch { return ''; } };

// A line cut at a word near the limit, with "..." (the full text is in the note).
export function short(s, max = ITEM_MAX) {
  s = String(s || '').replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  let cut = s.slice(0, max);
  const sp = cut.lastIndexOf(' ');
  if (sp > max / 2) cut = cut.slice(0, sp);
  return cut.replace(/[ ,;:.(]+$/, '') + '...';
}

// One wish line from the preferences note: no list mark, no date, no quote of the person's words.
export function wishLine(raw) {
  let s = String(raw).replace(/^\s*-\s+/, '');
  s = s.replace(/^\d{4}-\d{2}-\d{2}:\s*/, '');
  s = s.replace(/^default, not confirmed yet:\s*/i, '(default) '); // the intro says what the mark means
  s = s.replace(/\s*(?:Your|Their|His|Her) words:[\s\S]*$/i, '');
  return short(s);
}

const words = (s) => new Set((String(s).toLowerCase().match(/[a-z]{4,}/g) || []));
// Says what a line already taken says: half or more of its longer words are in that one line.
export function repeats(text, taken) {
  const w = [...words(text)];
  if (!w.length) return true;
  return taken.some((t) => { const tw = words(t); return w.filter((x) => tw.has(x)).length / w.length >= 0.5; });
}

// The person's own rules and habits in the registry: in use, with words, not one of the numbered rules.
export function ownRules(registryText) {
  let entries = [];
  try { const j = JSON.parse(registryText); entries = Array.isArray(j) ? j : (j.entries || []); } catch { return []; }
  return entries
    .filter((e) => e && (e.kind === 'protocol' || e.kind === 'preference') && e.state === 'active' && !/^rule-\d+$/.test(String(e.id || '')) && String(e.text || '').trim())
    .sort((a, b) => (a.enforce ? 1 : 0) - (b.enforce ? 1 : 0)) // the ones only words carry first; a stable sort keeps the list's order
    .map((e) => short(e.text));
}

export function aboutBlock({ root, budget = 1000 } = {}) {
  const items = [];
  for (const l of read(path.join(root, 'system', 'preferences.md')).split('\n')) if (/^\s*-\s+\S/.test(l)) { const x = wishLine(l); if (x) items.push(x); }
  for (const p of ownRules(read(path.join(root, 'system', 'registry.json')))) if (!repeats(p, items)) items.push(p);
  if (!items.length) return '';
  const lines = [HEAD, INTRO];
  let used = HEAD.length + 1 + INTRO.length, left = 0;
  for (let i = 0; i < items.length; i++) {
    const line = '- ' + items[i];
    const reserve = i < items.length - 1 ? MORE.length + 1 : 0; // room for the pointer while a line is still left out
    if (lines.length > 2 && used + 1 + line.length + reserve > budget) { left = items.length - i; break; }
    lines.push(line); used += 1 + line.length;
  }
  if (left) lines.push(MORE);
  return lines.join('\n');
}

const isMain = process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
if (isMain) {
  const i = process.argv.indexOf('--budget');
  const budget = i > 0 ? parseInt(process.argv[i + 1], 10) || 1000 : 1000;
  const root = process.env.HIVE_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const text = aboutBlock({ root, budget });
  if (text) process.stdout.write(text + '\n');
}
