#!/usr/bin/env node
// What Hive Mind did for the owner this week. Exact counting, so it is a program and not left to a run's judgment.
//
//   node core/engine/value.mjs week [date] [--json]   count the seven days ending on the date, and the seven days before
//   node core/engine/value.mjs save [date]            write the week's numbers as one line into ledger/<year>-<month>.md
//
// Counts only from files. A file that is missing gives "not counted here", never zero. Time and tokens saved are never estimated.
// Reads: <state>/gates.log, <state>/ends.log, <state>/corrections.log, <state>/publish.log, brief/, inbox/answers.md,
// inbox/sources.md, git history of system/decisions.md and system/lessons.md (the notes themselves when git is not there).
// HIVE_ROOT names the notebook (default: two levels above this file); HIVE_STATE names the state folder (default ~/.claude/hive).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HOME = process.env.HIVE_HOME || os.homedir();
const ROOT = process.env.HIVE_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const STATE = process.env.HIVE_STATE || path.join(HOME, '.claude', 'hive');

const isDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d || '');
export function addDays(date, n) {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
/** The two windows: the seven days ending on `date` (both ends included), and the seven days before. */
export function windows(date) {
  return { now: { from: addDays(date, -6), to: date }, before: { from: addDays(date, -13), to: addDays(date, -7) } };
}
const inWin = (d, w) => isDate(d) && d >= w.from && d <= w.to;
const readText = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } };
const lines = (t) => t.split(/\r?\n/);
const dateOf = (s) => (s || '').slice(0, 10);

