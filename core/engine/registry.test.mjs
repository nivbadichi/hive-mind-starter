// Tests for registry.mjs. Temporary folders only: a fake notebook and a fake Claude folder.
//   node --test core/engine/registry.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const PROG = path.join(path.dirname(fileURLToPath(import.meta.url)), 'registry.mjs');
const w = (root, rel, text) => { const p = path.join(root, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); };

function world() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'registry-test-'));
  const root = path.join(base, 'notebook'); const claude = path.join(base, 'claude');
  w(root, 'system/rules.md', '# Rules\n\n1. Ask first before anything public. More words.\n9. No secrets in notes.\n11. Show the progress map.\n12. The strongest model plans.\n');
  w(root, 'system/capabilities.md', '| | |\n|---|---|\n| Connectors | Use for: GitHub (code). Not for this: Canva, Zoom. |\n| Connectors | Use for: Canva. Not for this: GitHub. |\n');
  w(root, 'system/catalogue.md', '| Tool | What for | Source | Status |\n| --- | --- | --- | --- |\n| Vercel | Deploy | Directory | Connected |\n| Axe MCP | Accessibility | Vendor (Deque) | Review first |\n| **Suggested additions (1):** | | | |\n');
  w(claude, 'skills/design-one/SKILL.md', '---\nname: design-one\ndescription: Make an interface look designed.\n---\n');
  w(claude, 'skills/stock-thing/SKILL.md', '---\nname: stock-thing\ndescription: Screen stocks for a trading idea.\n---\n');
  w(claude, 'skills/.trash/SKILL.md', 'x');
  w(claude, 'IMPORTED_SKILLS.md', '# x\n\n## Design\n| Skill | Use it for |\n|---|---|\n| `design-one` | Interfaces |\n| `ghost-skill` | Not on disk |\n');
  w(claude, 'SKILL_MAP.md', '# map\n\n| Category | Use for | Skills |\n|---|---|---|\n| **Design** | Screens | design-one, engineering:debug, simplify |\n\n## My own helpers\n\n| Agent | Categories | Core skills |\n|---|---|---|\n| Writer | Coding | health-check, design-one |\n');
  const env = { ...process.env, HIVE_ROOT: root, CLAUDE_DIR: claude, HIVE_DATE: '2026-11-18', HIVE_PLUGIN_LIST: 'none' };
  const run = (...a) => { const r = spawnSync(process.execPath, [PROG, ...a], { env, encoding: 'utf8' }); return { code: r.status, out: r.stdout, err: r.stderr }; };
  const reg = () => JSON.parse(fs.readFileSync(path.join(root, 'system/registry.json'), 'utf8'));
  const get = (id) => reg().entries.find((e) => e.id === id);
  return { root, claude, env, run, reg, get };
}

test('seed: states, sources and nothing invented', () => {
  const t = world(); assert.equal(t.run('seed').code, 0);
  assert.equal(t.get('design-one').state, 'active');
  assert.deepEqual(t.get('design-one').fits, ['design']);
  assert.equal(t.get('stock-thing').state, 'installed-unused');
  assert.deepEqual(t.get('stock-thing').fits, ['trading']);
  assert.equal(t.get('ghost-skill').state, 'listed-not-installed');
  assert.equal(t.get('health-check').state, 'listed-not-installed');
  assert.equal(t.get('engineering:debug').source, 'plugin');
  assert.equal(t.get('simplify').source, 'vendor');
  assert.equal(t.get('.trash'), undefined);
  assert.equal(t.get('design-one').model, '');
  assert.equal(t.get('design-one').by, 'seeded 2026-11-18');
});

test('seed: connectors come from the catalogue and the capability map', () => {
  const t = world(); t.run('seed');
  assert.equal(t.get('vercel').state, 'active'); assert.equal(t.get('vercel').review, 'official');
  assert.equal(t.get('axe-mcp').state, 'listed-not-installed'); assert.equal(t.get('axe-mcp').review, 'needed');
  assert.equal(t.get('github').state, 'active');
  assert.equal(t.get('zoom').state, 'installed-unused');
  assert.equal(t.get('suggested-additions-1'), undefined);
});

test('seed: rules become protocols; only held ones carry a check', () => {
  const t = world(); t.run('seed');
  assert.equal(t.get('rule-1').enforce, null);
  assert.equal(t.get('rule-1').text, 'Ask first before anything public.');
  assert.ok(t.get('rule-9').enforce); assert.ok(t.get('rule-11').enforce);
  assert.equal(t.get('rule-12').enforce, null);
});

test('seed never overwrites an entry that exists', () => {
  const t = world(); t.run('seed');
  t.run('set', 'design-one', 'model', 'smallest');
  const before = t.reg().entries.length;
  const r = t.run('seed');
  assert.match(r.out, /0 new entries/);
  assert.equal(t.reg().entries.length, before);
  assert.equal(t.get('design-one').model, 'smallest');
});

