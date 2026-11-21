#!/usr/bin/env node
// Rule 15, held by a program: is every end of this Hive Mind in step?
// An "end" is a place that carries the same thing: the notes, the empty copy for new people, the live sites, a copy on
// Drive. The health check runs this and shows each line. It only reads; it never changes or uploads anything.
//
//   node system/ends-check.mjs            prints one line per check:  OK|text   or   NEEDS|text
//
// What it checks is listed in system/ends.json, so a Hive Mind with fewer ends simply lists fewer.
// It also checks that the notes agree with each other, and appends one line to ends.log in the state folder whenever an end is behind.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = process.env.HIVE_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STATE = process.env.HIVE_STATE || path.join(os.homedir(), '.claude', 'hive');
const out = [];
const say = (ok, text) => out.push(`${ok ? 'OK' : 'NEEDS'}|${text}`);
const read = (rel) => { try { return fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n'); } catch { return null; } };
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));
const git = (...args) => { try { return execFileSync('git', ['-C', ROOT, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return null; } };
const daysSince = (iso) => (Date.now() - Date.parse(iso)) / 86400000;

let cfg = {};
try { cfg = JSON.parse(read('system/ends.json') || '{}'); } catch { say(false, 'The list of ends (system/ends.json) cannot be read'); }

// 1. The empty copy for new people has every part the main system has.
const copy = cfg.copy;
if (copy && exists(copy.folder)) {
  const missing = [];
  for (const dir of copy.sameFolders || []) {
    let names = [];
    try { names = fs.readdirSync(path.join(ROOT, dir)); } catch {}
    for (const n of names) if (!(copy.notInCopy || []).includes(`${dir}/${n}`) && !exists(`${copy.folder}/${dir}/${n}`)) missing.push(`${dir}/${n}`);
  }
  say(missing.length === 0, 'The empty copy has every helper and program the main system has' + (missing.length ? ` (missing: ${missing.slice(0, 4).join(', ')}${missing.length > 4 ? ', ...' : ''})` : ''));
  const differ = (copy.identical || []).filter((f) => read(f) !== read(`${copy.folder}/${f}`));
  say(differ.length === 0, 'The programs that must be the same in both are the same' + (differ.length ? ` (differ: ${differ.join(', ')})` : ''));
  const count = (t) => (t ? (t.match(/^\d+\. /gm) || []).length : -1);
  const a = count(read('system/rules.md')), b = count(read(`${copy.folder}/system/rules.md`));
  say(a === b, `The empty copy has the same number of rules (${a} here, ${b} there)`);
  const lacks = [];
  for (const m of copy.mustMention || []) { const t = read(`${copy.folder}/${m.file}`) || ''; for (const w of m.words) if (!t.includes(w)) lacks.push(`${m.file}: "${w}"`); }
  say(lacks.length === 0, 'The empty copy carries each newer part' + (lacks.length ? ` (not found: ${lacks.slice(0, 3).join('; ')})` : ''));
}

// 2. The private page was put online after the newest save.
if (cfg.privatePage && process.env.HIVE_CLOUD !== '1') {
  let last = null;
  try { const lines = fs.readFileSync(path.join(STATE, 'publish.log'), 'utf8').trim().split(/\r?\n/).filter((l) => /Published:/.test(l)); last = lines.length ? Date.parse(lines[lines.length - 1].slice(0, 19)) : null; } catch {}
  const commit = Date.parse(git('log', '-1', '--format=%cI') || '');
  // A hold placed on purpose (system/publish-quiet.ps1): the page is meant to stay as it is, so it is not "behind".
  if (fs.existsSync(path.join(STATE, 'publish-hold'))) say(true, 'Your page is on hold on purpose while the site is rebuilt; nothing goes online until the hold is lifted');
  else if (!Number.isFinite(commit)) say(false, 'The time of the newest save could not be read');
  else if (!last) say(false, 'No record of your page ever being put online');
  else {
    const behindMin = Math.round((commit - last) / 60000);
    const fresh = behindMin <= 0 || (Date.now() - commit) < (cfg.privatePage.graceMinutes || 15) * 60000;
    say(fresh, fresh ? 'Your page is built from the newest save' : `Your page is behind the newest save by about ${behindMin} minutes`);
  }
}

// 3. The public site was put online from the current code.
if (cfg.publicSite) {
  const stamp = read(cfg.publicSite.stamp) || '';
  const hash = (stamp.match(/^commit:\s*([0-9a-f]{7,40})/m) || [])[1];
  if (!hash) say(false, 'No record of which code the public site was built from');
  else {
    const changed = (git('diff', '--name-only', hash, 'HEAD', '--', ...(cfg.publicSite.watch || ['app/src'])) || '').split('\n').filter(Boolean)
      .filter((f) => !(cfg.publicSite.privateOnly || []).some((p) => f.startsWith(p)));
    say(changed.length === 0, changed.length === 0 ? 'The public site is built from the current code' : `The public site is behind the code (${changed.length} file${changed.length === 1 ? '' : 's'} changed since it went up, for example ${changed[0]})`);
  }
}

// 4. A copy kept somewhere else by hand (for example on Drive) is not old.
for (const c of cfg.handCopies || []) {
  const stamp = read(c.stamp) || '';
  const day = (stamp.match(/^copied:\s*(\d{4}-\d{2}-\d{2})/m) || [])[1];
  if (!day) say(false, `${c.name}: no record of when it was last copied`);
  else { const d = Math.floor(daysSince(day + 'T00:00:00Z')); say(d <= (c.maxDays || 7), `${c.name} was refreshed ${d} day${d === 1 ? '' : 's'} ago (the line is ${c.maxDays || 7})`); }
}

// 5. No current note still says something a later decision made untrue.
const dead = (read('system/dead-phrases.md') || '').split('\n').map((l) => l.match(/^- "(.+?)"\s*\|/)).filter(Boolean).map((m) => m[1]);
if (dead.length) {
  const skip = new Set(cfg.deadPhraseSkip || []);
  const past = /\b(dropped|replaced|removed|retired|no longer|was |were |until 20\d\d|before 20\d\d|superseded|history|\(Done|used to)\b/i;
  const hits = [];
  // The questions page quotes his own old questions; a phrase inside quotation marks on a line that asks a question is
  // that quotation, not a live use.
  const questionsPage = 'system/questions-for-him.md';
  const quotedInQuestion = (r, l, p) => r === questionsPage && l.includes('?') && [...l.matchAll(/"([^"\n]*)"|“([^”\n]*)”/g)].some((m) => (m[1] || m[2] || '').toLowerCase().includes(p.toLowerCase()));
  const scanned = new Set();
  const scan = (r) => {
    if (scanned.has(r)) return;
    scanned.add(r);
    const lines = (read(r) || '').split('\n');
    lines.forEach((l, i) => { for (const p of dead) if (l.toLowerCase().includes(p.toLowerCase()) && !past.test(l) && !quotedInQuestion(r, l, p)) hits.push(`${r}:${i + 1} "${p}"`); });
  };
  const walk = (rel) => {
    for (const e of fs.readdirSync(path.join(ROOT, rel), { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { if (!['.git', 'node_modules', '.next', '.vercel', 'archive', 'brief', 'log', 'ledger', '.claude'].includes(e.name) && !skip.has(r)) walk(r); continue; }
      if (!/\.(md|tsx?)$/.test(e.name) || skip.has(r)) continue;
      if (r.endsWith('.ts') || r.endsWith('.tsx')) { if (!r.startsWith('app/src/')) continue; }
      scan(r);
    }
  };
  try { walk(''); } catch {}
  // Files read for banned lines although a skipped folder holds them (deadPhraseAlso in system/ends.json), for example the copy deck.
  for (const r of cfg.deadPhraseAlso || []) if (exists(r)) scan(r);
  say(hits.length === 0, hits.length === 0 ? 'No current note or page still carries a phrase that a later decision made untrue' : `${hits.length} place${hits.length === 1 ? '' : 's'} still carr${hits.length === 1 ? 'ies' : 'y'} a phrase that a later decision made untrue (${hits.slice(0, 3).join('; ')})`);
}

// 6. Notes that disagree (checked against each other, never changed).
const today = new Date(); today.setHours(0, 0, 0, 0);
const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
const datesIn = (text) => {
  const found = [];
  for (const m of text.matchAll(/\b(20\d\d)-(\d\d)-(\d\d)\b/g)) found.push(new Date(+m[1], +m[2] - 1, +m[3]));
  for (const m of text.matchAll(/\b(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?,?\s+(20\d\d)\b/gi)) found.push(new Date(+m[3], MONTHS[m[2].toLowerCase()], +m[1]));
  return found.filter((d) => !Number.isNaN(d.getTime()));
};
const headerOf = (t) => { const m = t.match(/^---\n([\s\S]*?)\n---/); return m ? m[1] : ''; };
const field = (h, k) => ((h.match(new RegExp(`^${k}:\\s*(.+?)\\s*$`, 'm')) || [])[1] || '');
const projectDirs = (() => { try { return fs.readdirSync(path.join(ROOT, 'projects'), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name); } catch { return []; } })();
const headers = projectDirs.map((d) => ({ d, h: headerOf(read(`projects/${d}/state.md`) || '') })).filter((x) => x.h);
// 6a. A next step that names a date already passed.
const passed = [];
for (const { d, h } of headers) { const ns = field(h, 'next_step'); if (datesIn(ns).some((x) => x < today)) passed.push(d); }
say(passed.length === 0, passed.length === 0 ? "No project's next step names a date that has already passed" : `A next step names a date that has already passed (${passed.join(', ')}): bring it up to date`);
// 6b. An answer ticked as done while the same question still stands in a state header.
const standing = new Set(headers.map(({ h }) => field(h, 'question').split(' | ')[0].trim().toLowerCase()).filter(Boolean));
const stale = [];
for (const l of (read('inbox/answers.md') || '').split('\n')) {
  if (!/^\s*-\s\[x\]\s/i.test(l)) continue;
  const q = (l.split(' | ')[3] || '').trim().toLowerCase();
  if (q && q !== '-' && standing.has(q)) stale.push(q.slice(0, 50));
}
say(stale.length === 0, stale.length === 0 ? 'No answered question still stands in a project note' : `An answer was given and ticked, but its question still stands in a project note ("${stale[0]}"${stale.length > 1 ? ` and ${stale.length - 1} more` : ''})`);
// 6c. The in-flight note stays under the size the start can carry.
const flightMax = (cfg.notesAgree && cfg.notesAgree.inFlightMaxChars) || 8500;
const flightLen = (read('system/in-flight.md') || '').length;
say(flightLen <= flightMax, flightLen <= flightMax ? `The in-flight note fits the start message (${flightLen} of ${flightMax} characters)` : `The in-flight note is too long for the start message to carry whole (${flightLen} of ${flightMax} characters): settle or remove lines`);

// 7. Remember what was behind, so a later program can count it. The only thing this script writes: one line in ends.log in the state folder.
const behind = out.filter((l) => l.startsWith('NEEDS|')).map((l) => l.slice(6).slice(0, 140));
if (behind.length && process.env.HIVE_CLOUD !== '1') {
  try {
    const f = path.join(STATE, 'ends.log');
    const day = new Date().toISOString().slice(0, 10);
    const line = JSON.stringify({ date: day, behind: behind.length, which: behind });
    let last = '';
    try { last = fs.readFileSync(f, 'utf8').trim().split(/\r?\n/).pop() || ''; } catch {}
    let same = false;
    try { const o = JSON.parse(last); same = o.date === day && JSON.stringify(o.which) === JSON.stringify(behind); } catch {}
    if (!same) { fs.mkdirSync(STATE, { recursive: true }); fs.appendFileSync(f, line + '\n'); }
  } catch {}
}

process.stdout.write(out.join('\n') + '\n');
