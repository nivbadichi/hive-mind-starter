// Proof for the installer: install, run again, undo, in a made-up home with a made-up Claude folder, inside a
// temporary folder whose path has spaces. The real home folder is never touched (HIVE_INSTALL_TEST makes the
// installer refuse it). Run: node --test core/install/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { notebookRoot } from './config.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STARTER = path.resolve(HERE, '..', '..');
const INSTALL = path.join(HERE, 'install.mjs');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'hive install test '));
process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {} });

function copyTree(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.isDirectory()) copyTree(s, d); else fs.copyFileSync(s, d);
  }
}
function w(p, text) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); }

// A notebook outside the home folder, with spaces, made from the starter's own files.
function makeNotebook(name, { nodeForm = false } = {}) {
  const nb = path.join(TMP, 'other drive', name);
  w(path.join(nb, 'system', 'rules.md'), fs.readFileSync(path.join(STARTER, 'system', 'rules.md')));
  for (const d of ['start', 'gates', 'guard', 'skills']) copyTree(path.join(STARTER, 'core', d), path.join(nb, 'core', d));
  fs.copyFileSync(path.join(STARTER, 'core', 'claude-md.md'), path.join(nb, 'core', 'claude-md.md'));
  w(path.join(nb, '.git', 'hooks', 'pre-commit'), '#!/bin/sh\necho my own hook\n');
  if (nodeForm && !fs.existsSync(path.join(nb, 'core', 'start', 'settings-snippet.node.json'))) {
    const s = JSON.parse(fs.readFileSync(path.join(nb, 'core', 'start', 'settings-snippet.json'), 'utf8'));
    s.hooks.SessionStart = ['rules', 'state', 'flight'].map((p) => ({ hooks: [{ type: 'command', command: '__NODE__', args: ['__HIVE__/start.mjs', '-Part', p], timeout: 30 }] }));
    w(path.join(nb, 'core', 'start', 'settings-snippet.node.json'), JSON.stringify(s, null, 2));
    if (!fs.existsSync(path.join(nb, 'core', 'start', 'start.mjs'))) w(path.join(nb, 'core', 'start', 'start.mjs'), '// stand-in for the Node start step\n');
  }
  return nb;
}
// A made-up home: a Claude folder with the person's own settings (Windows line endings), CLAUDE.md and a skill.
function makeHome(name) {
  const home = path.join(TMP, name, 'my home');
  const claude = path.join(home, '.claude');
  w(path.join(claude, 'settings.json'), JSON.stringify({ theme: 'dark', hooks: { PostToolUse: [{ matcher: 'Write', hooks: [{ type: 'command', command: 'echo formatted' }] }] }, enabledPlugins: { 'x@y': true } }, null, 2).replace(/\n/g, '\r\n') + '\r\n');
  w(path.join(claude, 'CLAUDE.md'), '# My own notes\r\nKeep this line.\r\n');
  w(path.join(claude, 'skills', 'my-skill', 'SKILL.md'), '---\nname: my-skill\n---\n');
  return { home, claude };
}
function snap(...dirs) {
  const out = {};
  const go = (base, d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      const key = path.relative(TMP, p);
      if (e.isDirectory()) { out[key + '/'] = 'dir'; go(base, p); }
      else out[key] = crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
    }
  };
  for (const d of dirs) if (fs.existsSync(d)) go(d, d);
  return out;
}
function run(args, env = {}) {
  // HIVE_PLUGIN_LIST=none: no program asks the real Claude for its plugin list while the Claude folder is a made-up one.
  const r = spawnSync(process.execPath, [INSTALL, ...args], { encoding: 'utf8', env: { ...process.env, HIVE_INSTALL_TEST: '1', HIVE_ROOT: '', HIVE_PLUGIN_LIST: 'none', ...env } });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}
const ours = (s) => JSON.stringify(s.hooks || {}).match(/gates\.mjs|start\.(ps1|mjs)/g) || [];

