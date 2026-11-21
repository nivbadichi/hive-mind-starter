// Tests for the doctor: a made-up home with a healthy install, then broken on purpose, one fault at a time.
// Only temporary folders are touched.   node --test core/skills/hive-doctor/scripts/doctor.test.mjs
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { diagnose, codeState, publicAddress, askGitHub, isLocalAddress } from './doctor.mjs';
import { decode, encode, systemOf } from '../../../journey/code.mjs';

const DOCTOR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'doctor.mjs');
const GATES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'gates', 'gates.mjs');
const w = (f, t) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, t); };
const git = (dir, ...a) => spawnSync('git', ['-C', dir, ...a], { encoding: 'utf8' });
const made = [];
const tmp = (name) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), name)); made.push(d); return d; };
after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });

// A healthy made-up home, in a folder whose name holds a space.
function healthyHome() {
  const home = tmp('doctor home ');
  const nb = path.join(home, 'hive-mind');
  const claude = path.join(home, '.claude');
  const hive = path.join(claude, 'hive');
  w(path.join(nb, 'system', 'rules.md'), '# Rules\n1. A rule.\n');
  w(path.join(nb, 'me', 'profile.md'), '# About you\n');
  for (const s of ['hive-start', 'hive-close']) {
    w(path.join(nb, 'core', 'skills', s, 'SKILL.md'), `---\nname: ${s}\n---\n`);
    w(path.join(claude, 'skills', s, 'SKILL.md'), `---\r\nname: ${s}\r\n---\r\n`); // CRLF copy counts as the same
  }
  w(path.join(hive, 'start.ps1'), '# start');
  w(path.join(hive, 'gates', 'gates.mjs'), fs.readFileSync(GATES)); // the real gates: the doctor asks them where they look
  w(path.join(hive, 'privacy-guard.ps1'), '# guard');
  const start = (p) => ({ hooks: [{ type: 'command', command: `powershell -NoProfile -ExecutionPolicy Bypass -File "$HOME\\.claude\\hive\\start.ps1" -Part ${p}`, shell: 'powershell' }] });
  const gate = (m) => ({ hooks: [{ type: 'command', command: process.execPath, args: [path.join(hive, 'gates', 'gates.mjs').replace(/\\/g, '/'), m] }] });
  const settings = {
    theme: 'mine',
    hooks: {
      SessionStart: ['rules', 'state', 'flight'].map(start),
      PreToolUse: [gate('pretool')], PostToolUse: [gate('posttool')], UserPromptSubmit: [gate('prompt')],
      Stop: [gate('stop')], PreCompact: [gate('precompact')],
    },
  };
  w(path.join(claude, 'settings.json'), JSON.stringify(settings, null, 2));
  w(path.join(claude, 'CLAUDE.md'), '# Mine\n<!-- hive-mind:start -->\nblock\n<!-- hive-mind:end -->\n');
  git(nb, 'init', '-q');
  git(nb, 'remote', 'add', 'origin', 'https://example.invalid/notebook.git');
  w(path.join(nb, '.git', 'hooks', 'pre-commit'), '#!/bin/sh\n');
  return { home, nb, claude, hive, settings };
}
const run = (h, extra = {}) => diagnose({ home: h.home, claude: h.claude, here: h.nb, env: {}, ...extra });
const fixes = (r) => r.lines.filter((l) => l.kind === 'FIX').map((l) => l.id);

test('a healthy install has nothing to fix', () => {
  const h = healthyHome();
  const r = run(h);
  assert.deepEqual(fixes(r), [], JSON.stringify(r.lines.filter((l) => l.kind !== 'OK')));
  assert.equal(r.notebook, h.nb);
});

test('planted fault 1: a missing hook (the stop gate taken out of the settings)', () => {
  const h = healthyHome();
  delete h.settings.hooks.Stop;
  w(path.join(h.claude, 'settings.json'), JSON.stringify(h.settings));
  const r = run(h);
  assert.deepEqual(fixes(r), ['hook-missing']);
  assert.match(r.lines.find((l) => l.id === 'hook-missing').text, /'stop'/);
});

