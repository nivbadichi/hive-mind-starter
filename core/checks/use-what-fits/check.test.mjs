// Tests for the use-what-fits check (rule 14). Each behaviour has a known-bad case (must be caught) and a known-good
// case (must pass). Run: node --test starter/core/checks/use-what-fits/check.test.mjs
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import check, { prompt, pretool, stop, helperstop, fitFor, usedSkills } from './check.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REAL_ROOT = path.resolve(HERE, '..', '..', '..');
const BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'use-what-fits-test-'));
after(() => fs.rmSync(BASE, { recursive: true, force: true }));
let n = 0;
const FILE_SETTINGS = JSON.parse(fs.readFileSync(new URL('./settings.json', import.meta.url), 'utf8'));
// The tests set their own lists and never lean on the person's chosen ones: SETTINGS has no coding skills (the older tests,
// about design and motion), CODE has a made-up list of three.
const SETTINGS = { ...FILE_SETTINGS, oneOf: { build: [] }, codeAlso: [], skipTempDir: false, tempMarks: [] };
const CODE = { ...SETTINGS, oneOf: { build: ['engineering:testing-strategy', 'engineering:debug', 'engineering:code-review', 'write-swift'] }, oneOfLabel: { build: 'coding skill' },
  codeAlso: ['.tsx', '.css'], suggest: { default: ['engineering:testing-strategy', 'engineering:debug', 'engineering:code-review'], '.swift': ['write-swift', 'engineering:testing-strategy'] } };

// A made-up registry and a made-up copy of the gates' "fit" settings: the check reads both from the notebook.
const FIT = {
  mode: 'on', maxSkills: 8, maxConnectors: 5,
  kinds: { design: ['design', 'redesign', 'page', 'hero', 'landing', 'screen'], build: ['build', 'fix', 'script', 'program', 'bug'], motion: ['animate', 'animation', 'motion'] },
  categories: { build: 'coding' },
  always: { design: ['hive-scout', 'impeccable'], motion: ['animate'] },
  connectors: { design: ['figma'], build: ['github'] },
  protocols: { design: ['rule-13', 'rule-14'], build: ['rule-5', 'rule-14'], all: ['rule-12'] },
};
const skill = (id, fits, state = 'active', about = '') => ({ id, kind: 'skill', state, fits, about });
const REGISTRY = { entries: [
  skill('hive-scout', ['design']), skill('impeccable', ['design'], 'active', 'design polish'), skill('emil-design-eng', ['design']),
  skill('anti-ui-slop', ['design'], 'installed-unused', 'stop generic hero sections'), skill('animate', ['motion']),
  skill('engineering:code-review', ['coding']), skill('engineering:testing-strategy', ['coding']),
  skill('grilling', ['general']), skill('playwright-cli', ['coding']), skill('ui-slop-score', ['design']), skill('break-ui', ['design']),
  skill('old-thing', ['design'], 'removed'),
  { id: 'figma', kind: 'connector', state: 'installed-unused' }, { id: 'github', kind: 'connector', state: 'active' },
  { id: 'rule-5', kind: 'protocol', state: 'active', text: 'Small steps, with proof.' },
  { id: 'rule-12', kind: 'protocol', state: 'active', text: 'Models.' },
  { id: 'rule-13', kind: 'protocol', state: 'active', text: 'Precedents first.' },
  { id: 'rule-14', kind: 'protocol', state: 'active', text: 'Use everything that fits.' },
] };

