// Proof for the weekly numbers: node --test core/engine/value.test.mjs
// Everything runs in temporary folders (HIVE_ROOT and HIVE_STATE). Plan: windows are exact at their edges; a missing file
// says "not counted here" and never zero; ticked lines only; corrections say which way they went; git history dates the
// saved lines; the plain form is at most six lines; save replaces the same week and keeps the rest of the ledger.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { addDays, windows, ledgerWith } from './value.mjs';

const VALUE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'value.mjs');
const DATE = '2026-11-18'; // this week: 11-12 to 11-18; last week: 11-05 to 11-11

function world({ state = true } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'hive-value-'));
  const root = path.join(base, 'notebook');
  const stateDir = path.join(base, 'state');
  for (const d of ['system', 'brief', 'inbox', 'ledger']) fs.mkdirSync(path.join(root, d), { recursive: true });
  if (state) fs.mkdirSync(stateDir, { recursive: true });
  const env = { ...process.env, HIVE_ROOT: root, HIVE_STATE: stateDir, HIVE_HOME: base };
  const run = (...args) => { const r = spawnSync(process.execPath, [VALUE, ...args], { env, encoding: 'utf8' }); return { code: r.status, out: r.stdout.trim() }; };
  const put = (rel, text, inState) => fs.writeFileSync(path.join(inState ? stateDir : root, rel), text);
  const json = () => JSON.parse(run('week', DATE, '--json').out);
  return { root, stateDir, run, put, json };
}

test('the windows are seven days each, and touch at no day', () => {
  assert.deepEqual(windows(DATE), { now: { from: '2026-11-12', to: '2026-11-18' }, before: { from: '2026-11-05', to: '2026-11-11' } });
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
});

test('gate log: steps stopped and replies sent back, this week beside last week, edges exact', () => {
  const w = world();
  const e = (t, event) => JSON.stringify({ t, event }) + '\n';
  w.put('gates.log', [
    e('2026-11-18T23:59:00Z', 'deny'), e('2026-11-12T00:00:00Z', 'deny'), e('2026-11-11T23:59:59Z', 'deny'), // last one is last week
    e('2026-11-05T00:00:00Z', 'deny'), e('2026-11-04T23:59:59Z', 'deny'), // the last one is two weeks ago: counted nowhere
    e('2026-11-15T10:00:00Z', 'stop-sendback'), e('2026-11-15T10:00:00Z', 'record'), 'not json at all\n',
  ].join(''), true);
  const m = w.json().metrics;
  assert.deepEqual(m.stopped, { now: 2, before: 2 });
  assert.deepEqual(m.sentBack, { now: 1, before: 0 });
});

test('a missing file is "not counted here", never zero (as in the cloud)', () => {
  const w = world({ state: false });
  const r = w.json();
  for (const k of ['stopped', 'sentBack', 'ends', 'corrections', 'publishes']) assert.deepEqual(r.metrics[k], { now: null, before: null }, k);
  assert.match(r.lines.join('\n'), /not counted here/);
  assert.doesNotMatch(r.lines[0], /stopped 0/);
});

test('an empty but present log is a real zero', () => {
  const w = world();
  w.put('ends.log', '', true);
  assert.deepEqual(w.json().metrics.ends, { now: 0, before: 0 });
});

test('answers and things sent: only ticked lines, by their own date', () => {
  const w = world();
  fs.writeFileSync(path.join(w.root, 'inbox', 'answers.md'), '# Answers\n- [x] 2026-11-18 18:04 UTC | note\n- [ ] 2026-11-17 open one\n- [x] 2026-11-09 | answer\n');
  fs.writeFileSync(path.join(w.root, 'inbox', 'sources.md'), '- [x] 2026-11-18 | a guide\n- [ ] 2026-11-18 | a link\n- [X] 2026-11-13 | a file\n');
  const m = w.json().metrics;
  assert.deepEqual(m.answers, { now: 1, before: 1 });
  assert.deepEqual(m.sent, { now: 2, before: 0 });
});

