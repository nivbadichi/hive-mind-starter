// Hive Mind factory, layers 1 and 2: the shared parts of on-edit.mjs and on-stop.mjs.
// Nothing here prints; the two hook programs decide what Claude and the person see.
// Every child process gets a time limit and is killed when it runs over. Nothing here reads me/ or any .env file.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const HOME = process.env.HIVE_HOME || os.homedir();
export const STATE = process.env.HIVE_STATE || path.join(HOME, '.claude', 'hive');
export const FDIR = path.join(STATE, 'factory');
export const LOG = path.join(STATE, 'factory.log');
export const OFF = path.join(STATE, 'factory-off');

export const DEFAULTS = {
  enabled: true,
  lint: { mode: 'refuse', when: 'edit', timeoutMs: 20000 },
  types: { mode: 'refuse', when: 'edit', timeoutMs: 22000 },
  tests: { mode: 'refuse' },
  edit: { limitMs: 25000, extensions: ['.ts', '.tsx', '.mts', '.cts'], skipFolders: ['node_modules', '.next', 'out', 'dist', '.vercel', '.shots', 'coverage'] },
  stop: { limitMs: 170000, maxParallel: 3 },
  maxLines: 30,
};

const unixy = (p) => String(p || '').replace(/\\/g, '/');
export const norm = (p) => unixy(path.resolve(String(p || ''))).replace(/\/+$/, '');
const lower = (p) => (process.platform === 'win32' ? p.toLowerCase() : p);
export const inside = (child, parent) => { const c = lower(norm(child)), p = lower(norm(parent)); return c === p || c.startsWith(p + '/'); };
export const short = (s) => crypto.createHash('sha1').update(lower(norm(s))).digest('hex').slice(0, 12);

export function log(mode, event, detail = {}) {
  try {
    if (!fs.existsSync(STATE)) return;
    try { if (fs.statSync(LOG).size > 1_000_000) fs.renameSync(LOG, LOG + '.1'); } catch {}
    fs.appendFileSync(LOG, JSON.stringify({ t: new Date().toISOString(), mode, event, ...detail }) + '\n');
  } catch {}
}

export function isOff() {
  if (process.env.HIVE_FACTORY_OFF === '1') return true;
  try { return fs.existsSync(OFF) || fs.existsSync(path.join(STATE, 'gates-off')); } catch { return false; }
}

function merge(a, b) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b || {})) out[k] = v && typeof v === 'object' && !Array.isArray(v) && a[k] && typeof a[k] === 'object' ? merge(a[k], v) : v;
  return out;
}
export function loadSettings() {
  let user = {};
  try { user = JSON.parse(fs.readFileSync(process.env.HIVE_FACTORY_SETTINGS || path.join(HERE, 'settings.json'), 'utf8')); } catch {}
  return merge(DEFAULTS, user);
}

// Reads the hook's input with its own time limit: a hook run by hand with no input must not hang.
export function readStdin(ms = 1500) {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) return resolve('');
    let raw = '';
    const done = () => { clearTimeout(timer); process.stdin.removeAllListeners(); try { process.stdin.pause(); } catch {} resolve(raw); };
    const timer = setTimeout(done, ms);
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (d) => { raw += d; });
    process.stdin.on('end', done);
    process.stdin.on('error', done);
  });
}
export function parse(raw) { try { return raw && raw.trim() ? JSON.parse(raw) : {}; } catch { return {}; } }

