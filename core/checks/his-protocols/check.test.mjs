// Tests for the his-protocols check (the standing protocols). Each behaviour has a known-bad case (must be caught)
// and a known-good case (must pass).
// Run: node --test core/checks/his-protocols/check.test.mjs (from the starter folder)
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import check, { pretool, posttool, prompt, stop, sitrepFaults } from './check.mjs';
import { compare, report } from './recap-compare.mjs';
import { render, apply } from '../../engine/progress.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'his-protocols-test-'));
after(() => fs.rmSync(BASE, { recursive: true, force: true }));
const SETTINGS = JSON.parse(fs.readFileSync(path.join(HERE, 'settings.json'), 'utf8'));
let n = 0;

// A made-up notebook with a progress list of two requests, and a made-up Hive folder.
function notebook({ said = '', helper = false } = {}) {
  const root = path.join(BASE, 'nb' + n++);
  const state = path.join(root, '.hive');
  fs.mkdirSync(path.join(root, 'system'), { recursive: true });
  fs.mkdirSync(path.join(root, 'log'), { recursive: true });
  fs.mkdirSync(state, { recursive: true });
  let list = { work: 'The enforcement run', updated: '', items: [] };
  list = apply(list, 'add', ['The sitrep made permanent', '--steps', 'test; build; join']);
  list = apply(list, 'add', ['Every check module', '--steps', 'a; b; c; d']);
  list = apply(list, 'done', ['1']);
  fs.writeFileSync(path.join(root, 'system', 'progress.json'), JSON.stringify(list));
  const logs = [];
  const words = said.toLowerCase();
  const ctx = {
    root, state, sid: 's1', settings: SETTINGS, events: [], debts: [], isHelperChat: helper, who: 'the person', hisLast: said,
    said: (p) => [].concat(p).some((w) => new RegExp(`(^|[^a-z])${String(w).toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z])`).test(words)),
    read: (rel) => { try { return fs.readFileSync(path.join(root, rel), 'utf8'); } catch { return ''; } },
    log: (e, d) => logs.push([e, d]),
  };
  return { root, state, ctx, logs, list };
}
const reply = (text) => ({ step: 'stop', session_id: 's1', text, tool: '', input: {}, command: '' });
const keys = (r) => ((r && r.debt) || []).map((d) => d.key);
const fence = (s) => '```\n' + s + '\n```';
function goodSitrep(list) {
  return fence(render(list)) + '\n\nOne of your two requests is under way; the other has not started.\n' +
    '- The sitrep made permanent: being worked on. Its test is written; the build comes next.\n' +
    '- Every check module: not started. It begins after the first one.\n' +
    '- Needs you: nothing.';
}
// A sitrep is in bullet points (2026-11-20): one bullet per thing, and a bullet for "Needs you:".
test('known-bad: the same sitrep with plain lines instead of bullet points is a debt; with bullets it is not', () => {
  const { ctx, list } = notebook({ said: 'sitrep' });
  const r = stop(reply(goodSitrep(list).replace(/^- /gm, '')), ctx);
  assert.deepEqual(keys(r), ['sitrep']);
  assert.match(r.debt[0].text, /not a bullet point/);
  assert.deepEqual(stop(reply(goodSitrep(list)), ctx), { clear: ['sitrep'] });
});

