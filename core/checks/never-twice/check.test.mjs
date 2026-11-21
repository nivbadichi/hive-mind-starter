// Tests for the never-twice check (rule 7). Run: node --test core/checks/never-twice/check.test.mjs
// Every behaviour has a known-bad case (must be caught) and a known-good case (must pass), built from made-up notes in
// the shape of system/lessons.md and system/decisions.md. The steps are called directly with made-up ev and ctx.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import check, { owedLessons, writtenPaths, sentItems, decisionLines, directedQuestions, answeredQuestions } from './check.mjs';
import { scan } from '../../engine/lessons.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REAL_ROOT = path.resolve(HERE, '..', '..', '..');
const { prompt, pretool, stop } = check.steps;
const made = [];
const tmp = (prefix) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix)); made.push(d); return d; };
after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });

// Made-up lines in the shape of system/decisions.md and system/decisions-in-force.md.
const DECISIONS = `# Decisions

| Date | Decision | Reason |
| --- | --- | --- |
| 2026-11-18 | The first version of the shop page is put online | You chose "Yes, put it online" |
| 2026-11-19 | Nothing of the new shop page is published until the things you want to add are built in; then your yes; then publish | You: "Finish everything first, then I add my things, then we publish" |
| 2026-11-19 | You allow every installation of the tools you named today. Paying stays your own act | You: "Install all of them" |
`;
const IN_FORCE = `# Decisions in force

- Since 2026-11-19: the new shop page goes online only after your additions are built in and you have then said yes.
`;
// Made-up lessons: two owed and old, one closed by a file that exists, and one owed
// lesson from today (not older than a day, so not said yet).
const LESSONS = `# Lessons

- Check where an approval prompt shows before relying on it. closed_by: open (would close with: one line in rule 1)
- Before backing up to a name like \`.v1\`, check the name is free. closed_by: core/gates/install.ps1 keeps every replaced file as a copy
- 2026-11-19: Write a public page for the reader first. closed_by: owed: a line in the brief form's checks for any public page
- 2026-11-20: A lesson of today. closed_by: owed
`;

// The list of questions (system/questions.json, kept by core/engine/questions.mjs): one made-up answered question
// (the case it holds: answers given to question cards were lost to a restart and the same
// questions were shown again), and one made-up question still open.
const QUESTIONS = JSON.stringify({ version: 1, work: null, questions: [
  { id: 'q-001', text: 'Which name goes on the legal pages as the person who runs the site?', kind: 'A', state: 'answered', asked: [], answer: { words: 'My first name', on: '2026-11-20', where: '' } },
  { id: 'q-050', text: 'Which colour should the footer links take on the legal pages?', kind: 'A', state: 'open', asked: [], answer: null },
] });

function makeRoot({ decisions = DECISIONS, inForce = IN_FORCE, lessons = LESSONS, sources = '# What you sent\n', questions = QUESTIONS } = {}) {
  const root = tmp('never-twice-');
  const put = (rel, text) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), text); };
  put('system/decisions.md', decisions);
  put('system/decisions-in-force.md', inForce);
  put('system/lessons.md', lessons);
  put('inbox/sources.md', sources);
  if (questions != null) put('system/questions.json', questions);
  put('core/gates/install.ps1', '# made up\n');
  return root;
}
function makeCtx(root, extra = {}) {
  const logs = [];
  const state = tmp('never-twice-state-');
  return {
    root, state, hisLast: '', isHelperChat: false, loaded: new Set(), events: [], settings: {}, today: '2026-11-20',
    read: (rel) => { try { return fs.readFileSync(path.join(root, rel), 'utf8'); } catch { return null; } },
    said: () => false, log: (event, detail) => logs.push({ event, detail }), logs, ...extra,
  };
}
const ev = (more = {}) => ({ session_id: 'test-session', ...more });

