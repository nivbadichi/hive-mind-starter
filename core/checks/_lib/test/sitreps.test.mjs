// Every reply check together, the gates' and the check modules', on good sitreps and on the bad examples each check
// was built for. The good ones must pass every check at once; the bad ones must still be caught. (Seen in the main
// system on 2026-11-20: the display the checks demand was flagged as an unproven "done" and as numbers no command
// printed; a thing's own name, such as "Ready for ...", as a claim; a word in a thing's name as an inside word; the
// phrase the person had to type as an inside word; a report of many things and the open questions could never fit
// about 120 words.) A made-up home and notebook under the temp folder; nothing real.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runChecks } from '../hook.mjs';
import { paths } from '../records.mjs';
import * as Debts from '../debts.mjs';
import { render } from '../../../engine/progress.mjs';
import { judgedText, withoutDisplay } from '../reply-parts.mjs';
import { rm } from './fixtures.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CHECKS = path.resolve(HERE, '..', '..');
const REPO = path.resolve(CHECKS, '..', '..');
const GATES = path.join(REPO, 'core', 'gates', 'gates.mjs');
const made = [];
after(() => rm(...made));

const steps = (n, d) => Array.from({ length: n }, (_, i) => ({ name: `step ${i + 1}`, done: i < d }));
const LIST = { work: 'My first month with Hive Mind', updated: '2026-11-20', items: [
  ['The weekly plan', 4, 4], ['The reading list', 5, 3], ['Ready for the trip', 6, 2], ['The family photos repository', 3, 1], ['The tidy-up of old notes', 2, 0],
].map(([name, n, d]) => ({ name, steps: steps(n, d) })) };
const OPEN = ['Which day should the weekly plan arrive, Sunday or Monday?'];
const display = '```\n' + render(LIST) + '\n```';
const bullets = (states) => LIST.items.map((it, i) => `- ${it.name}: ${states[i]}`).join('\n');
const STATES = ['done. It is in your notes for Monday.', 'in work. The last two books are being looked up.', 'in work. The packing list is next.', 'in work. The first album is sorted.', 'not started. It comes after the reading list.'];
const SITREPS = {
  'an ordinary sitrep': `${display}\nOne of your five requests is done and three are in work.\n${bullets(STATES)}\n- Needs you: ${OPEN[0]}`,
  'a sitrep with a phrase to type': `${display}\nThe work is held until you answer one thing.\n${bullets(STATES)}\n- Needs you: ${OPEN[0]} To go on, type "reinstall the gates".\nUntil you type it, only reading runs.`,
};
const BAD = {
  'proof: done with no check': ['It is done. The new checks work.', /proof/],
  'plain words: inside words left unexplained': ['The worktree is merged and the hook fires now, so the loader can run the debt store again next to the snapshot.', /plain-words/],
  'protocols: progress with no bars': ['- The weekly plan: in work.\n- Needs you: nothing.', /his-protocols/],
};

function world() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'hive-sitreps-')); made.push(base);
  const home = path.join(base, 'home'), root = path.join(home, 'hive-mind'), state = path.join(home, '.claude', 'hive');
  const w = (p, s) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s); };
  w(path.join(root, 'system', 'rules.md'), fs.readFileSync(path.join(REPO, 'system', 'rules.md'), 'utf8'));
  w(path.join(root, 'system', 'progress.json'), JSON.stringify(LIST, null, 2));
  w(path.join(root, 'system', 'questions.json'), JSON.stringify({ questions: OPEN.map((text, i) => ({ id: `q-${100 + i}`, text, state: 'open', kind: 'A' })) }));
  w(path.join(root, 'core', 'gates', 'settings.json'), fs.readFileSync(path.join(REPO, 'core', 'gates', 'settings.json'), 'utf8'));
  return { base, home, root, state };
}
async function checksOn(W, sid, said, reply) {
  const call = (mode, input) => runChecks({ mode, input: { session_id: sid, cwd: W.root, ...input }, root: W.root, state: W.state, sid, dir: CHECKS, outbox: [], inline: true });
  await call('prompt', { prompt: said });
  await call('stop', { last_assistant_message: reply });
  return Debts.load(paths(W.state, sid).debts).items.map((d) => `${d.check}: ${d.text}`);
}
function gatesOn(W, sid, said, reply) {
  const env = { ...process.env, HIVE_HOME: W.home, HIVE_ROOT: W.root, HIVE_STATE: W.state, HIVE_PLUGIN_LIST: 'none' };
  fs.mkdirSync(path.join(W.state, 'gates', 'start'), { recursive: true });
  fs.writeFileSync(path.join(W.state, 'gates', 'start', sid + '.json'), JSON.stringify({ session: sid }));
  const run = (mode, input) => spawnSync(process.execPath, [GATES, mode], { input: JSON.stringify({ session_id: sid, cwd: W.root, ...input }), env, encoding: 'utf8', timeout: 20000 });
  run('prompt', { hook_event_name: 'UserPromptSubmit', prompt: said });
  run('stop', { hook_event_name: 'Stop', stop_hook_active: false, last_assistant_message: reply });
  try { return JSON.parse(fs.readFileSync(path.join(W.state, 'gates', 'chat', sid + '.carry.json'), 'utf8')).items || []; } catch { return []; }
}

for (const [what, text] of Object.entries(SITREPS)) {
  test(`known-good (${what}): every reply check passes it at once`, async () => {
    const W = world();
    const debts = await checksOn(W, 'good-' + what.length, 'sitrep', text);
    assert.deepEqual(debts, [], debts.join('\n'));
    const carried = gatesOn(W, 'good-g-' + what.length, 'sitrep', text);
    assert.deepEqual(carried, [], carried.join('\n'));
  });
}
for (const [what, [text, want]] of Object.entries(BAD)) {
  test(`known-bad (${what}): still caught`, async () => {
    const W = world();
    const debts = await checksOn(W, 'bad-' + what.length, 'how is the plan going', text);
    assert.ok(debts.some((d) => want.test(d)), `not caught: ${what}\n${debts.join('\n')}`);
  });
}
test('known-bad: the same sitrep without bullet points is caught, in the check and in the gates', async () => {
  const W = world();
  const plain = SITREPS['an ordinary sitrep'].replace(/^- /gm, '');
  const debts = await checksOn(W, 'nobullets', 'sitrep', plain);
  assert.ok(debts.some((d) => /his-protocols: .*not a bullet point/.test(d)), debts.join('\n'));
  assert.ok(gatesOn(W, 'nobullets-g', 'sitrep', plain).some((x) => /not bullet points/.test(x)));
});
test('the parts never judged: the display, the names of things, a phrase to type', () => {
  const t = judgedText(`${display}\n- Ready for the trip: in work.\nTo go on, type "reinstall the gates".`, LIST.items.map((i) => i.name));
  assert.doesNotMatch(t, /█|ready|reinstall the gates/i);
  assert.match(withoutDisplay('a\n' + display + '\nb'), /^a\n\nb$/);
});