test('planted fault 1b: one start part missing', () => {
  const h = healthyHome();
  h.settings.hooks.SessionStart.pop();
  w(path.join(h.claude, 'settings.json'), JSON.stringify(h.settings));
  assert.match(run(h).lines.find((l) => l.id === 'hook-missing').text, /'flight'/);
});

test('the start as one entry (after the gates were removed) counts as connected', () => {
  const h = healthyHome();
  h.settings.hooks.SessionStart = [{ hooks: [{ type: 'command', command: 'powershell -NoProfile -ExecutionPolicy Bypass -File "$HOME\\.claude\\hive\\start.ps1"' }] }];
  w(path.join(h.claude, 'settings.json'), JSON.stringify(h.settings));
  const r = run(h);
  assert.deepEqual(fixes(r), []);
  assert.ok(r.lines.some((l) => l.id === 'hook:start'));
});

test('planted fault 2: a wrong notebook path (HIVE_ROOT names an empty folder; the chat is in the real notebook)', () => {
  const h = healthyHome();
  const empty = tmp('not a notebook ');
  const r = run(h, { env: { HIVE_ROOT: empty } });
  assert.deepEqual(fixes(r), ['notebook-path']);
  assert.match(r.lines.find((l) => l.id === 'notebook-path').text, /HIVE_ROOT/);
});

test('planted fault 2b: the notebook moved out of the usual place', () => {
  const h = healthyHome();
  const moved = path.join(h.home, 'Documents', 'my notes');
  fs.mkdirSync(path.dirname(moved), { recursive: true });
  fs.renameSync(h.nb, moved);
  const r = run(h, { here: moved });
  assert.ok(fixes(r).includes('notebook-path'), fixes(r).join(','));
  assert.match(r.lines.find((l) => l.id === 'notebook-path').text, /usual place/);
});

test('planted fault 2c: the recorded place in config.json is wrong, then unreadable', () => {
  const h = healthyHome();
  w(path.join(h.hive, 'config.json'), JSON.stringify({ notebook: path.join(h.home, 'gone') }));
  assert.ok(fixes(run(h)).includes('notebook-path'));
  w(path.join(h.hive, 'config.json'), '{ not json');
  assert.ok(fixes(run(h)).includes('notebook-path'));
});

test('a right config.json is used even when the notebook is not in the usual place', () => {
  const h = healthyHome();
  const moved = path.join(h.home, 'elsewhere');
  fs.renameSync(h.nb, moved);
  w(path.join(h.hive, 'config.json'), JSON.stringify({ root: moved }));
  const r = run(h, { here: h.home });
  assert.equal(r.notebook, moved);
  assert.deepEqual(fixes(r), []);
});

test('planted fault 3: a helper folder gone from the Claude skills folder', () => {
  const h = healthyHome();
  fs.rmSync(path.join(h.claude, 'skills', 'hive-close'), { recursive: true });
  const r = run(h);
  assert.deepEqual(fixes(r), ['skill-missing']);
  assert.match(r.lines.find((l) => l.id === 'skill-missing').text, /hive-close/);
});

test('an installed helper that differs from the notebook is stale', () => {
  const h = healthyHome();
  w(path.join(h.claude, 'skills', 'hive-start', 'SKILL.md'), 'old text');
  assert.deepEqual(fixes(run(h)), ['skill-stale']);
});

test('Node moved after the install: the hook points at a program that is gone', () => {
  const h = healthyHome();
  h.settings.hooks.Stop[0].hooks[0].command = path.join(h.home, 'Program Files', 'nodejs', 'node.exe');
  w(path.join(h.claude, 'settings.json'), JSON.stringify(h.settings));
  const r = run(h);
  assert.deepEqual(fixes(r), ['hook-broken']);
  assert.match(r.lines.find((l) => l.id === 'hook-broken').text, /Program Files/);
});

test('the start script gone: both the part and the hook are reported', () => {
  const h = healthyHome();
  fs.rmSync(path.join(h.hive, 'start.ps1'));
  assert.deepEqual(fixes(run(h)).sort(), ['hook-broken', 'part-missing']);
});

