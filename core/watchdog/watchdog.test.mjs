// Tests for watchdog.mjs. Temporary folders only: a made-up notebook and a made-up Claude folder.
// Made-up advisories stand in for the network.
//   node --test core/watchdog/watchdog.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { inRange, compareVersions, collectInventory, planRequests, matchAdvisories, round, repoFromEntry } from './watchdog.mjs';

const PROG = path.join(path.dirname(fileURLToPath(import.meta.url)), 'watchdog.mjs');
const w = (root, rel, text) => { const p = path.join(root, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, typeof text === 'string' ? text : JSON.stringify(text)); };

function world() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'watchdog-test-'));
  const root = path.join(base, 'notebook');
  const claude = path.join(base, 'claude');
  w(root, 'app/package.json', { name: 'private-site', dependencies: { next: '16.4.6', lodash: '4.17.20' }, devDependencies: { eslint: '9.39.5' } });
  w(root, 'app/package-lock.json', { lockfileVersion: 3, packages: {
    '': { name: 'private-site', version: '0.1.0' },
    'node_modules/next': { version: '16.4.6', resolved: 'https://registry.npmjs.org/next/-/next-16.4.6.tgz' },
    'node_modules/lodash': { version: '4.17.20', resolved: 'https://registry.npmjs.org/lodash/-/lodash-4.17.20.tgz' },
    'node_modules/eslint': { version: '9.39.5', resolved: 'https://registry.npmjs.org/eslint/-/eslint-9.39.5.tgz', dev: true },
    'node_modules/minimist': { version: '1.2.5', resolved: 'https://registry.npmjs.org/minimist/-/minimist-1.2.5.tgz' },
    'node_modules/my-local-thing': { version: '1.0.0', resolved: 'file:../my-local-thing' },
    'node_modules/linked': { link: true, resolved: '../linked' },
  } });
  w(root, 'system/registry.json', { version: 1, entries: [
    { id: 'brag', kind: 'skill', state: 'active', source: 'third-party', about: 'Launch video', text: 'latent-spaces/brag, MIT.' },
    { id: 'founder-cfo', kind: 'skill', state: 'active', source: 'third-party', about: 'Numbers (Founder pack, Jakeschincariol/founder-skill, MIT)' },
    { id: 'old-thing', kind: 'skill', state: 'removed', source: 'third-party', about: 'gone/away' },
    { id: 'caveman', kind: 'skill', state: 'active', source: 'folder', about: 'Save tokens' },
    { id: 'rule-1', kind: 'protocol', state: 'active', source: 'owner', text: 'Ask first' },
  ] });
  w(claude, 'skills/caveman/SKILL.md', '---\nname: caveman\nversion: 1.2.0\ndescription: x\n---\n');
  w(claude, 'skills/.hidden/SKILL.md', 'x');
  w(claude, 'plugins/installed_plugins.json', { version: 2, plugins: { 'engineering@market': [{ version: '1.0.3' }] } });
  return { base, root, claude, stateDir: path.join(base, 'state'), outDir: path.join(base, 'out') };
}

const npmAdvisory = (over = {}) => ({ id: 1523, url: 'https://github.com/advisories/GHSA-x5rq-j2xg-h7qm', title: 'Prototype pollution in lodash', severity: 'high', vulnerable_versions: '<4.17.21', ...over });

function spyTransport(answers) {
  const calls = [];
  return {
    calls,
    async npmBulk(body) { calls.push(['npm', body]); if (answers.npmFail) throw new Error(answers.npmFail); return answers.npm || {}; },
    async gh(address) { calls.push(['gh', address]); if (answers.ghFail) throw new Error(answers.ghFail); return address.startsWith('/advisories') ? (answers.gh || []) : (answers.repo?.[address] || []); },
  };
}

