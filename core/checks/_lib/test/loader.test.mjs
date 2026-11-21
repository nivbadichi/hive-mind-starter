// The loader: finds, validates, orders, runs with a time limit, handles errors by kind, honours modes.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { loadAll, runStep, discover } from '../loader.mjs';
import { validateCheck, validateResult } from '../contract.mjs';
import { makeCtx, makeEv } from '../harness.mjs';
import { libSettings } from '../hook.mjs';
import { makeChecksDir, MODULES, rm } from './fixtures.mjs';

const dirs = [];
after(() => rm(...dirs));
const S = libSettings();
const run = (loaded, step, fields, opts = {}) => runStep(step, loaded, makeEv(step, fields), () => makeCtx(), { settings: S, ...opts });
const write = (f) => ({ tool: 'Write', input: { file_path: f, content: 'x' } });

test('finds every folder but _lib and dot folders, and orders safety first', async () => {
  const dir = makeChecksDir(['say-hello', 'deny-write', 'owe-done', 'throw-safety']); dirs.push(dir);
  assert.deepEqual(discover(dir).map((f) => f.id), ['deny-write', 'owe-done', 'say-hello', 'throw-safety']);
  const l = await loadAll(dir);
  assert.deepEqual(l.modules.map((m) => m.id), ['deny-write', 'throw-safety', 'owe-done', 'say-hello']);
  assert.equal(l.broken.length, 0);
});

test('a check that denies refuses its step and lets others through', async () => {
  const dir = makeChecksDir(['deny-write']); dirs.push(dir);
  const l = await loadAll(dir);
  const bad = await run(l, 'pretool', write('/x/forbidden.txt'));
  assert.match(bad.denies[0].text, /HIVE CHECK \(deny-write\): forbidden\.txt is never written/);
  const good = await run(l, 'pretool', write('/x/fine.txt'));
  assert.equal(good.denies.length, 0);
  assert.ok(good.ran.has('deny-write'));
});

test('a safety check that throws refuses a write but never a read; a discipline one lets both through', async () => {
  const dir = makeChecksDir(['throw-safety', 'throw-discipline']); dirs.push(dir);
  const l = await loadAll(dir);
  const w = await run(l, 'pretool', write('/x/a.txt'));
  assert.deepEqual(w.denies.map((d) => d.id), ['throw-safety']);
  assert.match(w.denies[0].text, /stopped this step to be safe/);
  assert.deepEqual(w.errors.map((e) => e.id).sort(), ['throw-discipline', 'throw-safety']);
  const r = await run(l, 'pretool', { tool: 'Read', input: { file_path: '/x/a.txt' } });
  assert.equal(r.denies.length, 0);
  const sh = await run(l, 'pretool', { tool: 'Bash', input: { command: 'git status && ls -la | grep x' } });
  assert.equal(sh.denies.length, 0, 'a reading shell command runs');
  const del = await run(l, 'pretool', { tool: 'Bash', input: { command: 'ls && rm -rf notes' } });
  assert.equal(del.denies.length, 1, 'a shell command that also deletes is not reading');
});

test('a malformed check is broken; broken safety refuses writes except into its own folder', async () => {
  const dir = makeChecksDir(['malformed', 'say-hello']); dirs.push(dir);
  const l = await loadAll(dir);
  assert.equal(l.broken.length, 1);
  assert.equal(l.broken[0].kind, 'safety', 'an unreadable kind fails closed');
  assert.ok(l.broken[0].problems.some((p) => /kind must be/.test(p)));
  const w = await run(l, 'pretool', write('/x/a.txt'));
  assert.match(w.denies[0].text, /HIVE CHECK \(malformed\).*broken/);
  const mend = await run(l, 'pretool', write(path.join(dir, 'malformed', 'check.mjs')));
  assert.equal(mend.denies.length, 0, 'it can be mended in its own folder');
  const p = await run(l, 'prompt', { prompt: 'hi' });
  assert.equal(p.denies.length, 0);
  assert.equal(p.says.length, 1, 'the other checks still run');
});

test('a folder with no check.mjs, a check that does not load, and bad settings are broken', async () => {
  const dir = makeChecksDir({ empty: null, syntax: 'export default {', bad: MODULES['say-hello'].replace(/say-hello/g, 'bad') }, { bad: '{ not json' }); dirs.push(dir);
  const l = await loadAll(dir);
  assert.deepEqual(l.broken.map((b) => b.id).sort(), ['bad', 'empty', 'syntax']);
  assert.equal(l.broken.find((b) => b.id === 'bad').kind, 'discipline', 'a known kind is kept');
  assert.match(l.broken.find((b) => b.id === 'empty').problems[0], /no check\.mjs/);
  assert.match(l.broken.find((b) => b.id === 'syntax').problems[0], /does not load/);
});