test('nothing installed yet: one clear line, no flood', () => {
  const h = healthyHome();
  fs.rmSync(h.claude, { recursive: true });
  assert.deepEqual(fixes(run(h)), ['not-installed']);
});

test('nothing installed yet, but the Hive folder holds the names list setup wrote: still "not installed"', () => {
  const h = healthyHome();
  fs.rmSync(h.claude, { recursive: true });
  w(path.join(h.hive, 'protected-names.txt'), 'A name\n');
  const r = run(h);
  assert.deepEqual(fixes(r), ['not-installed']);
  const text = r.lines.find((l) => l.id === 'not-installed').text;
  assert.match(text, /Hive Mind's parts are not installed/);
  assert.doesNotMatch(text, /\(no /, 'it does not say the folder is missing when it is there');
});

test('both ways in (the installed parts and the plugin): every helper twice is a fault, with the one step out of each', () => {
  const h = healthyHome();
  h.settings.enabledPlugins = { 'hive-mind@hive-mind': true };
  w(path.join(h.claude, 'settings.json'), JSON.stringify(h.settings));
  const r = run(h);
  assert.deepEqual(fixes(r), ['two-ways']);
  const t = r.lines.find((l) => l.id === 'two-ways').text;
  assert.match(t, /twice/); assert.match(t, /claude plugin uninstall hive-mind@hive-mind/); assert.match(t, /install\.mjs uninstall/);
  h.settings.enabledPlugins = { 'hive-mind@hive-mind': false };
  w(path.join(h.claude, 'settings.json'), JSON.stringify(h.settings));
  assert.deepEqual(fixes(run(h)), [], 'a plugin switched off is not a second way in');
});

test('settings that are not JSON, and a missing instructions block', () => {
  const h = healthyHome();
  w(path.join(h.claude, 'settings.json'), '{ broken');
  w(path.join(h.claude, 'CLAUDE.md'), '# Mine only\n');
  assert.deepEqual(fixes(run(h)).sort(), ['claude-md-block', 'settings-unreadable']);
});

test('a downloaded ZIP (no Git folder), and a copy with no online link or save hook', () => {
  const h = healthyHome();
  fs.rmSync(path.join(h.nb, '.git'), { recursive: true });
  assert.deepEqual(fixes(run(h)), ['not-git']);
  git(h.nb, 'init', '-q');
  assert.deepEqual(fixes(run(h)).sort(), ['no-online-copy', 'no-save-hook']);
});

test('gates off and not set up are notes, not faults', () => {
  const h = healthyHome();
  w(path.join(h.hive, 'gates-off'), '');
  fs.rmSync(path.join(h.nb, 'me', 'profile.md'));
  const r = run(h);
  assert.deepEqual(fixes(r), []);
  // not-started: no chat has started since this made-up install; privacy-not-checked: the made-up home has only the
  // PowerShell form of the privacy check.
  assert.deepEqual(r.lines.filter((l) => l.kind === 'NOTE').map((l) => l.id).sort(), ['gates-off', 'not-set-up', 'not-started', 'privacy-not-checked']);
});

test('no notebook anywhere', () => {
  const h = healthyHome();
  const r = run(h, { here: h.home, env: { HIVE_ROOT: path.join(h.home, 'nothing') } });
  assert.ok(fixes(r).includes('notebook-missing'));
});

test('the command line: exit 1 and a FIX line on a fault, exit 0 when fine, exit 2 on a wrong option', () => {
  const h = healthyHome();
  const args = ['--home', h.home, '--here', h.nb];
  const env = { ...process.env }; delete env.HIVE_ROOT; delete env.CLAUDE_DIR;
  let r = spawnSync(process.execPath, [DOCTOR, ...args], { encoding: 'utf8', env });
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /ALL FINE/);
  fs.rmSync(path.join(h.claude, 'skills', 'hive-start'), { recursive: true });
  r = spawnSync(process.execPath, [DOCTOR, ...args], { encoding: 'utf8', env });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /^FIX  skill-missing/m);
  r = spawnSync(process.execPath, [DOCTOR, ...args, '--json'], { encoding: 'utf8', env });
  assert.equal(JSON.parse(r.stdout).faults, 1);
  r = spawnSync(process.execPath, [DOCTOR, '--nope'], { encoding: 'utf8', env });
  assert.equal(r.status, 2);
});

