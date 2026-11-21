// The starting set's two picks: three sizes, then one of five kinds. Reads the copy's own registry; the apply test
// runs on a temporary copy of it.   node --test core/engine/sizes.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { SIZES, membersOf, cleared, leftOut } from './registry.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const COPY = path.resolve(HERE, '..', '..');
const REG = JSON.parse(fs.readFileSync(path.join(COPY, 'system', 'registry.json'), 'utf8'));
const KINDS = ['everyday', 'student', 'builder', 'designer', 'small-business'];
const setOf = (id) => REG.entries.find((e) => e.kind === 'set' && e.id === id);
const ids = (kind, size) => membersOf(REG, setOf(kind), [], size).map((e) => e.id);

test('the five kinds are the copy\'s starting sets, and everyday is the default', () => {
  for (const k of KINDS) assert.ok(setOf(k), `no set ${k}`);
  assert.equal(REG.entries.filter((e) => e.kind === 'set' && e.default).map((e) => e.id).join(), 'everyday');
});

test('each of the 15 combinations of size and kind resolves to a list with at least one skill or connection', () => {
  let n = 0;
  for (const k of KINDS) for (const z of SIZES) {
    const list = membersOf(REG, setOf(k), [], z);
    assert.ok(list.some((e) => e.kind === 'skill' || e.kind === 'connector'), `${z} ${k} is empty`);
    n++;
  }
  assert.equal(n, 15);
});

// The ruling of 2026-11-21 ("On for everyone"): writing code waits for a coding skill, so every package carries one.
const CODING = JSON.parse(fs.readFileSync(path.join(COPY, 'core', 'checks', 'use-what-fits', 'settings.json'), 'utf8')).oneOf.build;
test('each of the 15 combinations of size and kind carries at least one coding skill of the code-waits list', () => {
  assert.ok(CODING.length > 0, 'the code-waits list (oneOf.build) is empty');
  for (const k of KINDS) for (const z of SIZES) assert.ok(ids(k, z).some((x) => CODING.includes(x)), `${z} ${k} carries no coding skill of ${CODING.join(', ')}`);
});

test('no list names an unreviewed or paid thing (Shopify and Stripe stay out until reviewed)', () => {
  for (const k of KINDS) for (const z of SIZES) {
    for (const e of membersOf(REG, setOf(k), [], z)) assert.ok(cleared(e), `${z} ${k} names ${e.id}, which is not cleared`);
    const l = ids(k, z);
    assert.ok(!l.includes('shopify') && !l.includes('stripe'), `${z} ${k} names a shop or payment connector`);
  }
  // The rule itself refuses what it must: a review still needed, a price, an unknown route.
  assert.equal(cleared(REG.entries.find((e) => e.id === 'shopify')), false);
  assert.equal(cleared(REG.entries.find((e) => e.id === 'stripe')), false);
  assert.equal(cleared({ kind: 'skill', install: { type: 'plugin', marketplace: 'someone-else', source: 'x/y' } }), false);
  assert.equal(cleared({ kind: 'connector', review: 'official', paid: true }), false);
});

test('Light is within Standard, and Standard is within Full, for every kind', () => {
  for (const k of KINDS) {
    const lt = ids(k, 'light'), st = ids(k, 'standard'), fu = ids(k, 'full');
    assert.ok(lt.every((x) => st.includes(x)), `${k}: Light is not within Standard`);
    assert.ok(st.every((x) => fu.includes(x)), `${k}: Standard is not within Full`);
    assert.ok(lt.length < fu.length, `${k}: Light should be smaller than Full`);
    assert.ok(leftOut(REG, setOf(k), 'light').length > 0, `${k}: Light should say what it leaves out`);
    assert.deepEqual(leftOut(REG, setOf(k), 'full'), []);
  }
});

