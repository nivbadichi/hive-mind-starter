#!/usr/bin/env node
// Hive Mind factory, layer 2: a Stop hook. At the end of a turn it asks git which files changed in this copy, picks the
// checks of the impact map (impact-map.json) those files touch, runs them side by side with a time limit each, and when one
// fails exits 2 with the failing output on stderr, so the agent keeps working instead of stopping.
// - A check that passed on the very same changed files is not run again (a fingerprint per check).
// - Loop guard: when this stop already follows a refusal (stop_hook_active) and nothing changed since, the stop goes
//   through with a warning to the person instead of a second refusal.
// - Checks marked "manual" (the door test, the public build check) are never run here; touching them is only mentioned.
// - In a git worktree with no app/node_modules, node checks borrow the main checkout's packages (modules-fallback.mjs).
// - A missing tool, a time-out, git missing or a crash never blocks: it warns and logs to ~/.claude/hive/factory.log.
// - tests.mode "refuse" (default), "warn" (the person sees a line, the stop goes through) or "off". Off switch: factory-off.
import fs from 'node:fs';
import path from 'node:path';
import * as L from './lib.mjs';

const T0 = Date.now();

function say(obj) { process.stdout.write(JSON.stringify(obj)); }

async function runCheck(c, root, mods, S) {
  if (c.kind === 'types') {
    const r = await L.typeCheck({ root, app: path.join(root, 'app'), mods }, S, '');
    if (r.skipped) return { skipped: r.skipped, ms: r.ms };
    return { ok: r.ok, text: r.lines.join('\n'), ms: r.ms };
  }
  if (c.kind === 'lint') {
    const app = path.join(root, 'app');
    const files = c.files.map((f) => path.join(root, f)).filter((f) => { try { return fs.statSync(f).isFile(); } catch { return false; } });
    const r = await L.lintMany(files, { root, app, mods }, S);
    if (r.skipped) return { skipped: r.skipped, ms: r.ms };
    return { ok: r.ok, text: r.lines.join('\n'), ms: r.ms };
  }
  const cwd = path.join(root, c.cwd || '.');
  let [cmd, ...args] = c.run;
  const env = { ...process.env };
  if (cmd === 'node') {
    cmd = process.execPath;
    if (c.needsModules) {
      if (!mods) return { skipped: 'app/node_modules is missing here and in the main checkout' };
      if (mods.borrowed) { args = ['--import', L.fallbackImport(), ...args]; env.HIVE_FACTORY_MODULES = mods.appDir; }
    }
  }
  const r = await L.run(cmd, args, { cwd, timeoutMs: c.timeoutMs || 90000, env });
  if (r.missing) return { skipped: `${c.run[0]} could not be started`, ms: r.ms };
  if (r.timedOut) return { skipped: `ran over its ${c.timeoutMs || 90000} ms limit and was stopped`, ms: r.ms };
  const text = (r.out + '\n' + r.err).replace(/\r/g, '');
  return { ok: r.code === 0, text, ms: r.ms };
}

// The lines worth showing from a failing run: the failing tests and their reasons first, then the end of the output.
export function failingPart(text, maxLines) {
  const lines = String(text).split('\n');
  const marks = lines.map((l, i) => (/(✖|not ok|FAIL\b|AssertionError|Error:|error TS\d+|failed)/.test(l) ? i : -1)).filter((i) => i >= 0);
  const keep = new Set();
  for (const i of marks.slice(0, 12)) for (let j = i; j < Math.min(lines.length, i + 4); j++) keep.add(j);
  for (let j = Math.max(0, lines.length - 8); j < lines.length; j++) keep.add(j);
  return [...keep].sort((a, b) => a - b).map((i) => lines[i]).join('\n');
}

