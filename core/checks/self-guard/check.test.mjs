// Tests for the self-guard check. Every run uses a made-up home under the temporary folder; the real home is never
// touched. Each behaviour has a known-bad case that must be
// caught and a known-good case that must pass.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import check from './check.mjs';
import * as G from './lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(HERE, 'cli.mjs');
const SETTINGS = JSON.parse(fs.readFileSync(path.join(HERE, 'settings.json'), 'utf8'));
// The tests set the lock's bite themselves: the shipped value is the person's to choose.
if (SETTINGS.held) SETTINGS.held.bite = 'strict';

// ---------- a made-up home ----------
const HOMES = [];
after(() => { for (const h of HOMES) fs.rmSync(h, { recursive: true, force: true }); });
function home() {
  const h = fs.mkdtempSync(path.join(os.tmpdir(), 'hive-selfguard-'));
  HOMES.push(h);
  const claudeDir = path.join(h, '.claude');
  const state = path.join(claudeDir, 'hive');
  const root = path.join(h, 'hive-mind');
  const w = (p, s) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s); };
  w(path.join(root, 'system', 'rules.md'), '# rules\n');
  w(path.join(root, 'core', 'gates', 'gates.mjs'), '// gates\nconsole.log(1);\n');
  w(path.join(root, 'core', 'gates', 'settings.json'), JSON.stringify({ enabled: true, publish: { mode: 'refuse', patterns: ['vercel'] }, reply: { mode: 'notice' } }, null, 2));
  w(path.join(root, 'core', 'start', 'start.ps1'), '# start\n');
  w(path.join(root, 'core', 'guard', 'privacy-guard.mjs'), '// guard\n');
  w(path.join(root, 'core', 'skills', 'hive-gates', 'SKILL.md'), '# gates skill\n');
  w(path.join(root, 'core', 'checks', 'self-guard', 'check.mjs'), "export default { id: 'self-guard', kind: 'safety', mode: 'refuse' };\n");
  w(path.join(root, 'core', 'start', 'settings-snippet.json'), JSON.stringify({ hooks: {
    SessionStart: [{ hooks: [{ type: 'command', command: '& "$HOME\\.claude\\hive\\start.ps1" -Part rules' }] }],
    PreToolUse: [{ matcher: 'Write|Edit|Bash', hooks: [{ type: 'command', command: '__NODE__', args: ['__HIVE__/gates/gates.mjs', 'pretool'] }] }],
    Stop: [{ hooks: [{ type: 'command', command: '__NODE__', args: ['__HIVE__/gates/gates.mjs', 'stop'] }] }],
  } }));
  // the installed copies, the same as the notebook's
  w(path.join(state, 'gates', 'gates.mjs'), '// gates\r\nconsole.log(1);\r\n'); // line endings do not count
  w(path.join(state, 'start.ps1'), '# start\n');
  w(path.join(state, 'privacy-guard.mjs'), '// guard\n');
  w(path.join(claudeDir, 'skills', 'hive-gates', 'SKILL.md'), '# gates skill\n');
  w(path.join(claudeDir, 'settings.json'), JSON.stringify({ hooks: {
    SessionStart: [{ hooks: [{ type: 'command', command: '& "C:\\h\\.claude\\hive\\start.ps1" -Part rules' }] }],
    PreToolUse: [{ matcher: 'Write|Edit|Bash', hooks: [{ type: 'command', command: 'node', args: [state + '/gates/gates.mjs', 'pretool'] }] }],
    Stop: [{ hooks: [{ type: 'command', command: 'node', args: [state + '/gates/gates.mjs', 'stop'] }] }],
  } }, null, 2));
  return { h, claudeDir, state, root, w };
}

function ctxFor(H, over = {}) {
  const logged = [];
  const msg = over.hisLast ?? '';
  return {
    root: H.root, state: H.state, claudeDir: H.claudeDir,
    hisLast: msg,
    said: (re) => (re instanceof RegExp ? re : new RegExp(re, 'i')).test(msg),
    isHelperChat: false,
    loaded: [], events: [],
    read: (rel) => { try { return fs.readFileSync(path.join(H.root, rel), 'utf8'); } catch { return ''; } },
    settings: SETTINGS,
    log: (event, detail) => logged.push({ event, ...detail }),
    logged,
    ...over,
  };
}
const ev = (tool, input, sid = 's1') => ({ session_id: sid, hook_event_name: 'PreToolUse', tool_name: tool, tool_input: input, tool, input, command: input.command });
const startRecord = (H, sid = 's1') => H.w(path.join(H.state, 'gates', 'start', sid + '.json'), JSON.stringify({ session: sid }));
const prompt = (H, sid, text) => ({ session_id: sid, hook_event_name: 'UserPromptSubmit', prompt: text, text });

// ---------- 1. Claude writing its own off switch ----------
test('known-bad: Claude writes the gates-off file -> refused', () => {
  const H = home();
  const r = check.steps.pretool(ev('Write', { file_path: path.join(H.state, 'gates-off'), content: '' }), ctxFor(H, { hisLast: 'sure, go on' }));
  assert.ok(r && r.deny, 'must refuse');
  assert.match(r.deny, /off switch|switch/i);
});
test('known-bad: the off switch through a shell command, with a home-relative path -> refused', () => {
  const H = home();
  for (const command of ['touch ~/.claude/hive/gates-off', 'New-Item -ItemType File "$HOME\\.claude\\hive\\gates-off"', 'echo x > ' + H.state + '/factory-off', 'rm ' + H.state + '/gates.log']) {
    const r = check.steps.pretool(ev('Bash', { command }), ctxFor(H, { hisLast: 'ok' }));
    assert.ok(r && r.deny, 'must refuse: ' + command);
  }
});
test('known-good: they say "gates off" in their own message -> the write passes, and the switch is logged with who', () => {
  const H = home();
  const c = ctxFor(H, { hisLast: 'gates off please, for an hour' });
  const r = check.steps.pretool(ev('Write', { file_path: path.join(H.state, 'gates-off'), content: '' }), c);
  assert.equal(r, null);
  assert.ok(c.logged.some((l) => l.event === 'self-guard-allowed'));
});
test('known-bad: "gates off" said in a helper chat never counts', () => {
  const H = home();
  const r = check.steps.pretool(ev('Write', { file_path: path.join(H.state, 'gates-off'), content: '' }), ctxFor(H, { hisLast: 'gates off', isHelperChat: true }));
  assert.ok(r && r.deny);
});
test('known-bad: the person’s words forbid the act ("don\'t switch the gates off", "never turn off the checks") -> still refused', () => {
  const H = home();
  for (const hisLast of ["don't switch off the gates", 'never turn off the checks', 'do not make it softer']) {
    const r = check.steps.pretool(ev('Write', { file_path: path.join(H.state, 'gates-off'), content: '' }), ctxFor(H, { hisLast }));
    assert.ok(r && r.deny, hisLast);
  }
});
test('known-good: reading the log or the off switch is never refused', () => {
  const H = home();
  for (const command of ['cat ~/.claude/hive/gates.log', 'Get-Content "$HOME\\.claude\\hive\\gates.log" -Tail 20', 'ls ~/.claude/hive', 'node core/checks/self-guard/cli.mjs log']) {
    assert.equal(check.steps.pretool(ev('Bash', { command }), ctxFor(H)), null, command);
  }
  assert.equal(check.steps.pretool(ev('Read', { file_path: path.join(H.state, 'gates.log') }), ctxFor(H)), null);
});

