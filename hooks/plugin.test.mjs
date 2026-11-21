// Tests for the Hive Mind plugin package: the two manifests, hooks/hooks.json, hooks/run.mjs and the cloud start
// wiring in .claude/settings.json. Run: node --test hooks/plugin.test.mjs
// Everything runs on made-up folders in the temporary folder; the real Claude folder is never read or written.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { installerHooksPresent, connectNotebook, addBlock } from './run.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const json = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'hive plugin test '));
// The hooks run from a clean temporary plugin folder (the programs only, no notes), the way the public copy is added.
// So the tests pass anywhere, also inside a notebook that was set up, where the filled-notebook guard would stop them.
function pluginRoot({ notes = false } = {}) {
  const plug = path.join(tmp(), 'plugin');
  for (const d of ['hooks', 'core/start', 'core/gates']) fs.cpSync(path.join(ROOT, d), path.join(plug, d), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'core', 'claude-md.md'), path.join(plug, 'core', 'claude-md.md'));
  fs.mkdirSync(path.join(plug, 'system'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'system', 'rules.md'), path.join(plug, 'system', 'rules.md'));
  for (const f of ['me/profile.md', 'projects']) fs.rmSync(path.join(plug, f), { recursive: true, force: true });
  if (notes) { fs.mkdirSync(path.join(plug, 'me'), { recursive: true }); fs.writeFileSync(path.join(plug, 'me', 'profile.md'), '# About you\nCall them: someone\n'); }
  return plug;
}
const RUN = path.join(pluginRoot(), 'hooks', 'run.mjs');
const hasSh = spawnSync('sh', ['-c', 'exit 0']).status === 0;

// A made-up Claude folder and a made-up notebook (a copy of only what the start step reads).
function fakeWorld() {
  const t = tmp();
  const claude = path.join(t, 'claude');
  const nb = path.join(t, 'my notebook');
  fs.mkdirSync(claude, { recursive: true });
  for (const rel of ['system', 'core/start', 'core/gates']) fs.mkdirSync(path.join(nb, rel), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'system', 'rules.md'), path.join(nb, 'system', 'rules.md'));
  fs.copyFileSync(path.join(ROOT, 'core', 'gates', 'settings.json'), path.join(nb, 'core', 'gates', 'settings.json'));
  return { claude, nb };
}
const run = (args, env, input = '{}') => spawnSync(process.execPath, [RUN, ...args], {
  input, encoding: 'utf8', timeout: 30000,
  env: { ...process.env, CLAUDE_CODE_REMOTE: '', HIVE_ROOT: '', HIVE_STATE: '', HIVE_HOME: '', CLAUDE_PLUGIN_OPTION_NOTEBOOK: '', ...env },
});

test('plugin.json holds the required name and only paths that exist inside the plugin', () => {
  const p = json('.claude-plugin/plugin.json');
  assert.equal(p.name, 'hive-mind');
  assert.match(p.name, /^[a-z0-9]+(-[a-z0-9]+)*$/);
  for (const s of [].concat(p.skills || [])) {
    assert.ok(s.startsWith('./'), `${s} starts with ./`);
    assert.ok(fs.statSync(path.join(ROOT, s)).isDirectory(), `${s} exists`);
  }
  for (const [k, o] of Object.entries(p.userConfig || {})) {
    assert.match(k, /^[A-Za-z_][A-Za-z0-9_]*$/);
    for (const f of ['type', 'title', 'description']) assert.ok(o[f], `userConfig.${k}.${f}`);
  }
});

test('marketplace.json holds name, owner.name and plugins, and its entry matches the manifest name', () => {
  const m = json('.claude-plugin/marketplace.json');
  assert.match(m.name, /^[A-Za-z0-9][A-Za-z0-9._-]*$/);
  assert.ok(m.owner && m.owner.name);
  assert.equal(m.plugins.length, 1);
  assert.equal(m.plugins[0].name, json('.claude-plugin/plugin.json').name);
  assert.equal(m.plugins[0].source, './');
});

