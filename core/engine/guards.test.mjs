// Proof for the guards of the daily run: node --test core/engine/guards.test.mjs
// Everything runs in a temporary folder. The three proofs the plan asks for: flip the switch, plant an empty run,
// plant a goal that is already met.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { countEmpty, decide, readSwitch, setLine } from './guards.mjs';

const GUARDS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'guards.mjs');
const NOTE = '# Engine switch\n\nA line of words.\n\nengine: on\n\nempty_runs: 0\n';

function world(note = NOTE, briefs = []) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hive-guards-'));
  fs.mkdirSync(path.join(root, 'system'), { recursive: true });
  fs.mkdirSync(path.join(root, 'brief'), { recursive: true });
  fs.writeFileSync(path.join(root, 'system', 'engine-switch.md'), note);
  for (const b of briefs) fs.writeFileSync(path.join(root, 'brief', b), 'x');
  const run = (...args) => { const r = spawnSync(process.execPath, [GUARDS, ...args], { env: { ...process.env, HIVE_ROOT: root }, encoding: 'utf8' }); return { code: r.status, out: r.stdout.trim() }; };
  const note2 = () => fs.readFileSync(path.join(root, 'system', 'engine-switch.md'), 'utf8');
  return { root, run, note: note2 };
}

test('the switch on, nothing written yet: the run goes', () => {
  const w = world();
  assert.deepEqual(w.run('check', 'morning', '2026-11-19'), { code: 0, out: 'GO' });
});

test('flip the switch: the run stops and changes nothing', () => {
  const w = world(NOTE.replace('engine: on', 'engine: off'));
  const r = w.run('check', 'evening', '2026-11-19');
  assert.equal(r.code, 3);
  assert.match(r.out, /^STOP: the switch is off/);
  assert.equal(w.note(), NOTE.replace('engine: on', 'engine: off'));
});

test('a switch note with no clear word counts as off', () => {
  const w = world('# Engine switch\n\nengine: maybe\n');
  assert.equal(w.run('check', 'morning', '2026-11-19').code, 3);
});

test('one run of each kind a day', () => {
  const w = world(NOTE, ['2026-11-19.md']);
  assert.match(w.run('check', 'morning', '2026-11-19').out, /already written/);
  assert.equal(w.run('check', 'evening', '2026-11-19').out, 'GO');
  const w2 = world(NOTE, ['2026-11-19-evening.md', '2026-11-19-disagreements.md']);
  assert.match(w2.run('check', 'evening', '2026-11-19').out, /already written/);
  assert.equal(w2.run('check', 'morning', '2026-11-19').out, 'GO');
});

test('a run that does not know which run it is, or the date, stops', () => {
  const w = world();
  assert.equal(w.run('check', 'noon', '2026-11-19').code, 3);
  assert.equal(w.run('check', 'morning', 'tomorrow').code, 3);
});

test('plant an empty run: the third in a row switches it off and says so', () => {
  const w = world();
  assert.equal(w.run('empty', 'yes').out, 'empty_runs: 1');
  assert.equal(w.run('empty', 'yes').out, 'empty_runs: 2');
  assert.equal(w.run('check', 'morning', '2026-11-19').out, 'GO');
  assert.match(w.run('empty', 'yes').out, /^SWITCHED OFF: 3 runs in a row/);
  assert.match(w.note(), /^engine: off$/m);
  assert.match(w.note(), /^empty_runs: 3$/m);
  assert.equal(w.run('check', 'morning', '2026-11-20').code, 3);
});

test('a run with something to say sets the count back to zero', () => {
  const w = world(NOTE.replace('empty_runs: 0', 'empty_runs: 2'));
  assert.equal(w.run('empty', 'no').out, 'empty_runs: 0');
  assert.match(w.note(), /^engine: on$/m);
});

test('plant a goal that is already met: the run retires itself', () => {
  const w = world(NOTE + '\nretire_on: 2026-11-19\n');
  const r = w.run('check', 'morning', '2026-11-19');
  assert.equal(r.code, 3);
  assert.match(r.out, /SWITCHED OFF/);
  assert.match(r.out, /retired/);
  assert.match(w.note(), /^engine: off$/m);
  const before = world(NOTE + '\nretire_on: 2026-11-19\n');
  assert.equal(before.run('check', 'evening', '2026-11-18').out, 'GO');
});

test('the ceiling on a run\'s length', () => {
  const w = world(NOTE + '\nmax_seconds: 60\n');
  assert.match(w.run('long', new Date(Date.now() - 5000).toISOString()).out, /^OK \d+$/);
  const late = w.run('long', new Date(Date.now() - 120000).toISOString());
  assert.equal(late.code, 4);
  assert.match(late.out, /^TOO LONG \d+$/);
});

test('the pieces: reading and writing the note keeps its other words', () => {
  const sw = readSwitch(NOTE);
  assert.deepEqual(sw, { engine: 'on', emptyRuns: 0, retireOn: '', ceiling: 600 });
  assert.equal(setLine(NOTE, 'empty_runs', '2'), NOTE.replace('empty_runs: 0', 'empty_runs: 2'));
  assert.match(setLine('# Engine switch\n\nengine: on\n', 'empty_runs', '1'), /engine: on\n\nempty_runs: 1\n$/);
  assert.deepEqual(countEmpty({ emptyRuns: 2 }, true), { emptyRuns: 3, off: true });
  assert.equal(decide('morning', '2026-11-19', sw, []).go, true);
});