test('the module has the contract shape', () => {
  assert.equal(check.id, 'never-twice');
  assert.equal(check.rule, 'rule 7');
  assert.equal(check.kind, 'discipline');
  assert.equal(check.mode, 'refuse');
  assert.ok(check.about.length > 20);
  for (const s of ['prompt', 'pretool', 'stop']) assert.equal(typeof check.steps[s], 'function');
});

// ---------- 1. asked again ----------
test('asked again, known-bad: asking to go live the day after the order of work was set', () => {
  const ctx = makeCtx(makeRoot(), { hisLast: 'continue' });
  const r = stop(ev({ text: 'The additions are all built in. Should I go live with the new shop page now?' }), ctx);
  assert.ok(r && r.debt, 'must be a debt');
  assert.match(r.debt.text, /publishing or going live/);
  assert.match(r.debt.text, /the new shop page goes online only after your additions/); // the decision is quoted
});

test('asked again, known-bad: a question card is refused before the person sees it, with the decision quoted', () => {
  const ctx = makeCtx(makeRoot());
  const r = pretool(ev({ tool: 'AskUserQuestion', input: { questions: [{ question: 'Ready to publish the new shop page?', options: [{ label: 'Yes' }, { label: 'Not yet' }] }] } }), ctx);
  assert.ok(r && r.deny);
  assert.match(r.deny, /saved decision already answers it/);
  assert.match(r.deny, /2026-11-19|in force/);
});

test('asked again, known-bad: installing, which the person already allowed', () => {
  const ctx = makeCtx(makeRoot());
  const r = stop(ev({ text: 'The note tool is reviewed. Do you want me to install it?' }), ctx);
  assert.ok(r.debt);
  assert.match(r.debt.text, /installing/);
  assert.match(r.debt.text, /allow every installation/);
});

test('asked again, known-good: a question no decision answers, a reply with no question, and a reason given', () => {
  const root = makeRoot();
  assert.deepEqual(stop(ev({ text: 'Should I use the warm palette or the cold one for the cards?' }), makeCtx(root)), { clear: ['never-twice'] });
  assert.deepEqual(stop(ev({ text: 'The new shop page is built. It goes live after your additions, as decided.' }), makeCtx(root)), { clear: ['never-twice'] });
  assert.deepEqual(stop(ev({ text: 'This is a new site, not covered by the shop page decision. Should I publish the new one?' }), makeCtx(root)), { clear: ['never-twice'] });
  assert.equal(pretool(ev({ tool: 'AskUserQuestion', input: { questions: [{ question: 'Which palette do you like?' }] } }), makeCtx(root)), null);
});

// A saved decision answers a question only when it settles the same choice, not merely the same topic (2026-11-20).
const PALETTES = DECISIONS + '| 2026-11-20 | The five palettes were rejected; different examples are to be made from the examples sent before | the person\'s words |\n' +
  '| 2026-11-20 | The palette rule: one light colour, one darker of the same tone, the wild card 36.7 degrees round the wheel | the person\'s words |\n' +
  '| 2026-11-20 | The site\'s colours are Mint for dark mode and Raspberry for light mode, with a switch between palettes | the person\'s words |\n';
test('live fault 6, known-good: a new choice on a decided topic (new palettes) is a new question, in a card and in a reply', () => {
  const root = makeRoot({ decisions: PALETTES });
  const q = 'Which of these three palettes, built from your examples with your rule, should the cards use: Moss, Dune or Ember?';
  assert.equal(pretool(ev({ tool: 'AskUserQuestion', input: { questions: [{ question: q }] } }), makeCtx(root)), null);
  assert.deepEqual(stop(ev({ text: `The three palettes are on the page. ${q}` }), makeCtx(root)), { clear: ['never-twice'] });
});
test('live fault 6, the neighbour: asking again what was decided is still caught', () => {
  const root = makeRoot({ decisions: PALETTES });
  const r = pretool(ev({ tool: 'AskUserQuestion', input: { questions: [{ question: 'Which palette should the site use: Mint for dark mode and Raspberry for light mode?' }] } }), makeCtx(root));
  assert.ok(r && r.deny && /Mint for dark mode/.test(r.deny), r && r.deny);
  const s = stop(ev({ text: 'The colours are ready. Do you want the palettes Mint for dark mode and Raspberry for light mode?' }), makeCtx(root));
  assert.ok(s && s.debt && /colour palettes/.test(s.debt.text), JSON.stringify(s));
});
test('asked again, known-good: with no saved decision on the topic, asking is right', () => {
  const root = makeRoot({ decisions: '| Date | Decision | Reason |\n| --- | --- | --- |\n', inForce: '# Decisions in force\n' });
  assert.deepEqual(stop(ev({ text: 'Should I publish the page now?' }), makeCtx(root)), { clear: ['never-twice'] });
});