test('add, set, remove', () => {
  const t = world(); t.run('seed');
  assert.equal(t.run('add', '--id', 'always-short', '--kind', 'preference', '--text', 'Keep replies short.', '--by', 'their words').code, 0);
  assert.equal(t.get('always-short').added, '2026-11-18');
  assert.notEqual(t.run('add', '--id', 'always-short', '--kind', 'preference').code, 0, 'a duplicate is refused');
  assert.notEqual(t.run('add', '--id', 'x', '--kind', 'banana').code, 0, 'a bad kind is refused');
  t.run('set', 'stock-thing', 'fits', 'trading, research');
  assert.deepEqual(t.get('stock-thing').fits, ['trading', 'research']);
  t.run('set', 'rule-9', 'enforce', 'null');
  assert.equal(t.get('rule-9').enforce, null);
  assert.notEqual(t.run('set', 'stock-thing', 'state', 'gone').code, 0);
  assert.notEqual(t.run('set', 'nope', 'text', 'x').code, 0);
  assert.notEqual(t.run('remove', 'stock-thing').code, 0, 'a reason is required');
  t.run('remove', 'stock-thing', '--reason', 'Not used for trading any more');
  assert.equal(t.get('stock-thing').state, 'removed');
  assert.equal(t.get('stock-thing').reason, 'Not used for trading any more');
  assert.ok(fs.existsSync(path.join(t.claude, 'skills/stock-thing/SKILL.md')), 'no file is deleted');
});

test('list filters and find picks by task words', () => {
  const t = world(); t.run('seed');
  const byKind = t.run('list', '--kind', 'protocol').out.trim().split('\n');
  assert.equal(byKind.length, 4);
  assert.match(t.run('list', '--state', 'listed-not-installed').out, /ghost-skill/);
  assert.match(t.run('list', '--fits', 'trading').out, /stock-thing/);
  assert.doesNotMatch(t.run('list', '--fits', 'trading').out, /design-one/);
  const found = t.run('find', 'screen', 'stocks', 'for', 'trading').out;
  assert.match(found.split('\n')[0], /stock-thing/);
  assert.match(t.run('find', 'zzzz').out, /Nothing/);
  t.run('remove', 'stock-thing', '--reason', 'x');
  assert.doesNotMatch(t.run('find', 'trading').out, /stock-thing/, 'removed entries are not offered');
});