// ---------- 1. questions in the question card ----------
test('known-bad: a choice put to the person in a paragraph is a debt', () => {
  const { ctx } = notebook();
  const r = stop(reply('I found two note-taking tools. Which one do you want, the work-report one or the log one?'), ctx);
  assert.deepEqual(keys(r), ['question-format']);
  assert.match(r.debt[0].text, /question card/);
  assert.match(r.debt[0].text, /AskUserQuestion/);
});
test('known-good: the same question asked with the question card passes, even when the reply repeats it', () => {
  const { ctx } = notebook();
  const q = 'Which note tool do you want, the work-report one or the log one?';
  posttool({ tool: 'AskUserQuestion', session_id: 's1', input: { questions: [{ question: q, header: 'Tool', options: [{ label: 'work-report' }, { label: 'log' }], multiSelect: false }] } }, ctx);
  ctx.events = [{ kind: 'tool', tool: 'AskUserQuestion', ok: true, t: Date.now() - 1000 }];
  assert.equal(stop(reply(`I asked you with the card: ${q}`), ctx), null);
  assert.equal(stop(reply('Two note tools fit; I put the choice to you in the card.'), ctx), null);
});
test('known-bad: a card asked about one thing does not cover a different question in the prose', () => {
  const { ctx } = notebook();
  posttool({ tool: 'AskUserQuestion', session_id: 's1', input: { questions: [{ question: 'Which colour set do you want for the site?' }] } }, ctx);
  ctx.events = [{ kind: 'tool', tool: 'AskUserQuestion', ok: true, t: Date.now() - 1000 }];
  assert.deepEqual(keys(stop(reply('Shall I publish the site tonight?'), ctx)), ['question-format']);
});
test('known-good: their own question quoted, a question in code, and a question to nobody are not questions to them', () => {
  const { ctx } = notebook();
  assert.equal(stop(reply('You asked "why didn\'t you ask?" The answer is that the list was never read.'), ctx), null);
  assert.equal(stop(reply('The test looks for this line:\n```\nWhich one do you want?\n```\nIt is in place.'), ctx), null);
  assert.equal(stop(reply('Why did the helper stop? The app restarted at 09:58.'), ctx), null);
});

test('known-good: the "Needs you:" line may name an open question of the questions list; known-bad: a new one there is still a paragraph question', () => {
  const { ctx, root } = notebook();
  fs.writeFileSync(path.join(root, 'system', 'questions.json'), JSON.stringify({ questions: [{ id: 'q-001', state: 'open', kind: 'A', text: 'Which colour set do you want for the site?' }] }));
  // (A "Needs you:" line alone also makes the reply a progress report, so the sitrep debt comes too; only the
  // question part is looked at here.)
  assert.ok(!keys(stop(reply('Needs you: Which colour set do you want for the site?'), ctx)).includes('question-format'));
  assert.ok(keys(stop(reply('Needs you: Shall I publish the site tonight?'), ctx)).includes('question-format'));
});

// ---------- 2. the sitrep ----------
test('known-bad: one bar and loose prose is a debt that stays', () => {
  const { ctx } = notebook({ said: 'sitrep' });
  const r = stop(reply('[████████░░░░] 40%\nThe enforcement run is going well. Nine helpers are working and the rest start soon.'), ctx);
  assert.deepEqual(keys(r), ['sitrep']);
  const d = r.debt[0];
  assert.equal(d.auto, false, 'the debt stays until a correct sitrep is given');
  assert.match(d.text, /does not open with the progress bars/);
  assert.match(d.text, /no bullet "- <thing>: <state>" for "The sitrep made permanent", "Every check module"/);
  assert.match(d.text, /no bullet "- Needs you:"/);
});
test('known-bad: an old-style row of steps is not the bars', () => {
  const { ctx } = notebook();
  const r = stop(reply('Map: plan > build > [verify] > release\nThe checks are being joined now.'), ctx);
  assert.deepEqual(keys(r), ['sitrep']);
});
test('known-good: a real sitrep with the bars the program prints passes, and clears the debt', () => {
  const { ctx, list } = notebook({ said: 'sitrep' });
  const r = stop(reply(goodSitrep(list)), ctx);
  assert.deepEqual(r, { clear: ['sitrep'] });
});
test('known-bad: bars typed by hand with a wrong number, or a display that is out of date, are caught', () => {
  const { ctx, list, root } = notebook();
  const typed = goodSitrep(list).replace(/(█+░+)\s+(\d+)%/, (m, b) => `${b} 90%`);
  assert.match(stop(reply(typed), ctx).debt[0].text, /do not match their own numbers/);
  const moved = apply(JSON.parse(JSON.stringify(list)), 'done', ['2']);
  fs.writeFileSync(path.join(root, 'system', 'progress.json'), JSON.stringify(moved));
  assert.match(stop(reply(goodSitrep(list)), ctx).debt[0].text, /not the ones the program prints now/);
  assert.deepEqual(stop(reply(goodSitrep(moved)), ctx), { clear: ['sitrep'] });
});
test('known-bad: a sitrep whose list is empty has nothing counted to show', () => {
  const { ctx, root } = notebook({ said: 'status?' });
  fs.writeFileSync(path.join(root, 'system', 'progress.json'), JSON.stringify({ work: '', items: [] }));
  assert.match(stop(reply(fence(render({ items: [] })) + '\nAll fine.\nNeeds you: nothing.'), ctx).debt[0].text, /list of what was asked for is empty/);
});
test('known-good: a reply that reports nothing is not held to the sitrep shape, and does not clear an owed one', () => {
  const { ctx } = notebook();
  assert.equal(stop(reply('The file you named holds the four rules of the 19th.'), ctx), null);
});
test('while a sitrep is owed, their next message puts the counted display in front of Claude', () => {
  const { ctx, list } = notebook();
  ctx.debts = [{ key: 'sitrep', text: 'x', status: 'open' }];
  const r = prompt({ step: 'prompt', text: 'go on' }, ctx);
  assert.ok(r.say.includes(render(list)));
  ctx.debts = [];
  assert.equal(prompt({ step: 'prompt', text: 'go on' }, ctx), null);
  const asked = notebook({ said: 'where are we' });
  assert.ok(prompt({ step: 'prompt' }, asked.ctx).say.includes('```'));
});
test('sitrepFaults is [] for the program\'s own output with one line per thing', () => {
  const { list } = notebook();
  assert.deepEqual(sitrepFaults(goodSitrep(list), list, SETTINGS), []);
});

