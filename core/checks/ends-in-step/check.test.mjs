// Tests for the ends-in-step check (rule 15). Each behaviour has a known-bad case (must be caught) and a known-good
// case (must pass). They use a made-up notebook with a made-up list of ends; nothing real is read or changed.
// Run: node --test starter/core/checks/ends-in-step/check.test.mjs
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import check, { pretool, posttool, stop, pairsFor, runFull } from './check.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..');
const BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'ends-in-step-test-'));
after(() => fs.rmSync(BASE, { recursive: true, force: true }));
const SETTINGS = { ...JSON.parse(fs.readFileSync(path.join(HERE, 'settings.json'), 'utf8')), backgroundRefresh: false };
let n = 0;

const ENDS = {
  copy: {
    folder: 'starter',
    sameFolders: ['core/engine'],
    notInCopy: ['core/engine/stack.mjs'],
    identical: ['core/engine/registry.mjs'],
    mustMention: [{ file: 'core/gates/gates.mjs', words: ['sentItems', 'longChat'] }],
  },
  publicSite: { stamp: 'system/public-site-published.md', watch: ['app/src'], privateOnly: ['app/src/data/'] },
};

// A made-up notebook. files: { rel: text }.
function notebook(files = {}) {
  const root = path.join(BASE, 'nb' + n++);
  const state = path.join(root, '.hive');
  const all = { 'system/ends.json': JSON.stringify(ENDS), ...files };
  for (const [rel, text] of Object.entries(all)) { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), text); }
  fs.mkdirSync(state, { recursive: true });
  const logs = [];
  const ctx = { root, state, sid: 's1', settings: SETTINGS, events: [], read: (rel) => fs.readFileSync(path.join(root, rel), 'utf8'), log: (e, d) => logs.push([e, d]) };
  return { root, state, ctx, logs };
}
const W = (root, rel, content, extra = {}) => ({ tool: 'Write', input: { file_path: path.join(root, rel), content }, cwd: root, session_id: 's1', ...extra });
const E = (root, rel, old_string, new_string, extra = {}) => ({ tool: 'Edit', input: { file_path: path.join(root, rel), old_string, new_string }, cwd: root, session_id: 's1', ...extra });
const SH = (root, command) => ({ tool: 'Bash', input: { command }, command, cwd: root, session_id: 's1' });
// Do the save for real (as the tool would), then run the after-tool step.
function save(ctx, ev) {
  const f = ev.input.file_path;
  if (ev.tool === 'Write') { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, ev.input.content); }
  if (ev.tool === 'Edit') fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(ev.input.old_string, ev.input.new_string));
  posttool(ev, ctx);
}

const REG = 'export const version = 2;\n';
const REG_OLD = 'export const version = 1;\n';
const GATES = '// sentItems longChat\n';

// ---------- the real case: a change piled on an end already behind ----------
test('known-bad: the empty copy already differs in registry.mjs and the main one is changed again', () => {
  // A further change to the main one is refused, both ends named.
  const { root, ctx } = notebook({ 'core/engine/registry.mjs': REG, 'starter/core/engine/registry.mjs': REG_OLD });
  const r = pretool(E(root, 'core/engine/registry.mjs', 'version = 2', 'version = 3'), ctx);
  assert.ok(r && r.deny, 'the save must be refused');
  assert.match(r.deny, /core\/engine\/registry\.mjs/);
  assert.match(r.deny, /starter\/core\/engine\/registry\.mjs/);
  assert.match(r.deny, /rule 15/);
  assert.match(r.deny, /The one thing to do/);
});
test('known-good: a save that brings the ends INTO step is never refused (either side, Write or Edit)', () => {
  const { root, ctx } = notebook({ 'core/engine/registry.mjs': REG, 'starter/core/engine/registry.mjs': REG_OLD });
  assert.equal(pretool(W(root, 'starter/core/engine/registry.mjs', REG), ctx), null, 'copying the newer one across');
  assert.equal(pretool(E(root, 'core/engine/registry.mjs', 'version = 2', 'version = 1'), ctx), null, 'making the main one match');
  assert.equal(pretool(W(root, 'starter/core/engine/registry.mjs', REG.replace(/\n/g, '\r\n')), ctx), null, 'line endings do not count');
});
test('known-good: a shell copy from one end to the other passes; known-bad: a shell append to an end already behind is refused', () => {
  const { root, ctx } = notebook({ 'core/engine/registry.mjs': REG, 'starter/core/engine/registry.mjs': REG_OLD });
  assert.equal(pretool(SH(root, 'cp core/engine/registry.mjs starter/core/engine/registry.mjs'), ctx), null);
  assert.equal(pretool(SH(root, 'Copy-Item -Force core/engine/registry.mjs starter/core/engine/registry.mjs'), ctx), null);
  assert.ok(pretool(SH(root, 'echo x >> core/engine/registry.mjs'), ctx).deny);
});

