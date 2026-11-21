/**
 * Tests for the factory hooks (layers 1 and 2). Run: node --test core/factory/test/factory.test.mjs
 * Fake repositories in a temporary folder, fake eslint and tsc programs, a fake state folder (HIVE_STATE): the real
 * notebook is only read (the real impact map), and ~/.claude is never touched.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import * as L from '../lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FACTORY = path.resolve(HERE, '..');
const REPO = path.resolve(FACTORY, '..', '..');
const ON_EDIT = path.join(FACTORY, 'on-edit.mjs');
const ON_STOP = path.join(FACTORY, 'on-stop.mjs');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'hive-factory-test-'));
process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {} });

let n = 0;
function w(p, text) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); return p; }
function bench() {
  const dir = path.join(TMP, 'b' + ++n);
  const state = path.join(dir, 'state');
  fs.mkdirSync(state, { recursive: true });
  return { dir, state, env: { ...process.env, HIVE_STATE: state, HIVE_FACTORY_OFF: '', HIVE_FACTORY_SETTINGS: path.join(dir, 'settings.json') } };
}
function hook(file, input, env, raw) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [file], { input: raw != null ? raw : JSON.stringify(input), env, encoding: 'utf8', timeout: 60000 });
  return { code: r.status, out: r.stdout, err: r.stderr, ms: Date.now() - t0 };
}
// A fake repository with an app folder, and optional fake eslint / tsc programs in app/node_modules.
function fakeRepo(b, { eslint, tsc } = {}) {
  const root = path.join(b.dir, 'repo');
  fs.mkdirSync(path.join(root, '.git'), { recursive: true });
  w(path.join(root, 'app', 'package.json'), '{"name":"fake-app","private":true}');
  w(path.join(root, 'app', 'tsconfig.json'), '{"compilerOptions":{"strict":true,"noEmit":true}}');
  const file = w(path.join(root, 'app', 'src', 'lib', 'thing.ts'), 'export const a: number = 1;\n');
  if (eslint) w(path.join(root, 'app', 'node_modules', 'eslint', 'bin', 'eslint.js'), eslint);
  if (tsc) w(path.join(root, 'app', 'node_modules', 'typescript', 'bin', 'tsc'), tsc);
  return { root, file };
}
const ESLINT_FAIL = `process.stdout.write(JSON.stringify([{ filePath: 'x', source: 'TOP SECRET SOURCE TEXT', messages: [{ line: 3, column: 7, severity: 2, message: 'Unexpected var, use let or const instead.', ruleId: 'no-var' }] }])); process.exit(1);`;
const ESLINT_PASS = `process.stdout.write('[{"filePath":"x","messages":[]}]');`;
const TSC_FAIL = `console.log('src/lib/thing.ts(1,14): error TS2322: Type \\'string\\' is not assignable to type \\'number\\'.'); console.log('src/other.ts(2,1): error TS2304: Cannot find name \\'zed\\'.'); process.exit(2);`;
const TSC_PASS = `process.exit(0);`;
const TSC_HANG = `setInterval(() => {}, 1000);`;
const editInput = (file) => ({ session_id: 's1', hook_event_name: 'PostToolUse', tool_name: 'Edit', cwd: path.dirname(file), tool_input: { file_path: file, old_string: 'a', new_string: 'b' } });

// ---------- small parts ----------

test('glob: ** spans folders, * stays inside one, the match is whole-path', () => {
  assert.equal(L.matchAny('core/remote/lib.mjs', ['core/remote/**']), true);
  assert.equal(L.matchAny('core/remote/test/x.test.mjs', ['core/remote/test/*.test.mjs']), true);
  assert.equal(L.matchAny('core/remote/test/deep/x.test.mjs', ['core/remote/test/*.test.mjs']), false);
  assert.equal(L.matchAny('app/src/proxy.gate.ts', ['app/src/proxy*.ts']), true);
  assert.equal(L.matchAny('app/src/app/a/b/page.gate.tsx', ['app/src/app/**/*.gate.tsx']), true);
  assert.equal(L.matchAny('xapp/src/auth.ts', ['app/src/auth.ts']), false);
});

