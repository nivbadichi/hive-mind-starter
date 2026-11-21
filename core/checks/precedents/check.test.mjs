// Tests for the precedents check. Each behaviour has a known-bad case (must be caught) and a known-good case
// (must pass). Run: node --test core/checks/precedents/check.test.mjs
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import check, { pretool, posttool, noteFault } from './check.mjs';

const BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'precedents-test-'));
after(() => fs.rmSync(BASE, { recursive: true, force: true }));
let n = 0;
const SETTINGS = { ...JSON.parse(fs.readFileSync(new URL('./settings.json', import.meta.url), 'utf8')), skipTempDir: false, tempMarks: [] };

// A made-up notebook: one project whose folder is the notebook itself, as Hive Mind's own project is.
function notebook({ folderLine, bom } = {}) {
  const root = path.join(BASE, 'nb' + n++);
  const state = path.join(root, '.hive');
  fs.mkdirSync(path.join(root, 'projects', 'site'), { recursive: true });
  fs.mkdirSync(path.join(root, 'system', 'design'), { recursive: true });
  fs.mkdirSync(state, { recursive: true });
  fs.writeFileSync(path.join(root, 'projects', 'site', 'state.md'),
    `${bom ? '﻿' : ''}---\nproject: The site\nfolder: ${folderLine || root.replace(/\\/g, '/')}\nstage: build\n---\n# The site\n`);
  const logs = [];
  const ctx = { root, state, settings: SETTINGS, events: [], read: (rel) => fs.readFileSync(path.join(root, rel), 'utf8'), log: (e, d) => logs.push([e, d]) };
  return { root, ctx, logs };
}
const write = (root, rel, extra = {}) => ({ tool: 'Write', input: { file_path: path.join(root, rel), content: 'x' }, cwd: root, session_id: 's1', ...extra });
const GOOD_NOTE = '# Precedents\n\n- Linear changelog, https://linear.app/changelog: taken: one dated entry per change.\n- Stripe docs, https://stripe.com/docs: taken: the two-column layout.\n';

// ---------- the real case ----------
test('known-bad, the common case: a site is redesigned with no look at how others did it', () => {
  // A redesign starts straight away, with no web search and no precedents note. The first write of a screen file:
  const { root, ctx } = notebook();
  const r = pretool(write(root, 'app/src/app/page.tsx'), ctx);
  assert.ok(r && r.deny, 'the write must be refused');
  assert.match(r.deny, /rule 13/);
  assert.match(r.deny, /projects\/site\/precedents\.md/);
  assert.match(r.deny, /link and what was taken/);
});

// ---------- looking outside in this turn ----------
test('known-good: a web search earlier in this turn lets the write through', () => {
  const { root, ctx } = notebook();
  ctx.events = [{ tool: 'WebSearch', input: { query: 'changelog page examples' } }];
  assert.equal(pretool(write(root, 'app/src/app/page.tsx'), ctx), null);
});
test('known-good: a web fetch, or a page-reading helper, counts as looking outside', () => {
  const { root, ctx } = notebook();
  ctx.events = [{ tool: 'Agent', input: { subagent_type: 'web-fetch', prompt: 'read https://example.com' } }];
  assert.equal(pretool(write(root, 'core/x.mjs'), ctx), null);
  ctx.events = { tools: [{ tool: 'WebFetch', input: { url: 'https://example.com' } }] };
  assert.equal(pretool(write(root, 'core/x.mjs'), ctx), null);
});
test('known-bad: a fetch that failed, or a read of a local file, is not looking outside', () => {
  const { root, ctx } = notebook();
  ctx.events = [{ tool: 'WebFetch', input: { url: 'https://example.com' }, ok: false }, { tool: 'Read', input: { file_path: 'a.md' } }, { tool: 'Grep', input: {} }];
  assert.ok(pretool(write(root, 'core/x.mjs'), ctx).deny);
});
test('known-good: a curl of a web page in the shell counts; known-bad: a curl of nothing does not', () => {
  const { root, ctx } = notebook();
  ctx.events = { commands: ['curl -s https://registry.npmjs.org/react'] };
  assert.equal(pretool(write(root, 'core/x.mjs'), ctx), null);
  ctx.events = { commands: ['curl --version'] };
  assert.ok(pretool(write(root, 'core/x.mjs'), ctx).deny);
});