// ---------- 3. finished, ready, perfect ----------
function pass(state, slug, title) {
  const d = path.join(state, 'verify', slug);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'result.md'), `# Check: ${title}\n\n**Verdict: PASS**\n`);
}
test('known-bad: a design called ready with no PASS on record is a debt', () => {
  const { ctx } = notebook();
  const r = stop(reply('The combined design is ready for you to look at on your phone.'), ctx);
  assert.deepEqual(keys(r), ['unproven-finished']);
  assert.match(r.debt[0].text, /hive-verify/);
});
test('known-good: with a PASS from the checker for that part on record, "ready" passes; a PASS for another part does not count', () => {
  const { ctx, state } = notebook();
  pass(state, '2026-11-20_combined-design', 'the combined design, readable text');
  assert.equal(stop(reply('The combined design is ready for you to look at on your phone.'), ctx), null);
  assert.deepEqual(keys(stop(reply('The installer is finished.'), ctx)), ['unproven-finished']);
});
test('known-bad: a FAIL or NOTHING PROVEN result is not a PASS', () => {
  const { ctx, state } = notebook();
  const d = path.join(state, 'verify', '2026-11-20_installer');
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'result.md'), '# Check: the installer\n\n**Verdict: NOTHING PROVEN**\n');
  assert.deepEqual(keys(stop(reply('The installer is perfect now.'), ctx)), ['unproven-finished']);
});
test('known-good: "not ready", "when it is finished", "I am ready" and a question are not claims', () => {
  const { ctx } = notebook();
  for (const t of ['The installer is not ready yet.', 'When the installer is finished, the checker walks it.', 'I am ready to start the next part.', 'It is almost finished; the checker walks it next.']) {
    assert.equal(stop(reply(t), ctx), null, t);
  }
});

