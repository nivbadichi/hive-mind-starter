// Tests of the understand-first check (rule 4). Run: node --test core/checks/understand-first/check.test.mjs
// Every behaviour has a known-bad case (caught) and a known-good case (passes). All on a made-up notebook and home.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import check, { proofMissing, approvalProblem, shellWrites, unlocks } from './check.mjs';
import settings from './settings.json' with { type: 'json' };

const pretool = check.steps.pretool;
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'uf-home-'));
const ROOT = path.join(HOME, 'notebook');
const P = (...a) => path.join(HOME, ...a);

function state(name, lines) {
  fs.mkdirSync(path.join(ROOT, 'projects', name), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'projects', name, 'state.md'), `---\n${lines.join('\n')}\n---\n\n# ${name}\n`);
}
// Made-up projects, one at each kind of stage.
state('my-notebook', ['project: My notebook', 'folder: ~/notebook', 'stage: build (first version)', 'plan_approved: 2026-11-14']);
state('course', ['project: Course', 'folder: ~/course', 'stage: discover (not started)']);
state('oldapp', ['project: OldApp', 'folder: ~/OldApp', 'stage: paused (frozen for now)', 'plan_approved: 2026-10-01']);
state('noplan', ['project: No plan', 'folder: ~/noplan', 'stage: build']);
state('pending', ['project: Pending', 'folder: ~/pending', 'stage: build', 'plan_approved: pending their look']);
state('nodate', ['project: No date', 'folder: ~/nodate', 'stage: build', 'plan_approved: yes']);
state('future', ['project: Future', 'folder: ~/future', 'stage: build', 'plan_approved: 2099-01-01']);
state('oddstage', ['project: Odd', 'folder: ~/odd', 'stage: building things', 'plan_approved: 2026-11-01']);
state('nofolder', ['project: Side project', 'stage: design']);

function ctx(hisLast = 'carry on', extra = {}) {
  const cache = new Map();
  const logs = [];
  return {
    root: ROOT, home: HOME, state: P('.hive'), hisLast, isHelperChat: false, loaded: [], events: [], settings: {}, today: '2026-11-20', logs,
    said: (re) => (re instanceof RegExp ? re : new RegExp(re, 'i')).test(hisLast),
    read: (rel) => { if (!cache.has(rel)) { try { cache.set(rel, fs.readFileSync(path.join(ROOT, rel), 'utf8')); } catch { cache.set(rel, null); } } return cache.get(rel); },
    log: (event, detail) => logs.push({ event, detail }),
    ...extra,
  };
}
const write = (file, content = 'x') => ({ tool: 'Write', input: { file_path: file, content }, cwd: ROOT });
const edit = (file, o, n) => ({ tool: 'Edit', input: { file_path: file, old_string: o, new_string: n }, cwd: ROOT });
const shell = (command, cwd = ROOT, tool = 'Bash') => ({ tool, input: { command }, command, cwd });
const denied = (r) => !!(r && r.deny);

// ---------- 1. code before an approved plan ----------
test('the shape follows the contract', () => {
  assert.equal(check.id, 'understand-first');
  assert.equal(check.rule, 'rule 4');
  assert.equal(check.kind, 'discipline');
  assert.equal(check.mode, 'refuse');
  assert.equal(typeof check.about, 'string');
  assert.equal(typeof pretool, 'function');
});

test('bad: code in a project at "discover" is refused (a project still exploring)', () => {
  const r = pretool(write(P('course', 'src', 'main.py')), ctx());
  assert.ok(denied(r));
  assert.match(r.deny, /discover/);
  assert.match(r.deny, /no plan_approved/);
});
test('bad: code in a paused project is refused, even with an old approval', () => {
  assert.ok(denied(pretool(edit(P('OldApp', 'app', 'page.tsx'), 'a', 'b'), ctx())));
});
test('bad: build stage with no plan_approved line is refused (the stage gate only reminded)', () => {
  const r = pretool(write(P('noplan', 'index.js')), ctx());
  assert.ok(denied(r));
  assert.match(r.deny, /no record/);
});
test('bad: plan_approved that says pending, holds no date, or a future date is refused', () => {
  assert.match(pretool(write(P('pending', 'a.ts')), ctx()).deny, /not an approval/);
  assert.match(pretool(write(P('nodate', 'a.ts')), ctx()).deny, /holds no date/);
  assert.match(pretool(write(P('future', 'a.ts')), ctx()).deny, /future/);
});
test('bad: a stage line that starts with no stage word is refused', () => {
  assert.match(pretool(write(P('odd', 'a.go')), ctx()).deny, /does not start with a stage word/);
});
test('good: code in a project at build with a dated approval passes', () => {
  assert.equal(pretool(write(P('notebook', 'core', 'checks', 'x', 'check.mjs')), ctx()), null);
  assert.equal(pretool({ tool: 'NotebookEdit', input: { notebook_path: P('notebook', 'a.ipynb') }, cwd: ROOT }, ctx()), null);
});
test('good: notes, note folders, built output and files outside every project pass', () => {
  assert.equal(pretool(write(P('course', 'README.md')), ctx()), null);
  assert.equal(pretool(write(P('course', 'node_modules', 'x', 'index.js')), ctx()), null);
  assert.equal(pretool(write(path.join(ROOT, 'projects', 'course', 'sketch.js')), ctx()), null);
  assert.equal(pretool(write(P('scratch', 'tool.mjs')), ctx()), null);
  assert.equal(pretool(write(P('course', 'data.json')), ctx()), null);
});
test('approvalProblem: a real date passes, the rest are named', () => {
  assert.equal(approvalProblem('2026-11-14', '2026-11-20'), '');
  assert.equal(approvalProblem('2026-11-20, their words "go"', '2026-11-20'), '');
  assert.notEqual(approvalProblem('', '2026-11-20'), '');
  assert.notEqual(approvalProblem('no', '2026-11-20'), '');
});