// ---------- where things are ----------
// The repository a path belongs to: the nearest folder above it with a .git folder or a .git file (a worktree).
export function repoRootOf(p) {
  let dir = norm(p);
  try { if (fs.statSync(dir).isFile()) dir = norm(path.dirname(dir)); } catch { dir = norm(path.dirname(dir)); }
  for (let i = 0; i < 40; i++) {
    // Work on the full path: norm() cuts the trailing slash, and a bare drive letter like C: means the
    // current folder on that drive on Windows, which sent the walk back into the working folder.
    const full = path.resolve(dir + '/');
    if (fs.existsSync(path.join(full, '.git'))) return dir;
    const parent = path.dirname(full);
    if (parent === full) return '';
    dir = norm(parent);
  }
  return '';
}
// In a git worktree, the main checkout (where app/node_modules is installed). Read from the .git file, no git call.
export function mainCheckoutOf(root) {
  try {
    const g = path.join(root, '.git');
    if (fs.statSync(g).isDirectory()) return root;
    const m = /gitdir:\s*(.+)/.exec(fs.readFileSync(g, 'utf8'));
    if (!m) return root;
    const gitdir = path.resolve(root, m[1].trim());
    let common = path.resolve(gitdir, '..', '..');
    try { common = path.resolve(gitdir, fs.readFileSync(path.join(gitdir, 'commondir'), 'utf8').trim()); } catch {}
    return path.basename(common) === '.git' ? norm(path.dirname(common)) : root;
  } catch { return root; }
}
// The app folder a file belongs to: <repo>/app, with its package.json and tsconfig.json.
export function appOf(file) {
  const root = repoRootOf(file);
  if (!root) return null;
  const app = norm(path.join(root, 'app'));
  if (!inside(file, app) || !fs.existsSync(path.join(app, 'package.json'))) return null;
  return { root, app };
}
// Where the site's installed tools are: this copy's app/node_modules, or the main checkout's when this is a worktree.
export function modulesFor(root) {
  const local = path.join(root, 'app', 'node_modules');
  if (fs.existsSync(path.join(local, '.bin')) || fs.existsSync(path.join(local, 'typescript'))) return { appDir: norm(path.join(root, 'app')), dir: norm(local), borrowed: false };
  const main = mainCheckoutOf(root);
  const theirs = path.join(main, 'app', 'node_modules');
  if (main !== root && fs.existsSync(theirs)) return { appDir: norm(path.join(main, 'app')), dir: norm(theirs), borrowed: true };
  return null;
}

// ---------- safe output ----------
const SECRET = /(sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|xox[abpr]-[A-Za-z0-9-]{10,}|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}|-----BEGIN [A-Z ]+-----|\b[A-Fa-f0-9]{32,}\b|[A-Za-z0-9+_-]{40,}={0,2})/g;
// Lines that name the notebook's private folder (me/ at the top of the repository) or an .env file are left out whole.
const PRIVATE_LINE = /(^|[\s'"(=:])(\.\.[\\/])*me[\\/]|hive-mind[\\/]me[\\/]|(^|[\\/\s'"])\.env(\.[\w-]+)?($|[\s'":,)])|(^|[^-\w])snapshot\.json/i;
export function redact(text, maxLines = 30) {
  const lines = String(text || '').replace(/\r/g, '').split('\n').filter((l) => l.trim());
  const kept = lines.filter((l) => !PRIVATE_LINE.test(l)).map((l) => l.replace(SECRET, '[hidden]').slice(0, 400));
  const cut = kept.length > maxLines ? [...kept.slice(0, maxLines), `... and ${kept.length - maxLines} more lines`] : kept;
  if (kept.length < lines.length) cut.push(`(${lines.length - kept.length} line(s) left out: they named a private file)`);
  return cut.join('\n');
}

// ---------- running a tool with a hard limit ----------
// Runs `node <args>` (or another program), never through a shell, and kills it at the limit.
export function run(cmd, args, { cwd, timeoutMs = 20000, input, env } = {}) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    let out = '', err = '', settled = false, child;
    const finish = (r) => { if (settled) return; settled = true; clearTimeout(timer); resolve({ ms: Date.now() - t0, out, err, ...r }); };
    try {
      child = spawn(cmd, args, { cwd, env: env || process.env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (e) { return finish({ code: -1, missing: true, err: String(e.message || e) }); }
    const timer = setTimeout(() => { killTree(child); finish({ code: -1, timedOut: true }); }, timeoutMs);
    child.stdout.on('data', (d) => { if (out.length < 2_000_000) out += d; });
    child.stderr.on('data', (d) => { if (err.length < 2_000_000) err += d; });
    child.on('error', (e) => finish({ code: -1, missing: e.code === 'ENOENT', err: String(e.message || e) }));
    child.on('close', (code) => finish({ code }));
    try { if (input != null) child.stdin.end(input); else child.stdin.end(); } catch {}
  });
}
export function killTree(child) {
  if (!child || child.exitCode != null) return;
  try {
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore', timeout: 3000 });
    else child.kill('SIGKILL');
  } catch {}
}