test('ends, corrections, runs and publishes', () => {
  const w = world();
  w.put('ends.log', '2026-11-17 the page is behind\n2026-11-17 a note is stale\n2026-11-08 old\nno date here\n', true);
  w.put('corrections.log', JSON.stringify({ t: '2026-11-16T09:00:00Z' }) + '\n' + JSON.stringify({ t: '2026-11-06T09:00:00Z' }) + '\n' + JSON.stringify({ t: '2026-11-07T09:00:00Z' }) + '\n', true);
  w.put('publish.log', '2026-11-18T14:29:04  Published: https://x.vercel.app\n2026-11-18T15:00:00  STOPPED at the upload\n2026-11-08T09:00:00  Published: https://y.vercel.app\n', true);
  for (const f of ['2026-11-18.md', '2026-11-17-evening.md', '2026-11-17.md', '2026-11-18-disagreements.md', '2026-11-08.md']) fs.writeFileSync(path.join(w.root, 'brief', f), 'x');
  const r = w.json();
  assert.deepEqual(r.metrics.ends, { now: 2, before: 1 });
  assert.deepEqual(r.metrics.corrections, { now: 1, before: 2 });
  assert.deepEqual(r.metrics.runs, { now: 3, before: 1 });
  assert.deepEqual(r.metrics.publishes, { now: 1, before: 1 });
  assert.match(r.lines.join('\n'), /repeat yourself 1 time \(last week 2\)\. Fewer is better\. It went down\./);
});

test('saved the first time: git history dates the lines; an edited line is not counted twice', () => {
  const w = world();
  const g = (...a) => spawnSync('git', ['-C', w.root, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { encoding: 'utf8' });
  g('init', '-q');
  fs.writeFileSync(path.join(w.root, 'system', 'decisions.md'), '# D\n| 2026-11-17 | We chose a thing | because |\n| 2026-11-01 | An old one | because |\n');
  fs.writeFileSync(path.join(w.root, 'system', 'lessons.md'), '# L\n- 2026-11-18: A lesson about gates.\n');
  g('add', '-A'); g('commit', '-q', '-m', 'one');
  fs.writeFileSync(path.join(w.root, 'system', 'decisions.md'), '# D\n| 2026-11-17 | We chose a thing | because, said better |\n| 2026-11-01 | An old one | because |\n');
  g('add', '-A'); g('commit', '-q', '-m', 'two');
  const r = w.json();
  assert.deepEqual(r.metrics.saved, { now: 2, before: 0 });
});

test('without git the notes themselves are read; with no notes it is not counted', () => {
  const w = world();
  assert.deepEqual(w.json().metrics.saved, { now: null, before: null });
  fs.writeFileSync(path.join(w.root, 'system', 'lessons.md'), '- 2026-11-18: one\n- 2026-11-09: two\n');
  assert.deepEqual(w.json().metrics.saved, { now: 1, before: 1 });
});

test('the plain form is at most six lines, says "not measured", and reads without codes', () => {
  const w = world();
  w.put('gates.log', JSON.stringify({ t: '2026-11-14T10:00:00Z', event: 'deny' }) + '\n', true);
  const out = w.run('week', DATE).out.split('\n');
  assert.ok(out.length <= 6 && out.length >= 5, `lines: ${out.length}`);
  assert.match(out[0], /^This week Hive Mind stopped 1 step that broke a rule and sent back 0 replies \(last week 0 and 0\)\.$/);
  assert.match(out[out.length - 1], /Time and tokens saved: not measured\./);
  for (const l of out) assert.ok(l.length < 200, l);
});

test('save writes one line into the month ledger, replaces the same week, keeps the rest', () => {
  const w = world();
  const ledger = path.join(w.root, 'ledger', '2026-11.md');
  fs.writeFileSync(ledger, '# Ledger 2026-11\n\n- 2026-11-18 13:05 UTC, daily run: morning.\n');
  assert.match(w.run('save', DATE).out, /ledger\/2026-11\.md/);
  w.put('gates.log', JSON.stringify({ t: '2026-11-14T10:00:00Z', event: 'deny' }) + '\n', true);
  w.run('save', DATE);
  w.run('save', '2026-11-11');
  const text = fs.readFileSync(ledger, 'utf8');
  assert.equal(text.split('\n').filter((l) => l.startsWith('- 2026-11-18 week numbers')).length, 1);
  assert.equal(text.split('\n').filter((l) => l.startsWith('- 2026-11-11 week numbers')).length, 1);
  assert.match(text, /daily run: morning\./);
  assert.match(text, /stopped 1 step/);
  const j = text.match(/json=(\{.*\})$/m);
  assert.ok(j && JSON.parse(j[1]).metrics.stopped.now === 1);
});

test('save creates the month ledger when it is missing', () => {
  const text = ledgerWith('', { date: DATE, lines: ['a'], metrics: {}, window: {} }, '# Ledger 2026-11');
  assert.match(text, /^# Ledger 2026-11\n\n- 2026-11-18 week numbers/);
});

test('a bad date or command is told how to use it', () => {
  const w = world();
  assert.equal(w.run('week', 'tomorrow').code, 2);
  assert.equal(w.run('nonsense').code, 2);
});
