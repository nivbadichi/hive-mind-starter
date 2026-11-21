// Proof for change C4 of the app-fit note in this copy: the start step writes each chat's claude.ai link into its claim
// file from CLAUDE_CODE_BRIDGE_SESSION_ID (the app sets it to the Remote Control session id while a chat on this computer
// is connected). Made-up homes only.   node --test core/appfit/fit-proof.test.mjs
// Known-bad: a value with a quote and a space must not become a link.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const START = path.resolve(HERE, '..', 'start', 'start.mjs');
const w = (p, t) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, t); };

function startRules(sid, bridge) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'hive-appfit-home-'));
  const root = path.join(home, 'hive-mind');
  w(path.join(root, 'system', 'rules.md'), '# Rules\n\n1. A made-up rule.\n');
  const hive = path.join(home, '.claude', 'hive');
  const env = { ...process.env, HIVE_HOME: home, HIVE_ROOT: root, HIVE_STATE: hive, HIVE_CLAUDE: path.join(home, '.claude') };
  delete env.CLAUDE_CODE_BRIDGE_SESSION_ID;
  if (bridge !== undefined) env.CLAUDE_CODE_BRIDGE_SESSION_ID = bridge;
  spawnSync(process.execPath, [START, '--part', 'rules', '--no-refresh'], { input: JSON.stringify({ session_id: sid, cwd: root, source: 'startup', hook_event_name: 'SessionStart' }), env, encoding: 'utf8', timeout: 60000 });
  try { return JSON.parse(fs.readFileSync(path.join(hive, 'claims', `${sid}.json`), 'utf8')); } catch { return null; }
}

test('C4: with the variable set, the claim file carries the chat\'s claude.ai link', () => {
  const c = startRules('sess-link-1', 'session_ABC123def');
  assert.ok(c, 'a claim file was written');
  assert.equal(c.link, 'https://claude.ai/code/session_ABC123def');
});
test('C4: without the variable, no link', () => {
  const c = startRules('sess-link-2');
  assert.ok(c);
  assert.equal(c.link, undefined);
});
test('C4 known-bad: a value with a quote and a space is not turned into a link', () => {
  const c = startRules('sess-link-3', 'x" onclick="y');
  assert.ok(c);
  assert.equal(c.link, undefined);
});
