#!/usr/bin/env node
/**
 * The exact parts of hive-verify. The checker's judgment stays in the skill; this program only
 * makes the two copies, starts and stops them, keeps the evidence and works out the verdict.
 *
 *   node verify.mjs prepare --repo <dir> --before <ref> --after <ref> --slug <name> [--brief <file>] [--state <dir>]
 *   node verify.mjs start   --run <dir> --side before|after --port <n> --cmd "<command>"
 *                           [--cwd <sub>] [--ready <path>] [--timeout <s>] [--made-up-sign-in]
 *                           [--made-up-snapshot] [--link <sub>=<abs dir>] [--env KEY=VALUE]
 *   node verify.mjs fetch   --run <dir> --side before|after --path </x> --name <name>
 *   node verify.mjs tests   --run <dir> --side before|after --cmd "<command>" --name <name> [--cwd <sub>]
 *   node verify.mjs stop    --run <dir> [--side before|after]
 *   node verify.mjs cleanup --run <dir>
 *   node verify.mjs result  --run <dir> --steps <steps.json>
 *
 * The evidence folder is <state>/verify/<date>_<slug>/ where <state> is --state, else HIVE_STATE,
 * else ~/.claude/hive. It is refused inside the repository: screenshots of the pages are private.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const SIDES = ['before', 'after'];

/** Names of real keys a copy must never inherit from this computer's environment. */
const DENY = /^(AUTH_|NEXTAUTH|OWNER_GITHUB_ID|HIVE_GATE_KEY|HIVE_PRIVATE_|HIVE_REMOTE_|VERCEL|GITHUB_TOKEN|GH_TOKEN|ANTHROPIC_|OPENAI|KV_|UPSTASH_|REDIS_)/i;

export function cleanEnv(env) {
  const out = {};
  for (const [k, v] of Object.entries(env)) if (!DENY.test(k)) out[k] = v;
  return out;
}