test('dry run, install, second install, undo: the folder comes back exactly as it was', () => {
  const nb = makeNotebook('notes one');
  const { home, claude } = makeHome('case one');
  const opts = ['--home', home, '--claude-dir', claude, '--root', nb];
  const before = snap(home, path.join(nb, '.git'));

  const dry = run(['install', '--dry-run', ...opts]);
  assert.equal(dry.code, 0, dry.out);
  assert.match(dry.out, /^Would change:/m);
  assert.match(dry.out, /\.bak-<date-time>/);
  assert.deepEqual(snap(home, path.join(nb, '.git')), before, 'a dry run writes nothing');

  const one = run(['install', ...opts]);
  assert.equal(one.code, 0, one.out);
  assert.match(one.out, /^Changed:/m);
  const s = JSON.parse(fs.readFileSync(path.join(claude, 'settings.json'), 'utf8'));
  assert.equal(s.theme, 'dark'); assert.equal(s.enabledPlugins['x@y'], true);
  assert.ok(s.hooks.PostToolUse.some((e) => e.hooks[0].command === 'echo formatted'), 'the person\'s own hook stays');
  for (const ev of ['PreToolUse', 'PostToolUse', 'UserPromptSubmit', 'Stop', 'PreCompact']) assert.ok(JSON.stringify(s.hooks[ev]).includes('gates.mjs'), ev);
  assert.ok(!JSON.stringify(s).includes('__NODE__') && !JSON.stringify(s).includes('__HIVE__'));
  const cfg = JSON.parse(fs.readFileSync(path.join(claude, 'hive', 'config.json'), 'utf8'));
  assert.equal(cfg.root, nb, 'config.json says where the notebook is');
  assert.equal(notebookRoot({ env: {}, home, hiveDir: path.join(claude, 'hive') }), nb, 'and the notebook is found from it, with HIVE_ROOT unset');
  const cm = fs.readFileSync(path.join(claude, 'CLAUDE.md'), 'utf8');
  assert.ok(cm.startsWith('# My own notes\r\nKeep this line.\r\n'), 'own lines kept');
  assert.ok(cm.includes('<!-- hive-mind:start -->') && cm.includes(nb.split(path.sep).join('/')) && !cm.includes('~/hive-mind'), 'the block names the real notebook folder');
  assert.ok(fs.existsSync(path.join(claude, 'skills', 'hive-verify', 'scripts', 'verify.mjs')), 'a helper is copied whole, with its scripts');
  assert.ok(fs.existsSync(path.join(claude, 'hive', 'gates', 'gates.mjs')));
  assert.equal(fs.readFileSync(path.join(nb, '.git', 'hooks', 'pre-commit'), 'utf8'), fs.readFileSync(path.join(nb, 'core', 'guard', 'pre-commit'), 'utf8').replace(/\r\n/g, '\n'));
  assert.equal(fs.readdirSync(path.join(nb, '.git', 'hooks')).filter((f) => f.startsWith('pre-commit.bak-')).length, 1, 'the old save hook is kept');
  const afterOne = snap(home, path.join(nb, '.git'));

  const two = run(['install', ...opts]);
  assert.equal(two.code, 0, two.out);
  assert.match(two.out, /^Nothing to change/m);
  assert.deepEqual(snap(home, path.join(nb, '.git')), afterOne, 'a second install changes nothing');

  const undoDry = run(['uninstall', '--dry-run', ...opts]);
  assert.equal(undoDry.code, 0, undoDry.out);
  assert.deepEqual(snap(home, path.join(nb, '.git')), afterOne, 'a dry undo writes nothing');

  const undo = run(['uninstall', ...opts]);
  assert.equal(undo.code, 0, undo.out);
  assert.deepEqual(snap(home, path.join(nb, '.git')), before, 'after the undo nothing is left behind');
  assert.match(run(['uninstall', ...opts]).out, /Nothing to undo/);
});

test('the Node form of the hooks is used when the notebook has it, with no copies on a second install', () => {
  const nb = makeNotebook('notes node', { nodeForm: true });
  const { home, claude } = makeHome('case node');
  // An older install left a PowerShell start entry behind: it must be replaced, not doubled.
  const s0 = JSON.parse(fs.readFileSync(path.join(claude, 'settings.json'), 'utf8'));
  s0.hooks.SessionStart = [{ hooks: [{ type: 'command', command: 'powershell -NoProfile -File "$HOME\\.claude\\hive\\start.ps1"', shell: 'powershell' }] }];
  w(path.join(claude, 'settings.json'), JSON.stringify(s0, null, 2) + '\n');
  const before = snap(home, path.join(nb, '.git'));
  const opts = ['--home', home, '--claude-dir', claude, '--root', nb];
  for (const platform of ['linux', 'win32']) {
    const r = run(['install', ...opts], { HIVE_INSTALL_PLATFORM: platform });
    assert.equal(r.code, 0, r.out);
    const s = JSON.parse(fs.readFileSync(path.join(claude, 'settings.json'), 'utf8'));
    const starts = s.hooks.SessionStart.map((e) => e.hooks[0]);
    assert.equal(starts.length, 3, platform + ': three start parts, no copies');
    assert.ok(starts.every((h) => h.command === process.execPath && /hive\/start\.mjs$/.test(h.args[0])), platform + ': the start step runs in node');
    assert.ok(fs.existsSync(path.join(claude, 'hive', 'start.mjs')) && fs.existsSync(path.join(claude, 'hive', 'start.ps1')), 'start.mjs beside the thin start.ps1');
  }
  assert.match(run(['install', ...opts]).out, /^Nothing to change/m);
  const g = run(['remove-gates', ...opts], { HIVE_INSTALL_PLATFORM: 'linux' });
  assert.equal(g.code, 0, g.out);
  const sg = JSON.parse(fs.readFileSync(path.join(claude, 'settings.json'), 'utf8'));
  assert.ok(!JSON.stringify(sg).includes('gates.mjs') && sg.hooks.SessionStart.length === 3, 'remove-gates on Linux keeps the start, drops the gates');
  assert.equal(run(['uninstall', ...opts]).code, 0);
  assert.deepEqual(snap(home, path.join(nb, '.git')), before, 'undo after remove-gates: nothing left behind');
});

