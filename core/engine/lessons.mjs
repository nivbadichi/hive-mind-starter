#!/usr/bin/env node
// Lessons that are owed: a lesson can no longer sit "owed" and be forgotten.
//
//   node core/engine/lessons.mjs [--since YYYY-MM-DD] [--json]
//
// Reads system/lessons.md and lists every lesson whose closed_by part
//   - says it is owed, open, or "nothing yet"           (owed)
//   - names a file that does not exist                  (missing file)
//   - is not there at all                               (no closed_by)
// It also lists lines of .claude/napkin.md that record a correction by the owner and are
// older than a day, as "raw, not yet a lesson".
// Exit code 1 when anything is listed, 0 when nothing is. Reads only; it changes no file.
//
// Places: HIVE_ROOT (the notebook), HIVE_DATE (today, for tests).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = () => process.env.HIVE_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const todayStr = () => process.env.HIVE_DATE || (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();
const readText = (p) => { try { return fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n'); } catch { return null; } };
const short = (s, n = 110) => (s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, '') + '...' : s);
const dayNumber = (s) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / 86400000;

const OWED = /^(open\b|nothing yet|owed\b)|\bowed\b/i;
// A path: at least one folder and a file ending, such as core/gates/gates.mjs.
const PATH = /(?<![\w./:-])(?:[\w.-]+\/)+[\w.-]*\.[A-Za-z0-9]+(?![\w/])/g;

// Every lesson line: "- <text>", with an optional date at the front.
export function parseLessons(text) {
  const out = [];
  for (const [i, line] of (text || '').split('\n').entries()) {
    if (!line.startsWith('- ')) continue;
    const body = line.slice(2).trim();
    const d = body.match(/^(\d{4}-\d{2}-\d{2}):\s*/);
    const idx = body.search(/\bclosed_by:\s*/);
    const closedBy = idx >= 0 ? body.slice(idx).replace(/^closed_by:\s*/, '').trim() : null;
    out.push({ line: i + 1, date: d ? d[1] : null, text: (idx >= 0 ? body.slice(0, idx) : body).replace(/^\d{4}-\d{2}-\d{2}:\s*/, '').trim(), closedBy });
  }
  return out;
}

export function pathsIn(s) {
  return [...(s || '').matchAll(PATH)].map((m) => m[0]).filter((p) => !/^https?:/.test(p));
}

// Judge one lesson. Returns null when it is closed by something that exists.
export function judge(lesson, root) {
  if (lesson.closedBy === null || lesson.closedBy === '') return { kind: 'no closed_by', why: 'It has no closed_by part, so nothing says what changed because of it.' };
  if (OWED.test(lesson.closedBy)) return { kind: 'owed', why: 'Its closed_by part says the fix is still owed.' };
  const missing = pathsIn(lesson.closedBy).filter((p) => !fs.existsSync(path.join(root, p)));
  if (missing.length) return { kind: 'missing file', why: `It names a file that does not exist: ${missing.join(', ')}.` };
  return null;
}

// Napkin: lines that record a correction by the owner, at least a day old, not yet in the lessons.
const CORRECTION = /\b(correction|corrected|owner (said|told|corrected)|told (me|you)|for the last time)\b/i;
export function napkinRaw(napkinText, lessonsText, today) {
  const out = [];
  const lessonsLow = (lessonsText || '').toLowerCase();
  for (const [i, line] of (napkinText || '').split('\n').entries()) {
    const l = line.trim();
    if (!/^[-*]\s|^\d+\.\s/.test(l) || !CORRECTION.test(l)) continue;
    const d = l.match(/\b(\d{4}-\d{2}-\d{2})\b/);
    if (!d || dayNumber(today) - dayNumber(d[1]) < 1) continue; // undated or from today: not older than a day
    const clean = l.replace(/^[-*]\s|^\d+\.\s/, '').replace(/\b\d{4}-\d{2}-\d{2}:?\s*/, '').trim();
    if (clean.length >= 30 && lessonsLow.includes(clean.slice(0, 30).toLowerCase())) continue; // already a lesson
    out.push({ line: i + 1, date: d[1], text: clean });
  }
  return out;
}

export function scan({ root = ROOT(), today = todayStr(), since = null } = {}) {
  const lessonsText = readText(path.join(root, 'system', 'lessons.md'));
  const lessons = parseLessons(lessonsText);
  const found = [];
  let closed = 0;
  let counted = 0;
  for (const l of lessons) {
    if (since && (!l.date || l.date < since)) continue;
    counted++;
    const j = judge(l, root);
    if (j) found.push({ ...l, ...j }); else closed++;
  }
  const napkin = napkinRaw(readText(path.join(root, '.claude', 'napkin.md')), lessonsText, today);
  return { lessonsFound: lessonsText !== null, total: counted, closed, found, napkin };
}

export function report(r) {
  if (!r.lessonsFound) return ['system/lessons.md was not found, so no lesson could be checked.'];
  const out = [];
  out.push(`${r.found.length} of ${r.total} lessons are not closed by something real; ${r.closed} are.`);
  for (const f of r.found) out.push(`${f.kind.toUpperCase()}: ${f.date || 'undated'}, line ${f.line}: ${short(f.text)} ${f.why}`);
  if (r.napkin.length) {
    out.push(`${r.napkin.length} napkin line(s) record a correction by the owner and are not yet a lesson (raw):`);
    for (const n of r.napkin) out.push(`RAW, NOT YET A LESSON: ${n.date}, napkin line ${n.line}: ${short(n.text)}`);
  }
  return out;
}

function main(argv) {
  const i = argv.indexOf('--since');
  const since = i >= 0 ? argv[i + 1] : null;
  const r = scan({ since });
  if (argv.includes('--json')) console.log(JSON.stringify(r, null, 2));
  else report(r).forEach((l) => console.log(l));
  process.exitCode = r.found.length || r.napkin.length || !r.lessonsFound ? 1 : 0;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