test('versions and ranges: npm and GitHub styles, and an unreadable range is a lead', () => {
  assert.equal(compareVersions('1.0.0-beta.2', '1.0.0'), -1);
  assert.equal(compareVersions('1.0.0-beta.10', '1.0.0-beta.2'), 1);
  assert.equal(inRange('4.17.20', '<4.17.21'), true);
  assert.equal(inRange('4.17.21', '<4.17.21'), false);
  assert.equal(inRange('15.1.0', '>= 15.0.0, < 15.2.3'), true);
  assert.equal(inRange('16.4.6', '>= 15.0.0, < 15.2.3'), false);
  assert.equal(inRange('1.2.5', '<0.2.4 || >=1.0.0 <1.2.6'), true);
  assert.equal(inRange('1.3.0', '^1.2.0'), true);
  assert.equal(inRange('2.0.0', '^1.2.0'), false);
  assert.equal(inRange('1.2.9', '~1.2.0'), true);
  assert.equal(inRange('1.3.0', '~1.2.0'), false);
  assert.equal(inRange('5.0.0-beta.32', '<5.0.0'), true);
  assert.equal(inRange('1.0.0', '= 1.0.0'), true);
  assert.equal(inRange('1.0.0', 'banana'), null);
});

test('inventory: lockfile packages, registry tools with their public repository, skills and plugins by name', () => {
  const { root, claude } = world();
  const { items } = collectInventory({ root, claudeDir: claude });
  const names = items.map((i) => i.name);
  assert.ok(names.includes('minimist'));
  assert.ok(!names.includes('private-site'), 'the site itself is never listed to be sent');
  assert.ok(!names.includes('my-local-thing') && !names.includes('linked'), 'local packages are never sent');
  assert.equal(items.find((i) => i.name === 'lodash').direct, true);
  assert.equal(items.find((i) => i.name === 'minimist').direct, false);
  assert.equal(items.find((i) => i.name === 'brag').repo, 'latent-spaces/brag');
  assert.equal(items.find((i) => i.name === 'founder-cfo').repo, 'Jakeschincariol/founder-skill');
  assert.ok(!names.includes('old-thing') && !names.includes('rule-1'));
  assert.equal(items.find((i) => i.source === 'skills folder' && i.name === 'caveman').version, '1.2.0');
  assert.ok(!names.includes('.hidden'));
  assert.equal(items.find((i) => i.source === 'plugins folder').version, '1.0.3');
});

test('repository names are read only from a slug, never from loose words', () => {
  assert.equal(repoFromEntry({ about: 'Web/MCP and things' }), '');
  assert.equal(repoFromEntry({ about: 'use it and/or not' }), '');
  assert.equal(repoFromEntry({ about: 'Runbook (blader/napkin, MIT)' }), 'blader/napkin');
  assert.equal(repoFromEntry({ about: 'music CC BY 4.0, 1/2 done' }), '');
  assert.equal(repoFromEntry({ repo: 'owner/name' }), 'owner/name');
});

test('plan: only names and versions go out, and the budget caps the requests', () => {
  const { root, claude } = world();
  const { items } = collectInventory({ root, claudeDir: claude });
  const { asked, skipped } = planRequests(items, 6);
  assert.deepEqual(asked.map((a) => a.id), ['npm-bulk', 'gh-global', 'gh-repo:Jakeschincariol/founder-skill', 'gh-repo:latent-spaces/brag']);
  assert.deepEqual(asked[0].body, { next: ['16.4.6'], lodash: ['4.17.20'], eslint: ['9.39.5'], minimist: ['1.2.5'] });
  const sentText = JSON.stringify(asked);
  for (const secret of ['private-site', 'caveman', 'engineering@market', 'my-local-thing']) assert.ok(!sentText.includes(secret), `${secret} must not be sent`);
  const small = planRequests(items, 2);
  assert.equal(small.asked.length, 2);
  assert.equal(small.skipped.length, 2);
});