test('Mac and Linux with only the PowerShell start step: pwsh when present, otherwise said plainly', () => {
  const nb = makeNotebook('notes ps');
  fs.rmSync(path.join(nb, 'core', 'start', 'settings-snippet.node.json'), { force: true });
  fs.rmSync(path.join(nb, 'core', 'start', 'start.mjs'), { force: true });
  const { home, claude } = makeHome('case ps');
  const before = snap(home, path.join(nb, '.git'));
  const opts = ['--home', home, '--claude-dir', claude, '--root', nb];
  let r = run(['install', ...opts], { HIVE_INSTALL_PLATFORM: 'linux', HIVE_INSTALL_PWSH: 'none' });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /start step was not added/);
  let s = JSON.parse(fs.readFileSync(path.join(claude, 'settings.json'), 'utf8'));
  assert.equal(s.hooks.SessionStart, undefined);
  r = run(['install', ...opts], { HIVE_INSTALL_PLATFORM: 'darwin', HIVE_INSTALL_PWSH: '/usr/local/bin/pwsh' });
  s = JSON.parse(fs.readFileSync(path.join(claude, 'settings.json'), 'utf8'));
  assert.equal(s.hooks.SessionStart.length, 3);
  assert.ok(s.hooks.SessionStart.every((e) => e.hooks[0].command.startsWith('"/usr/local/bin/pwsh" -NoProfile -File') && !e.hooks[0].shell));
  assert.equal(run(['uninstall', ...opts]).code, 0);
  assert.deepEqual(snap(home, path.join(nb, '.git')), before);
});

test('a run that stopped halfway can be finished, or undone back to the start', () => {
  const nb = makeNotebook('notes crash');
  const { home, claude } = makeHome('case crash');
  const opts = ['--home', home, '--claude-dir', claude, '--root', nb];
  const before = snap(home, path.join(nb, '.git'));
  const total = run(['install', '--dry-run', ...opts]).out.split('\n').filter((l) => l.startsWith('- ')).length;
  assert.ok(total > 5);
  for (const n of [1, Math.floor(total / 2), total - 2, total - 1]) {   // the last three are settings, CLAUDE.md, the save hook
    const r = run(['install', ...opts], { HIVE_INSTALL_CRASH_AFTER: String(n) });
    assert.equal(r.code, 3, r.out);
    assert.equal(run(['uninstall', ...opts]).code, 0);
    assert.deepEqual(snap(home, path.join(nb, '.git')), before, `undo after a stop at change ${n}`);
  }
  run(['install', ...opts], { HIVE_INSTALL_CRASH_AFTER: '12' });
  assert.equal(run(['install', ...opts]).code, 0, 'finishing a stopped run');
  assert.match(run(['install', ...opts]).out, /^Nothing to change/m);
  assert.equal(run(['uninstall', ...opts]).code, 0);
  assert.deepEqual(snap(home, path.join(nb, '.git')), before, 'undo after a finished run that had stopped once');
});

test('changes made after the install are kept by the undo', () => {
  const nb = makeNotebook('notes edit');
  const { home, claude } = makeHome('case edit');
  const opts = ['--home', home, '--claude-dir', claude, '--root', nb];
  assert.equal(run(['install', ...opts]).code, 0);
  const sf = path.join(claude, 'settings.json');
  const s = JSON.parse(fs.readFileSync(sf, 'utf8')); s.model = 'later choice';
  fs.writeFileSync(sf, JSON.stringify(s, null, 2));
  fs.appendFileSync(path.join(claude, 'CLAUDE.md'), 'A line added later.\n');
  const u = run(['uninstall', ...opts]);
  assert.equal(u.code, 0, u.out);
  const after = JSON.parse(fs.readFileSync(sf, 'utf8'));
  assert.equal(after.model, 'later choice'); assert.equal(after.theme, 'dark');
  assert.deepEqual(ours(after), [], 'no Hive Mind hook left');
  const cm = fs.readFileSync(path.join(claude, 'CLAUDE.md'), 'utf8');
  assert.ok(cm.includes('Keep this line.') && cm.includes('A line added later.') && !cm.includes('hive-mind:start'));
  assert.match(u.out, /Kept, because the file was changed/);
  assert.ok(!fs.existsSync(path.join(claude, 'hive')), 'the Hive folder is gone');
});