test('known-bad: a command that starts with a reading word and then runs something else there -> refused', () => {
  const H = home();
  for (const command of ['ls ~/.claude/hive && node x.mjs ~/.claude/hive/gates-off', 'cat ~/.claude/hive/gates.log; python wipe.py ~/.claude/hive/gates.log',
    'cat $(node make-off.mjs) ~/.claude/hive/gates-off', 'find ~/.claude/hive -name gates.log -delete', 'cd ~/.claude/hive && node x.mjs']) {
    assert.ok(check.steps.pretool(ev('Bash', { command }), ctxFor(H))?.deny, 'must refuse: ' + command);
  }
  for (const command of ['cd ~/.claude/hive && cat gates.log | grep deny', 'ls ~/.claude/hive | wc -l']) {
    assert.equal(check.steps.pretool(ev('Bash', { command }), ctxFor(H)), null, command);
  }
});

test('known-good: keeping a file the person sent (the front door copies it into the sources folder) passes', () => {
  const H = home();
  assert.equal(check.steps.pretool(ev('Write', { file_path: path.join(H.state, 'sources', '2026-11-20_a.pdf'), content: 'x' }), ctxFor(H)), null);
  assert.equal(check.steps.pretool(ev('Bash', { command: 'cp ./a.pdf ~/.claude/hive/sources/2026-11-20_a.pdf' }), ctxFor(H)), null);
  assert.ok(check.steps.pretool(ev('Bash', { command: 'cp ./a.pdf ~/.claude/hive/sources/a.pdf && rm ~/.claude/hive/gates.log' }), ctxFor(H))?.deny, 'one free place does not cover a second, guarded one');
});
test('known-bad: a weaker self-guard settings file (a word taken out, a free folder added, the canary off) -> refused', () => {
  const H = home();
  const f = path.join(H.root, 'core', 'checks', 'self-guard', 'settings.json');
  H.w(f, JSON.stringify(SETTINGS));
  const less = (k, v) => JSON.stringify({ ...SETTINGS, [k]: v });
  assert.ok(check.steps.pretool(ev('Write', { file_path: f, content: less('writeWords', SETTINGS.writeWords.filter((w) => w !== 'rm')) }), ctxFor(H))?.deny);
  assert.ok(check.steps.pretool(ev('Write', { file_path: f, content: less('freeFolders', [...SETTINGS.freeFolders, 'gates']) }), ctxFor(H))?.deny);
  assert.ok(check.steps.pretool(ev('Write', { file_path: f, content: less('canary', { mode: 'off' }) }), ctxFor(H))?.deny);
  assert.equal(check.steps.pretool(ev('Write', { file_path: f, content: less('writeWords', [...SETTINGS.writeWords, 'shred']) }), ctxFor(H)), null, 'a longer list of write words is stricter');
});

// ---------- 2. Claude editing the settings to weaken a check ----------
test('known-bad: an Edit that turns a check to "off" in the gates settings -> refused', () => {
  const H = home();
  const f = path.join(H.root, 'core', 'gates', 'settings.json');
  const r = check.steps.pretool(ev('Edit', { file_path: f, old_string: '"mode": "refuse"', new_string: '"mode": "off"' }), ctxFor(H));
  assert.ok(r && r.deny);
  assert.match(r.deny, /weaker|softer|off/i);
});
test('known-bad: a Write that sets enabled false, or drops a word from a list -> refused', () => {
  const H = home();
  const f = path.join(H.root, 'core', 'gates', 'settings.json');
  const s = JSON.parse(fs.readFileSync(f, 'utf8'));
  assert.ok(check.steps.pretool(ev('Write', { file_path: f, content: JSON.stringify({ ...s, enabled: false }) }), ctxFor(H))?.deny);
  assert.ok(check.steps.pretool(ev('Write', { file_path: f, content: JSON.stringify({ ...s, publish: { mode: 'refuse', patterns: [] } }) }), ctxFor(H))?.deny);
});
test('known-good: making a check stricter passes; making it softer passes when they said so', () => {
  const H = home();
  const f = path.join(H.root, 'core', 'gates', 'settings.json');
  assert.equal(check.steps.pretool(ev('Edit', { file_path: f, old_string: '"mode": "notice"', new_string: '"mode": "refuse"' }), ctxFor(H)), null);
  assert.equal(check.steps.pretool(ev('Edit', { file_path: f, old_string: '"mode": "refuse"', new_string: '"mode": "notice"' }), ctxFor(H, { hisLast: 'make the publish check softer, switch it to notice' })), null);
});
test('known-bad: a check module edited from safety to discipline, or its mode lowered -> refused', () => {
  const H = home();
  const f = path.join(H.root, 'core', 'checks', 'self-guard', 'check.mjs');
  assert.ok(check.steps.pretool(ev('Edit', { file_path: f, old_string: "kind: 'safety'", new_string: "kind: 'discipline'" }), ctxFor(H))?.deny);
  assert.ok(check.steps.pretool(ev('Edit', { file_path: f, old_string: "mode: 'refuse'", new_string: "mode: 'off'" }), ctxFor(H))?.deny);
  assert.ok(check.steps.pretool(ev('Bash', { command: 'rm -rf core/checks/self-guard' }), ctxFor(H, { hisLast: 'yes' }))?.deny);
});
test('known-bad: the app settings lose a gates hook, or get disableAllHooks -> refused', () => {
  const H = home();
  const f = path.join(H.claudeDir, 'settings.json');
  const s = JSON.parse(fs.readFileSync(f, 'utf8'));
  assert.ok(check.steps.pretool(ev('Write', { file_path: f, content: JSON.stringify({ ...s, disableAllHooks: true }) }), ctxFor(H))?.deny);
  const fewer = { ...s, hooks: { ...s.hooks, Stop: [] } };
  assert.ok(check.steps.pretool(ev('Write', { file_path: f, content: JSON.stringify(fewer) }), ctxFor(H))?.deny);
  const proj = path.join(H.root, '.claude', 'settings.local.json');
  assert.ok(check.steps.pretool(ev('Write', { file_path: proj, content: '{"disableAllHooks": true}' }), ctxFor(H))?.deny);
  assert.ok(check.steps.pretool(ev('Bash', { command: `node -e "require('fs').writeFileSync('${f.replace(/\\/g, '/')}','{}')"` }), ctxFor(H))?.deny);
});
test('known-good: adding a permission to the app settings, hooks untouched, passes', () => {
  const H = home();
  const f = path.join(H.claudeDir, 'settings.json');
  const s = JSON.parse(fs.readFileSync(f, 'utf8'));
  assert.equal(check.steps.pretool(ev('Write', { file_path: f, content: JSON.stringify({ ...s, permissions: { allow: ['Bash(ls:*)'] } }) }), ctxFor(H)), null);
});
test('known-bad: Claude overwrites an installed copy or runs the installer unasked -> refused', () => {
  const H = home();
  assert.ok(check.steps.pretool(ev('Write', { file_path: path.join(H.state, 'gates', 'gates.mjs'), content: '//' }), ctxFor(H))?.deny);
  assert.ok(check.steps.pretool(ev('Bash', { command: 'node core/install/install.mjs install' }), ctxFor(H, { hisLast: 'fine' }))?.deny);
  assert.equal(check.steps.pretool(ev('Bash', { command: 'node core/install/install.mjs install' }), ctxFor(H, { hisLast: 'yes, reinstall the gates' })), null);
});

