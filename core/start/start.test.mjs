// Proof for the Node start step (start.mjs) and its thin PowerShell caller (start.ps1).
//   node --test core/start/start.test.mjs
// Everything runs in a fresh temporary folder with a made-up home folder; the real home folder is never read or written.
// The notebook sits at a path with a space in it, and HIVE_ROOT is unset: the start must find the notebook from
// <hive folder>/config.json, the way a person's computer will.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STARTER = path.resolve(HERE, '..', '..');
const MJS = path.join(HERE, 'start.mjs');
const PS1 = path.join(HERE, 'start.ps1');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'hive-start-test-'));
process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {} });

const put = (p, text) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); };
const RULES = fs.readFileSync(path.join(STARTER, 'system', 'rules.md'), 'utf8');
const STATE_NOTE = (name, stage, extra = '') => `---\nproject: ${name}\nkind: personal\nfolder: ~/${name.toLowerCase()}\norder: 1\nstage: ${stage}\nhealth: good\nnext_step: Do the next thing.\nneeds_you: nothing\nupdated: 2026-11-19\n${extra}---\nBody\n`;

// A made-up home with a notebook at "My Notes/hive mind" (spaces), found only through config.json.
function makeHome(name, { config = true, profile = true } = {}) {
  const home = path.join(TMP, name, 'home dir');
  const nb = path.join(TMP, name, 'My Notes', 'hive mind');
  put(path.join(nb, 'system', 'rules.md'), RULES);
  put(path.join(nb, 'system', 'start-here.md'), '# Start here\n\n## Exact next step\n\nSave your notes.\n');
  put(path.join(nb, 'system', 'in-flight.md'), '# In flight\nUpdated: 2026-11-19\n\n## PINNED\n- Keep going.\n\n## Other\n- Later.\n');
  put(path.join(nb, 'system', 'places-and-sets.md'), '# Places\n\n## Places\n\n- Today: x.\n- Life: y.\n\n## Sets\n\n- Daily brief: off\n');
  put(path.join(nb, 'projects', 'garden', 'state.md'), STATE_NOTE('Garden', 'build (round 1)'));
  if (profile) put(path.join(nb, 'me', 'profile.md'), '# About you\n\nCall them: Maya\nAlways call me by my first name.\n');
  if (config) put(path.join(home, '.claude', 'hive', 'config.json'), JSON.stringify({ root: nb }));
  return { home, nb };
}
function envFor(home, extra = {}) {
  const e = { ...process.env, HIVE_HOME: home, HOME: home, USERPROFILE: home, ...extra };
  for (const k of ['HIVE_ROOT', 'HIVE_STATE', 'HIVE_CLAUDE', 'HIVE_IN_SELFTEST', 'HIVE_SELFTEST_FORCE', 'CLAUDE_CODE_BRIDGE_SESSION_ID']) if (!(k in extra)) delete e[k];
  return e;
}
const probe = (cwd, source = 'startup', sid = '') => JSON.stringify({ session_id: sid, cwd, source, hook_event_name: 'SessionStart' });
function run(args, input, env) {
  const r = spawnSync(process.execPath, [MJS, ...args], { input, env, encoding: 'utf8', timeout: 60000 });
  let json = null; try { json = JSON.parse(r.stdout); } catch {}
  return { code: r.status, out: r.stdout, err: r.stderr, json, ctx: (json && json.hookSpecificOutput && json.hookSpecificOutput.additionalContext) || '', banner: (json && json.systemMessage) || '' };
}
const ruleLines = RULES.split(/\r?\n/).filter((l) => /^\d+\.\s/.test(l));

test('finds a notebook with a space in its path from config.json, HIVE_ROOT unset; every part under the cap', () => {
  const { home, nb } = makeHome('a');
  for (const part of ['rules', 'state', 'flight', 'all']) {
    const r = run(['--part', part, '--no-refresh'], probe(nb), envFor(home));
    assert.equal(r.code, 0);
    assert.ok(r.ctx.length > 0 && r.ctx.length <= 8000, `${part}: ${r.ctx.length} characters`);
    assert.ok(!/was not found/.test(r.ctx), `${part} did not find the notebook`);
  }
  const all = run(['--part', 'all', '--no-refresh'], probe(nb), envFor(home));
  assert.ok(all.ctx.length <= 8000);
  for (const l of ruleLines) assert.ok(all.ctx.includes(l.trim()), 'a rule is missing: ' + l.slice(0, 40));
  assert.match(all.ctx, /Garden/);
  assert.match(all.ctx, /Maya/);
  assert.match(all.ctx, /Your places: Today, Life\./);
});

