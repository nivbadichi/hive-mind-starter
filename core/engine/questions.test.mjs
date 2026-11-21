// Tests for the list of questions for him: node --test core/engine/questions.test.mjs
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as Q from './questions.mjs';

const PROG = fileURLToPath(new URL('./questions.mjs', import.meta.url));
let root, state;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-root-'));
  state = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-state-'));
  fs.mkdirSync(path.join(root, 'system'));
  fs.writeFileSync(path.join(root, 'system', 'decisions-in-force.md'),
    '# Decisions in force\n\n- The headline is "An exoskeleton for your mind." with the line under it; no headline names Claude.\n- Money: every spend is authorised by the user.\n');
  process.env.HIVE_ROOT = root; process.env.HIVE_STATE = state;
  process.env.HIVE_DATE = '2026-11-19'; process.env.HIVE_NOW = '2026-11-19T20:00';
});
const run = (...a) => { try { return { out: execFileSync(process.execPath, [PROG, ...a], { env: process.env, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }), code: 0 }; } catch (e) { return { out: (e.stdout || '') + (e.stderr || ''), code: e.status }; } };
const runIn = (input, ...a) => { try { return { out: execFileSync(process.execPath, [PROG, ...a], { env: process.env, encoding: 'utf8', input, stdio: ['pipe', 'pipe', 'pipe'] }), code: 0 }; } catch (e) { return { out: (e.stdout || '') + (e.stderr || ''), code: e.status }; } };

// ---- the three made-up reports of the brief ----
const WITH = `1. Made: the thing, in core/x.
2. Skills loaded: none.
8. Questions for the owner:
   - Should the page say "free" on the front, or leave the price out?
   - May the checker use a throwaway GitHub account?
9. Model: Sonnet 5.5.`;
const NONE = `1. Made: the manuals.\n8. Questions for you: none.\n9. Model: Opus 5.5.`;
const REVERSE = `Report.\nQuestions for the owner: should we switch the headline from "An exoskeleton for your mind" to "Never explain yourself twice"? 10. Model: Opus.`;

test('a report with questions: each goes in as new, not sorted', () => {
  const r = Q.ingest(WITH, 'helper X');
  assert.equal(r.added.length, 2);
  assert.ok(r.added.every((q) => q.kind === 'new' && q.state === 'open' && q.raised_by === 'helper X'));
  assert.match(r.added[0].text, /free/);
});
test('a report that says none adds nothing', () => {
  assert.equal(Q.ingest(NONE, 'helper Y').added.length, 0);
  assert.equal(Q.load().questions.length, 0);
});
test('a question that reverses a saved decision is marked as touching it, and cannot be decided or dropped', () => {
  const [q] = Q.ingest(REVERSE, 'helper Z').added;
  assert.ok(q.touches && /exoskeleton/.test(q.touches));
  assert.throws(() => Q.decide(q.id, { what: 'keep', why: 'x', undo: 'y' }), /may reverse a decision he made/);
  assert.throws(() => Q.drop(q.id, 'not his'), /may reverse a decision he made/);
  Q.sort(q.id, 'A'); assert.equal(Q.load().questions[0].kind, 'A');
});
test('the same question twice is added once, and an answered one is not asked again', () => {
  Q.ingest(WITH, 'a'); const again = Q.ingest(WITH, 'b');
  assert.equal(again.added.length, 0); assert.equal(again.already.length, 2);
  Q.answer('q-002', { words: 'No throwaway accounts.' });
  const third = Q.ingest(WITH, 'c');
  assert.equal(third.already.find((q) => q.id === 'q-002').answer.words, 'No throwaway accounts.');
});

