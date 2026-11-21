// Proof for the progress display: node --test core/engine/progress.test.mjs
// Everything runs in a temporary file. Known-good: a display made by the program passes its own check, and every
// number is counted from the steps. Known-bad: a bar whose segments do not match its number is caught.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { render, checkDisplay, percent, bar, apply, SEGMENTS } from './progress.mjs';

const PROG = path.join(path.dirname(fileURLToPath(import.meta.url)), 'progress.mjs');
const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'hive-progress-')), 'progress.json');
const run = (...args) => {
  const r = spawnSync(process.execPath, [PROG, ...args], { env: { ...process.env, HIVE_PROGRESS: file, HIVE_DATE: '2026-11-19' }, encoding: 'utf8' });
  return { code: r.status, out: r.stdout.trim(), err: r.stderr.trim() };
};
const list = (items, work = 'The work') => ({ work, items });
const it = (name, steps, done, state = '') => ({ name, state, steps: Array.from({ length: steps }, (_, i) => ({ name: 's' + i, done: i < done })) });

test('numbers are counted from steps and rounded down, never up', () => {
  assert.equal(percent(1, 3), 33);
  assert.equal(percent(2, 3), 66);
  assert.equal(percent(199, 200), 99); // never shows 100% before the last step
  assert.equal(percent(4, 4), 100);
  assert.equal(percent(0, 0), null); // no steps planned: no number
  assert.equal(bar(99), '█'.repeat(19) + '░');
  assert.equal([...bar(0)].length, SEGMENTS);
});

test('the display: one overall bar, one bar per request, its number and its state', () => {
  const out = render(list([it('The new design', 4, 4), it('The reading check', 5, 2), it('Tidy-up', 0, 0)], 'Tonight'));
  const lines = out.split('\n');
  assert.equal(lines[0], 'Tonight: 6 of 9 steps');
  assert.equal(lines[1], '█████████████░░░░░░░  66%  overall');
  assert.ok(out.includes('The new design\n████████████████████ 100%  done'));
  assert.ok(out.includes('The reading check\n████████░░░░░░░░░░░░  40%  in work'));
  assert.ok(out.includes('Tidy-up\nnot planned yet'), 'no steps: the state in words, no number');
  assert.ok(lines.every((l) => [...l].length <= 40), 'fits a 40-character chat');
  assert.ok(!/\x1b\[/.test(out), 'no colour codes');
});

test('a stated state wins; an empty list says so', () => {
  assert.ok(render(list([it('The site', 4, 1, 'waiting on you')])).includes('25%  waiting on you'));
  assert.equal(render(list([])), 'The work\nno steps planned yet');
});

test('known-good: every display the program makes passes its own check', () => {
  for (let n = 1; n <= 12; n++) for (let d = 0; d <= n; d++) {
    const out = render(list([it('A', n, d), it('B', 7, 3)]));
    assert.deepEqual(checkDisplay(out), [], `${d} of ${n}`);
  }
});

test('known-bad: a bar whose number does not match its segments is caught', () => {
  assert.match(checkDisplay('██████████░░░░░░░░░░  80%  in work').join(), /shows 10 of 20 segments, but its number is 80%/);
  assert.match(checkDisplay('██████████  50%  in work').join(), /10 segments, not 20/);
  assert.match(checkDisplay('████████████████████ 120%  done').join(), /more than the whole/);
  assert.match(checkDisplay('██░░████░░░░░░░░░░░░  20%  in work').join(), /empty segment comes before a filled one/);
  assert.match(checkDisplay('Tonight: 3 of 4 steps\n██████████░░░░░░░░░░  50%  overall').join(), /3 of 4 steps is 75%, not 50%/);
});

test('the commands keep the list: new, add, steps, done, state, remove; check from the command line', () => {
  assert.equal(run('new', 'Tonight').code, 0);
  run('add', 'The new design', '--steps', 'pick; build; check');
  run('add', 'Tidy-up');
  run('done', 'The new design');
  run('done', '1', 'check');
  let out = run('show').out;
  assert.ok(out.includes('Tonight: 2 of 3 steps'), out);
  run('steps', 'The new design', 'pick; build; check; publish');
  assert.ok(run('show').out.includes('2 of 4 steps'), 'steps already done stay done');
  run('state', 'Tidy-up', 'not started');
  run('done', 'the new design', '--all');
  out = run('show').out;
  assert.ok(out.includes('████████████████████ 100%  done') && out.includes('Tidy-up\nnot started'), out);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).updated, '2026-11-19');
  const bad = run('done', 'Nothing like it');
  assert.equal(bad.code, 2);
  assert.match(bad.err, /not in the list/);
  assert.match(run('done', 'Tidy-up').err, /no steps yet/);
  run('remove', 'Tidy-up');
  assert.ok(!run('show').out.includes('Tidy-up'));
  const f2 = file + '.txt';
  fs.writeFileSync(f2, run('show').out);
  assert.equal(run('check', f2).code, 0);
  fs.writeFileSync(f2, '██████████░░░░░░░░░░  80%  in work');
  assert.equal(run('check', f2).code, 1);
});

test('adding the same request twice, or one with no words, is refused', () => {
  const l = apply({ work: '', items: [] }, 'add', ['A']);
  assert.throws(() => apply(l, 'add', ['a']), /already in the list/);
  assert.throws(() => apply(l, 'add', []), /in their words/);
});