test('without config.json it falls back to hive-mind in the home folder', () => {
  const { home, nb } = makeHome('b', { config: false });
  const fallback = path.join(home, 'hive-mind');
  fs.cpSync(nb, fallback, { recursive: true });
  const r = run(['--part', 'rules', '--no-refresh'], probe(fallback), envFor(home));
  assert.ok(ruleLines.every((l) => r.ctx.includes(l.trim())));
});

test('config.json also accepts a ~ path and the old key name "notebook"', () => {
  const { home, nb } = makeHome('c', { config: false });
  fs.cpSync(nb, path.join(home, 'mine'), { recursive: true });
  put(path.join(home, '.claude', 'hive', 'config.json'), JSON.stringify({ notebook: '~/mine' }));
  const r = run(['--part', 'rules', '--no-refresh'], probe(home), envFor(home));
  assert.ok(ruleLines.every((l) => r.ctx.includes(l.trim())));
});

test('HIVE_ROOT wins over config.json', () => {
  const a = makeHome('d1'), b = makeHome('d2');
  put(path.join(b.nb, 'projects', 'shop', 'state.md'), STATE_NOTE('Shop', 'build'));
  const r = run(['--part', 'state', '--no-refresh'], probe(b.nb), envFor(a.home, { HIVE_ROOT: b.nb }));
  assert.match(r.ctx, /Shop/);
});

test('no notebook anywhere: a plain red message that says where the place is written', () => {
  const home = path.join(TMP, 'e', 'home');
  fs.mkdirSync(home, { recursive: true });
  const r = run(['--part', 'rules', '--no-refresh'], probe(home), envFor(home));
  assert.match(r.ctx, /HIVE MIND START: RED/);
  assert.match(r.ctx, /config\.json/);
  assert.match(r.banner, /not found/);
  const s = run(['--part', 'state', '--no-refresh'], probe(home), envFor(home));
  assert.equal(s.out.trim(), '');
});

test('the old spellings -Part and -NoRefresh still work', () => {
  const { home, nb } = makeHome('f');
  const r = run(['-Part', 'rules', '-NoRefresh'], probe(nb), envFor(home));
  assert.ok(r.ctx.startsWith('HIVE MIND START, part 1 of 3'));
});

test('no profile yet: the first reply offers the set-up; with a profile it asks for the progress map', () => {
  const none = makeHome('g1', { profile: false });
  const r1 = run(['--part', 'rules', '--no-refresh'], probe(none.nb), envFor(none.home));
  assert.match(r1.ctx, /not set up yet/);
  assert.match(r1.banner, /Not set up yet/);
  const done = makeHome('g2');
  const r2 = run(['--part', 'rules', '--no-refresh'], probe(done.nb), envFor(done.home));
  assert.match(r2.ctx, /Open with the progress map/);
  assert.doesNotMatch(r2.ctx, /not set up yet/);
});

