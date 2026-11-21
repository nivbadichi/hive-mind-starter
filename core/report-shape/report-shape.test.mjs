// Tests for core/report-shape/report-shape.mjs (proposal 5 of the Agent Architects breakdowns:
// "a report with an empty files or checks line is rejected"). In this copy the heading is "Questions for the person".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { faults } from './report-shape.mjs';

const PROG = path.join(path.dirname(fileURLToPath(import.meta.url)), 'report-shape.mjs');

const GOOD = [
  'Built core/garden/plan.mjs and its test, in a new folder.',
  'Checks: `node --test core/garden/plan.test.mjs` printed "pass 10, fail 0".',
  'Not checked: the real home folder.',
  'Skills loaded: hive-gates, writing-for-agents.',
  'Model: Opus.',
  '',
  'Questions for the person',
  '- Should the evening run water the garden list? (yes / no)',
].join('\n');

test('known-good: a full report has no fault', () => assert.deepEqual(faults(GOOD), []));

test('known-good: "Questions for the person: none" and "nothing built" are answers, not gaps', () => {
  const r = 'Nothing built: this was a read-only look.\nChecks: not checked, because nothing changed.\nModel: Sonnet.\nQuestions for the person: none';
  assert.deepEqual(faults(r), []);
});

test('known-bad: no file named and no "nothing built" is a fault', () => {
  assert.ok(faults(GOOD.replace('core/garden/plan.mjs and its test, in a new folder', 'the thing')).some((f) => f.key === 'files'));
});

test('known-bad: no command and no "not checked" is a fault', () => {
  const r = GOOD.replace(/Checks: .*\n/, '').replace('Not checked: the real home folder.\n', '');
  assert.ok(faults(r).some((f) => f.key === 'checks'));
});

test('known-bad: an empty questions heading is a fault; a missing one too', () => {
  assert.ok(faults(GOOD.replace(/- Should.*$/, '')).some((f) => f.key === 'questions'));
  assert.ok(faults(GOOD.replace(/Questions for the person[\s\S]*$/, '')).some((f) => f.key === 'questions'));
});

test('known-bad: no model named is a fault', () => {
  assert.ok(faults(GOOD.replace('Model: Opus.\n', '')).some((f) => f.key === 'model'));
});

test('known-bad: an empty report has every fault', () => {
  assert.deepEqual(faults('').map((f) => f.key).sort(), ['checks', 'files', 'model', 'questions']);
});

test('command line: reads a file, exit 1 with NEEDS lines on a bad report, 0 on a good one', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'report-shape-test-'));
  try {
    fs.writeFileSync(path.join(dir, 'good.txt'), GOOD);
    fs.writeFileSync(path.join(dir, 'bad.txt'), 'All done, everything works.');
    const g = spawnSync(process.execPath, [PROG, path.join(dir, 'good.txt')], { encoding: 'utf8' });
    assert.equal(g.status, 0, g.stdout);
    assert.match(g.stdout, /^OK\|/);
    const b = spawnSync(process.execPath, [PROG, path.join(dir, 'bad.txt')], { encoding: 'utf8' });
    assert.equal(b.status, 1);
    assert.equal(b.stdout.trim().split('\n').filter((l) => l.startsWith('NEEDS|')).length, 4);
    const s = spawnSync(process.execPath, [PROG], { input: GOOD, encoding: 'utf8' });
    assert.equal(s.status, 0, s.stdout);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