test('it stops before changing anything when something is wrong', () => {
  const { home, claude } = makeHome('case stop');
  const before = snap(home);
  let r = run(['install', '--home', home, '--claude-dir', claude, '--root', path.join(TMP, 'no such notebook')]);
  assert.equal(r.code, 1); assert.match(r.out, /notebook was not found/);
  const nb = makeNotebook('notes stop');
  fs.writeFileSync(path.join(claude, 'settings.json'), '{ not json');
  const broken = snap(home);
  r = run(['install', '--home', home, '--claude-dir', claude, '--root', nb]);
  assert.equal(r.code, 1); assert.match(r.out, /not valid JSON/);
  assert.deepEqual(snap(home), broken);
  r = run(['install', '--root', nb]);
  assert.equal(r.code, 1); assert.match(r.out, /real Claude folder/, 'a test can never reach the real home');
  r = run(['install', '--colour']);
  assert.equal(r.code, 1); assert.match(r.out, /not something this installer knows/);
  assert.ok(before);
});

test('the Windows front doors pass folders with spaces through (Windows only)', { skip: process.platform !== 'win32' }, () => {
  const nb = makeNotebook('notes ps1');
  const { home, claude } = makeHome('case ps1');
  const before = snap(home, path.join(nb, '.git'));
  const ps = (file, args) => spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(STARTER, 'core', 'gates', file), ...args], { encoding: 'utf8', env: { ...process.env, HIVE_INSTALL_TEST: '1', HIVE_ROOT: '' } });
  let r = ps('install.ps1', ['-ClaudeDir', claude + '\\', '-Root', nb, '-DryRun']);
  assert.equal(r.status, 0, r.stdout + r.stderr); assert.match(r.stdout, /Would change:/);
  assert.deepEqual(snap(home, path.join(nb, '.git')), before);
  r = ps('install.ps1', ['-ClaudeDir', claude, '-Root', nb]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  r = ps('uninstall.ps1', ['-All', '-ClaudeDir', claude, '-Root', nb]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(snap(home, path.join(nb, '.git')), before);
});

test('--help lists the commands and options, and changes nothing', () => {
  for (const a of [['--help'], ['install', '--help'], ['-h']]) {
    const r = run(a);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /--dry-run/); assert.match(r.out, /--root/); assert.match(r.out, /uninstall/);
    assert.doesNotMatch(r.out, /STOPPED/);
  }
});
test('started with no command it prints its help and changes nothing; a real install needs the word install (2026-11-20)', () => {
  const nb = makeNotebook('notes nocmd');
  const { home, claude } = makeHome('case nocmd');
  const opts = ['--home', home, '--claude-dir', claude, '--root', nb];
  const before = snap(home, path.join(nb, '.git'));
  for (const a of [[], opts]) {
    const r = run(a);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /changes nothing/);
    assert.deepEqual(snap(home, path.join(nb, '.git')), before, `nothing changed for: ${a.join(' ') || '(no command)'}`);
  }
  assert.match(run(['--dry-run', ...opts]).out, /^Would change:/m, '--dry-run alone lists what an install would change');
  assert.deepEqual(snap(home, path.join(nb, '.git')), before);
  assert.equal(run(['install', ...opts]).code, 0);
  assert.notDeepEqual(snap(home, path.join(nb, '.git')), before, 'the word install installs');
});
test('the undo line it prints is the one for the system it runs on (2026-11-20, the newcomer\'s walk)', () => {
  for (const [platform, want, not] of [['darwin', /sh core\/install\/install\.sh uninstall/, /powershell|uninstall\.ps1/i], ['linux', /sh core\/install\/install\.sh uninstall/, /powershell|uninstall\.ps1/i], ['win32', /uninstall\.ps1 -All/, /install\.sh uninstall/]]) {
    const nb = makeNotebook('notes undo ' + platform);
    const { home, claude } = makeHome('case undo ' + platform);
    const r = run(['install', '--home', home, '--claude-dir', claude, '--root', nb], { HIVE_INSTALL_PLATFORM: platform });
    assert.equal(r.code, 0, r.out);
    const line = r.out.split(/\r?\n/).find((l) => /^To undo all of it/.test(l)) || '';
    assert.match(line, want, `${platform}: ${line}`);
    assert.doesNotMatch(line, not, `${platform}: ${line}`);
  }
});