// ---------- 4. the recap ----------
function smallNotebook(recapText) {
  const nb = notebook();
  fs.writeFileSync(path.join(nb.root, 'log', '2026-11-19.md'), '# 2026-11-19\n\n- 19:39 | Hive Mind | They accepted the store terms; nothing is published until their additions are in.\n- 19:59 | Hive Mind | They authorised all installations of what they named.\n- 19:59 | Hive Mind | Version one must be ready for a newcomer who just installed Claude.\n');
  fs.writeFileSync(path.join(nb.root, 'system', 'decisions.md'), '| Date | Decision | Their words |\n|---|---|---|\n| 2026-11-18 | Old decision about the site colours | x |\n| 2026-11-19 | Every update to them is a sitrep: headline, each request with its state, what needs them | "make it professional" |\n');
  if (recapText !== undefined) fs.writeFileSync(path.join(nb.root, 'system', 'recap-2026-11-19.md'), recapText);
  return nb;
}
const COMPLETE = 'status: finished\n# Recap\n\n1. 19:39. You accepted the store terms; nothing is published until your additions are in.\n2. 19:59. You authorised all installations you named.\n3. 19:59. Version one must be ready for a newcomer who just installed Claude.\n\nDecisions:\n1. Every update to you is a sitrep: a headline, each request with its state, and what needs you.\n';
test('known-bad: marking a recap finished while it leaves out a log line or a decision is refused, with what is missing', () => {
  const { root, ctx } = smallNotebook();
  const short = COMPLETE.replace(/3\. 19:59.*\n/, '').replace(/Decisions:[\s\S]*$/, '');
  const r = pretool({ tool: 'Write', input: { file_path: path.join(root, 'system', 'recap-2026-11-19.md'), content: short }, cwd: root }, ctx);
  assert.ok(r && r.deny);
  assert.match(r.deny, /leaves out 2 \(1 log lines, 1 decisions/);
  assert.match(r.deny, /Version one must be ready/);
  assert.match(r.deny, /sitrep/);
});
test('known-good: a complete recap may be marked finished; a draft may always be written', () => {
  const { root, ctx } = smallNotebook();
  assert.equal(pretool({ tool: 'Write', input: { file_path: path.join(root, 'system', 'recap-2026-11-19.md'), content: COMPLETE }, cwd: root }, ctx), null);
  assert.equal(pretool({ tool: 'Write', input: { file_path: path.join(root, 'system', 'recap-2026-11-19.md'), content: '# Recap\nA first draft.\n' }, cwd: root }, ctx), null);
});
test('known-bad: an Edit that adds the finished mark to an incomplete recap is refused too', () => {
  const { root, ctx } = smallNotebook('# Recap\n\n1. 19:39. The store terms.\n');
  const r = pretool({ tool: 'Edit', input: { file_path: path.join(root, 'system', 'recap-2026-11-19.md'), old_string: '# Recap', new_string: 'status: finished\n# Recap' }, cwd: root }, ctx);
  assert.ok(r && r.deny);
});
test('known-bad: a reply that calls the recap finished while it leaves something out is a debt; known-good once it is whole', () => {
  const { root, ctx } = smallNotebook('# Recap\n\n1. 19:39. The store terms.\n');
  assert.deepEqual(keys(stop(reply('The recap is finished and waiting for you.'), ctx)), ['recap-unfinished']);
  fs.writeFileSync(path.join(root, 'system', 'recap-2026-11-19.md'), COMPLETE);
  assert.equal(stop(reply('The recap is finished and waiting for you.'), ctx), null);
});
test('two log lines at the same minute need two recap lines', () => {
  const logs = [{ name: 'log/2026-11-19.md', text: '# 2026-11-19\n- 19:59 | Hive | They authorised all installations.\n- 19:59 | Hive | Version one ready for a newcomer.\n' }];
  const one = compare({ recap: '1. 19:59. You authorised all installations.', recapName: 'recap-2026-11-19.md', logs });
  assert.equal(one.missingLog.length, 1);
  assert.match(one.missingLog[0].text, /newcomer/);
});

// ---------- the contract ----------
test('the module has the contract\'s shape', () => {
  assert.equal(check.id, 'his-protocols');
  assert.equal(check.kind, 'discipline');
  assert.equal(check.mode, 'refuse');
  assert.equal(typeof check.about, 'string');
  for (const s of ['pretool', 'posttool', 'prompt', 'stop']) assert.equal(typeof check.steps[s], 'function');
});
test('a helper chat is not held to the shape of a reply to the person', () => {
  const { ctx } = notebook({ helper: true });
  assert.equal(stop(reply('Which one do you want? The installer is finished.'), ctx), null);
});
test('on its own error the check lets the step through and logs (a discipline check)', () => {
  const { ctx, logs, root } = notebook();
  const bad = { ...ctx };
  Object.defineProperty(bad, 'root', { get() { throw new Error('broken root'); } });
  Object.defineProperty(ctx, 'events', { get() { throw new Error('broken events'); } });
  assert.equal(stop(reply('Which one do you want?'), ctx), null);
  assert.ok(logs.some(([e, d]) => e === 'error' && d.step === 'stop' && /broken events/.test(d.message)));
  assert.equal(pretool({ tool: 'Write', input: { file_path: path.join(root, 'system', 'recap-2026-11-19.md'), content: 'status: finished' } }, bad), null);
  assert.ok(logs.some(([e, d]) => e === 'error' && d.step === 'pretool'));
});
test('it is fast: under 50 ms for a step on ordinary input', () => {
  const { ctx, list, root } = notebook({ said: 'sitrep' });
  const ev = reply(goodSitrep(list) + '\nThe installer is ready. Which part next?');
  const w = { tool: 'Write', input: { file_path: path.join(root, 'app', 'a.tsx'), content: 'x' }, cwd: root };
  stop(ev, ctx); pretool(w, ctx); // warm up
  const runs = 20;
  const t = performance.now();
  for (let i = 0; i < runs; i++) { stop(ev, ctx); pretool(w, ctx); prompt({ step: 'prompt' }, ctx); }
  const each = (performance.now() - t) / (runs * 3);
  assert.ok(each < 50, `one step took ${each.toFixed(2)} ms`);
});

// ---------- 5. the learning note ----------
// The tests set their own file and words; the chosen ones in settings.json are never leaned on.
const LEARNED = { ...SETTINGS, learned: { file: 'system/learned-test.md', endWords: ['done', 'finished', 'joined'], skipMarks: ['/scratchpad/'] } };
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
function learnedBook() {
  const b = notebook();
  b.ctx.settings = LEARNED;
  b.ctx.events = [{ kind: 'write', path: path.join(b.root, 'core', 'engine', 'x.mjs') }];
  return b;
}
test('known-bad: work that changed files ends with no learning note of the day: one reminder, never a debt', () => {
  const { ctx, logs } = learnedBook();
  const r = stop(reply('The program is joined and its tests pass.'), ctx);
  assert.ok(r && r.say, 'a reminder is given');
  assert.ok(!r.debt, 'it is a reminder, not a debt');
  assert.match(r.say, /learning note/);
  assert.ok(r.say.includes('system/learned-test.md'));
  assert.ok(r.say.includes(`## ${today()}`));
  assert.match(r.say, /never in the reply/);
  assert.ok(logs.some(([e]) => e === 'learned-reminder'));
});
test('known-good: a note of the day in the file, no files changed, no end of work, or a helper chat: nothing is said', () => {
  const a = learnedBook();
  fs.writeFileSync(path.join(a.root, 'system', 'learned-test.md'), `# Learned\n\n## ${today()}\n- A plain line.\n`);
  assert.equal(stop(reply('The program is joined.'), a.ctx), null);
  const b = learnedBook(); b.ctx.events = [{ kind: 'tool', tool: 'Read', ok: true }];
  assert.equal(stop(reply('The program is joined.'), b.ctx), null, 'nothing was written');
  const c = learnedBook();
  assert.equal(stop(reply('Reading the next file now.'), c.ctx), null, 'not the end of a piece of work');
  const d = learnedBook(); d.ctx.isHelperChat = true;
  assert.equal(stop(reply('The program is joined.'), d.ctx), null, 'a helper chat reports to its starter');
  const e = learnedBook(); e.ctx.events = [{ kind: 'write', path: path.join(os.tmpdir(), 'x', 'scratchpad', 'a.txt') }];
  assert.equal(stop(reply('Done.'), e.ctx), null, 'a scratch file is not the work');
});
test('known-good: the reminder is said once per chat per day, so it never repeats at every message', () => {
  const { ctx } = learnedBook();
  assert.ok(stop(reply('The first part is done.'), ctx).say);
  assert.equal(stop(reply('The second part is done.'), ctx), null);
  assert.ok(stop({ ...reply('Done here too.'), session_id: 's2' }, { ...ctx, sid: 's2' }).say, 'another chat is told once too');
});
test('known-good: nothing at the person\'s message for the note (no text at every message)', () => {
  const { ctx } = learnedBook();
  assert.equal(prompt({ step: 'prompt', text: 'carry on' }, ctx), null);
});