/** True when `child` is `parent` or lies inside it. */
export function inside(child, parent) {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/** The "How it will be proven" part of a brief, heading included; '' when there is none. */
export function proofSection(md) {
  const lines = md.split(/\r?\n/);
  const start = lines.findIndex((l) => /^#{1,6}\s.*how it will be proven/i.test(l));
  if (start < 0) return '';
  const level = lines[start].match(/^#+/)[0].length;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const m = lines[i].match(/^(#+)\s/);
    if (m && m[1].length <= level) { end = i; break; }
  }
  return lines.slice(start, end).join('\n').trim() + '\n';
}

/**
 * The verdict, worked out from what the checker recorded. PASS only when every step was seen on
 * both versions, behaved as the proof part says on each, and has its own kept evidence.
 * `exists(name)` says whether an evidence file is in the folder and not empty.
 */
export function decide(record, exists, shas = {}) {
  const reasons = [];
  const steps = Array.isArray(record?.steps) ? record.steps : [];
  if (!steps.length) reasons.push('no steps were recorded');
  if (shas.before && shas.before === shas.after) reasons.push('the two versions are the same commit');
  let failed = false;
  steps.forEach((s, i) => {
    const n = `step ${i + 1}`;
    for (const side of SIDES) {
      const r = s?.[side] ?? {};
      if (r.seen !== true) { reasons.push(`${n}: not seen on the ${side} version`); continue; }
      const ev = Array.isArray(r.evidence) ? r.evidence : [];
      if (!ev.length) reasons.push(`${n}: no evidence kept for the ${side} version`);
      for (const f of ev) {
        if (typeof f !== 'string' || f.includes('..') || path.isAbsolute(f) || !exists(f)) reasons.push(`${n}: evidence "${f}" is not in the evidence folder`);
      }
      if (side === 'after' && r.ok === false) { failed = true; reasons.push(`${n}: the after version did not do what done looks like`); }
      else if (r.ok !== true) reasons.push(side === 'before' ? `${n}: the before version did not show what the proof part says today's code shows` : `${n}: not marked as matching done`);
    }
    const shared = (s?.before?.evidence ?? []).filter((f) => (s?.after?.evidence ?? []).includes(f));
    if (shared.length) reasons.push(`${n}: the same evidence file is used for both versions (${shared.join(', ')})`);
  });
  if (failed) return { verdict: 'FAIL', reasons };
  return reasons.length ? { verdict: 'NOTHING PROVEN', reasons } : { verdict: 'PASS', reasons };
}

/* ---------- helpers ---------- */

function args(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { o._.push(a); continue; }
    const key = a.slice(2);
    const next = argv[i + 1];
    const val = next === undefined || next.startsWith('--') ? true : (i++, next);
    if (key === 'link' || key === 'env') (o[key] ??= []).push(val); else o[key] = val;
  }
  return o;
}
function die(msg, code = 2) { console.error(`hive-verify: ${msg}`); process.exit(code); }
function git(repo, ...a) {
  const r = spawnSync('git', ['-C', repo, ...a], { encoding: 'utf8' });
  if (r.status !== 0) die(`git ${a.join(' ')} failed: ${(r.stderr || r.stdout).trim()}`);
  return r.stdout.trim();
}
function stateRoot(o) { return path.resolve(o.state || process.env.HIVE_STATE || path.join(os.homedir(), '.claude', 'hive')); }
function runDir(o) {
  if (!o.run) die('--run <evidence folder> is needed');
  const d = path.resolve(String(o.run).replace(/run\.json$/, ''));
  if (!fs.existsSync(path.join(d, 'run.json'))) die(`no run.json in ${d}`);
  return d;
}
const load = (d) => JSON.parse(fs.readFileSync(path.join(d, 'run.json'), 'utf8'));
const save = (d, run) => fs.writeFileSync(path.join(d, 'run.json'), JSON.stringify(run, null, 2) + '\n');
function side(o) { if (!SIDES.includes(o.side)) die('--side before|after is needed'); return o.side; }
/** This computer's own date (not UTC), as every dated name in the notebook uses. */
const today = () => new Date().toLocaleDateString('sv-SE');

export function portBusy(port) {
  const probe = (host) => new Promise((res) => {
    const s = net.connect({ host, port });
    const done = (v) => { s.destroy(); res(v); };
    s.setTimeout(400, () => done(false));
    s.on('connect', () => done(true));
    s.on('error', () => done(false));
  });
  return Promise.all([probe('127.0.0.1'), probe('::1')]).then((r) => r.some(Boolean));
}
function killTree(pid) {
  if (!pid) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/T', '/F', '/PID', String(pid)], { stdio: 'ignore' });
  else { try { process.kill(-pid, 'SIGKILL'); } catch { try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } } }
}
function alive(pid) { try { process.kill(pid, 0); return true; } catch { return false; } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- commands ---------- */

function prepare(o) {
  if (!o.repo || !o.slug) die('prepare needs --repo and --slug');
  const repo = git(path.resolve(o.repo), 'rev-parse', '--show-toplevel');
  const after = git(repo, 'rev-parse', '--verify', `${o.after || 'HEAD'}^{commit}`);
  const before = git(repo, 'rev-parse', '--verify', `${o.before || `${after}^`}^{commit}`);
  const slug = String(o.slug).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '');
  const root = stateRoot(o);
  const id = `${today()}_${slug}`;
  const ev = path.join(root, 'verify', id);
  if (inside(ev, repo)) die('the evidence folder may not be inside the repository: screenshots stay on this computer');
  if (fs.existsSync(ev)) die(`${ev} exists already; pick another --slug`);
  fs.mkdirSync(ev, { recursive: true });
  const run = { id, repo, evidence: ev, created: new Date().toISOString(), sides: {} };
  for (const s of SIDES) {
    const dir = path.join(root, 'verify', 'worktrees', `${id}-${s}`);
    git(repo, 'worktree', 'add', '--detach', dir, s === 'before' ? before : after);
    run.sides[s] = { ref: s === 'before' ? (o.before || `${o.after || 'HEAD'}^`) : (o.after || 'HEAD'), sha: s === 'before' ? before : after, dir, links: [], tests: {} };
  }
  const changed = git(repo, 'diff', '--name-only', before, after);
  fs.writeFileSync(path.join(ev, 'changed-files.txt'), changed + '\n');
  if (o.brief) {
    const proof = proofSection(fs.readFileSync(path.resolve(o.brief), 'utf8'));
    fs.writeFileSync(path.join(ev, 'proof.md'), proof || '(the brief has no "How it will be proven" part)\n');
    run.proofFound = Boolean(proof);
  }
  save(ev, run);
  console.log(JSON.stringify({ evidence: ev, before: { sha: before, dir: run.sides.before.dir }, after: { sha: after, dir: run.sides.after.dir }, changed: changed ? changed.split('\n') : [] }, null, 2));
}

