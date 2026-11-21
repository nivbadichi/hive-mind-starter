// Tests for app-brief.mjs. Temporary folders only: a fake notebook.
//   node --test core/engine/app-brief.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const PROG = path.join(path.dirname(fileURLToPath(import.meta.url)), 'app-brief.mjs');
const w = (root, rel, text) => { const p = path.join(root, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); };

function world(extra = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'app-brief-test-'));
  w(root, 'system/rules.md', '# Rules\n\n1. Ask first before anything public. More words follow here.\n9. No secrets in notes. Employer material stays high level.\n');
  w(root, 'system/decisions-in-force.md', '# Decisions\n\n## How we work\n\n- The measure is the core idea.\n- Small steps, with proof.\n');
  w(root, 'projects/demo/state.md', '---\nproject: Demo\nkind: personal\nstage: build\nhealth: good\nnext_step: Do the thing.\nneeds_you: A yes.\nupdated: 2026-11-18\n---\n\n# Demo\n\nA small demo project.\n');
  w(root, 'me/private.md', 'PRIVATE-MARKER-XYZ');
  for (const [k, v] of Object.entries(extra)) w(root, k, v);
  const run = (date, ...a) => { const r = spawnSync(process.execPath, [PROG, ...a], { env: { ...process.env, HIVE_ROOT: root, HIVE_DATE: date }, encoding: 'utf8' }); return { code: r.status, out: r.stdout, err: r.stderr }; };
  const get = (f) => fs.readFileSync(path.join(root, 'system/generated/app', f), 'utf8');
  return { root, run, get };
}

test('output is under the limit, dated, and says edit the notebook', () => {
  const { run, get } = world();
  assert.equal(run('2026-11-19', 'demo').code, 0);
  for (const f of ['instructions.md', 'digest.md']) {
    const t = get(f);
    assert.ok(t.length < 16000);
    assert.match(t, /Generated: 2026-11-19\./);
    assert.match(t, /Edit the notebook, not this text/);
  }
  assert.match(get('instructions.md'), /Stage: build/);
  assert.match(get('digest.md'), /Small steps, with proof/);
});

test('the same notebook gives the same text twice', () => {
  const { run, get } = world();
  run('2026-11-19', 'demo'); const a = get('instructions.md') + get('digest.md');
  run('2026-11-19', 'demo'); const b = get('instructions.md') + get('digest.md');
  assert.equal(a, b);
});

test('a huge decisions note is cut under the limit with a pointer', () => {
  const big = '# D\n' + Array.from({ length: 400 }, (_, i) => `- Decision number ${i} with enough words to take some room in the digest, ${'x'.repeat(200)}`).join('\n') + '\n';
  const { run, get } = world({ 'system/decisions-in-force.md': big });
  assert.equal(run('2026-11-19', 'demo').code, 0);
  assert.ok(get('digest.md').length <= 16000);
  assert.match(get('digest.md'), /more lines: read system\/decisions-in-force\.md/);
});

test('nothing from me/ and no secret in the output; a secret in a source stops the copy', () => {
  const { run, get, root } = world();
  run('2026-11-19', 'demo');
  assert.ok(!(get('instructions.md') + get('digest.md')).includes('PRIVATE-MARKER-XYZ'));
  // a made-up key, put together here so the privacy check of a save does not stop on this test file
  w(root, 'system/decisions-in-force.md', '# D\n\n- Use key ' + ['sk', 'abcdefghijklmnopqrstuvwxyz123456'].join('-') + ' for it.\n');
  const r = run('2026-11-19', 'demo');
  assert.equal(r.code, 1);
  assert.match(r.err, /secret/);
});

test('an employer project stays high level', () => {
  const { run, get } = world({ 'projects/demo/state.md': '---\nproject: Demo\nkind: employer\nstage: build\nhealth: good\nnext_step: Next.\nneeds_you: CONFIDENTIAL-DETAIL\ndesign_direction: x.md\nupdated: 2026-11-18\n---\n\n# Demo\n\nGoal line.\n' });
  run('2026-11-19', 'demo');
  assert.ok(!get('instructions.md').includes('CONFIDENTIAL-DETAIL'));
  assert.match(get('instructions.md'), /high level/);
});

test('the text speaks of the person whose notebook it is, never of an "owner"', () => {
  const { run, get } = world();
  run('2026-11-19', 'demo');
  const t = get('instructions.md') + get('digest.md');
  assert.match(get('instructions.md'), /Needs the person: A yes\./);
  assert.match(get('instructions.md'), /ask the person before anything public/);
  assert.doesNotMatch(t, new RegExp(['ow', 'ner'].join(''), 'i'));
});

test('check: current passes, edited note is out of date; me/ output refused; missing project fails', () => {
  const { run, root } = world();
  run('2026-11-19', 'demo');
  assert.equal(run('2026-11-20', 'demo', '--check').code, 0);
  w(root, 'system/rules.md', '# Rules\n\n1. A new first rule. Words.\n');
  assert.equal(run('2026-11-20', 'demo', '--check').code, 1);
  assert.equal(run('2026-11-20', 'demo', '--out', 'me/x').code, 2);
  assert.equal(run('2026-11-20', 'nope').code, 1);
});