test('render writes only system/generated and marks text-only protocols', () => {
  const t = world(); t.run('seed');
  const claudeBefore = fs.readFileSync(path.join(t.claude, 'SKILL_MAP.md'), 'utf8');
  assert.equal(t.run('render').code, 0);
  const gen = path.join(t.root, 'system/generated');
  assert.deepEqual(fs.readdirSync(gen).sort(), ['IMPORTED_SKILLS.md', 'SKILL_MAP.md', 'registry.md']);
  const md = fs.readFileSync(path.join(gen, 'registry.md'), 'utf8');
  assert.match(md, /\*\*rule-12\*\*.*text only: nothing checks this yet/);
  assert.doesNotMatch(md, /\*\*rule-9\*\*.*text only/);
  assert.match(md, /### Trading/);
  const map = fs.readFileSync(path.join(gen, 'SKILL_MAP.md'), 'utf8');
  assert.match(map, /\| \*\*Design\*\* \| Screens \| .*design-one/);
  assert.match(map, /## My own helpers\n[\s\S]*\| Writer \|/, 'a section of your own under the table is kept');
  const imp = fs.readFileSync(path.join(gen, 'IMPORTED_SKILLS.md'), 'utf8');
  assert.match(imp, /## Design\n\| Skill \| Use it for \|[\s\S]*`design-one` \| Interfaces/);
  assert.match(imp, /`stock-thing`/);
  assert.equal(fs.readFileSync(path.join(t.claude, 'SKILL_MAP.md'), 'utf8'), claudeBefore, 'the Claude folder is untouched');
});

test('check: passes after seed and render, then names what is behind', () => {
  const t = world(); t.run('seed'); t.run('render');
  const ok = t.run('check');
  assert.equal(ok.code, 0, ok.out);
  assert.equal(ok.out.trim().split('\n').every((l) => l.startsWith('OK|')), true);
  // a new skill folder that is not in the registry
  w(t.claude, 'skills/new-one/SKILL.md', '---\ndescription: New.\n---\n');
  assert.match(t.run('check').out, /NEEDS\|Every installed skill folder is in the registry.*new-one/);
  t.run('seed'); assert.equal(t.run('check').code, 1, 'the generated lists are now behind');
  assert.match(t.run('check').out, /NEEDS\|The generated lists are up to date.*registry\.md/);
  t.run('render'); assert.equal(t.run('check').code, 0);
  // an active folder skill that is no longer installed
  fs.rmSync(path.join(t.claude, 'skills/design-one'), { recursive: true });
  assert.match(t.run('check').out, /NEEDS\|Every active skill from a folder is installed.*design-one/);
});

test('check: a protocol with no check and no wording is flagged', () => {
  const t = world(); t.run('seed');
  t.run('set', 'rule-12', 'text', ''); t.run('render');
  assert.match(t.run('check').out, /NEEDS\|Every protocol.*rule-12/);
});

// ---------- install recipes and starting sets ----------
const BUILT = '{"type":"built-in"}';
const KW = '{"type":"plugin","plugin":"engineering","marketplace":"knowledge-work-plugins","source":"anthropics/knowledge-work-plugins"}';
const CONN = '{"type":"connector","directory":"Gmail","link":"https://claude.ai/directory"}';
function setWorld() {
  const t = world();
  const base = path.dirname(t.root);
  t.env.HIVE_PLUGIN_LIST = path.join(base, 'plugins.txt');
  w(base, 'plugins.txt', 'Installed plugins:\n');
  w(t.root, 'system/preferences.md', '# Wishes\n\n- default, not confirmed yet: Speak plainly.\n');
  t.run('seed');
  const add = (...a) => { const r = t.run('add', ...a); assert.equal(r.code, 0, r.err); };
  assert.equal(t.get('engineering:debug').install.marketplace, 'knowledge-work-plugins', 'seed writes the recipe it knows');
  t.run('set', 'engineering:debug', 'state', 'listed-not-installed');
  add('--id', 'engineering:review', '--kind', 'skill', '--state', 'listed-not-installed', '--source', 'plugin');
  t.run('set', 'engineering:review', 'install', KW);
  add('--id', 'run', '--kind', 'skill', '--state', 'listed-not-installed', '--source', 'vendor');
  t.run('set', 'run', 'install', BUILT);
  add('--id', 'mail', '--kind', 'connector', '--state', 'listed-not-installed', '--source', 'directory');
  t.run('set', 'mail', 'install', CONN);
  add('--id', 'try-it', '--kind', 'preference', '--state', 'listed-not-installed', '--text', 'Explain first, then let me try.');
  add('--id', 'basic', '--kind', 'set', '--members', 'engineering:debug,run,mail', '--about', 'Basics', '--default', 'true');
  add('--id', 'plus', '--kind', 'set', '--extends', 'basic', '--members', 'engineering:review,try-it,design-one');
  return t;
}
const bytes = (t) => fs.readFileSync(path.join(t.root, 'system/registry.json'), 'utf8');
const prefsOf = (t) => fs.readFileSync(path.join(t.root, 'system/preferences.md'), 'utf8');

test('recipes: a bad one is refused, a good one is kept', () => {
  const t = world(); t.run('seed');
  assert.notEqual(t.run('set', 'simplify', 'install', '{"type":"teleport"}').code, 0);
  assert.notEqual(t.run('set', 'simplify', 'install', '{"type":"plugin","plugin":"x"}').code, 0, 'a plugin recipe needs its catalogue');
  assert.notEqual(t.run('set', 'simplify', 'install', 'not json').code, 0);
  assert.equal(t.run('set', 'simplify', 'install', BUILT).code, 0);
  assert.deepEqual(t.get('simplify').install, { type: 'built-in' });
  assert.equal(t.run('set', 'design-one', 'install', '{"type":"folder","source":"a link","licence":"MIT"}').code, 0);
  assert.equal(t.run('set', 'ghost-skill', 'install', '{"type":"unconfirmed","note":"Not found."}').code, 0);
  assert.equal(t.run('set', 'vercel', 'install', CONN).code, 0);
});

test('check: a named-not-installed entry with no recipe is flagged', () => {
  const t = world(); t.run('seed');
  assert.equal(t.get('ghost-skill').install.type, 'unconfirmed', 'seed says plainly when no route is known');
  assert.equal(t.get('axe-mcp').install.type, 'unconfirmed');
  assert.equal(t.get('simplify').install.type, 'built-in');
  t.run('set', 'ghost-skill', 'install', 'null'); t.run('render');
  assert.match(t.run('check').out, /NEEDS\|Every skill and connector that is named but not installed has an install recipe.*ghost-skill/);
  t.run('set', 'ghost-skill', 'install', BUILT); t.run('render');
  assert.doesNotMatch(t.run('check').out, /NEEDS\|Every skill and connector that is named/);
});

test('sets: members resolve through extends; list --set prints them', () => {
  const t = setWorld();
  const out = t.run('list', '--set', 'plus').out;
  for (const id of ['engineering:debug', 'mail', 'try-it', 'design-one']) assert.match(out, new RegExp(id));
  assert.notEqual(t.run('list', '--set', 'nope').code, 0);
  assert.notEqual(t.run('add', '--id', 'empty', '--kind', 'set').code, 0, 'a set needs members');
});

test('apply --dry-run prints the steps and writes nothing', () => {
  const t = setWorld(); const before = bytes(t);
  const r = t.run('apply', 'plus', '--dry-run');
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /dry run/);
  assert.match(r.out, /\/plugin marketplace add anthropics\/knowledge-work-plugins/);
  assert.match(r.out, /\/plugin install engineering@knowledge-work-plugins/);
  assert.match(r.out, /Connect "Gmail"/);
  assert.match(r.out, /run comes built into Claude Code/);
  assert.equal((r.out.match(/marketplace add/g) || []).length, 1, 'one catalogue step however many skills use it');
  assert.equal(bytes(t), before);
  assert.doesNotMatch(prefsOf(t), /Explain first/);
  assert.equal(t.run('apply', '--dry-run', 'plus').code, 0, 'the flag may come first');
  assert.equal(bytes(t), before);
});

test('apply: marks what needs no yes, installs nothing, and a second apply changes nothing', () => {
  const t = setWorld(); t.run('render');
  const claudeBefore = fs.readdirSync(path.join(t.claude, 'skills')).join();
  const r = t.run('apply', 'plus');
  assert.equal(r.code, 0, r.err);
  assert.equal(t.get('run').state, 'active');
  assert.equal(t.get('try-it').state, 'active');
  assert.equal(t.get('engineering:debug').state, 'listed-not-installed', 'a plugin waits for a yes');
  assert.equal(t.get('mail').state, 'listed-not-installed', 'a connector waits for a yes');
  assert.equal(t.get('plus').applied, '2026-11-18');
  assert.match(prefsOf(t), /- 2026-11-18: Explain first, then let me try\./);
  assert.equal(fs.readdirSync(path.join(t.claude, 'skills')).join(), claudeBefore, 'the Claude folder is untouched');
  const c = t.run('check'); assert.equal(c.code, 0, c.out);
  assert.equal(c.out.trim().split('\n').every((l) => l.startsWith('OK|')), true);
  const snap = bytes(t); const prefs = prefsOf(t);
  const again = t.run('apply', 'plus');
  assert.match(again.out, /Nothing changed/);
  assert.equal(bytes(t), snap); assert.equal(prefsOf(t), prefs);
});

test('apply: a set that names something missing is refused and nothing is written', () => {
  const t = setWorld();
  assert.equal(t.run('set', 'basic', 'members', 'engineering:debug,not-a-skill').code, 0);
  const before = bytes(t);
  const bad = t.run('apply', 'basic');
  assert.notEqual(bad.code, 0);
  assert.match(bad.err, /not-a-skill.*not in the registry/);
  assert.notEqual(t.run('apply', 'nonesuch').code, 0);
  assert.match(t.run('check').out, /NEEDS\|Every starting set names only things that are in the registry.*not-a-skill/);
  assert.equal(bytes(t), before);
});

test('apply: an entry you removed is left out, not brought back', () => {
  const t = setWorld();
  t.run('remove', 'try-it', '--reason', 'Not for me');
  const r = t.run('apply', 'plus');
  assert.match(r.out, /try-it: you removed it \(Not for me\)/);
  assert.equal(t.get('try-it').state, 'removed');
  assert.doesNotMatch(prefsOf(t), /Explain first/);
});

test('plugin list: an installed plugin counts as present; one marked in use but gone is flagged', () => {
  const t = setWorld();
  w(path.dirname(t.root), 'plugins.txt', 'Installed plugins:\n\n  > engineering@knowledge-work-plugins\n    Version: 1.0\n    Status: enabled\n');
  const r = t.run('apply', 'basic');
  assert.match(r.out, /engineering:debug is already installed \(engineering\): marked as in use/);
  assert.equal(t.get('engineering:debug').state, 'active');
  assert.doesNotMatch(r.out, /\/plugin install engineering/);
  const ok = t.run('check'); assert.equal(ok.code, 0, ok.out);
  w(path.dirname(t.root), 'plugins.txt', 'Installed plugins:\n');
  assert.match(t.run('check').out, /NEEDS\|Set "basic".*not found: engineering:debug/);
});

test('plugin list: when Claude Code cannot be asked, nothing is claimed either way', () => {
  const t = setWorld(); t.env.HIVE_PLUGIN_LIST = 'none';
  const r = t.run('apply', 'basic');
  assert.match(r.out, /no plugin could be counted as installed yet/);
  assert.equal(t.get('engineering:debug').state, 'listed-not-installed');
});
