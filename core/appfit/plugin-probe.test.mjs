// Tests for the cloud plugin probe (change C8 of the app-fit note). Temporary folders only; nothing leaves
// the computer and Claude Code itself is not run.
//   node --test core/appfit/plugin-probe.test.mjs
// Known-bad cases: a hooks file without its "hooks" wrapper, a reserved plugin name, a source that climbs out of the
// marketplace, and a stray file in the folder (the probe must carry nothing of the notebook) each fail the check.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { build, check, PROBE_TEXT, hookCommand } from './plugin-probe.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const fresh = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'hive-appfit-probe-')), 'probe');
const needs = (r) => r.filter((l) => l.startsWith('NEEDS'));
const edit = (p, f) => { const j = JSON.parse(fs.readFileSync(p, 'utf8')); f(j); fs.writeFileSync(p, JSON.stringify(j, null, 2)); };

test('build makes a marketplace with one plugin and one start hook; the check passes', () => {
  const dir = fresh();
  build(dir);
  assert.ok(fs.existsSync(path.join(dir, '.claude-plugin', 'marketplace.json')));
  assert.ok(fs.existsSync(path.join(dir, 'plugins', 'hive-probe', '.claude-plugin', 'plugin.json')));
  assert.ok(fs.existsSync(path.join(dir, 'plugins', 'hive-probe', 'hooks', 'hooks.json')));
  assert.deepEqual(needs(check(dir)), []);
});

test('build refuses a folder that already holds files (it would carry them along)', () => {
  const dir = fresh();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'notes.md'), 'a note\n');
  assert.throws(() => build(dir), /not empty/);
});

test('the start hook prints the probe line, on this computer\'s own shell', () => {
  const shell = process.platform === 'win32' ? ['cmd', ['/d', '/c', hookCommand()]] : ['sh', ['-c', hookCommand()]];
  const r = spawnSync(shell[0], shell[1], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), PROBE_TEXT);
});

test('known-bad: a hooks file without the "hooks" wrapper fails', () => {
  const dir = fresh(); build(dir);
  const p = path.join(dir, 'plugins', 'hive-probe', 'hooks', 'hooks.json');
  fs.writeFileSync(p, JSON.stringify(JSON.parse(fs.readFileSync(p, 'utf8')).hooks));
  assert.match(needs(check(dir)).join('\n'), /wrapper/);
});

test('known-bad: a name that passes as one of Anthropic\'s own fails', () => {
  const dir = fresh(); build(dir);
  edit(path.join(dir, 'plugins', 'hive-probe', '.claude-plugin', 'plugin.json'), (j) => { j.name = 'claude-probe'; });
  assert.match(needs(check(dir)).join('\n'), /reserved/);
});

test('known-bad: a plugin source that climbs out of the marketplace fails', () => {
  const dir = fresh(); build(dir);
  edit(path.join(dir, '.claude-plugin', 'marketplace.json'), (j) => { j.plugins[0].source = './../elsewhere'; });
  assert.match(needs(check(dir)).join('\n'), /source/);
});

test('known-bad: a stray file in the probe folder fails (it must carry nothing else)', () => {
  const dir = fresh(); build(dir);
  fs.writeFileSync(path.join(dir, 'plugins', 'hive-probe', 'state.md'), 'a project note\n');
  assert.match(needs(check(dir)).join('\n'), /state\.md/);
});

test('the command line: build then check, one line each, exit 0', () => {
  const dir = fresh();
  const cli = path.join(HERE, 'plugin-probe.mjs');
  const b = spawnSync(process.execPath, [cli, 'build', dir], { encoding: 'utf8' });
  assert.equal(b.status, 0, b.stdout + b.stderr);
  const c = spawnSync(process.execPath, [cli, 'check', dir], { encoding: 'utf8' });
  assert.equal(c.status, 0, c.stdout);
  assert.match(c.stdout, /^OK/m);
});