test('the gates really on: an older gates program that cannot say where it looks is a fault', () => {
  const h = healthyHome();
  w(path.join(h.hive, 'gates', 'gates.mjs'), '// an older gates program\n');
  const r = run(h);
  assert.deepEqual(fixes(r), ['gates-blind']);
});

test('the gates really on: with the notebook in another folder, the gates find it through config.json', () => {
  const h = healthyHome();
  const moved = path.join(h.home, 'Documents', 'my notes');
  fs.mkdirSync(path.dirname(moved), { recursive: true });
  fs.renameSync(h.nb, moved);
  w(path.join(h.hive, 'config.json'), JSON.stringify({ root: moved }));
  const r = run(h, { here: h.home });
  assert.deepEqual(fixes(r), []);
  assert.ok(r.lines.some((l) => l.id === 'gates-on'), 'the gates find the notebook');
});

// ---------- the Hive Mind code (--code) and the checks behind it ----------
// The walk of the first hour, in a made-up home whose path holds the made-up name "Zoltan Example", with a local bare
// repository standing in for GitHub. Nothing here asks GitHub anything.
const STARTER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const VECTORS = JSON.parse(fs.readFileSync(path.join(STARTER, 'core', 'journey', 'vectors.json'), 'utf8'));
const ID = ['-c', 'user.name=Zoltan Example', '-c', `user.email=zoltan${'@'}example.invalid`];

// The environment every child runs with: the made-up home, nothing pointing at the real Claude folder.
function walkEnv(home, extra = {}) {
  const env = { ...process.env, HOME: home, USERPROFILE: home, GIT_TERMINAL_PROMPT: '0', ...extra };
  for (const k of ['HIVE_ROOT', 'CLAUDE_DIR', 'HIVE_STATE', 'HIVE_HOME', 'HIVE_CLAUDE', 'HIVE_NAMES_FILE', 'HIVE_GUARD']) if (!(k in extra)) delete env[k];
  return env;
}
function sh(cmd, args, opts) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', ...opts });
  assert.equal(r.status, 0, `${cmd} ${args.join(' ')}\n${r.stdout}\n${r.stderr}`);
  return r;
}
// The copy on "GitHub": every file of starter/ (as it is in this folder), in a bare repository.
function standIn() {
  const src = tmp('hm copy ');
  const list = sh('git', ['-C', STARTER, 'ls-files', '-co', '--exclude-standard'], {}).stdout.split('\n').filter(Boolean);
  for (const f of list) { const from = path.join(STARTER, f); if (fs.existsSync(from) && fs.statSync(from).isFile()) w(path.join(src, f), fs.readFileSync(from)); }
  const env = walkEnv(src);
  sh('git', ['-C', src, 'init', '-q', '-b', 'main'], { env });
  sh('git', ['-C', src, 'add', '-A'], { env });
  sh('git', ['-C', src, ...ID, 'commit', '-q', '--no-verify', '-m', 'the copy'], { env });
  const bare = path.join(tmp('hm github '), 'hive-mind.git');
  sh('git', ['init', '-q', '--bare', '-b', 'main', bare], { env });
  sh('git', ['-C', src, 'push', '-q', bare, 'main'], { env });
  return bare;
}
const doctorCode = (home, here, extra = []) => spawnSync(process.execPath, [DOCTOR, '--code', '--home', home, '--here', here, ...extra], { encoding: 'utf8', env: walkEnv(home) });
// What the code should be here: the stage's vector, with this computer's system.
function expectStage(out, name) {
  const v = VECTORS.stages.find((s) => s.name.startsWith(name));
  assert.equal(out.status, 0, out.stderr);
  assert.equal(out.stderr, '', 'nothing on the error stream either');
  const lines = out.stdout.split(/\r?\n/).filter(Boolean);
  assert.equal(lines.length, 1, `--code prints exactly one line, got: ${out.stdout}`);
  const d = decode(lines[0]);
  assert.equal(d.ok, true, lines[0]);
  assert.equal(d.route, v.state.route, name);
  const want = Object.fromEntries(Object.keys(d.steps).map((k) => [k, v.state.steps[k] ? 1 : 0]));
  assert.deepEqual(d.steps, want, `${name}: ${lines[0]} vs ${v.code}`);
  assert.equal(lines[0], encode({ ...v.state, system: systemOf() }), name);
  if (process.platform === 'win32') assert.equal(lines[0], v.code, name);
  return lines[0];
}