// ---------- looking outside earlier in this chat ----------
test('known-good: a search in an earlier turn of the same chat is remembered; known-bad: another chat does not inherit it', () => {
  const { root, ctx } = notebook();
  assert.equal(posttool({ tool: 'WebSearch', input: { query: 'secret project words' }, session_id: 's1' }, ctx), null);
  const rec = fs.readFileSync(path.join(ctx.state, 'precedents-looks.json'), 'utf8');
  assert.doesNotMatch(rec, /secret project words/, 'the words searched are never written down');
  assert.equal(pretool(write(root, 'app/a.tsx'), ctx), null);
  assert.ok(pretool(write(root, 'app/a.tsx', { session_id: 's2' }), ctx).deny);
});
test('known-bad: a search older than the time window no longer counts', () => {
  const { root, ctx } = notebook();
  fs.writeFileSync(path.join(ctx.state, 'precedents-looks.json'), JSON.stringify({ s1: Date.now() - 13 * 3600e3 }));
  assert.ok(pretool(write(root, 'app/a.tsx'), ctx).deny);
});

// ---------- the precedents note ----------
test('known-good: a precedents note with links and what was taken, in the project, lets the write through', () => {
  const { root, ctx } = notebook();
  fs.writeFileSync(path.join(root, 'projects', 'site', 'precedents.md'), GOOD_NOTE);
  assert.equal(pretool(write(root, 'app/src/app/page.tsx'), ctx), null);
});
test('known-bad: a note with no link, or that does not say what was taken, does not count, and the refusal says why', () => {
  const { root, ctx } = notebook();
  const f = path.join(root, 'projects', 'site', 'precedents.md');
  fs.writeFileSync(f, '# Precedents\n\n- Linear: taken: the changelog.\n');
  const r1 = pretool(write(root, 'app/a.tsx'), ctx);
  assert.match(r1.deny, /names no outside source/);
  fs.writeFileSync(f, '# Precedents\n\n- https://linear.app/changelog\n');
  assert.match(pretool(write(root, 'app/a.tsx'), ctx).deny, /does not say what was taken/);
  fs.writeFileSync(f, 'Some thoughts https://linear.app taken\n');
  assert.match(pretool(write(root, 'app/a.tsx'), ctx).deny, /no "Precedents" heading/);
});
test('known-bad: a note older than the fresh window was written for other work', () => {
  const { root, ctx } = notebook();
  const f = path.join(root, 'projects', 'site', 'precedents.md');
  fs.writeFileSync(f, GOOD_NOTE);
  const old = new Date(Date.now() - 60 * 86400e3);
  fs.utimesSync(f, old, old);
  assert.match(pretool(write(root, 'app/a.tsx'), ctx).deny, /days old/);
});
test('known-good: a shared design note counts for the files its "for:" line names; known-bad: not for others', () => {
  const { root, ctx } = notebook();
  fs.writeFileSync(path.join(root, 'system', 'design', 'precedents-site.md'), 'for: app/**\n\n' + GOOD_NOTE);
  assert.equal(pretool(write(root, 'app/src/app/page.tsx'), ctx), null);
  assert.ok(pretool(write(root, 'core/engine/x.mjs'), ctx).deny);
});
test('known-bad: a shared design note with no "for:" line covers nothing', () => {
  const { root, ctx } = notebook();
  fs.writeFileSync(path.join(root, 'system', 'design', 'precedents-site.md'), GOOD_NOTE);
  assert.ok(pretool(write(root, 'app/a.tsx'), ctx).deny);
});
test('known-good: a project note with a "for:" line covers only those files', () => {
  const { root, ctx } = notebook();
  fs.writeFileSync(path.join(root, 'projects', 'site', 'precedents.md'), 'for: app/**\n' + GOOD_NOTE);
  assert.equal(pretool(write(root, 'app/a.tsx'), ctx), null);
  assert.ok(pretool(write(root, 'core/a.mjs'), ctx).deny);
});
test('known-good: outside every project, a precedents note in the same folder counts', () => {
  const { ctx } = notebook();
  const other = path.join(BASE, 'loose' + n++);
  fs.mkdirSync(other, { recursive: true });
  const ev = { tool: 'Write', input: { file_path: path.join(other, 'tool.py') }, cwd: other, session_id: 'x' };
  assert.ok(pretool(ev, ctx).deny);
  fs.writeFileSync(path.join(other, 'precedents.md'), GOOD_NOTE);
  assert.equal(pretool(ev, ctx), null);
});
test('the notebook\'s own folder line (~/hive-mind) is matched to the notebook even when it is a copy elsewhere', () => {
  // The real state note of Hive Mind starts with a byte-order mark (an invisible first character); it must still be read.
  const { root, ctx } = notebook({ folderLine: '~/hive-mind', bom: true });
  const r = pretool(write(root, 'core/engine/x.mjs'), ctx);
  assert.match(r.deny, /projects\/site\/precedents\.md/);
});

