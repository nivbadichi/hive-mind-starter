// The debt rule, end to end through runChecks, from a real case: system/lessons.md, 2026-11-19, "You're using too many
// insider words ... The same fault as the day before", closed only by a written rule; the gates of that day only noted
// it ("a fault in a reply is only noted", system/design/roast-2026-11-19.md). Here the same fault in two replies running
// refuses every tool but reading, until a reply without it.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { runChecks } from '../hook.mjs';
import * as Debts from '../debts.mjs';
import { paths } from '../records.mjs';
import { makeChecksDir, makeWorld, rm } from './fixtures.mjs';

const dirs = [];
after(() => rm(...dirs));

const INSIDE = `export default { id: 'inside-words', rule: 'rule 6', kind: 'discipline', about: 'An inside word in a reply is a debt.',
  steps: { stop(ev) { return /\\bstarter\\b/i.test(ev.text) ? { debt: { key: 'starter', text: 'the word "starter" was used without its meaning.' } } : null; } } };`;
const SAVE = `export default { id: 'save-rule', rule: 'rule 7', kind: 'discipline', about: 'A stated rule must be saved.',
  steps: {
    stop(ev, ctx) { return ctx.said('from now on') && !ctx.events.some((e) => e.kind === 'tool' && /decisions\\.md$/.test(e.path || '')) ? { debt: { key: 'unsaved', text: 'a stated rule is not saved.', auto: false, allow: { paths: ['system/decisions.md'] } } } : null; },
    posttool(ev) { return ev.tool === 'Write' && /decisions\\.md$/.test(ev.input.file_path || '') ? { clear: ['unsaved'] } : null; },
  } };`;

function setup(mods, opts = {}) {
  const dir = makeChecksDir(mods, opts.settings || {});
  const w = makeWorld(opts);
  dirs.push(dir, w.base);
  const call = (mode, input, extra = {}) => runChecks({ mode, input: { session_id: w.sid, ...input }, root: w.root, state: w.state, sid: w.sid, dir, outbox: [], ...extra });
  return { dir, w, call, store: () => Debts.load(paths(w.state, w.sid).debts) };
}
const deniedOf = (out) => (out.find((o) => o.hookSpecificOutput) || {}).hookSpecificOutput?.permissionDecision === 'deny';
const contextOf = (out) => (out.find((o) => o.hookSpecificOutput) || {}).hookSpecificOutput?.additionalContext || '';
const WRITE = { tool_name: 'Write', tool_input: { file_path: 'app/page.tsx', content: 'x' } };