// ---------- the end of a piece of work ----------
test('known-bad: ends in step, the main one is changed and the reply ends with the copy behind → a debt naming both ends', () => {
  const { root, ctx } = notebook({ 'core/engine/registry.mjs': REG, 'starter/core/engine/registry.mjs': REG });
  const ev = E(root, 'core/engine/registry.mjs', 'version = 2', 'version = 3');
  assert.equal(pretool(ev, ctx), null, 'the first change of a pair in step is let through');
  save(ctx, ev);
  const r = stop({ session_id: 's1' }, ctx);
  assert.ok(r && r.debt, 'the end of the reply must carry a debt');
  assert.equal(r.debt.key, 'ends-in-step');
  assert.match(r.debt.text, /core\/engine\/registry\.mjs and its end starter\/core\/engine\/registry\.mjs/);
  assert.deepEqual(r.debt.allow.paths.sort(), ['core/engine/registry.mjs', 'starter/core/engine/registry.mjs'], 'the debt leaves a way out: saving the two ends');
});
test('known-bad: the debt is not paid by staying quiet: a later reply with no saves still carries it', () => {
  const { root, ctx } = notebook({ 'core/engine/registry.mjs': REG, 'starter/core/engine/registry.mjs': REG });
  save(ctx, E(root, 'core/engine/registry.mjs', 'version = 2', 'version = 3'));
  assert.ok(stop({ session_id: 's1' }, ctx).debt);
  ctx.events = [];
  assert.ok(stop({ session_id: 's1' }, ctx).debt, 'still owed at the next reply');
  assert.equal(stop({ session_id: 's2' }, ctx), null, 'another chat did not touch it');
});
test('known-good: the same work finished in both places ends with no debt, and the record is cleared', () => {
  const { root, ctx, state } = notebook({ 'core/engine/registry.mjs': REG, 'starter/core/engine/registry.mjs': REG });
  save(ctx, E(root, 'core/engine/registry.mjs', 'version = 2', 'version = 3'));
  const twin = W(root, 'starter/core/engine/registry.mjs', 'export const version = 3;\n');
  assert.equal(pretool(twin, ctx), null);
  save(ctx, twin);
  assert.equal(stop({ session_id: 's1' }, ctx), null);
  const rec = JSON.parse(fs.readFileSync(path.join(state, SETTINGS.openFile), 'utf8'));
  assert.equal(rec.s1, undefined, 'nothing left open for this chat');
});
test('known-bad: a new program in core/engine with no twin in the empty copy → a debt; known-good: adding the twin clears it', () => {
  // Seen here through the turn's events
  // (a save the after-tool step did not see, for example one made by a shell command).
  const { root, ctx } = notebook({ 'core/engine/registry.mjs': REG, 'starter/core/engine/registry.mjs': REG });
  assert.equal(pretool(W(root, 'core/engine/app-brief.mjs', 'x'), ctx), null, 'a new entry starts in step');
  fs.writeFileSync(path.join(root, 'core/engine/app-brief.mjs'), 'x');
  ctx.events = [{ kind: 'write', path: 'core/engine/app-brief.mjs' }];
  const r = stop({ session_id: 's1' }, ctx);
  assert.ok(r && r.debt);
  assert.match(r.debt.text, /core\/engine\/app-brief\.mjs has no twin starter\/core\/engine\/app-brief\.mjs/);
  fs.mkdirSync(path.join(root, 'starter/core/engine'), { recursive: true });
  fs.writeFileSync(path.join(root, 'starter/core/engine/app-brief.mjs'), 'x (newcomer wording)');
  ctx.events = [{ kind: 'write', path: 'starter/core/engine/app-brief.mjs' }];
  assert.equal(stop({ session_id: 's1' }, ctx), null, 'a twin with other wording is enough for a folder entry');
});
test('known-bad: editing a program whose twin is already missing is refused; known-good: one listed as not in the copy is never held', () => {
  const { root, ctx } = notebook({ 'core/engine/old.mjs': 'a', 'core/engine/stack.mjs': 'a' });
  const r = pretool(E(root, 'core/engine/old.mjs', 'a', 'b'), ctx);
  assert.ok(r && r.deny);
  assert.match(r.deny, /has no twin starter\/core\/engine\/old\.mjs/);
  assert.equal(pretool(E(root, 'core/engine/stack.mjs', 'a', 'b'), ctx), null);
  assert.equal(pretool(W(root, 'starter/core/engine/old.mjs', 'a'), ctx), null, 'creating the twin is let through');
});
test('known-bad: the empty copy lacks a newer part, and the main file is changed again → refused; known-good: adding the words to the copy passes', () => {
  const { root, ctx } = notebook({ 'core/gates/gates.mjs': GATES, 'starter/core/gates/gates.mjs': '// sentItems\n' });
  const r = pretool(E(root, 'core/gates/gates.mjs', 'longChat', 'longChat plus'), ctx);
  assert.ok(r && r.deny);
  assert.match(r.deny, /does not carry "longChat"/);
  assert.equal(pretool(E(root, 'starter/core/gates/gates.mjs', '// sentItems', '// sentItems longChat'), ctx), null);
});
test('known-good: a check module folder counts as an end too (the setting adds core/checks)', () => {
  const { root, ctx } = notebook({});
  const pairs = pairsFor('core/checks/ends-in-step/check.mjs', ENDS, SETTINGS);
  assert.deepEqual(pairs, [{ type: 'entry', main: 'core/checks/ends-in-step', copy: 'starter/core/checks/ends-in-step' }]);
  fs.mkdirSync(path.join(root, 'core/checks/x'), { recursive: true });
  fs.writeFileSync(path.join(root, 'core/checks/x/check.mjs'), 'a');
  ctx.events = [{ kind: 'write', path: 'core/checks/x/check.mjs' }];
  assert.ok(stop({ session_id: 's1' }, ctx).debt, 'a module with no copy is a debt');
});
test('known-good: files on no list, and files outside the notebook, are never held', () => {
  const { root, ctx } = notebook({ 'core/engine/registry.mjs': REG, 'starter/core/engine/registry.mjs': REG_OLD });
  assert.equal(pretool(W(root, 'system/lessons.md', 'x'), ctx), null);
  assert.equal(pretool(W(path.join(BASE, 'elsewhere'), 'core/engine/registry.mjs', 'x'), ctx), null);
  assert.equal(pretool({ tool: 'Read', input: { file_path: path.join(root, 'core/engine/registry.mjs') }, cwd: root }, ctx), null);
  ctx.events = [{ kind: 'write', path: 'system/lessons.md' }];
  assert.equal(stop({ session_id: 's1' }, ctx), null);
});
test('known-good: with no list of ends there is nothing to hold', () => {
  const { root, ctx } = notebook({});
  fs.unlinkSync(path.join(root, 'system/ends.json'));
  assert.equal(pretool(W(root, 'core/engine/registry.mjs', 'x'), ctx), null);
});