async function main() {
  const raw = await L.readStdin();
  const input = L.parse(raw);
  if (L.isOff()) return 0;
  const S = L.loadSettings();
  if (S.enabled === false || S.tests.mode === 'off') return 0;
  const root = L.repoRootOf(input.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd());
  if (!root) return 0;

  const limit = setTimeout(() => {
    L.log('stop', 'timeout', { ms: Date.now() - T0 });
    say({ systemMessage: `Hive factory: the end-of-turn tests ran over ${S.stop.limitMs} ms and were stopped; nothing was blocked.` });
    process.exit(0);
  }, S.stop.limitMs);
  limit.unref();

  const changed = L.changedFiles(root);
  if (!changed) { L.log('stop', 'warn', { why: 'git status failed' }); return 0; }
  if (!changed.length) return 0;

  const { map } = L.loadMap(root);
  // Layer 1 moved to the end of the turn (lint.when / types.when "stop"): two more checks, on the changed TypeScript under app/.
  const appTs = changed.filter((f) => /^app\/.*\.(ts|tsx|mts|cts)$/i.test(f) && !/\/(node_modules|\.next|out|dist)\//.test(f));
  if (S.types.mode !== 'off' && S.types.when === 'stop') map.checks = [...(map.checks || []), { id: 'types', kind: 'types', entries: [], covers: ['app/**/*.ts', 'app/**/*.tsx', 'app/**/*.mts', 'app/**/*.cts', 'app/tsconfig.json', 'app/package.json'] }];
  if (S.lint.mode !== 'off' && S.lint.when === 'stop' && appTs.length) map.checks = [...(map.checks || []), { id: 'lint', kind: 'lint', files: appTs, entries: [], covers: appTs }];
  const picked = L.selectChecks(root, map, changed);
  const manual = picked.filter((p) => p.check.manual);
  const auto = picked.filter((p) => !p.check.manual);
  if (!auto.length && !manual.length) return 0;

  const stateFile = path.join(L.FDIR, 'stop-' + L.short(root) + '.json');
  const last = L.readJson(stateFile, {});
  const mods = L.modulesFor(root);
  const todo = [], held = [];
  for (const p of auto) {
    const fp = L.fingerprint(root, p.check.id, p.why);
    const prev = last[p.check.id];
    if (prev && prev.fp === fp && prev.ok) continue; // already green on these very files
    if (input.stop_hook_active && prev && prev.fp === fp && !prev.ok) { held.push(p.check.id); continue; } // loop guard
    todo.push({ ...p, fp });
  }

  // Side by side, a few at a time.
  const results = [];
  for (let i = 0; i < todo.length; i += S.stop.maxParallel) {
    const batch = todo.slice(i, i + S.stop.maxParallel);
    results.push(...(await Promise.all(batch.map(async (p) => ({ p, r: await runCheck(p.check, root, mods, S) })))));
  }
  clearTimeout(limit);

  const failed = [], skipped = [];
  for (const { p, r } of results) {
    if (r.skipped) { skipped.push(`${p.check.id}: not run, ${r.skipped}`); continue; }
    last[p.check.id] = { fp: p.fp, ok: r.ok, at: new Date().toISOString(), ms: r.ms };
    if (!r.ok) failed.push({ p, r });
  }
  L.writeJson(stateFile, last);
  L.log('stop', failed.length ? (S.tests.mode === 'refuse' ? 'refuse' : 'warn') : 'pass', {
    root: L.short(root), changed: changed.length, ran: results.map(({ p, r }) => ({ id: p.check.id, ok: !!r.ok, ms: r.ms, skipped: !!r.skipped })), held, manual: manual.map((m) => m.check.id), ms: Date.now() - T0,
  });

  const manualLine = manual.length ? 'Also touched, and run only by hand: ' + manual.map((m) => `${m.check.id} (${m.check.howTo || m.check.about || ''})`).join('; ') + '.' : '';
  if (failed.length && S.tests.mode === 'refuse') {
    const parts = failed.map(({ p, r }) => `${p.check.id} failed (${p.check.run ? p.check.run.join(' ') : p.check.kind === 'lint' ? 'eslint --max-warnings=0' : 'tsc --noEmit, whole app'}; changed: ${p.why.slice(0, 5).join(', ')}${p.why.length > 5 ? ', ...' : ''}):\n` + L.redact(failingPart(r.text, S.maxLines), S.maxLines));
    process.stderr.write('HIVE FACTORY (layer 2): do not stop yet; these checks cover the files you changed and they fail. Fix the cause (not the test), then finish.\n\n' + parts.join('\n\n') + (skipped.length ? '\n\n' + skipped.join('\n') : '') + (manualLine ? '\n\n' + manualLine : '') + '\n');
    return 2;
  }
  const notes = [];
  if (failed.length) notes.push('failing (warn mode): ' + failed.map(({ p }) => p.check.id).join(', '));
  if (held.length) notes.push('still failing, the stop was let through to avoid a loop: ' + held.join(', '));
  if (skipped.length) notes.push(skipped.join('; '));
  if (manualLine) notes.push(manualLine);
  if (notes.length) say({ systemMessage: 'Hive factory: ' + notes.join(' | ') });
  return 0;
}

const isMain = process.argv[1] && import.meta.url.toLowerCase().endsWith(path.basename(process.argv[1]).toLowerCase());
if (isMain) {
  main().then((code) => process.exit(code)).catch((e) => {
    L.log('stop', 'error', { error: String((e && e.message) || e).slice(0, 300) });
    process.exit(0);
  });
}
