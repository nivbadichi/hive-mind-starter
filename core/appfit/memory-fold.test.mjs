// Tests for the app's own memory notes (change C3 of the app-fit note). Made-up homes only.
//   node --test core/appfit/memory-fold.test.mjs
// Known-bad cases: a memory file changed after it was taken in is listed again; switching off without --apply changes
// nothing; the real home's settings file is refused without the owner's yes; "on" after "off" gives the file back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { memoryFiles, pending, noticeLine, mark, planOff, planOn, applyPlan, isRealSettings } from './memory-fold.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(HERE, 'memory-fold.mjs');
const w = (p, t) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, t); };
function home() {
  const h = fs.mkdtempSync(path.join(os.tmpdir(), 'hive-appfit-mem-'));
  const claude = path.join(h, '.claude');
  fs.mkdirSync(claude, { recursive: true });
  return { h, claude, hive: path.join(claude, 'hive') };
}
const run = (args, env) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', env: { ...process.env, ...env } });

test('memory files: index and topic files under every project, nothing else', () => {
  const { claude } = home();
  w(path.join(claude, 'projects', 'proj-a', 'memory', 'MEMORY.md'), '- [Role](user_role.md)\n');
  w(path.join(claude, 'projects', 'proj-a', 'memory', 'user_role.md'), 'A made-up note.\n');
  w(path.join(claude, 'projects', 'proj-a', 'chat.jsonl'), '{}\n');           // a chat record, not a memory note
  fs.mkdirSync(path.join(claude, 'projects', 'proj-b', 'memory'), { recursive: true }); // an empty memory folder
  const files = memoryFiles({ claude }).map((f) => f.rel).sort();
  assert.deepEqual(files, ['projects/proj-a/memory/MEMORY.md', 'projects/proj-a/memory/user_role.md']);
});

test('memory files: a folder named by autoMemoryDirectory in the settings is read too', () => {
  const { h, claude } = home();
  const other = path.join(h, 'elsewhere');
  w(path.join(claude, 'settings.json'), JSON.stringify({ autoMemoryDirectory: other }));
  w(path.join(other, 'MEMORY.md'), 'x\n');
  assert.equal(memoryFiles({ claude }).length, 1);
});

test('notice: none for an empty folder; one line while a file is not taken in; none after mark; back when it changes', () => {
  const { claude, hive } = home();
  fs.mkdirSync(path.join(claude, 'projects', 'p', 'memory'), { recursive: true });
  assert.equal(noticeLine({ claude, hive }), '', 'an empty folder gives no notice');
  const f = path.join(claude, 'projects', 'p', 'memory', 'MEMORY.md');
  w(f, '- a made-up memory\n');
  const line = noticeLine({ claude, hive });
  assert.match(line, /^NOTICE: Claude's own memory notes hold 1 file not yet taken into the notebook/);
  assert.ok(!line.includes(claude), 'the notice names no full path');
  mark({ claude, hive, all: true });
  assert.equal(noticeLine({ claude, hive }), '', 'taken in: quiet');
  w(f, '- a made-up memory\n- one more line Claude wrote later\n');
  assert.equal(pending({ claude, hive }).length, 1, 'known-bad: a changed file is listed again');
});

test('off: a dry run changes nothing and says what it would write', () => {
  const { claude, hive } = home();
  const s = path.join(claude, 'settings.json');
  w(s, JSON.stringify({ theme: 'dark', hooks: { Stop: [] } }, null, 2));
  const before = fs.readFileSync(s, 'utf8');
  const r = run(['off', '--settings', s], { HIVE_CLAUDE: claude, HIVE_STATE: hive });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /DRY RUN/);
  assert.match(r.stdout, /"autoMemoryEnabled": false/);
  assert.equal(fs.readFileSync(s, 'utf8'), before, 'nothing written');
});

test('off --apply then on --apply: the key is false, other settings kept, a dated copy made; on gives the file back', () => {
  const { claude, hive } = home();
  const s = path.join(claude, 'settings.json');
  const original = { theme: 'dark', autoMemoryEnabled: true, hooks: { Stop: [] } };
  w(s, JSON.stringify(original, null, 2));
  applyPlan(planOff({ settings: s, hive }), { settings: s, hive });
  const after = JSON.parse(fs.readFileSync(s, 'utf8'));
  assert.equal(after.autoMemoryEnabled, false);
  assert.equal(after.theme, 'dark');
  assert.deepEqual(after.hooks, { Stop: [] });
  assert.ok(fs.readdirSync(claude).some((n) => /^settings\.json\.\d{8}-\d{6}\.bak$/.test(n)), 'a dated copy is kept');
  applyPlan(planOn({ settings: s, hive }), { settings: s, hive });
  assert.deepEqual(JSON.parse(fs.readFileSync(s, 'utf8')), original, 'the old value is back');
});

test('on after off on a file that had no key: the key is taken out again', () => {
  const { claude, hive } = home();
  const s = path.join(claude, 'settings.json');
  w(s, JSON.stringify({ theme: 'light' }));
  applyPlan(planOff({ settings: s, hive }), { settings: s, hive });
  applyPlan(planOn({ settings: s, hive }), { settings: s, hive });
  assert.deepEqual(JSON.parse(fs.readFileSync(s, 'utf8')), { theme: 'light' });
});

test('known-bad: --apply on the real home settings is refused without --owner-said-yes', () => {
  const real = path.join(os.homedir(), '.claude', 'settings.json');
  assert.equal(isRealSettings(real), true);
  // The run is refused before the file is opened, so the real file is never read or written here.
  const r = run(['off', '--settings', real, '--apply']);
  assert.equal(r.status, 2);
  assert.match(r.stdout + r.stderr, /needs your yes/);
});

test('a settings file that is not JSON is never overwritten', () => {
  const { claude, hive } = home();
  const s = path.join(claude, 'settings.json');
  w(s, '{ not json');
  assert.throws(() => planOff({ settings: s, hive }), /not valid JSON/);
  assert.equal(fs.readFileSync(s, 'utf8'), '{ not json');
});