// ---------- layer 1: lint one file ----------
export async function lintFile(file, ctx, S) {
  const mods = ctx.mods;
  const bin = mods && path.join(mods.dir, 'eslint', 'bin', 'eslint.js');
  if (!bin || !fs.existsSync(bin)) return { skipped: 'eslint is not installed in app/node_modules here or in the main checkout' };
  const rel = unixy(path.relative(ctx.app, file));
  // In a worktree the config's own imports only resolve in the main checkout, so the file's text is linted as if it lived there.
  const args = ['--max-warnings=0', '--format', 'json', '--no-warn-ignored'];
  let r;
  if (mods.borrowed) {
    const text = fs.readFileSync(file, 'utf8');
    r = await run(process.execPath, [bin, ...args, '--stdin', '--stdin-filename', path.join(mods.appDir, rel)], { cwd: mods.appDir, timeoutMs: S.lint.timeoutMs, input: text });
  } else {
    r = await run(process.execPath, [bin, ...args, rel], { cwd: ctx.app, timeoutMs: S.lint.timeoutMs });
  }
  if (r.timedOut) return { skipped: `eslint ran over its ${S.lint.timeoutMs} ms limit`, ms: r.ms };
  let results;
  try { results = JSON.parse(r.out); } catch { return { skipped: 'eslint did not answer (' + redact(r.err, 3).split('\n')[0] + ')', ms: r.ms }; }
  const lines = [];
  for (const res of results) for (const m of res.messages || []) lines.push(`app/${rel}:${m.line || 0}:${m.column || 0} ${m.severity === 2 ? 'error' : 'warning'} ${m.message}${m.ruleId ? ` (${m.ruleId})` : ''}`);
  // The JSON report also carries the file's text ("source"); it is dropped here and never printed.
  return { ok: lines.length === 0, lines, ms: r.ms };
}
// For lint.when "stop": the changed TypeScript files of a turn. One eslint run for all of them in a normal checkout; in a
// worktree one run per file (the text goes in on stdin), at most `max` files, the rest named as not linted.
export async function lintMany(files, ctx, S, max = 4) {
  const t0 = Date.now();
  if (!files.length) return { ok: true, lines: [], ms: 0 };
  if (ctx.mods && ctx.mods.borrowed) {
    const lines = [];
    for (const f of files.slice(0, max)) {
      const r = await lintFile(f, ctx, S);
      if (r.skipped) return { skipped: r.skipped, ms: Date.now() - t0 };
      lines.push(...r.lines);
    }
    if (files.length > max) lines.push(`(${files.length - max} more changed file(s) not linted here; run npm run lint in app/)`);
    return { ok: !lines.some((l) => / (error|warning) /.test(l)), lines, ms: Date.now() - t0 };
  }
  const bin = ctx.mods && path.join(ctx.mods.dir, 'eslint', 'bin', 'eslint.js');
  if (!bin || !fs.existsSync(bin)) return { skipped: 'eslint is not installed in app/node_modules' };
  const rels = files.map((f) => unixy(path.relative(ctx.app, f)));
  const r = await run(process.execPath, [bin, '--max-warnings=0', '--format', 'json', '--no-warn-ignored', ...rels], { cwd: ctx.app, timeoutMs: S.lint.timeoutMs });
  if (r.timedOut) return { skipped: `eslint ran over its ${S.lint.timeoutMs} ms limit`, ms: r.ms };
  let results;
  try { results = JSON.parse(r.out); } catch { return { skipped: 'eslint did not answer', ms: r.ms }; }
  const lines = [];
  for (const res of results) for (const m of res.messages || []) lines.push(`app/${unixy(path.relative(ctx.app, res.filePath || ''))}:${m.line || 0}:${m.column || 0} ${m.severity === 2 ? 'error' : 'warning'} ${m.message}${m.ruleId ? ` (${m.ruleId})` : ''}`);
  return { ok: lines.length === 0, lines, ms: r.ms };
}

