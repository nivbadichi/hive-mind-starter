// Tests for project.mjs. A temporary notebook only.
//   node --test core/engine/project.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const PROG = path.join(path.dirname(fileURLToPath(import.meta.url)), 'project.mjs');
function world() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'project-test-'));
  fs.mkdirSync(path.join(root, 'core/templates'), { recursive: true });
  fs.writeFileSync(path.join(root, 'core/templates/project-profile.md'), '# Project profile: <project name>\n\nEmployer or shared project: <yes or no>. x\n');
  const env = { ...process.env, HIVE_ROOT: root, HIVE_DATE: '2026-11-18' };
  const run = (...a) => { const r = spawnSync(process.execPath, [PROG, ...a], { env, encoding: 'utf8' }); return { code: r.status, out: r.stdout, err: r.stderr }; };
  return { root, run };
}

test('new-project writes a state note that passes the project lines', () => {
  const t = world();
  const r = t.run('new-project', '--name', 'My Garden', '--purpose', 'What to plant and when.', '--folder', '~/garden');
  assert.equal(r.code, 0, r.out + r.err);
  const s = fs.readFileSync(path.join(t.root, 'projects/my-garden/state.md'), 'utf8');
  for (const k of ['project: My Garden', 'kind: personal', 'folder: ~/garden', 'stage: discover', 'health:', 'next_step:', 'needs_you:', 'updated: 2026-11-18']) assert.ok(s.includes(k), k);
  assert.ok(r.out.trim().split('\n').slice(1).every((l) => l.startsWith('OK|')), r.out);
  const p = fs.readFileSync(path.join(t.root, 'projects/my-garden/profile.md'), 'utf8');
  assert.match(p, /Project profile: My Garden/); assert.match(p, /Employer or shared project: no/);
});

test('employer projects say so and keep notes high level', () => {
  const t = world();
  t.run('new-project', '--name', 'Work', '--purpose', 'A thing.', '--kind', 'employer');
  assert.match(fs.readFileSync(path.join(t.root, 'projects/work/state.md'), 'utf8'), /kind: employer[\s\S]*high level/);
});

test('a design or build stage names a design direction', () => {
  const t = world();
  const r = t.run('new-project', '--name', 'Site', '--purpose', 'A site.', '--stage', 'design');
  assert.equal(r.code, 0, r.out);
  assert.match(fs.readFileSync(path.join(t.root, 'projects/site/state.md'), 'utf8'), /design_direction: none/);
});

test('it never touches an existing project folder', () => {
  const t = world();
  fs.mkdirSync(path.join(t.root, 'projects/garden'), { recursive: true });
  fs.writeFileSync(path.join(t.root, 'projects/garden/state.md'), 'MINE');
  const r = t.run('new-project', '--name', 'Garden', '--purpose', 'x');
  assert.notEqual(r.code, 0); assert.match(r.err, /already exists/);
  assert.equal(fs.readFileSync(path.join(t.root, 'projects/garden/state.md'), 'utf8'), 'MINE');
  assert.deepEqual(fs.readdirSync(path.join(t.root, 'projects/garden')), ['state.md']);
});

test('bad input is refused and creates nothing', () => {
  const t = world();
  assert.notEqual(t.run('new-project', '--purpose', 'x').code, 0);
  assert.notEqual(t.run('new-project', '--name', 'A', '--purpose', 'x', '--stage', 'dreaming').code, 0);
  assert.notEqual(t.run('new-project', '--name', 'A', '--purpose', 'x', '--kind', 'friend').code, 0);
  assert.notEqual(t.run('new-project', '--name', 'A').code, 0);
  assert.equal(fs.existsSync(path.join(t.root, 'projects')), false);
});

test('a new project also gets its full stack checklist, when the notebook has the list of lines', () => {
  const t = world();
  fs.mkdirSync(path.join(t.root, 'system'), { recursive: true });
  const kit = ['| Id | Line | What it is | For | From | Default | How to use it |', '| --- | --- | --- | --- | --- | --- | --- |',
    '| purpose | What it is for | One line. | all | discover | x | y |', '| front | Screens | Pages. | web | build | x | y |'].join('\n') + '\n';
  fs.writeFileSync(path.join(t.root, 'system/stack.md'), kit);
  const r = t.run('new-project', '--name', 'Shop', '--purpose', 'A website for a shop.');
  assert.equal(r.code, 0, r.out + r.err);
  assert.match(r.out.split('\n')[0], /and projects\/shop\/stack\.md/);
  const s = fs.readFileSync(path.join(t.root, 'projects/shop/stack.md'), 'utf8');
  assert.match(s, /\| purpose \| What it is for \| used \|/);   // the purpose was given
  assert.match(s, /\| front \| Screens \| not yet \| Needed from build/);
  assert.ok(r.out.trim().split('\n').slice(1).every((l) => l.startsWith('OK|')), r.out);
});
