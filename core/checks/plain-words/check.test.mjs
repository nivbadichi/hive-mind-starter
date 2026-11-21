// node --test core/checks/plain-words/check.test.mjs
// Every behaviour has a known-bad case (caught) and a known-good case (passes): the bad cases are the kinds of reply
// people reject (too long, labels and fragments, hard words, file names, inside words); the good cases are plain.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import check, * as pw from './check.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SETTINGS = JSON.parse(fs.readFileSync(path.join(HERE, 'settings.json'), 'utf8'));
const logs = [];
const ctx = (ask = '', more = {}) => ({ hisLast: ask, settings: SETTINGS, isHelperChat: false, loaded: [], log: (e, d) => logs.push([e, d]), ...more });
const run = (reply, ask = '', more = {}) => check.steps.stop({ text: reply }, ctx(ask, more));
const faults = (reply, ask = '', skills = []) => pw.faultsOf(reply, ask, SETTINGS, skills);
const has = (list, word) => list.some((f) => f.includes(word));

// A plain reply: whole sentences, why, one question.
const PLAIN = 'I built the check that reads my replies to you. It notes a reply that is too long or hard to read, and one that uses a word you may not know. I could not try it in a live chat yet, because the part that runs all the checks is still being made. Do you want it switched on as soon as that part is ready?';

test('the module has the contract shape', () => {
  assert.equal(check.id, 'plain-words');
  assert.equal(check.id, path.basename(HERE));
  assert.equal(check.rule, 'rule 6');
  assert.equal(check.kind, 'discipline');
  assert.equal(check.mode, 'refuse');
  assert.equal(typeof check.about, 'string');
  assert.equal(typeof check.steps.stop, 'function');
});

test('a plain reply passes and clears the debt', () => {
  assert.deepEqual(faults(PLAIN), []);
  assert.deepEqual(run(PLAIN), { clear: ['plain-words'] });
});

// ---------- 1. length ----------
// A status answer that went on and on.
const LONG = Array.from({ length: 14 }, (_, i) => `Part ${i + 1} of the work moved on today, and I checked it before I wrote this line to you.`).join(' ');
test('length: a long reply to a short question is a debt', () => {
  const r = run(LONG, 'where are we?');
  assert.ok(r.debt, 'expected a debt');
  assert.equal(r.debt.key, 'plain-words');
  assert.match(r.debt.text, /words, where a reply is at most 150/);
});
test('length: a short reply passes', () => {
  assert.ok(!has(faults(PLAIN, 'where are we?'), 'words, where'));
});
test('length: a recap they asked for is not flagged for length', () => {
  const recap = Array.from({ length: 40 }, (_, i) => `On day ${i + 1} we made one rule hold by itself, and you can see it on your page.`).join(' ');
  assert.ok(pw.countWords(recap) > 600);
  assert.ok(!has(faults(recap, 'give me the full recap of the day'), 'words, where'));
  assert.ok(!has(faults(recap, 'recap please'), 'words, where'));
  assert.ok(has(faults(recap, 'how is it going'), 'words, where'), 'the same text without their ask is too long');
});
test('length: the progress bars and the Saved: line are not counted', () => {
  const bars = 'Making the rules hold: 3 of 10 steps\n██████░░░░░░░░░░░░░░  30%  overall\n\n' + Array.from({ length: 20 }, (_, i) => `Check ${i + 1}\n██████████░░░░░░░░░░  50%  in work`).join('\n');
  const reply = bars + '\n\n' + PLAIN + '\nSaved: ' + 'the new rule about short answers, '.repeat(20);
  assert.ok(!has(faults(reply), 'words, where'));
});

