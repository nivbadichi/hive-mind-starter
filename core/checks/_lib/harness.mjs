// A test harness for check modules. A check's own check.test.mjs imports it:
//   import { makeEv, makeCtx, runOne, throwing, timeStep, validate } from '../_lib/harness.mjs';
// Nothing here touches the real home or the real notebook: makeCtx serves notes from a list you give it.
import { validateCheck } from './contract.mjs';
import { runStep } from './loader.mjs';
import { names } from './ctx.mjs';
import { libSettings } from './hook.mjs';
import { approvedBy } from './his-words.mjs';

// A made-up hook input with the fields the loader adds (tool, input, command, text).
export function makeEv(step, fields = {}) {
  const tool = fields.tool || fields.tool_name || '';
  const input = fields.input || fields.tool_input || {};
  const ev = { session_id: 'test-chat', cwd: '/notebook', hook_event_name: step, ...fields, step, tool, tool_name: tool, input, tool_input: input };
  ev.command = fields.command ?? ((tool === 'Bash' || tool === 'PowerShell') ? String(input.command || '') : '');
  ev.text = fields.text ?? (step === 'prompt' ? String(fields.prompt || '') : String(fields.last_assistant_message || ''));
  return ev;
}

// A made-up ctx. notes: { 'system/decisions.md': '...' } served by read(); everything else as the contract says.
// ctx.logged collects what the check logged.
export function makeCtx(o = {}) {
  const notes = o.notes || {};
  const logged = [];
  const loaded = (o.loaded || []).map((s) => String(s).toLowerCase());
  const tails = new Set(loaded.map((n) => n.split(':').pop()));
  const hisLast = o.hisLast || '';
  return {
    root: o.root || '/notebook', state: o.state || '/hive', sid: o.sid || 'test-chat', step: o.step || '', agentId: o.agentId || '', who: o.who || libSettings().who || 'the person',
    hisLast,
    said: (p) => names(hisLast, p),
    hisNow: o.hisNow !== false,
    cards: o.cards || [],
    approved: (w) => { const list = Array.isArray(w) ? w : [w]; return names(hisLast, list) || !!approvedBy(o.cards || [], list.filter((x) => typeof x === 'string')); },
    isHelperChat: !!o.isHelperChat,
    loaded,
    hasLoaded: (n) => { const x = String(n || '').toLowerCase(); return loaded.includes(x) || tails.has(x.split(':').pop()); },
    events: o.events || [],
    read: (rel) => (o.read ? o.read(rel) : String(notes[rel] ?? '')),
    settings: o.settings || {},
    debts: o.debts || [],
    log: (event, detail) => logged.push({ event, detail }),
    logged,
  };
}

// Problems in a check's shape; [] when well formed.
export function validate(check, folderId) { return validateCheck(check, folderId); }

// Runs one step of one check exactly as the loader would (time limit, answer checked, error handled by kind, mode).
// Returns { deny, say, debts, clear, error } where deny/say are the loader's words ('' when none) and error is the
// reason the check failed ('' when it ran).
export async function runOne(check, step, ev, ctx, opts = {}) {
  const mod = { id: check.id, dir: opts.dir || '/checks/' + check.id, def: check, kind: check.kind, mode: opts.mode || check.mode || 'refuse', settings: ctx.settings || {} };
  const r = await runStep(step, { modules: [mod], broken: [] }, ev, () => ctx, { settings: libSettings(), stepMs: opts.stepMs, who: ctx.who });
  return {
    deny: r.denies.map((d) => d.text).join('\n\n'),
    say: r.says.map((s) => s.text).join('\n'),
    debts: r.debts.map((d) => d.debt),
    clear: r.clears.flatMap((c) => c.keys),
    error: r.errors.map((e) => e.why).join('; '),
  };
}

// The same check with every step throwing, to prove "on its own error it behaves as its kind says".
export function throwing(check) {
  const steps = {};
  for (const k of Object.keys(check.steps)) steps[k] = () => { throw new Error('made-up failure'); };
  return { ...check, steps };
}

// The median time of a step over n runs, in milliseconds (the contract: under 50 on ordinary input).
export async function timeStep(check, step, ev, ctx, n = 15) {
  const fn = check.steps[step];
  const times = [];
  for (let i = 0; i < n; i++) { const t = process.hrtime.bigint(); await fn(ev, ctx); times.push(Number(process.hrtime.bigint() - t) / 1e6); }
  times.sort((a, b) => a - b);
  return times[Math.floor(times.length / 2)];
}
