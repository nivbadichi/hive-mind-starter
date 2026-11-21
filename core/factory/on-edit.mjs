#!/usr/bin/env node
// Hive Mind factory, layer 1: a PostToolUse hook for Edit, Write and MultiEdit.
// When the edited file is TypeScript under <repo>/app/, it runs the linter on that file and an incremental type check of
// the app (side by side), and on a fault exits 2 with the errors on stderr, which Claude Code hands back to the agent.
// Any other file: exit 0 at once, before anything heavy is loaded.
// Modes (core/factory/settings.json): lint.mode and types.mode are "refuse" (exit 2), "warn" (the errors go to the agent as
// context, exit 0) or "off"; types.when "stop" moves the type check to on-stop.mjs. A missing tool, a time-out or a crash
// never blocks: it warns and logs to ~/.claude/hive/factory.log. Off switch: ~/.claude/hive/factory-off (or gates-off).
import fs from 'node:fs';
import path from 'node:path';

const T0 = Date.now();
const EXT = /\.(ts|tsx|mts|cts)$/i;
const SKIP = /[\\/](node_modules|\.next|out|dist|\.vercel|\.shots|coverage)[\\/]/i;

function readInput() {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) return resolve({});
    let raw = '';
    const done = () => { clearTimeout(t); try { process.stdin.pause(); } catch {} try { resolve(raw.trim() ? JSON.parse(raw) : {}); } catch { resolve({}); } };
    const t = setTimeout(done, 1500);
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (d) => { raw += d; });
    process.stdin.on('end', done);
    process.stdin.on('error', done);
  });
}

// The quick test: TypeScript, not in a built or installed folder, and somewhere under a folder called app.
export function looksLikeAppCode(file) {
  if (!file || !EXT.test(file) || SKIP.test(file)) return false;
  return /[\\/]app[\\/]/i.test(path.resolve(file));
}

async function main() {
  const input = await readInput();
  const ti = input.tool_input || {};
  const given = ti.file_path || ti.path || ti.notebook_path || '';
  const file = given ? path.resolve(input.cwd || process.cwd(), given) : '';
  if (!looksLikeAppCode(file) || !fs.existsSync(file)) return 0;

  const L = await import('./lib.mjs');
  if (L.isOff()) return 0;
  const S = L.loadSettings();
  if (S.enabled === false) return 0;
  const where = L.appOf(file);
  if (!where) return 0;
  const lintOn = S.lint.mode !== 'off' && S.lint.when !== 'stop';
  const typesOn = S.types.mode !== 'off' && S.types.when !== 'stop';
  if (!lintOn && !typesOn) return 0;

  // A hard limit for the whole hook: past it, warn and let the work go on.
  const limit = setTimeout(() => {
    L.log('edit', 'timeout', { ms: Date.now() - T0 });
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: `HIVE FACTORY: the lint and type check of this edit ran over ${S.edit.limitMs} ms and were stopped; run npm run lint and npm run typecheck in app/ before you finish.` } }));
    process.exit(0);
  }, S.edit.limitMs);
  limit.unref();

  const ctx = { root: where.root, app: where.app, mods: L.modulesFor(where.root) };
  const [lint, types] = await Promise.all([
    lintOn ? L.lintFile(file, ctx, S) : null,
    typesOn ? L.typeCheck(ctx, S, file) : null,
  ]);
  clearTimeout(limit);

  const rel = 'app/' + path.relative(where.app, file).replace(/\\/g, '/');
  const blocks = [], warns = [], skipped = [];
  for (const [name, r, mode] of [['lint', lint, S.lint.mode], ['type check', types, S.types.mode]]) {
    if (!r) continue;
    if (r.skipped) { skipped.push(`${name} not run: ${r.skipped}`); continue; }
    if (r.ok) continue;
    const head = name === 'lint' ? `lint (eslint --max-warnings=0) on ${rel}:` : `type check (tsc --noEmit, whole app; ${r.mine} in ${rel}, ${r.others} elsewhere):`;
    (mode === 'refuse' ? blocks : warns).push(head + '\n' + L.redact(r.lines.join('\n'), S.maxLines));
  }
  L.log('edit', blocks.length ? 'refuse' : warns.length || skipped.length ? 'warn' : 'pass', {
    file: rel, lintMs: lint && lint.ms, typesMs: types && types.ms, ms: Date.now() - T0, borrowed: !!(ctx.mods && ctx.mods.borrowed), skipped,
  });
  if (blocks.length) {
    process.stderr.write('HIVE FACTORY (layer 1): the edit you just made leaves faults. Fix them before you go on.\n\n' + [...blocks, ...warns].join('\n\n') + (skipped.length ? '\n\n' + skipped.join('\n') : '') + '\n');
    return 2;
  }
  if (warns.length || skipped.length) {
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: 'HIVE FACTORY (layer 1, warning only): ' + [...warns, ...skipped].join('\n\n') } }));
  }
  return 0;
}

const isMain = process.argv[1] && import.meta.url.toLowerCase().endsWith(path.basename(process.argv[1]).toLowerCase());
if (isMain) {
  main().then((code) => process.exit(code)).catch(async (e) => {
    try { (await import('./lib.mjs')).log('edit', 'error', { error: String((e && e.message) || e).slice(0, 300) }); } catch {}
    process.exit(0);
  });
}