test('only the three most active projects get a line (newest "updated:" first); one short line points to the rest', () => {
  const { home, nb } = makeHome('top3');
  const days = ['2026-11-01', '2026-11-20', '2026-11-05', '2026-11-18', '2026-11-10', '2026-11-19'];
  days.forEach((d, i) => put(path.join(nb, 'projects', `p${i}`, 'state.md'), STATE_NOTE(`Proj${i}`, 'build (round 1)').replace('updated: 2026-11-19', `updated: ${d}`)));
  put(path.join(nb, 'projects', 'garden', 'state.md'), STATE_NOTE('Garden', 'build (round 1)').replace('updated: 2026-11-19', 'updated: 2026-10-01'));
  put(path.join(nb, 'projects', 'old', 'state.md'), STATE_NOTE('Sleepy', 'paused (for now)'));
  const r = run(['--part', 'state'], probe(nb), envFor(home));
  const section = r.ctx.split('## Projects')[1].split('\n## ')[0];
  const projLines = section.split('\n').filter((l) => /^- Proj\d: /.test(l)).map((l) => l.slice(2, 7));
  assert.deepEqual(projLines, ['Proj1', 'Proj5', 'Proj3'], section);
  assert.match(section, /^- 5 more \(1 paused or not set up\): projects\/<name>\/state\.md$/m, section);
  assert.equal(section.split('\n').filter((l) => l.startsWith('- ')).length, 4, 'three project lines and one pointer line');
  assert.doesNotMatch(section, /Health: good/, 'a good health says nothing');
  // The cloud form lists the same three and the same pointer (when this machine has sh).
  const sh = spawnSync('sh', ['-c', 'echo ok'], { encoding: 'utf8' });
  if (sh.status !== 0) return;
  const cl = spawnSync('sh', [path.join(HERE, 'start-cloud.sh'), 'state'], { env: { ...process.env, HIVE_FORCE_CLOUD: '1', HIVE_ROOT: nb }, encoding: 'utf8' }).stdout.replace(/\r/g, '');
  const cs = cl.split('## Projects')[1].split('\n## ')[0];
  assert.deepEqual(cs.split('\n').filter((l) => /^- Proj\d /.test(l)).map((l) => l.slice(2, 7)), ['Proj1', 'Proj5', 'Proj3'], cs);
  assert.match(cs, /^- 5 more: projects\/<name>\/state\.md$/m, cs);
});

test('a chat inside a project gets that project; a notebook not linked to GitHub is said calmly', () => {
  const { home, nb } = makeHome('h');
  const r = run(['--part', 'state'], probe(path.join(home, 'garden')), envFor(home));
  assert.match(r.ctx, /This session is in the project: garden/);
  assert.match(r.ctx, /next_step: Do the next thing\./);
  const rules = run(['--part', 'rules'], probe(nb), envFor(home));
  assert.match(rules.banner, /Notes kept on this computer/);
});

test('oversized notes are shortened on purpose, with a pointer, and the whole stays within 8,000', () => {
  const { home, nb } = makeHome('i');
  put(path.join(nb, 'system', 'start-here.md'), '# Start here\n' + Array.from({ length: 400 }, (_, i) => `- Line ${i}: the work stands here. More words follow.`).join('\n'));
  put(path.join(nb, 'system', 'in-flight.md'), '# In flight\n- ' + 'One very long sentence about the work in flight. '.repeat(900));
  put(path.join(nb, 'inbox', 'answers.md'), Array.from({ length: 30 }, (_, i) => `- [ ] Answer ${i}: ` + 'yes '.repeat(200)).join('\n'));
  put(path.join(nb, 'me', 'profile.md'), '# About you\n\n' + Array.from({ length: 60 }, (_, i) => `Line ${i}: ` + 'a note about me. '.repeat(4)).join('\n'));
  for (const part of ['state', 'flight', 'all']) {
    const r = run(['--part', part, '--no-refresh'], probe(nb), envFor(home));
    assert.ok(r.ctx.length > 0 && r.ctx.length <= 8000, `${part}: ${r.ctx.length}`);
    assert.match(r.ctx, /read the rest in [^\]]+\]\s*$/, `${part} ends with a pointer`);
  }
  const s = run(['--part', 'state', '--no-refresh'], probe(nb), envFor(home));
  assert.ok(s.ctx.length <= 2400);
  assert.ok(run(['--part', 'flight', '--no-refresh'], probe(nb), envFor(home)).ctx.length <= 850);
});

test('notes saved with Windows line endings are read the same', () => {
  const { home, nb } = makeHome('j');
  put(path.join(nb, 'me', 'profile.md'), '# About you\r\n\r\nCall them: Maya\r\nAlways call me by my first name.\r\n');
  const r = run(['--part', 'state', '--no-refresh'], probe(nb), envFor(home));
  assert.match(r.ctx, /Maya/);
  assert.ok(!r.ctx.includes('\r'));
});