// ---- reading the real shapes helpers used on 2026-11-19 ----
test('parses every heading wording seen today', () => {
  const cases = [
    ['Questions for the owner: (a) What contact address? (b) Which name should appear? 9. Model: Sonnet.', 2],
    ['Questions for the owner: keep or drop the bracket cursor; may we recreate Kawai patterns in our own code; keep OriginKit as ideas only. I also read me/taste files.', 3],
    ['**Questions for the owner.** First, when should the proof go from warn to refuse? It is warn now. Second, should check.ps1 run the tests?\n  12. **Model:** Opus.', 2],
    ['QUESTIONS FOR THE OWNER\n  1. Should the 90 skills stay?\n  2. Should the 16 be removed?\n\n  Model: Sonnet.', 2],
    ['Questions for him:\n     (a) Keep the headline?\n     (b) Is "Start yours" right?\n  10. Model: Opus.', 2],
    ['Question for the owner: is about 5 s per edit acceptable, or should lint move to the end of the turn?\n  12. Model: Opus.', 1],
    ['For the owner: the main gates.mjs has the same bug. It was out of scope; should it get the same fix? Also, an older copy stays silent.\n  9. Model: Opus.', 1],
    ['Questions for the owner (ten, one topic each, ready to ask):\n   - the sign-in choice;\n   - push and offline for later.\n  12. Model: Sonnet.', 2],
    ['Questions for you: whether to accept the label for docs; whether Shopify and Stripe stay in small business.\n  13. Model: Sonnet.', 2],
  ];
  for (const [t, n] of cases) assert.equal(Q.parseQuestions(t).length, n, t);
});
test('a sentence that only mentions questions is not a heading', () => {
  assert.equal(Q.parseQuestions('8. Questions for the owner, one topic each, ready to ask in the question format.\n9. Which model did the work.').length, 0);
  assert.equal(Q.parseQuestions('I put the question for the owner in the note.').length, 0);
});

// ---- only his words close A and B ----
test('the lead may not decide or drop a question of kind A or B', () => {
  Q.add({ text: 'Which palette do you want for the site inside?', by: 't' }); Q.sort('q-001', 'B');
  Q.add({ text: 'Should the edit check run at the end of the turn?', by: 't' }); Q.sort('q-002', 'A');
  for (const id of ['q-001', 'q-002']) {
    assert.throws(() => Q.decide(id, { what: 'a', why: 'b', undo: 'c' }), /only his own words/i);
    assert.throws(() => Q.drop(id, 'x'), /his to answer/);
  }
  const r = run('decide', 'q-002', '--what', 'a', '--why', 'b', '--undo', 'c');
  assert.equal(r.code, 1); assert.match(r.out, /NEEDS\|/);
});
test('A is never moved down, and something public, paid or private cannot be filed as C or E', () => {
  Q.add({ text: 'Should the gate tests get a quick subset?', by: 't' }); Q.sort('q-001', 'A');
  assert.throws(() => Q.sort('q-001', 'B'), /never moved down/);
  Q.add({ text: 'Should a full undo also delete the gate log?', by: 't' });
  assert.throws(() => Q.decide('q-002', { what: 'yes', why: 'x', undo: 'y' }), /sort it A or B/);
  Q.add({ text: 'Is Hive Mind free for other people?', by: 't' });
  assert.throws(() => Q.drop('q-003', 'mine'), /his/);
  Q.reword('q-003', 'Should the page say yes?');
  assert.throws(() => Q.drop('q-003', 'mine'), /his/, 'rewording does not make it the lead\'s');
});
test('a builder note that only sounds like his can be dropped with a reason he sees; the check accepts it only with that reason', () => {
  Q.add({ text: 'The quiet script leaves the public release line unsaved until the next save.', by: 'h' });
  Q.drop('q-001', 'A builder fix.', 'It is about a file named public, not about what strangers read.');
  Q.render();
  assert.match(Q.renderPage(), /Look at this one: its words sound like yours\. Why it is not: It is about a file named public/);
  assert.ok(Q.check().every((l) => l.startsWith('OK')));
  const d = Q.load(); delete d.questions[0].not_his; Q.save(d); Q.render();
  assert.ok(Q.check().some((l) => /filed as E but touches what is his/.test(l)));
});
test('a cheap builder choice can be decided, with its undo, and he can overrule it', () => {
  Q.add({ text: 'Should the wire helper names stay invented?', by: 't' });
  assert.throws(() => Q.decide('q-001', { what: 'keep' }), /--undo/);
  const q = Q.decide('q-001', { what: 'Kept the invented names.', why: 'Example only.', undo: 'Rename them in one file.' });
  assert.equal(q.kind, 'C'); assert.equal(q.state, 'decided');
  assert.equal(Q.answer('q-001', { words: 'Use real ones.' }).state, 'answered');
  assert.throws(() => Q.answer('q-001', {}), /his own words/);
});