// ---------- 3. installed copies against the notebook, by hash ----------
test('known-good: installed copies that match the notebook (line endings aside) -> no difference', () => {
  const H = home();
  const r = G.compareInstalled({ root: H.root, state: H.state, claudeDir: H.claudeDir });
  assert.deepEqual(r.differs, []);
  assert.ok(r.checked >= 4);
});
test('known-bad: an installed check file that differs from the notebook -> said, and safety steps refuse until the person rules', () => {
  const H = home();
  H.w(path.join(H.state, 'gates', 'gates.mjs'), '// gates, quietly changed\n');
  const r = G.compareInstalled({ root: H.root, state: H.state, claudeDir: H.claudeDir });
  assert.equal(r.differs.length, 1);
  assert.match(r.differs[0].dst, /gates\.mjs$/);
  startRecord(H);
  const c = ctxFor(H);
  const said = check.steps.prompt(prompt(H, 's1', 'hello'), c);
  assert.ok(said && /differ/i.test(said.say), 'said at the start');
  const den = check.steps.pretool(ev('Edit', { file_path: path.join(H.root, 'app', 'x.ts'), old_string: 'a', new_string: 'b' }), c);
  assert.ok(den && den.deny, 'a change is refused while the difference stands');
  assert.equal(check.steps.pretool(ev('Read', { file_path: path.join(H.root, 'system', 'rules.md') }), c), null, 'reading still passes');
  // the person rules: the copies as they are now are accepted
  const c2 = ctxFor(H, { hisLast: 'I changed it myself, accept the installed copies' });
  const r2 = check.steps.prompt(prompt(H, 's1', c2.hisLast), c2);
  assert.match(r2.say, /accepted|ruled/i);
  assert.equal(check.steps.pretool(ev('Edit', { file_path: path.join(H.root, 'app', 'x.ts'), old_string: 'a', new_string: 'b' }), c2), null);
});
test('an installed skill file missing is said; a file equal to the notebook\'s is level whatever an old install record says (the ruling of 2026-11-20)', () => {
  const H = home();
  fs.rmSync(path.join(H.claudeDir, 'skills', 'hive-gates', 'SKILL.md'));
  const r = G.compareInstalled({ root: H.root, state: H.state, claudeDir: H.claudeDir });
  assert.ok(r.differs.some((d) => d.why === 'missing'));
  const H2 = home();
  const dst = path.join(H2.state, 'start.ps1');
  H2.w(path.join(H2.state, 'install-record.json'), JSON.stringify({ files: { [dst]: { wrote: crypto.createHash('sha256').update('# old\n').digest('hex') } } }));
  const r2 = G.compareInstalled({ root: H2.root, state: H2.state, claudeDir: H2.claudeDir });
  assert.deepEqual(r2.differs, []);
});

// ---------- 4. hooks missing from the app's settings ----------
test('known-good: every hook the notebook expects is in the app settings -> nothing missing', () => {
  const H = home();
  assert.deepEqual(G.hooksMissing({ root: H.root, claudeDir: H.claudeDir }), []);
  // the same tools written with commas (the hooks page allows both) still count
  const f = path.join(H.claudeDir, 'settings.json');
  const s = JSON.parse(fs.readFileSync(f, 'utf8'));
  s.hooks.PreToolUse[0].matcher = 'Write, Edit, Bash';
  fs.writeFileSync(f, JSON.stringify(s));
  assert.deepEqual(G.hooksMissing({ root: H.root, claudeDir: H.claudeDir }), []);
});
test('known-bad: a hook missing from the app settings, a matcher that lost a tool, disableAllHooks -> each said', () => {
  const H = home();
  const f = path.join(H.claudeDir, 'settings.json');
  const s = JSON.parse(fs.readFileSync(f, 'utf8'));
  delete s.hooks.Stop;
  s.hooks.PreToolUse[0].matcher = 'Write|Edit';
  s.disableAllHooks = true;
  fs.writeFileSync(f, JSON.stringify(s));
  const m = G.hooksMissing({ root: H.root, claudeDir: H.claudeDir });
  assert.ok(m.some((x) => x.event === 'Stop'));
  assert.ok(m.some((x) => x.event === 'PreToolUse' && /Bash/.test(x.why)));
  assert.ok(m.some((x) => /disableAllHooks|every hook/i.test(x.why)));
  startRecord(H);
  const r = check.steps.prompt(prompt(H, 's1', 'hi'), ctxFor(H));
  assert.match(r.say, /hook/i);
});