// ---------- which writes are looked at ----------
test('known-good: notes, settings, built folders and reads are never stopped', () => {
  const { root, ctx } = notebook();
  assert.equal(pretool(write(root, 'projects/site/notes.md'), ctx), null);
  assert.equal(pretool(write(root, 'core/checks/x/settings.json'), ctx), null);
  assert.equal(pretool(write(root, 'app/node_modules/pkg/index.js'), ctx), null);
  assert.equal(pretool({ tool: 'Read', input: { file_path: path.join(root, 'app/a.tsx') }, session_id: 's1' }, ctx), null);
  assert.equal(pretool({ tool: 'Bash', command: 'cat app/a.tsx > /dev/null; node --test core/x.test.mjs', cwd: root, session_id: 's1' }, ctx), null);
});
test('known-bad: an edit, and a shell write into a program or screen file, are stopped too', () => {
  const { root, ctx } = notebook();
  assert.ok(pretool({ tool: 'Edit', input: { file_path: path.join(root, 'app/a.css'), old_string: 'a', new_string: 'b' }, cwd: root, session_id: 's1' }, ctx).deny);
  assert.ok(pretool({ tool: 'Bash', command: 'echo "body{}" > app/a.css', cwd: root, session_id: 's1' }, ctx).deny);
  assert.ok(pretool({ tool: 'PowerShell', command: 'Set-Content -Path app/b.ts -Value x', cwd: root, session_id: 's1' }, ctx).deny);
});
test('known-good: a temporary file is never stopped (with the default settings)', () => {
  const { ctx } = notebook();
  ctx.settings = undefined; // the module's own defaults
  const f = path.join(os.tmpdir(), 'scratch-' + n++ + '.mjs');
  assert.equal(pretool({ tool: 'Write', input: { file_path: f }, session_id: 's1' }, ctx), null);
});

// ---------- the contract ----------
test('the module has the contract\'s shape', () => {
  assert.equal(check.id, 'precedents');
  assert.equal(check.kind, 'discipline');
  assert.equal(check.mode, 'refuse');
  assert.match(check.rule, /13/);
  assert.equal(typeof check.about, 'string');
  assert.equal(typeof check.steps.pretool, 'function');
  assert.equal(typeof check.steps.posttool, 'function');
  assert.equal(noteFault(GOOD_NOTE, Date.now(), SETTINGS), '');
});
test('on its own error the check lets the step through and logs (a discipline check)', () => {
  const { root, ctx, logs } = notebook();
  Object.defineProperty(ctx, 'events', { get() { throw new Error('broken events'); } });
  assert.equal(pretool(write(root, 'app/a.tsx'), ctx), null);
  assert.ok(logs.some(([e, d]) => e === 'error' && /broken events/.test(d.message)));
  assert.equal(posttool({ tool: 'WebSearch', session_id: 's1' }, { root, state: '\u0000bad', settings: SETTINGS, log: ctx.log }), null);
  assert.ok(logs.filter(([e]) => e === 'error').length >= 2);
});
test('it is fast: under 50 ms for a step on ordinary input', () => {
  const { root, ctx } = notebook();
  fs.writeFileSync(path.join(root, 'projects', 'site', 'precedents.md'), GOOD_NOTE);
  pretool(write(root, 'app/a.tsx'), ctx); // warm up
  const runs = 20;
  const t = performance.now();
  for (let i = 0; i < runs; i++) { pretool(write(root, 'app/a.tsx'), ctx); pretool(write(root, 'core/b.mjs'), ctx); }
  const each = (performance.now() - t) / (runs * 2);
  assert.ok(each < 50, `one step took ${each.toFixed(2)} ms`);
});
