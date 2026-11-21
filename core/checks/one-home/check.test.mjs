// Tests for the one-home check (rule 8). Every behaviour has a known-bad case that must be caught and a
// known-good case that must pass. The three cases are the kinds of fault in README.md, "Three examples", on a made-up notebook. Run: node --test core/checks/one-home/check.test.mjs
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import check, { pretool, afterSave, addedLines } from './check.mjs';
import { scan, lines, clearCache, classify, factsIn, DEFAULTS } from './scan.mjs';

const TODAY = '2026-11-20';
const made = [];
after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });
const tempDir = (name) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), name)); made.push(d); return d; };

function notebook(files) {
  const root = tempDir('one-home-');
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  }
  clearCache();
  return root;
}
const ctxFor = (root, extra = {}) => {
  const logs = [];
  const ctx = { root, today: TODAY, settings: {}, log: (e, d) => logs.push([e, d]), read: (r) => fs.readFileSync(path.join(root, r), 'utf8'), ...extra };
  ctx.logs = logs;
  return ctx;
};
const write = (root, rel, content) => ({ tool: 'Write', input: { file_path: path.join(root, rel), content } });
const edit = (root, rel, old_string, new_string) => ({ tool: 'Edit', input: { file_path: path.join(root, rel), old_string, new_string } });

// A made-up in-flight note.
const IN_FLIGHT = [
  '# In flight', '', 'Updated: 2026-11-18.', '',
  '- A HOLD IS ON: nothing goes online until you say so.',
  '- STATE AT 2026-11-20, EARLY: the new page is built (gates 386 of 386, NOT yet online).',
  '',
].join('\n');
const START_HERE = ['# Start here', '', 'Last updated: 2026-11-18: the first page is live', '', '## Exact next step', '', 'Read the plan together.', ''].join('\n');
const RULES = ['# Rules', '', 'The 15 always-rules.', '', '1. Ask first.', ''].join('\n');

test('the module has the shape the contract asks for', () => {
  assert.equal(check.id, 'one-home');
  assert.equal(check.rule, 'rule 8');
  assert.equal(check.kind, 'discipline');
  assert.equal(check.mode, 'refuse');
  assert.equal(typeof check.about, 'string');
  assert.equal(typeof check.steps.pretool, 'function');
});

// ---- Case 1: an in-flight note stamped 2026-11-18 while it carries the state of 2026-11-20 ----
test('case 1, bad: a stamp behind the note\'s own lines is found by the whole-notebook run', () => {
  const root = notebook({ 'system/in-flight.md': IN_FLIGHT });
  const out = lines(scan(root, { today: TODAY }));
  assert.ok(out.some((l) => l.startsWith('NEEDS|system/in-flight.md says it was updated on 2026-11-18, but it speaks of 2026-11-20')), out.join('\n'));
});
test('case 1, good: a stamp that matches its newest line is not flagged', () => {
  const root = notebook({ 'system/in-flight.md': IN_FLIGHT.replace('Updated: 2026-11-18.', 'Updated: 2026-11-20.') });
  assert.deepEqual(scan(root, { today: TODAY }).stamps, []);
});
test('case 1, save: adding a 2026-11-20 line under a 2026-11-18 stamp is noted, not stopped', () => {
  const root = notebook({ 'system/in-flight.md': '# In flight\n\nUpdated: 2026-11-18.\n\n- one line\n' });
  const r = pretool(edit(root, 'system/in-flight.md', '- one line', '- one line\n- STATE AT 2026-11-20: two helpers joined.'), ctxFor(root));
  assert.ok(r && r.say && /updated on 2026-11-18, but it speaks of 2026-11-20/.test(r.say), JSON.stringify(r));
  assert.equal(r.deny, undefined);
});
test('a date after today is a plan, not news, and does not make a stamp behind', () => {
  const root = notebook({ 'system/in-flight.md': 'Updated: 2026-11-20.\n\n- The name runs until 2027-11-18.\n' });
  assert.deepEqual(scan(root, { today: TODAY }).stamps, []);
});