test('apply with a size: the size is recorded, Light says what it leaves out, one sentence changes it later', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sizes-test-'));
  try {
    const root = path.join(base, 'nb'), claude = path.join(base, 'claude');
    fs.mkdirSync(path.join(root, 'system'), { recursive: true }); fs.mkdirSync(claude, { recursive: true });
    fs.copyFileSync(path.join(COPY, 'system', 'registry.json'), path.join(root, 'system', 'registry.json'));
    fs.copyFileSync(path.join(COPY, 'system', 'preferences.md'), path.join(root, 'system', 'preferences.md'));
    const env = { ...process.env, HIVE_ROOT: root, CLAUDE_DIR: claude, HIVE_DATE: '2026-11-20', HIVE_PLUGIN_LIST: 'none' };
    const run = (...a) => spawnSync(process.execPath, [path.join(HERE, 'registry.mjs'), ...a], { env, encoding: 'utf8' });
    const reg = () => JSON.parse(fs.readFileSync(path.join(root, 'system', 'registry.json'), 'utf8'));
    let r = run('apply', 'student', '--size', 'light');
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /size light/);
    assert.match(r.stdout, /Light leaves out: .*anthropic-skills:deep-research/);
    assert.equal(reg().entries.find((e) => e.id === 'student').size, 'light');
    r = run('apply', 'student', '--size', 'standard');
    assert.equal(reg().entries.find((e) => e.id === 'student').size, 'standard');
    r = run('apply', 'builder');
    assert.equal(r.status, 0, r.stderr);
    const after = reg();
    assert.equal(after.entries.find((e) => e.id === 'student').size, undefined, 'one kind at a time');
    assert.match(run('sizes', 'everyday').stdout, /not measured/);
    assert.equal(run('apply', 'everyday', '--size', 'huge').status, 1);
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

// The ruling of 2026-11-20 ("Keep, and say so"): the four design and hosting services stay, each with one plain line
// saying it is free to connect, has paid plans of its own, and nothing is bought without a yes. The ruling of
// 2026-11-21 ("Yes, wherever it appears"): the line goes with the service in every size, Light included.
const PAID_PLANS = ['figma', 'canva', 'whimsical', 'vercel'];
const PLANS_LINE = /free to connect; .+ has paid plans of its own; nothing is bought without your yes\./;
test('the four design and hosting services each carry the plain line about paid plans, in every size that holds them (Light too), where the person reads them', () => {
  assert.ok(ids('designer', 'light').includes('figma'), 'Light designer holds Figma, so Light is really tested');
  for (const id of PAID_PLANS) assert.match(String(REG.entries.find((e) => e.id === id).plans || ''), PLANS_LINE, `${id} has no plans line`);
  const run = (...a) => spawnSync(process.execPath, [path.join(HERE, 'registry.mjs'), ...a], { env: { ...process.env, HIVE_ROOT: COPY, HIVE_PLUGIN_LIST: 'none' }, encoding: 'utf8' });
  let seen = 0;
  for (const k of KINDS) {
    const out = run('sizes', k).stdout;
    const block = (z) => out.split('\n- ').find((b) => b.toLowerCase().startsWith(z)) || '';
    for (const z of SIZES) for (const id of PAID_PLANS.filter((x) => ids(k, z).includes(x))) {
      const name = REG.entries.find((e) => e.id === id).install.directory;
      assert.match(block(z), new RegExp(`${name}: free to connect; ${name} has paid plans of its own; nothing is bought without your yes\\.`), `${z} ${k}: no line for ${name}`);
      seen++;
    }
    for (const z of SIZES) {
      const dry = run('apply', k, '--size', z, '--dry-run').stdout;
      for (const id of PAID_PLANS.filter((x) => ids(k, z).includes(x))) assert.match(dry, new RegExp(`Connect "${REG.entries.find((e) => e.id === id).install.directory}"[^\\n]*${PLANS_LINE.source}`), `apply ${z} ${k}: the step to connect ${id} says nothing about its plans`);
    }
  }
  assert.ok(seen >= 7, `only ${seen} lines were checked`);
});