test('the undo never deletes a file you made in the Hive folder, even one added after the install', () => {
  const nb = makeNotebook('notes names');
  const { home, claude } = makeHome('case names');
  const opts = ['--home', home, '--claude-dir', claude, '--root', nb];
  assert.equal(run(['install', ...opts]).code, 0);
  const names = path.join(claude, 'hive', 'protected-names.txt');
  w(names, 'Aleksandra\n');                                            // the private names list, written after the install
  w(path.join(claude, 'hive', 'gates.log'), '{"event":"record"}\n');     // what the gates write while running
  w(path.join(claude, 'hive', 'gates', 'rec', 'chat.json'), '{}');
  const dry = run(['uninstall', '--dry-run', ...opts]);
  assert.equal(dry.code, 0, dry.out);
  assert.ok(fs.existsSync(names) && fs.existsSync(path.join(claude, 'hive', 'gates.log')), 'a dry undo writes nothing');
  const u = run(['uninstall', ...opts]);
  assert.equal(u.code, 0, u.out);
  assert.equal(fs.existsSync(names) && fs.readFileSync(names, 'utf8'), 'Aleksandra\n', 'the names list stays, unchanged');
  assert.match(u.out, /^Yours, kept/m);
  assert.ok(!fs.existsSync(path.join(claude, 'hive', 'gates.log')) && !fs.existsSync(path.join(claude, 'hive', 'gates')), 'what the gates wrote is gone');
  assert.deepEqual(fs.readdirSync(path.join(claude, 'hive')), ['protected-names.txt'], 'only your file is left in the Hive folder');
});

test('the Hive folder made before the install (for the names list): the undo still removes everything the programs wrote', () => {
  const nb = makeNotebook('notes names first');
  const { home, claude } = makeHome('case names first');
  const hive = path.join(claude, 'hive');
  w(path.join(hive, 'protected-names.txt'), 'Aleksandra\n');            // setup step 3.0 writes it before the parts go in
  const before = snap(home);
  const opts = ['--home', home, '--claude-dir', claude, '--root', nb];
  assert.equal(run(['install', ...opts]).code, 0);
  // What the start step and the gates write while chats run: logs, per-chat records (one holds a typed message), stamps.
  const runtime = ['gates.log', 'gates.log.1', 'corrections.log', 'publish.log', 'gates-test.stamp', 'gates-off', path.join('claims', 's1.json'),
    path.join('gates', 'start', 's1.json'), path.join('gates', 'turn', 's1.json'), path.join('gates', 'chat', 's1.skills'), path.join('gates', 'refresh', 'x.json'), path.join('gates', 'blind', 's1.json'), path.join('gates', 'pull.stamp')];
  for (const f of runtime) w(path.join(hive, f), f.includes('turn') ? '{"ask":"what I typed in the chat"}' : 'x');
  const dry = run(['uninstall', '--dry-run', ...opts]);
  assert.equal(dry.code, 0, dry.out);
  for (const top of ['gates.log', 'corrections.log', 'gates-test.stamp', 'claims', 'gates']) assert.ok(dry.out.includes(path.join(hive, top)), `the dry run names ${top}`);
  assert.ok(fs.existsSync(path.join(hive, 'gates', 'turn', 's1.json')), 'a dry undo writes nothing');
  const u = run(['uninstall', ...opts]);
  assert.equal(u.code, 0, u.out);
  assert.deepEqual(snap(home), before, 'the Claude folder is exactly as before the install: only the names list is left in the Hive folder');
});