test('dry run sends nothing', async () => {
  const { root, claude, stateDir, outDir } = world();
  const t = spyTransport({});
  const r = await round({ root, claudeDir: claude, date: '2026-11-19', dry: true, transport: t, stateDir, outDir });
  assert.equal(t.calls.length, 0);
  assert.equal(r.sent, 0);
  assert.ok(!fs.existsSync(outDir) && !fs.existsSync(stateDir));
});

test('a hit: a made-up advisory for an installed version writes the hand-over; the next round stays quiet', async () => {
  const { root, claude, stateDir, outDir } = world();
  const t = spyTransport({ npm: { lodash: [npmAdvisory()] } });
  const r = await round({ root, claudeDir: claude, date: '2026-11-19', transport: t, stateDir, outDir });
  assert.equal(r.fresh.length, 1);
  assert.equal(r.fresh[0].name, 'lodash');
  const text = fs.readFileSync(r.handoverFile, 'utf8');
  assert.match(text, /lodash 4\.17\.20: Prototype pollution/);
  assert.match(text, /Nothing was changed/);
  assert.match(text, /part of what the live site runs/);
  assert.equal(r.fresh[0].dev, false);
  const again = await round({ root, claudeDir: claude, date: '2026-11-20', transport: spyTransport({ npm: { lodash: [npmAdvisory()] } }), stateDir, outDir });
  assert.equal(again.hits.length, 1);
  assert.equal(again.fresh.length, 0, 'an advisory already handed over is not new');
});

test('a hit in a build-only package says it does not ship to the live site', async () => {
  const { root, claude, stateDir, outDir } = world();
  const t = spyTransport({ npm: { eslint: [npmAdvisory({ id: 9, title: 'Slow eslint', vulnerable_versions: '>=9.0.0 <9.40.0' })] } });
  const r = await round({ root, claudeDir: claude, date: '2026-11-19', transport: t, stateDir, outDir });
  assert.equal(r.fresh.length, 1);
  assert.match(fs.readFileSync(r.handoverFile, 'utf8'), /not shipped to the live site/);
});

test('no hit: an advisory whose range leaves the installed version out is dropped', async () => {
  const { root, claude, stateDir, outDir } = world();
  const t = spyTransport({ npm: { lodash: [npmAdvisory({ vulnerable_versions: '<4.17.12' })] }, gh: [] });
  const r = await round({ root, claudeDir: claude, date: '2026-11-19', transport: t, stateDir, outDir });
  assert.equal(r.hits.length, 0);
  assert.ok(!fs.existsSync(outDir));
});

test('a tool not on the list: an advisory for something not installed is ignored', () => {
  const { root, claude } = world();
  const { items } = collectInventory({ root, claudeDir: claude });
  const hits = matchAdvisories(items, {
    'npm-bulk': { 'left-pad': [npmAdvisory({ title: 'left-pad is bad', vulnerable_versions: '*' })] },
    'gh-global': [{ ghsa_id: 'GHSA-aaaa-bbbb-cccc', summary: 'x', severity: 'critical', vulnerabilities: [{ package: { ecosystem: 'pip', name: 'lodash' }, vulnerable_version_range: '*' }] }],
  });
  assert.equal(hits.length, 0);
});

