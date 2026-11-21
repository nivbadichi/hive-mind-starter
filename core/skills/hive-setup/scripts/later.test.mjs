// Tests for later.mjs and for the short first conversation it serves.
//   node --test core/skills/hive-setup/scripts/later.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SETUP = path.resolve(HERE, '..');
const STARTER = path.resolve(SETUP, '..', '..', '..');
const PROGRAM = path.join(HERE, 'later.mjs');
const read = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const skill = () => read(path.join(SETUP, 'SKILL.md'));
const section = (text, head) => (text.split(new RegExp(`^## ${head}.*$`, 'm'))[1] || '').split(/^## /m)[0];

const EMPTY = '# What I have asked you\n\n';
function notebook({ setUp = true, record = EMPTY } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'later-'));
  fs.mkdirSync(path.join(root, 'system'), { recursive: true });
  fs.writeFileSync(path.join(root, 'system', 'rules.md'), '# Rules\n');
  if (setUp || record !== null) fs.mkdirSync(path.join(root, 'me'), { recursive: true });
  if (setUp) fs.writeFileSync(path.join(root, 'me', 'profile.md'), '# About you\n\nCall them Sam.\n');
  if (record !== null) fs.writeFileSync(path.join(root, 'me', 'asked.md'), record);
  return root;
}
const run = (root, ...args) => {
  const r = spawnSync(process.execPath, [PROGRAM, ...args], { encoding: 'utf8', env: { ...process.env, HIVE_ROOT: root, HIVE_DATE: '2026-11-20' } });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
};

