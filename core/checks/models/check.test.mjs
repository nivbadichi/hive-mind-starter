// node --test starter/core/checks/models/check.test.mjs
// Every behaviour: a known-bad case that must be caught and a known-good case that must pass.
// The cases are the usual ways rule 12 slips: a report that never says which model did the work, a helper started
// with no model named, a helper on a weaker model than the person set, and a policy changed without the person's words.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import check, { family, meets } from './check.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FILE = JSON.parse(fs.readFileSync(path.join(HERE, 'settings.json'), 'utf8'));
// The tests hold one fixed policy (Opus at the least), so they prove the same behaviour whatever the copy's own policy says.
const POLICY = { minimum: 'opus', since: '2026-11-20', words: 'a test policy: Opus at the least' };
const SETTINGS = { ...FILE, policy: POLICY };
const { pretool, posttool, stop, helperstop } = check.steps;

function makeCtx(over = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'models-check-'));
  const logs = [];
  return { root: tmp, state: path.join(tmp, 'hive'), sid: 's1', who: 'the person', hisLast: '', isHelperChat: false, loaded: [], events: [],
    settings: JSON.parse(JSON.stringify(SETTINGS)), log: (e, d) => logs.push([e, d]), logs, ...over };
}
const launch = (input) => ({ tool: 'Agent', tool_name: 'Agent', session_id: 's1', input, tool_input: input });
const PROMPT = 'Do the work. Skills: none, because a test.';

test('the module has the contract shape', () => {
  assert.equal(check.id, 'models');
  assert.equal(check.rule, 'rule 12');
  assert.equal(check.kind, 'safety');
  assert.equal(check.mode, 'refuse');
  assert.ok(check.about.length > 20);
  for (const k of Object.keys(check.steps)) assert.ok(['pretool', 'posttool', 'prompt', 'stop', 'helperstop'].includes(k));
  assert.equal(path.basename(HERE), check.id);
});

test("the starter's default policy is rule 12's own words: any named model, and the model always said", () => {
  assert.equal(FILE.policy.minimum, 'any');
  assert.equal(FILE.who, 'the person');
  assert.match(FILE.policy.words, /strongest model plans and reviews/);
  assert.equal(FILE.policy.since, '');
});

test('model names fold to their family, and the floor is a rank', () => {
  assert.equal(family('claude-opus-5-5', SETTINGS), 'opus');
  assert.equal(family('Opus 5.5', SETTINGS), 'opus');
  assert.equal(family('us.anthropic.claude-sonnet-4', SETTINGS), 'sonnet');
  assert.equal(family('gpt-5', SETTINGS), '');
  assert.equal(meets('sonnet', SETTINGS), false);
  assert.equal(meets('opus', SETTINGS), true);
  assert.equal(meets('fable', SETTINGS), true);
  assert.equal(meets('', SETTINGS), false);
});

test('a helper with no model is refused; one with the model setting starts', () => {
  assert.match(pretool(launch({ description: 'build', prompt: PROMPT }), makeCtx()).deny, /does not say which model/);
  assert.equal(pretool(launch({ description: 'build', prompt: PROMPT, model: 'opus' }), makeCtx()), null);
});

test('a helper below the policy is refused; one at or above it starts', () => {
  for (const m of ['sonnet', 'haiku', 'claude-sonnet-4-5']) {
    const bad = pretool(launch({ description: 'build', prompt: PROMPT, model: m }), makeCtx());
    assert.match(bad.deny, /below the policy/, m);
    assert.match(bad.deny, /a test policy/);
  }
  assert.equal(pretool(launch({ description: 'build', prompt: PROMPT, model: 'claude-opus-5-5' }), makeCtx()), null);
  assert.equal(pretool(launch({ description: 'plan', prompt: PROMPT, model: 'fable' }), makeCtx()), null);
});

test('a read-only search helper starts on any model or none; the floor can be set to hold it too', () => {
  assert.equal(pretool(launch({ description: 'find files', prompt: PROMPT, subagent_type: 'Explore' }), makeCtx()), null);
  assert.equal(pretool(launch({ description: 'find files', prompt: PROMPT, subagent_type: 'Explore', model: 'haiku' }), makeCtx()), null);
  const hold = makeCtx(); hold.settings.readOnlyFloor = 'hold';
  assert.ok(pretool(launch({ description: 'find files', prompt: PROMPT, subagent_type: 'Explore', model: 'haiku' }), hold).deny);
});