test('GitHub advisories: malware is named, withdrawn ones are dropped, the same advisory from both sources is one row', () => {
  const { root, claude } = world();
  const { items } = collectInventory({ root, claudeDir: claude });
  const hits = matchAdvisories(items, {
    'npm-bulk': { lodash: [npmAdvisory()] },
    'gh-global': [
      { ghsa_id: 'GHSA-x5rq-j2xg-h7qm', summary: 'Prototype pollution in lodash', severity: 'high', html_url: 'u', vulnerabilities: [{ package: { ecosystem: 'npm', name: 'lodash' }, vulnerable_version_range: '< 4.17.21', first_patched_version: '4.17.21' }] },
      { ghsa_id: 'GHSA-mal', type: 'malware', summary: 'Malicious minimist', severity: 'critical', vulnerabilities: [{ package: { ecosystem: 'npm', name: 'minimist' }, vulnerable_version_range: '= 1.2.5' }] },
      { ghsa_id: 'GHSA-old', withdrawn_at: '2026-01-01', summary: 'withdrawn', vulnerabilities: [{ package: { ecosystem: 'npm', name: 'next' }, vulnerable_version_range: '*' }] },
    ],
    'gh-repo:latent-spaces/brag': [{ ghsa_id: 'GHSA-repo', summary: 'Script runs a fetched file', severity: 'medium', html_url: 'r' }],
  });
  assert.equal(hits.filter((h) => h.name === 'lodash').length, 1);
  assert.equal(hits.find((h) => h.name === 'minimist').via, 'GitHub (malware)');
  assert.ok(!hits.some((h) => h.name === 'next'));
  assert.equal(hits.find((h) => h.ecosystem === 'github-repo').name, 'brag');
});

test('a source that fails is "could not look", never "nothing found"', async () => {
  const { root, claude, stateDir, outDir } = world();
  const t = spyTransport({ npmFail: 'answered 503', ghFail: 'gh said: no network' });
  const r = await round({ root, claudeDir: claude, date: '2026-11-19', transport: t, stateDir, outDir });
  assert.equal(r.hits.length, 0);
  assert.equal(r.couldNot.length, 4);
  assert.match(r.couldNot[0], /answered 503/);
});

test('command line: dry prints the addresses and sends nothing; a fixture round exits 3 on a hit and 4 when it could not look', () => {
  const { base, root, claude } = world();
  const env = { ...process.env, HIVE_ROOT: root, CLAUDE_DIR: claude, HIVE_DATE: '2026-11-19' };
  const dry = spawnSync(process.execPath, [PROG, 'dry', '--state', path.join(base, 's'), '--out', path.join(base, 'o')], { env, encoding: 'utf8' });
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /Dry run: nothing is sent\./);
  assert.match(dry.stdout, /POST https:\/\/registry\.npmjs\.org\/-\/npm\/v1\/security\/advisories\/bulk/);
  assert.match(dry.stdout, /gh api \/repos\/latent-spaces\/brag\/security-advisories/);
  assert.match(dry.stdout, /Requests sent: 0\./);
  assert.ok(!fs.existsSync(path.join(base, 's')) && !fs.existsSync(path.join(base, 'o')));

  const fx = path.join(base, 'fixtures.json');
  w(base, 'fixtures.json', { 'npm-bulk': { lodash: [npmAdvisory()] }, 'gh-global': [], 'gh-repo:latent-spaces/brag': [], 'gh-repo:Jakeschincariol/founder-skill': [] });
  const hit = spawnSync(process.execPath, [PROG, 'run', '--fixtures', fx, '--state', path.join(base, 's'), '--out', path.join(base, 'o')], { env, encoding: 'utf8' });
  assert.equal(hit.status, 3, hit.stdout + hit.stderr);
  assert.match(hit.stdout, /WATCHDOG\|NEW\|1\|/);

  w(base, 'fail.json', { 'npm-bulk': { __fail: 'answered 503' }, 'gh-global': [] });
  const fail = spawnSync(process.execPath, [PROG, 'run', '--fixtures', path.join(base, 'fail.json'), '--budget', '2', '--state', path.join(base, 's2'), '--out', path.join(base, 'o2')], { env, encoding: 'utf8' });
  assert.equal(fail.status, 4, fail.stdout + fail.stderr);
  assert.match(fail.stdout, /WATCHDOG\|COULD_NOT_LOOK\|npm registry advisories/);
  assert.match(fail.stdout, /WATCHDOG\|NOT_ASKED\|published advisories of the public repository/);
  assert.match(fail.stdout, /WATCHDOG\|NOTHING_NEW/);
});