test('the walk: each stage gives the code its vector says, and the made-up name and path never appear', { timeout: 240000 }, () => {
  const bare = standIn();
  const home = tmp('hm Zoltan Example ');
  const claude = path.join(home, '.claude');
  const nb = path.join(home, 'hive-mind');
  const outputs = [];

  // 1. An empty folder: only the tools.
  const empty = path.join(home, 'empty'); fs.mkdirSync(empty);
  outputs.push(expectStage(doctorCode(home, empty), 'stage 1'));

  // 2. After a clone of the copy into ~/hive-mind (the chat is still in the home folder).
  sh('git', ['clone', '-q', bare, nb], { env: walkEnv(home) });
  outputs.push(expectStage(doctorCode(home, home), 'stage 2'));

  // 3. After install.mjs install (into the made-up Claude folder only).
  sh(process.execPath, [path.join(nb, 'core', 'install', 'install.mjs'), 'install', '--home', home, '--claude-dir', claude, '--root', nb],
    { env: { ...walkEnv(home), HOME: process.env.HOME || '', USERPROFILE: process.env.USERPROFILE || '', HIVE_INSTALL_TEST: '1' } });
  outputs.push(expectStage(doctorCode(home, nb), 'stage 3'));

  // 4. After a made-up first conversation, and the first save to the stand-in (the save hook runs the privacy check).
  w(path.join(nb, 'me', 'profile.md'), '# About you\n\nName: Zoltan Example\n');
  const dif = path.join(nb, 'system', 'decisions-in-force.md');
  fs.writeFileSync(dif, fs.readFileSync(dif, 'utf8').replace('Nothing decided yet. The first conversation adds your choices here.', '- Starting set: student, kept as it came'));
  const saveEnv = walkEnv(home, { HIVE_GUARD: path.join(nb, 'core', 'guard', 'privacy-guard.mjs'), HIVE_NAMES_FILE: path.join(claude, 'hive', 'protected-names.txt') });
  sh('git', ['-C', nb, 'add', '-A'], { env: saveEnv });
  sh('git', ['-C', nb, ...ID, 'commit', '-q', '-m', 'The first conversation'], { env: saveEnv });
  sh('git', ['-C', nb, 'push', '-q', 'origin', 'main'], { env: saveEnv });
  outputs.push(expectStage(doctorCode(home, nb), 'stage 4'));

  // 5. After a new chat in the notebook: start.mjs writes its start record.
  sh(process.execPath, [path.join(nb, 'core', 'start', 'start.mjs'), '--part', 'rules', '--no-refresh'], {
    env: walkEnv(home, { HIVE_HOME: home, HIVE_STATE: path.join(claude, 'hive'), HIVE_ROOT: nb }),
    input: JSON.stringify({ session_id: 'walk-chat-1', cwd: nb, source: 'startup' }),
  });
  outputs.push(expectStage(doctorCode(home, nb), 'stage 5'));

  // Known-bad: the made-up home path, and the made-up name in it, never appear in any --code output.
  const all = outputs.join('\n');
  for (const bit of [home, path.basename(home), 'Zoltan', 'Example', 'zoltan', 'example']) assert.ok(!all.includes(bit), `"${bit}" appeared in ${all}`);

  // Known-bad: the stand-in can be read with no sign-in, so --online calls it public: copy-public.
  const pub = doctorCode(home, nb, ['--online']);
  const d = decode(pub.stdout.trim());
  assert.equal(d.steps['private-checked'], 1); assert.equal(d.steps.private, 0);
  const plain = spawnSync(process.execPath, [DOCTOR, '--online', '--home', home, '--here', nb], { encoding: 'utf8', env: walkEnv(home) });
  assert.match(plain.stdout, /^FIX  copy-public/m);
});