// ---------- 2. shell commands that write code ----------
test('bad: a shell redirect, a heredoc, a copy after cd, a PowerShell Set-Content into the discover project are refused', () => {
  assert.ok(denied(pretool(shell(`echo "print(1)" > ${P('course', 'a.py').replace(/\\/g, '/')}`), ctx())));
  assert.ok(denied(pretool(shell(`cat > src/b.mjs <<'EOF'\nconst a = 1 > 0;\nEOF`, P('course')), ctx())));
  assert.ok(denied(pretool(shell(`cd ${P('course').replace(/\\/g, '/')} && cp notes.txt src/c.js`), ctx())));
  assert.ok(denied(pretool(shell(`Set-Content -Path "${P('course', 'd.ps1')}" -Value 'x'`, ROOT, 'PowerShell'), ctx())));
  assert.ok(denied(pretool(shell(`sed -i 's/a/b/' src/e.ts`, P('course')), ctx())));
});
test('good: reading commands, quoted >, heredoc bodies and writes in the approved project pass', () => {
  assert.equal(pretool(shell(`grep -n ">" src/a.py`, P('course')), ctx()), null);
  assert.equal(pretool(shell(`node --test core/checks/understand-first/check.test.mjs 2>&1`), ctx()), null);
  assert.equal(pretool(shell(`cat > core/x.mjs <<'EOF'\nconst b = c > ${P('course', 'z.py').replace(/\\/g, '/')};\nEOF`), ctx()), null);
  assert.equal(pretool(shell(`echo x > /dev/null; ls ${P('course').replace(/\\/g, '/')}`), ctx()), null);
});
test('shellWrites reads what a command writes', () => {
  const w = shellWrites('tee out.js < in.txt | cat >> log.txt', '/w', '/h').map((x) => x.replace(/^[a-z]:/, ''));
  assert.deepEqual(w.sort(), ['/w/log.txt', '/w/out.js']);
});

// ---------- 3. Claude cannot approve its own plan ----------
const hsf = path.join(ROOT, 'projects', 'course', 'state.md');
test('bad: adding plan_approved to a state note without their yes is refused', () => {
  const r = pretool(edit(hsf, 'stage: discover', 'stage: discover\nplan_approved: 2026-11-20'), ctx('can you look at the course?'));
  assert.ok(denied(r));
  assert.match(r.deny, /Only the person approves/);
});
test('bad: moving the stage to build without their yes is refused, also by a whole-file Write and by sed', () => {
  assert.ok(denied(pretool(edit(hsf, 'stage: discover (not started)', 'stage: build'), ctx('what next?'))));
  assert.ok(denied(pretool(write(hsf, '---\nproject: Course\nstage: build\nplan_approved: 2026-11-20\n---\n'), ctx('hmm'))));
  assert.ok(denied(pretool(shell(`sed -i 's/^stage: discover/stage: build/' ${hsf.replace(/\\/g, '/')}`), ctx('hmm'))));
});
test('good: the same change after their yes passes; other edits to a state note pass', () => {
  assert.equal(pretool(edit(hsf, 'stage: discover', 'stage: discover\nplan_approved: 2026-11-20'), ctx('Yes, go ahead with that plan')), null);
  assert.equal(pretool(edit(hsf, '# course', '# Course course'), ctx('hmm')), null);
  const back = path.join(ROOT, 'projects', 'my-notebook', 'state.md');
  assert.equal(pretool(edit(back, 'stage: build (first version)', 'stage: plan (next round)'), ctx('hmm')), null);
});
test('a helper chat cannot approve: ctx.said sees only their own words', () => {
  const c = ctx('carry on', { said: () => false, hisLast: 'carry on' });
  assert.ok(denied(pretool(edit(hsf, 'stage: discover', 'plan_approved: 2026-11-20\nstage: discover'), c)));
});
test('unlocks names what changed', () => {
  assert.equal(unlocks('---\nstage: plan\n---', '---\nstage: build\n---', settings).length, 1);
  assert.equal(unlocks('---\nstage: build\nplan_approved: 2026-11-01\n---', '---\nstage: verify\nplan_approved: 2026-11-01\n---', settings).length, 0);
});