function notebook({ fit = FIT, loaded = [], hisLast = '', settings = SETTINGS } = {}) {
  const root = path.join(BASE, 'nb' + n++);
  const state = path.join(root, '.hive');
  fs.mkdirSync(path.join(root, 'core', 'gates'), { recursive: true });
  fs.mkdirSync(path.join(root, 'system'), { recursive: true });
  fs.mkdirSync(state, { recursive: true });
  if (fit) fs.writeFileSync(path.join(root, 'core', 'gates', 'settings.json'), JSON.stringify({ fit }));
  fs.writeFileSync(path.join(root, 'system', 'registry.json'), JSON.stringify(REGISTRY));
  const logs = [];
  const ctx = { root, state, sid: 's1', settings, loaded, events: [], hisLast,
    read: (rel) => { try { return fs.readFileSync(path.join(root, rel), 'utf8'); } catch { return ''; } }, log: (e, d) => logs.push([e, d]) };
  return { root, ctx, logs };
}
const write = (root, rel, extra = {}) => ({ tool: 'Write', input: { file_path: path.join(root, rel), content: 'x' }, cwd: root, session_id: 's1', ...extra });
const msg = (text, sid = 's1') => ({ text, prompt: text, session_id: sid });
const reply = (text) => ({ text, last_assistant_message: text, session_id: 's1' });