test('the undo removes only what Hive Mind writes, and keeps and names every other file, whatever its name or depth', () => {
  const nb = makeNotebook('notes yours');
  const { home, claude } = makeHome('case yours');
  const hive = path.join(claude, 'hive');
  const opts = ['--home', home, '--claude-dir', claude, '--root', nb];
  assert.equal(run(['install', ...opts]).code, 0);
  const mine = { [path.join('my notes', 'plan.md')]: 'my plan\n', 'shopping.csv': 'milk,2\n', NOTES: 'no extension\n',
    [path.join('gates', 'my-file.txt')]: 'mine, inside a Hive Mind folder\n', [path.join('gates', 'rec', 'mine.txt')]: 'mine too\n',
    [path.join('verify', 'run 1', 'result.md')]: 'PASS\n', [path.join('verify', 'run 1', 'shot.png')]: 'png' };
  for (const [f, t] of Object.entries(mine)) w(path.join(hive, f), t);
  const runtime = ['gates.log', path.join('gates', 'turn', 's1.json'), path.join('gates', 'chat', 's1.skills'), path.join('claims', 's1.json'), 'gates-test.stamp'];
  for (const f of runtime) w(path.join(hive, f), 'x');
  const dry = run(['uninstall', '--dry-run', ...opts]);
  assert.equal(dry.code, 0, dry.out);
  const [would, keptPart = ''] = dry.out.split(/^Yours, kept/m);
  for (const f of Object.keys(mine)) {
    assert.ok(!would.includes(path.join(hive, f)) && !would.includes(path.join(hive, f.split(path.sep)[0]) + ' '), `the dry run does not remove ${f}`);
    assert.ok(keptPart.includes(path.join(hive, f)), `the dry run names ${f} as yours, kept`);
  }
  for (const f of runtime) assert.ok(would.includes(path.join(hive, f)), `the dry run names ${f} for removal`);
  const u = run(['uninstall', ...opts]);
  assert.equal(u.code, 0, u.out);
  for (const [f, t] of Object.entries(mine)) assert.equal(fs.readFileSync(path.join(hive, f), 'utf8'), t, `${f} stays, unchanged`);
  for (const f of runtime) assert.ok(!fs.existsSync(path.join(hive, f)), `${f} is gone`);
  assert.match(u.out, /^Yours, kept/m);
  assert.match(u.out, /verify/);
  assert.doesNotMatch(u.out, /my notes with|shopping\.csv \(written/);
});

// What the plugin leaves in the Hive folder when it has run: run-time files (one holds a typed message), config.json.
function pluginRan(hive, root) {
  const files = { [path.join('claims', 'p1.json')]: '{}', [path.join('gates', 'turn', 'p1.json')]: '{"ask":"what I typed"}', [path.join('gates', 'chat', 'p1.json')]: '{}',
    [path.join('gates', 'start', 'p1.json')]: '{}', [path.join('gates', 'pull.stamp')]: '1', 'gates.log': '{}\n', 'gates-test.stamp': '1' };
  for (const [f, t] of Object.entries(files)) w(path.join(hive, f), t);
  w(path.join(hive, 'config.json'), JSON.stringify({ root }));
  return Object.keys(files);
}

test('the plugin ran before the installer: the undo still removes every run-time file, and never calls one yours', () => {
  const nb = makeNotebook('notes plugin first');
  const { home, claude } = makeHome('case plugin first');
  const hive = path.join(claude, 'hive');
  w(path.join(hive, 'protected-names.txt'), 'Aleksandra\n');
  const runtime = pluginRan(hive, nb);
  const cfgBefore = fs.readFileSync(path.join(hive, 'config.json'));
  const opts = ['--home', home, '--claude-dir', claude, '--root', nb];
  assert.equal(run(['install', ...opts]).code, 0);
  const u = run(['uninstall', ...opts]);
  assert.equal(u.code, 0, u.out);
  for (const f of runtime) assert.ok(!fs.existsSync(path.join(hive, f)), `${f} is gone`);
  const kept = u.out.split(/^Yours, kept/m)[1] || '';
  for (const f of runtime) assert.ok(!kept.includes(path.join(hive, f)), `${f} is not called yours`);
  assert.equal(fs.readFileSync(path.join(hive, 'protected-names.txt'), 'utf8'), 'Aleksandra\n');
  assert.ok(fs.readFileSync(path.join(hive, 'config.json')).equals(cfgBefore), 'config.json is put back as the plugin wrote it');
});

test('clear: after the plugin was removed, one command takes out what Hive Mind wrote while it ran', () => {
  const nb = makeNotebook('notes clear');
  const { home, claude } = makeHome('case clear');
  const hive = path.join(claude, 'hive');
  w(path.join(hive, 'protected-names.txt'), 'Aleksandra\n');
  w(path.join(hive, 'shopping.csv'), 'milk\n');
  const runtime = pluginRan(hive, nb);
  const opts = ['--home', home, '--claude-dir', claude, '--root', nb];
  const before = snap(home);
  const dry = run(['clear', '--dry-run', ...opts]);
  assert.equal(dry.code, 0, dry.out);
  for (const f of runtime) assert.ok(dry.out.includes(path.join(hive, f.split(path.sep)[0])), `the dry run names ${f}`);
  assert.deepEqual(snap(home), before, 'a dry run writes nothing');
  const r = run(['clear', ...opts]);
  assert.equal(r.code, 0, r.out);
  for (const f of runtime) assert.ok(!fs.existsSync(path.join(hive, f)), `${f} is gone`);
  for (const f of ['protected-names.txt', 'shopping.csv', 'config.json']) assert.ok(fs.existsSync(path.join(hive, f)), `${f} stays`);
  assert.match(r.out, /^Yours, kept/m);
  // config.json was written by Hive Mind: it is kept on purpose, and said so, never called yours.
  for (const out of [dry.out, r.out]) {
    const yoursPart = (out.split(/^Yours, kept/m)[1] || '').split(/^Kept on purpose/m)[0];
    assert.ok(!yoursPart.includes('config.json'), 'config.json is not listed as yours');
    assert.match(out, /^Kept on purpose: Hive Mind wrote this file\.[^\n]*where your notebook is[^\n]*\n- [^\n]*config\.json/m);
  }
  assert.ok(!fs.existsSync(path.join(hive, 'gates')) && !fs.existsSync(path.join(hive, 'claims')), 'no empty folders of Hive Mind left');
  // It refuses while a way in is still there: the plugin switched on, or the installer's parts.
  const sf = path.join(claude, 'settings.json');
  const s = JSON.parse(fs.readFileSync(sf, 'utf8')); s.enabledPlugins['hive-mind@hive-mind'] = true; fs.writeFileSync(sf, JSON.stringify(s));
  let x = run(['clear', ...opts]);
  assert.equal(x.code, 1); assert.match(x.out, /plugin is still switched on/);
  delete s.enabledPlugins['hive-mind@hive-mind']; fs.writeFileSync(sf, JSON.stringify(s));
  assert.equal(run(['install', ...opts]).code, 0);
  x = run(['clear', ...opts]);
  assert.equal(x.code, 1); assert.match(x.out, /uninstall/);
  assert.equal(run(['uninstall', ...opts]).code, 0);
});

test('the installer notices the plugin and says plainly to keep one way, with the one step to drop the other', () => {
  const nb = makeNotebook('notes both');
  const { home, claude } = makeHome('case both');
  const sf = path.join(claude, 'settings.json');
  const s = JSON.parse(fs.readFileSync(sf, 'utf8')); s.enabledPlugins['hive-mind@hive-mind'] = true; fs.writeFileSync(sf, JSON.stringify(s));
  const opts = ['--home', home, '--claude-dir', claude, '--root', nb];
  const r = run(['install', '--dry-run', ...opts]);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /plugin/i); assert.match(r.out, /twice/); assert.match(r.out, /Keep one way/);
  assert.match(r.out, /claude plugin uninstall hive-mind@hive-mind/); assert.match(r.out, /install\.mjs uninstall|uninstall\.ps1 -All/);
  assert.doesNotMatch(run(['install', '--dry-run', '--home', home, '--claude-dir', makeHome('case one way').claude, '--root', nb]).out, /twice/);
});