// Changed 2026-11-20 by the owner's ruling ("Three sizes, then a flavour"): the starting set now asks two picks,
// size first, then kind, each skippable (Light and everyday).
test('the first conversation asks two questions, and the starting set asks two picks: size, then kind', () => {
  const start = section(skill(), '2\\.');
  const asked = start.split('\n').filter((l) => /^\d\.\s+"/.test(l));
  assert.equal(asked.length, 2, 'two questions at the start: what to call you, what fills your days');
  assert.match(asked[0], /What should I call you\?/);
  assert.match(asked[1], /What fills your days/);
  const set = read(path.join(SETUP, 'starting-set.md'));
  assert.match(set, /registry\.mjs apply <kind> --size <size>/);
  const picks = section(set, '1\\.').split('\n').filter((l) => /^\d\.\s+Ask, in these words/.test(l));
  assert.equal(picks.length, 2, 'two picks, one at a time');
  assert.match(picks[0], /Light .*Standard .*Full/, 'the size comes first');
  assert.match(picks[1], /everyday, student, builder, designer, or small business/, 'then the kind');
  assert.match(set, /a skip is \*\*Light\*\* and \*\*everyday\*\*/);
  assert.doesNotMatch(set, /Shall I keep it all/, 'keeping the set is not asked');
});

test('the later questions: each has its words, its moment and the helper that asks it, and that helper says so', async () => {
  const { parseTable, checkTable } = await import('./later.mjs');
  const rows = parseTable(skill());
  assert.deepEqual(rows.map((r) => r.id), ['first', 'brief', 'ideas', 'employer', 'folder', 'names']);
  for (const r of rows) {
    assert.ok(r.words.includes('?'), `${r.id} has the question's words`);
    assert.ok(r.when.length > 10, `${r.id} says when it is asked`);
    assert.ok(r.by.length >= 1, `${r.id} names who asks it`);
  }
  assert.deepEqual(checkTable(STARTER), [], 'every asker exists and runs the check for its question');
  // The privacy check still runs before the first save online, and the names question is offered there.
  const save = section(skill(), '5\\.');
  assert.ok(save.indexOf('later.mjs check names') < save.indexOf('git push'), 'names are offered before the first push');
  assert.ok(save.indexOf('privacy-guard.mjs') < save.indexOf('git push'), 'the privacy check runs before the first push');
});

test('known bad: an asker that does not exist, or one that never runs the check, is named', async () => {
  const { checkTable } = await import('./later.mjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'later-table-'));
  const dir = path.join(root, 'core', 'skills', 'hive-setup');
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(root, 'core', 'skills', 'hive-start'), { recursive: true });
  fs.writeFileSync(path.join(root, 'core', 'skills', 'hive-start', 'SKILL.md'), '# start\nNothing about it.\n');
  fs.writeFileSync(path.join(dir, 'SKILL.md'), [
    '## Later, as it goes', '', '| id | the question | asked when | asked by |', '|---|---|---|---|',
    '| brief | "Want a brief?" | the first chat on a later day | `hive-start` |',
    '| ideas | "Bring ideas?" | the first idea you spot | `hive-nobody` |', '',
  ].join('\n'));
  const problems = checkTable(root);
  assert.ok(problems.some((p) => /hive-start/.test(p) && /later\.mjs check brief/.test(p)), problems.join('\n'));
  assert.ok(problems.some((p) => /hive-nobody/.test(p)), problems.join('\n'));
  fs.rmSync(root, { recursive: true, force: true });
});

test('a question is asked once: ASK, then after mark, DONE; a skip counts as asked', () => {
  const root = notebook();
  assert.match(run(root, 'check', 'brief').out, /^ASK\|brief\|.*\?/);
  assert.equal(run(root, 'mark', 'brief').code, 0);
  assert.match(run(root, 'check', 'brief').out, /^DONE\|brief\|asked 2026-11-20/);
  assert.equal(run(root, 'mark', 'names', '--skipped').code, 0);
  assert.match(run(root, 'check', 'names').out, /^DONE\|names\|skipped 2026-11-20/);
  run(root, 'mark', 'brief');
  const rec = read(path.join(root, 'me', 'asked.md'));
  assert.equal((rec.match(/^- brief:/gm) || []).length, 1, 'marking twice keeps one line');
  const list = run(root, 'list').out;
  assert.match(list, /^DONE\|brief/m); assert.match(list, /^OPEN\|ideas\|/m);
  fs.rmSync(root, { recursive: true, force: true });
});

test('the record never holds an answer, and an unknown question is refused', () => {
  const root = notebook();
  assert.equal(run(root, 'mark', 'names', '--answer', 'Acme').code, 2, 'no way to write an answer');
  assert.equal(run(root, 'mark', 'shoe-size').code, 2);
  assert.equal(run(root, 'check', 'shoe-size').code, 2);
  assert.equal(read(path.join(root, 'me', 'asked.md')), EMPTY, 'nothing was written');
  fs.rmSync(root, { recursive: true, force: true });
});

test('a Hive Mind set up before questions were asked later is never asked again; one not set up is not asked yet', () => {
  const old = notebook({ record: null });
  assert.match(run(old, 'check', 'ideas').out, /^DONE\|ideas\|set up before/);
  const fresh = notebook({ setUp: false, record: null });
  assert.match(run(fresh, 'check', 'ideas').out, /^WAIT\|ideas\|not set up yet/);
  fs.rmSync(old, { recursive: true, force: true }); fs.rmSync(fresh, { recursive: true, force: true });
});

test('begin writes the record once, and keeps what is in it', () => {
  const root = notebook({ record: null });
  assert.equal(run(root, 'begin').code, 0);
  assert.match(read(path.join(root, 'me', 'asked.md')), /^# What I have asked you/);
  assert.match(run(root, 'check', 'ideas').out, /^ASK\|ideas\|/, 'after begin, a set-up of today is asked later');
  run(root, 'mark', 'ideas'); run(root, 'begin');
  assert.match(run(root, 'check', 'ideas').out, /^DONE\|ideas\|/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('the record written at set-up is read: answers given at the start are not asked again', () => {
  const root = notebook({ record: '# What I have asked you\n\n- brief: asked 2026-11-19\n' });
  assert.match(run(root, 'check', 'brief').out, /^DONE\|brief\|asked 2026-11-19/);
  assert.match(run(root, 'check', 'ideas').out, /^ASK\|ideas\|/);
  fs.rmSync(root, { recursive: true, force: true });
});
