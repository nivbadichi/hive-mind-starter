// Tests for lessons.mjs. Temporary folders only: a made-up notebook with made-up lessons.
//   node --test core/engine/lessons.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const PROG = path.join(path.dirname(fileURLToPath(import.meta.url)), 'lessons.mjs');
const w = (root, rel, text) => { const p = path.join(root, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); };

function world(lessons, napkin) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lessons-test-'));
  w(root, 'core/real.mjs', '// real');
  w(root, 'system/lessons.md', lessons);
  if (napkin !== undefined) w(root, '.claude/napkin.md', napkin);
  const env = { ...process.env, HIVE_ROOT: root, HIVE_DATE: '2026-11-19' };
  const run = (...a) => { const r = spawnSync(process.execPath, [PROG, ...a], { env, encoding: 'utf8' }); return { code: r.status, out: r.stdout }; };
  return { root, run };
}

const SIX = [
  '# Lessons', '',
  '- 2026-11-19: Closed by a real file. closed_by: the check in core/real.mjs (warns)',
  '- 2026-11-19: Closed by a missing file. closed_by: core/ghost/gone.mjs refuses it',
  '- 2026-11-19: Owed one. closed_by: owed today: a program that does not exist yet',
  '- 2026-11-18: Open one. closed_by: open (would close with: a line somewhere)',
  '- 2026-11-17: Has no closed_by line at all.',
  '- 2026-11-17: A prose-only close. closed_by: rule 4, a written rule only',
  '',
].join('\n');

test('a lesson closed by a real file is not listed', () => {
  const { run } = world(SIX);
  assert.ok(!run().out.includes('Closed by a real file'));
});
test('a lesson closed by a missing file is listed as missing', () => {
  const { run } = world(SIX);
  assert.match(run().out, /MISSING FILE: 2026-11-19, line 4: Closed by a missing file\..*core\/ghost\/gone\.mjs/);
});
test('owed and open lessons are listed as owed', () => {
  const { run } = world(SIX);
  const o = run().out;
  assert.match(o, /OWED: 2026-11-19, line 5: Owed one/);
  assert.match(o, /OWED: 2026-11-18, line 6: Open one/);
});
test('a lesson with no closed_by line is listed', () => {
  const { run } = world(SIX);
  assert.match(run().out, /NO CLOSED_BY: 2026-11-17, line 7: Has no closed_by line at all/);
});
test('a closed_by that names no file is not called missing', () => {
  const { run } = world(SIX);
  assert.ok(!run().out.includes('A prose-only close'));
});
test('the summary counts, and the exit code is 1 when something is listed', () => {
  const { run } = world(SIX);
  const r = run();
  assert.match(r.out, /^4 of 6 lessons are not closed by something real; 2 are\./);
  assert.equal(r.code, 1);
});
test('all closed: nothing listed, exit 0', () => {
  const { run } = world('# L\n\n- 2026-11-19: Fine. closed_by: core/real.mjs\n');
  const r = run();
  assert.equal(r.code, 0);
  assert.match(r.out, /^0 of 1 lessons/);
});
test('--since keeps only lessons from that date on', () => {
  const { run } = world(SIX);
  const o = run('--since', '2026-11-19').out;
  assert.match(o, /^2 of 3/);
  assert.ok(!o.includes('Open one'));
});
test('a missing lessons file is said plainly, not a crash', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lessons-test-'));
  const r = spawnSync(process.execPath, [PROG], { env: { ...process.env, HIVE_ROOT: root }, encoding: 'utf8' });
  assert.match(r.stdout, /was not found/);
  assert.equal(r.status, 1);
});
test('napkin: an old correction is listed raw; today, undated, ordinary or already-a-lesson lines are not', () => {
  const napkin = [
    '# Napkin',
    '- 2026-11-17: owner corrected me: never put the date in the file name here',
    '- 2026-11-19: owner corrected me: from today, not yet a day old',
    '- owner corrected me: no date on this line at all',
    '- 2026-11-16: the build takes about a minute',
    '- 2026-11-15: told you twice: this one is already a lesson in the notes',
  ].join('\n');
  const { run } = world(SIX + '- 2026-11-15: told you twice: this one is already a lesson in the notes. closed_by: core/real.mjs\n', napkin);
  const o = run().out;
  assert.match(o, /RAW, NOT YET A LESSON: 2026-11-17, napkin line 2/);
  assert.ok(!o.includes('from today'));
  assert.ok(!o.includes('no date on this line'));
  assert.ok(!o.includes('takes about a minute'));
  assert.ok(!/RAW.*already a lesson/.test(o));
});
test('no napkin file: no napkin lines, no crash', () => {
  const { run } = world('# L\n\n- 2026-11-19: Fine. closed_by: core/real.mjs\n');
  assert.equal(run().code, 0);
});
test('the program changes no file', () => {
  const { root, run } = world(SIX, '- 2026-11-10: correction: x x x x x x x x x x x x x x x x x\n');
  const before = fs.readFileSync(path.join(root, 'system/lessons.md'), 'utf8');
  run();
  assert.equal(fs.readFileSync(path.join(root, 'system/lessons.md'), 'utf8'), before);
});
