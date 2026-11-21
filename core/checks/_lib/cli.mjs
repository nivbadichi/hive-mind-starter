#!/usr/bin/env node
// node core/checks/_lib/cli.mjs list   [--json] [--dir <checks folder>]   every check: kind, mode, steps, what it holds
// node core/checks/_lib/cli.mjs doctor [--json] [--dir <checks folder>]   what is broken or missing; exit 1 when broken
// The doctor never runs a check's steps against the real notebook: it times each step once on made-up input with a
// made-up ctx, and reports a step that throws there as a warning only (made-up input is not a real case).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadAll, discover } from './loader.mjs';
import { makeEv, makeCtx } from './harness.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export async function list(dir) {
  const { modules, broken } = await loadAll(dir);
  return [
    ...modules.map((m) => ({ id: m.id, status: 'ok', kind: m.kind, mode: m.mode, steps: m.steps, rule: m.def.rule, about: m.def.about })),
    ...broken.map((b) => ({ id: b.id, status: 'broken', kind: b.kind, problems: b.problems })),
  ];
}

const SAMPLE = {
  pretool: { tool: 'Write', input: { file_path: 'notes/example.md', content: 'hello' } },
  posttool: { tool: 'Bash', input: { command: 'ls' }, tool_response: { stdout: '', stderr: '' } },
  prompt: { prompt: 'what is left today?' },
  stop: { last_assistant_message: 'Here is where it stands.' },
  helperstop: { last_assistant_message: 'Report: nothing found.', agent_id: 'h1' },
};

export async function doctor(dir) {
  const { modules, broken, warnings } = await loadAll(dir);
  const problems = broken.map((b) => `${b.id}: BROKEN (${b.kind}): ${b.problems.join('; ')}`);
  const notes = [...warnings];
  const starter = path.resolve(dir, '..', '..', 'starter', 'core', 'checks');
  const twin = fs.existsSync(starter) && path.resolve(dir) !== starter;
  const missing = new Map();
  const WHAT = { 'check.test.mjs': 'its tests', 'README.md': 'its README', 'settings.json': 'its settings file' };
  for (const f of discover(dir)) {
    const m = [];
    for (const need of ['check.test.mjs', 'README.md', 'settings.json']) if (!fs.existsSync(path.join(f.dir, need))) { notes.push(`${f.id}: no ${need}`); m.push(WHAT[need]); }
    if (twin && !fs.existsSync(path.join(starter, f.id, 'check.mjs'))) { notes.push(`${f.id}: no copy in starter/core/checks/${f.id}`); m.push('its copy for newcomers'); }
    missing.set(f.id, m);
  }
  // One plain line per folder, sound or broken.
  const tail = (id) => (missing.get(id) || []).length ? ` Missing: ${missing.get(id).join(', ')}.` : '';
  const lines = [
    ...modules.map((m) => `${m.id}: sound. A ${m.kind} check, set to ${m.mode}; it runs ${and(m.steps.map((s) => WHEN[s]))}.${tail(m.id)}`),
    ...broken.map((b) => `${b.id}: BROKEN, so it is treated as a ${b.kind} check: ${b.kind === 'safety' ? 'every step but reading is refused' : 'it is skipped and logged'}. ${b.problems.join('; ')}.${tail(b.id)}`),
  ];
  for (const m of modules) {
    if (m.kind === 'safety' && m.mode !== 'refuse') problems.push(`${m.id}: a safety check set to "${m.mode}"`);
    for (const s of m.steps) {
      const ctx = makeCtx({ settings: m.settings, step: s });
      const t = Date.now();
      try { await m.def.steps[s](makeEv(s, SAMPLE[s]), ctx); } catch (e) { notes.push(`${m.id}.${s}: threw on made-up input (${String(e && e.message || e).slice(0, 80)})`); }
      const ms = Date.now() - t;
      if (ms > 50) notes.push(`${m.id}.${s}: took ${ms} ms on made-up input (the contract asks under 50)`);
    }
  }
  return { ok: problems.length === 0, checks: modules.length + broken.length, lines, problems, notes };
}

const WHEN = { pretool: 'before a tool', posttool: 'after a tool', prompt: 'at each message', stop: 'at the end of a reply', helperstop: 'when a helper stops' };
const and = (a) => (a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a.at(-1));

function plain(rows) {
  if (!rows.length) return 'No checks found.';
  return rows.map((r) => r.status === 'ok'
    ? `${r.id} holds ${r.rule}. A ${r.kind} check, set to ${r.mode}; it runs ${and(r.steps.map((s) => WHEN[s]))}. ${r.about}`
    : `${r.id} is BROKEN (treated as a ${r.kind} check): ${r.problems.join('; ')}.`).join('\n');
}

async function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0] || 'list';
  const json = argv.includes('--json');
  const di = argv.indexOf('--dir');
  const dir = di >= 0 ? path.resolve(argv[di + 1]) : path.dirname(HERE);
  if (cmd === 'list') {
    const rows = await list(dir);
    process.stdout.write((json ? JSON.stringify(rows, null, 1) : plain(rows)) + '\n');
    return 0;
  }
  if (cmd === 'doctor') {
    const r = await doctor(dir);
    if (json) process.stdout.write(JSON.stringify(r, null, 1) + '\n');
    else process.stdout.write([`${r.ok ? 'OK' : 'BROKEN'}: ${r.checks} check(s) in ${dir}`, ...r.lines, ...r.problems.map((p) => 'BROKEN ' + p), ...r.notes.map((n) => 'NOTE ' + n)].join('\n') + '\n');
    return r.ok ? 0 : 1;
  }
  process.stderr.write('Use: list or doctor, with --json and --dir <folder> if wanted.\n');
  return 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((c) => process.exit(c), (e) => { process.stderr.write(String(e && e.stack || e) + '\n'); process.exit(2); });
}