test('redact: hides keys and tokens, leaves out lines naming me/ or an .env file, keeps ordinary process.env lines', () => {
  const text = [
    'error: key sk-ant-abcdefghijklmnopqrstuvwx leaked',
    'token ghp_abcdefghijklmnopqrstuvwxyz0123 here',
    'hex 0123456789abcdef0123456789abcdef0123 end',
    'read C:/Users/someone/hive-mind/me/profile.md',
    'see ../me/taste/profile.md',
    'loaded .env.local',
    'app/src/x.ts:1:1 error process.env.FOO is not typed',
    'app/src/app/me/remote/page.me.tsx(3,1): error TS1',
  ].join('\n');
  const r = L.redact(text, 30);
  assert.ok(!r.includes('sk-ant-abc') && !r.includes('ghp_abc') && !r.includes('0123456789abcdef0123'), r);
  assert.ok(!r.includes('profile.md') && !r.includes('.env.local'), r);
  assert.ok(r.includes('process.env.FOO'), r);
  assert.ok(r.includes('app/src/app/me/remote/page.me.tsx'), 'the site folder called me is not the private one');
  assert.match(r, /3 line\(s\) left out/);
  assert.match(L.redact(Array.from({ length: 50 }, (_, i) => 'line ' + i).join('\n'), 10), /and 40 more lines/);
});

test('import closure: follows relative imports and the @/ alias, skips packages', () => {
  const b = bench();
  const root = path.join(b.dir, 'r');
  w(path.join(root, 'test', 'a.test.mjs'), "import x from '../lib/b.mjs';\nimport y from 'node:fs';\nimport z from 'react';\n");
  w(path.join(root, 'lib', 'b.mjs'), "export * from './c';\nconst m = await import('@/d');\n");
  w(path.join(root, 'lib', 'c.ts'), 'export const c = 1;\n');
  w(path.join(root, 'app', 'src', 'd', 'index.ts'), 'export {};\n');
  w(path.join(root, 'lib', 'unrelated.ts'), '');
  const seen = L.importClosure(root, ['test/a.test.mjs'], { '@/': 'app/src/' });
  assert.deepEqual([...seen].sort(), ['app/src/d/index.ts', 'lib/b.mjs', 'lib/c.ts', 'test/a.test.mjs']);
});

test('worktree: the main checkout is found from the .git file, and its installed packages are borrowed', () => {
  const b = bench();
  const main = path.join(b.dir, 'main');
  fs.mkdirSync(path.join(main, '.git', 'worktrees', 'agent-1'), { recursive: true });
  w(path.join(main, '.git', 'worktrees', 'agent-1', 'commondir'), '../..\n');
  w(path.join(main, 'app', 'node_modules', 'typescript', 'package.json'), '{}');
  const wt = path.join(main, '.claude', 'worktrees', 'agent-1');
  w(path.join(wt, '.git'), 'gitdir: ' + path.join(main, '.git', 'worktrees', 'agent-1') + '\n');
  w(path.join(wt, 'app', 'package.json'), '{}');
  assert.equal(L.mainCheckoutOf(wt), L.norm(main));
  const mods = L.modulesFor(wt);
  assert.equal(mods.borrowed, true);
  assert.equal(mods.appDir, L.norm(path.join(main, 'app')));
  assert.equal(L.modulesFor(main).borrowed, false);
  assert.equal(L.appOf(path.join(wt, 'app', 'src', 'x.ts')).root, L.norm(wt));
  assert.equal(L.appOf(path.join(wt, 'core', 'x.ts')), null);
});

test('changed files and fingerprint: git status of a real temporary repository; a change moves the fingerprint', () => {
  const b = bench();
  const root = path.join(b.dir, 'g');
  fs.mkdirSync(root, { recursive: true });
  assert.equal(spawnSync('git', ['init', '-q', root]).status, 0);
  w(path.join(root, 'a', 'b.txt'), 'one');
  assert.deepEqual(L.changedFiles(root), ['a/b.txt']);
  const f1 = L.fingerprint(root, 'x', ['a/b.txt']);
  assert.equal(L.fingerprint(root, 'x', ['a/b.txt']), f1);
  w(path.join(root, 'a', 'b.txt'), 'two, longer');
  assert.notEqual(L.fingerprint(root, 'x', ['a/b.txt']), f1);
  assert.equal(L.changedFiles(path.join(b.dir, 'not-a-repo')), null);
});