test('a lead decision moved up stays visible; reword keeps the helper words; merge folds one question asked twice', () => {
  Q.add({ text: 'Should the fonts be served by the site itself?', by: 'h' });
  Q.decide('q-001', { what: 'Served by the site.', why: 'No outside host.', undo: 'Load them from the maker.' });
  const up = Q.sort('q-001', 'B', 'strangers download them');
  assert.equal(up.state, 'open'); assert.equal(up.moved_from, 'C'); assert.equal(up.lead_had_decided, 'Served by the site.');
  Q.add({ text: 'Can he confirm "free"?', by: 'h' });
  Q.reword('q-002', 'Is Hive Mind free for other people?'); Q.sort('q-002', 'A');
  assert.equal(Q.load().questions[1].original, 'Can he confirm "free"?');
  Q.add({ text: 'Should the price be left off the page?', by: 'h' });
  assert.throws(() => Q.merge('q-003', 'q-999'), /No question/);
  Q.add({ text: 'Should the port change?', by: 'h' }); Q.drop('q-004', 'builder');
  assert.throws(() => Q.merge('q-003', 'q-004'), /his/);
  Q.merge('q-003', 'q-002');
  assert.match(Q.renderPage(), /Also asked as: Should the price be left off the page\?/);
  assert.match(Q.renderPage(), /I had decided this for you \(Served by the site\.\)/);
});

// ---- at each of his messages ----
test('prompt prints every open A word for word with ASK THESE NOW, until he answers', () => {
  Q.add({ text: 'Is Hive Mind free for other people?', kind: 'A', by: 'lead', why: 'The front page says free.', default: 'The word stays.' });
  Q.add({ text: 'Which palette?', kind: 'B', by: 'lead' });
  const p1 = Q.prompt();
  assert.match(p1, /ASK THESE NOW, before anything else in your reply/);
  assert.match(p1, /Is Hive Mind free for other people\?/);
  assert.doesNotMatch(p1, /Which palette/);
  Q.asked(['q-001']);
  assert.match(Q.prompt(), /still no answer/);
  Q.answer('q-001', { words: 'Yes, free.' });
  assert.equal(Q.prompt(), '');
});
test('a new question is to be sorted first, and is asked as A if it was not sorted by his next message', () => {
  Q.ingest(WITH, 'helper X');
  const p1 = Q.prompt();
  assert.match(p1, /SORT THESE/); assert.doesNotMatch(p1, /ASK THESE NOW/);
  const p2 = Q.prompt();
  assert.match(p2, /ASK THESE NOW/); assert.match(p2, /not sorted in time/); assert.match(p2, /HELD BACK/);
});
test('asked --reply marks what a reply really put to him', () => {
  Q.add({ text: 'What name goes on the legal pages?', kind: 'A', by: 'lead' });
  Q.add({ text: 'Is Hive Mind free for other people?', kind: 'A', by: 'lead' });
  const r = runIn('Two things first.\n1. What name goes on the legal pages?\nThe rest is going well.', 'asked', '--reply', '-');
  assert.match(r.out, /q-001/); assert.doesNotMatch(r.out, /q-002/);
});

// ---- reply faults ----
test('reply-check flags an A question announced as decided, and one held back', () => {
  Q.add({ text: 'Should a visitor see a made-up page of their own after Start yours?', kind: 'A', by: 'lead' });
  Q.prompt();
  const f = Q.replyFaults('Good progress. I decided the visitor sees a made-up page after Start yours; told to him in the recap.');
  assert.ok(f.some((l) => /ANNOUNCED AS DECIDED: \[q-001\]/.test(l)));
  const g = Q.replyFaults('The site build is moving. Nothing needs you.');
  assert.ok(g.some((l) => /HELD BACK: \[q-001\]/.test(l)));
  assert.deepEqual(Q.replyFaults('First: Should a visitor see a made-up page of their own after Start yours?'), []);
});

