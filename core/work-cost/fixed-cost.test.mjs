// The budget of the start message: a fresh copy's start must stay under START_BUDGET_TOKENS, so it cannot creep back.
// Run: node --test core/work-cost/fixed-cost.test.mjs (temporary folders only; the copy's installer runs in a made-up home).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { measure, listedText, tokens, START_BUDGET_TOKENS } from './fixed-cost.mjs';

const STARTER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('tokens are characters / 4; a helper is listed by its name and description only', () => {
  assert.equal(tokens(6000), 1500);
  assert.equal(listedText('---\nname: x\ndescription: Use when y.\nother: z\n---\n# Body\nlong body'), 'name: x\ndescription: Use when y.');
  assert.equal(listedText('no front matter'), '');
});

test(`a fresh copy's start message is under ${START_BUDGET_TOKENS} tokens, and part 3 is left out while nothing is in flight`, () => {
  const r = measure({ root: STARTER, runs: 1 });
  assert.ok(r.startTokens < START_BUDGET_TOKENS, `the start message is ${r.startTokens} tokens (${r.startChars} characters), over the budget of ${START_BUDGET_TOKENS}`);
  assert.equal(r.rows.find((x) => x.key === 'start-3').chars, 0, 'an empty in-flight note sends nothing');
  assert.match(r.texts['start-1'], /not set up yet/, 'the first reply still offers the set-up');
  assert.match(r.texts['start-1'], /Ask first before anything public/, 'the rules arrive whole');
  // The reminder line comes with the first message, not with the next ones.
  assert.match(r.texts['msg-first'], /^Hive rules:/);
  assert.doesNotMatch(r.texts['msg-later'], /Hive rules:/);
});

test('Light fits the budget too: a set-up copy with the largest Light set (student) and no projects yet', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fixed-cost-light-'));
  try {
    const nb = path.join(tmp, 'copy');
    fs.cpSync(STARTER, nb, { recursive: true, filter: (s) => !['.git', 'node_modules'].includes(path.basename(s)) });
    fs.writeFileSync(path.join(nb, 'me', 'profile.md'), '# About you\n\nCall them: Sam\nAreas: school, work.\n');
    const a = spawnSync(process.execPath, [path.join(nb, 'core', 'engine', 'registry.mjs'), 'apply', 'student', '--size', 'light'], { env: { ...process.env, HIVE_ROOT: nb, CLAUDE_DIR: path.join(tmp, 'no-claude'), HIVE_PLUGIN_LIST: 'none' }, encoding: 'utf8' });
    assert.equal(a.status, 0, a.stderr);
    const r = measure({ root: nb, runs: 1 });
    assert.match(r.texts['start-2'], /Explain a new idea first/, 'the Light student habit reaches the start');
    assert.ok(r.startTokens < START_BUDGET_TOKENS, `Light student, set up: ${r.startTokens} tokens, over ${START_BUDGET_TOKENS}`);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('ten projects fit the budget too: a set-up copy with ten made-up projects lists three and points to the rest', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fixed-cost-ten-'));
  try {
    const nb = path.join(tmp, 'copy');
    fs.cpSync(STARTER, nb, { recursive: true, filter: (s) => !['.git', 'node_modules'].includes(path.basename(s)) });
    fs.writeFileSync(path.join(nb, 'me', 'profile.md'), '# About you\n\nCall them: Sam\nAreas: school, work.\n');
    for (let i = 0; i < 10; i++) {
      const dir = path.join(nb, 'projects', `made-up-${i}`);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'state.md'), `---\nproject: Made-up project ${i}\nkind: personal\nstage: build (round two of the work)\nhealth: good\nnext_step: Finish the next part of the work and show it.\nneeds_you: nothing\norder: ${i + 1}\nupdated: 2026-11-${String(10 + i).padStart(2, '0')}\n---\n# Made-up ${i}\n`);
    }
    const r = measure({ root: nb, runs: 1 });
    const shown = (r.texts['start-2'].match(/^- Made-up project \d+:/gm) || []).length;
    assert.equal(shown, 3, r.texts['start-2']);
    assert.match(r.texts['start-2'], /^- 7 more: projects\/<name>\/state\.md$/m);
    assert.ok(r.startTokens < START_BUDGET_TOKENS, `ten projects: ${r.startTokens} tokens, over ${START_BUDGET_TOKENS}`);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('the budget test can fail: a copy with a longer rules note is over the budget', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fixed-cost-bad-'));
  try {
    const bad = path.join(tmp, 'copy');
    fs.cpSync(STARTER, bad, { recursive: true, filter: (s) => !['.git', 'node_modules'].includes(path.basename(s)) });
    fs.appendFileSync(path.join(bad, 'system', 'rules.md'), '\n' + 'A long extra line that every chat would have to read. '.repeat(60));
    const r = measure({ root: bad, runs: 1 });
    assert.ok(r.startTokens >= START_BUDGET_TOKENS, `expected over the budget, got ${r.startTokens}`);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});
