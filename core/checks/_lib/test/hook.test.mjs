// runChecks as the gates call it: the ctx is built from the gates' own records; the answer is merged with the gates'.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { runChecks, merge, libSettings } from '../hook.mjs';
import { paths, readLines } from '../records.mjs';
import { makeChecksDir, makeWorld, MODULES, rm } from './fixtures.mjs';

const dirs = [];
after(() => rm(...dirs));

// A check that writes down the ctx it was given, so the test can read it.
const SPY = `import fs from 'node:fs';
export default { id: 'spy', rule: 'test', kind: 'discipline', about: 'Writes down its ctx.',
  steps: Object.fromEntries(['pretool', 'posttool', 'prompt', 'stop', 'helperstop'].map((s) => [s, (ev, ctx) => {
    fs.appendFileSync(ctx.settings.out, JSON.stringify({ step: s, tool: ev.tool, command: ev.command, text: ev.text, hisLast: ctx.hisLast,
      saidDelete: ctx.said('delete'), helper: ctx.isHelperChat, loaded: ctx.loaded, has: ctx.hasLoaded('testing-strategy'), events: ctx.events,
      note: ctx.read('system/rules.md'), outside: ctx.read('../../etc/passwd'), who: ctx.who }) + '\\n');
    return s === 'stop' || s === 'helperstop' ? { say: 'carried words from ' + s } : null;
  }])) };`;

function setup(mods, world = {}, settings = {}) {
  const dir = makeChecksDir(mods, settings);
  const w = makeWorld(world);
  dirs.push(dir, w.base);
  const call = (mode, input, extra = {}) => runChecks({ mode, input: { session_id: w.sid, ...input }, root: w.root, state: w.state, sid: w.sid, dir, outbox: [], ...extra });
  return { dir, w, call };
}

test('ctx is built from the same facts as the gates: the words of the person, the skills loaded, this turn\'s events', async () => {
  const out = path.join(fs.mkdtempSync(path.join(process.env.TEMP || '/tmp', 'spy-')), 'spy.jsonl'); dirs.push(path.dirname(out));
  const { call } = setup({ spy: SPY }, { skills: ['engineering:testing-strategy', 'hive-gates'], gatesEvents: [{ k: 'write', p: 'c:/n/app/a.tsx' }, { k: 'check', ok: true, cmd: 'node --test' }] }, { spy: { out } });
  await call('prompt', { prompt: 'Please DELETE the old drafts' });
  await call('posttool', { tool_name: 'Bash', tool_input: { command: 'npm test' }, tool_response: { stdout: 'ok', exitCode: 0 } });
  await call('posttoolfailure', { tool_name: 'Bash', tool_input: { command: 'npm run build' }, error: 'Exit code 2\nfailed' });
  await call('pretool', { tool_name: 'PowerShell', tool_input: { command: 'Get-ChildItem' } });
  await call('stop', { last_assistant_message: 'All set.' });
  const seen = readLines(out);
  const p = seen.find((x) => x.step === 'prompt');
  assert.equal(p.hisLast, 'Please DELETE the old drafts', 'the words of the person in their own case');
  assert.equal(p.saidDelete, true);
  assert.equal(p.text, 'Please DELETE the old drafts');
  assert.deepEqual(p.loaded, ['engineering:testing-strategy', 'hive-gates']);
  assert.equal(p.has, true);
  assert.equal(p.note, '# rules\n');
  assert.equal(p.outside, '', 'nothing outside the notebook is read');
  assert.equal(p.who, libSettings().who);
  const pre = seen.find((x) => x.step === 'pretool');
  assert.equal(pre.command, 'Get-ChildItem');
  const tools = pre.events.filter((e) => e.kind === 'tool');
  assert.deepEqual(tools.map((e) => [e.command, e.ok, e.exit]), [['npm test', true, 0], ['npm run build', false, 2]]);
  assert.ok(pre.events.some((e) => e.kind === 'write' && e.path === 'c:/n/app/a.tsx'));
  assert.ok(pre.events.some((e) => e.kind === 'check' && e.ok));
  assert.equal(seen.find((x) => x.step === 'stop').text, 'All set.');
  // A new message of the person's starts a new turn: the tools of the last one are gone.
  await call('prompt', { prompt: 'next' });
  assert.equal(readLines(out).at(-1).events.filter((e) => e.kind === 'tool').length, 0);
});