// ---------- 5. a chat with no start record ----------
test('known-bad: a chat with no start record -> said, and a start record is written so the checks act from the next step', () => {
  const H = home();
  const c = ctxFor(H);
  const r = check.steps.prompt(prompt(H, 'nostart', 'hello'), c);
  assert.ok(r && /start/i.test(r.say));
  assert.ok(fs.existsSync(path.join(H.state, 'gates', 'start', 'nostart.json')));
  assert.ok(c.logged.some((l) => l.event === 'self-guard-no-start'));
});
test('known-good: a chat with a start record -> nothing said about it', () => {
  const H = home();
  startRecord(H, 'ok1');
  const r = check.steps.prompt(prompt(H, 'ok1', 'hello'), ctxFor(H));
  assert.ok(!r || !/start record/i.test(r.say || ''));
});
// The real gates, today, in a made-up home: they skip every check in a chat with no start record, and they let
// Claude write its own off switch. These two fail until the gates' one writer wires the loader (and self-guard) in
// before the start-record test; they are marked "todo" so the run reports them without hiding them.
const GATES = path.join(HERE, '..', '..', 'gates', 'gates.mjs');
function runGates(H, mode, input) {
  return spawnSync(process.execPath, [GATES, mode], { input: JSON.stringify(input), encoding: 'utf8', timeout: 15000, env: { ...process.env, HIVE_HOME: H.h, HIVE_ROOT: H.root, HIVE_STATE: H.state } });
}
test('the real gates refuse Claude writing gates-off', { todo: 'needs the gates writer to call the loader' }, () => {
  const H = home();
  startRecord(H);
  const r = runGates(H, 'pretool', { session_id: 's1', hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path: path.join(H.state, 'gates-off'), content: '' } });
  assert.match(r.stdout || '', /"deny"/);
});
test('the real gates still run safety checks in a chat with no start record', { todo: 'needs the gates writer to run safety steps before the start-record test' }, () => {
  const H = home();
  fs.writeFileSync(path.join(H.state, 'publish-hold'), '');
  const r = runGates(H, 'pretool', { session_id: 'nostart', hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'vercel --prod' } });
  assert.match(r.stdout || '', /"deny"/);
});

// ---------- 6. the canary: proof the hooks fire ----------
test('known-bad: tools ran after the person’s message but the before-a-tool hook never fired -> said at the person’s next message', () => {
  const H = home();
  startRecord(H, 'c1');
  const c = ctxFor(H);
  check.steps.prompt(prompt(H, 'c1', 'first'), c);
  check.steps.posttool({ session_id: 'c1', tool_name: 'Edit', tool_input: {} }, c); // after-tool fired, before-tool did not
  check.steps.stop({ session_id: 'c1', text: 'done' }, c);
  const r = check.steps.prompt(prompt(H, 'c1', 'second'), c);
  assert.match(r.say, /before a tool|did not fire/i);
});
test('known-bad: no end-of-reply hook since the person’s last message -> said', () => {
  const H = home();
  startRecord(H, 'c2');
  const c = ctxFor(H);
  check.steps.prompt(prompt(H, 'c2', 'first'), c);
  const r = check.steps.prompt(prompt(H, 'c2', 'second'), c);
  assert.match(r.say, /end of a reply|did not fire/i);
});
test('known-good: every hook fired in the last turn -> the canary says nothing', () => {
  const H = home();
  startRecord(H, 'c3');
  const c = ctxFor(H);
  check.steps.prompt(prompt(H, 'c3', 'first'), c);
  check.steps.pretool(ev('Edit', { file_path: path.join(H.root, 'app', 'a.ts'), old_string: 'a', new_string: 'b' }, 'c3'), c);
  check.steps.posttool({ session_id: 'c3', tool_name: 'Edit', tool_input: {} }, c);
  check.steps.stop({ session_id: 'c3', text: 'ok' }, c);
  const r = check.steps.prompt(prompt(H, 'c3', 'second'), c);
  assert.ok(!r || !/did not fire/i.test(r.say || ''), r && r.say);
});
test('probe: an installed gates script that does not refuse a write of the off switch -> FAIL; one that does -> PASS', () => {
  const H = home();
  H.w(path.join(H.state, 'gates', 'gates.mjs'), "process.stdout.write('')\n");
  let r = spawnSync(process.execPath, [CLI, 'probe', '--home', H.h, '--root', H.root], { encoding: 'utf8' });
  assert.match(r.stdout, /FAIL/);
  H.w(path.join(H.state, 'gates', 'gates.mjs'), "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{if(/gates-off/.test(s))process.stdout.write(JSON.stringify({hookSpecificOutput:{hookEventName:'PreToolUse',permissionDecision:'deny',permissionDecisionReason:'no'}}))})\n");
  r = spawnSync(process.execPath, [CLI, 'probe', '--home', H.h, '--root', H.root], { encoding: 'utf8' });
  assert.match(r.stdout, /PASS/);
  assert.ok(!fs.existsSync(path.join(H.state, 'gates-off')), 'the probe never writes the real off switch');
});