// ---- Case 2: a count held in two notes with different values ----
test('case 2, bad: a save that writes the gate count into a second living note with another value is refused, the first home named', () => {
  const root = notebook({ 'system/in-flight.md': IN_FLIGHT, 'system/start-here.md': START_HERE });
  const r = pretool(edit(root, 'system/start-here.md', 'Read the plan together.', 'Read the plan together. The gates pass: gates 329 of 329.'), ctxFor(root));
  assert.ok(r && r.deny, JSON.stringify(r));
  assert.match(r.deny, /system\/in-flight\.md \(line 6\) says 386 of 386/);
  assert.match(r.deny, /two notes would disagree/);
});
test('case 2, bad: the same value written into a second living note is a second home, also refused', () => {
  const root = notebook({ 'system/in-flight.md': IN_FLIGHT, 'system/start-here.md': START_HERE });
  const r = pretool(edit(root, 'system/start-here.md', 'Read the plan together.', 'Gates 386 of 386.'), ctxFor(root));
  assert.ok(r && r.deny);
  assert.match(r.deny, /already has its home in system\/in-flight\.md/);
});
test('case 2, good: the same count in the log (history) passes, and so does a change in its own home', () => {
  const root = notebook({ 'system/in-flight.md': IN_FLIGHT.replace('Updated: 2026-11-18.', 'Updated: 2026-11-20.'), 'system/start-here.md': START_HERE, 'log/2026-11-20.md': '# Log\n' });
  assert.equal(pretool(write(root, 'log/2026-11-20.md', '# Log\n\n- gates 329 of 329 at noon.\n'), ctxFor(root)), null);
  assert.equal(pretool(edit(root, 'system/in-flight.md', 'gates 386 of 386', 'gates 401 of 401'), ctxFor(root)), null);
});
test('case 2, whole run: two living notes with different gate counts are listed with both places', () => {
  const root = notebook({ 'system/in-flight.md': IN_FLIGHT, 'system/start-here.md': START_HERE + '\nThe gates: gates 201 of 201.\n' });
  const d = scan(root, { today: TODAY }).differ.find((x) => x.key === 'gate-tests');
  assert.ok(d, 'the disagreement was not found');
  assert.deepEqual(d.places.map((p) => p.rel).sort(), ['system/in-flight.md', 'system/start-here.md']);
});
test('case 2, whole run good: a dated design note (history) with an older count is not a disagreement', () => {
  const root = notebook({ 'system/in-flight.md': IN_FLIGHT.replace('Updated: 2026-11-18.', 'Updated: 2026-11-20.'), 'system/design/review-2026-11-19.md': 'They pass: gates 329 of 329.\n' });
  const f = scan(root, { today: TODAY });
  assert.deepEqual(f.differ, []);
  assert.deepEqual(f.behind, []);
});
test('a living note left behind a newer dated note is listed', () => {
  const root = notebook({ 'system/start-here.md': 'Last updated: 2026-11-18\n\nThe gates: gates 201 of 201.\n', 'log/2026-11-19.md': '- gates 319 of 319.\n' });
  const b = scan(root, { today: TODAY }).behind;
  assert.equal(b.length, 1);
  assert.equal(b[0].newer, 'log/2026-11-19.md');
});

test('good: editing near a fact the note already stated, with the same value, is not stopped again', () => {
  const root = notebook({ 'system/in-flight.md': IN_FLIGHT, 'system/start-here.md': START_HERE + '\n- gates 386 of 386.\n' });
  assert.equal(pretool(edit(root, 'system/start-here.md', '- gates 386 of 386.', '- The tests: gates 386 of 386.'), ctxFor(root)), null);
  const bad = pretool(edit(root, 'system/start-here.md', '- gates 386 of 386.', '- gates 390 of 390.'), ctxFor(root));
  assert.ok(bad && bad.deny, 'a changed value in a second note must still be stopped');
});

// ---- Case 3: a project note pointing to a picture that was never saved ----
test('case 3, bad: a pointer to a missing file outside the notes check\'s folders is listed', () => {
  const root = notebook({ 'projects/my-shop/profile.md': '# Profile\n\n- The first look: `docs/first-look/home-page.png`.\n' });
  const out = lines(scan(root, { today: TODAY }));
  assert.ok(out.includes('NEEDS|projects/my-shop/profile.md line 3 points to docs/first-look/home-page.png, which does not exist.'), out.join('\n'));
});
test('case 3, good: the same pointer to a file that exists, or a line that says it is planned, passes', () => {
  const root = notebook({
    'projects/my-shop/profile.md': '# Profile\n\n- The first look: `docs/first-look/home-page.png`.\n- A new plan will be `docs/plan-later.md`.\n',
    'docs/first-look/home-page.png': 'x',
  });
  assert.deepEqual(scan(root, { today: TODAY }).missing, []);
});
test('a pointer inside the folders the notes check covers is left to it (not reported twice)', () => {
  const root = notebook({ 'system/start-here.md': 'Read `system/design/gone.md` first.\n' });
  assert.deepEqual(scan(root, { today: TODAY }).missing, []);
});
test('the save step notes any new pointer to a missing file, in every folder', () => {
  const root = notebook({ 'system/start-here.md': START_HERE });
  const r = pretool(edit(root, 'system/start-here.md', 'Read the plan together.', 'Read `system/design/gone.md` first.'), ctxFor(root));
  assert.ok(r && r.say && /system\/design\/gone\.md, which does not exist/.test(r.say), JSON.stringify(r));
});