test('writes this chat\'s start record; a compacted chat says so and clears its design record', () => {
  const { home, nb } = makeHome('k');
  const gdir = path.join(home, '.claude', 'hive', 'gates');
  put(path.join(gdir, 'rec', 'sess-1.json'), '{}');
  put(path.join(gdir, 'rec', 'sess-1__agent9.json'), '{}');
  const r = run(['--part', 'rules', '--no-refresh'], probe(nb, 'compact', 'sess-1'), envFor(home));
  assert.match(r.ctx, /just shortened \(compacted\)/);
  assert.ok(fs.existsSync(path.join(gdir, 'start', 'sess-1.json')));
  assert.ok(!fs.existsSync(path.join(gdir, 'rec', 'sess-1.json')) && !fs.existsSync(path.join(gdir, 'rec', 'sess-1__agent9.json')));
});

test('another chat on the same project is noticed', () => {
  const { home, nb } = makeHome('l');
  const cwd = path.join(home, 'garden');
  run(['--part', 'rules', '--no-refresh'], probe(cwd, 'startup', 'chat-one'), envFor(home));
  const r = run(['--part', 'rules', '--no-refresh'], probe(cwd, 'startup', 'chat-two'), envFor(home));
  assert.match(r.ctx, /another chat is open on this project/);
});

test('a stale start entry in the Claude settings is noticed', () => {
  const { home, nb } = makeHome('m');
  put(path.join(home, '.claude', 'settings.json'), JSON.stringify({ hooks: {} }));
  const r = run(['--part', 'rules', '--no-refresh'], probe(nb), envFor(home));
  assert.match(r.ctx, /not connected in the Claude settings/);
});

test('the Node snippet starts the three parts with node and keeps the gates entries', () => {
  const s = JSON.parse(fs.readFileSync(path.join(HERE, 'settings-snippet.node.json'), 'utf8'));
  const parts = s.hooks.SessionStart.map((e) => e.hooks[0].args.join(' '));
  assert.deepEqual(parts.map((p) => p.replace(/^\S+\s/, '')), ['-Part rules', '-Part state', '-Part flight']);
  assert.ok(s.hooks.SessionStart.every((e) => e.hooks[0].command === '__NODE__' && !e.hooks[0].shell));
  for (const ev of ['PreToolUse', 'PostToolUse', 'UserPromptSubmit', 'Stop', 'PreCompact']) assert.ok(JSON.stringify(s.hooks[ev]).includes('gates.mjs'), ev);
  // the same entry, filled in and run exactly as Claude Code would run it (exec form, no shell)
  const { home, nb } = makeHome('n');
  const entry = JSON.parse(JSON.stringify(s.hooks.SessionStart[0].hooks[0]).replace('__NODE__', process.execPath.replace(/\\/g, '\\\\')).replace('__HIVE__', path.dirname(MJS).replace(/\\/g, '/')));
  const r = spawnSync(entry.command, entry.args, { input: probe(nb), env: envFor(home), encoding: 'utf8' });
  assert.match(JSON.parse(r.stdout).hookSpecificOutput.additionalContext, /^HIVE MIND START, part 1 of 3/);
});

test('start.ps1 is a thin caller: same text as start.mjs for the same notebook (when PowerShell is here)', (t) => {
  const probeShell = spawnSync('powershell', ['-NoProfile', '-Command', 'echo ok'], { encoding: 'utf8' });
  if (probeShell.status !== 0) return t.skip('no PowerShell on this computer');
  const { home, nb } = makeHome('o');
  const env = envFor(home);
  for (const part of ['rules', 'state', 'flight', 'all']) {
    const viaPs = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', PS1, '-Part', part, '-NoRefresh'], { input: probe(nb), env, encoding: 'utf8', timeout: 60000 });
    const viaNode = run(['--part', part, '--no-refresh'], probe(nb), env);
    assert.equal(JSON.parse(viaPs.stdout).hookSpecificOutput.additionalContext, viaNode.ctx, part);
  }
});