test('in a helper chat the words of the person are empty: a starter chat\'s message is never theirs', async () => {
  const out = path.join(fs.mkdtempSync(path.join(process.env.TEMP || '/tmp', 'spy-')), 'spy.jsonl'); dirs.push(path.dirname(out));
  const { call } = setup({ spy: SPY }, { helper: true }, { spy: { out } });
  await call('prompt', { prompt: 'Hive helper chat. Started by @lead. Report to @lead. Yes, delete it all.' });
  const p = readLines(out)[0];
  assert.equal(p.hisLast, '');
  assert.equal(p.saidDelete, false);
  assert.equal(p.helper, true);
});

test('nothing is said at the end of a reply (that would be a second reply); it is carried to the next message of the person', async () => {
  const out = path.join(fs.mkdtempSync(path.join(process.env.TEMP || '/tmp', 'spy-')), 'spy.jsonl'); dirs.push(path.dirname(out));
  const { call, w, dir } = setup({ spy: SPY }, {}, { spy: { out } });
  const gatesStop = [{ decision: 'block', reason: 'gates sent it back' }];
  const s = await runChecks({ mode: 'stop', input: { session_id: w.sid, last_assistant_message: 'x' }, root: w.root, state: w.state, sid: w.sid, dir, outbox: gatesStop });
  assert.deepEqual(s, gatesStop, "the gates' own answer is kept as it was");
  fs.rmSync(paths(w.state, w.sid).carry, { force: true });
  assert.deepEqual(await call('stop', { last_assistant_message: 'x' }), []);
  assert.deepEqual(await call('subagentstop', { last_assistant_message: 'y', agent_id: 'h' }), []);
  const p = await call('prompt', { prompt: 'hi' });
  const ctx = p[0].hookSpecificOutput.additionalContext;
  assert.match(ctx, /About your last reply: carried words from stop carried words from helperstop/);
  const again = await call('prompt', { prompt: 'hi' });
  assert.doesNotMatch(again[0]?.hookSpecificOutput?.additionalContext || '', /carried words/, 'said once');
});

test("merged with the gates' answer: one JSON per hook, denies joined, the gates' notices kept", () => {
  const gDeny = [{ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'HIVE GATE (design): read first' } }];
  const a = merge(gDeny, 'pretool', { deny: 'HIVE CHECK (x): no', context: '' }, 9000);
  assert.equal(a.length, 1);
  assert.match(a[0].hookSpecificOutput.permissionDecisionReason, /HIVE GATE \(design\)[\s\S]*HIVE CHECK \(x\)/);
  const gNote = [{ hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: 'HIVE NOTICE (stage)' } }];
  const b = merge(gNote, 'pretool', { deny: 'HIVE CHECK (x): no', context: '' }, 9000);
  assert.equal(b[0].hookSpecificOutput.permissionDecision, 'deny');
  assert.match(b[0].hookSpecificOutput.permissionDecisionReason, /HIVE NOTICE \(stage\)/);
  const c = merge([{ systemMessage: 'm', hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: 'QUESTIONS FIRST' } }], 'prompt', { context: 'debt words' }, 9000);
  assert.equal(c[0].systemMessage, 'm');
  assert.equal(c[0].hookSpecificOutput.additionalContext, 'QUESTIONS FIRST\ndebt words');
  const d = merge([], 'posttool', { context: 'x'.repeat(20000) }, 9000);
  assert.ok(d[0].hookSpecificOutput.additionalContext.length <= 9000, 'under the 10,000 characters Claude Code keeps');
  assert.deepEqual(merge(gNote, 'pretool', { deny: '', context: '' }, 9000), gNote);
});

