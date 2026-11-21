// Proof for the checker's program: node --test core/skills/hive-verify/scripts/verify.test.mjs
// Everything runs on a made-up example in temporary folders: a git repository with a one-file page
// served by a few lines of Node, and one commit that changes it. Never the real site.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { cleanEnv, decide, inside, proofSection, portBusy } from './verify.mjs';

const PROGRAM = path.join(path.dirname(fileURLToPath(import.meta.url)), 'verify.mjs');
const made = [];
const tmp = (p) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), `hive-verify-${p}-`)); made.push(d); return d; };
test.after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });
const sh = (cwd, ...a) => { const r = spawnSync('git', a, { cwd, encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
const verify = (...a) => { const r = spawnSync(process.execPath, [PROGRAM, ...a], { encoding: 'utf8' }); return { code: r.status, out: (r.stdout + r.stderr).trim() }; };
const freePort = () => new Promise((res) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });

const SERVER = "import http from 'node:http'; import fs from 'node:fs';\nhttp.createServer((q, r) => { r.setHeader('content-type', 'text/html'); r.end(fs.readFileSync('index.html')); }).listen(Number(process.env.PORT), 'localhost');\n";
const CHECK = "import fs from 'node:fs';\nprocess.exit(fs.readFileSync('index.html', 'utf8').includes('<h1>Hello</h1>') ? 0 : 1);\n";

function madeUpRepo() {
  const repo = tmp('repo');
  sh(repo, 'init', '-q');
  sh(repo, 'config', 'user.email', 'made-up@example.invalid');
  sh(repo, 'config', 'user.name', 'Made Up');
  fs.writeFileSync(path.join(repo, 'server.mjs'), SERVER);
  fs.writeFileSync(path.join(repo, 'check.mjs'), CHECK);
  fs.writeFileSync(path.join(repo, 'index.html'), '<h1>Helo</h1>\n');
  sh(repo, 'add', '.'); sh(repo, 'commit', '-qm', 'page with a typo');
  fs.writeFileSync(path.join(repo, 'index.html'), '<h1>Hello</h1>\n');
  sh(repo, 'commit', '-qam', 'fix the typo');
  return repo;
}

const step = (bOk, aOk, bEv = ['before-home.html'], aEv = ['after-home.html']) => ({ steps: [{ do: 'Open / and read the heading', before: { seen: true, ok: bOk, saw: 'Helo', evidence: bEv }, after: { seen: true, ok: aOk, saw: 'Hello', evidence: aEv } }] });
const all = () => true;

test('the verdict: PASS only when every step was seen on both versions with its own evidence', () => {
  assert.equal(decide(step(true, true), all).verdict, 'PASS');
  assert.equal(decide(step(true, false), all).verdict, 'FAIL');
  assert.equal(decide(step(false, true), all).verdict, 'NOTHING PROVEN', 'fault not reproduced on the old version');
  assert.equal(decide({ steps: [] }, all).verdict, 'NOTHING PROVEN');
  assert.equal(decide({}, all).verdict, 'NOTHING PROVEN');
  const unseen = step(true, true); unseen.steps[0].after.seen = false;
  assert.equal(decide(unseen, all).verdict, 'NOTHING PROVEN');
  assert.equal(decide(step(true, true, ['x.png'], ['x.png']), all).verdict, 'NOTHING PROVEN', 'one file for both');
  assert.equal(decide(step(true, true, [], ['a.png']), all).verdict, 'NOTHING PROVEN', 'no evidence');
  assert.equal(decide(step(true, true, ['../../me/x.png'], ['a.png']), all).verdict, 'NOTHING PROVEN', 'outside the folder');
  assert.equal(decide(step(true, true), (f) => f !== 'after-home.html').verdict, 'NOTHING PROVEN', 'missing file');
  assert.equal(decide(step(true, true), all, { before: 'abc', after: 'abc' }).verdict, 'NOTHING PROVEN', 'same commit');
  const string = step(true, true); string.steps[0].after.ok = 'yes';
  assert.equal(decide(string, all).verdict, 'NOTHING PROVEN', 'only true counts');
});

test('the proof part is cut out of a brief and nothing else', () => {
  const md = '# Brief\n\n## What\nBuilder notes\n\n## How it will be proven\n- Open /\n### Steps\n1. Read it\n\n## Out of scope\nx\n';
  const p = proofSection(md);
  assert.match(p, /^## How it will be proven/);
  assert.match(p, /Read it/);
  assert.doesNotMatch(p, /Builder notes|Out of scope/);
  assert.equal(proofSection('# Brief\nno proof here\n'), '');
});

test('real key names never reach a copy; paths are judged by folder', () => {
  const env = cleanEnv({ PATH: 'x', AUTH_SECRET: 'r', HIVE_GATE_KEY: 'r', OWNER_GITHUB_ID: '1', VERCEL_TOKEN: 'r', HIVE_REMOTE_KEY: 'r', GH_TOKEN: 'r' });
  assert.deepEqual(Object.keys(env), ['PATH']);
  assert.ok(inside('/a/b/c', '/a/b'));
  assert.ok(!inside('/a/bc', '/a/b'));
});

test('the evidence folder is refused inside the repository', () => {
  const repo = madeUpRepo();
  const r = verify('prepare', '--repo', repo, '--slug', 'inside', '--state', path.join(repo, 'state'));
  assert.equal(r.code, 2);
  assert.match(r.out, /may not be inside the repository/);
});

test('end to end on the made-up repository: two copies, two ports, evidence, verdict, nothing left behind', async () => {
  const repo = madeUpRepo();
  const state = tmp('state');
  const brief = path.join(state, 'brief.md');
  fs.writeFileSync(brief, '# Fix the heading\n\n## Builder reasoning\nsecret thoughts\n\n## How it will be proven\n1. Open / and read the heading: today it says Helo; done, it says Hello.\n');
  const target = tmp('modules'); fs.writeFileSync(path.join(target, 'keep.txt'), 'must survive');

  const p = verify('prepare', '--repo', repo, '--slug', 'Fix Heading', '--brief', brief, '--state', state);
  assert.equal(p.code, 0, p.out);
  const ev = JSON.parse(p.out).evidence;
  assert.ok(!fs.readFileSync(path.join(ev, 'proof.md'), 'utf8').includes('secret thoughts'));
  assert.equal(fs.readFileSync(path.join(ev, 'changed-files.txt'), 'utf8').trim(), 'index.html');

  const [pb, pa] = [await freePort(), await freePort()];
  for (const [s, port] of [['before', pb], ['after', pa]]) {
    const st = verify('start', '--run', ev, '--side', s, '--port', String(port), '--cmd', 'node server.mjs', '--link', `node_modules=${target}`, '--timeout', '30');
    assert.equal(st.code, 0, st.out);
    assert.equal(verify('fetch', '--run', ev, '--side', s, '--path', '/', '--name', 'home').code, 0);
    assert.equal(verify('tests', '--run', ev, '--side', s, '--cmd', 'node check.mjs', '--name', 'check').code, 0);
  }
  assert.match(fs.readFileSync(path.join(ev, 'before-home.html'), 'utf8'), /Helo</);
  assert.match(fs.readFileSync(path.join(ev, 'after-home.html'), 'utf8'), /Hello</);
  const run = JSON.parse(fs.readFileSync(path.join(ev, 'run.json'), 'utf8'));
  assert.equal(run.sides.before.tests.check.exit, 1, 'the check is red on the old version');
  assert.equal(run.sides.after.tests.check.exit, 0, 'and green on the new one');
  const busy = verify('start', '--run', ev, '--side', 'after', '--port', String(pb), '--cmd', 'node server.mjs');
  assert.equal(busy.code, 2, 'a port in use is refused');
  const key = verify('start', '--run', ev, '--side', 'after', '--port', String(await freePort()), '--cmd', 'node server.mjs', '--env', 'AUTH_SECRET=real');
  assert.equal(key.code, 2, 'a real key name passed by hand is refused');
  assert.match(key.out, /refused/);

  const c = verify('cleanup', '--run', ev);
  assert.equal(c.code, 0, c.out);
  assert.match(c.out, /^clean \(/m);
  assert.equal(await portBusy(pb), false);
  assert.equal(await portBusy(pa), false);
  assert.equal(sh(repo, 'worktree', 'list').split('\n').length, 1, 'only the main copy is listed');
  assert.equal(fs.readFileSync(path.join(target, 'keep.txt'), 'utf8'), 'must survive', 'a linked folder is unlinked, never emptied');

  const steps = path.join(state, 'steps.json');
  fs.writeFileSync(steps, JSON.stringify({ change: 'Fix the heading', kind: 'fix', ...step(true, true) }));
  const r = verify('result', '--run', ev, '--steps', steps);
  assert.match(r.out, /^PASS/);
  const page = fs.readFileSync(path.join(ev, 'result.md'), 'utf8');
  assert.match(page, /\*\*Verdict: PASS\*\*/);
  assert.match(page, /Clean-up: clean/);
});