// ---------- 7. the log in plain words, and the daily count ----------
function logLines(H, lines) { H.w(path.join(H.state, 'gates.log'), lines.map((l) => JSON.stringify(l)).join('\n') + '\n'); }
test('the log reader says what was refused, what is owed, and what was switched and by whom', () => {
  const H = home();
  const t = '2026-11-20T10:00:00.000Z';
  logLines(H, [
    { t, mode: 'pretool', event: 'deny', check: 'design', what: 'Write app/page.tsx' },
    { t, mode: 'pretool', event: 'publish-deny', what: 'vercel --prod' },
    { t, mode: 'stop', event: 'debt', key: 'proof', text: '"done" with no passing check' },
    { t, mode: 'prompt', event: 'debt-cleared', key: 'proof' },
    { t, mode: 'stop', event: 'debt', key: 'plain', text: 'file names in the reply' },
    { t, mode: 'prompt', event: 'self-guard-switch', what: 'the gates-off file', from: 'absent', to: 'present', who: 'Claude, on the person’s word: "gates off"' },
    { t, mode: 'pretool', event: 'error', error: 'boom' },
    'not json',
  ]);
  const r = spawnSync(process.execPath, [CLI, 'log', '--home', H.h, '--root', H.root, '--all'], { encoding: 'utf8' });
  const o = r.stdout;
  assert.match(o, /2 steps were stopped/);
  assert.match(o, /still owed/i);
  assert.match(o, /file names in the reply/);
  assert.doesNotMatch(o.split('still owed')[1] || '', /no passing check/, 'a cleared debt is not owed');
  assert.match(o, /gates-off file.*Claude, on the person’s word/);
  assert.match(o, /broke/i);
});
test('the daily count for the brief is one line, with zeros said, not left out', () => {
  const H = home();
  logLines(H, [{ t: '2026-11-19T10:00:00.000Z', event: 'deny' }, { t: '2026-11-19T11:00:00.000Z', event: 'debt', key: 'x' }]);
  const line = G.dailyCount(H.state, '2026-11-19');
  assert.match(line, /1 step stopped/);
  assert.match(line, /1 fault owed/);
  assert.match(line, /0 switches/);
  assert.equal(line.split('\n').length, 1);
});
test('a switch made by hand outside the chat is logged with who: not through the chat', () => {
  const H = home();
  startRecord(H, 'w1');
  const c = ctxFor(H);
  check.steps.prompt(prompt(H, 'w1', 'a'), c);
  check.steps.stop({ session_id: 'w1', text: '' }, c);
  fs.writeFileSync(path.join(H.state, 'gates-off'), '');
  const c2 = ctxFor(H);
  check.steps.prompt(prompt(H, 'w1', 'b'), c2);
  const sw = c2.logged.find((l) => l.event === 'self-guard-switch');
  assert.ok(sw, 'the switch is logged');
  assert.match(sw.who, /not through/i);
});

test('a switch Claude made on the person’s word is logged with who: Claude, on the person’s word', () => {
  const H = home();
  startRecord(H, 'w2');
  check.steps.prompt(prompt(H, 'w2', 'a'), ctxFor(H));
  const f = path.join(H.root, 'core', 'gates', 'settings.json');
  const c = ctxFor(H, { hisLast: 'switch the publish check to notice' });
  const e = { file_path: f, old_string: '"mode": "refuse"', new_string: '"mode": "notice"' };
  assert.equal(check.steps.pretool(ev('Edit', e, 'w2'), c), null);
  fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(e.old_string, e.new_string)); // the tool ran
  const c2 = ctxFor(H);
  check.steps.prompt(prompt(H, 'w2', 'b'), c2);
  const sw = c2.logged.find((l) => l.event === 'self-guard-switch');
  assert.ok(sw && /publish\.mode/.test(sw.what), 'the switch is named');
  assert.match(sw.who, /on the person’s word: "switch the publish check to notice"/);
});

