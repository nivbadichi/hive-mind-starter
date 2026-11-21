// The harness other checks use, and the list and doctor commands.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeEv, makeCtx, runOne, throwing, timeStep, validate } from '../harness.mjs';
import { isReadingCommand } from '../reading.mjs';
import { libSettings } from '../hook.mjs';
import { makeChecksDir, rm } from './fixtures.mjs';

const dirs = [];
after(() => rm(...dirs));
const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'cli.mjs');

const check = {
  id: 'no-forbidden', rule: 'test', kind: 'safety', about: 'Refuses forbidden.txt unless the person named it.',
  steps: { pretool: (ev, ctx) => (/forbidden/.test(ev.input.file_path || '') && !ctx.said('forbidden') ? { deny: 'not without a word from the person' } : null) },
};

test('runOne: a known-bad case is caught, a known-good case passes, a word from the person lets it through', async () => {
  const ev = makeEv('pretool', { tool: 'Write', input: { file_path: 'a/forbidden.txt' } });
  assert.match((await runOne(check, 'pretool', ev, makeCtx())).deny, /not without a word from the person/);
  assert.equal((await runOne(check, 'pretool', ev, makeCtx({ hisLast: 'yes, write forbidden.txt' }))).deny, '');
  assert.equal((await runOne(check, 'pretool', makeEv('pretool', { tool: 'Write', input: { file_path: 'ok.txt' } }), makeCtx())).deny, '');
});

test('throwing: on its own error a safety check refuses a write and lets a read through; discipline lets both', async () => {
  const w = makeEv('pretool', { tool: 'Write', input: { file_path: 'x' } });
  const r = makeEv('pretool', { tool: 'Read', input: { file_path: 'x' } });
  assert.match((await runOne(throwing(check), 'pretool', w, makeCtx())).deny, /stopped this step to be safe/);
  assert.equal((await runOne(throwing(check), 'pretool', r, makeCtx())).deny, '');
  const d = { ...check, kind: 'discipline' };
  const out = await runOne(throwing(d), 'pretool', w, makeCtx());
  assert.equal(out.deny, '');
  assert.match(out.error, /made-up failure/);
});

test('timeStep and validate', async () => {
  const ms = await timeStep(check, 'pretool', makeEv('pretool', { tool: 'Write', input: { file_path: 'x' } }), makeCtx());
  assert.ok(ms < 50, `${ms} ms`);
  assert.deepEqual(validate(check, 'no-forbidden'), []);
  assert.ok(validate({ ...check, kind: 'loud' }).length);
});

test('makeCtx serves notes, words and loaded skills as the real ctx does', () => {
  const c = makeCtx({ notes: { 'system/decisions.md': 'D1' }, hisLast: 'Go ahead and Publish it', loaded: ['Engineering:Code-Review'] });
  assert.equal(c.read('system/decisions.md'), 'D1');
  assert.equal(c.read('missing.md'), '');
  assert.equal(c.said('publish'), true);
  assert.equal(c.said('publisher'), false, 'whole words only');
  assert.equal(c.said(/go ahead/i), true);
  assert.equal(c.hasLoaded('code-review'), true);
  c.log('seen', { a: 1 });
  assert.deepEqual(c.logged, [{ event: 'seen', detail: { a: 1 } }]);
});

test('what counts as reading in a shell command', () => {
  const S = libSettings();
  for (const c of ['ls -la', 'git status', 'git log --oneline | head -3', 'Get-ChildItem -Recurse | Select-String foo', 'cat a.txt && wc -l a.txt', 'grep -n "a > b" f.txt'])
    assert.equal(isReadingCommand(c, S), true, c);
  for (const c of ['rm -rf x', 'ls > out.txt', 'echo $(rm x)', 'cat `rm x`', 'git push', 'git checkout -- f', 'sed -i s/a/b/ f', 'find . -delete', 'node -e "1"', 'npm test', 'ls; vercel --prod', '"unclosed', 'sort -o f g', ''])
    assert.equal(isReadingCommand(c, S), false, c);
});

test('list and doctor: the broken ones are named and the doctor exits 1', () => {
  const dir = makeChecksDir(['deny-write', 'malformed', 'say-hello']); dirs.push(dir);
  const ls = spawnSync(process.execPath, [CLI, 'list', '--json', '--dir', dir], { encoding: 'utf8' });
  assert.equal(ls.status, 0);
  const rows = JSON.parse(ls.stdout);
  assert.deepEqual(rows.map((r) => [r.id, r.status]), [['deny-write', 'ok'], ['say-hello', 'ok'], ['malformed', 'broken']]);
  const dr = spawnSync(process.execPath, [CLI, 'doctor', '--dir', dir], { encoding: 'utf8' });
  assert.equal(dr.status, 1);
  assert.match(dr.stdout, /^BROKEN: 3 check\(s\)/);
  assert.match(dr.stdout, /BROKEN malformed: BROKEN \(safety\)/);
  assert.match(dr.stdout, /NOTE deny-write: no check\.test\.mjs/);
  fs.rmSync(path.join(dir, 'malformed'), { recursive: true });
  const ok = spawnSync(process.execPath, [CLI, 'doctor', '--dir', dir], { encoding: 'utf8' });
  assert.equal(ok.status, 0);
  assert.match(ok.stdout, /^OK: 2 check\(s\)/);
});

test('doctor names each check in plain words, the sound ones too', () => {
  const dir = makeChecksDir(['deny-write', 'malformed', 'say-hello']); dirs.push(dir);
  const dr = spawnSync(process.execPath, [CLI, 'doctor', '--dir', dir], { encoding: 'utf8' });
  assert.match(dr.stdout, /^deny-write: sound\. A safety check, set to refuse; it runs before a tool\. Missing: its tests, its README\.$/m);
  assert.match(dr.stdout, /^say-hello: sound\. A discipline check, set to refuse; it runs at each message\. Missing: its tests, its README\.$/m);
  assert.match(dr.stdout, /^malformed: BROKEN, so it is treated as a safety check: every step but reading is refused\./m);
  const ls = spawnSync(process.execPath, [CLI, 'list', '--dir', dir], { encoding: 'utf8' });
  assert.match(ls.stdout, /^deny-write holds test rule\. A safety check, set to refuse; it runs before a tool\. Refuses writes to forbidden\.txt\.$/m);
  assert.match(ls.stdout, /^malformed is BROKEN \(treated as a safety check\): /m);
});