// ---------- layer 1: on-edit.mjs ----------

test('on-edit: any file that is not TypeScript under app/ exits 0 at once, silent, in under a quarter second', () => {
  const b = bench();
  const { root } = fakeRepo(b, { eslint: ESLINT_FAIL, tsc: TSC_FAIL });
  const files = [path.join(root, 'README.md'), path.join(root, 'core', 'x.ts'), path.join(root, 'app', 'src', 'a.css'), path.join(root, 'app', 'node_modules', 'p', 'x.ts'), path.join(root, 'app', '.next', 'types', 'x.ts')];
  for (const f of files) w(f, 'x');
  // Fastest of N: the time judged is the quickest of up to 15 runs (it stops at the first one under the limit). Under a
  // full test run the computer is busy and one process start can take longer than the step itself; the step being
  // slow would make every run slow. Every run must still exit 0 and say nothing.
  const LIMIT = 250, N = 15;
  for (const f of files) {
    const ms = [];
    for (let i = 0; i < N; i++) {
      const r = hook(ON_EDIT, editInput(f), b.env);
      assert.deepEqual([r.code, r.out, r.err], [0, '', ''], f);
      ms.push(r.ms);
      if (r.ms < LIMIT) break;
    }
    assert.ok(Math.min(...ms) < LIMIT, `${f}: fastest of ${ms.length} runs ${Math.min(...ms)} ms (all: ${ms.join(', ')})`);
  }
});

test('on-edit: no input, broken input or a missing file exits 0 and does not hang', () => {
  const b = bench();
  for (const raw of ['', 'not json', '{"tool_input":{}}', JSON.stringify(editInput(path.join(b.dir, 'app', 'gone.ts')))]) {
    const r = hook(ON_EDIT, null, b.env, raw);
    assert.equal(r.code, 0, raw);
    assert.ok(r.ms < 3000, raw + ': ' + r.ms);
  }
});

test('on-edit: a lint error and a type error give exit 2 with both on stderr, and never the file text', () => {
  const b = bench();
  const { file } = fakeRepo(b, { eslint: ESLINT_FAIL, tsc: TSC_FAIL });
  const r = hook(ON_EDIT, editInput(file), b.env);
  assert.equal(r.code, 2, r.err + r.out);
  assert.match(r.err, /HIVE FACTORY \(layer 1\)/);
  assert.match(r.err, /app\/src\/lib\/thing\.ts:3:7 error Unexpected var.*\(no-var\)/);
  assert.match(r.err, /1 in app\/src\/lib\/thing\.ts, 1 elsewhere/);
  assert.match(r.err, /app\/src\/lib\/thing\.ts\(1,14\): error TS2322/);
  assert.match(r.err, /app\/src\/other\.ts\(2,1\): error TS2304/);
  assert.ok(r.err.indexOf('thing.ts(1,14)') < r.err.indexOf('other.ts(2,1)'), 'the edited file comes first');
  assert.ok(!r.err.includes('TOP SECRET SOURCE TEXT'));
  const log = fs.readFileSync(path.join(b.state, 'factory.log'), 'utf8');
  assert.match(log, /"event":"refuse"/);
});

test('on-edit: clean lint and types exit 0 with nothing printed', () => {
  const b = bench();
  const { file } = fakeRepo(b, { eslint: ESLINT_PASS, tsc: TSC_PASS });
  const r = hook(ON_EDIT, editInput(file), b.env);
  assert.deepEqual([r.code, r.out, r.err], [0, '', '']);
});

test('on-edit: missing eslint and tsc never block; the agent is warned', () => {
  const b = bench();
  const { file } = fakeRepo(b);
  const r = hook(ON_EDIT, editInput(file), b.env);
  assert.equal(r.code, 0);
  const o = JSON.parse(r.out);
  assert.equal(o.hookSpecificOutput.hookEventName, 'PostToolUse');
  assert.match(o.hookSpecificOutput.additionalContext, /lint not run: eslint is not installed/);
  assert.match(o.hookSpecificOutput.additionalContext, /type check not run: typescript is not installed/);
});