test('the line "Mode: read-only" alone does not make a helper read-only (a line is a claim)', () => {
  const ev = launch({ description: 'x', prompt: `Mode: read-only\n${PROMPT}`, model: 'haiku' });
  assert.ok(pretool(ev, makeCtx()).deny);
  const counts = makeCtx(); counts.settings.readOnlyMarkerCounts = true;
  assert.equal(pretool(ev, counts), null);
});

test('a "Model:" line alone is refused while requireSetting is on', () => {
  const ev = launch({ description: 'x', prompt: `${PROMPT}\nModel: Opus (the policy)` });
  assert.match(pretool(ev, makeCtx()).deny, /a line is a claim/i);
  const ctx = makeCtx(); ctx.settings.requireSetting = false;
  assert.equal(pretool(ev, ctx), null);
  const ctx2 = makeCtx(); ctx2.settings.requireSetting = false;
  assert.match(pretool(launch({ description: 'x', prompt: 'Model: Haiku' }), ctx2).deny, /below the policy/);
});

test('a setting and a prompt line that disagree are refused; agreeing ones start', () => {
  assert.match(pretool(launch({ description: 'x', prompt: 'Model: Fable', model: 'opus' }), makeCtx()).deny, /make the two agree/);
  assert.equal(pretool(launch({ description: 'x', prompt: 'Model: Opus', model: 'opus' }), makeCtx()), null);
});

test('a model name this check does not know is refused', () => {
  assert.match(pretool(launch({ description: 'x', prompt: PROMPT, model: 'mystery-1' }), makeCtx()).deny, /not a model this check knows/);
});

test("a fork runs on the lead's model: refused when it is unknown or below, let through when it meets the policy", () => {
  const fork = launch({ description: 'x', prompt: PROMPT, subagent_type: 'fork' });
  assert.match(pretool(fork, makeCtx()).deny, /cannot see which model the lead runs on/);
  assert.match(pretool(fork, makeCtx({ leadModel: 'claude-sonnet-5' })).deny, /below the policy/);
  assert.equal(pretool(fork, makeCtx({ leadModel: 'claude-opus-5-5' })), null);
  assert.ok(pretool(launch({ description: 'x', prompt: PROMPT, model: 'inherit' }), makeCtx()).deny, '"inherit" is the lead model too');
});

test("the lead's model is read from the tail of the chat's own record when no step gives it", () => {
  const ctx = makeCtx();
  const t = path.join(ctx.root, 'chat.jsonl');
  fs.writeFileSync(t, '{"type":"assistant","message":{"model":"claude-sonnet-4-5"}}\n{"type":"assistant","message":{"model":"claude-opus-5-5"}}\n');
  assert.equal(pretool({ ...launch({ description: 'x', prompt: PROMPT, subagent_type: 'fork' }), transcript_path: t }, ctx), null);
  fs.writeFileSync(t, '{"type":"assistant","message":{"model":"claude-haiku-4-5"}}\n');
  assert.ok(pretool({ ...launch({ description: 'x', prompt: PROMPT, subagent_type: 'fork' }), transcript_path: t }, ctx).deny);
});

test('other tools are never touched by the launch check', () => {
  assert.equal(pretool({ tool: 'Read', input: { file_path: 'x.md' } }, makeCtx()), null);
  assert.equal(pretool({ tool: 'Bash', input: { command: 'ls' }, command: 'ls' }, makeCtx()), null);
});

// ---------- a helper's report handed back ----------
test('a helper report handed back with no model is refused; one naming the model goes', () => {
  const ev = (message) => ({ tool: 'SubagentHandback', input: { message } });
  assert.match(pretool(ev('Built the module; the tests pass.'), makeCtx({ isHelperChat: true })).deny, /does not say which model/);
  assert.equal(pretool(ev('Built the module; the tests pass. Opus did the work.'), makeCtx({ isHelperChat: true })), null);
});

// ---------- a change of the settings that did not come from the person's own message ----------
function policyFile(ctx) {
  const dir = path.join(ctx.root, 'core', 'checks', 'models');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'settings.json');
  fs.writeFileSync(file, JSON.stringify(SETTINGS, null, 2));
  return file;
}
const lowerTo = (file, m) => ({ tool: 'Edit', input: { file_path: file, old_string: '"minimum": "opus"', new_string: `"minimum": "${m}"` } });

test("lowering the minimum with no word of the person's is refused; with the person's words naming the model it goes ahead", () => {
  const ctx = makeCtx({ hisLast: 'go on, finish it' });
  assert.match(pretool(lowerTo(policyFile(ctx), 'sonnet'), ctx).deny, /does not speak of models/);
  const ok = makeCtx({ hisLast: 'Helpers may run on Sonnet from now on.' });
  assert.equal(pretool(lowerTo(policyFile(ok), 'sonnet'), ok), null);
});

