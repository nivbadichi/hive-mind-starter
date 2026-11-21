// Tests for notes-check.mjs. Made-up notebooks in temporary folders only.
//   node --test core/engine/notes-check.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkIndex, checkLinks, checkSkills, MAX_DESCRIPTION } from './notes-check.mjs';

const PROG = path.join(path.dirname(fileURLToPath(import.meta.url)), 'notes-check.mjs');
const w = (root, rel, text) => { const p = path.join(root, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); };
const mk = () => fs.mkdtempSync(path.join(os.tmpdir(), 'notes-check-'));
const skill = (desc) => `---\nname: x\ndescription: ${desc}\n---\nBody\n`;

test('index: a sound index has no problems', () => {
  const r = mk();
  w(r, 'knowledge/INDEX.md', '# Index\n- a.md: about a. Open it when a.\n- b.md: about b.\n');
  w(r, 'knowledge/a.md', 'a'); w(r, 'knowledge/b.md', 'b');
  assert.deepEqual(checkIndex(r), []);
});

test('index: a named note that is missing, and a note not in the index, are both found', () => {
  const r = mk();
  w(r, 'knowledge/INDEX.md', '- gone.md: missing note.\n- a.md: here.\n');
  w(r, 'knowledge/a.md', 'a'); w(r, 'knowledge/orphan.md', 'o');
  const p = checkIndex(r);
  assert.equal(p.length, 2);
  assert.ok(p.some((x) => x.includes('gone.md') && x.includes('does not exist')));
  assert.ok(p.some((x) => x.includes('orphan.md') && x.includes('not in knowledge/INDEX.md')));
});

test('index: no index file at all is reported', () => {
  assert.equal(checkIndex(mk()).length, 1);
});

test('links: real and missing backtick paths and markdown links', () => {
  const r = mk();
  w(r, 'system/real.md', 'x');
  w(r, 'system/n.md', 'See `system/real.md` and `system/nope.md` and [ok](real.md) and [bad](missing.md) and [web](https://x.org/a.md) and `core/gates/other.mjs`.\n```\n`system/in-code-block.md`\n```\n');
  const p = checkLinks(r);
  assert.equal(p.length, 2);
  assert.ok(p.some((x) => x.includes('system/nope.md')));
  assert.ok(p.some((x) => x.includes('missing.md')));
});

test('links: placeholders, wildcards and folders are not treated as links', () => {
  const r = mk();
  w(r, 'system/n.md', '`projects/<name>/state.md` `system/*.md` `system/YYYY-MM-DD.md` `system/design/`\n');
  assert.deepEqual(checkLinks(r), []);
});

test('skills: good, too long, no "when", no description, no SKILL.md', () => {
  const r = mk();
  w(r, 'core/skills/good/SKILL.md', skill('Close a session. Use when the user says close.'));
  w(r, 'core/skills/long/SKILL.md', skill('Use when needed. ' + 'x'.repeat(MAX_DESCRIPTION)));
  w(r, 'core/skills/nowhen/SKILL.md', skill('Closes sessions.'));
  w(r, 'core/skills/nodesc/SKILL.md', '---\nname: nodesc\n---\n');
  fs.mkdirSync(path.join(r, 'core/skills/empty'), { recursive: true });
  const p = checkSkills(r);
  assert.equal(p.length, 4);
  assert.ok(p.some((x) => x.includes('long') && x.includes('official limit')));
  assert.ok(p.some((x) => x.includes('nowhen') && x.includes('does not say when')));
  assert.ok(p.some((x) => x.includes('nodesc') && x.includes('no description')));
  assert.ok(p.some((x) => x.includes('empty') && x.includes('no SKILL.md')));
  assert.ok(!p.some((x) => x.includes('good')));
});

test('skills: a folded description (>) is read, and exactly the limit passes', () => {
  const r = mk();
  w(r, 'core/skills/fold/SKILL.md', '---\nname: fold\ndescription: >\n  Does a thing.\n  Use when asked.\n---\n');
  w(r, 'core/skills/edge/SKILL.md', skill('Use when. ' + 'y'.repeat(MAX_DESCRIPTION - 10)));
  assert.deepEqual(checkSkills(r), []);
});

test('program: exit 1 with NEEDS lines on a bad notebook, exit 0 on a clean one, and it changes nothing', () => {
  const bad = mk();
  w(bad, 'knowledge/INDEX.md', '- gone.md: x\n');
  const before = fs.readFileSync(path.join(bad, 'knowledge/INDEX.md'), 'utf8');
  const a = spawnSync(process.execPath, [PROG], { env: { ...process.env, HIVE_ROOT: bad }, encoding: 'utf8' });
  assert.equal(a.status, 1);
  assert.match(a.stdout, /NEEDS\|The index names knowledge\/gone\.md/);
  assert.equal(fs.readFileSync(path.join(bad, 'knowledge/INDEX.md'), 'utf8'), before);
  const good = mk();
  w(good, 'knowledge/INDEX.md', '- a.md: x\n'); w(good, 'knowledge/a.md', 'a');
  const b = spawnSync(process.execPath, [PROG], { env: { ...process.env, HIVE_ROOT: good }, encoding: 'utf8' });
  assert.equal(b.status, 0);
  assert.doesNotMatch(b.stdout, /NEEDS/);
});