// ---------- 2. whole sentences ----------
// A reply under 150 words with a progress map that still reads like a status report: bold labels, clipped
// fragments, inside words, a line listing tools.
const STATUS_REPORT = `[ Plan ✓ ] [ Build ✓ ] ► [ Verify ]
**Status:** wave 2 merged.
**Starter:** synced, 23/23 green.
**Next:** E5 hook wiring, then deploy.
Tools: hive-scout, playwright-cli, ui-radar.`;
test('sentences: a status-report reply is caught on every count', () => {
  const f = faults(STATUS_REPORT);
  assert.ok(has(f, 'label or a fragment'), 'labels');
  assert.ok(has(f, 'words they may not know'), 'inside words');
  const words = pw.insideWords(pw.proseOf(STATUS_REPORT), '', SETTINGS.insideWords, []);
  assert.ok(has(words, '"starter"'), 'the inside word starter');
  assert.ok(has(words, '"e5"'), 'a work code');
  assert.ok(has(words, 'hive-scout'), 'a skill name');
});
test('sentences: fragment bullets and a table are caught', () => {
  assert.ok(has(faults('Here is where it stands.\n- gates fixed\n- site rebuilt\n- tests pass'), 'label or a fragment'));
  assert.ok(has(faults('Here is where it stands.\n\n| Part | State |\n|---|---|\n| Site | built |\n\n## Next\nI will check it tonight.'), 'label or a fragment'));
});
test('sentences: whole sentences, a colon inside a sentence, and one list of sentences pass', () => {
  const ok = 'Here is the plan for tonight: first I fix the bar, then I show it to you.\n- I fixed the colours on your phone, because some text was black on black.\n- I checked every screen again after the fix, and all of them read well now.';
  assert.ok(!has(faults(ok), 'label or a fragment'));
});
test('sentences: a sitrep, the sitrep shape, is not read as labels', () => {
  const sitrep = 'The rule checks are coming along well.\nThe plain-reply check: done. It now reads every reply to you.\nThe safety lock: in work. It will stop risky steps before they run.\nNeeds you: nothing today.';
  assert.ok(!has(faults(sitrep, 'sitrep'), 'label or a fragment'));
});

// The status report as it really comes out: the bars as the progress program prints them, then whole lines in
// the sitrep shape. It must pass as it is, asked or not, with the bars in a fixed-width block or pasted bare.
const BARS = 'Your first project: everything you asked for: 6 of 12 steps\n██████████░░░░░░░░░░  50%  overall\n\nThe new page\n█████████████░░░░░░░  66%  in work\nThe weekly plan\n█████░░░░░░░░░░░░░░░  25%  in work';
const SITREP_LINES = 'One of your two requests is nearly finished.\nThe new page: being worked on. It should be ready tonight.\nThe weekly plan: not started. It comes after the page.\nNeeds you: nothing.';
test('the status report: its bars and its lines pass as they are', () => {
  assert.deepEqual(run('```\n' + BARS + '\n```\n' + SITREP_LINES, 'sitrep'), { clear: ['plain-words'] });
  assert.deepEqual(faults('```\n' + BARS + '\n```\n' + SITREP_LINES, 'go on'), []);
  assert.deepEqual(faults(BARS + '\n\n' + SITREP_LINES, 'how far are we'), []);
  // The same lines without the sitrep shape (no "Needs you:" line, not asked) are labels, and are caught.
  assert.ok(has(faults('**Page:** in work\n**Plan:** not started\n**Next:** the page', 'go on'), 'label or a fragment'));
});

// ---------- 3. reading ease ----------
const DENSE = 'Implementation consolidated: the enforcement architecture\'s discipline-category verification modules systematically evaluate conversational output characteristics, including syllabic density, orthographic complexity and terminological accessibility, generating obligations propagated asynchronously through the persistence infrastructure for subsequent remediation.';
test('reading ease: a dense reply is a debt', () => {
  assert.ok(has(faults(DENSE), 'hard to read'));
  assert.ok(pw.readingEase(DENSE) < 50);
});
test('reading ease: a plain reply passes', () => {
  assert.ok(pw.readingEase(PLAIN) >= 50, String(pw.readingEase(PLAIN)));
  assert.ok(!has(faults(PLAIN), 'hard to read'));
});
test('reading ease: the count is the same as the manuals\' checker', async () => {
  const other = path.resolve(HERE, '..', '..', '..', 'starter', 'docs', 'tools', 'check-manuals.mjs');
  const alt = path.resolve(HERE, '..', '..', '..', 'docs', 'tools', 'check-manuals.mjs');
  const file = fs.existsSync(other) ? other : fs.existsSync(alt) ? alt : null;
  if (!file) return; // not in this copy
  const m = await import(pathToFileURL(file).href);
  for (const t of [PLAIN, DENSE, LONG]) assert.equal(pw.readingEase(t), m.readingEase(t));
});

