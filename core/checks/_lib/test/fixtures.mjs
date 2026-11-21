// Made-up check folders for the library's own tests, written into a temporary folder and removed afterwards.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export const MODULES = {
  'deny-write': `export default { id: 'deny-write', rule: 'test rule', kind: 'safety', about: 'Refuses writes to forbidden.txt.',
    steps: { pretool(ev) { return ev.tool === 'Write' && /forbidden\\.txt$/.test(ev.input.file_path || '') ? { deny: 'forbidden.txt is never written.' } : null; } } };`,
  'say-hello': `export default { id: 'say-hello', rule: 'test rule', kind: 'discipline', about: 'Says hello at each message.',
    steps: { prompt(ev, ctx) { return { say: 'hello from say-hello; words: ' + ctx.hisLast }; } } };`,
  'owe-done': `export default { id: 'owe-done', rule: 'rule 5', kind: 'discipline', about: 'A reply saying done with no check is a debt.',
    steps: { stop(ev, ctx) { return /\\bdone\\b/i.test(ev.text) && !ctx.events.some((e) => e.kind === 'check' && e.ok) ? { debt: { key: 'done-no-proof', text: 'it says done with no passing check.' } } : null; } } };`,
  'throw-safety': `export default { id: 'throw-safety', rule: 'test rule', kind: 'safety', about: 'Always throws.',
    steps: { pretool() { throw new Error('boom'); } } };`,
  'throw-discipline': `export default { id: 'throw-discipline', rule: 'test rule', kind: 'discipline', about: 'Always throws.',
    steps: { pretool() { throw new Error('boom'); }, stop() { throw new Error('boom'); } } };`,
  'malformed': `export default { id: 'malformed', kind: 'sometimes', steps: { pretool: 'not a function' } };`,
  'slow-async': `export default { id: 'slow-async', rule: 'test rule', kind: 'discipline', about: 'Waits too long.',
    steps: { pretool() { return new Promise((r) => setTimeout(() => r({ deny: 'too late' }), 400)); } } };`,
  'slow-sync': `export default { id: 'slow-sync', rule: 'test rule', kind: 'safety', about: 'Spins too long.',
    steps: { pretool() { const t = Date.now() + 260; while (Date.now() < t) {} return null; } } };`,
};

// specs: { id: source | null (folder with no check.mjs) } or a list of ids from MODULES. settings: { id: object|string }.
export function makeChecksDir(specs, settings = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hive-checks-'));
  const entries = Array.isArray(specs) ? specs.map((id) => [id, MODULES[id]]) : Object.entries(specs);
  for (const [id, src] of entries) {
    fs.mkdirSync(path.join(dir, id), { recursive: true });
    if (src !== null) fs.writeFileSync(path.join(dir, id, 'check.mjs'), src);
    const s = settings[id];
    if (s !== undefined) fs.writeFileSync(path.join(dir, id, 'settings.json'), typeof s === 'string' ? s : JSON.stringify(s));
    else fs.writeFileSync(path.join(dir, id, 'settings.json'), '{}');
  }
  fs.mkdirSync(path.join(dir, '_lib'), { recursive: true }); // never taken for a check
  return dir;
}

// A made-up notebook and Hive folder, with the gates' records as gates.mjs writes them.
export function makeWorld({ sid = 'chat-1', helper = false, skills = [], gatesEvents = [] } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'hive-world-'));
  const root = path.join(base, 'notebook');
  const state = path.join(base, 'home', '.claude', 'hive');
  fs.mkdirSync(path.join(root, 'system'), { recursive: true });
  fs.writeFileSync(path.join(root, 'system', 'rules.md'), '# rules\n');
  fs.mkdirSync(path.join(state, 'gates', 'chat'), { recursive: true });
  fs.mkdirSync(path.join(state, 'gates', 'turn'), { recursive: true });
  fs.writeFileSync(path.join(state, 'gates', 'chat', sid + '.json'), JSON.stringify(helper ? { prompts: 1, helper: { by: 'lead', to: 'lead' } } : { prompts: 1 }));
  fs.writeFileSync(path.join(state, 'gates', 'chat', sid + '.skills'), skills.map((s) => JSON.stringify({ s }) + '\n').join(''));
  fs.writeFileSync(path.join(state, 'gates', 'turn', sid + '.events'), gatesEvents.map((e) => JSON.stringify(e) + '\n').join(''));
  return { base, root, state, sid };
}

export function rm(...dirs) { for (const d of dirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} } }
