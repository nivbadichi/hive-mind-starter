// A helper that ends with the handback tool delivers its report as that tool's input (tool_input.message); its last
// words at SubagentStop are only its closing text (https://code.claude.com/docs/en/hooks, "SubagentStop input").
// So at the helperstop step ev.text must be the delivered report when the after-tool hook saw the handback.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { runChecks } from '../hook.mjs';
import { readLines } from '../records.mjs';
import { makeChecksDir, makeWorld, rm } from './fixtures.mjs';

const dirs = [];
after(() => rm(...dirs));

const SPY = `import fs from 'node:fs';
export default { id: 'spy', rule: 'test', kind: 'discipline', about: 'Writes down the text at helperstop.',
  steps: { helperstop(ev, ctx) { fs.appendFileSync(ctx.settings.out, JSON.stringify({ text: ev.text, report: ev.report, last: ev.last_assistant_message }) + '\\n'); return null; } } };`;

function setup() {
  const out = path.join(fs.mkdtempSync(path.join(process.env.TEMP || '/tmp', 'spy-')), 'spy.jsonl');
  const dir = makeChecksDir({ spy: SPY }, { spy: { out } });
  const w = makeWorld();
  dirs.push(dir, w.base, path.dirname(out));
  const call = (mode, input) => runChecks({ mode, input: { session_id: w.sid, ...input }, root: w.root, state: w.state, sid: w.sid, dir, outbox: [] });
  return { out, call };
}

test('known-bad case: the helper\'s closing words are not taken for its report', async () => {
  const { out, call } = setup();
  await call('posttool', { tool_name: 'SubagentHandback', tool_input: { message: 'Report: three files changed. Questions: none' }, agent_id: 'h1' });
  await call('subagentstop', { last_assistant_message: 'Bye.', agent_id: 'h1' });
  const r = readLines(out)[0];
  assert.equal(r.text, 'Report: three files changed. Questions: none');
  assert.equal(r.report, true);
  assert.equal(r.last, 'Bye.', 'the hook\'s own field is kept as it was');
});

test('known-good case: with no handback the last words are the text; another helper\'s handback is not used', async () => {
  const { out, call } = setup();
  await call('posttool', { tool_name: 'SubagentHandback', tool_input: { message: 'the report of h2' }, agent_id: 'h2' });
  await call('subagentstop', { last_assistant_message: 'Report of h1, in its last words.', agent_id: 'h1' });
  const r = readLines(out)[0];
  assert.equal(r.text, 'Report of h1, in its last words.');
  assert.equal(r.report, false);
});
