// Tests for stack.mjs. A temporary notebook only; nothing real is read or written.
//   node --test core/engine/stack.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROG = path.join(HERE, 'stack.mjs');
const w = (root, rel, text) => { const p = path.join(root, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); };
const rd = (root, rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const KIT = `# Kit

| Id | Line | What it is | For | From | Default | How to use it |
| --- | --- | --- | --- | --- | --- | --- |
| | **1. The idea** | | | | | |
| purpose | What it is for | One line. | all | discover | Hive Mind | Claude asks. |
| builder | Who builds | The builder. | all | discover | Claude | Nothing. |
| | **2. The front** | | | | | |
| front | The screens work | Pages run. | web | build | no default yet: scout it | Claude builds. |
| errors | Error tracking | Know when it breaks. | web | release | Sentry | Claude connects it. |
| | **3. Money** | | | | | |
| payments | Taking payments | Money moves. | money | design | Stripe | Test mode only. |
| rule | Employer rule | Where things are kept. | employer | define | no default | Ask the employer. |
`;

function world() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stack-test-'));
  w(root, 'system/stack.md', KIT);
  w(root, 'core/templates/project-stack.md', '---\nproject: <project name>\ntags: <tags>\nupdated: <date>\n---\n\n# Stack: <project name>\n\n<!-- lines -->\n');
  const state = (name, stage, extra = '', kind = 'personal') => `---\nproject: ${name}\nkind: ${kind}\nstage: ${stage}\nhealth: good\nnext_step: x\nneeds_you: x\nupdated: 2026-11-18\n---\n\n# ${name}\n\n${extra}\n`;
  w(root, 'projects/site/state.md', state('Site', 'build (round 2)', 'A website with a dashboard for customers.'));
  w(root, 'projects/later/state.md', state('Later', 'not set up'));
  w(root, 'projects/frozen/state.md', state('Frozen', 'paused (frozen)'));
  w(root, 'projects/work/state.md', state('Work', 'design', 'A website for events.', 'employer'));
  const env = { ...process.env, HIVE_ROOT: root, HIVE_DATE: '2026-11-18' };
  const run = (...a) => { const r = spawnSync(process.execPath, [PROG, ...a], { env, encoding: 'utf8' }); return { code: r.status, out: r.stdout.trim(), err: r.stderr.trim() }; };
  return { root, run };
}
const row = (root, proj, id) => rd(root, `projects/${proj}/stack.md`).split('\n').find((l) => l.startsWith(`| ${id} |`));

test('new writes every kit line, with the right first status for the stage and the tags', () => {
  const t = world();
  const r = t.run('new', 'site', '--tags', 'code,web');
  assert.equal(r.code, 0, r.out + r.err);
  assert.match(r.out, /stage build; tags: code, web/);
  assert.match(row(t.root, 'site', 'purpose'), /\| missing \|/);          // due at discover, not checked yet
  assert.match(row(t.root, 'site', 'builder'), /\| used \|/);              // the kit's own answer
  assert.match(row(t.root, 'site', 'front'), /\| missing \|/);             // web, due at build
  assert.match(row(t.root, 'site', 'errors'), /\| not yet \| Needed from release\./);
  assert.match(row(t.root, 'site', 'payments'), /\| not needed \| Not a money project/);
  assert.match(rd(t.root, 'projects/site/stack.md'), /^---\nproject: Site\ntags: code, web\nupdated: 2026-11-18\n---/);
  assert.equal((rd(t.root, 'projects/site/stack.md').match(/^\| (purpose|builder|front|errors|payments|rule) \|/gm) || []).length, 6);
});

test('new refuses a project that is not set up, is paused, or already has a note', () => {
  const t = world();
  assert.match(t.run('new', 'later').err, /set up and not paused/);
  assert.match(t.run('new', 'frozen').err, /set up and not paused/);
  assert.equal(t.run('new', 'site').code, 0);
  const again = t.run('new', 'site');
  assert.equal(again.code, 1); assert.match(again.err, /already exists/);
  assert.match(t.run('new', 'site', '--tags', 'nonsense').err, /already exists|Unknown tag/);
});

test('an employer project gets the employer tag, and its rule line is due at define', () => {
  const t = world();
  t.run('new', 'work');
  assert.match(rd(t.root, 'projects/work/stack.md'), /tags: .*employer/);
  assert.match(row(t.root, 'work', 'rule'), /\| missing \|/);
});

test('tags are guessed from the project words when none are given', () => {
  const t = world();
  const r = t.run('new', 'site');
  assert.match(r.out, /tags: code, web/);
  assert.match(r.out, /users|public/);
});

test('check: missing lines due now are NEEDS, named in plain words; others are not', () => {
  const t = world();
  t.run('new', 'site', '--tags', 'code,web');
  const o = t.run('check', 'site');
  assert.equal(o.code, 1);
  assert.match(o.out, /NEEDS\|Project Site: still missing, due since discover: What it is for/);
  assert.match(o.out, /NEEDS\|Project Site: still missing, due since build: The screens work/);
  assert.doesNotMatch(o.out, /Error tracking/);   // not yet, so not due
});