test('hooks.json has the same events and matchers as the installer\'s Node hook list, all through run.mjs', () => {
  const plug = json('hooks/hooks.json').hooks;
  const inst = json('core/start/settings-snippet.node.json').hooks;
  assert.deepEqual(Object.keys(plug).sort(), Object.keys(inst).sort());
  for (const ev of Object.keys(inst)) {
    assert.deepEqual(plug[ev].map((e) => e.matcher || ''), inst[ev].map((e) => e.matcher || ''), ev);
    for (const e of plug[ev]) for (const h of e.hooks) {
      assert.equal(h.command, 'node');
      assert.equal(h.args[0], '${CLAUDE_PLUGIN_ROOT}/hooks/run.mjs');
    }
  }
  const parts = plug.SessionStart.map((e) => e.hooks[0].args.slice(1).join(' '));
  assert.deepEqual(parts, ['start rules', 'start state', 'start flight']);
});

test('no file of the package carries a real person\'s name or address: owner fields are placeholders, or, in the published copy, the licence\'s owner and the copy\'s own address', () => {
  const m = json('.claude-plugin/marketplace.json');
  const p = json('.claude-plugin/plugin.json');
  // The notebook's starter/ keeps the placeholders; the publish program fills all of them at once in the built copy.
  // (Matched by shape, not by name, so the published copy holds no placeholder's name at all.)
  const placeholder = /^__[A-Z][A-Z_]*__$/;
  if (placeholder.test(p.repository)) {
    for (const v of [m.owner.name, m.owner.url, p.author.name]) assert.match(v, placeholder);
    assert.equal(m.owner.name, p.author.name);
  } else {
    const licence = fs.readFileSync(path.join(ROOT, 'LICENSE.md'), 'utf8');
    const owner = (licence.match(/^Required Notice: Copyright (?:\d{4}(?:\s*-\s*\d{4})?\s+)?(.+?)\.(?:\s|$)/m) || [])[1];
    assert.match(p.repository, /^https:\/\/github\.com\/[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/);
    assert.equal(m.owner.url, p.repository.replace(/\/[^/]+$/, ''));
    assert.ok(owner, 'the licence names its owner');
    assert.equal(m.owner.name, owner); assert.equal(p.author.name, owner);
  }
  for (const rel of ['.claude-plugin/plugin.json', '.claude-plugin/marketplace.json', 'hooks/hooks.json', 'hooks/run.mjs', '.claude/settings.json', 'docs/plugin.md']) {
    const t = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    assert.doesNotMatch(t, /[A-Za-z]:[\\/]+Users[\\/]+[^\\/"<_]/, `${rel} holds no home folder path`);
    assert.doesNotMatch(t, /@[a-z0-9-]+\.[a-z]{2,}/i, `${rel} holds no e-mail address`);
  }
});

test('installer hooks in settings.json are recognised; other hooks and broken files are not', () => {
  const d = tmp();
  assert.equal(installerHooksPresent(d), false);
  fs.writeFileSync(path.join(d, 'settings.json'), '{ not json');
  assert.equal(installerHooksPresent(d), false);
  fs.writeFileSync(path.join(d, 'settings.json'), JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo hi' }] }] } }));
  assert.equal(installerHooksPresent(d), false);
  fs.writeFileSync(path.join(d, 'settings.json'), JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'C:/node.exe', args: ['C:/u/.claude/hive/start.mjs', '-Part', 'rules'] }] }] } }));
  assert.equal(installerHooksPresent(d), true);
  fs.writeFileSync(path.join(d, 'settings.json'), JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command: '& "$HOME\\.claude\\hive\\start.ps1"', shell: 'powershell' }] }] } }));
  assert.equal(installerHooksPresent(d), true);
});