async function start(o) {
  const d = runDir(o); const run = load(d); const s = side(o);
  const port = Number(o.port);
  if (!Number.isInteger(port) || port < 1024) die('--port <n> (1024 or above) is needed');
  if (!o.cmd || o.cmd === true) die('--cmd "<command>" is needed');
  const other = run.sides[s === 'before' ? 'after' : 'before'];
  if (other.port === port) die(`port ${port} is the other version's port`);
  if (await portBusy(port)) die(`port ${port} is already in use`);
  const wt = run.sides[s].dir;
  const cwd = path.join(wt, o.cwd || '.');
  if (!inside(cwd, wt)) die('--cwd must stay inside the copy');
  const envFiles = fs.readdirSync(cwd).filter((f) => /^\.env/.test(f));
  if (envFiles.length) die(`refused: ${envFiles.join(', ')} found in the copy; only made-up values may be used`);
  for (const l of o.link ?? []) {
    const [sub, target] = String(l).split('=');
    const at = path.join(wt, sub);
    if (!inside(at, wt) || !target || !fs.existsSync(target)) die(`bad --link ${l}`);
    if (!fs.existsSync(at)) { fs.symlinkSync(path.resolve(target), at, 'junction'); run.sides[s].links.push(at); }
  }
  const env = { ...cleanEnv(process.env), PORT: String(port), HOSTNAME: 'localhost' };
  for (const e of o.env ?? []) {
    const [k, ...v] = String(e).split('=');
    if (!k || DENY.test(k)) die(`--env ${k}: refused; real keys never reach a copy (use --made-up-sign-in)`);
    env[k] = v.join('=');
  }
  if (o['made-up-sign-in']) {
    const madeUp = { AUTH_SECRET: crypto.randomBytes(32).toString('hex'), OWNER_GITHUB_ID: '12345678', AUTH_GITHUB_ID: 'made-up-id', AUTH_GITHUB_SECRET: 'made-up-secret', AUTH_TRUST_HOST: 'true' };
    Object.assign(env, madeUp);
    run.sides[s].madeUp = madeUp;
  }
  if (o['made-up-snapshot']) {
    const src = path.join(cwd, 'src', 'data', 'example-snapshot.json');
    const dst = path.join(cwd, 'src', 'data', 'snapshot.json');
    if (!fs.existsSync(src)) die('--made-up-snapshot: no src/data/example-snapshot.json under --cwd');
    if (fs.existsSync(dst)) die('refused: a snapshot.json is already in the copy');
    fs.copyFileSync(src, dst);
  }
  const log = fs.openSync(path.join(d, `${s}-server.log`), 'a');
  const child = spawn(o.cmd, { cwd, env, shell: true, detached: true, stdio: ['ignore', log, log], windowsHide: true });
  child.unref();
  Object.assign(run.sides[s], { port, pid: child.pid, cmd: o.cmd, url: `http://localhost:${port}` });
  save(d, run);
  const url = `http://localhost:${port}${o.ready || '/'}`;
  const until = Date.now() + Number(o.timeout || 120) * 1000;
  while (Date.now() < until) {
    if (!alive(child.pid)) die(`the ${s} version stopped while starting; see ${s}-server.log`, 1);
    try { const r = await fetch(url, { redirect: 'manual' }); console.log(`${s} version answers at ${run.sides[s].url} (${r.status})`); return; } catch { await sleep(500); }
  }
  killTree(child.pid);
  die(`the ${s} version did not answer within ${o.timeout || 120}s; stopped it`, 1);
}