// ---------- the first screen or program write waits for the "always" skills ----------
test('known-bad, the common case: a site is redesigned with no hive-scout and no design skill loaded', () => {
  // A redesign starts straight away, with none of the skills design work always needs. The first screen write:
  const { root, ctx } = notebook({ hisLast: 'redesign the landing page hero' });
  const r = pretool(write(root, 'app/src/app/page.tsx'), ctx);
  assert.ok(r && r.deny, 'the write must be refused');
  assert.match(r.deny, /hive-scout, impeccable/);
  assert.match(r.deny, /rule 14/);
  assert.match(r.deny, /Skill tool/);
});
test('known-good: with the always skills loaded, the same write goes through (a plugin name counts for its short name)', () => {
  const { root, ctx } = notebook({ loaded: ['hive-scout', 'impeccable:impeccable'] });
  assert.equal(pretool(write(root, 'app/src/app/page.tsx'), ctx), null);
});
test('known-good: the loader\'s own hasLoaded is used when it is given', () => {
  const { root, ctx } = notebook();
  ctx.hasLoaded = () => true;
  assert.equal(pretool(write(root, 'app/a.tsx'), ctx), null);
});
test('known-bad: one always skill loaded is not enough; the refusal names only the missing one', () => {
  const { root, ctx } = notebook({ loaded: ['impeccable'] });
  const r = pretool({ tool: 'Edit', input: { file_path: path.join(root, 'app/a.css'), old_string: 'a', new_string: 'b' }, cwd: root, session_id: 's1' }, ctx);
  assert.match(r.deny, /not loaded in this chat: hive-scout \(/);
  assert.doesNotMatch(r.deny, /impeccable/);
});
test('known-bad: a shell write into a screen file is stopped too', () => {
  const { root, ctx } = notebook();
  assert.ok(pretool({ tool: 'Bash', command: 'echo "body{}" > app/a.css', cwd: root, session_id: 's1' }, ctx).deny);
  assert.ok(pretool({ tool: 'PowerShell', command: 'Set-Content -Path app/b.tsx -Value x', cwd: root, session_id: 's1' }, ctx).deny);
});
test('known-good: notes, data, built folders, reads and reading commands are never stopped', () => {
  const { root, ctx } = notebook();
  assert.equal(pretool(write(root, 'projects/site/notes.md'), ctx), null);
  assert.equal(pretool(write(root, 'core/checks/x/settings.json'), ctx), null);
  assert.equal(pretool(write(root, 'app/node_modules/pkg/index.tsx'), ctx), null);
  assert.equal(pretool({ tool: 'Read', input: { file_path: path.join(root, 'app/a.tsx') }, session_id: 's1' }, ctx), null);
  assert.equal(pretool({ tool: 'Bash', command: 'cat app/a.tsx; node --test core/x.test.mjs', cwd: root, session_id: 's1' }, ctx), null);
});
test('known-good: a temporary file is never stopped (with the module\'s own settings)', () => {
  const { ctx } = notebook();
  ctx.settings = undefined;
  assert.equal(pretool({ tool: 'Write', input: { file_path: path.join(os.tmpdir(), 'scratch-' + n++ + '.tsx') }, session_id: 's1' }, ctx), null);
});

// ---------- build work ----------
test('known-good: a program write passes when build work has no always skills (the gates\' setting today)', () => {
  const { root, ctx } = notebook();
  assert.equal(pretool(write(root, 'core/engine/x.mjs'), ctx), null);
});
test('known-bad: with a "one of" list for build, a program write waits until one of them is loaded; known-good: one is enough', () => {
  const { root, ctx } = notebook({ settings: { ...SETTINGS, oneOf: { build: ['engineering:code-review', 'engineering:testing-strategy'] }, oneOfLabel: {} } });
  const r = pretool(write(root, 'core/engine/x.mjs'), ctx);
  assert.match(r.deny, /at least one of engineering:code-review, engineering:testing-strategy/);
  ctx.loaded.push('testing-strategy');
  assert.equal(pretool(write(root, 'core/engine/x.mjs'), ctx), null);
});

// ---------- code waits for know-how (the ruling of 2026-11-20) ----------
test('known-bad: a .mjs write with no coding skill loaded is refused, naming two or three fitting skills', () => {
  const { root, ctx, logs } = notebook({ settings: CODE });
  const r = pretool(write(root, 'core/engine/x.mjs'), ctx);
  assert.ok(r && r.deny, 'the write must be refused');
  assert.match(r.deny, /at least one coding skill, for example engineering:testing-strategy, engineering:debug or engineering:code-review/);
  assert.doesNotMatch(r.deny, /write-swift/, 'only the fitting few are named, not the whole list');
  assert.match(r.deny, /Skill tool/);
  assert.ok(logs.some(([e, d]) => e === 'fit-deny' && d.oneOf === 'build'));
});
test('known-bad: every kind of program file waits (Edit too, and a shell write); the names fit the file', () => {
  const { root, ctx } = notebook({ settings: CODE });
  for (const f of ['a.js', 'b.ts', 'c.py', 'd.ps1', 'e.sh', 'f.cjs']) assert.ok(pretool(write(root, 'core/x/' + f), ctx), f);
  assert.ok(pretool({ tool: 'Edit', input: { file_path: path.join(root, 'core/x/a.mjs'), old_string: 'a', new_string: 'b' }, cwd: root, session_id: 's1' }, ctx).deny);
  assert.ok(pretool({ tool: 'Bash', command: 'echo "x" > core/x/run.sh', cwd: root, session_id: 's1' }, ctx).deny);
  assert.match(pretool(write(root, 'ios/App.swift'), ctx).deny, /for example write-swift or engineering:testing-strategy/);
});
test('known-bad: a screen file that is also code (.tsx, .css) waits for a coding skill as well as the design skills', () => {
  const { root, ctx } = notebook({ settings: CODE, loaded: ['hive-scout', 'impeccable'] });
  const r = pretool(write(root, 'app/page.tsx'), ctx);
  assert.match(r.deny, /design, build work/);
  assert.match(r.deny, /coding skill/);
  assert.doesNotMatch(r.deny, /hive-scout/, 'the design skills are loaded, so only the coding skill is named');
  assert.equal(pretool(write(root, 'app/logo.svg'), ctx), null, 'a picture is not code');
});
test('known-good: one coding skill loaded is enough (a plugin name counts for its short name), for every program file', () => {
  const { root, ctx } = notebook({ settings: CODE, loaded: ['testing-strategy'] });
  assert.equal(pretool(write(root, 'core/engine/x.mjs'), ctx), null);
  assert.equal(pretool(write(root, 'ios/App.swift'), ctx), null);
  ctx.loaded.push('hive-scout', 'impeccable');
  assert.equal(pretool(write(root, 'app/page.tsx'), ctx), null);
});
test('known-good: notes, data and settings are not code: a one-line settings edit, a JSON fixture, a note pass with no skill', () => {
  const { root, ctx } = notebook({ settings: CODE });
  assert.equal(pretool({ tool: 'Edit', input: { file_path: path.join(root, 'core/checks/x/settings.json'), old_string: '"a"', new_string: '"b"' }, cwd: root, session_id: 's1' }, ctx), null);
  assert.equal(pretool(write(root, 'core/checks/x/fixtures/case.json'), ctx), null);
  assert.equal(pretool(write(root, 'system/design/a-note.md'), ctx), null);
  assert.equal(pretool(write(root, 'data/list.yml'), ctx), null);
});
// The ruling of 2026-11-21 ("On for everyone"): in the copy too, code waits for a coding skill. The copy's own list
// holds only free skills a new person really has: built into Claude Code, or Anthropic's engineering plugin, which the
// builder package installs. Each comes from the copy's registry, so where it comes from is written down.
const COPY_REG = JSON.parse(fs.readFileSync(path.join(REAL_ROOT, 'system', 'registry.json'), 'utf8'));
const builtIn = (id) => ((COPY_REG.entries.find((e) => e.id === id) || {}).install || {}).type === 'built-in';
test('the copy\'s own coding skills: the list is not empty, and each is in the registry, free and Anthropic\'s own', () => {
  const list = FILE_SETTINGS.oneOf.build;
  assert.ok(list.length > 0, 'oneOf.build is empty: a new person\'s Claude writes code with no coding skill loaded');
  for (const id of list) {
    const e = COPY_REG.entries.find((x) => x.id === id);
    assert.ok(e && e.kind === 'skill', `${id} is not a skill in the copy's registry`);
    const r = e.install || {};
    assert.ok(r.type === 'built-in' || (r.type === 'plugin' && r.marketplace === 'knowledge-work-plugins' && r.source === 'anthropics/knowledge-work-plugins'), `${id} is neither built into Claude Code nor Anthropic's own plugin`);
    assert.ok(!e.paid && !e.cost && e.review !== 'needed', `${id} is paid or not reviewed`);
  }
  assert.ok(list.some(builtIn), 'at least one skill every person has (built into Claude Code)');
});
test('known-bad, with the copy\'s own settings: a .mjs write with no coding skill loaded is refused, and every skill the refusal names is one every person has', () => {
  const own = { ...FILE_SETTINGS, skipTempDir: false, tempMarks: [] };
  for (const f of ['core/x/a.mjs', 'core/x/a.test.mjs', 'app/page.tsx', 'tools/run.ps1', 'tools/run.sh', 'ios/App.swift', 'a.py']) {
    const { root, ctx } = notebook({ settings: own, loaded: ['hive-scout', 'impeccable'] });
    const r = pretool(write(root, f), ctx);
    assert.ok(r && r.deny, `${f} must wait for a coding skill`);
    const named = (r.deny.match(/for example ([^.;(]+?)\s*(?:\(|\.|;|$)/) || [])[1] || '';
    const ids = named.split(/, | or /).map((s) => s.trim()).filter(Boolean);
    assert.ok(ids.length >= 1, `${f}: the refusal names no skill: ${r.deny}`);
    for (const id of ids) assert.ok(builtIn(id), `${f}: the refusal names ${id}, which a new person may not have`);
    ctx.loaded.push('simplify');
    assert.equal(pretool(write(root, f), ctx), null, `${f}: one built-in coding skill is enough`);
  }
});
test('known-bad: a helper in its own chat is held the same way; its own load of a coding skill lets it through', () => {
  const { root, ctx } = notebook({ settings: CODE });
  const helper = { ...ctx, sid: 'h1', isHelperChat: true, loaded: [] };
  assert.ok(pretool(write(root, 'core/engine/x.mjs', { session_id: 'h1' }), helper).deny);
  helper.loaded = ['engineering:debug'];
  assert.equal(pretool(write(root, 'core/engine/x.mjs', { session_id: 'h1' }), helper), null);
});
test('known-bad: a turn that wrote a program file the before-a-tool step did not see, with no coding skill, is a debt', () => {
  const { root, ctx } = notebook({ settings: CODE });
  ctx.events = [{ kind: 'write', path: path.join(root, 'core/engine/x.mjs') }];
  const d = stop(reply('Changed the program.'), ctx).debt.find((x) => x.key === 'always-unloaded');
  assert.match(d.text, /core\/engine\/x\.mjs while at least one coding skill/);
  ctx.loaded.push('engineering:code-review');
  assert.equal(stop(reply('Changed the program.'), ctx), null);
});
test('no design or owner-only skill is suggested as a coding skill', () => {
  assert.ok(!FILE_SETTINGS.suggest.default.some((s) => /impeccable|hive-scout|animate|grill/.test(s)), 'no design or owner-only skill is suggested as coding');
});

// ---------- motion: named by the person's words, never by a file ----------
test('known-bad: "animate the hero" needs the motion skill too; known-good: with it loaded the write goes through', () => {
  const { root, ctx } = notebook({ loaded: ['hive-scout', 'impeccable'], hisLast: 'animate the hero on scroll' });
  assert.match(pretool(write(root, 'app/hero.tsx'), ctx).deny, /design, motion work.*animate/);
  ctx.loaded.push('animate');
  assert.equal(pretool(write(root, 'app/hero.tsx'), ctx), null);
});
test('known-bad: in a helper chat (no words of the person), the motion named at the chat\'s first message is remembered', () => {
  const { root, ctx } = notebook({ loaded: ['hive-scout', 'impeccable'] });
  prompt(msg('Build the hero animation for the site'), ctx);
  assert.match(pretool(write(root, 'app/hero.tsx'), ctx).deny, /animate/);
  assert.equal(pretool(write(root, 'app/hero.tsx', { session_id: 's2' }), { ...ctx, sid: 's2' }), null, 'another chat does not inherit it');
});

// ---------- the list put in front of Claude at the person's message ----------
test('known-bad without the check, now listed: a design message gets the always skills, the other skills, connectors and protocols', () => {
  // A skill that is installed is not a skill that is used: the list comes by program, not from memory.
  const { ctx, logs } = notebook({ loaded: ['impeccable'] });
  const r = prompt(msg('redesign the landing page hero'), ctx);
  assert.ok(r && r.say);
  assert.match(r.say, /design work/);
  assert.match(r.say, /Load first, with the Skill tool: hive-scout\./);
  assert.match(r.say, /Already loaded: impeccable/);
  assert.match(r.say, /anti-ui-slop/, 'a skill that fits but is not in use yet is still named');
  assert.doesNotMatch(r.say, /old-thing/, 'a removed skill is never named');
  assert.match(r.say, /Connectors that fit: figma/);
  assert.match(r.say, /rule 13, rule 14, rule 12/);
  assert.ok(logs.some(([e]) => e === 'fit-listed'));
});
test('known-good: a message that is no kind of work gets nothing; a second design message with all loaded gets nothing', () => {
  const { ctx } = notebook({ loaded: ['hive-scout', 'impeccable'] });
  assert.equal(prompt(msg('how was your day?'), ctx), null);
  assert.ok(prompt(msg('redesign the hero'), ctx).say, 'the first time, the full list');
  assert.equal(prompt(msg('now the landing page'), ctx), null, 'listed once per chat while nothing is missing');
});
test('known-bad: a second design message while an always skill is still missing gets one short line', () => {
  const { ctx } = notebook();
  prompt(msg('redesign the hero'), ctx);
  const r = prompt(msg('and the landing page'), ctx);
  assert.match(r.say, /still not loaded/);
  assert.match(r.say, /hive-scout, impeccable/);
});
test('known-good: build work is listed with its coding skills and connectors', () => {
  const { ctx } = notebook();
  const r = prompt(msg('fix the bug in the script'), ctx);
  assert.match(r.say, /build work/);
  assert.match(r.say, /nothing is set as always/);
  assert.match(r.say, /engineering:code-review/);
  assert.match(r.say, /Connectors that fit: github/);
});
test('the match is the gates\' own: the gates\' fit command on the same notebook gives the same always and skills', () => {
  const { root } = notebook();
  const home = path.join(BASE, 'home' + n++);
  fs.mkdirSync(home, { recursive: true });
  const words = 'redesign the landing page hero';
  const run = spawnSync(process.execPath, [path.resolve(HERE, '..', '..', 'gates', 'gates.mjs'), 'fit', ...words.split(' ')],
    { encoding: 'utf8', env: { ...process.env, HIVE_ROOT: root, HIVE_HOME: home, HIVE_STATE: path.join(home, 'hive') }, timeout: 10000 });
  assert.equal(run.status, 0, run.stderr);
  const mine = fitFor(words, REGISTRY, FIT);
  assert.match(run.stdout, new RegExp(`Always load: ${mine.always.join(', ')}\\.`));
  const theirs = [...((run.stdout.match(/Skills that also fit: (.*)\./) || [])[1].matchAll(/([\w:-]+) \([^)]*\)/g))].map((m) => m[1]);
  assert.deepEqual(theirs, mine.skills.map((e) => e.id));
});

// ---------- "Used:" lines ----------
test('known-bad: a "Used:" line naming a skill never loaded is a debt, naming only that skill', () => {
  // Without this check, a skill named but never loaded is only noted.
  const { ctx } = notebook({ loaded: ['impeccable'] });
  const r = stop(reply('The page is redesigned.\nUsed: impeccable, emil-design-eng; connectors: figma.'), ctx);
  assert.ok(r && Array.isArray(r.debt));
  const d = r.debt.find((x) => x.key === 'used-unloaded');
  assert.match(d.text, /names emil-design-eng,/);
  assert.doesNotMatch(d.text, /impeccable/);
});
test('known-good: a "Used:" line that names only loaded skills, a skipped skill, or a short name of a plugin skill, is no debt', () => {
  const { ctx } = notebook({ loaded: ['impeccable', 'engineering:testing-strategy'] });
  assert.equal(stop(reply('Used: impeccable, testing-strategy. Skipped: emil-design-eng (no screens changed).'), ctx), null);
  assert.equal(stop(reply('No Used line at all, and impeccable named in prose.'), ctx), null);
});
test('a report in the shape "Skills loaded: ... Not loaded: ..." is read; known-bad when one was never loaded', () => {
  const line = 'Skills loaded: grilling, playwright-cli, ui-slop-score. Not loaded (time and weight): break-ui, engineering:code-review.';
  const good = notebook({ loaded: ['grilling', 'playwright-cli', 'ui-slop-score'] });
  assert.equal(stop(reply(line), good.ctx), null);
  const bad = notebook({ loaded: ['playwright-cli', 'ui-slop-score'] });
  assert.match(stop(reply(line), bad.ctx).debt[0].text, /names grilling,/);
});
test('usedSkills reads plugin:skill names even when the registry does not know them, and skips plain words', () => {
  assert.deepEqual(usedSkills('Used: none, because no skill fits; vercel:deploy', new Set(), ['none', 'skill', 'because']), ['vercel:deploy']);
});

// ---------- a turn that wrote anyway (a write the before-a-tool step could not see) ----------
test('known-bad: a turn that wrote a screen file with an always skill unloaded is a debt; known-good: loaded, or a note only', () => {
  const { root, ctx } = notebook({ loaded: ['impeccable'] });
  ctx.events = [{ kind: 'write', path: path.join(root, 'app/a.tsx') }, { kind: 'tool', tool: 'Read', ok: true }];
  const d = stop(reply('Changed the header.'), ctx).debt.find((x) => x.key === 'always-unloaded');
  assert.match(d.text, /app\/a\.tsx while hive-scout was not loaded/);
  ctx.loaded.push('hive-scout');
  assert.equal(stop(reply('Changed the header.'), ctx), null);
  const notes = notebook();
  notes.ctx.events = [{ kind: 'write', path: path.join(notes.root, 'projects/site/state.md') }];
  assert.equal(stop(reply('Saved the note.'), notes.ctx), null);
});

// ---------- a helper's report ----------
test('known-bad: a helper\'s report naming a skill nobody loaded is put in front of Claude; known-good: loaded', () => {
  const { ctx } = notebook({ loaded: ['engineering:code-review'] });
  const r = helperstop({ text: 'Done.\nSkills actually loaded: engineering:code-review, engineering:testing-strategy' }, ctx);
  assert.match(r.say, /engineering:testing-strategy/);
  assert.doesNotMatch(r.say, /code-review/);
  ctx.loaded.push('engineering:testing-strategy');
  assert.equal(helperstop({ text: 'Skills actually loaded: engineering:code-review, engineering:testing-strategy' }, ctx), null);
});

// ---------- what it cannot do without the gates' settings ----------
test('with no fit settings in the notebook it stops nothing and logs why (it cannot know the always skills)', () => {
  const { root, ctx, logs } = notebook({ fit: null });
  assert.equal(pretool(write(root, 'app/a.tsx'), ctx), null);
  assert.equal(prompt(msg('redesign the hero'), ctx), null);
  assert.ok(logs.some(([e]) => e === 'fit-missing'));
});

// ---------- the contract ----------
test('the module has the contract\'s shape', () => {
  assert.equal(check.id, 'use-what-fits');
  assert.equal(check.rule, 'rule 14');
  assert.equal(check.kind, 'discipline');
  assert.equal(check.mode, 'refuse');
  assert.equal(typeof check.about, 'string');
  for (const s of ['prompt', 'pretool', 'stop', 'helperstop']) assert.equal(typeof check.steps[s], 'function');
});
test('on its own error each step lets the work through and logs (a discipline check)', () => {
  const { root, ctx, logs } = notebook();
  const broken = { ...ctx, read: () => { throw new Error('broken read'); } };
  assert.equal(pretool(write(root, 'app/a.tsx'), broken), null);
  assert.equal(prompt(msg('redesign the hero'), broken), null);
  assert.equal(helperstop({ text: 'Used: impeccable' }, broken), null);
  Object.defineProperty(ctx, 'events', { get() { throw new Error('broken events'); } });
  assert.equal(stop(reply('Used: impeccable'), ctx), null);
  assert.ok(logs.filter(([e, d]) => e === 'error' && /broken/.test(d.message)).length >= 4);
});
test('it is fast: under 50 ms for a step on ordinary input (the real registry and gates\' settings)', () => {
  const logs = [];
  const state = path.join(BASE, 'state' + n++);
  fs.mkdirSync(state, { recursive: true });
  const cache = new Map();
  const ctx = { root: REAL_ROOT, state, sid: 'speed', settings: SETTINGS, loaded: ['impeccable'], events: [{ kind: 'write', path: path.join(REAL_ROOT, 'app/x.tsx') }], hisLast: 'redesign the hero',
    read: (rel) => { if (!cache.has(rel)) { try { cache.set(rel, fs.readFileSync(path.join(REAL_ROOT, rel), 'utf8')); } catch { cache.set(rel, ''); } } return cache.get(rel); }, log: (e, d) => logs.push([e, d]) };
  const ev = write(REAL_ROOT, 'app/x.tsx', { session_id: 'speed' });
  pretool(ev, ctx); prompt(msg('redesign the hero', 'speed'), ctx); stop(reply('Used: impeccable, emil-design-eng'), ctx); // warm up
  const runs = 20;
  const t = performance.now();
  for (let i = 0; i < runs; i++) {
    pretool(ev, ctx);
    prompt(msg('redesign the landing page hero ' + i, 'speed' + i), ctx);
    stop(reply('Used: impeccable, emil-design-eng'), ctx);
  }
  const each = (performance.now() - t) / (runs * 3);
  assert.ok(each < 50, `one step took ${each.toFixed(2)} ms`);
  assert.ok(!logs.some(([e]) => e === 'error'), JSON.stringify(logs.filter(([e]) => e === 'error')));
});