// ---------- layer 1: incremental type check of the whole app ----------
function lock(name, staleMs = 60000) {
  const p = path.join(FDIR, name + '.lock');
  try { fs.mkdirSync(FDIR, { recursive: true }); } catch {}
  try { const st = fs.statSync(p); if (Date.now() - st.mtimeMs > staleMs) fs.rmSync(p, { force: true }); } catch {}
  try { fs.writeFileSync(p, String(process.pid), { flag: 'wx' }); return () => { try { fs.rmSync(p, { force: true }); } catch {} }; } catch { return null; }
}
// In a worktree the type check borrows the main checkout's installed packages through a small config kept in the factory's
// state folder (never inside app/): it extends the app's own tsconfig and adds the borrowed folders to the lookup.
function borrowedConfig(app, mods, info) {
  let own = {};
  try { own = JSON.parse(fs.readFileSync(path.join(app, 'tsconfig.json'), 'utf8')); } catch { return null; }
  const paths = {};
  for (const [k, v] of Object.entries((own.compilerOptions && own.compilerOptions.paths) || {})) paths[k] = v.map((x) => unixy(path.resolve(app, x)));
  paths['*'] = [mods.dir + '/@types/*', mods.dir + '/*'];
  const cfg = { extends: unixy(path.join(app, 'tsconfig.json')), compilerOptions: { paths, typeRoots: [mods.dir + '/@types'], incremental: true, noEmit: true, tsBuildInfoFile: unixy(info) } };
  const p = path.join(FDIR, 'tsconfig-' + short(app) + '.json');
  fs.writeFileSync(p, JSON.stringify(cfg, null, 2));
  return p;
}
export async function typeCheck(ctx, S, focusFile) {
  const mods = ctx.mods;
  const bin = mods && path.join(mods.dir, 'typescript', 'bin', 'tsc');
  if (!bin || !fs.existsSync(bin)) return { skipped: 'typescript is not installed in app/node_modules here or in the main checkout' };
  const unlock = lock('tsc-' + short(ctx.app));
  if (!unlock) return { skipped: 'another type check of this copy is still running' };
  try {
    fs.mkdirSync(FDIR, { recursive: true });
    const info = path.join(FDIR, 'tsc-' + short(ctx.app) + '.tsbuildinfo');
    let args;
    if (mods.borrowed) {
      const cfg = borrowedConfig(ctx.app, mods, info);
      if (!cfg) return { skipped: 'app/tsconfig.json could not be read as plain JSON' };
      args = [bin, '-p', cfg, '--pretty', 'false'];
    } else {
      args = [bin, '-p', 'tsconfig.json', '--noEmit', '--incremental', '--tsBuildInfoFile', info, '--pretty', 'false'];
    }
    const r = await run(process.execPath, args, { cwd: ctx.app, timeoutMs: S.types.timeoutMs });
    if (r.timedOut) return { skipped: `the type check ran over its ${S.types.timeoutMs} ms limit`, ms: r.ms };
    if (r.code === 0) return { ok: true, lines: [], ms: r.ms };
    const raw = (r.out + '\n' + r.err).replace(/\r/g, '').split('\n').filter((l) => /error TS\d+/.test(l));
    if (!raw.length) return { skipped: 'tsc stopped without a type error (' + redact(r.out + r.err, 2).split('\n')[0] + ')', ms: r.ms };
    // Paths come back relative to the app folder (or absolute through the borrowed config); show them as app/...
    const show = (l) => { let s = unixy(l); const a = unixy(ctx.app) + '/'; if (s.toLowerCase().startsWith(a.toLowerCase())) s = s.slice(a.length); return 'app/' + s.replace(/^\.\.\/+/, ''); };
    const focus = focusFile ? unixy(path.relative(ctx.app, focusFile)).toLowerCase() : '';
    const mine = [], others = [];
    for (const l of raw) (focus && unixy(l).toLowerCase().includes(focus) ? mine : others).push(show(l));
    return { ok: false, lines: [...mine, ...others], mine: mine.length, others: others.length, ms: r.ms };
  } finally { unlock(); }
}

// ---------- layer 2: the impact map ----------
export function loadMap(root) {
  for (const p of [path.join(root, 'core', 'factory', 'impact-map.json'), path.join(HERE, 'impact-map.json')]) {
    try { return { map: JSON.parse(fs.readFileSync(p, 'utf8')), from: p }; } catch {}
  }
  return { map: { checks: [] }, from: '' };
}
// A small glob: ** any folders, * anything but a slash, ? one character. Paths are repository-relative with forward slashes.
export function globToRe(g) {
  let re = '';
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === '*' && g[i + 1] === '*') { re += g[i + 2] === '/' ? '(?:.*/)?' : '.*'; i += g[i + 2] === '/' ? 2 : 1; }
    else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp('^' + re + '$', process.platform === 'win32' ? 'i' : '');
}
export const matchAny = (rel, globs) => (globs || []).some((g) => globToRe(g).test(rel));