// ---------- the ends a save cannot bring in step ----------
test('known-bad: the code of the public site changed → a notice that it needs a yes to go online; known-good: private-only code says nothing', () => {
  const { root, ctx } = notebook({});
  ctx.events = [{ kind: 'write', path: 'app/src/app/page.tsx' }];
  const r = stop({ session_id: 's1' }, ctx);
  assert.ok(r && r.say && !r.debt, 'a notice, never a debt');
  assert.match(r.say, /public site is behind/);
  assert.match(r.say, /their yes/);
  ctx.events = [{ kind: 'write', path: 'app/src/data/x.json' }];
  assert.equal(stop({ session_id: 's1' }, ctx), null);
});
test('known-good: the cached full run of the ends program is shown after a save, its known fault marked', () => {
  const { root, ctx, state } = notebook({});
  fs.writeFileSync(path.join(state, SETTINGS.fullCacheFile), JSON.stringify({ at: Date.now() - 60e3, ms: 1, ok: true, okCount: 3, needs: [
    'The empty copy has every helper and program the main system has (missing: core/engine/app-brief.mjs)',
    'Your page is behind the newest save by about 40 minutes',
    '900 places still carry a phrase that a later decision made untrue (.claude/worktrees/agent-a/system/x.md:3 "old")',
  ] }));
  ctx.events = [{ kind: 'write', path: 'system/lessons.md' }];
  const r = stop({ session_id: 's1' }, ctx);
  assert.match(r.say, /Your page is behind/);
  assert.doesNotMatch(r.say, /The empty copy has every helper/, 'the copy is held by this check itself');
  assert.match(r.say, /known fault of the ends program/);
  ctx.events = [];
  assert.equal(stop({ session_id: 's1' }, ctx), null, 'a reply with no saves is not told again');
});

