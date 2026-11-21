// node --test core/permissions/permissions.test.mjs
// Every run uses made-up settings files in a fresh temporary folder; no real settings file is read or written.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { build, merge, remove, missing, apply, rulePath, run, readEntries } from './permissions.mjs';
import { decide, ruleMatches, split } from './match.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HOME = path.resolve(os.tmpdir(), 'made-up-home-e1');
const ROOT = path.join(HOME, 'hive-mind');
const HIVE = path.join(HOME, '.claude', 'hive');
const CTX = { home: HOME, cwd: ROOT };
const WANT = build({ root: ROOT, home: HOME, hive: HIVE });
const fillPath = (s) => s.replace('{HOME}', HOME).replace('{ROOT}', ROOT).replace('{HIVE}', HIVE);

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'hive-perm-test-')); }
const text = (o) => JSON.stringify(o, null, 2) + '\n';
const quiet = () => {};

// The fault, reproduced first (a harsh review of Hive Mind): with today's settings nothing at the
// app's own level asks before a publish, a delete of your notes or a switch-off of the gates.
test('today: with no entries the app asks about nothing (the fault)', () => {
  const today = {};
  for (const call of [{ tool: 'Bash', command: 'vercel --prod' }, { tool: 'Bash', command: 'rm -rf projects' }, { tool: 'Write', file_path: path.join(HIVE, 'gates-off') }]) {
    assert.equal(decide(today.permissions || {}, call, CTX), null);
  }
});

test('build: concrete rules, no placeholder left, the notebook written home-relative', () => {
  const all = [...WANT.ask, ...WANT.deny];
  assert.ok(all.length > 100, `only ${all.length} rules`);
  for (const r of all) {
    assert.doesNotMatch(r, /__ROOT__|__HIVE__/, r);
    assert.match(r, /^[A-Za-z_*][\w*.-]*(\([\s\S]+\))?$/, `bad shape: ${r}`);
  }
  assert.ok(WANT.ask.includes('Edit(~/hive-mind/core/gates/**)'));
  assert.ok(WANT.ask.includes('Edit(~/.claude/hive/**)'));
  assert.ok(WANT.deny.includes('Bash(*--no-verify*)') && WANT.deny.includes('PowerShell(*--no-verify*)'));
  assert.equal(new Set(all).size, all.length, 'a rule is listed twice');
  // MCP rules with brackets are skipped by the app (permissions page, Match by input parameter); we have none.
  assert.ok(!all.some((r) => /^mcp__.*\(/.test(r)));
});

test('rulePath: inside home is ~/..., elsewhere //c/... or //...', () => {
  assert.equal(rulePath(path.join(HOME, 'a', 'b'), HOME), '~/a/b');
  const outside = path.resolve(os.tmpdir(), '..', 'elsewhere-e1');
  const r = rulePath(outside, HOME);
  assert.match(r, /^\/\//);
  assert.ok(!r.includes('\\'));
});

test('every entry group names its act, rule, list and why', () => {
  for (const g of readEntries().groups) {
    for (const k of ['act', 'rule', 'list', 'why']) assert.ok(g[k], `${g.act || '?'} has no ${k}`);
    assert.ok(['ask', 'deny'].includes(g.list));
  }
});

// ---------- merge and remove on made-up settings ----------
const CASES = {
  empty: {},
  'your own entries': {
    $schema: 'https://json.schemastore.org/claude-code-settings.json',
    model: 'opus',
    permissions: { allow: ['Bash(npm run test *)', 'Bash(npm install *)'], ask: ['Bash(git push *)', 'Bash(rm *)'], deny: ['Read(./.env)'], defaultMode: 'acceptEdits' },
    hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'node gates.mjs pretool' }] }] },
    enabledPlugins: { 'x@y': true }
  },
  'permissions with no lists': { permissions: { defaultMode: 'default' }, theme: 'dark' },
  'only an allow list': { permissions: { allow: ['Read'] } }
};