// A made-up notebook that is a Git folder with an online copy, a set-up and a save hook, for the single checks below.
function gitHome() {
  const h = healthyHome();
  const env = walkEnv(h.home);
  const bare = path.join(tmp('hm github '), 'nb.git');
  sh('git', ['init', '-q', '--bare', '-b', 'main', bare], { env });
  sh('git', ['-C', h.nb, 'remote', 'set-url', 'origin', bare], { env });
  sh('git', ['-C', h.nb, 'checkout', '-q', '-b', 'main'], { env });
  sh('git', ['-C', h.nb, 'add', '-A'], { env });
  sh('git', ['-C', h.nb, ...ID, 'commit', '-q', '--no-verify', '-m', 'notes'], { env });
  return { ...h, bare, env };
}

test('--online is the only way anything is asked of GitHub: without it the question is never asked', () => {
  const h = gitHome();
  let asked = 0;
  const askOnline = () => { asked++; return { answer: 'private' }; };
  const r0 = run(h, { askOnline });
  assert.equal(asked, 0);
  assert.equal(codeState(r0).steps['private-checked'], false, 'not asked: "not checked"');
  const r1 = run(h, { online: true, askOnline });
  assert.equal(asked, 1);
  assert.ok(r1.lines.some((l) => l.id === 'copy-private' && l.kind === 'OK'));
  const s = codeState(r1).steps; assert.equal(s['private-checked'], true); assert.equal(s.private, true);
  const r2 = run(h, { online: true, askOnline: () => ({ answer: 'unknown', why: 'no answer within 10 seconds' }) });
  assert.ok(r2.lines.some((l) => l.id === 'copy-not-checked' && l.kind === 'NOTE'));
  assert.equal(codeState(r2).steps['private-checked'], false);
});

test('a local stand-in for GitHub can answer both cases, private and public; the stand-in answer never reaches a real address', { timeout: 60000 }, () => {
  const h = gitHome();
  const cli = (extra) => spawnSync(process.execPath, [DOCTOR, '--online', '--home', h.home, '--root', h.nb, '--here', h.nb], { encoding: 'utf8', env: walkEnv(h.home, extra) });
  const codeOf = (extra) => decode(spawnSync(process.execPath, [DOCTOR, '--code', '--online', '--home', h.home, '--root', h.nb, '--here', h.nb], { encoding: 'utf8', env: walkEnv(h.home, extra) }).stdout.trim());
  // Known-bad before the fix: a local stand-in could only ever be read, so "private" was never reachable.
  assert.match(cli({}).stdout, /^FIX  copy-public/m, 'no stand-in answer: the local folder is read, so public');
  assert.match(cli({ HIVE_STANDIN_ONLINE: 'private' }).stdout, /^OK   copy-private/m);
  assert.match(cli({ HIVE_STANDIN_ONLINE: 'public' }).stdout, /^FIX  copy-public/m);
  const p = codeOf({ HIVE_STANDIN_ONLINE: 'private' }).steps; assert.equal(p['private-checked'], 1); assert.equal(p.private, 1);
  const q = codeOf({ HIVE_STANDIN_ONLINE: 'public' }).steps; assert.equal(q['private-checked'], 1); assert.equal(q.private, 0);
  // A real online address is never answered by the stand-in: a local web address with nothing behind it gives "not checked".
  const r = askGitHub('http://127.0.0.1:9/nobody/hive-mind.git', { HIVE_STANDIN_ONLINE: 'private' });
  assert.equal(r.answer, 'unknown');
  assert.equal(isLocalAddress(`https://${['github', 'com'].join('.')}/x/y`), false);
  assert.equal(isLocalAddress(h.bare), true);
});