async function fetchPage(o) {
  const d = runDir(o); const run = load(d); const s = side(o);
  if (!run.sides[s].url) die(`the ${s} version is not started`);
  if (!o.name || !/^[a-z0-9-]+$/i.test(o.name)) die('--name <letters, digits, dashes> is needed');
  const url = run.sides[s].url + (o.path || '/');
  const r = await fetch(url, { redirect: 'manual' });
  const file = `${s}-${o.name}.html`;
  fs.writeFileSync(path.join(d, file), await r.text());
  fs.appendFileSync(path.join(d, 'fetch.log'), `${new Date().toISOString()} ${s} ${r.status} ${o.path || '/'} -> ${file}\n`);
  console.log(`${r.status} ${url} -> ${file}`);
}

function tests(o) {
  const d = runDir(o); const run = load(d); const s = side(o);
  if (!o.cmd || o.cmd === true || !o.name || !/^[a-z0-9-]+$/i.test(o.name)) die('tests needs --cmd and --name');
  const wt = run.sides[s].dir; const cwd = path.join(wt, o.cwd || '.');
  if (!inside(cwd, wt)) die('--cwd must stay inside the copy');
  const r = spawnSync(o.cmd, { cwd, env: cleanEnv(process.env), shell: true, encoding: 'utf8', timeout: 600000, windowsHide: true });
  const file = `${s}-${o.name}.log`;
  fs.writeFileSync(path.join(d, file), `$ ${o.cmd}\n(exit ${r.status})\n${r.stdout ?? ''}${r.stderr ?? ''}`);
  run.sides[s].tests[o.name] = { cmd: o.cmd, exit: r.status, file };
  save(d, run);
  console.log(`${s} ${o.name}: exit ${r.status} -> ${file}`);
}

function stop(o, d = runDir(o), run = load(d)) {
  for (const s of o.side ? [side(o)] : SIDES) {
    const pid = run.sides[s].pid;
    if (pid) { killTree(pid); console.log(`stopped the ${s} version (pid ${pid})`); }
    run.sides[s].pid = null;
  }
  save(d, run);
}

async function cleanup(o) {
  const d = runDir(o); const run = load(d);
  stop({ ...o, side: undefined }, d, run);
  await sleep(500);
  const lines = [];
  for (const s of SIDES) {
    const sd = run.sides[s];
    for (const l of sd.links) { try { fs.unlinkSync(l); } catch { try { fs.rmdirSync(l); } catch { /* gone */ } } }
    spawnSync('git', ['-C', run.repo, 'worktree', 'remove', '--force', sd.dir], { encoding: 'utf8' });
  }
  spawnSync('git', ['-C', run.repo, 'worktree', 'prune'], { encoding: 'utf8' });
  const list = spawnSync('git', ['-C', run.repo, 'worktree', 'list', '--porcelain'], { encoding: 'utf8' }).stdout;
  let clean = true;
  for (const s of SIDES) {
    const sd = run.sides[s];
    const listed = list.split(/\r?\n/).some((l) => l.startsWith('worktree ') && path.resolve(l.slice(9)) === path.resolve(sd.dir));
    const there = fs.existsSync(sd.dir);
    const busy = sd.port ? await portBusy(sd.port) : false;
    if (listed || there || busy) clean = false;
    lines.push(`${s}: copy ${there ? 'STILL THERE' : 'removed'}; worktree ${listed ? 'STILL LISTED' : 'not listed'}; port ${sd.port ?? '-'} ${busy ? 'STILL IN USE' : 'free'}`);
  }
  lines.unshift(`${clean ? 'clean' : 'NOT CLEAN'} (${new Date().toISOString()})`);
  fs.writeFileSync(path.join(d, 'cleanup.txt'), lines.join('\n') + '\n');
  console.log(lines.join('\n'));
  if (!clean) process.exit(1);
}