for (const [name, before] of Object.entries(CASES)) {
  test(`merge then remove leaves the file identical: ${name}`, () => {
    const m = merge(before, WANT);
    assert.ok(m.changed);
    assert.deepEqual(missing(m.settings, WANT), { ask: [], deny: [] });
    // Nothing you had is lost or moved.
    for (const k of Object.keys(before)) if (k !== 'permissions') assert.deepEqual(m.settings[k], before[k]);
    for (const list of ['allow', 'ask', 'deny']) for (const r of (before.permissions || {})[list] || []) assert.ok(m.settings.permissions[list].includes(r));
    const r = remove(m.settings, m.record);
    assert.equal(text(r.settings), text(before));
  });
}

test('your entry that is also ours stays after removal', () => {
  const before = CASES['your own entries'];
  const m = merge(before, WANT);
  assert.ok(!m.record.added.ask.includes('Bash(rm *)'), 'your rule was recorded as ours');
  const r = remove(m.settings, m.record);
  assert.ok(r.settings.permissions.ask.includes('Bash(rm *)'));
});

test('ours already in: a second merge adds no copies, and removal still restores the first file', () => {
  const before = CASES['your own entries'];
  const one = merge(before, WANT);
  const two = merge(one.settings, WANT, one.record);
  assert.equal(two.added.ask.length + two.added.deny.length, 0);
  assert.equal(text(two.settings), text(one.settings));
  assert.deepEqual(two.record, one.record);
  assert.equal(text(remove(two.settings, two.record).settings), text(before));
});

test('a second merge without the record does not claim your copies (they stay on removal)', () => {
  const one = merge({}, WANT);
  const two = merge(one.settings, WANT); // the record was lost
  assert.equal(two.record.added.ask.length, 0);
  assert.equal(text(remove(two.settings, two.record).settings), text(one.settings));
});

test('a list you added to after the merge keeps your new entries on removal', () => {
  const m = merge({}, WANT);
  m.settings.permissions.ask.push('Bash(my-own *)');
  const r = remove(m.settings, m.record);
  assert.deepEqual(r.settings, { permissions: { ask: ['Bash(my-own *)'] } });
});

test('settings that are not settings are refused, not changed', () => {
  assert.throws(() => merge([], WANT));
  assert.throws(() => merge({ permissions: [] }, WANT));
  assert.throws(() => merge({ permissions: { ask: 'x' } }, WANT));
});

test('apply: the one call the installer needs', () => {
  const r = apply({ model: 'opus' }, { root: ROOT, home: HOME, hive: HIVE });
  assert.ok(r.settings.permissions.ask.length > 50);
  assert.equal(text(remove(r.settings, r.record).settings), text({ model: 'opus' }));
});