test('the same fault in two replies running refuses every tool but reading, until a reply clears it', async () => {
  const { call, store } = setup({ 'inside-words': INSIDE });
  // Before: one faulty reply is a debt, said at the person's next message; nothing is refused yet.
  await call('stop', { last_assistant_message: 'The starter is ready.' });
  assert.equal(store().items[0].status, 'open');
  const p1 = await call('prompt', { prompt: 'what is the starter?' });
  assert.match(contextOf(p1), /HIVE DEBT \(from your last reply.*"starter" was used without its meaning/);
  assert.equal(deniedOf(await call('pretool', WRITE)), false);
  // The next reply carries it again: overdue.
  await call('stop', { last_assistant_message: 'The starter copy is the empty one.' });
  assert.equal(store().items[0].status, 'overdue');
  const w = await call('pretool', WRITE);
  assert.equal(deniedOf(w), true);
  assert.match(w[0].hookSpecificOutput.permissionDecisionReason, /HIVE DEBT \(overdue\)/);
  assert.equal(deniedOf(await call('pretool', { tool_name: 'Read', tool_input: { file_path: 'x.md' } })), false, 'reading runs');
  assert.equal(deniedOf(await call('pretool', { tool_name: 'Bash', tool_input: { command: 'git log --oneline | head -5' } })), false, 'a reading command runs');
  assert.equal(deniedOf(await call('pretool', { tool_name: 'Bash', tool_input: { command: 'echo hi > notes.md' } })), true, 'a write by > is refused');
  assert.equal(deniedOf(await call('pretool', { tool_name: 'WebFetch', tool_input: { url: 'https://example.com' } })), true);
  assert.equal(deniedOf(await call('pretool', { ...WRITE, agent_id: 'helper-1' })), false, "a helper's tools are not held by the lead's reply");
  assert.match(contextOf(await call('prompt', { prompt: 'go on' })), /HIVE DEBT, OVERDUE/);
  // A reply without the fault clears it.
  await call('stop', { last_assistant_message: 'The empty copy (the version of Hive Mind for a new person) is ready.' });
  assert.equal(store().items.length, 0);
  assert.equal(deniedOf(await call('pretool', WRITE)), false);
});

test('every debt, refusal and clearing is written to the one log', async () => {
  const { call, w } = setup({ 'inside-words': INSIDE });
  await call('stop', { last_assistant_message: 'starter' });
  await call('stop', { last_assistant_message: 'starter' });
  await call('pretool', WRITE);
  await call('stop', { last_assistant_message: 'the empty copy' });
  const events = fs.readFileSync(path.join(w.state, 'gates.log'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l).event);
  for (const e of ['debt-opened', 'debt-overdue', 'debt-refuse', 'debt-cleared']) assert.ok(events.includes(e), e);
});

test('a debt that needs an act (auto: false) stays until a step clears it; its way out stays open while overdue', async () => {
  const { call, store, w } = setup({ 'save-rule': SAVE });
  await call('prompt', { prompt: 'From now on, ask me before any purchase.' });
  await call('stop', { last_assistant_message: 'Understood.' });
  await call('prompt', { prompt: 'and?' });
  await call('stop', { last_assistant_message: 'Noted.' }); // not raised again (the last words changed) but nothing cleared it
  assert.equal(store().items[0].status, 'overdue');
  assert.equal(deniedOf(await call('pretool', WRITE)), true);
  const out = await call('pretool', { tool_name: 'Write', tool_input: { file_path: path.join(w.root, 'system', 'decisions.md'), content: 'x' } });
  assert.equal(deniedOf(out), false, 'the write that pays the debt is allowed');
  await call('posttool', { tool_name: 'Write', tool_input: { file_path: path.join(w.root, 'system', 'decisions.md') }, tool_response: {} });
  assert.equal(store().items.length, 0, 'cleared by its own check');
});

test('a notice-mode check: its debt is said at every message but never refuses', async () => {
  const { call, store } = setup({ 'inside-words': INSIDE }, { settings: { 'inside-words': { mode: 'notice' } } });
  await call('stop', { last_assistant_message: 'starter' });
  await call('stop', { last_assistant_message: 'starter again' });
  assert.equal(store().items[0].status, 'open');
  assert.equal(deniedOf(await call('pretool', WRITE)), false);
  assert.match(contextOf(await call('prompt', { prompt: 'x' })), /HIVE DEBT/);
});

test('a check clears only its own debts; debts of a check that is gone are dropped', async () => {
  const OTHER = `export default { id: 'other', rule: 'r', kind: 'discipline', about: 'a', steps: { posttool() { return { clear: ['starter'] }; } } };`;
  const { call, store, dir } = setup({ 'inside-words': INSIDE, other: OTHER });
  await call('stop', { last_assistant_message: 'starter' });
  await call('posttool', { tool_name: 'Read', tool_input: { file_path: 'a' }, tool_response: {} });
  assert.equal(store().items.length, 1, 'another check cannot clear it');
  fs.rmSync(path.join(dir, 'inside-words'), { recursive: true });
  await call('stop', { last_assistant_message: 'starter' });
  assert.equal(store().items.length, 0);
});

test('a reply sent back once by the gates (stop_hook_active) is not counted twice', async () => {
  const { call, store } = setup({ 'inside-words': INSIDE });
  await call('stop', { last_assistant_message: 'starter' });
  await call('stop', { last_assistant_message: 'starter', stop_hook_active: true });
  assert.equal(store().items[0].status, 'open');
  assert.equal(store().replies, 1);
});

test('the store survives a stuck lock and a damaged file', () => {
  const base = fs.mkdtempSync(path.join(process.env.TEMP || '/tmp', 'hive-debts-')); dirs.push(base);
  const f = path.join(base, 'd', 'x.json');
  fs.mkdirSync(f + '.lock', { recursive: true });
  const t = Date.now();
  Debts.update(f, (s) => { s.items.push({ check: 'a', key: 'k' }); });
  assert.ok(Date.now() - t < 1000);
  assert.equal(Debts.load(f).items.length, 1);
  fs.writeFileSync(f, '{ damaged');
  assert.deepEqual(Debts.load(f), { replies: 0, items: [] });
});
