// Tests for the Hive Mind code, held to the fixed examples in vectors.json.   node --test core/journey/code.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encode, decode, STEPS, systemOf } from './code.mjs';

const V = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'vectors.json'), 'utf8'));
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const body = (c) => c.replace(/-/g, '').slice(2);
const show = (t) => `HM-${t.slice(0, 4)}-${t.slice(4)}`;
const full = (steps) => Object.fromEntries(STEPS.map((s) => [s, steps[s] ? 1 : 0]));

test('the examples file names the same 13 steps, in the same order', () => {
  assert.deepEqual(V.steps, STEPS);
  assert.equal(STEPS.length, 13);
});

test('every good example and every stage encodes to its code and reads back the same', () => {
  const all = [...V.good, ...V.stages];
  assert.ok(V.good.length >= 15, 'all zeros, all ones and each bit alone');
  for (const v of all) {
    assert.equal(encode(v.state), v.code, v.name);
    const d = decode(v.code);
    assert.equal(d.ok, true, v.name);
    assert.equal(d.system, v.state.system, v.name);
    assert.equal(d.route, v.state.route, v.name);
    assert.deepEqual(d.steps, full(v.state.steps), v.name);
    assert.match(v.code, /^HM-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{2}$/, v.name);
  }
  assert.equal(new Set(all.map((v) => v.code)).size, new Set(all.map((v) => JSON.stringify(v.state))).size, 'different states, different codes');
});

test('known-bad: the ten wrong codes are refused as wrong', () => {
  assert.equal(V.wrong.length, 10);
  for (const w of V.wrong) assert.deepEqual(decode(w.text), { ok: false, reason: 'wrong' }, `${w.why}: "${w.text}"`);
});

test('a code from a newer version is told apart from a wrong one', () => {
  for (const n of V.newer) { const d = decode(n.text); assert.equal(d.ok, false); assert.equal(d.reason, 'newer'); }
});

test('tolerant reading: lower case, spaces, no dash, no HM, O for 0, I and L for 1', () => {
  for (const t of V.tolerant) assert.equal(decode(t.text).code, t.code, t.text);
  const withZeroAndOne = V.good.map((v) => v.code).find((c) => /0/.test(body(c)) && /1/.test(body(c)));
  assert.ok(withZeroAndOne, 'an example holds both a 0 and a 1');
  const typed = withZeroAndOne.replace(/0/g, 'o').replace(/1/, 'l').replace(/1/g, 'I');
  assert.equal(decode(typed).code, withZeroAndOne);
});

test('every single mistyped character and every swap of two neighbours is refused, for every example', () => {
  let tried = 0;
  for (const v of [...V.good, ...V.stages]) {
    const t = body(v.code);
    for (let i = 0; i < 6; i++) for (const ch of ALPHABET) {
      if (ch === t[i]) continue;
      tried++;
      assert.equal(decode(show(t.slice(0, i) + ch + t.slice(i + 1))).ok, false, `${v.code}, position ${i} as ${ch}`);
    }
    for (let i = 0; i < 5; i++) {
      if (t[i] === t[i + 1]) continue;
      const s = t.split(''); [s[i], s[i + 1]] = [s[i + 1], s[i]];
      tried++;
      assert.equal(decode(show(s.join(''))).ok, false, `${v.code}, swap at ${i}`);
    }
  }
  assert.ok(tried > 3000);
});

test('encode refuses what it does not know, rather than make a code that lies', () => {
  assert.throws(() => encode({ steps: { 'made-up-step': 1 } }), /unknown step/);
  assert.throws(() => encode({ system: 'amiga' }), /unknown system/);
  assert.throws(() => encode({ route: 'sideways' }), /unknown route/);
  assert.throws(() => encode({ version: 0 }), /unknown version/);
});

test('the system names', () => {
  assert.equal(systemOf('win32'), 'windows'); assert.equal(systemOf('darwin'), 'mac');
  assert.equal(systemOf('linux'), 'linux'); assert.equal(systemOf('freebsd'), 'other');
});