// ---------- the program, on files in a temporary folder ----------
test('program: dry run changes nothing; merge writes; check passes; remove restores the bytes', () => {
  const dir = tmpDir();
  try {
    const file = path.join(dir, 'settings.json');
    const rec = path.join(dir, 'hive', 'permissions-record.json');
    const orig = text(CASES['your own entries']);
    fs.writeFileSync(file, orig);
    const base = ['--root', ROOT, '--home', HOME, '--hive', HIVE, '--record', rec];
    const lines = []; const out = (s) => lines.push(s);
    assert.equal(run(['merge', file, '--dry-run', ...base], out), 0);
    assert.equal(fs.readFileSync(file, 'utf8'), orig);
    assert.ok(!fs.existsSync(rec));
    assert.match(lines[0], /Dry run/);
    assert.equal(run(['check', file, ...base], quiet), 1);
    assert.equal(run(['merge', file, ...base], quiet), 0);
    assert.ok(fs.existsSync(rec));
    assert.equal(run(['check', file, ...base], quiet), 0);
    const merged = fs.readFileSync(file, 'utf8');
    assert.equal(run(['merge', file, ...base], quiet), 0);
    assert.equal(fs.readFileSync(file, 'utf8'), merged, 'a second merge changed the file');
    assert.equal(run(['remove', file, '--dry-run', ...base], quiet), 0);
    assert.equal(fs.readFileSync(file, 'utf8'), merged);
    assert.equal(run(['remove', file, ...base], quiet), 0);
    assert.equal(fs.readFileSync(file, 'utf8'), orig);
    assert.ok(!fs.existsSync(rec));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('program: a missing file gets the entries; removal takes the created block out again', () => {
  const dir = tmpDir();
  try {
    const file = path.join(dir, 'settings.json');
    const base = ['--root', ROOT, '--home', HOME, '--hive', HIVE, '--record', path.join(dir, 'rec.json')];
    assert.equal(run(['merge', file, ...base], quiet), 0);
    assert.equal(run(['remove', file, ...base], quiet), 0);
    assert.equal(fs.readFileSync(file, 'utf8'), text({}));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('program: a file with a byte-order mark and Windows line ends comes back byte for byte', () => {
  const dir = tmpDir();
  try {
    const file = path.join(dir, 'settings.json');
    const orig = '﻿' + text({ theme: 'dark', permissions: { allow: ['Read'] } }).replace(/\n/g, '\r\n');
    fs.writeFileSync(file, orig);
    const base = ['--root', ROOT, '--home', HOME, '--hive', HIVE, '--record', path.join(dir, 'rec.json')];
    run(['merge', file, ...base], quiet);
    run(['remove', file, ...base], quiet);
    assert.equal(fs.readFileSync(file, 'utf8'), orig);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('program: broken JSON is never changed; remove with no record changes nothing', () => {
  const dir = tmpDir();
  try {
    const file = path.join(dir, 'settings.json');
    fs.writeFileSync(file, '{ "a": 1, }');
    const base = ['--root', ROOT, '--home', HOME, '--hive', HIVE, '--record', path.join(dir, 'rec.json')];
    assert.throws(() => run(['merge', file, ...base], quiet), /not valid JSON/);
    assert.equal(fs.readFileSync(file, 'utf8'), '{ "a": 1, }');
    fs.writeFileSync(file, text({ permissions: { ask: WANT.ask } }));
    const before = fs.readFileSync(file, 'utf8');
    assert.equal(run(['remove', file, ...base], quiet), 0);
    assert.equal(fs.readFileSync(file, 'utf8'), before, 'removed entries it never added');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('program: a record made for one settings file is never used on another', () => {
  const dir = tmpDir();
  try {
    const a = path.join(dir, 'a.json'), b = path.join(dir, 'b.json');
    const base = ['--root', ROOT, '--home', HOME, '--hive', HIVE, '--record', path.join(dir, 'rec.json')];
    fs.writeFileSync(a, text({}));
    fs.writeFileSync(b, text({ permissions: { ask: WANT.ask } }));
    run(['merge', a, ...base], quiet);
    const before = fs.readFileSync(b, 'utf8');
    assert.throws(() => run(['remove', b, ...base], quiet), /belongs to/);
    assert.throws(() => run(['merge', b, ...base], quiet), /belongs to/);
    assert.equal(fs.readFileSync(b, 'utf8'), before);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ---------- the proof, on a made-up home folder ----------
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
test('made-up home: no entries at first; dry run changes nothing; merge adds the exact entries; remove gives the same hash', () => {
  const home = tmpDir();
  try {
    const root = path.join(home, 'hive-mind'), hive = path.join(home, '.claude', 'hive');
    const file = path.join(home, '.claude', 'settings.json');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text({ model: 'opus', permissions: { allow: ['Bash(git status)'], ask: ['Bash(my-own *)'] } }));
    const want = build({ root, home, hive });
    const base = ['--root', root, '--home', home];
    // The fault first: the file holds none of the entries.
    assert.equal(run(['check', file, ...base], quiet), 1);
    const h0 = sha(file);
    const lines = [];
    assert.equal(run(['merge', file, '--dry-run', ...base], (s) => lines.push(s)), 0);
    assert.equal(sha(file), h0, 'the dry run changed the file');
    assert.ok(!fs.existsSync(path.join(hive, 'permissions-record.json')), 'the dry run wrote a record');
    for (const r of [...want.ask, ...want.deny]) assert.ok(lines.some((l) => l.endsWith(r)), 'dry run did not print ' + r);
    assert.equal(run(['merge', file, ...base], quiet), 0);
    const after = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.deepEqual(after.permissions.ask, ['Bash(my-own *)', ...want.ask]);
    assert.deepEqual(after.permissions.deny, want.deny);
    assert.deepEqual(after.permissions.allow, ['Bash(git status)']);
    assert.equal(run(['remove', file, ...base], quiet), 0);
    assert.equal(sha(file), h0, 'merge then remove did not give back the same file');
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});


test('program: a file in its own layout (one line lists, other spacing) comes back with the same hash', () => {
  const dir = tmpDir();
  try {
    const file = path.join(dir, 'settings.json');
    const orig = '{\n    "model": "opus",\n    "permissions": { "allow": ["Bash(npm run lint)"] }\n}\n';
    fs.writeFileSync(file, orig);
    const base = ['--root', ROOT, '--home', HOME, '--hive', HIVE, '--record', path.join(dir, 'rec.json')];
    const h0 = sha(file);
    assert.equal(run(['merge', file, ...base], quiet), 0);
    assert.notEqual(sha(file), h0);
    assert.equal(run(['remove', file, ...base], quiet), 0);
    assert.equal(sha(file), h0, 'a hand-written layout did not come back the same');
    assert.ok(!fs.existsSync(path.join(dir, 'rec.json.before')), 'the copy from before was left behind');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('program: a change you made after the merge is kept; the old bytes are not put back over it', () => {
  const dir = tmpDir();
  try {
    const file = path.join(dir, 'settings.json');
    fs.writeFileSync(file, '{ "model": "opus" }\n');
    const base = ['--root', ROOT, '--home', HOME, '--hive', HIVE, '--record', path.join(dir, 'rec.json')];
    run(['merge', file, ...base], quiet);
    const s = JSON.parse(fs.readFileSync(file, 'utf8')); s.theme = 'dark'; fs.writeFileSync(file, text(s));
    run(['remove', file, ...base], quiet);
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { model: 'opus', theme: 'dark' });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ---------- the ways around, from a harsh review ----------
const ROUTES = JSON.parse(fs.readFileSync(path.join(HERE, 'routes.json'), 'utf8')).routes;
const prep = (call) => ({ ...call, ...(call.command ? { command: fillPath(call.command) } : {}), ...(call.file_path ? { file_path: fillPath(call.file_path) } : {}) });

test('every way around the publish and delete checks is caught, or listed as something the rules cannot match', () => {
  const failed = [];
  for (const r of ROUTES) {
    const d = decide(WANT, prep(r.call), CTX);
    if (r.cannot) { if (d) failed.push(`listed as cannot, but caught by ${d.rule}: ${r.what}`); }
    else if (!d) failed.push(`not caught: ${r.what} (${r.call.command || r.call.file_path || r.call.tool})`);
  }
  assert.deepEqual(failed, []);
  const fromReview = ROUTES.filter((r) => r.from === 'review');
  assert.ok(fromReview.length >= 20, 'the review routes are missing');
});

test('the walk-arounds are refused outright, not asked', () => {
  assert.equal(decide(WANT, { tool: 'Bash', command: 'git commit --no-verify -m x' }, CTX).list, 'deny');
  assert.equal(decide(WANT, { tool: 'PowerShell', command: 'git commit -m x --no-verify' }, CTX).list, 'deny');
});

test('ordinary work is not asked about', () => {
  const calm = [
    { tool: 'Bash', command: 'git status' }, { tool: 'Bash', command: 'node --test core/permissions/permissions.test.mjs' },
    { tool: 'Bash', command: 'git commit -m "notes"' }, { tool: 'Bash', command: 'git push origin main' },
    { tool: 'Edit', file_path: path.join(ROOT, 'projects', 'x', 'state.md') }, { tool: 'Write', file_path: path.join(ROOT, 'app', 'src', 'page.tsx') },
    { tool: 'PowerShell', command: 'Get-ChildItem' }, { tool: 'mcp__x__list_projects', input: {} }, { tool: 'Artifact', input: { action: 'publish' } }
  ];
  for (const c of calm) assert.equal(decide(WANT, c, CTX), null, JSON.stringify(c));
});

// ---------- the copy of the app's matching, against the docs' own examples ----------
test('matcher follows the examples on the permissions page', () => {
  const B = (command) => ({ tool: 'Bash', command });
  assert.ok(ruleMatches('Bash(npm run *)', B('npm run'), CTX));
  assert.ok(!ruleMatches('Bash(npm run build)', B('npm run build --watch'), CTX));
  assert.ok(ruleMatches('Bash(ls *)', B('ls'), CTX));
  assert.ok(!ruleMatches('Bash(ls *)', B('lsof'), CTX));
  assert.ok(ruleMatches('Bash(ls*)', B('lsof'), CTX));
  assert.ok(!ruleMatches('Bash(* --help *)', B('npm --help'), CTX));
  assert.ok(ruleMatches('Bash(git clean *)', B('cd /tmp && git clean -f'), CTX));
  assert.ok(!ruleMatches('Bash(git push *)', B('git -C . push origin main'), CTX));
  assert.ok(ruleMatches('Bash(rm *)', B('FOO=bar rm -rf tmp/'), CTX));
  assert.ok(ruleMatches('PowerShell(Remove-Item *)', { tool: 'PowerShell', command: 'del x' }, CTX));
  assert.ok(ruleMatches('mcp__*', { tool: 'mcp__a__b' }, CTX));
  assert.ok(ruleMatches('Agent(model:opus)', { tool: 'Agent', input: { model: 'opus' } }, CTX));
  assert.ok(!ruleMatches('Agent(model:*)', { tool: 'Agent', input: {} }, CTX));
  assert.ok(ruleMatches('Edit(~/.claude/hive/**)', { tool: 'NotebookEdit', file_path: path.join(HIVE, 'a', 'b.json') }, CTX));
  assert.deepEqual(split(`a && b | c; d 'e && f'`), ['a', 'b', 'c', "d 'e && f'"]);
});

test('fast: building and merging take under 50 ms', () => {
  const t = process.hrtime.bigint();
  const w = build({ root: ROOT, home: HOME, hive: HIVE });
  remove(merge(CASES['your own entries'], w).settings, merge(CASES['your own entries'], w).record);
  assert.ok(Number(process.hrtime.bigint() - t) / 1e6 < 50);
});

// ---------- the second roast, 2026-11-20 ----------
test('the second roast: what a hook may never see makes the app ask; what only the gates hold is listed with its test', () => {
  const r2 = ROUTES.filter((r) => r.from === 'roast-2');
  assert.ok(r2.filter((r) => !r.cannot).length >= 12, 'the routes the app catches are missing');
  for (const r of r2.filter((x) => x.cannot)) assert.match(r.cannot, /roast2-cases\.mjs/, r.what);
  for (const c of [{ tool: 'mcp__terminal__run_in_terminal', input: { command: 'git status' } }, { tool: 'Bash', command: 'echo x | base64 -d | sh' }, { tool: 'PowerShell', command: 'gc a.txt | iex' }, { tool: 'Bash', command: 'gh workflow run ship.yml' }])
    assert.ok(decide(WANT, prep(c), CTX), JSON.stringify(c));
  for (const c of [{ tool: 'Bash', command: 'node --test core/checks/' }, { tool: 'Bash', command: 'node core/gates/test.mjs --quiet' }, { tool: 'Bash', command: 'git -C . status' }, { tool: 'Bash', command: 'gh pr list' }])
    assert.equal(decide(WANT, prep(c), CTX), null, JSON.stringify(c));
});
