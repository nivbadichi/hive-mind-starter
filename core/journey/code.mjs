// The Hive Mind code: a short line (for example HM-7K2Q-9D) that says which steps of the first hour are truly done.
// The doctor makes it (doctor.mjs --code); the steps page reads it in the browser. It holds no name, path or key.
// This file is the one home of the encoding; vectors.json pins it, and the page's copy is held to the same examples.
//
// 30 bits, written as 6 characters of Crockford's base 32 (no I, L, O, U), shown as HM-XXXX-XX:
//   bits 29-27  version (3 bits; this is version 1)
//   bits 26-25  system  (0 Windows, 1 Mac, 2 Linux, 3 other)
//   bits 24-23  route   (0 none, 1 installer, 2 plugin, 3 both)
//   bits 22-10  the 13 step bits, STEPS[0] in bit 10 ... STEPS[12] in bit 22
//   bits  9-0   a 10-bit check (CRC-10, generator x^10+x^9+x^5+x^4+x+1): every typing mistake in one character,
//               and every swap of two neighbouring characters, makes the code fail.
export const VERSION = 1;
export const STEPS = ['tools', 'notebook', 'online', 'private-checked', 'private', 'set-up', 'starting-set', 'parts', 'gates', 'save-hook', 'saved', 'started', 'clean'];
export const SYSTEMS = ['windows', 'mac', 'linux', 'other'];
export const ROUTES = ['none', 'installer', 'plugin', 'both'];
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const POLY = 0x633; // x^10+x^9+x^5+x^4+x+1, with the x^10 term

// The remainder of data * x^10 divided by the generator. data is 20 bits, so every value stays under 2^30
// and JavaScript's 32-bit bit operations are exact.
function check10(data) {
  let r = data << 10;
  for (let bit = 29; bit >= 10; bit--) if ((r >>> bit) & 1) r ^= POLY << (bit - 10);
  return r;
}

function pick(list, v, what) {
  const i = typeof v === 'number' ? v : list.indexOf(String(v || '').toLowerCase());
  if (!Number.isInteger(i) || i < 0 || i >= list.length) throw new Error(`unknown ${what}: ${v}`);
  return i;
}

// state: { system: 'windows'|'mac'|'linux'|'other' (or 0-3), route: 'none'|'installer'|'plugin'|'both' (or 0-3),
//          steps: { tools: true, ... } (a name left out is 0), version?: 1 }
export function encode(state = {}) {
  const version = state.version ?? VERSION;
  if (!Number.isInteger(version) || version < 1 || version > 7) throw new Error(`unknown version: ${version}`);
  const sys = pick(SYSTEMS, state.system ?? 'other', 'system');
  const route = pick(ROUTES, state.route ?? 'none', 'route');
  const steps = state.steps || {};
  for (const k of Object.keys(steps)) if (!STEPS.includes(k)) throw new Error(`unknown step: ${k}`);
  let bits = 0;
  STEPS.forEach((name, i) => { if (steps[name]) bits += 2 ** i; });
  const data = version * 2 ** 17 + sys * 2 ** 15 + route * 2 ** 13 + bits;
  let word = data * 1024 + check10(data);
  let s = '';
  for (let i = 0; i < 6; i++) { s = ALPHABET[word % 32] + s; word = Math.floor(word / 32); }
  return `HM-${s.slice(0, 4)}-${s.slice(4)}`;
}

// Reads what a person typed: lower case, spaces, a missing dash or "HM", O for 0, I or L for 1 are all fine.
// Returns { ok: true, version, system, route, steps: { name: 0|1 }, code } or { ok: false, reason: 'wrong' | 'newer' }.
export function decode(text) {
  let t = String(text ?? '').toUpperCase().replace(/[\s\-_.]/g, '');
  if (t.length === 8 && t.startsWith('HM')) t = t.slice(2);
  if (t.length !== 6) return { ok: false, reason: 'wrong' };
  t = t.replace(/O/g, '0').replace(/[IL]/g, '1');
  let word = 0;
  for (const ch of t) { const v = ALPHABET.indexOf(ch); if (v < 0) return { ok: false, reason: 'wrong' }; word = word * 32 + v; }
  const data = Math.floor(word / 1024);
  if (check10(data) !== word % 1024) return { ok: false, reason: 'wrong' };
  const version = Math.floor(data / 2 ** 17);
  if (version === 0) return { ok: false, reason: 'wrong' };
  if (version > VERSION) return { ok: false, reason: 'newer', version };
  const steps = {};
  STEPS.forEach((name, i) => { steps[name] = Math.floor(data / 2 ** i) % 2; });
  return {
    ok: true, version,
    system: SYSTEMS[Math.floor(data / 2 ** 15) % 4], route: ROUTES[Math.floor(data / 2 ** 13) % 4],
    steps, code: `HM-${t.slice(0, 4)}-${t.slice(4)}`,
  };
}

// The system this program runs on, as the code names it.
export function systemOf(platform = process.platform) {
  return platform === 'win32' ? 'windows' : platform === 'darwin' ? 'mac' : platform === 'linux' ? 'linux' : 'other';
}