test('the notebook option is written into config.json once, in the installer\'s form', () => {
  const hive = path.join(tmp(), 'hive');
  assert.equal(connectNotebook(hive, ''), false);
  assert.equal(fs.existsSync(hive), false);
  assert.equal(connectNotebook(hive, path.join(os.tmpdir(), 'nb')), true);
  assert.equal(JSON.parse(fs.readFileSync(path.join(hive, 'config.json'), 'utf8')).root, path.resolve(os.tmpdir(), 'nb'));
  assert.equal(connectNotebook(hive, path.join(os.tmpdir(), 'nb')), false);
});

test('plugin route: the first start part carries the rules and the Hive Mind block, naming the chosen notebook', () => {
  const { claude, nb } = fakeWorld();
  const r = run(['start', 'rules'], { CLAUDE_CONFIG_DIR: claude, CLAUDE_PLUGIN_OPTION_NOTEBOOK: nb });
  assert.equal(r.status, 0, r.stderr);
  const ctx = JSON.parse(r.stdout).hookSpecificOutput.additionalContext;
  assert.match(ctx, /HIVE MIND START/);
  assert.match(ctx, /# Hive Mind\n/);
  assert.ok(ctx.includes(nb.split(path.sep).join('/')), 'the block names the notebook folder');
  assert.ok(ctx.length <= 10000, `under the hook cap: ${ctx.length}`);
  assert.equal(JSON.parse(fs.readFileSync(path.join(claude, 'hive', 'config.json'), 'utf8')).root, path.resolve(nb));
});

test('plugin route: the checks run from the plugin and answer a message', () => {
  const { claude, nb } = fakeWorld();
  run(['start', 'rules'], { CLAUDE_CONFIG_DIR: claude, CLAUDE_PLUGIN_OPTION_NOTEBOOK: nb });
  const r = run(['gates', 'prompt'], { CLAUDE_CONFIG_DIR: claude, CLAUDE_PLUGIN_OPTION_NOTEBOOK: nb }, JSON.stringify({ session_id: 'test-1', prompt: 'hello', cwd: nb }));
  assert.equal(r.status, 0, r.stderr);
});

test('installer already in place: the plugin stands down, saying so once', () => {
  const { claude, nb } = fakeWorld();
  fs.writeFileSync(path.join(claude, 'settings.json'), JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'node', args: [path.join(claude, 'hive', 'start.mjs'), '-Part', 'rules'] }] }] } }));
  const env = { CLAUDE_CONFIG_DIR: claude, CLAUDE_PLUGIN_OPTION_NOTEBOOK: nb };
  const first = run(['start', 'rules'], env);
  assert.equal(first.status, 0);
  assert.match(first.stdout, /standing down/);
  for (const a of [['start', 'state'], ['start', 'flight'], ['gates', 'pretool'], ['gates', 'stop']]) assert.equal(run(a, env).stdout, '', a.join(' '));
  assert.equal(fs.existsSync(path.join(claude, 'hive', 'config.json')), false, 'nothing written');
});

test('cloud chat: the start comes from the cloud start step, the checks stay quiet', { skip: !hasSh && 'no sh on this computer' }, () => {
  const { claude, nb } = fakeWorld();
  const env = { CLAUDE_CONFIG_DIR: claude, CLAUDE_CODE_REMOTE: 'true', HIVE_ROOT: nb, HIVE_FORCE_CLOUD: '1', CLAUDE_PROJECT_DIR: nb };
  const r = run(['start', 'rules'], env);
  assert.match(r.stdout, /HIVE MIND START \(cloud chat\)/);
  assert.equal(run(['gates', 'pretool'], env).stdout, '');
});