// ---------- 8. its own error, and speed ----------
test('error behaviour (safety): on its own error the step refuses and says so', () => {
  const bad = { get root() { throw new Error('made-up failure'); }, state: undefined, settings: SETTINGS, log() {}, said: () => false, hisLast: '' };
  const r = check.steps.pretool(ev('Write', { file_path: '/x', content: '' }), bad);
  assert.ok(r && r.deny);
  assert.match(r.deny, /self-guard check broke/i);
  assert.ok(check.steps.pretool(ev('Bash', { command: 'echo hi' }), bad)?.deny, 'a shell step is refused too');
  assert.equal(check.steps.pretool(ev('Read', { file_path: '/x' }), bad), null, 'reading still works, so the break can be looked into');
  const p = check.steps.prompt({ session_id: 'e', prompt: 'x' }, bad);
  assert.match(p.say, /broke/i);
});
test('shape: the default export follows the contract', () => {
  assert.equal(check.id, 'self-guard');
  assert.equal(check.kind, 'safety');
  assert.equal(check.mode, 'refuse');
  for (const k of ['pretool', 'posttool', 'prompt', 'stop']) assert.equal(typeof check.steps[k], 'function');
  assert.ok(check.about && check.rule);
});
test('speed: a before-a-tool step on ordinary input takes under 50 ms', () => {
  const H = home();
  startRecord(H);
  const c = ctxFor(H);
  check.steps.prompt(prompt(H, 's1', 'warm'), c);
  const t0 = performance.now();
  for (let i = 0; i < 20; i++) check.steps.pretool(ev('Edit', { file_path: path.join(H.root, 'app', 'a.ts'), old_string: 'a', new_string: 'b' }), c);
  const ms = (performance.now() - t0) / 20;
  assert.ok(ms < 50, `took ${ms.toFixed(1)} ms`);
});
// The loader gives one step of one check 200 ms (core/checks/_lib/settings.json, stepMs); the step at the person’s message
// must stay inside it even with nothing in the cache. On some computers a first read of a new file can take 10
// ms or more (a virus scanner looks at new files), so the time limit on reading new files matters.
function skillFiles(H, n) {
  for (let i = 0; i < n; i++) {
    const body = `# skill ${i}\n` + 'x'.repeat(4000);
    H.w(path.join(H.root, 'core', 'skills', `s${i % 10}`, `f${i}.md`), body);
    H.w(path.join(H.claudeDir, 'skills', `s${i % 10}`, `f${i}.md`), body);
  }
}
test('speed: the step at the person’s message stays under the loader\'s 200 ms with no cache, and the comparison always moves on', () => {
  const H = home();
  skillFiles(H, 60); // today's notebook has 16 skill files
  startRecord(H, 'sp');
  H.w(path.join(H.claudeDir, 'skills', 's9', 'f59.md'), 'changed'); // the last file in the order
  const times = [];
  let st = {}, before = Infinity;
  for (let i = 0; i < 80; i++) {
    const t0 = performance.now();
    check.steps.prompt(prompt(H, 'sp', 'message ' + i), ctxFor(H));
    times.push(performance.now() - t0);
    st = JSON.parse(fs.readFileSync(path.join(H.state, 'self-guard', 'status.json'), 'utf8'));
    assert.ok(st.pending < before || st.pending === 0, 'each message compares at least one more pair');
    before = st.pending;
    if (!st.pending) break;
  }
  const sorted = times.slice().sort((a, b) => a - b), median = sorted[Math.floor(sorted.length / 2)];
  console.log(`# step at the person’s message: first ${times[0].toFixed(0)} ms (no cache), median ${median.toFixed(0)} ms, slowest ${sorted.at(-1).toFixed(0)} ms, ${times.length} messages to compare all`);
  // One file read can stall on some computers (a virus scanner), and a read cannot be cut short, so the slowest
  // message is printed, not held to the limit; the usual one must be well inside it.
  assert.ok(median < 200, `the usual message took ${median.toFixed(0)} ms`);
  const warm = performance.now();
  check.steps.prompt(prompt(H, 'sp', 'once all is in the cache'), ctxFor(H));
  assert.ok(performance.now() - warm < 200, 'with the cache full, a message is well inside the limit');
  assert.equal(st.pending, 0, 'everything compared in the end');
  assert.ok(st.differs.some((d) => /f59\.md$/.test(d.dst)), 'the planted difference in the last file is found');
});
test('speed: the full comparison at the start may take longer, and says its time', () => {
  const H = home();
  skillFiles(H, 300);
  H.w(path.join(H.claudeDir, 'skills', 's9', 'f299.md'), 'changed');
  const t0 = performance.now();
  const r = spawnSync(process.execPath, [CLI, 'start', '--home', H.h, '--root', H.root], { encoding: 'utf8' });
  console.log(`# full comparison at the start on 300 skill files: ${(performance.now() - t0).toFixed(0)} ms with the program's own start-up`);
  assert.equal(r.stdout.trim().split('\n').length, 1, 'one line');
  assert.match(r.stdout, /compared in \d+ ms/);
  assert.match(r.stdout, /1 installed copy of the checks is not the notebook's.*f299\.md/);
  const st = JSON.parse(fs.readFileSync(path.join(H.state, 'self-guard', 'status.json'), 'utf8'));
  assert.equal(st.pending, 0);
  // and the before-a-tool step holds from the very first step, with no message in between
  assert.ok(check.steps.pretool(ev('Edit', { file_path: path.join(H.root, 'app', 'a.ts'), old_string: 'a', new_string: 'b' }), ctxFor(H))?.deny);
});
test('known-good: the line for the start with nothing wrong says so, with its time', () => {
  const H = home();
  const r = spawnSync(process.execPath, [CLI, 'start', '--home', H.h, '--root', H.root], { encoding: 'utf8' });
  assert.match(r.stdout, /^Self-guard: all \d+ installed copies of the checks match the notebook \(compared in \d+ ms\); every hook the notebook expects is in the app's settings\.\s*$/);
  assert.equal(r.status, 0);
});
test('known-bad: a copy changed by one byte with its time stamp and size put back is still found by verify (the cache is not trusted there)', () => {
  const H = home();
  const dst = path.join(H.state, 'start.ps1');
  G.compareInstalled({ root: H.root, state: H.state, claudeDir: H.claudeDir }); // fills the cache
  const st = fs.statSync(dst);
  fs.writeFileSync(dst, '# stArt\n'); // one byte, same size
  fs.utimesSync(dst, st.atime, st.mtime);
  const r = spawnSync(process.execPath, [CLI, 'verify', '--home', H.h, '--root', H.root], { encoding: 'utf8' });
  assert.match(r.stdout, /FAIL: 1 of \d+ .*compared in \d+ ms/);
  assert.match(r.stdout, /start\.ps1: differs from the notebook/);
});

// ---------- the second roast, 2026-11-20 ----------
test('known-bad (roast 2, R18m): an edit written with plain line ends on a settings file with Windows ones is read, and its weakening found', () => {
  const before = '{\r\n  "mode": "refuse",\r\n  "who": "x"\r\n}\r\n';
  const after = G.textAfter('Edit', { old_string: '  "mode": "refuse",\n  "who"', new_string: '  "mode": "off",\n  "who"' }, before);
  assert.ok(after && after.includes('"off"'), 'the edit is applied as the app applies it');
  assert.match(G.weakens('check-settings', before, after, SETTINGS), /off/);
});
test('known-bad (roast 2): an edit of a guarded file whose old text is not there cannot be told, and counts as weakening', () => {
  const before = '{\r\n  "mode": "refuse"\r\n}\r\n';
  assert.equal(G.textAfter('Edit', { old_string: '"mode": "not there"', new_string: '"mode": "off"' }, before), null);
  assert.match(G.weakens('check-settings', before, null, SETTINGS), /cannot be known/);
});
test('known-good (roast 2): a stricter edit with plain line ends on a Windows file passes', () => {
  const before = '{\r\n  "mode": "notice",\r\n  "who": "x"\r\n}\r\n';
  const after = G.textAfter('Edit', { old_string: '  "mode": "notice",\n', new_string: '  "mode": "refuse",\n' }, before);
  assert.equal(G.weakens('check-settings', before, after, SETTINGS), '');
});
test('known-bad (roast 2, finding 1): the loader\'s records folder (<hive>/checks) is never taken for the installed copies', () => {
  assert.notEqual(SETTINGS.installedChecksDir, 'checks');
  const h = fs.mkdtempSync(path.join(os.tmpdir(), 'hive-selfguard-f1-'));
  try {
    const root = path.join(h, 'hive-mind'), state = path.join(h, '.claude', 'hive');
    fs.mkdirSync(path.join(root, 'core', 'checks', 'demo'), { recursive: true });
    fs.writeFileSync(path.join(root, 'core', 'checks', 'demo', 'check.mjs'), 'export default {}\n');
    fs.mkdirSync(path.join(state, 'checks', 'debts'), { recursive: true }); // what the loader makes at the first message
    for (const dir of ['checks', 'checks-installed', undefined]) {
      const pairs = G.installPairs(root, state, path.join(h, '.claude'), { ...SETTINGS, installedChecksDir: dir });
      assert.ok(!pairs.some((p) => /[\\/]hive[\\/]checks[\\/]/.test(p.dst)), 'no pair points into <hive>/checks (' + dir + ')');
    }
  } finally { fs.rmSync(h, { recursive: true, force: true }); }
});

// ---------- 2026-11-20, the faults seen live in the afternoon ----------
const shaOf = (s) => crypto.createHash('sha256').update(s).digest('hex');
test('live fault 3, known-good: a copy that differs only in line ends (or a byte-order mark), with the installer\'s record of its raw bytes, is the same', () => {
  const H = home();
  // The save hook and a skill file: the notebook has LF, the installed copy CRLF; the record holds the raw CRLF bytes.
  H.w(path.join(H.root, 'core', 'skills', 'hive-gates', 'SKILL.md'), '# gates skill\nline two\n');
  const dst = path.join(H.claudeDir, 'skills', 'hive-gates', 'SKILL.md');
  H.w(dst, '﻿# gates skill\r\nline two\r\n');
  H.w(path.join(H.state, 'install-record.json'), JSON.stringify({ files: { [dst]: { before: 'present', wrote: shaOf('﻿# gates skill\r\nline two\r\n') } } }));
  const r = G.compareInstalled({ root: H.root, state: H.state, claudeDir: H.claudeDir, fresh: true });
  assert.deepEqual(r.differs, [], JSON.stringify(r.differs));
  // A record written the installer's new way (wroteText, the text with line ends made the same) reads the same.
  H.w(path.join(H.state, 'install-record.json'), JSON.stringify({ files: { [dst]: { before: 'present', wrote: 'x', wroteText: G.textSha(Buffer.from('# gates skill\nline two\n')) } } }));
  assert.deepEqual(G.compareInstalled({ root: H.root, state: H.state, claudeDir: H.claudeDir, fresh: true }).differs, []);
});
test('live fault 3, the neighbour: a copy whose words changed is still found, whatever its line ends', () => {
  const H = home();
  const dst = path.join(H.claudeDir, 'skills', 'hive-gates', 'SKILL.md');
  H.w(dst, '# gates skill, softened\r\n');
  assert.equal(G.compareInstalled({ root: H.root, state: H.state, claudeDir: H.claudeDir, fresh: true }).differs.length, 1);
  H.w(dst, '# gates skill\r\n');
  H.w(path.join(H.state, 'install-record.json'), JSON.stringify({ files: { [dst]: { before: 'present', wrote: shaOf('# something else\n') } } }));
  // Back to the notebook's own words: level again, even though the install record names other bytes (the ruling of 2026-11-20).
  assert.deepEqual(G.compareInstalled({ root: H.root, state: H.state, claudeDir: H.claudeDir, fresh: true }).differs, []);
});

function lockedHome(bite) {
  const H = home();
  H.w(path.join(H.state, 'gates', 'gates.mjs'), '// gates, quietly changed\n');
  startRecord(H, 'L');
  const c = ctxFor(H, { settings: { ...SETTINGS, held: { ...SETTINGS.held, bite } } });
  check.steps.prompt(prompt(H, 'L', 'hello'), c);
  return { H, c };
}
const lockEv = (tool, input, extra = {}) => ({ ...ev(tool, input, 'L'), ...extra });
test('live fault 4, strict (today\'s, the default): every step but reading is refused, the steps that look or fix still run', () => {
  assert.equal(SETTINGS.held.bite, 'strict', 'the default is the strict lock until the person answers');
  const { H, c } = lockedHome('strict');
  assert.ok(check.steps.pretool(lockEv('Write', { file_path: path.join(H.root, 'notes.md'), content: 'x' }), c)?.deny);
  assert.ok(check.steps.pretool(lockEv('Write', { file_path: path.join(H.root, '.claude', 'worktrees', 'w1', 'a.md'), content: 'x' }, { agent_id: 'h1' }), c)?.deny, 'strict: a helper in its own copy waits too');
  for (const cmd of ['node core/install/install.mjs install --dry-run', 'node core/install/install.mjs --help', 'node core/install/install.mjs', 'node core/checks/self-guard/cli.mjs verify', 'git status']) {
    assert.equal(check.steps.pretool(lockEv('Bash', { command: cmd }), c), null, `never frozen: ${cmd}`);
  }
  const c2 = ctxFor(H, { settings: c.settings, hisLast: 'reinstall the gates' });
  assert.equal(check.steps.pretool(lockEv('Bash', { command: 'node core/install/install.mjs install' }), c2), null, "the fix on the person's word runs");
});
test('live fault 4, narrow (only on the word of the person): ordinary work and a helper in its own copy go on; the acts that matter are refused', () => {
  const { H, c } = lockedHome('narrow');
  assert.equal(check.steps.pretool(lockEv('Write', { file_path: path.join(H.root, 'notes.md'), content: 'x' }), c), null, 'ordinary work');
  assert.equal(check.steps.pretool(lockEv('Edit', { file_path: path.join(H.root, '.claude', 'worktrees', 'w1', 'app', 'a.ts'), old_string: 'a', new_string: 'b' }, { agent_id: 'h1' }), c), null, 'a helper in its own copy');
  assert.equal(check.steps.pretool(lockEv('Bash', { command: 'node --test core/checks/_lib/' }), c), null, 'tests');
  for (const [tool, input] of [
    ['Bash', { command: 'vercel --prod' }], ['Bash', { command: 'git push origin main' }], ['Bash', { command: 'rm -rf old' }], ['PowerShell', { command: 'Remove-Item old -Recurse' }],
    ['Bash', { command: 'npm install left-pad' }], ['Bash', { command: 'npx some-tool' }], ['Write', { file_path: path.join(H.root, 'core', 'checks', 'proof', 'check.mjs'), content: 'x' }],
    ['Write', { file_path: path.join(H.state, 'gates', 'gates.mjs'), content: 'x' }], ['mcp__vercel__deploy_to_vercel', {}], ['mcp__shop__buy_domain', {}],
  ]) assert.ok(check.steps.pretool(lockEv(tool, input), c)?.deny, `refused while locked: ${tool} ${JSON.stringify(input).slice(0, 60)}`);
  assert.equal(check.steps.pretool(lockEv('mcp__github__get_file_contents', {}), c), null, 'a connector that only reads');
});
test('live fault 4: turning the lock from strict to narrow is a weakening (it needs the words of the person); back to strict is not', () => {
  const H = home();
  const f = path.join(H.root, 'core', 'checks', 'self-guard', 'settings.json');
  H.w(f, JSON.stringify(SETTINGS, null, 2));
  const narrow = JSON.stringify({ ...SETTINGS, held: { ...SETTINGS.held, bite: 'narrow' } }, null, 2);
  const r = check.steps.pretool(ev('Write', { file_path: f, content: narrow }), ctxFor(H, { hisLast: 'ok' }));
  assert.ok(r && r.deny && /strict/.test(r.deny), r && r.deny);
  H.w(f, narrow);
  assert.equal(check.steps.pretool(ev('Write', { file_path: f, content: JSON.stringify(SETTINGS, null, 2) }), ctxFor(H)), null);
});
test('live fault 8: only a step that RUNS the installer counts; a made-up home under the temp folder is let through; the real home still needs the words of the person', () => {
  const H = home();
  const c = ctxFor(H, { hisLast: 'look at the files' });
  const tmpHome = path.join(os.tmpdir(), 'hive-walk-home');
  for (const cmd of ['cat core/install/install.mjs', 'grep -n parseArgs core/install/install.mjs', 'echo "run core/install/install.mjs install later" > notes.md', 'node core/install/install.mjs', 'node core/install/install.mjs --help',
    `node core/install/install.mjs install --home "${tmpHome}" --claude-dir "${path.join(tmpHome, '.claude')}"`, `sh core/install/install.sh install --claude-dir "${path.join(tmpHome, '.claude')}"`]) {
    const r = check.steps.pretool(ev('Bash', { command: cmd }), c);
    assert.ok(!r || !/running the installer/.test(r.deny || ''), `not running the installer: ${cmd}`);
  }
  for (const cmd of ['node core/install/install.mjs install', `node core/install/install.mjs install --claude-dir "${H.claudeDir}"`, 'node core/install/install.mjs uninstall', 'sh core/install/install.sh install', 'powershell -NoProfile -File core/gates/install.ps1']) {
    assert.match(check.steps.pretool(ev('Bash', { command: cmd }), c)?.deny || '', /installer/, `the real install still needs the person's words: ${cmd}`);
  }
});
test('live fault 10, the canary: a helper\'s report or a notice is not a new turn, and a message that came mid-reply is judged one message later', () => {
  const H = home();
  startRecord(H, 'cn');
  const own = ctxFor(H), notHis = ctxFor(H, { hisNow: false });
  check.steps.prompt(prompt(H, 'cn', 'first'), own);
  check.steps.pretool(ev('Bash', { command: 'git status' }, 'cn'), own);
  // Three helpers report back while the reply is still being written: no false alarm.
  for (let i = 0; i < 3; i++) { const r = check.steps.prompt(prompt(H, 'cn', '<task-notification>done</task-notification>'), notHis); assert.ok(!r || !/did not fire/.test(r.say || ''), r && r.say); }
  // He writes while the reply is still going (a tool ran a moment ago): not said now...
  let r = check.steps.prompt(prompt(H, 'cn', 'and also this'), own);
  assert.ok(!r || !/end-of-reply hook did not fire/.test(r.say || ''), r && r.say);
  check.steps.stop({ session_id: 'cn', text: 'ok' }, own);
  r = check.steps.prompt(prompt(H, 'cn', 'next'), own);
  assert.ok(!r || !/end-of-reply hook did not fire/.test(r.say || ''), '...and the end came, so nothing is said');
  // A turn of reads only: the after-tool step watches Read, the before-tool step does not; no false alarm.
  check.steps.posttool({ session_id: 'cn', tool_name: 'Read', tool_input: {} }, own);
  check.steps.stop({ session_id: 'cn', text: 'read' }, own);
  r = check.steps.prompt(prompt(H, 'cn', 'again'), own);
  assert.ok(!r || !/did not fire/.test(r.say || ''), r && r.say);
});
test('live fault 10, the neighbour: an end-of-reply step that never comes is still said, at the latest one message later', () => {
  const H = home();
  startRecord(H, 'cb');
  const own = ctxFor(H);
  check.steps.prompt(prompt(H, 'cb', 'first'), own);
  check.steps.pretool(ev('Bash', { command: 'git status' }, 'cb'), own);
  const r1 = check.steps.prompt(prompt(H, 'cb', 'second'), own);
  const r2 = check.steps.prompt(prompt(H, 'cb', 'third'), own);
  assert.ok([r1, r2].some((r) => r && /end-of-reply hook did not fire/.test(r.say || '')), 'said');
});

// The person's own phrases from the manuals (docs/first-hour.md, docs/when-it-breaks.md, docs/plugin.md): their own repair
// is never refused, and "don't ..." in front still refuses (2026-11-20, the newcomer's walk).
test('live fault 9: every phrase the manuals tell the person to say for an install or an undo is accepted for what it asks', () => {
  const H = home();
  const cases = [
    ['add the small parts', 'node core/install/install.mjs install'],
    ['add the small parts again', 'node core/install/install.mjs install'],
    ['undo the Hive Mind setup', 'node core/install/install.mjs uninstall'],
    ['clear what Hive Mind left on this computer', 'node core/install/install.mjs clear'],
    ['Set up my Hive Mind', 'node core/install/install.mjs install'],
    ['remove the gates', 'node core/install/install.mjs remove-gates'],
  ];
  for (const [said, cmd] of cases) {
    assert.equal(check.steps.pretool(ev('Bash', { command: cmd }), ctxFor(H, { hisLast: said })), null, 'accepted: ' + said);
    assert.ok(check.steps.pretool(ev('Bash', { command: cmd }), ctxFor(H, { hisLast: "don't " + said }))?.deny, 'refused: don\'t ' + said);
    assert.ok(check.steps.pretool(ev('Bash', { command: cmd }), ctxFor(H, { hisLast: 'what is the weather' }))?.deny, 'refused without the words: ' + cmd);
  }
  // Every phrase of the manuals that names an install or an undo is in the list of install words.
  for (const doc of ['first-hour.md', 'when-it-breaks.md', 'plugin.md', 'parts.md']) {
    let t = ''; try { t = fs.readFileSync(path.join(HERE, '..', '..', '..', 'docs', doc), 'utf8'); } catch { continue; }
    for (const m of t.matchAll(/[Ss]ay "([^"]+)"/g)) {
      const p = m[1].toLowerCase();
      if (!/\b(small parts|undo the hive mind setup|clear what hive mind left|set up my hive mind|remove the gates)\b/.test(p)) continue;
      assert.ok(G.saidAny({ hisLast: p }, SETTINGS.installWords), 'the manual\'s phrase is accepted: ' + p);
    }
  }
});