function result(o) {
  const d = runDir(o); const run = load(d);
  if (!o.steps) die('--steps <steps.json> is needed');
  const rec = JSON.parse(fs.readFileSync(path.resolve(o.steps), 'utf8'));
  const exists = (f) => { const p = path.join(d, f); return inside(p, d) && fs.existsSync(p) && fs.statSync(p).isFile() && fs.statSync(p).size > 0; };
  const { verdict, reasons } = decide(rec, exists, { before: run.sides.before.sha, after: run.sides.after.sha });
  const changed = fs.readFileSync(path.join(d, 'changed-files.txt'), 'utf8').trim().split('\n').filter(Boolean);
  const cleanupLine = fs.existsSync(path.join(d, 'cleanup.txt')) ? fs.readFileSync(path.join(d, 'cleanup.txt'), 'utf8').split('\n')[0] : 'not done yet';
  const cell = (r) => r?.seen ? `${r.ok === true ? 'matches the proof part' : r.ok === false ? 'DOES NOT match the proof part' : 'unmarked'}. Saw: ${String(r.saw ?? '').replace(/\|/g, '/')}<br>${(r.evidence ?? []).map((f) => `[${f}](${f})`).join(', ')}` : 'NOT SEEN';
  const out = [
    `# Check: ${rec.change ?? run.id}`,
    '',
    `**Verdict: ${verdict}**`,
    '',
    `- Date: ${today()}. Kind: ${rec.kind ?? 'not given'}. Checker: ${rec.checker ?? 'not given'}.`,
    `- Before: \`${run.sides.before.ref}\` (${run.sides.before.sha.slice(0, 7)}). After: \`${run.sides.after.ref}\` (${run.sides.after.sha.slice(0, 7)}).`,
    `- Changed files (${changed.length}): ${changed.slice(0, 12).map((f) => `\`${f}\``).join(', ')}${changed.length > 12 ? ', ...' : ''}`,
    `- Proof part: ${run.proofFound === undefined ? 'no brief given' : run.proofFound ? '[proof.md](proof.md)' : 'the brief has none'}. Clean-up: ${cleanupLine}.`,
    '',
    '| # | Step | Before | After |',
    '|---|---|---|---|',
    ...(rec.steps ?? []).map((s, i) => `| ${i + 1} | ${String(s.do ?? '').replace(/\|/g, '/')} | ${cell(s.before)} | ${cell(s.after)} |`),
    '',
    reasons.length ? '## Why not a pass\n\n' + reasons.map((r) => `- ${r}`).join('\n') : '## Why a pass\n\nEvery step was seen on both versions, each behaved as the proof part says, and each has its own kept evidence.',
    ...(rec.notes?.length ? ['', '## Notes (seen, not judged)', '', ...rec.notes.map((n) => `- ${n}`)] : []),
    '',
  ].join('\n');
  fs.writeFileSync(path.join(d, 'result.md'), out);
  console.log(`${verdict} -> ${path.join(d, 'result.md')}`);
  for (const r of reasons) console.log(`  - ${r}`);
}

const COMMANDS = { prepare, start, fetch: fetchPage, tests, stop: (o) => stop(o), cleanup, result };

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const o = args(process.argv.slice(2));
  const cmd = COMMANDS[o._[0]];
  if (!cmd) die('commands: prepare, start, fetch, tests, stop, cleanup, result (see the top of verify.mjs)');
  await cmd(o);
}