test('on-edit: a tool that hangs is killed at its limit, and the edit goes through with a warning', () => {
  const b = bench();
  const { file } = fakeRepo(b, { eslint: ESLINT_PASS, tsc: TSC_HANG });
  w(b.env.HIVE_FACTORY_SETTINGS, JSON.stringify({ types: { timeoutMs: 1500 } }));
  const r = hook(ON_EDIT, editInput(file), b.env);
  assert.equal(r.code, 0);
  assert.match(JSON.parse(r.out).hookSpecificOutput.additionalContext, /ran over its 1500 ms limit/);
  assert.ok(r.ms < 8000, String(r.ms));
});

test('on-edit: the whole hook has a hard limit too', () => {
  const b = bench();
  const { file } = fakeRepo(b, { eslint: TSC_HANG, tsc: TSC_HANG });
  w(b.env.HIVE_FACTORY_SETTINGS, JSON.stringify({ edit: { limitMs: 1200 } }));
  const r = hook(ON_EDIT, editInput(file), b.env);
  assert.equal(r.code, 0);
  assert.match(JSON.parse(r.out).hookSpecificOutput.additionalContext, /ran over 1200 ms/);
  assert.ok(r.ms < 6000, String(r.ms));
});

test('on-edit: warn mode tells the agent and exits 0; off mode and the off file do nothing', () => {
  const b = bench();
  const { file } = fakeRepo(b, { eslint: ESLINT_FAIL, tsc: TSC_FAIL });
  w(b.env.HIVE_FACTORY_SETTINGS, JSON.stringify({ lint: { mode: 'warn' }, types: { mode: 'warn' } }));
  let r = hook(ON_EDIT, editInput(file), b.env);
  assert.equal(r.code, 0);
  assert.match(JSON.parse(r.out).hookSpecificOutput.additionalContext, /warning only.*no-var/s);
  w(b.env.HIVE_FACTORY_SETTINGS, JSON.stringify({ lint: { mode: 'off' }, types: { mode: 'off' } }));
  r = hook(ON_EDIT, editInput(file), b.env);
  assert.deepEqual([r.code, r.out, r.err], [0, '', '']);
  w(b.env.HIVE_FACTORY_SETTINGS, '{}');
  w(path.join(b.state, 'factory-off'), '');
  r = hook(ON_EDIT, editInput(file), b.env);
  assert.deepEqual([r.code, r.out, r.err], [0, '', '']);
});

test('on-edit: types.when "stop" leaves only the lint on each edit', () => {
  const b = bench();
  const { file } = fakeRepo(b, { eslint: ESLINT_PASS, tsc: TSC_FAIL });
  w(b.env.HIVE_FACTORY_SETTINGS, JSON.stringify({ types: { when: 'stop' } }));
  const r = hook(ON_EDIT, editInput(file), b.env);
  assert.deepEqual([r.code, r.err], [0, '']);
});

// ---------- layer 2: on-stop.mjs ----------

function stopRepo(b, checks) {
  const root = path.join(b.dir, 'srepo');
  fs.mkdirSync(root, { recursive: true });
  assert.equal(spawnSync('git', ['init', '-q', root]).status, 0);
  w(path.join(root, 'core', 'factory', 'impact-map.json'), JSON.stringify({ aliases: {}, checks }));
  w(path.join(root, 'checks', 'value.test.mjs'), "import { v } from '../lib/value.mjs';\nif (v !== 'good') { console.log('not ok 1 - value is ' + v + ' key sk-ant-abcdefghijklmnopqrstuv'); process.exit(1); }\nconsole.log('ok 1');\n");
  w(path.join(root, 'lib', 'value.mjs'), "export const v = 'bad';\n");
  return root;
}
const VALUE_CHECK = { id: 'value', run: ['node', 'checks/value.test.mjs'], cwd: '.', timeoutMs: 20000, entries: ['checks/*.test.mjs'], covers: [] };
const stopInput = (root, active = false) => ({ session_id: 's1', hook_event_name: 'Stop', cwd: root, stop_hook_active: active, last_assistant_message: 'done' });