// ---------- 4. file names and code ----------
test('code: file names, paths and code they did not ask for are a debt', () => {
  const r = 'I changed the reply check in core/gates/gates.mjs and ran `node --test` on it, so it works now for you.';
  assert.ok(has(faults(r), 'file names or code'));
  assert.ok(has(faults('The settings live in C:\\Users\\me\\notes, so I changed them there today.'), 'file names or code'));
});
test('code: allowed when their message asks for the file or the command', () => {
  const r = 'I changed the reply check in core/gates/gates.mjs and ran `node --test` on it, so it works now for you.';
  assert.ok(!has(faults(r, 'which file did you change?'), 'file names or code'));
  assert.ok(!has(faults(r, 'show me the command'), 'file names or code'));
});
test('code: a date with slashes and a web address are not paths', () => {
  assert.ok(!has(faults('I will look at it again on 21/11/2026, and the page is at https://example.com/a/b for you.'), 'file names or code'));
});

// ---------- 5. inside words ----------
// An inside word nobody explained.
test('inside words: "the starter" left unexplained is a debt', () => {
  const f = faults('I updated the starter so new people get the fix too, and nothing else changed today.');
  assert.ok(has(f, '"starter" (say: the empty copy of Hive Mind for a new person)'));
});
test('inside words: explained, said plainly, or their own word passes', () => {
  assert.deepEqual(faults('I updated the starter (the empty copy of Hive Mind for new people) so they get the fix too.'), []);
  assert.deepEqual(faults('I updated the empty copy of Hive Mind for a new person, so they get the fix too.'), []);
  assert.deepEqual(faults('I updated the starter, so new people get the fix too.', 'did you update the starter?'), []);
});
test('inside words: skill names, work codes and the newer words are caught', () => {
  assert.ok(has(faults('I ran hive-scout before the design, so the picks are fresh.'), 'hive-scout'));
  assert.ok(has(faults('I ran the scouting step, then playwright-cli checked it.', '', ['playwright-cli']), 'playwright-cli'));
  assert.ok(has(faults('W14 is finished, so you can read it tonight.'), '"w14"'));
  assert.ok(has(faults('There is one debt left from the last reply, so I will fix it now.'), '"debt"'));
});
test('inside words: every word of the gates\' old list was taken over', () => {
  const g = path.resolve(HERE, '..', '..', 'gates', 'settings.json');
  if (!fs.existsSync(g)) return;
  const old = (JSON.parse(fs.readFileSync(g, 'utf8')).plainWords || {}).words || {};
  for (const w of Object.keys(old)) assert.ok(w in SETTINGS.insideWords.words, `missing: ${w}`);
});

// ---------- found in review ----------
test('review: product names and ordinary hyphen words are not faults', () => {
  assert.deepEqual(faults('The site is built with Next.js, and that choice is data-driven and well tested by many people.'), []);
  assert.ok(has(faults('I changed the page in app.js today, so the colours are right now.'), 'file names or code'));
});

// ---------- where it does not run ----------
test('a chat started by another chat is not held to this (its reader is a Claude)', () => {
  assert.equal(run(STATUS_REPORT, '', { isHelperChat: true }), null);
});
test('an empty reply is not judged', () => {
  assert.equal(run('   '), null);
});

// ---------- its own error ----------
test('on its own error it lets the reply through and logs (a discipline check)', () => {
  logs.length = 0;
  const broken = { ...SETTINGS, insideWords: { ...SETTINGS.insideWords, get words() { throw new Error('bad list'); } } };
  assert.equal(run(STATUS_REPORT, '', { settings: broken }), null);
  assert.equal(logs.length, 1);
  assert.equal(logs[0][0], 'error');
  assert.match(logs[0][1], /bad list/);
  // A broken log does not turn the error into a stop either.
  assert.equal(check.steps.stop({ text: STATUS_REPORT }, { ...ctx(), settings: broken, log() { throw new Error('no log'); } }), null);
  assert.equal(check.steps.stop(null, null), null);
});

// ---------- speed ----------
test('it is fast: under 50 ms for one reply', () => {
  const big = (STATUS_REPORT + '\n' + PLAIN + '\n' + DENSE + '\n').repeat(10);
  check.steps.stop({ text: big }, ctx('sitrep'));
  const t0 = performance.now();
  for (let i = 0; i < 10; i++) check.steps.stop({ text: big }, ctx());
  const each = (performance.now() - t0) / 10;
  assert.ok(each < 50, `${each.toFixed(1)} ms`);
});
