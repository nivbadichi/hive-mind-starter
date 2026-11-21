// Tests for the report-shape check: node --test core/checks/report-shape/check.test.mjs
// Made-up helper reports only; nothing reads the real notebook or the real home.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import check from './check.mjs';
import { makeEv, makeCtx, runOne, throwing, timeStep, validate } from '../_lib/harness.mjs';

const SETTINGS = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'settings.json'), 'utf8'));
const ctx = (o = {}) => makeCtx({ settings: SETTINGS, ...o });
const stop = (text, fields = {}) => makeEv('helperstop', { text, report: true, agent_id: 'a-123', agent_type: 'general-purpose', ...fields });

// The shape of a whole report, as the build brief asks for it.
const FULL = `Made core/x/x.mjs and its test core/x/x.test.mjs.
Ran \`node --test core/x/x.test.mjs\`: pass 4, fail 0.
Skills loaded: engineering:testing-strategy.
Questions for the person
none
Model: Opus 5.5.`;
// A report that says done, with nothing to check it by.
const BARE = 'All done, everything works now. Questions for the person: none. Opus.';

test('shape', () => assert.deepEqual(validate(check, 'report-shape'), []));

test('known-bad: a report with no command run and no file is said to the lead, each part named', async () => {
  const r = await runOne(check, 'helperstop', stop(BARE), ctx());
  assert.match(r.say, /^HIVE CHECK \(report-shape\): the report of the general-purpose helper \(a-123\)/);
  assert.match(r.say, /names no command that was run/);
  assert.match(r.say, /names no file it made or changed/);
  assert.doesNotMatch(r.say, /which model/);
  assert.match(r.say, /Send it back to that helper/);
});

test('known-bad: an empty questions part and no model are named', async () => {
  const r = await runOne(check, 'helperstop', stop('Made core/a/b.mjs. Ran `node --test core/a/b.test.mjs`.\nQuestions for the person:\n'), ctx());
  assert.match(r.say, /has no "Questions for the person" part/);
  assert.match(r.say, /does not say which model/);
});

test('known-good: a whole report passes in silence', async () => {
  const r = await runOne(check, 'helperstop', stop(FULL), ctx());
  assert.equal(r.say, ''); assert.equal(r.error, '');
});

test('known-good: a read-only search helper is not held to the report shape', async () => {
  const r = await runOne(check, 'helperstop', stop(BARE, { agent_type: 'Explore' }), ctx());
  assert.equal(r.say, '');
});

test('when only the last words were seen, it says so', async () => {
  const r = await runOne(check, 'helperstop', stop(BARE, { report: false }), ctx());
  assert.match(r.say, /last words \(its delivered report was not seen/);
});

test('an empty report says nothing and logs', async () => {
  const c = ctx();
  const r = await runOne(check, 'helperstop', stop(''), c);
  assert.equal(r.say, '');
  assert.equal(c.logged[0].event, 'report-empty');
});

test('on its own error it lets the work through (discipline)', async () => {
  const r = await runOne(throwing(check), 'helperstop', stop(BARE), ctx());
  assert.equal(r.say, ''); assert.equal(r.deny, ''); assert.match(r.error, /made-up failure/);
});

test('fast', async () => assert.ok(await timeStep(check, 'helperstop', stop(FULL + '\n' + 'More words. '.repeat(400)), ctx()) < 50));