test('on-stop: a failing related test blocks with exit 2 and its output; secrets in it are hidden', () => {
  const b = bench();
  const root = stopRepo(b, [VALUE_CHECK]);
  const r = hook(ON_STOP, stopInput(root), b.env);
  assert.equal(r.code, 2, r.out + r.err);
  assert.match(r.err, /HIVE FACTORY \(layer 2\)/);
  assert.match(r.err, /value failed \(node checks\/value\.test\.mjs/);
  assert.match(r.err, /not ok 1 - value is bad/);
  assert.ok(!r.err.includes('sk-ant-abc'));
});

test('on-stop: loop guard; a second stop with nothing changed goes through with a warning, a fix is checked again', () => {
  const b = bench();
  const root = stopRepo(b, [VALUE_CHECK]);
  assert.equal(hook(ON_STOP, stopInput(root), b.env).code, 2);
  let r = hook(ON_STOP, stopInput(root, true), b.env);
  assert.equal(r.code, 0);
  assert.match(JSON.parse(r.out).systemMessage, /still failing.*value/);
  // The agent changes the file but not the fault: blocked again, even with stop_hook_active.
  w(path.join(root, 'lib', 'value.mjs'), "export const v = 'still bad';\n");
  assert.equal(hook(ON_STOP, stopInput(root, true), b.env).code, 2);
  // Fixed: passes; and a further stop on the same files does not run the check again.
  w(path.join(root, 'lib', 'value.mjs'), "export const v = 'good';\n");
  r = hook(ON_STOP, stopInput(root, true), b.env);
  assert.deepEqual([r.code, r.err], [0, '']);
  r = hook(ON_STOP, stopInput(root), b.env);
  assert.equal(r.code, 0);
  const last = fs.readFileSync(path.join(b.state, 'factory.log'), 'utf8').trim().split('\n').pop();
  assert.match(last, /"ran":\[\]/);
});

test('on-stop: files no check covers, or no changes at all, exit 0 at once', () => {
  const b = bench();
  const root = stopRepo(b, [{ ...VALUE_CHECK, entries: ['nothing/*.mjs'] }]);
  let r = hook(ON_STOP, stopInput(root), b.env);
  assert.deepEqual([r.code, r.out, r.err], [0, '', '']);
  const empty = path.join(b.dir, 'empty');
  fs.mkdirSync(empty);
  spawnSync('git', ['init', '-q', empty]);
  r = hook(ON_STOP, stopInput(empty), b.env);
  assert.deepEqual([r.code, r.out, r.err], [0, '', '']);
  r = hook(ON_STOP, stopInput(path.join(b.dir, 'no-repo-here')), b.env);
  assert.deepEqual([r.code, r.out, r.err], [0, '', '']);
  // A folder outside any git folder gives no repository, even when the walk up reaches the drive root. (On Windows a
  // bare drive letter once meant the working folder, so the walk wandered into the real notebook and read its changes.)
  assert.equal(L.repoRootOf(path.join(b.dir, 'no-repo-here')), '');
  assert.equal(L.repoRootOf(path.parse(b.dir).root), '');
  assert.equal(L.repoRootOf(path.join(root, 'lib', 'value.mjs')), L.norm(root));
});

test('on-stop: a manual check (the door test) is named to the person, never run', () => {
  const b = bench();
  const root = stopRepo(b, [{ id: 'door', manual: true, howTo: 'start the gate build, then run the door test', run: ['node', '-e', 'process.exit(1)'], entries: [], covers: ['lib/**'] }]);
  const r = hook(ON_STOP, stopInput(root), b.env);
  assert.equal(r.code, 0);
  assert.match(JSON.parse(r.out).systemMessage, /run only by hand: door \(start the gate build/);
});

test('on-stop: a check that needs the site packages, with none installed, warns and does not block', () => {
  const b = bench();
  const root = stopRepo(b, [{ ...VALUE_CHECK, needsModules: true }]);
  const r = hook(ON_STOP, stopInput(root), b.env);
  assert.equal(r.code, 0);
  assert.match(JSON.parse(r.out).systemMessage, /value: not run, app\/node_modules is missing/);
});

test('on-stop: a check that runs over its limit is stopped and does not block; warn mode and the off file do not block', () => {
  const b = bench();
  const root = stopRepo(b, [{ ...VALUE_CHECK, run: ['node', '-e', 'setInterval(()=>{},1000)'], timeoutMs: 1000 }]);
  let r = hook(ON_STOP, stopInput(root), b.env);
  assert.equal(r.code, 0);
  assert.match(JSON.parse(r.out).systemMessage, /ran over its 1000 ms limit/);
  const root2 = stopRepo(bench(), [VALUE_CHECK]);
  w(b.env.HIVE_FACTORY_SETTINGS, JSON.stringify({ tests: { mode: 'warn' } }));
  r = hook(ON_STOP, stopInput(root2), b.env);
  assert.equal(r.code, 0);
  assert.match(JSON.parse(r.out).systemMessage, /failing \(warn mode\): value/);
  w(b.env.HIVE_FACTORY_SETTINGS, '{}');
  w(path.join(b.state, 'factory-off'), '');
  assert.equal(hook(ON_STOP, stopInput(root2), b.env).code, 0);
});

test('on-stop: with lint.when and types.when "stop", the changed TypeScript under app/ is linted and type-checked once', () => {
  const b = bench();
  const root = stopRepo(b, []);
  w(path.join(root, '.gitignore'), 'node_modules/\n');
  w(path.join(root, 'app', 'package.json'), '{"name":"fake-app"}');
  w(path.join(root, 'app', 'tsconfig.json'), '{}');
  w(path.join(root, 'app', 'src', 'lib', 'thing.ts'), 'export const a = 1;\n');
  w(path.join(root, 'app', 'node_modules', 'eslint', 'bin', 'eslint.js'), ESLINT_FAIL.replace("filePath: 'x'", 'filePath: process.cwd() + "/src/lib/thing.ts"'));
  w(path.join(root, 'app', 'node_modules', 'typescript', 'bin', 'tsc'), TSC_FAIL);
  w(b.env.HIVE_FACTORY_SETTINGS, JSON.stringify({ lint: { when: 'stop' }, types: { when: 'stop' } }));
  const r = hook(ON_STOP, stopInput(root), b.env);
  assert.equal(r.code, 2, r.out + r.err);
  assert.match(r.err, /lint failed \(eslint --max-warnings=0; changed: app\/src\/lib\/thing\.ts\)/);
  assert.match(r.err, /app\/src\/lib\/thing\.ts:3:7 error Unexpected var/);
  assert.match(r.err, /types failed \(tsc --noEmit, whole app/);
  assert.ok(!r.err.includes('TOP SECRET SOURCE TEXT'));
});

// ---------- the real impact map ----------

test('impact map: valid, unique ids, every runnable check names a run, and its entry files exist in this repository', () => {
  const map = JSON.parse(fs.readFileSync(path.join(FACTORY, 'impact-map.json'), 'utf8'));
  const ids = map.checks.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const c of map.checks) {
    assert.ok(Array.isArray(c.entries) && Array.isArray(c.covers), c.id);
    if (!c.manual) assert.ok(Array.isArray(c.run) && c.run.length > 1, c.id);
    else assert.ok(c.howTo, c.id + ' needs a howTo');
    for (const e of c.entries.filter((g) => !/[*?]/.test(g))) assert.ok(fs.existsSync(path.join(REPO, e)), `${c.id}: ${e}`);
  }
});

test('impact map: real files pick the right checks (imports found by the program, the rest by hand-kept globs)', () => {
  const { map } = L.loadMap(REPO);
  const pick = (f) => L.selectChecks(REPO, map, [f]).map((p) => p.check.id).sort();
  assert.deepEqual(pick('core/gates/gates.mjs'), ['gates']);
  assert.deepEqual(pick('core/start/start.ps1'), ['gates']);
  assert.deepEqual(pick('system/rules.md'), ['gates']);
  assert.deepEqual(pick('core/factory/lib.mjs'), ['factory']);
  assert.deepEqual(pick('app/src/page.tsx'), [], 'this copy has no page checks until you add one');
  assert.deepEqual(pick('knowledge/some-note.md'), []);
});