// ---------- 1b. asked again what the person already answered ----------
test('answered, known-bad: a question card the person already answered is shown again (refused, their words quoted)', () => {
  const r = pretool(ev({ tool: 'AskUserQuestion', input: { questions: [{ question: 'Which name should the legal pages show for the person who runs the site?', header: 'Legal name', options: [{ label: 'First name' }, { label: 'Last name' }] }] } }), makeCtx(makeRoot()));
  assert.ok(r && r.deny, 'the card must be refused');
  assert.match(r.deny, /q-001, answered 2026-11-20: "My first name"/);
});

test('answered, known-bad: the same question asked again in a reply is a debt', () => {
  const r = stop(ev({ text: 'One thing left. Which name goes on the legal pages for the person who runs the site?' }), makeCtx(makeRoot()));
  assert.ok(r && r.debt);
  assert.match(r.debt.text, /already answered \(q-001/);
});

test('answered, known-good: an open question, an unrelated one, a reason given, and no list at all pass', () => {
  const root = makeRoot();
  const card = (q) => pretool(ev({ tool: 'AskUserQuestion', input: { questions: [{ question: q }] } }), makeCtx(root));
  assert.equal(card('Which colour should the footer links take on the legal pages?'), null); // still open: asking is right
  assert.equal(card('Which font do you like for the menu?'), null);
  assert.equal(card('Your answer was your first name; on the legal pages for the person who runs the site, should the second site show it too?'), null);
  assert.deepEqual(stop(ev({ text: 'The legal pages show your first name, as you answered.' }), makeCtx(root)), { clear: ['never-twice'] });
  assert.equal(card('Which name goes on the legal pages as the person who runs the site?') === null, false); // control: the same root does catch it
  const none = makeRoot({ questions: null });
  assert.equal(pretool(ev({ tool: 'AskUserQuestion', input: { questions: [{ question: 'Which name goes on the legal pages as the person who runs the site?' }] } }), makeCtx(none)), null);
  assert.equal(answeredQuestions('not json').length, 0);
});

test('decisions are read in force first, then the history newest first; questions must be put to the person', () => {
  const lines = decisionLines(DECISIONS, IN_FORCE);
  assert.equal(lines[0].from, 'in force');
  assert.equal(lines[1].date, '2026-11-19');
  assert.equal(lines.at(-1).date, '2026-11-18');
  assert.deepEqual(directedQuestions('Is it done? Should I publish it?', ['should i']), ['Should I publish it?']);
});

// ---------- 2. stated and not saved ----------
test('unsaved, known-bad: a standing wish the person states, with nothing written to the notes in the same turn', () => {
  const root = makeRoot();
  const hisLast = 'When you give a progress bar, always use the designed bars with the percentage on it.';
  const ctx = makeCtx(root, { hisLast });
  const r = stop(ev({ text: 'Understood, I will do that from now on.' }), ctx);
  assert.ok(r.debt);
  assert.match(r.debt.text, /nothing was written to the notes/);
  assert.match(r.debt.text, /designed bars/);
  // It stays owed at the next reply, even when the next message is about something else.
  const ctx2 = { ...ctx, hisLast: 'ok, what next' };
  assert.ok(stop(ev({ text: 'Next is the menu.' }), ctx2).debt);
  // It is cleared once the note is written (and said).
  const ctx3 = { ...ctx, hisLast: 'go on', events: [{ tool: 'Edit', input: { file_path: path.join(root, 'system', 'preferences.md') } }] };
  assert.deepEqual(stop(ev({ text: 'Saved: the progress line is always the designed bars.' }), ctx3), { clear: ['never-twice'] });
});

test('unsaved, known-bad: a correction asked as a question still counts ("I told you")', () => {
  const ctx = makeCtx(makeRoot(), { hisLast: "Why didn't you stop before publishing? I told you I want to add a few things?" });
  assert.ok(stop(ev({ text: 'You are right, I stopped.' }), ctx).debt);
});

test('unsaved, known-good: a plain question, a wish saved in the same turn, and "Not a rule:"', () => {
  const root = makeRoot();
  assert.deepEqual(stop(ev({ text: 'It is 9 pm.' }), makeCtx(root, { hisLast: 'what time is it there?' })), { clear: ['never-twice'] });
  assert.deepEqual(stop(ev({ text: 'Maybe.' }), makeCtx(root, { hisLast: 'should we always ask first?' })), { clear: ['never-twice'] });
  const saved = makeCtx(root, { hisLast: 'From now on, ask with the question format.', events: [{ k: 'write', p: path.join(root, 'system', 'decisions.md') }] });
  assert.deepEqual(stop(ev({ text: 'Saved: questions go in the question format.' }), saved), { clear: ['never-twice'] });
  assert.deepEqual(stop(ev({ text: 'Fine.' }), makeCtx(root, { hisLast: 'Never mind, it is fine.' })), { clear: ['never-twice'] });
  assert.deepEqual(stop(ev({ text: 'Looking.' }), makeCtx(root, { hisLast: 'The old laptop always crashes at night.' })), { clear: ['never-twice'] });
  const notRule = makeCtx(root, { hisLast: 'Make sure you eat something, ha.' });
  assert.ok(stop(ev({ text: 'Ha, thanks.' }), notRule).debt); // caught: it has the shape of a wish
  assert.deepEqual(stop(ev({ text: 'Not a rule: a joke about lunch.' }), notRule), { clear: ['never-twice'] });
});

// ---------- 3. saved without saying so ----------
test('saved line, known-bad: the notes were written this turn and the reply does not say so', () => {
  const root = makeRoot();
  const ctx = makeCtx(root, { events: [{ tool: 'Write', input: { file_path: path.join(root, 'system', 'lessons.md') } }] });
  const r = stop(ev({ text: 'I fixed the menu and noted the lesson.' }), ctx);
  assert.ok(r.debt);
  assert.match(r.debt.text, /no "Saved: \.\.\." line/);
});

test('saved line, known-bad: a save by shell counts too', () => {
  const root = makeRoot();
  const ctx = makeCtx(root, { events: [{ tool: 'Bash', command: `echo "- 2026-11-20: x" >> ${root}/system/lessons.md` }] });
  assert.ok(stop(ev({ text: 'Done with the menu.' }), ctx).debt);
});

test('saved line, known-good: a "Saved:" line, a write outside the notes, and a helper\'s write', () => {
  const root = makeRoot();
  const a = makeCtx(root, { events: [{ tool: 'Write', input: { file_path: path.join(root, 'system', 'lessons.md') } }] });
  assert.deepEqual(stop(ev({ text: 'The menu works now.\n\nSaved: a lesson about the menu.' }), a), { clear: ['never-twice'] });
  const b = makeCtx(root, { events: [{ tool: 'Write', input: { file_path: path.join(root, 'app', 'menu.tsx') } }] });
  assert.deepEqual(stop(ev({ text: 'The menu is changed.' }), b), { clear: ['never-twice'] });
  const c = makeCtx(root, { events: [{ k: 'write', a: 'helper-1', p: path.join(root, 'system', 'lessons.md') }] });
  assert.deepEqual(stop(ev({ text: 'A helper is at work.' }), c), { clear: ['never-twice'] });
});

test('written paths are read from both shapes of the turn record', () => {
  const root = 'C:\\Notebook';
  assert.deepEqual(writtenPaths({ files: ['C:\\Notebook\\system\\rules.md'] }, root), ['system/rules.md']);
  assert.deepEqual(writtenPaths([{ tool: 'Read', input: { file_path: 'C:\\Notebook\\system\\rules.md' } }], root), []);
  // A shell read is not a save; a shell append is.
  assert.deepEqual(writtenPaths([{ tool: 'Bash', command: 'grep -n rule system/lessons.md 2>/dev/null | head' }], root), []);
  assert.deepEqual(writtenPaths([{ tool: 'PowerShell', command: 'Add-Content -Path system/preferences.md -Value "x"' }], root), ['system/preferences.md']);
});

// ---------- 4. lessons not closed by anything real ----------
test('lessons, known-bad: at the first message of a chat the owed lessons older than a day are said', () => {
  const ctx = makeCtx(makeRoot());
  const r = prompt(ev({ text: 'hello' }), ctx);
  assert.ok(r && r.say);
  assert.match(r.say, /2 lessons are older than a day/);
  assert.match(r.say, /approval prompt/);
  assert.match(r.say, /public page for the reader first/);
  assert.doesNotMatch(r.say, /A lesson of today/); // not older than a day
  assert.doesNotMatch(r.say, /backing up/); // closed by a file that exists
});

test('lessons, known-good: said once per chat, and nothing when every lesson is closed', () => {
  const ctx = makeCtx(makeRoot());
  prompt(ev({ text: 'hello' }), ctx);
  assert.equal(prompt(ev({ text: 'and now?' }), ctx), null);
  const closed = makeCtx(makeRoot({ lessons: '# Lessons\n\n- Backups. closed_by: core/gates/install.ps1 keeps copies\n' }));
  assert.equal(prompt(ev({ text: 'hello' }), closed), null);
});

test('lessons: on this notebook\'s own notes, the count agrees with the lessons program', () => {
  const real = fs.readFileSync(path.join(REAL_ROOT, 'system', 'lessons.md'), 'utf8');
  const day = '2026-11-21';
  const mine = owedLessons(real, REAL_ROOT, day, 1).length;
  const theirs = scan({ root: REAL_ROOT, today: day }).found.filter((l) => !l.date || l.date <= '2026-11-20').length;
  assert.equal(mine, theirs);
  console.log(`# this notebook: ${mine} lessons older than a day are not closed by anything real`);
});

// ---------- 5. the front door ----------
const LINK = 'https://example.com/templates/clean-shop/';
test('front door, known-bad: something the person sent is not in the list (debt at the reply)', () => {
  const ctx = makeCtx(makeRoot());
  prompt(ev({ text: `look at this one ${LINK}` }), ctx);
  const r = stop(ev({ text: 'It is a nice site.' }), { ...ctx, hisLast: `look at this one ${LINK}` });
  assert.ok(r.debt);
  assert.match(r.debt.text, /not in the list of what/);
});

test('front door, known-bad: the end of the work is refused while it is missing', () => {
  const ctx = makeCtx(makeRoot());
  prompt(ev({ text: `keep this ${LINK}` }), ctx);
  prompt(ev({ text: 'ok close' }), ctx); // a later message: the link is still owed for the end of the work
  const r = pretool(ev({ tool: 'Skill', input: { skill: 'hive-close' } }), ctx);
  assert.ok(r && r.deny);
  assert.match(r.deny, /example\.com/);
  const r2 = pretool(ev({ tool: 'Bash', command: 'git -C ~/notebook commit -m "Close: the session wrap-up"' }), ctx);
  assert.ok(r2 && r2.deny);
});

test('front door, known-good: logged things pass, reading is never stopped, other skills are not the end', () => {
  const root = makeRoot({ sources: `# What you sent\n- [ ] 2026-11-18 | a template | ${LINK} | waiting\n` });
  const ctx = makeCtx(root);
  prompt(ev({ text: `keep this ${LINK}` }), ctx);
  assert.equal(pretool(ev({ tool: 'Skill', input: { skill: 'hive-close' } }), ctx), null);
  assert.deepEqual(stop(ev({ text: 'It is kept in the list.' }), { ...ctx, hisLast: `keep this ${LINK}` }), { clear: ['never-twice'] });
  const open = makeCtx(makeRoot());
  prompt(ev({ text: `keep this ${LINK}` }), open);
  assert.equal(pretool(ev({ tool: 'Read', input: { file_path: 'x.md' } }), open), null);
  assert.equal(pretool(ev({ tool: 'Skill', input: { skill: 'hive-capture' } }), open), null);
  assert.equal(pretool(ev({ tool: 'Bash', command: 'git commit -m "Menu fix"' }), open), null);
});

test('front door: links and attached files are read; local addresses are not', () => {
  const items = sentItems('see https://example.com/a/ and C:\\Users\\x\\uploads\\1a2b3c4d-guide.pdf and http://localhost:3000', { ignoreHosts: ['localhost'] });
  assert.deepEqual(items.map((x) => x.key), ['example.com/a', 'guide']);
});

// ---------- helper chats ----------
test('a helper chat: the reply checks and the front door do not apply; nothing is said at its start', () => {
  const ctx = makeCtx(makeRoot(), { isHelperChat: true, hisLast: 'Always use the strongest model.' });
  assert.equal(stop(ev({ text: 'Should I go live now?' }), ctx), null);
  assert.equal(prompt(ev({ text: `Hive helper chat. ${LINK}` }), ctx), null);
  assert.equal(pretool(ev({ tool: 'Skill', input: { skill: 'hive-close' } }), ctx), null);
});

// ---------- its own error, and speed ----------
test('on its own error a discipline check lets the step through and logs the error', () => {
  const ctx = makeCtx(makeRoot(), { read: () => { throw new Error('disk gone'); } });
  assert.equal(stop(ev({ text: 'Should I go live now?' }), ctx), null);
  assert.equal(prompt(ev({ text: 'hello' }), ctx), null);
  assert.equal(pretool(ev({ tool: 'AskUserQuestion', input: { questions: [{ question: 'Publish now?' }] } }), ctx), null);
  assert.equal(ctx.logs.filter((l) => l.event === 'error').length, 3);
  assert.match(ctx.logs[0].detail.message, /disk gone/);
  assert.equal(stop(undefined, undefined), null); // no input at all: still let through
});

test('it is fast: each step under 50 ms on this notebook\'s real notes', () => {
  const ctx = makeCtx(REAL_ROOT, { hisLast: 'From now on always ask in the question format. ' + LINK, state: tmp('never-twice-speed-') });
  // The middle of nine runs, each as a new chat (so the prompt step does its first-message work every time): one
  // pause of the computer (other programs, memory clean-up) must not decide the result, a slow step must.
  const time = (fn) => { const runs = []; for (let i = 0; i < 9; i++) { const t = process.hrtime.bigint(); fn(i); runs.push(Number(process.hrtime.bigint() - t) / 1e6); } return runs.sort((a, b) => a - b)[4]; };
  const p = time((i) => prompt(ev({ session_id: `speed-${i}`, text: ctx.hisLast }), ctx));
  const q = time((i) => pretool(ev({ session_id: `speed-${i}`, tool: 'AskUserQuestion', input: { questions: [{ question: 'Should I publish now?' }] } }), ctx));
  const s = time((i) => stop(ev({ session_id: `speed-${i}`, text: 'The work is built. Should I go live now? '.repeat(20) }), ctx));
  for (const [name, ms] of [['prompt', p], ['pretool', q], ['stop', s]]) assert.ok(ms < 50, `${name} took ${ms.toFixed(1)} ms`);
});