/** Each source gives a list of dates (one per thing counted) or null when the file is not there. */
function datesGates(event) {
  const t = readText(path.join(STATE, 'gates.log'));
  if (t === null) return null;
  const out = [];
  for (const l of lines(t)) {
    if (!l.trim()) continue;
    try { const o = JSON.parse(l); if (o.event === event) out.push(dateOf(o.t)); } catch {}
  }
  return out;
}
function datesJsonLog(file) {
  const t = readText(path.join(STATE, file));
  if (t === null) return null;
  const out = [];
  for (const l of lines(t)) {
    if (!l.trim()) continue;
    try { const o = JSON.parse(l); if (o.t) out.push(dateOf(String(o.t))); } catch {}
  }
  return out;
}
function datesEnds() {
  const t = readText(path.join(STATE, 'ends.log'));
  if (t === null) return null;
  return lines(t).map((l) => l.match(/^(\d{4}-\d{2}-\d{2})/)).filter(Boolean).map((m) => m[1]);
}
function datesTicked(file) {
  const t = readText(path.join(ROOT, 'inbox', file));
  if (t === null) return null;
  return lines(t).map((l) => l.match(/^- \[x\] (\d{4}-\d{2}-\d{2})/i)).filter(Boolean).map((m) => m[1]);
}
function datesBriefs() {
  let names;
  try { names = fs.readdirSync(path.join(ROOT, 'brief')); } catch { return null; }
  return names.map((n) => n.match(/^(\d{4}-\d{2}-\d{2})(-evening)?\.md$/)).filter(Boolean).map((m) => m[1]);
}
function datesPublished() {
  const t = readText(path.join(STATE, 'publish.log'));
  if (t === null) return null;
  return lines(t).filter((l) => /Published:/.test(l)).map((l) => dateOf(l.trim())).filter(isDate);
}
function git(args) {
  const r = spawnSync('git', ['-C', ROOT, ...args], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  return r.status === 0 ? r.stdout : null;
}
function datesCommits() {
  const out = git(['log', '--date=short', '--format=%cd']);
  return out === null ? null : out.split(/\r?\n/).filter(isDate);
}
/** New lines in decisions.md and lessons.md, dated by the date written on the line. First appearance in the history only. */
function datesSaved() {
  const rowRe = { 'system/decisions.md': /^\| (\d{4}-\d{2}-\d{2}) \|(.*)$/, 'system/lessons.md': /^- (\d{4}-\d{2}-\d{2}):(.*)$/ };
  const seen = new Set();
  const out = [];
  const take = (file, line) => {
    const m = line.match(rowRe[file]);
    if (!m) return;
    const key = file + m[1] + m[2].trim().slice(0, 50);
    if (seen.has(key)) return;
    seen.add(key); out.push(m[1]);
  };
  const hist = git(['log', '--reverse', '-p', '--no-color', '--format=@@commit', '--', 'system/decisions.md', 'system/lessons.md']);
  if (hist !== null && hist.includes('@@commit')) {
    let file = '';
    for (const l of hist.split(/\r?\n/)) {
      const f = l.match(/^\+\+\+ b\/(.*)$/);
      if (f) { file = f[1]; continue; }
      if (l.startsWith('+') && !l.startsWith('+++') && rowRe[file]) take(file, l.slice(1));
    }
    return out;
  }
  let any = false;
  for (const file of Object.keys(rowRe)) {
    const t = readText(path.join(ROOT, file));
    if (t === null) continue;
    any = true;
    for (const l of lines(t)) take(file, l);
  }
  return any ? out : null;
}

const count = (dates, w) => (dates === null ? null : dates.filter((d) => inWin(d, w)).length);

export function gather(date) {
  const w = windows(date);
  const src = {
    stopped: datesGates('deny'), sentBack: datesGates('stop-sendback'), saved: datesSaved(),
    answers: datesTicked('answers.md'), sent: datesTicked('sources.md'), ends: datesEnds(),
    corrections: datesJsonLog('corrections.log'), runs: datesBriefs(), commits: datesCommits(), publishes: datesPublished(),
  };
  const metrics = {};
  for (const [k, v] of Object.entries(src)) metrics[k] = { now: count(v, w.now), before: count(v, w.before) };
  return { date, window: w, metrics };
}

const plural = (n, one, many) => (n === 1 ? one : many);
const num = (v) => (v === null ? 'not counted here' : String(v));

export function plainLines(g) {
  const m = g.metrics;
  const out = [];
  const n =(x) => (x.now === null ? null : x.now);
  // 1. steps stopped and replies sent back
  if (n(m.stopped) === null && n(m.sentBack) === null) out.push('Steps stopped for breaking a rule: not counted here (this computer\'s log is not available).');
  else out.push(`This week Hive Mind stopped ${num(m.stopped.now)} ${plural(m.stopped.now, 'step', 'steps')} that broke a rule and sent back ${num(m.sentBack.now)} ${plural(m.sentBack.now, 'reply', 'replies')} (last week ${num(m.stopped.before)} and ${num(m.sentBack.before)}).`);
  // 2. saved first time
  out.push(m.saved.now === null ? 'New decisions and lessons saved: not counted here.' : `It saved ${m.saved.now} new ${plural(m.saved.now, 'decision or lesson', 'decisions and lessons')} (last week ${num(m.saved.before)}).`);
  // 3. answers and things sent, acted on
  if (m.answers.now === null && m.sent.now === null) out.push('Your answers and what you sent, acted on: not counted here.');
  else out.push(`It acted on ${num(m.answers.now)} of your ${plural(m.answers.now, 'answer', 'answers')} and ${num(m.sent.now)} ${plural(m.sent.now, 'thing', 'things')} you sent (last week ${num(m.answers.before)} and ${num(m.sent.before)}).`);
  // 4. ends found behind
  out.push(m.ends.now === null ? 'Ends found out of step: not counted here.' : `It found ${m.ends.now} ${plural(m.ends.now, 'end', 'ends')} out of step (last week ${num(m.ends.before)}).`);
  // 5. corrections repeated: should go down
  const c = m.corrections;
  if (c.now === null) out.push('Times you had to repeat yourself: not counted here. This one should go down.');
  else {
    const dir = c.before === null ? '' : c.now < c.before ? ' It went down.' : c.now > c.before ? ' It went up.' : ' It stayed the same.';
    out.push(`You had to repeat yourself ${c.now} ${plural(c.now, 'time', 'times')} (last week ${num(c.before)}). Fewer is better.${dir}`);
  }
  // 6. runs, saves, publishes, and what is not measured
  const part = (x, one, many) => (x.now === null ? `${many} not counted here` : `${x.now} ${plural(x.now, one, many)}`);
  out.push(`${part(m.runs, 'daily run', 'daily runs')}, ${part(m.commits, 'save', 'saves')}, ${part(m.publishes, 'publish', 'publishes')} (last week ${num(m.runs.before)}, ${num(m.commits.before)}, ${num(m.publishes.before)}). Time and tokens saved: not measured.`);
  return out;
}

export function report(date) {
  const g = gather(date);
  return { ...g, timeSaved: 'not measured', tokensSaved: 'not measured', lines: plainLines(g) };
}

/** The ledger line for the week; replaces the line of the same week when it exists. Returns the new text. */
export function ledgerWith(text, rep, title) {
  const prefix = `- ${rep.date} week numbers`;
  const line = `${prefix} (the seven days ending ${rep.date}): ${rep.lines.join(' ')} json=${JSON.stringify({ metrics: rep.metrics, window: rep.window })}`;
  const arr = text ? text.replace(/\s*$/, '').split('\n') : [title, ''];
  const i = arr.findIndex((l) => l.startsWith(prefix));
  if (i >= 0) arr[i] = line; else arr.push(line);
  return arr.join('\n') + '\n';
}

function localDate() { return new Date().toLocaleDateString('en-CA'); }

function main() {
  const args = process.argv.slice(2);
  const mode = args[0];
  const json = args.includes('--json');
  const date = args.slice(1).find((a) => !a.startsWith('--')) || localDate();
  if (!isDate(date) || !['week', 'save'].includes(mode)) {
    console.log('Use: week [date] [--json] | save [date]   (date like 2026-11-18)');
    process.exit(2);
  }
  const rep = report(date);
  if (mode === 'week') {
    console.log(json ? JSON.stringify(rep, null, 2) : rep.lines.join('\n'));
    return;
  }
  const ym = date.slice(0, 7);
  const file = path.join(ROOT, 'ledger', `${ym}.md`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, ledgerWith(readText(file) || '', rep, `# Ledger ${ym}`));
  console.log(`Saved the week's numbers in ledger/${ym}.md`);
}
const isMain = process.argv[1] && import.meta.url.toLowerCase().endsWith(path.basename(process.argv[1]).toLowerCase());
if (isMain) main();
