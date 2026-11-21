// Tests for the check that the manuals start from Claude's own parts (change C11 of the app-fit note).
//   node --test core/appfit/manual-fit.test.mjs
// Made-up copies only. Known-bad cases: a missing part of Claude's, a row with no link to Claude's own help, a part of
// Hive Mind that does not say what it sits on, a manual that teaches one of Claude's own commands, and a README that
// does not point to the page each fail.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkFit, FEATURES } from './manual-fit.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const COPY = path.resolve(HERE, '..', '..');
const PAGE = fs.readFileSync(path.join(COPY, 'docs', 'claude-app.md'), 'utf8');
function copy({ page = PAGE, readme = 'See [what Claude already does](docs/claude-app.md).\n', extra = {} } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hive-appfit-manual-'));
  fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(root, 'docs', 'claude-app.md'), page);
  fs.writeFileSync(path.join(root, 'README.md'), readme);
  for (const [rel, t] of Object.entries(extra)) fs.writeFileSync(path.join(root, rel), t);
  return root;
}
const needs = (r) => r.filter((l) => l.startsWith('NEEDS')).join('\n');

test('the page of this copy names every part of Claude\'s, each with a link to Claude\'s own help', () => {
  assert.equal(needs(checkFit(copy())), '');
  assert.ok(FEATURES.length >= 12);
});

test('known-bad: a part of Claude\'s left out of the table', () => {
  const page = PAGE.split('\n').filter((l) => !l.startsWith('| Scheduled runs in the cloud')).join('\n');
  assert.match(needs(checkFit(copy({ page }))), /Scheduled runs in the cloud/);
});

test('known-bad: a row with no link to Claude\'s own help', () => {
  const page = PAGE.replace('[Remote Control](https://code.claude.com/docs/en/remote-control)', 'Remote Control');
  assert.match(needs(checkFit(copy({ page }))), /no link to Claude's own help: The phone app and Remote Control/);
});

test('known-bad: a part of Hive Mind that does not say what it sits on', () => {
  const page = PAGE.replace('Small programs stop a step that breaks a rule, or remind Claude of it. Sits on: the steps a chat takes on this computer.', 'Small programs stop a step that breaks a rule.');
  assert.match(needs(checkFit(copy({ page }))), /rules, held by checks/i);
});

test('known-bad: a manual that teaches one of Claude\'s own commands', () => {
  const r = checkFit(copy({ extra: { 'SETUP.md': 'Type /schedule to make a daily run.\n' } }));
  assert.match(needs(r), /SETUP\.md.*\/schedule/);
});

test('known-bad: a README that does not point to the page', () => {
  assert.match(needs(checkFit(copy({ readme: '# Hive Mind\n' }))), /README/);
});