// ---------- 4. a helper brief with no proof part ----------
const GOOD_BRIEF = [
  'You are a helper. Read core/templates/build-brief.md.',
  '## How it will be proven',
  '- Today: rule 4 is held by a reminder only (the stage check is in notice mode).',
  '- Steps: reproduce real cases as failing tests; build the module; show it refuse and show it pass.',
  '- Must pass: `node --test core/checks/understand-first/check.test.mjs` and the starter\'s copy.',
  '- Files touched: core/checks/understand-first/**, starter/core/checks/understand-first/**. Out of scope: everything else.',
  '## 3. Skills to load', '- hive-gates', 'List in your report the skills you actually loaded.',
].join('\n');
const agent = (prompt, type = 'general-purpose', tool = 'Agent') => ({ tool, input: { prompt, description: 'x', subagent_type: type }, cwd: ROOT });

test('bad: a change brief with no proof part is refused, not noted (the ticket check was notice)', () => {
  const r = pretool(agent('Fix the bug in core/gates/gates.mjs. Read core/templates/build-brief.md. Skills: hive-gates.'), ctx());
  assert.ok(denied(r));
  assert.match(r.deny, /the part "How it will be proven"/);
});
test('bad: a brief that only mentions the heading in a sentence, or leaves the template\'s <...>, is refused', () => {
  assert.ok(denied(pretool(agent('Write the module. Skip How it will be proven for now.'), ctx())));
  const blank = GOOD_BRIEF.replace(/- Today: .*/, '- Today: <how to see the fault>').replace(/- Steps: .*/, '- Steps: TBD');
  assert.deepEqual(proofMissing(blank, settings), ['Today', 'Steps']);
});
test('bad: Must pass with no command, Files touched with no path, are refused', () => {
  const weak = GOOD_BRIEF.replace(/- Must pass: .*/, '- Must pass: it should look right').replace(/- Files touched: .*/, '- Files touched: whatever is needed');
  const m = proofMissing(weak, settings);
  assert.equal(m.length, 2);
  assert.ok(denied(pretool(agent(weak), ctx())));
});
test('bad: a brief the old check did not count as change work ("Make the hero nicer.") is refused', () => {
  assert.ok(denied(pretool(agent('Make the hero nicer.'), ctx())));
});
test('bad: a started helper chat with no proof part is refused too', () => {
  assert.ok(denied(pretool({ tool: 'mcp__ccd_session__start_session', input: { prompt: 'Build the page.' }, cwd: ROOT }, ctx())));
});
test('good: a full brief passes; read-only helpers pass', () => {
  assert.equal(pretool(agent(GOOD_BRIEF), ctx()), null);
  assert.equal(pretool(agent('Find where the stage gate lives.', 'Explore'), ctx()), null);
  assert.equal(pretool(agent('Mode: read-only\nSearch the notes for rule 4.'), ctx()), null);
  assert.equal(pretool(agent(GOOD_BRIEF.replace('## How it will be proven', '**How it will be proven**')), ctx()), null);
});
test('good: steps of other tools pass', () => {
  assert.equal(pretool({ tool: 'Read', input: { file_path: P('course', 'a.py') }, cwd: ROOT }, ctx()), null);
  assert.equal(pretool({ tool: 'WebSearch', input: { query: 'x' }, cwd: ROOT }, ctx()), null);
});

// ---------- 5. on its own error: discipline lets through and logs ----------
test('on its own error it lets the step through and logs "error" (kind discipline)', () => {
  const c = ctx('hmm', { settings: { __crash: true } });
  assert.equal(pretool(write(P('course', 'a.py')), c), null);
  assert.equal(c.logs[0].event, 'error');
  assert.equal(pretool(write(P('course', 'a.py')), { read: () => { throw new Error('broken'); }, root: ROOT, home: HOME }), null);
  assert.equal(pretool(undefined, undefined), null);
});

// ---------- 6. speed ----------
test('fast: each step under 50 ms on ordinary input (fastest of 5 runs)', () => {
  const cases = [write(P('course', 'a.py')), write(P('notebook', 'core', 'a.mjs')), shell('cd src && cat > a.ts <<EOF\nx\nEOF', P('course')), agent(GOOD_BRIEF)];
  // The fastest of five runs: one pause of the computer (the whole suite running beside it, the first call warming
  // up) must not decide the result; a slow step must.
  for (const ev of cases) {
    let ms = Infinity;
    for (let i = 0; i < 5; i++) {
      const c = ctx();
      const t0 = performance.now();
      pretool(ev, c);
      ms = Math.min(ms, performance.now() - t0);
    }
    assert.ok(ms < 50, `${ev.tool} took ${ms.toFixed(1)} ms (fastest of 5)`);
  }
});

test.after(() => fs.rmSync(HOME, { recursive: true, force: true }));
