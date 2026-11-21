// The loader: finds every check folder, checks its shape, and runs one step of every check in order (safety first,
// then discipline; by id inside each), each with a time limit, each on its own, its errors handled by its kind:
//   safety     on its own error, time-out or a malformed answer: at the before-a-tool step the tool is REFUSED (unless
//              it only reads, or it writes into that check's own folder, so it can be mended); at other steps logged.
//   discipline on its own error: let through and logged.
// A folder whose check cannot be loaded or is malformed is "broken". Its kind is taken from its file when it can be
// read; when it cannot, it is treated as safety (fail closed). Folders whose names start with "_" or "." are not checks.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateCheck, validateResult, KINDS, MODES } from './contract.mjs';
import { isReading } from './reading.mjs';

export function discover(dir) {
  let names = [];
  try { names = fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch { return []; }
  return names.filter((n) => !n.startsWith('_') && !n.startsWith('.')).sort().map((id) => ({ id, dir: path.join(dir, id), file: path.join(dir, id, 'check.mjs') }));
}

function readSettings(dir) {
  const f = path.join(dir, 'settings.json');
  if (!fs.existsSync(f)) return { settings: {}, problems: [], missing: true };
  try { return { settings: JSON.parse(fs.readFileSync(f, 'utf8').replace(/^﻿/, '')) || {}, problems: [] }; }
  catch (e) { return { settings: {}, problems: ['settings.json is not valid JSON: ' + String(e.message).slice(0, 120)] }; }
}

// The kind written in a check file that could not be loaded, read from its text: "safety" unless it plainly says discipline.
function kindFromText(file) {
  try { const t = fs.readFileSync(file, 'utf8'); if (/kind\s*:\s*['"]discipline['"]/.test(t) && !/kind\s*:\s*['"]safety['"]/.test(t)) return 'discipline'; } catch {}
  return 'safety';
}

// Loads every check. Returns { modules, broken, warnings }. Never throws.
export async function loadAll(dir) {
  const modules = [], broken = [], warnings = [];
  for (const f of discover(dir)) {
    const problems = [];
    let def = null;
    if (!fs.existsSync(f.file)) problems.push('no check.mjs');
    else {
      // The file's time in the address: a check changed on disk is loaded anew even inside one long-running process.
      try { def = (await import(pathToFileURL(f.file).href + '?v=' + fs.statSync(f.file).mtimeMs)).default; } catch (e) { problems.push('check.mjs does not load: ' + String(e && e.message || e).slice(0, 160)); }
    }
    if (def) problems.push(...validateCheck(def, f.id));
    const st = readSettings(f.dir);
    problems.push(...st.problems);
    if (problems.length) {
      const kind = def && KINDS.includes(def.kind) ? def.kind : (fs.existsSync(f.file) ? kindFromText(f.file) : 'safety');
      broken.push({ id: f.id, dir: f.dir, kind, problems });
      continue;
    }
    let mode = def.mode || 'refuse';
    const sm = st.settings.mode;
    if (sm !== undefined) {
      if (!MODES.includes(sm)) warnings.push(`${f.id}: settings.json mode ${JSON.stringify(sm)} is not refuse, notice or off; ignored`);
      else if (def.kind === 'safety') warnings.push(`${f.id}: a safety check is not switched in settings.json (mode "${sm}" ignored); a safety check is switched only in its check.mjs`);
      else mode = sm;
    }
    if (st.missing) warnings.push(`${f.id}: no settings.json`);
    modules.push({ id: f.id, dir: f.dir, def, kind: def.kind, mode, settings: st.settings, steps: Object.keys(def.steps) });
  }
  const order = (a, b) => (a.kind === b.kind ? (a.id < b.id ? -1 : 1) : a.kind === 'safety' ? -1 : 1);
  modules.sort(order);
  broken.sort(order);
  return { modules, broken, warnings };
}

const norm = (p) => { const s = path.resolve(String(p || '')).replace(/\\/g, '/'); return process.platform === 'win32' ? s.toLowerCase() : s; };
function writesInto(ev, dir) {
  if (!['Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(ev.tool)) return false;
  const f = ev.input && (ev.input.file_path || ev.input.notebook_path);
  if (!f) return false;
  const d = norm(dir);
  return norm(f).startsWith(d + '/');
}

function timeout(ms) { let t; const p = new Promise((res) => { t = setTimeout(() => res(TIMED_OUT), ms); }); return { p, stop: () => clearTimeout(t) }; }
const TIMED_OUT = Symbol('timed out');

// Runs one step of every module. ctxFor(mod) gives that module's ctx. opts: { stepMs, totalMs, settings (the
// library's: reading lists), deadline (an absolute time the whole run must end by) }.
// Returns { denies, says, debts, clears, ran, errors } where each entry names its check.
export async function runStep(step, loaded, ev, ctxFor, opts = {}) {
  const S = opts.settings || {};
  const stepMs = opts.stepMs || S.stepMs || 200;
  const t0 = Date.now();
  const end = Math.min(t0 + (opts.totalMs || S.totalMs || 1500), opts.deadline || Infinity);
  const out = { denies: [], says: [], debts: [], clears: [], ran: new Set(), errors: [] };
  const reading = step === 'pretool' && isReading(ev.tool, ev.input, S);
  const fail = (m, why) => {
    out.errors.push({ id: m.id, kind: m.kind, why });
    if (m.kind === 'safety' && step === 'pretool' && !reading && !writesInto(ev, m.dir)) {
      out.denies.push({ id: m.id, text: `HIVE CHECK (${m.id}) stopped this step to be safe: this safety check ${why}. Steps that only read still run. The one thing to do: tell ${opts.who || 'the person'} in one plain sentence that the check "${m.id}" is broken; it is mended in its own folder.` });
    }
  };
  if (step === 'pretool') for (const b of loaded.broken || []) fail({ id: b.id, kind: b.kind, dir: b.dir }, 'is broken (' + b.problems.slice(0, 2).join('; ') + ')');
  for (const m of loaded.modules || []) {
    const fn = m.def.steps[step];
    if (typeof fn !== 'function' || m.mode === 'off') continue;
    if (Date.now() >= end) { fail(m, 'was not run: the checks ran out of time'); continue; }
    const started = Date.now();
    let r;
    const lim = timeout(Math.max(1, Math.min(stepMs, end - started)));
    try {
      const ctx = ctxFor(m);
      r = await Promise.race([Promise.resolve().then(() => fn(ev, ctx)), lim.p]);
    } catch (e) { lim.stop(); fail(m, 'broke: ' + String(e && e.message || e).slice(0, 160)); continue; }
    lim.stop();
    const ms = Date.now() - started;
    if (r === TIMED_OUT || ms > stepMs) { fail(m, `took too long (over ${stepMs} ms)`); continue; }
    const { problems, result } = validateResult(step, r);
    if (problems.length) { fail(m, 'gave a malformed answer: ' + problems.slice(0, 2).join('; ')); continue; }
    out.ran.add(m.id);
    const notice = m.mode === 'notice';
    if (result.deny) {
      if (notice) out.says.push({ id: m.id, text: `HIVE NOTICE (${m.id}, a reminder; nothing was stopped): ${result.deny}` });
      else out.denies.push({ id: m.id, text: `HIVE CHECK (${m.id}): ${result.deny}` });
    }
    if (result.say) out.says.push({ id: m.id, text: result.say });
    for (const d of result.debts) out.debts.push({ check: m.id, debt: d, notice });
    if (result.clear.length) out.clears.push({ check: m.id, keys: result.clear });
  }
  return out;
}