// ---------- your standing wishes (in step with the main system, 2026-11-20) ----------
// The known-bad case: before, a crowded part 2 could leave the wishes out, and the rules and habits you added through
// the registry never arrived at all.
const wishBlock = (ctx) => { const m = String(ctx).match(/## Your standing wishes[^\n]*\n[^\n]*\n((?:- [^\n]*\n?)*)/); return m ? m[1].split('\n').filter((l) => l.startsWith('- ')) : []; };
const OWN_REG = JSON.stringify({ version: 1, entries: [
  { id: 'rule-1', kind: 'protocol', state: 'active', enforce: 'x', text: 'A numbered rule that part 1 already carries.' },
  { id: 'question-cards', kind: 'protocol', state: 'active', enforce: null, text: 'A question for me is asked on a question card, never buried in a paragraph.' },
  { id: 'old-habit', kind: 'preference', state: 'removed', text: 'A habit that was taken out and must not arrive.' },
  { id: 'plain-speech', kind: 'preference', state: 'active', text: 'Speak plainly: everyday words, short sentences, no jargon.' },
] });
const PREFS = '# Standing wishes\n\nThe home for your standing wishes.\n\n- default, not confirmed yet: Speak plainly: everyday words, short sentences, no jargon.\n- 2026-11-20: Call the garden project "the garden". Your words: "' + 'a long quote of my own words '.repeat(8) + '"\n';

test('your standing wishes: the preferences note and your own rules arrive, never the heading alone', async () => {
  const { aboutBlock, HEAD } = await import('./about.mjs');
  const { home, nb } = makeHome('w1');
  put(path.join(nb, 'system', 'preferences.md'), PREFS);
  put(path.join(nb, 'system', 'registry.json'), OWN_REG);
  const t = aboutBlock({ root: nb, budget: 1000 });
  assert.ok(t.startsWith(HEAD));
  assert.match(t, /question card/, 'a rule you added through the registry arrives');
  assert.match(t, /Call the garden project/);
  assert.doesNotMatch(t, /Your words:/, 'the quote stays in the note');
  assert.doesNotMatch(t, /numbered rule|taken out/, 'numbered rules and removed habits are left out');
  assert.equal((t.match(/Speak plainly/g) || []).length, 1, 'a habit that repeats a wish is said once');
  assert.equal(aboutBlock({ root: makeHome('w2').nb }), '', 'no wish anywhere gives nothing at all');
  const r = run(['--part', 'state', '--no-refresh'], probe(nb), envFor(home));
  assert.ok(wishBlock(r.ctx).length >= 3, r.ctx.slice(0, 500));
});

test('your standing wishes, known-bad: a crowded part 2 still carries them, in whole lines, under its cap', () => {
  const { home, nb } = makeHome('w3');
  put(path.join(nb, 'system', 'preferences.md'), PREFS + Array.from({ length: 30 }, (_, i) => `- 2026-11-20: Wish number ${i}, with enough words to take some room in the start message.`).join('\n') + '\n');
  put(path.join(nb, 'system', 'registry.json'), OWN_REG);
  put(path.join(nb, 'system', 'start-here.md'), '# Start here\n' + Array.from({ length: 400 }, (_, i) => `- Line ${i}: the work stands here. More words follow.`).join('\n'));
  put(path.join(nb, 'inbox', 'answers.md'), Array.from({ length: 30 }, (_, i) => `- [ ] Answer ${i}: ` + 'yes '.repeat(200)).join('\n'));
  put(path.join(nb, 'me', 'profile.md'), '# About you\n\n' + Array.from({ length: 60 }, (_, i) => `Line ${i}: ` + 'a note about me. '.repeat(4)).join('\n'));
  for (let i = 0; i < 8; i++) put(path.join(nb, 'projects', `p${i}`, 'state.md'), STATE_NOTE(`Project${i}`, 'build', 'needs_you: ' + 'a long thing '.repeat(10) + '\n'));
  const r = run(['--part', 'state', '--no-refresh'], probe(nb), envFor(home));
  assert.ok(r.ctx.length <= 2400, `${r.ctx.length} characters`);
  const ls = wishBlock(r.ctx);
  assert.ok(ls.length >= 1, 'the wishes are not left out');
  assert.ok(ls.every((l) => !/\.\.\.$/.test(l) || l.length <= 135), 'each line is whole or cut at a word');
  assert.match(r.ctx, /\[more wishes: [^\]]+\]/, 'it says where the rest is');
  const all = run(['--part', 'all', '--no-refresh'], probe(nb), envFor(home));
  assert.ok(all.ctx.length <= 8000 && wishBlock(all.ctx).length >= 1, 'one part only (older settings): still there');
});

// ---------- a question that must be asked at once opens part 3, in every chat ----------
test('part 3: a question for you that must be asked at once comes first, word for word, even in a project chat', () => {
  const { home, nb } = makeHome('q1');
  put(path.join(nb, 'system', 'questions.json'), '{}');
  // a made-up questions program that answers "check" as the real one does
  put(path.join(nb, 'core', 'engine', 'questions.mjs'), "if (process.argv[2]==='check'){console.log('OK|sorted');console.log('NEEDS|NEEDS YOU: [q-1] \"Keep the blue?\" is kind A');process.exit(1)}");
  for (const cwd of [nb, path.join(home, 'garden')]) {
    const r = run(['--part', 'flight', '--no-refresh'], probe(cwd), envFor(home));
    assert.match(r.ctx, /Ask these now, before anything else/);
    assert.match(r.ctx, /NEEDS YOU: \[q-1\] "Keep the blue\?"/);
    assert.ok(r.ctx.length <= 850);
  }
  const quiet = makeHome('q2');
  const r2 = run(['--part', 'flight', '--no-refresh'], probe(quiet.nb), envFor(quiet.home));
  assert.doesNotMatch(r2.ctx, /Ask these now/, 'no question waiting: nothing is added');
});

// ---------- the hooks list (both forms) and the merge ----------
const SNIPS = ['settings-snippet.json', 'settings-snippet.node.json'].map((f) => [f, JSON.parse(fs.readFileSync(path.join(HERE, f), 'utf8'))]);
test('the hooks list, both forms: helper tools and the question card after a tool, a failed command, a stopped helper, every tool before', () => {
  for (const [f, s] of SNIPS) {
    const after = s.hooks.PostToolUse.map((e) => e.matcher).join('|').split('|');
    for (const t of ['Read', 'Skill', 'Bash', 'Agent', 'Task', 'SubagentHandback', 'AskUserQuestion']) assert.ok(after.includes(t), `${f}: after a tool, ${t}`);
    const fail = s.hooks.PostToolUseFailure;
    assert.equal(fail.length, 1, f);
    assert.deepEqual(fail[0].matcher.split('|').sort(), ['Bash', 'Edit', 'MultiEdit', 'NotebookEdit', 'PowerShell', 'Write'], f);
    assert.deepEqual(fail[0].hooks[0].args, ['__HIVE__/gates/gates.mjs', 'posttoolfailure'], f);
    assert.deepEqual(s.hooks.SubagentStop[0].hooks[0].args, ['__HIVE__/gates/gates.mjs', 'subagentstop'], f);
    assert.deepEqual(s.hooks.PreToolUse.map((e) => e.matcher), ['*'], `${f}: one before-tool entry, for every tool`);
  }
});
const MERGE = path.join(STARTER, 'core', 'gates', 'settings-merge.mjs');
function roundTrip(own, snippetFile) {
  const dir = path.join(TMP, 'merge-' + Math.random().toString(36).slice(2));
  const f = path.join(dir, 'settings.json');
  const before = own === null ? null : JSON.stringify(own, null, 2) + '\n';
  if (before !== null) put(f, before); else fs.mkdirSync(dir, { recursive: true });
  const merged = spawnSync(process.execPath, [MERGE, 'merge', f, path.join(HERE, snippetFile), 'C:\\Program Files\\nodejs\\node.exe', 'C:\\made up\\.claude\\hive'], { encoding: 'utf8' }).stdout;
  assert.match(merged, /posttoolfailure/);
  put(f, merged);
  const back = spawnSync(process.execPath, [MERGE, 'unmerge', f, '--all'], { encoding: 'utf8' }).stdout;
  return { before, back };
}
test('merge then unmerge gives your settings file back identical (both forms of the hooks list)', () => {
  for (const [f] of SNIPS) {
    const mine = { theme: 'auto', hooks: { PostToolUse: [{ matcher: 'Edit', hooks: [{ type: 'command', command: 'echo mine' }] }], Notification: [] }, enabledPlugins: { x: true } };
    let { before, back } = roundTrip(mine, f);
    assert.equal(back, before, `${f}: own hooks and an empty event of your own`);
    ({ before, back } = roundTrip({ theme: 'dark', model: 'opus' }, f));
    assert.equal(back, before, `${f}: known-bad case, settings with no hooks at all stay without them`);
  }
});
test('the merge program: the installer still gets a "hooks" object; an empty event of your own stays', async () => {
  const { unmerge, merge } = await import('../gates/settings-merge.mjs');
  assert.deepEqual(unmerge({ theme: 'x' }, false), { theme: 'x', hooks: {} });
  assert.deepEqual(unmerge({ hooks: { Stop: [] } }, false), { hooks: { Stop: [] } });
  const m = merge({ theme: 'x' }, SNIPS[1][1], 'node', '/h');
  assert.ok(m.hooks.SubagentStop && m.hooks.PostToolUseFailure && m.hooks.PreToolUse.length === 1);
  const back = unmerge(m, true);
  assert.match(JSON.stringify(back.hooks.SessionStart), /-ExecutionPolicy Bypass/, 'the one older start entry comes back the way this copy starts it');
});

test('known-bad from the walk: settings written as the installer writes them (one argument per line) are not called "not connected"', async () => {
  const { merge } = await import('../gates/settings-merge.mjs');
  const { home, nb } = makeHome('m3');
  const m = merge({ theme: 'dark' }, JSON.parse(fs.readFileSync(path.join(HERE, 'settings-snippet.node.json'), 'utf8')), 'C:\\Program Files\\nodejs\\node.exe', path.join(home, '.claude', 'hive').replace(/\\/g, '/'));
  put(path.join(home, '.claude', 'settings.json'), JSON.stringify(m, null, 2) + '\n');
  const r = run(['--part', 'rules', '--no-refresh'], probe(nb), envFor(home));
  assert.doesNotMatch(r.ctx, /not connected in the Claude settings/, r.ctx.split('\n').filter((l) => /NOTICE/.test(l)).join('\n'));
  // and a part really missing is still said, in the same spread-out form
  m.hooks.SessionStart = m.hooks.SessionStart.slice(0, 2);
  put(path.join(home, '.claude', 'settings.json'), JSON.stringify(m, null, 2) + '\n');
  assert.match(run(['--part', 'rules', '--no-refresh'], probe(nb), envFor(home)).ctx, /not connected in the Claude settings: start part 'flight'/);
});

test('a settings file without the stopped-helper step or the helper tools is noticed', () => {
  const { home, nb } = makeHome('m2');
  const s = JSON.parse(fs.readFileSync(path.join(HERE, 'settings-snippet.node.json'), 'utf8'));
  delete s.hooks.SubagentStop;
  s.hooks.PostToolUse[0].matcher = 'Read|Skill|Write|Edit|MultiEdit|NotebookEdit|Bash|PowerShell';
  put(path.join(home, '.claude', 'settings.json'), JSON.stringify(s));
  const r = run(['--part', 'rules', '--no-refresh'], probe(nb), envFor(home));
  assert.match(r.ctx, /gate 'subagentstop'/);
  assert.match(r.ctx, /the after-tool step for helpers/);
});

// ---------- the two owed notices (2026-11-20): a later question still open, and Claude's own memory notes ----------
const LATER_IDS = ['first', 'brief', 'ideas', 'employer', 'folder', 'names'];
function withLater(nb, askedLines) {
  for (const f of ['SKILL.md', path.join('scripts', 'later.mjs')]) put(path.join(nb, 'core', 'skills', 'hive-setup', f), fs.readFileSync(path.join(STARTER, 'core', 'skills', 'hive-setup', f), 'utf8'));
  if (askedLines !== null) put(path.join(nb, 'me', 'asked.md'), '# What I have asked you\n\n' + askedLines.map((id) => `- ${id}: asked 2026-11-20\n`).join(''));
}
test('a question the set-up left for later and still open gives one notice line; none open, or no record, gives none', () => {
  const a = makeHome('lq1');
  withLater(a.nb, ['brief']);
  const r = run(['--part', 'rules', '--no-refresh'], probe(a.nb), envFor(a.home));
  const ls = r.ctx.split('\n').filter((l) => /left for later/.test(l));
  assert.equal(ls.length, 1, r.ctx.slice(-1500));
  assert.match(ls[0], /^NOTICE: 5 questions the set-up left for later are still open: first \(/);
  assert.match(ls[0], /; and more\. /, 'at most three are named');
  assert.match(ls[0], /Later, as it goes/);
  assert.match(ls[0], /later\.mjs check <id>/);
  const one = makeHome('lq5');
  withLater(one.nb, LATER_IDS.filter((x) => x !== 'brief'));
  assert.match(run(['--part', 'rules', '--no-refresh'], probe(one.nb), envFor(one.home)).ctx, /NOTICE: 1 question the set-up left for later is still open: brief \(/);
  const b = makeHome('lq2');
  withLater(b.nb, LATER_IDS);
  assert.doesNotMatch(run(['--part', 'rules', '--no-refresh'], probe(b.nb), envFor(b.home)).ctx, /left for later/, 'every question asked: nothing');
  const c = makeHome('lq3');
  withLater(c.nb, null);
  assert.doesNotMatch(run(['--part', 'rules', '--no-refresh'], probe(c.nb), envFor(c.home)).ctx, /left for later/, 'set up before the record existed: nothing');
  const d = makeHome('lq4', { profile: false });
  withLater(d.nb, []);
  assert.doesNotMatch(run(['--part', 'rules', '--no-refresh'], probe(d.nb), envFor(d.home)).ctx, /left for later/, 'not set up yet: the set-up offer only');
});
test('Claude\'s own memory notes not yet taken in give the memory notice, never a full path; none gives nothing', () => {
  const a = makeHome('mn1');
  put(path.join(a.nb, 'core', 'appfit', 'memory-fold.mjs'), fs.readFileSync(path.join(STARTER, 'core', 'appfit', 'memory-fold.mjs'), 'utf8'));
  assert.doesNotMatch(run(['--part', 'rules', '--no-refresh'], probe(a.nb), envFor(a.home)).ctx, /memory notes hold/, 'no memory notes: nothing');
  put(path.join(a.home, '.claude', 'projects', 'some-project', 'memory', 'MEMORY.md'), '# Memory\n- a made-up note\n');
  const r = run(['--part', 'rules', '--no-refresh'], probe(a.nb), envFor(a.home));
  const ls = r.ctx.split('\n').filter((l) => /memory notes hold/.test(l));
  assert.equal(ls.length, 1, r.ctx.slice(-1500));
  assert.match(ls[0], /hold 1 file not yet taken into the notebook/);
  assert.ok(!ls[0].includes(a.home) && !ls[0].includes('some-project'), 'no path in the line');
  const all = run(['--part', 'all', '--no-refresh'], probe(a.nb), envFor(a.home));
  assert.ok(all.ctx.length <= 8000 && /memory notes hold/.test(all.ctx), 'the one-part start carries it too, under the cap');
});

test('nothing of anyone\'s own is written into the files of this step', () => {
  for (const f of ['start.mjs', 'start.ps1', 'about.mjs', 'settings-snippet.json', 'settings-snippet.node.json', 'start.test.mjs']) {
    const text = fs.readFileSync(path.join(HERE, f), 'utf8');
    // The word for the maker, and the person's own protected names when their list is on this computer (no real name
    // is written here: the list is read at run time).
    const list = process.env.HIVE_NAMES_FILE || path.join(os.homedir(), '.claude', 'hive', 'protected-names.txt');
    const own = fs.existsSync(list) ? fs.readFileSync(list, 'utf8').split(/\r?\n/).map((n) => n.trim()).filter((n) => n.length >= 3 && !n.startsWith('#')) : [];
    const words = [['ow', 'ner'].join(''), ...own.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))];
    assert.doesNotMatch(text, new RegExp(`\\b(${words.join('|')})`, 'i'), f);
  }
});