function walkFiles(root, rel, out, limit = 4000) {
  let entries = [];
  try { entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (out.length >= limit) return;
    if (e.name === 'node_modules' || e.name === '.git' || e.name === '.next') continue;
    const r = rel ? rel + '/' + e.name : e.name;
    if (e.isDirectory()) walkFiles(root, r, out, limit); else out.push(r);
  }
}
// Every file a test entry reaches through its static imports (relative paths and the "@/" alias), inside the repository.
const SPEC = /(?:\bfrom\s*|\bimport\s*\(?\s*)['"]([^'"\n]+)['"]/g;
export function importClosure(root, entries, aliases = {}) {
  const seen = new Set();
  const stack = [...entries];
  const tryFile = (abs) => {
    for (const p of [abs, abs + '.ts', abs + '.tsx', abs + '.mjs', abs + '.js', path.join(abs, 'index.ts'), path.join(abs, 'index.tsx')]) {
      try { if (fs.statSync(p).isFile()) return unixy(path.relative(root, p)); } catch {}
    }
    return '';
  };
  while (stack.length && seen.size < 3000) {
    const rel = stack.pop();
    if (seen.has(rel)) continue;
    seen.add(rel);
    let text = '';
    try { text = fs.readFileSync(path.join(root, rel), 'utf8'); } catch { continue; }
    for (const m of text.matchAll(SPEC)) {
      const spec = m[1];
      let abs = '';
      if (spec.startsWith('./') || spec.startsWith('../')) abs = path.resolve(root, path.dirname(rel), spec);
      else for (const [a, to] of Object.entries(aliases)) if (spec.startsWith(a)) abs = path.resolve(root, to, spec.slice(a.length));
      if (!abs) continue;
      const hit = tryFile(abs);
      if (hit && !hit.startsWith('..') && !seen.has(hit)) stack.push(hit);
    }
  }
  return seen;
}
// Which checks a set of changed files touches: the check's own entry files, anything they import, and the hand-kept globs.
export function selectChecks(root, map, changed) {
  const picked = [];
  for (const c of map.checks || []) {
    // Only the folders the entry globs start in are listed, never the whole notebook.
    const found = [];
    for (const g of c.entries || []) {
      const star = g.search(/[*?]/);
      const base = star < 0 ? g : g.slice(0, g.lastIndexOf('/', star) + 1).replace(/\/$/, '');
      if (star < 0) { if (fs.existsSync(path.join(root, g))) found.push(g); } else walkFiles(root, base, found, 500);
    }
    const entries = found.filter((f) => matchAny(f, c.entries));
    const closure = importClosure(root, entries, map.aliases || {});
    const why = changed.filter((f) => closure.has(f) || matchAny(f, c.entries) || matchAny(f, c.covers));
    if (why.length) picked.push({ check: c, why });
  }
  return picked;
}
// The files git sees as changed in this copy (staged, unstaged and new), repository-relative.
export function changedFiles(root, timeoutMs = 4000) {
  const r = spawnSync('git', ['-C', root, 'status', '--porcelain=v1', '-z', '--untracked-files=all'], { encoding: 'utf8', timeout: timeoutMs, windowsHide: true });
  if (r.status !== 0 || r.error) return null;
  const parts = r.stdout.split('\0').filter(Boolean);
  const files = [];
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    const xy = p.slice(0, 2), f = p.slice(3);
    files.push(unixy(f));
    if (xy[0] === 'R' || xy[0] === 'C') i++; // the old name of a rename follows
  }
  return files;
}
// A fingerprint of the changed files a check cares about: their names, sizes and change times.
export function fingerprint(root, id, files) {
  const h = crypto.createHash('sha1').update(id);
  for (const f of [...files].sort()) {
    let st = 'gone';
    try { const s = fs.statSync(path.join(root, f)); st = s.size + ':' + Math.round(s.mtimeMs); } catch {}
    h.update('\n' + f + '\t' + st);
  }
  return h.digest('hex').slice(0, 16);
}
export function readJson(p, fallback) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; } }
export function writeJson(p, v) { try { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(v)); } catch {} }
export const fallbackImport = () => pathToFileURL(path.join(HERE, 'modules-fallback.mjs')).href;