// ---------- the ends program's old fault stays fixed ----------
test('fixed fault of system/ends-check.mjs: its search for outdated phrases no longer reads the helpers\' own copies', () => {
  // The program is used as it is (copied into a made-up notebook, never edited). Its walk once also read the copies
  // under .claude/worktrees; it now skips .claude.
  const { root, state } = notebook({
    'system/dead-phrases.md': '- "the old way" | replaced by the new way\n',
    'system/note.md': 'All good here.\n',
    '.claude/worktrees/agent-x/system/note.md': 'We still do the old way.\n',
  });
  fs.copyFileSync(path.join(REPO, 'system', 'ends-check.mjs'), path.join(root, 'system', 'ends-check.mjs'));
  fs.writeFileSync(path.join(root, 'system/ends.json'), '{}');
  const prev = process.env.HIVE_CLOUD; process.env.HIVE_CLOUD = '1';
  let r, again;
  try {
    r = runFull(root, state, SETTINGS);
    fs.writeFileSync(path.join(root, 'system/note.md'), 'We still do the old way.\n');
    again = runFull(root, state, SETTINGS);
  } finally { if (prev === undefined) delete process.env.HIVE_CLOUD; else process.env.HIVE_CLOUD = prev; }
  const line = r.needs.find((l) => /a later decision made untrue/.test(l));
  assert.equal(line, undefined, 'a phrase found only in a helper\'s own copy is not counted');
  const hit = again.needs.find((l) => /a later decision made untrue/.test(l));
  assert.ok(hit, 'the same phrase in the notebook\'s own note is still found');
  assert.match(hit, /^1 place /);
  assert.doesNotMatch(hit, /\.claude/);
  assert.ok(typeof r.ms === 'number' && fs.existsSync(path.join(state, SETTINGS.fullCacheFile)), 'the run is timed and cached');
});

// ---------- its own error, its speed, its shape ----------
test('on its own error it lets the step through and logs (a discipline check)', () => {
  const { root, ctx, logs } = notebook({ 'system/ends.json': '{ not json' });
  assert.equal(check.kind, 'discipline');
  assert.equal(pretool(W(root, 'core/engine/registry.mjs', 'x'), ctx), null);
  assert.equal(posttool(W(root, 'core/engine/registry.mjs', 'x'), ctx), null);
  assert.equal(stop({ session_id: 's1' }, ctx), null);
  assert.equal(logs.filter(([e]) => e === 'error').length, 3);
});
test('it is fast: under 50 ms for a step on ordinary input', () => {
  const big = 'const a = 1;\n'.repeat(5000);
  const { root, ctx } = notebook({ 'core/engine/registry.mjs': big, 'starter/core/engine/registry.mjs': big, 'core/gates/gates.mjs': GATES, 'starter/core/gates/gates.mjs': GATES });
  ctx.events = [{ kind: 'write', path: 'core/engine/registry.mjs' }, { kind: 'write', path: 'core/gates/gates.mjs' }];
  const ev = E(root, 'core/engine/registry.mjs', 'const a = 1;', 'const a = 2;');
  pretool(ev, ctx); stop({ session_id: 's1' }, ctx);
  // The fastest of 20 runs: one pause of the computer (the whole suite running beside it) must not decide the result.
  const fastest = (fn) => { let best = Infinity; for (let i = 0; i < 20; i++) { const t = performance.now(); fn(); best = Math.min(best, performance.now() - t); } return best; };
  const pre = fastest(() => pretool(ev, ctx));
  const end = fastest(() => stop({ session_id: 's1' }, ctx));
  assert.ok(pre < 50, `pretool took ${pre.toFixed(2)} ms (fastest of 20)`);
  assert.ok(end < 50, `stop took ${end.toFixed(2)} ms (fastest of 20)`);
});
test('its shape follows the contract', () => {
  assert.equal(check.id, path.basename(HERE));
  assert.equal(check.rule, 'rule 15');
  assert.equal(check.mode, 'refuse');
  assert.ok(check.about && /\.$/.test(check.about));
  assert.deepEqual(Object.keys(check.steps).sort(), ['posttool', 'pretool', 'stop']);
});
