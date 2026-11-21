// Proof for handing out by rule: node --test core/engine/handout.test.mjs
// Everything runs in a temporary folder. The proofs the plan asks for: two helpers on the same file are refused, a
// seventh helper is refused, helpers on different files go side by side; and the program fails open on its own error.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { decide, filesTouched, overlap } from './handout.mjs';

const HANDOUT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'handout.mjs');
const brief = (files) => `## How it will be proven\n- Today: x\n- Steps: x\n- Must pass: x\n- Files touched: ${files}. Out of scope: the rest.\n`;
const h = (name, ...files) => ({ name, files });

function world(settingsMax) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hive-handout-'));
  const state = path.join(root, 'state'); fs.mkdirSync(state);
  if (settingsMax !== undefined) { fs.mkdirSync(path.join(root, 'core', 'gates'), { recursive: true }); fs.writeFileSync(path.join(root, 'core', 'gates', 'settings.json'), JSON.stringify({ handout: { maxAtOnce: settingsMax } })); }
  const run = (plan, env = {}) => {
    const f = path.join(root, 'plan.json'); fs.writeFileSync(f, typeof plan === 'string' ? plan : JSON.stringify(plan));
    const r = spawnSync(process.execPath, [HANDOUT, 'check', f], { env: { ...process.env, HIVE_ROOT: root, HIVE_STATE: state, ...env }, encoding: 'utf8' });
    return { code: r.status, out: r.stdout.trim() };
  };
  return { root, state, run };
}

test('reads "Files touched" from a brief, without the out-of-scope part', () => {
  assert.deepEqual(filesTouched(brief('`core/gates/**`, core\\engine\\handout.mjs and core/templates/build-brief.md')), ['core/gates/**', 'core/engine/handout.mjs', 'core/templates/build-brief.md']);
  assert.deepEqual(filesTouched('## How it will be proven\n- Files touched: <paths or globs, separated by commas>'), []);
  assert.deepEqual(filesTouched('no such line'), []);
});

test('overlap: same file, folder and file, glob and file, two globs', () => {
  assert.equal(overlap('core/gates/gates.mjs', 'Core\\Gates\\gates.mjs'), true);
  assert.equal(overlap('core/gates/**', 'core/gates/gates.mjs'), true);
  assert.equal(overlap('core/gates/', 'core/gates/test.mjs'), true);
  assert.equal(overlap('core/gates', 'core/gates/test.mjs'), true);
  assert.equal(overlap('core/**', 'core/gates/*.json'), true);
  assert.equal(overlap('core/gates/*.json', 'core/gates/gates.mjs'), false);
  assert.equal(overlap('core/factory/**', 'core/gates/**'), false);
  assert.equal(overlap('app/**/*.tsx', 'app/src/page.tsx'), true);
  assert.equal(overlap('core/gates/gates.mjs', 'core/gates/gates.mjs.bak'), false);
});

test('two helpers on the same file: the second is refused, in whole sentences', () => {
  const d = decide({ running: [h('B', 'core/gates/**')], next: h('D', 'core/gates/gates.mjs'), maxAtOnce: 6 });
  assert.equal(d.go, false);
  assert.match(d.reasons.join(' '), /The new helper D and helper B would both touch core\/gates\/gates\.mjs and core\/gates\/\*\*\. Start it after helper B has finished/);
});

test('helpers on different files go side by side', () => {
  const d = decide({ running: [h('C', 'core/factory/**'), h('E', 'core/skills/hive-verify/**')], next: h('D', 'core/gates/**', 'core/engine/handout.mjs'), maxAtOnce: 6 });
  assert.deepEqual(d, { go: true, reasons: [], max: 6 });
});

test('a seventh helper is refused; a sixth goes', () => {
  const six = ['A', 'B', 'C', 'E', 'F', 'G'].map((n) => h(n, `w/${n}.md`));
  const d7 = decide({ running: six, next: h('H', 'w/H.md'), maxAtOnce: 6 });
  assert.equal(d7.go, false);
  assert.match(d7.reasons[0], /^6 helpers are running already, and the top number at once is 6\./);
  assert.equal(decide({ running: six.slice(0, 5), next: h('H', 'w/H.md'), maxAtOnce: 6 }).go, true);
});

test('a helper that names no files is refused, and so is a new one beside a running helper with none', () => {
  assert.match(decide({ running: [], next: { name: 'X' }, maxAtOnce: 6 }).reasons[0], /names no files it will touch/);
  assert.match(decide({ running: [{ name: 'Y' }], next: h('X', 'a.md'), maxAtOnce: 6 }).reasons[0], /Helper Y names no files it touches/);
});

test('the command line: GO, STOP with exit 3, briefs read from files, the top number from the settings', () => {
  const w = world(2);
  fs.writeFileSync(path.join(w.root, 'b.md'), brief('core/gates/**'));
  fs.writeFileSync(path.join(w.root, 'd.md'), brief('core/gates/settings.json'));
  assert.deepEqual(w.run({ running: [], next: { name: 'D', brief: 'd.md' } }), { code: 0, out: 'GO' });
  const r = w.run({ running: [{ name: 'B', brief: 'b.md' }], next: { name: 'D', brief: 'd.md' } });
  assert.equal(r.code, 3); assert.match(r.out, /^STOP: The new helper D and helper B would both touch/);
  const r2 = w.run({ running: [h('A', 'a.md'), h('B', 'b2.md')], next: h('C', 'c.md') });
  assert.equal(r2.code, 3); assert.match(r2.out, /top number at once is 2\./);
});

test('the default top number is 6 when the settings do not say', () => {
  const w = world();
  const six = ['A', 'B', 'C', 'E', 'F', 'G'].map((n) => h(n, `w/${n}.md`));
  assert.equal(w.run({ running: six.slice(0, 5), next: h('H', 'w/H.md') }).code, 0);
  assert.equal(w.run({ running: six, next: h('H', 'w/H.md') }).code, 3);
});

test('its own error fails open: GO (not checked), exit 0, an error line in the gates log', () => {
  const w = world();
  const r = w.run('{ not json');
  assert.equal(r.code, 0); assert.match(r.out, /^GO \(not checked: /);
  const r2 = w.run({ running: [], next: h('X', 'a.md') }, { HIVE_HANDOUT_CRASH: '1' });
  assert.equal(r2.code, 0); assert.match(r2.out, /^GO \(not checked: /);
  const lines = fs.readFileSync(path.join(w.state, 'gates.log'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(lines.length, 2); assert.ok(lines.every((l) => l.event === 'error' && l.mode === 'handout'));
});