// ---- the line, the page, the check ----
test('the status line names the count and the first question', () => {
  assert.equal(Q.statusLine(), 'Needs you: nothing.');
  Q.add({ text: 'Is Hive Mind free for other people?', kind: 'A', by: 'lead' });
  Q.add({ text: 'Which palette?', kind: 'B', by: 'lead' });
  assert.equal(Q.statusLine(), 'Needs you: 2 questions (1 now, 1 before publishing), the first is: Is Hive Mind free for other people?');
});
test('check: an A never put to him is NEEDS YOU; an A older than the current work is NEEDS YOU; the page must match', () => {
  assert.match(Q.check()[0], /^OK\|No questions/);
  Q.add({ text: 'Is Hive Mind free for other people?', kind: 'A', by: 'lead' });
  let c = Q.check();
  assert.ok(c.some((l) => /^NEEDS\|The page for him/.test(l)));
  assert.ok(c.some((l) => /^NEEDS\|NEEDS YOU: \[q-001\].*never put to him/.test(l)));
  Q.asked(['q-001']); Q.render();
  c = Q.check(); assert.ok(c.every((l) => l.startsWith('OK')), c.join('\n'));
  process.env.HIVE_NOW = '2026-11-19T22:00'; Q.work('build the site');
  c = Q.check(); assert.ok(c.some((l) => /NEEDS YOU: \[q-001\].*before the current work/.test(l)));
  Q.answer('q-001', { words: 'Free.' }); Q.render();
  assert.ok(Q.check().every((l) => l.startsWith('OK')));
});
test('check flags a hand-edited list where an A was decided by the lead', () => {
  Q.add({ text: 'Is Hive Mind free for other people?', kind: 'A', by: 'lead' });
  const d = Q.load(); d.questions[0].state = 'decided'; Q.save(d); Q.render();
  assert.ok(Q.check().some((l) => /NEEDS\|.*decided by the lead/.test(l)));
});
test('an unsorted question older than one of his messages fails the check', () => {
  Q.ingest(NONE + '\n' + WITH, 'h'); Q.render(); Q.prompt(); Q.prompt();
  assert.ok(Q.check().some((l) => /not sorted before his next message/.test(l)));
});
test('the page lists every kind with why, default, undo and his words', () => {
  Q.add({ text: 'Is Hive Mind free for other people?', kind: 'A', by: 'lead', why: 'Strangers read it.', default: 'Stays.' });
  Q.add({ text: 'Should the wire names stay invented?', by: 'h' }); Q.decide('q-002', { what: 'Kept.', why: 'Example.', undo: 'Rename.' });
  Q.add({ text: 'Which Napkin did he mean?', by: 'h' }); Q.answer('q-003', { words: 'Pick the popular napkin', where: 'chat, 2026-11-19' });
  Q.add({ text: 'Should the port change?', by: 'h' }); Q.drop('q-004', 'A builder choice.');
  const md = Q.renderPage();
  for (const s of ['## A. Please answer now', 'If you do not answer: Stays.', 'To undo: Rename.', 'You said: "Pick the popular napkin"', 'Why dropped: A builder choice.', '4 in all']) assert.ok(md.includes(s), s);
});
test('command line: ingest from stdin, line, check exit code', () => {
  const r = runIn(WITH, 'ingest', '-', '--by', 'helper X');
  assert.match(r.out, /Added q-001/); assert.match(r.out, /Added q-002/);
  assert.match(runIn(NONE, 'ingest', '-', '--by', 'y').out, /No questions for him/);
  assert.match(run('line').out, /Needs you: 2 questions/);
  assert.equal(run('check').code, 0);
  run('add', '--text', 'Is Hive Mind free for other people?', '--kind', 'A', '--by', 'lead');
  const c = run('check'); assert.equal(c.code, 1); assert.match(c.out, /NEEDS YOU/);
});