test('the address asked about carries no user name or key, and only GitHub-shaped or local addresses are asked', () => {
  // Built from parts, so no address-shaped text stands in this file for the privacy check to flag.
  const AT = '@', HOST = ['github', 'com'].join('.');
  assert.equal(publicAddress(`https://zoltan:secret${AT}${HOST}/zoltan/hive-mind.git`), `https://${HOST}/zoltan/hive-mind.git`);
  assert.equal(publicAddress(`git${AT}${HOST}:zoltan/hive-mind.git`), `https://${HOST}/zoltan/hive-mind.git`);
  assert.equal(publicAddress(`ssh://git${AT}${HOST}/zoltan/hive-mind`), `https://${HOST}/zoltan/hive-mind`);
  assert.equal(publicAddress('ext::sh -c touch% /tmp/x'), null);
  assert.equal(publicAddress('--upload-pack=evil'), null);
});

test('saved online: only once the online branch holds me/profile.md', () => {
  const h = gitHome();
  const id = (r) => r.lines.find((l) => /saved-online/.test(l.id)).id;
  assert.equal(id(run(h)), 'not-saved-online', 'committed here but not pushed');
  sh('git', ['-C', h.nb, 'push', '-q', '-u', 'origin', 'main'], { env: h.env });
  assert.equal(id(run(h)), 'saved-online');
});

test('the starting set: a "Starting set:" line, and nothing else, counts', () => {
  const h = healthyHome();
  const dif = path.join(h.nb, 'system', 'decisions-in-force.md');
  w(dif, '## Your choices\n\nNothing decided yet. The first conversation adds your choices here.\n');
  assert.ok(run(h).lines.some((l) => l.id === 'no-starting-set'));
  w(dif, '## Your choices\n\n- Starting set: student, kept as it came\n');
  assert.ok(run(h).lines.some((l) => l.id === 'starting-set' && l.kind === 'OK'));
});

test('started: a start record counts only from a chat in the notebook, newer than the install', () => {
  const h = healthyHome();
  const rec = (name, cwd, at) => w(path.join(h.hive, 'gates', 'start', `${name}.json`), JSON.stringify({ session: name, cwd, at }));
  w(path.join(h.hive, 'install-record.json'), '{}');
  const later = new Date(Date.now() + 60000).toISOString();
  rec('elsewhere', h.home, later);
  rec('old', h.nb, new Date(Date.now() - 3600000).toISOString());
  assert.ok(run(h).lines.some((l) => l.id === 'not-started'), 'outside the notebook, or older than the install');
  rec('good', path.join(h.nb, 'projects'), later);
  assert.ok(run(h).lines.some((l) => l.id === 'started' && l.kind === 'OK'));
});

test('known-bad: a key in the notes makes the privacy check stop, and the code says not clean', () => {
  const h = gitHome();
  w(path.join(h.nb, 'core', 'guard', 'privacy-guard.mjs'), fs.readFileSync(path.join(STARTER, 'core', 'guard', 'privacy-guard.mjs')));
  let r = run(h);
  assert.ok(r.lines.some((l) => l.id === 'privacy-clean'), JSON.stringify(r.lines.filter((l) => /privacy/.test(l.id))));
  w(path.join(h.nb, 'projects', 'x.md'), `token = ${'ghp_' + 'a'.repeat(36)}\n`);
  r = run(h);
  assert.ok(fixes(r).includes('privacy-stop'));
  assert.doesNotMatch(r.lines.find((l) => l.id === 'privacy-stop').text, /ghp_a/, 'the key itself is never shown');
  assert.equal(codeState(r).steps.clean, false);
});

test('--json keeps its shape: notebook, claude, lines, faults', () => {
  const h = healthyHome();
  const r = spawnSync(process.execPath, [DOCTOR, '--json', '--home', h.home, '--here', h.nb], { encoding: 'utf8', env: walkEnv(h.home) });
  assert.deepEqual(Object.keys(JSON.parse(r.stdout)), ['notebook', 'claude', 'lines', 'faults']);
});