// ---- A file called missing that exists ----
test('bad: a line that calls an existing file missing is listed; good: a line that only mentions what is owed is not', () => {
  const root = notebook({
    'system/in-flight.md': '- The plan `system/design/journey.md` does not exist yet.\n- Read `system/start-here.md` for what is owed.\n',
    'system/design/journey.md': '# Journey\n', 'system/start-here.md': '# Start\n',
  });
  const c = scan(root, { today: TODAY }).claimedMissing;
  assert.deepEqual(c.map((x) => x.target), ['system/design/journey.md']);
});

// ---- Review days ----
test('bad: a line past its own review day is listed; good: a review day still ahead is not', () => {
  const root = notebook({ 'system/capabilities.md': '- Vercel plugin, review by 2026-11-19.\n- GSAP, review by 2026-12-01.\n' });
  const r = scan(root, { today: TODAY }).reviews;
  assert.deepEqual(r.map((x) => x.date), ['2026-11-19']);
});

// ---- The whole-notebook run says its time ----
test('the whole-notebook list says how many notes it read and how long it took', () => {
  const root = notebook({ 'system/in-flight.md': 'Updated: 2026-11-20.\n', 'log/2026-11-20.md': '# Log\n' });
  const out = lines(scan(root, { today: TODAY }));
  assert.ok(out.some((l) => /^OK\|The one-home list read 2 notes \(1 of them living\) in \d+ ms\.$/.test(l)), out.join('\n'));
});

// ---- Homes named in the settings ----
test('bad: a truth with a named home written elsewhere is refused with the home named; good: written in its home it passes', () => {
  const root = notebook({ 'system/rules.md': RULES, 'system/start-here.md': START_HERE });
  const bad = pretool(edit(root, 'system/start-here.md', 'Read the plan together.', 'There are 15 rules.'), ctxFor(root));
  assert.ok(bad && bad.deny && /has one home, system\/rules\.md/.test(bad.deny), JSON.stringify(bad));
  assert.equal(pretool(edit(root, 'system/rules.md', 'The 15 always-rules.', 'The 16 always-rules.'), ctxFor(root)), null);
});

// ---- States ----
test('bad: a save that says the hold is lifted while another living note says it is on is refused', () => {
  const root = notebook({ 'system/in-flight.md': IN_FLIGHT, 'system/start-here.md': START_HERE });
  const r = pretool(edit(root, 'system/start-here.md', 'Read the plan together.', 'The hold is lifted.'), ctxFor(root));
  assert.ok(r && r.deny && /publish hold/.test(r.deny), JSON.stringify(r));
});
test('good: an ordinary save with no fact, and a save to code, pass untouched', () => {
  const root = notebook({ 'system/in-flight.md': IN_FLIGHT, 'system/start-here.md': START_HERE, 'core/x.mjs': '' });
  assert.equal(pretool(edit(root, 'system/start-here.md', 'Read the plan together.', 'Read the plan together, slowly.'), ctxFor(root)), null);
  assert.equal(pretool(write(root, 'core/x.mjs', '// gates 1 of 1\n'), ctxFor(root)), null);
  assert.equal(pretool({ tool: 'Read', input: { file_path: path.join(root, 'system/in-flight.md') } }, ctxFor(root)), null);
});

// ---- A count the settings do not name is only noted ----
test('a count the settings do not name, doubled, is noted but not refused', () => {
  const root = notebook({ 'system/in-flight.md': '- remote tests 20 of 20.\n', 'system/start-here.md': START_HERE });
  const r = pretool(edit(root, 'system/start-here.md', 'Read the plan together.', 'Remote tests 19 of 20.'), ctxFor(root));
  assert.ok(r && r.say && !r.deny, JSON.stringify(r));
});

// ---- Helpers ----
test('afterSave applies Write, Edit, replace_all and MultiEdit; addedLines finds only new lines', () => {
  assert.equal(afterSave('Write', { content: 'a' }, 'b'), 'a');
  assert.equal(afterSave('Edit', { old_string: 'x', new_string: 'y' }, 'x x'), 'y x');
  assert.equal(afterSave('Edit', { old_string: 'x', new_string: 'y', replace_all: true }, 'x x'), 'y y');
  assert.equal(afterSave('MultiEdit', { edits: [{ old_string: 'a', new_string: 'b' }, { old_string: 'b', new_string: 'c' }] }, 'a'), 'c');
  assert.equal(afterSave('Edit', { old_string: 'zz', new_string: 'y' }, 'x'), null);
  assert.deepEqual(addedLines('a\nb', 'a\nb\nc'), ['c']);
});
test('classify: logs and dated notes are history, the top notes and project notes are living, private folders are never read', () => {
  assert.equal(classify('log/2026-11-19.md').kind, 'history');
  assert.equal(classify('system/design/review-2026-11-19.md').date, '2026-11-19');
  assert.equal(classify('system/in-flight.md').kind, 'living');
  assert.equal(classify('projects/hive-mind/state.md').kind, 'living');
  assert.equal(classify('system/lessons.md').kind, 'history');
  assert.equal(classify('me/context-map.md'), null);
  assert.equal(classify('archive/x.md'), null);
});
test('factsIn reads a registered fact and a plain count', () => {
  const f = factsIn('gates 386 of 386 and the snapshot 17 of 17');
  assert.deepEqual(f.map((x) => [x.key, x.value]), [['gate-tests', '386 of 386'], ['count: snapshot', '17 of 17']]);
});