test('check: all clear once every due line is used or not needed with a reason', () => {
  const t = world();
  t.run('new', 'site', '--tags', 'code,web');
  assert.equal(t.run('set', 'site', 'purpose', 'used', 'Said in the note.', '--where', 'projects/site/state.md').code, 0);
  assert.equal(t.run('set', 'site', 'front', 'used', 'Built and live.', '--where', 'app/').code, 0);
  const o = t.run('check', 'site');
  assert.equal(o.code, 0, o.out);
  assert.match(o.out, /^OK\|Project Site: full stack checklist complete for build \(3 used, 0 missing but not due, 2 not needed, 1 not yet\)$/);
});

test('check: a not needed line without a reason, a used line without a place, and a blank cell fail', () => {
  const t = world();
  t.run('new', 'site', '--tags', 'code,web');
  const p = path.join(t.root, 'projects/site/stack.md'); let s = fs.readFileSync(p, 'utf8');
  s = s.replace(/^\| payments \|.*$/m, '| payments | Taking payments | not needed | no | design | 2026-11-18 | - |');
  s = s.replace(/^\| builder \|.*$/m, '| builder | Who builds | used | Claude. | discover | 2026-11-18 | - |');
  s = s.replace(/^\| errors \|.*$/m, '| errors | Error tracking | not yet |  | release | 2026-11-18 | - |');
  fs.writeFileSync(p, s);
  const o = t.run('check', 'site').out;
  assert.match(o, /"Taking payments" is marked not needed with no reason/);
  assert.match(o, /"Who builds" is marked used but does not say where it lives/);
  assert.match(o, /"Error tracking" is blank \(Detail is empty\)/);
});

test('check: a not yet line whose stage has been reached must be settled', () => {
  const t = world();
  t.run('new', 'site', '--tags', 'code,web');
  const p = path.join(t.root, 'projects/site/state.md');
  fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace('stage: build (round 2)', 'stage: release'));
  assert.match(t.run('check', 'site').out, /"Error tracking" was marked not yet, but the project has reached release/);
});

test('check: projects not set up or paused need no note; a set up project without one is NEEDS', () => {
  const t = world();
  const o = t.run('check');
  assert.doesNotMatch(o.out, /Later|Frozen/);
  assert.match(o.out, /NEEDS\|Project Site: has no full stack checklist/);
  assert.match(o.out, /NEEDS\|Project Work: has no full stack checklist/);
});

test('check: lines the kit gained are NEEDS until sync adds them', () => {
  const t = world();
  t.run('new', 'site', '--tags', 'code,web');
  w(t.root, 'system/stack.md', KIT + '| backups | Backups | Copies. | data | release | no default | Claude sets it up. |\n');
  assert.match(t.run('check', 'site').out, /lacks 1 line\(s\) the kit has now: backups/);
  const s = t.run('sync', 'site');
  assert.match(s.out, /Added 1 line\(s\): backups\./);
  assert.doesNotMatch(t.run('check', 'site').out, /lacks/);
  assert.match(row(t.root, 'site', 'backups'), /\| not needed \|/);
  assert.match(t.run('sync', 'site').out, /already has every line/);
});

test('set keeps the shape, stamps the date, and refuses a bad status or a used line with no place', () => {
  const t = world();
  t.run('new', 'site', '--tags', 'code,web');
  assert.match(t.run('set', 'site', 'front', 'bogus', 'x').err, /status must be one of/);
  assert.match(t.run('set', 'site', 'front', 'used', 'Built.').err, /says where it lives/);
  assert.match(t.run('set', 'site', 'front', 'not needed', 'no').err, /real reason/);
  assert.match(t.run('set', 'site', 'nothing', 'missing', 'x').err, /is not in projects\/site\/stack\.md/);
  assert.equal(t.run('set', 'site', 'errors', 'missing', 'Live now, nothing watches it.', '--from', 'build').code, 0);
  assert.match(row(t.root, 'site', 'errors'), /\| missing \| Live now, nothing watches it\. \| build \| 2026-11-18 \| - \|/);
  assert.match(t.run('check', 'site').out, /still missing, due since build: Error tracking/);
});

test('next shows the three most important missing lines with how to use them, due lines first', () => {
  const t = world();
  t.run('new', 'site', '--tags', 'code,web');
  t.run('set', 'site', 'errors', 'missing', 'Nothing watches it.');
  const o = t.run('next', 'site').out.split('\n');
  assert.equal(o.length, 3);
  assert.match(o[0], /^1\. What it is for \(due since discover\): One line\. Default: Hive Mind\. How to use it: Claude asks\.$/);
  assert.match(o[1], /^2\. The screens work \(due since build\)/);
  assert.match(o[2], /^3\. Error tracking \(due from release\)/);
  t.run('set', 'site', 'purpose', 'used', 'Said.', '--where', 'x');
  t.run('set', 'site', 'front', 'used', 'Built.', '--where', 'x');
  t.run('set', 'site', 'errors', 'used', 'Sentry on.', '--where', 'x');
  assert.match(t.run('next', 'site').out, /Nothing missing for Site at build/);
});

test('summary has one line per project', () => {
  const t = world();
  t.run('new', 'site', '--tags', 'code,web');
  const o = t.run('summary').out.split('\n');
  assert.equal(o.length, 4);
  assert.ok(o.includes('Site: 1 used, 2 missing (2 due now), 2 not needed, 1 not yet'), o.join(' | '));
  assert.ok(o.includes('Later: not set up, no stack checklist needed yet'));
  assert.ok(o.includes('Work: no stack checklist yet'));
});