test('a minimum the person did not name is refused', () => {
  const ctx = makeCtx({ hisLast: 'keep the models on Opus' });
  assert.match(pretool(lowerTo(policyFile(ctx), 'haiku'), ctx).deny, /sets the minimum to haiku/);
});

test("switching a rule off in the settings (requireSetting) without the person's words is refused", () => {
  const ctx = makeCtx({ hisLast: 'ok' });
  const file = policyFile(ctx);
  const ev = { tool: 'Edit', input: { file_path: file, old_string: '"requireSetting": true', new_string: '"requireSetting": false' } };
  assert.ok(pretool(ev, ctx).deny);
  const ok = makeCtx({ hisLast: 'a Model line in the prompt is enough for the models check' });
  assert.equal(pretool({ ...ev, input: { ...ev.input, file_path: policyFile(ok) } }, ok), null);
});

test('a settings change from a helper chat is refused even with model words in it', () => {
  const ctx = makeCtx({ hisLast: 'use Sonnet', isHelperChat: true });
  assert.match(pretool(lowerTo(policyFile(ctx), 'sonnet'), ctx).deny, /helper chat/);
});

test('a change of a free word list goes ahead; a write that leaves the file unreadable is refused', () => {
  const ctx = makeCtx({ hisLast: 'go on' });
  const file = policyFile(ctx);
  assert.equal(pretool({ tool: 'Edit', input: { file_path: file, old_string: '"scout"', new_string: '"scout",\n    "auditor"' } }, ctx), null);
  assert.match(pretool({ tool: 'Write', input: { file_path: file, content: '{ broken' } }, ctx).deny, /unreadable/);
});

test("a Write of the whole file that changes the policy needs the person's words; the starter's copy is held the same way", () => {
  const ctx = makeCtx({ hisLast: 'ok' });
  const file = path.join(ctx.root, 'starter', 'core', 'checks', 'models', 'settings.json');
  const ev = { tool: 'Write', input: { file_path: file, content: JSON.stringify({ ...SETTINGS, policy: { minimum: 'any' } }) } };
  assert.ok(pretool(ev, ctx).deny);
  assert.equal(pretool(ev, makeCtx({ hisLast: 'let helpers run on any model' })), null);
});

test("a shell write to the settings file needs the person's words; a shell read does not", () => {
  const ctx = makeCtx({ hisLast: 'sure' });
  const w = 'Set-Content core\\checks\\models\\settings.json "{}"';
  assert.ok(pretool({ tool: 'PowerShell', input: { command: w }, command: w }, ctx).deny);
  const r = 'cat core/checks/models/settings.json';
  assert.equal(pretool({ tool: 'Bash', input: { command: r }, command: r }, ctx), null);
  const n = "node -e \"require('fs').writeFileSync('core/checks/models/settings.json','{}')\"";
  assert.ok(pretool({ tool: 'Bash', input: { command: n }, command: n }, ctx).deny);
});

// ---------- the record and the report to the person ----------
const record = (ctx, input, response = {}) => posttool({ ...launch(input), tool_response: response }, ctx);

test('a report to the person after helpers worked that names no model is a debt; naming the model clears it', () => {
  const ctx = makeCtx();
  record(ctx, { description: 'E11 models', prompt: PROMPT, model: 'opus' }, { status: 'completed', resolvedModel: 'claude-opus-5-5' });
  const bad = stop({ session_id: 's1', text: 'Three helpers finished and reported; the checks are built.' }, ctx);
  assert.equal(bad.debt.key, 'models:report-unsaid');
  assert.match(bad.debt.text, /ran on: opus/);
  assert.deepEqual(stop({ session_id: 's1', text: 'Three helpers, all on Opus, finished and reported.' }, ctx), { clear: ['models:report-unsaid'] });
});

test('a report that names a model no helper ran on is a debt', () => {
  const ctx = makeCtx();
  record(ctx, { description: 'x', prompt: PROMPT, model: 'opus' });
  assert.ok(stop({ session_id: 's1', text: 'The Sonnet helpers built it.' }, ctx).debt);
});

test("helpers launched in this turn count even before the record is written", () => {
  const ctx = makeCtx({ sid: 's2', events: [{ kind: 'tool', tool: 'Agent', ok: true, t: 1 }] });
  assert.ok(stop({ session_id: 's2', text: 'The helper finished the review.' }, ctx).debt);
});