test('the list of what Hive Mind writes covers every name its programs write in the Hive folder', async () => {
  const { RUNTIME, isRuntime } = await import('./install.mjs');
  assert.ok(Array.isArray(RUNTIME) && RUNTIME.length > 10);
  // The programs that write in the Hive folder, with the name each one uses for that folder.
  const writers = ['core/gates/gates.mjs', 'core/start/start.mjs', 'core/factory/lib.mjs', 'core/factory/on-stop.mjs', 'core/engine/value.mjs', 'core/engine/handout.mjs', 'system/ends-check.mjs', 'system/publish-quiet.ps1'];
  const sub = { GDIR: 'gates/', gdir: 'gates/', FDIR: 'factory/' };
  // Placed by the install itself (in its record) or a folder: not run-time files.
  // (factory/ files are named in code, not as plain words: they are checked in the list below.)
  const installed = ['config.json', 'start.ps1', 'gates', 'factory', 'privacy-guard.ps1', 'privacy-guard.mjs', 'gates.mjs'];
  let seen = 0;
  for (const rel of writers) {
    const text = fs.readFileSync(path.join(STARTER, rel), 'utf8');
    for (const m of text.matchAll(/(STATE|hive|GDIR|gdir|FDIR|\$hive)\s*,?\s*['"]([\w.-]+)['"](?:\s*\+[^+'"]+\+\s*['"]([\w.]+)['"])?/g)) {
      // A name built from parts ('tsc-' + short(app) + '.tsbuildinfo') is checked with a made-up middle.
      const name = (sub[m[1]] || '') + m[2] + (m[3] ? 'x' + m[3] : '');
      if (installed.includes(m[2]) && !sub[m[1]]) continue;
      if (sub[m[1]] && installed.includes(m[2])) continue; // gates/gates.mjs is the installed program
      seen++;
      // A name used as a folder is checked with a file inside it.
      const probe = /\.\w+$/.test(name) || /-(off|hold)$/.test(name) ? name : name + '/x.json';
      assert.ok(isRuntime(probe), `${rel}: "${name}" is in the list of what Hive Mind writes`);
    }
  }
  assert.ok(seen >= 15, `names checked: ${seen}`);
  for (const f of ['gates/rec/s.json', 'gates/turn/s.events', 'gates/chat/s.carry.json', 'claims/s.json', 'factory/tsc-a.tsbuildinfo', 'gates.log.1'])
    assert.ok(isRuntime(f), f);
  for (const f of ['shopping.csv', 'NOTES', 'gates/my-file.txt', 'gates/rec/mine.txt', 'verify/run/result.md', 'my notes/plan.md', 'protected-names.txt'])
    assert.ok(!isRuntime(f), `${f} is not Hive Mind's`);
});

test('after the notebook was moved, the undo still takes the save hook out of it', () => {
  for (const reinstall of [true, false]) {
    const nb = makeNotebook(reinstall ? 'notes move a' : 'notes move b');
    const { home, claude } = makeHome(reinstall ? 'case move a' : 'case move b');
    const hooks = (dir) => Object.fromEntries(fs.readdirSync(path.join(dir, '.git', 'hooks')).map((f) => [f, fs.readFileSync(path.join(dir, '.git', 'hooks', f), 'utf8')]));
    const before = hooks(nb);
    assert.equal(run(['install', '--home', home, '--claude-dir', claude, '--root', nb]).code, 0);
    const moved = path.join(TMP, 'moved place', path.basename(nb));
    fs.mkdirSync(path.dirname(moved), { recursive: true });
    fs.renameSync(nb, moved);
    const opts = ['--home', home, '--claude-dir', claude, '--root', moved];
    if (reinstall) assert.equal(run(['install', ...opts]).code, 0, 'installing again from the new place');
    const u = run(['uninstall', ...opts]);
    assert.equal(u.code, 0, u.out);
    assert.deepEqual(hooks(moved), before, (reinstall ? 'moved and installed again' : 'moved only') + ': the save hook is back to your own, no copies left');
  }
});

test('the pages and the installer agree', async () => {
  const page = (rel) => fs.readFileSync(path.join(STARTER, rel), 'utf8').replace(/\r\n/g, '\n');
  const setup = page('core/skills/hive-setup/install.md'), first = page('docs/first-hour.md'), broken = page('docs/when-it-breaks.md');
  // One truth on installing Git and Node: Claude's steps name the same winget commands the person is told about.
  for (const cmd of first.match(/winget install [^`|]+/g) || []) assert.ok(setup.includes(cmd.trim()), `install.md names: ${cmd.trim()}`);
  assert.ok((first.match(/winget install/g) || []).length >= 2);
  assert.doesNotMatch(setup, /you do not run an installer/);
  // Every installer command and option the set-up page names is one the installer knows; no program that is not there.
  const { parseArgs } = await import('./install.mjs');
  const named = [...setup.matchAll(/node core\/install\/install\.mjs ([^`]+)`/g)].map((m) => m[1].replace(/<[^>]+>/g, 'X').trim().split(/\s+/));
  assert.ok(named.length >= 4, 'the page names the installer\'s commands');
  for (const args of named) assert.doesNotThrow(() => parseArgs(args), args.join(' '));
  for (const m of setup.matchAll(/core\/[\w/-]+\.(mjs|ps1|sh)/g)) assert.ok(fs.existsSync(path.join(STARTER, m[0])), `${m[0]} exists`);
  assert.doesNotMatch(setup, /\buninstall\.mjs/, 'there is no uninstall.mjs: the undo is install.mjs uninstall');
  // A stopped install has its own entry for the person.
  assert.match(broken, /^## Setup stopped halfway$/m);
  // Installed or not is never told by the Hive folder existing (setup makes it first for the names list).
  const skill = page('core/skills/hive-setup/SKILL.md');
  for (const [name, text] of [['SKILL.md', skill], ['install.md', setup]]) {
    assert.doesNotMatch(text, /~\/\.claude\/hive`? does not exist/, `${name} must not decide by the folder`);
    assert.match(text, /install-record\.json/, `${name} names what the installer leaves`);
  }
  // The plugin page: what really happens when you add it, what stays when you remove it, and the guard on your notes.
  const plugin = page('docs/plugin.md');
  assert.doesNotMatch(plugin, /When you add the plugin, Claude Code asks for your notebook folder/);
  assert.match(plugin, /does not ask/);
  assert.match(plugin, /install\.mjs clear --dry-run/);
  assert.match(plugin, /holds the text of the last message you typed/);
  assert.match(plugin, /only from that public address/); assert.match(plugin, /Never add it from your own notes folder/);
  assert.match(plugin, /delete the copy[^.]*\(removing the plugin does not delete that copy, so your notes stay there until you do\)/);
  for (const [name, text] of [['SKILL.md', skill], ['install.md', setup]]) assert.match(text, /enabledPlugins/, `${name} notices the plugin`);
  // Since 2026-11-20 the first hour may name the public site: a new person arrives from its steps page (the journey after "Start yours").
  // No page says the notebook can only live in ~/hive-mind.
  assert.doesNotMatch(first, /Ask Claude to move it to your home folder\. Hive Mind looks for it at `hive-mind` in your home folder\./);
});

test('the Windows front door speaks plainly when Node is missing (Windows only)', { skip: process.platform !== 'win32' }, () => {
  const sys = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32');
  const env = { ...process.env, HIVE_INSTALL_TEST: '1' };
  for (const k of Object.keys(env)) if (k.toLowerCase() === 'path') delete env[k];
  env.PATH = sys + ';' + path.join(sys, 'WindowsPowerShell', 'v1.0');
  const r = spawnSync(path.join(sys, 'WindowsPowerShell', 'v1.0', 'powershell.exe'), ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(STARTER, 'core', 'gates', 'install.ps1'), '-DryRun'], { encoding: 'utf8', env });
  assert.match(r.stdout, /STOPPED: node was not found\. Nothing was changed\./);
  assert.match(r.stdout, /Ask Claude to install Node/);
  assert.match(r.stdout, /quit the Claude app completely/);
  assert.doesNotMatch(r.stdout, /PowerShell window|terminal window/);
});