test('a slow check times out: by its kind (safety refuses, discipline passes)', async () => {
  const dir = makeChecksDir(['slow-async', 'slow-sync']); dirs.push(dir);
  const l = await loadAll(dir);
  const t = Date.now();
  const r = await run(l, 'pretool', write('/x/a.txt'));
  assert.ok(Date.now() - t < 700, 'the async one is not waited for');
  assert.deepEqual(r.errors.map((e) => e.id).sort(), ['slow-async', 'slow-sync']);
  assert.ok(r.errors.every((e) => /too long/.test(e.why)));
  assert.deepEqual(r.denies.map((d) => d.id), ['slow-sync'], 'only the safety one refuses; the late deny of the discipline one is dropped');
});

test('a total budget: checks not reached are treated by kind', async () => {
  const dir = makeChecksDir(['slow-sync', 'deny-write']); dirs.push(dir);
  const l = await loadAll(dir);
  const r = await run(l, 'pretool', write('/x/forbidden.txt'), { totalMs: 100 });
  assert.ok(r.errors.some((e) => /out of time|too long/.test(e.why)));
  assert.ok(r.denies.length >= 1);
});

test('modes: notice turns a deny into words; off runs nothing; safety is not switched in settings.json', async () => {
  const src = MODULES['deny-write'].replace("kind: 'safety'", "kind: 'discipline'");
  const dir = makeChecksDir({ 'deny-write': src, 'safe-one': MODULES['deny-write'].replace(/deny-write/g, 'safe-one') }, { 'deny-write': { mode: 'notice' }, 'safe-one': { mode: 'off' } }); dirs.push(dir);
  const l = await loadAll(dir);
  assert.equal(l.modules.find((m) => m.id === 'deny-write').mode, 'notice');
  assert.equal(l.modules.find((m) => m.id === 'safe-one').mode, 'refuse', 'settings.json cannot switch a safety check off');
  assert.ok(l.warnings.some((w) => /safe-one: a safety check is not switched/.test(w)));
  const r = await run(l, 'pretool', write('/x/forbidden.txt'));
  assert.deepEqual(r.denies.map((d) => d.id), ['safe-one']);
  assert.match(r.says[0].text, /HIVE NOTICE \(deny-write, a reminder; nothing was stopped\)/);
  const off = makeChecksDir({ 'deny-write': src }, { 'deny-write': { mode: 'off' } }); dirs.push(off);
  const r2 = await run(await loadAll(off), 'pretool', write('/x/forbidden.txt'));
  assert.equal(r2.denies.length + r2.says.length + r2.ran.size, 0);
});

test('a malformed answer is an error by kind: a deny at stop, an unknown key, a debt at pretool', async () => {
  assert.ok(validateResult('stop', { deny: 'x' }).problems.length);
  assert.ok(validateResult('pretool', { block: 'x' }).problems.length);
  assert.ok(validateResult('pretool', { debt: { key: 'a', text: 'b' } }).problems.length);
  assert.ok(validateResult('stop', { debt: { key: '', text: 'b' } }).problems.length);
  assert.deepEqual(validateResult('stop', { debt: [{ key: 'a', text: 'b' }], say: 'c' }).problems, []);
  assert.deepEqual(validateResult('pretool', null).problems, []);
  const dir = makeChecksDir({ odd: "export default { id: 'odd', rule: 'r', kind: 'safety', about: 'a', steps: { pretool: () => ({ block: true }) } };" }); dirs.push(dir);
  const r = await run(await loadAll(dir), 'pretool', write('/x/a.txt'));
  assert.match(r.errors[0].why, /malformed/);
  assert.equal(r.denies.length, 1);
});

test('the shape check names each fault', () => {
  assert.deepEqual(validateCheck({ id: 'a-b', rule: 'rule 5', kind: 'safety', about: 'x', steps: { stop() {} } }, 'a-b'), []);
  const p = validateCheck({ id: 'A_b', kind: 'x', mode: 'loud', steps: { later() {} }, extra: 1 }, 'a-b');
  for (const re of [/not lower-case/, /rule is missing/, /kind must be/, /mode must be/, /about is missing/, /step "later"/, /unknown field "extra"/]) assert.ok(p.some((x) => re.test(x)), String(re));
  assert.ok(validateCheck({ id: 'b', rule: 'r', kind: 'safety', about: 'a', steps: { stop() {} } }, 'a').some((x) => /not the folder name/.test(x)));
});