test('.claude/settings.json starts cloud chats in three parts, each under the hook cap, and is silent on a PC', { skip: !hasSh && 'no sh on this computer' }, () => {
  const s = json('.claude/settings.json');
  const cmds = s.hooks.SessionStart.map((e) => e.hooks[0].command);
  assert.deepEqual(cmds.map((c) => c.split(' ').pop()), ['rules', 'state', 'flight']);
  for (const c of cmds) {
    assert.match(c, /^sh "\$CLAUDE_PROJECT_DIR\/core\/start\/start-cloud\.sh" \w+$/);
    const part = c.split(' ').pop();
    const cloud = spawnSync('sh', ['-c', c], { encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: ROOT, HIVE_FORCE_CLOUD: '1', HIVE_ROOT: ROOT } });
    assert.ok(cloud.stdout.length > 0 || part === 'flight', `${part} gives text`);
    assert.ok([...cloud.stdout].length <= 9000, `${part}: ${cloud.stdout.length} characters`);
    const pc = spawnSync('sh', ['-c', c], { encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: ROOT, CLAUDE_CODE_REMOTE: '', HIVE_FORCE_CLOUD: '' } });
    assert.equal(pc.stdout, '', `${part} is silent outside the cloud`);
  }
});

test('installer already in place: the stand-down says the helpers are there twice, and gives the one step to drop each way', () => {
  const { claude, nb } = fakeWorld();
  fs.writeFileSync(path.join(claude, 'settings.json'), JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'node', args: [path.join(claude, 'hive', 'start.mjs'), '-Part', 'rules'] }] }] } }));
  const out = run(['start', 'rules'], { CLAUDE_CONFIG_DIR: claude, CLAUDE_PLUGIN_OPTION_NOTEBOOK: nb }).stdout;
  assert.match(out, /twice/);
  assert.match(out, /Keep one way/);
  assert.match(out, /claude plugin uninstall hive-mind@hive-mind/);
  assert.match(out, /install\.mjs uninstall/);
});

test('a plugin added from a filled notebook (private notes copied into the plugin cache) refuses, loudly, at its first hook', () => {
  const plug = pluginRoot({ notes: true });
  const { claude, nb } = fakeWorld();
  const env = { ...process.env, CLAUDE_CODE_REMOTE: '', HIVE_ROOT: '', HIVE_STATE: '', HIVE_HOME: '', CLAUDE_CONFIG_DIR: claude, CLAUDE_PLUGIN_OPTION_NOTEBOOK: nb };
  const go = (a, input = '{}') => spawnSync(process.execPath, [path.join(plug, 'hooks', 'run.mjs'), ...a], { input, encoding: 'utf8', env });
  const first = go(['start', 'rules']);
  assert.equal(first.status, 0);
  const o = JSON.parse(first.stdout);
  assert.match(o.systemMessage, /private notes/);
  assert.match(o.hookSpecificOutput.additionalContext, /public address/);
  assert.match(o.hookSpecificOutput.additionalContext, /never from your own notes folder/i);
  // The three steps, the third one plainly: the notes stay in Claude's plugin folder until that copy is deleted.
  assert.match(o.systemMessage, /until/); assert.match(o.systemMessage, /delete/i);
  assert.match(o.hookSpecificOutput.additionalContext, /1\. .*uninstall[\s\S]*2\. Delete the copy at[\s\S]*3\. /);
  for (const a of [['start', 'state'], ['gates', 'prompt']]) assert.equal(go(a, JSON.stringify({ session_id: 'x', prompt: 'hi' })).stdout, '', a.join(' ') + ' does nothing');
  assert.equal(fs.existsSync(path.join(claude, 'hive', 'config.json')), false, 'nothing written');
  // The public copy (no notes in it) runs as usual: the guard looks only for filled notes.
  assert.doesNotMatch(run(['start', 'rules'], { CLAUDE_CONFIG_DIR: claude, CLAUDE_PLUGIN_OPTION_NOTEBOOK: nb }).stdout, /private notes/);
});

test('addBlock leaves output it cannot read untouched', () => {
  assert.equal(addBlock('plain text', ''), 'plain text');
  assert.equal(addBlock('{"x":1}', ''), '{"x":1}');
});