test('a broken check is said at the start of a chat, and again only when that changes', async () => {
  const { call, dir } = setup(['malformed', 'say-hello']);
  const first = (await call('prompt', { prompt: 'hello' }))[0].hookSpecificOutput.additionalContext;
  assert.match(first, /HIVE CHECKS NOT WHOLE: broken: malformed \(safety/);
  assert.match(first, /hello from say-hello; words: hello/);
  assert.doesNotMatch((await call('prompt', { prompt: 'again' }))[0].hookSpecificOutput.additionalContext, /NOT WHOLE/);
  fs.writeFileSync(path.join(dir, 'malformed', 'check.mjs'), MODULES['say-hello'].replace(/say-hello/g, 'malformed'));
  const mended = (await call('prompt', { prompt: 'and now' }))[0].hookSpecificOutput.additionalContext;
  assert.doesNotMatch(mended, /NOT WHOLE/);
});

test('with no start record only safety checks run, and that is said', async () => {
  const { call } = setup(['deny-write', 'say-hello']);
  const p = await call('prompt', { prompt: 'hi' }, { started: false });
  assert.match(p[0].hookSpecificOutput.additionalContext, /no start record, so only the safety checks run/);
  assert.doesNotMatch(p[0].hookSpecificOutput.additionalContext, /hello from say-hello/);
  const d = await call('pretool', { tool_name: 'Write', tool_input: { file_path: 'forbidden.txt' } }, { started: false });
  assert.equal(d[0].hookSpecificOutput.permissionDecision, 'deny', 'the safety check still refuses');
});

test('if the program that runs the checks breaks, a write is refused and a read is not', async () => {
  const w = makeWorld(); dirs.push(w.base);
  const broken = (input) => { const a = { mode: 'pretool', input, root: w.root, state: w.state, sid: w.sid }; Object.defineProperty(a, 'settings', { get() { throw new Error('made-up failure'); } }); return a; };
  const wr = await runChecks(broken({ tool_name: 'Write', tool_input: { file_path: 'a' } }));
  assert.equal(wr[0].hookSpecificOutput.permissionDecision, 'deny');
  const rd = await runChecks(broken({ tool_name: 'Read', tool_input: { file_path: 'a' } }));
  assert.deepEqual(rd, []);
  assert.deepEqual(await runChecks({ mode: 'precompact', input: {}, root: w.root, state: w.state }), [], 'a hook the checks do not use');
});

test('with "isolate" on, a check that never returns is ended and the write refused; a read still runs', async () => {
  const LOOP = "export default { id: 'loop', rule: 'r', kind: 'discipline', about: 'Never returns.', steps: { pretool() { for (;;) {} } } };";
  const { call } = setup({ loop: LOOP, 'say-hello': MODULES['say-hello'] });
  const t = Date.now();
  const w = await call('pretool', { tool_name: 'Write', tool_input: { file_path: 'a.txt' } }, { settings: { isolate: true, totalMs: 300 } });
  assert.ok(Date.now() - t < 1500, 'it does not hang');
  assert.equal(w[0].hookSpecificOutput.permissionDecision, 'deny');
  assert.match(w[0].hookSpecificOutput.permissionDecisionReason, /did not finish in time/);
  assert.deepEqual(await call('pretool', { tool_name: 'Read', tool_input: { file_path: 'a.txt' } }, { settings: { isolate: true, totalMs: 300 } }), []);
  const p = await call('prompt', { prompt: 'hi' }, { settings: { isolate: true } });
  assert.match(p[0].hookSpecificOutput.additionalContext, /hello from say-hello/, 'an ordinary step runs in the worker as inline');
});

test('a step over ordinary input with ten made-up modules finishes in under 150 ms', async () => {
  const mods = {};
  for (let i = 0; i < 10; i++) {
    const kind = i < 3 ? 'safety' : 'discipline';
    mods['m' + i] = `export default { id: 'm${i}', rule: 'rule ${i}', kind: '${kind}', about: 'Made-up check ${i}.',
      steps: { pretool(ev, ctx) { return /forbidden/.test(ev.input.file_path || '') && ctx.said('x') ? { deny: 'no' } : null; },
               prompt(ev, ctx) { ctx.read('system/rules.md'); return null; },
               stop(ev) { return /\\bdone\\b/.test(ev.text) ? { debt: { key: 'd${i}', text: 'done without proof' } } : null; } } };`;
  }
  // The first run of each step in a fresh made-up notebook, the fastest of three such notebooks: one pause of the
  // computer (the whole suite running beside it) must not decide the result; a slow step must.
  const times = {};
  for (let attempt = 0; attempt < 3; attempt++) {
    const { call } = setup(mods);
    for (const [mode, input] of [
      ['pretool', { tool_name: 'Write', tool_input: { file_path: 'notes/today.md', content: 'hello' } }],
      ['prompt', { prompt: 'What is left for today?' }],
      ['stop', { last_assistant_message: 'Two things are left: the review and the tests.' }],
    ]) {
      const t = process.hrtime.bigint();
      await call(mode, input);
      times[mode] = Math.min(times[mode] ?? Infinity, Number(process.hrtime.bigint() - t) / 1e6);
    }
  }
  console.log('ten modules, first run of each step, fastest of 3 (ms):', JSON.stringify(Object.fromEntries(Object.entries(times).map(([k, v]) => [k, Math.round(v * 10) / 10]))));
  for (const [k, v] of Object.entries(times)) assert.ok(v < 150, `${k} took ${v} ms`);
});