test('a sitrep the person asked for owes no model line (a sitrep names no models)', () => {
  const ctx = makeCtx({ hisLast: 'sitrep' });
  record(ctx, { description: 'x', prompt: PROMPT, model: 'opus' });
  assert.deepEqual(stop({ session_id: 's1', text: 'The helpers finished the checks; one part is left.' }, ctx), { clear: ['models:report-unsaid'] });
});

test('a reply in a chat with no helpers, or in a helper chat, owes nothing', () => {
  assert.deepEqual(stop({ session_id: 's3', text: 'The helper finished.' }, makeCtx({ sid: 's3' })), { clear: ['models:report-unsaid'] });
  const ctx = makeCtx({ isHelperChat: true });
  record(ctx, { description: 'x', prompt: PROMPT, model: 'opus' });
  assert.equal(stop({ session_id: 's1', text: 'The helper finished.' }, ctx), null);
});

test('a helper that really ran below the policy is said after the launch, a swap mid-run included', () => {
  const said = record(makeCtx(), { description: 'x', prompt: PROMPT, model: 'opus' }, { resolvedModel: 'claude-haiku-4-5' });
  assert.match(said.say, /really ran on haiku/);
  const swap = record(makeCtx(), { description: 'x', prompt: PROMPT, model: 'opus' }, { resolvedModel: 'claude-opus-5-5', modelsUsed: ['claude-opus-5-5', 'claude-sonnet-4-5'] });
  assert.match(swap.say, /sonnet/);
  assert.equal(record(makeCtx(), { description: 'x', prompt: PROMPT, model: 'opus' }, { resolvedModel: 'claude-opus-5-5' }), null);
});

test('a helper whose last words name no model is said to the lead; one naming it, or one that handed back, is not', () => {
  assert.match(helperstop({ last_assistant_message: 'Built the module; tests pass.' }, makeCtx()).say, /did not say which model/);
  assert.equal(helperstop({ last_assistant_message: 'Built the module. Opus did the work.' }, makeCtx()), null);
  const handed = makeCtx({ events: [{ kind: 'tool', tool: 'SubagentHandback', ok: true, agent: 'h1', t: 1 }] });
  assert.equal(helperstop({ agent_id: 'h1', last_assistant_message: 'Sent.' }, handed), null);
});

// ---------- its own error, and its speed ----------
test('on its own error it refuses the steps it governs (a safety check) and lets every other step through', () => {
  const broken = makeCtx();
  Object.defineProperty(broken, 'settings', { get() { throw new Error('planted fault'); } });
  assert.match(pretool(launch({ description: 'x', prompt: PROMPT, model: 'opus' }), broken).deny, /this check broke/);
  assert.match(pretool({ tool: 'Edit', input: { file_path: 'core/checks/models/settings.json', old_string: 'a', new_string: 'b' } }, broken).deny, /this check broke/);
  assert.equal(pretool({ tool: 'Read', input: { file_path: 'a.md' } }, broken), null);
  assert.equal(stop({ session_id: 's1', text: 'The helper finished.' }, broken), null);
  assert.equal(helperstop({ last_assistant_message: 'done' }, broken), null);
  assert.ok(broken.logs.some(([e]) => e === 'error'));
});

test('it is fast: a step on ordinary input takes under 50 ms', () => {
  const ctx = makeCtx({ hisLast: 'go on' });
  const file = policyFile(ctx);
  record(ctx, { description: 'x', prompt: PROMPT, model: 'opus' });
  const runs = [
    () => pretool(launch({ description: 'x', prompt: PROMPT.repeat(200), model: 'opus' }), ctx),
    () => pretool(lowerTo(file, 'sonnet'), ctx),
    () => pretool({ tool: 'Bash', input: { command: 'git status' }, command: 'git status' }, ctx),
    () => posttool({ ...launch({ description: 'x', prompt: PROMPT, model: 'opus' }), tool_response: { resolvedModel: 'claude-opus-5-5' } }, ctx),
    () => stop({ session_id: 's1', text: 'The helpers finished. '.repeat(300) }, ctx),
    () => helperstop({ last_assistant_message: 'word '.repeat(2000) }, ctx),
  ];
  for (const run of runs) {
    const t = process.hrtime.bigint();
    run();
    const ms = Number(process.hrtime.bigint() - t) / 1e6;
    assert.ok(ms < 50, `a step took ${ms.toFixed(1)} ms`);
  }
});