// ---- Error behaviour (discipline: let through, and log) ----
test('on its own error the check lets the save through and writes the error to the log', () => {
  const root = notebook({ 'system/in-flight.md': IN_FLIGHT, 'system/start-here.md': START_HERE });
  const ctx = ctxFor(root, { settings: { ...DEFAULTS, plannedWords: '(' } });
  const r = check.steps.pretool(edit(root, 'system/start-here.md', 'Read the plan together.', 'Gates 386 of 386.'), ctx);
  assert.equal(r, null);
  assert.ok(ctx.logs.some(([e, d]) => e === 'error' && d.check === 'one-home'), JSON.stringify(ctx.logs));
});

// ---- Speed ----
function bigNotebook() {
  const files = { 'system/in-flight.md': IN_FLIGHT, 'system/start-here.md': START_HERE, 'system/rules.md': RULES };
  for (let i = 0; i < 40; i++) files[`projects/p${i}/state.md`] = `---\nupdated: 2026-11-18\n---\n\n- the snapshot ${i} of 40 and gates 300 of 300.\n`.repeat(5);
  return notebook(files);
}
// The speed tests measure the code, not the machine: each step runs RUNS times and the fastest run is judged,
// so a busy machine (many chats at once) does not fail them.
const RUNS = 7;
function fastest(fn) {
  let best = Infinity;
  for (let i = 0; i < RUNS; i++) { const t0 = performance.now(); fn(); best = Math.min(best, performance.now() - t0); }
  return best;
}
// Every gate call is a fresh program: the ordinary call finds the facts of unchanged notes kept in the state folder.
test('speed: an ordinary save that states a fact (a new gate call, facts kept from before) takes under 50 ms', () => {
  const root = bigNotebook();
  const state = tempDir('one-home-state-');
  const ev = edit(root, 'system/start-here.md', 'Read the plan together.', 'Read the plan together. Gates 386 of 386.');
  check.steps.pretool(ev, ctxFor(root, { state })); // an earlier call kept the facts
  const ms = fastest(() => {
    clearCache(); // a new program
    assert.ok(check.steps.pretool(ev, ctxFor(root, { state })).deny);
  });
  assert.ok(ms < 50, `the fastest of ${RUNS} runs took ${ms.toFixed(1)} ms`);
});
test('speed: a save that states no fact takes under 50 ms; a full rebuild of the kept facts stays under 250 ms', () => {
  const root = bigNotebook();
  const ev = edit(root, 'system/start-here.md', 'Read the plan together.', 'Read the plan together. Gates 386 of 386.');
  check.steps.pretool(ev, ctxFor(root)); // files written a moment ago are slow to read once on Windows (the virus scanner)
  const plainEv = edit(root, 'system/start-here.md', 'Read the plan together.', 'Read the plan together, slowly.');
  const plain = fastest(() => { clearCache(); assert.equal(check.steps.pretool(plainEv, ctxFor(root)), null); });
  const rebuild = fastest(() => { clearCache(); assert.ok(check.steps.pretool(ev, ctxFor(root)).deny); });
  assert.ok(plain < 50, `a save with no fact took ${plain.toFixed(1)} ms at its fastest of ${RUNS}`);
  assert.ok(rebuild < 250, `a full rebuild took ${rebuild.toFixed(1)} ms at its fastest of ${RUNS}`);
});
test('the facts of unchanged notes are kept in the state folder and used by the next gate call', () => {
  const root = notebook({ 'system/in-flight.md': IN_FLIGHT, 'system/start-here.md': START_HERE });
  const state = tempDir('one-home-state-');
  const ev = edit(root, 'system/start-here.md', 'Read the plan together.', 'Gates 386 of 386.');
  assert.ok(pretool(ev, ctxFor(root, { state })).deny);
  assert.ok(fs.existsSync(path.join(state, 'one-home-index.json')));
  clearCache(); // as if a new program started
  fs.writeFileSync(path.join(root, 'system/in-flight.md'), IN_FLIGHT.replace('gates 386 of 386', 'no count here'));
  const r = pretool(ev, ctxFor(root, { state }));
  assert.ok(!r || !r.deny, 'a changed note must be read again, not taken from the kept facts');
});
