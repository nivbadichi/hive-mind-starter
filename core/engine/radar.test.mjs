// Tests for the radar (core/engine/radar.mjs). Only temporary folders are touched; nothing is fetched.
//   node --test core/engine/radar.test.mjs
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as R from './radar.mjs';

let nb, st, cl, fx;
const w = (p, t) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, t); };
const state = (name, kind, stage, body) => `---\nproject: ${name}\nkind: ${kind}\nstage: ${stage}\nhealth: good\nupdated: 2026-11-18\n---\n\n${body}\n`;
const listText = () => fs.readFileSync(path.join(nb, 'system', 'radar', 'suggestions.md'), 'utf8');
const judged = (key, extra = {}) => ({ key, name: key, kind: 'skill', say: `A skill that helps with ${key} in your design work.`, cost: 'free', needs: 'nothing from you', replaces: 'nothing', value: 2, url: `https://example.org/${key}`, safety: { maker: 'Example Co', licence: 'MIT', reads: 'the page', sends: 'nothing', hooks: 'none', verdict: 'fine' }, ...extra });

beforeEach(() => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-'));
  nb = path.join(base, 'nb'); st = path.join(base, 'state'); cl = path.join(base, 'claude'); fx = path.join(base, 'fx');
  Object.assign(process.env, { HIVE_ROOT: nb, HIVE_STATE: st, CLAUDE_DIR: cl, HIVE_DATE: '2026-11-19', HIVE_OWNER: 'Dana Example' });
  w(path.join(nb, 'projects', 'shop-site', 'state.md'), state('Shop Site', 'personal', 'build', 'A website with a landing page, React components and animation. Deploy on Vercel. Tests with Playwright.'));
  w(path.join(nb, 'projects', 'acme-work', 'state.md'), state('Acme Portal', 'employer', 'design', 'SECRET-PLAN-ZEBRA for the client. Calendar dashboards data.'));
  w(path.join(nb, 'projects', 'old-game', 'state.md'), state('Old Game', 'personal', 'paused (frozen)', 'A game with agents and hooks.'));
  w(path.join(nb, 'me', 'taste', 'profile.md'), 'MARKER-FROM-ME loves purple');
  w(path.join(nb, 'system', 'lessons.md'), '# Lessons\n\n- Keep replies short and plain. closed_by: rule 6\n- 2026-11-16: The owner had to say it a third time: write in plain words. closed_by: rule 6\n- 2026-11-17: The user had to repeat this again: always attach the screenshot. closed_by: open (would close with: a check)\n- Use ready-made parts. closed_by: rule 14\n- Prefer ready-made component sites. closed_by: rule 14\n');
  w(path.join(nb, 'system', 'preferences.md'), '# Standing wishes\n\n- 2026-11-19: short plain answers, no jargon.\n');
  w(path.join(nb, 'system', 'registry.json'), JSON.stringify({ version: 1, entries: [
    { id: 'impeccable', kind: 'skill', state: 'active', source: 'folder' },
    { id: 'old-trading-skill', kind: 'skill', state: 'installed-unused', source: 'folder' },
    { id: 'engineering:debug', kind: 'skill', state: 'active', source: 'plugin' },
    { id: 'hive-scout', kind: 'skill', state: 'active', source: 'owner' },
    { id: 'figma', kind: 'connector', state: 'installed-unused', source: 'directory' },
    { id: 'vercel', kind: 'connector', state: 'active', source: 'directory' },
  ] }));
});

// ---------- learning the owner ----------
test('profile: kinds of work come from the project notes; a work project is counted, never read; a paused one is skipped', () => {
  const p = R.buildProfile();
  assert.equal(p.projects.read, 1); assert.equal(p.projects.employer, 1); assert.equal(p.projects.paused, 1);
  const kinds = p.work.map((x) => x.kind);
  assert.ok(kinds.includes('interface design') && kinds.includes('deploy and hosting') && kinds.includes('testing and checks'));
  assert.ok(!kinds.includes('data and charts'), 'the work project\'s words were not read');
  assert.ok(!kinds.includes('agent systems'), 'the paused project\'s words were not read');
});
test('profile: the printed lines hold no secret, nothing from me/, no work-project detail', () => {
  const text = R.profileLines(R.buildProfile()).join('\n');
  for (const bad of ['SECRET-PLAN-ZEBRA', 'Acme', 'MARKER-FROM-ME', 'purple', 'client']) assert.ok(!text.includes(bad), `"${bad}" must not appear`);
  assert.deepEqual(R.leaks(text, ['acme portal', 'dana', 'example']), []);
});
test('profile: how the owner likes things uses only the fixed labels, each seen in at least two lines', () => {
  const p = R.buildProfile();
  const labels = new Set(R.LIKES.map(([l]) => l));
  assert.ok(p.likes.every((l) => labels.has(l.label) && l.lines >= 2));
  assert.ok(p.likes.some((l) => l.label.startsWith('short, plain')));
});
test('usage: skills loaded in the window are counted; old records and missing records are said plainly', () => {
  assert.equal(R.buildProfile().usage.counted, false, 'no state folder: not counted');
  const chat = path.join(st, 'gates', 'chat');
  w(path.join(chat, 'a.skills'), '{"s":"impeccable","a":""}\n{"s":"debug","a":"x"}\n{"s":"impeccable"}\n');
  w(path.join(chat, 'old.skills'), '{"s":"old-trading-skill"}\n');
  const old = Date.parse('2026-09-01') / 1000; fs.utimesSync(path.join(chat, 'old.skills'), old, old);
  w(path.join(st, 'gates.log'), '{"t":"2026-10-01T10:00:00.000Z","event":"record"}\n');
  w(path.join(chat, 'b.skills'), ''); // exists, empty
  const u = R.buildProfile().usage;
  assert.equal(u.counted, true); assert.equal(u.days, 28); assert.equal(u.since, '2026-10-01');
  assert.deepEqual(u.loaded.map((x) => x.skill), ['impeccable', 'debug']);
  assert.deepEqual(u.never, ['old-trading-skill'], '"debug" counts for engineering:debug; hive skills are not counted');
});

// ---------- the privacy screen and plain words ----------
test('leaks: secrets, e-mail addresses, the owner\'s name and project names are caught', () => {
  assert.ok(R.leaks('use sk-abcdefghijklmnop1234').length);
  assert.ok(R.leaks('token = abc123').length);
  assert.ok(R.leaks('write to dana@example.org').length);
  assert.ok(R.leaks('skills for Shop Site', ['shop site']).length);
  assert.deepEqual(R.leaks('new Claude Code skills for interface design November 2026', ['shop site', 'dana']), []);
});
test('plain words: file names, code and inside words are refused in an idea', () => {
  assert.equal(R.plainProblem('A skill that checks your pages on a phone.'), null);
  assert.ok(R.plainProblem('Install the MCP server'));
  assert.ok(R.plainProblem('Edit core/engine/brief.md'));
  assert.ok(R.plainProblem('Run `npm i x`'));
  assert.ok(R.plainProblem(Array(50).fill('word').join(' ')));
});

// ---------- the plan ----------
test('plan: general words only, within the budget, never a search made before', () => {
  const p = R.buildProfile(); const sw = { ...R.DEFAULTS, searches: 3 };
  const seen = R.loadSeen(); const names = R.privateNames();
  const first = R.plan(p, seen, sw, names);
  assert.equal(first.queries.length, 3);
  for (const q of first.queries) assert.deepEqual(R.leaks(q, names), [], q);
  assert.ok(names.includes('shop site') && names.includes('dana'));
  seen.queries[first.queries[0]] = '2026-11-12';
  const again = R.plan(p, seen, sw, names);
  assert.ok(!again.queries.includes(first.queries[0]));
  assert.ok(again.dropped.some(([q, why]) => q === first.queries[0] && /searched on/.test(why)));
});

// ---------- the cheap pass ----------
function fixtures({ changelog = '## 2.1.330\n- Added skills hot reload\n- Fixed a typo\n\n## 2.1.329\n- Added hooks trust dialog\n\n## 2.1.328\n- Faster startup\n\n## 2.1.327\n- Added plugin pinning\n' } = {}) {
  w(path.join(fx, 'official-plugins.txt'), JSON.stringify({ owner: { name: 'Anthropic' }, plugins: [
    { name: 'figma', description: 'Design files in Claude', homepage: 'https://figma.example' },
    { name: 'pixel-polish', description: 'Polish interface design and React components', author: { name: 'Pix Co' }, homepage: 'https://pix.example' },
    { name: 'tax-filer', description: 'File taxes for accountants', author: { name: 'Tax Co' } },
    { name: 'never-me', description: 'Interface design website helper', author: { name: 'N' } },
  ] }));
  w(path.join(fx, 'work-plugins.txt'), JSON.stringify({ owner: { name: 'Anthropic' }, plugins: [{ name: 'engineering', description: 'Engineering skills' }, { name: 'pixel-polish', description: 'dup' }] }));
  w(path.join(fx, 'vercel-plugins.txt'), 'not json');
  w(path.join(fx, 'anthropic-skills.txt'), JSON.stringify([{ name: 'web-artifacts-builder', type: 'dir', html_url: 'https://github.com/anthropics/skills/tree/main/skills/web-artifacts-builder' }, { name: 'README.md', type: 'file' }]));
  w(path.join(fx, 'claude-code-changes.txt'), changelog);
}
test('poll: only new things that fit go to the close read; known, never and low-fit are set aside and remembered', async () => {
  fixtures();
  fs.mkdirSync(path.join(nb, 'system', 'radar'), { recursive: true });
  fs.writeFileSync(path.join(nb, 'system', 'radar', 'suggestions.md'), R.LIST_HEAD.replace('## Answered\n', '## Answered\n\n- [x] r1 | 2026-11-01 | tool | never-me | x | Costs: a | Needs: b | Replaces: c | First read: d | From: e | Key: never-me | Answer: never 2026-11-02\n'));
  const r = await R.poll({ from: fx });
  const keys = r.take.map((x) => x.key);
  assert.ok(keys.includes('pixel-polish'));
  assert.ok(!keys.includes('figma'), 'already in the registry');
  assert.ok(!keys.includes('engineering'), 'a plugin whose skills are in the registry');
  assert.ok(!keys.includes('never-me'), 'the owner said never');
  assert.ok(!keys.includes('tax-filer'), 'does not fit');
  assert.deepEqual(r.failed, ['vercel-plugins'], 'a list that cannot be read is named, and the rest goes on');
  const seen = R.loadSeen();
  assert.equal(seen.items['tax-filer'].s, 'low-fit');
  assert.equal(seen.sources['claude-code-changes'], '2.1.330');
  const cc = r.take.find((x) => x.kind === 'feature');
  assert.equal(cc.key, 'claude-code-2-1-328-to-2-1-330', 'first look: the last three versions make one find');
  assert.match(cc.about, /skills hot reload/); assert.match(cc.about, /hooks trust/);
  assert.ok(!/typo|plugin pinning/.test(cc.about), 'only the lines that touch skills, hooks or plugins, from those three versions');
  const second = await R.poll({ from: fx });
  assert.equal(second.take.length, 0, 'nothing is looked at twice');
});
test('poll: the close read is capped; the rest is held for the next look', async () => {
  fixtures();
  w(path.join(nb, 'system', 'radar', 'switch.md'), 'radar: on\ncostly_cap: 1\n');
  const r = await R.poll({ from: fx });
  assert.equal(r.take.length, 1);
  assert.ok(r.skipped.some(([, why]) => /budget/.test(why)));
  assert.ok(Object.values(R.loadSeen().items).some((x) => x.s === 'held'));
});
test('new: web finds are sifted the same way and the searches are remembered', () => {
  const r = R.addFinds({ queries: ['q one', 'q two'], finds: [{ name: 'Motion Kit', kind: 'skill', about: 'animation for interface design', url: 'https://m.example' }, { name: 'impeccable', about: 'design' }] });
  assert.deepEqual(r.take.map((x) => x.key), ['motion-kit']);
  assert.equal(R.loadSeen().queries['q one'], '2026-11-19');
});

test('one budget for the close read: a better web find takes the place of a weaker list find', async () => {
  fixtures();
  w(path.join(nb, 'system', 'radar', 'switch.md'), 'radar: on\ncostly_cap: 2\n');
  await R.poll({ from: fx });
  const before = JSON.parse(fs.readFileSync(path.join(st, 'radar', 'queue.json'), 'utf8')).map((q) => q.key);
  assert.equal(before.length, 2);
  R.addFinds({ queries: [], finds: [{ name: 'Layout Lab', maker: 'Anthropic', about: 'interface design, layout, React components and CSS for a website' }] });
  const after = JSON.parse(fs.readFileSync(path.join(st, 'radar', 'queue.json'), 'utf8')).map((q) => q.key);
  assert.equal(after.length, 2); assert.ok(after.includes('layout-lab'));
  assert.equal(R.loadSeen().items[before.find((k) => !after.includes(k))].s, 'held');
});
test('fit: a product\'s own plugin counts less, a plain word in the name does not', () => {
  const p = { work: [{ kind: 'interface design' }, { kind: 'planning and organising' }, { kind: 'documents and study' }] };
  const own = R.fitScore({ name: 'valtown', about: 'Build a website and deploy on Val Town', kind: 'plugin' }, p);
  const plain = R.fitScore({ name: 'site-builder', about: 'Build a website and deploy it', kind: 'plugin' }, p);
  assert.equal(plain - own, 2);
  assert.equal(R.fitScore({ name: 'Daily Planning', about: 'a calendar and tasks planner', kind: 'skill' }, p), 4);
});

// ---------- the costly pass ends: at most three, best first ----------
test('suggest: a find without its first safety read or in inside words is refused, never written', () => {
  const r = R.suggest([judged('a', { safety: { maker: 'X' } }), judged('b', { say: 'Install the MCP server from core/x.mjs' })]);
  assert.ok(!r.add.some((x) => x.key === 'a' || x.key === 'b')); assert.equal(r.refused.length, 2);
});
test('suggest: a "do not use" first read is dropped and remembered with the reason', () => {
  const r = R.suggest([judged('bad', { safety: { maker: 'X', licence: 'none', reads: 'all files', sends: 'everything', hooks: 'every event', verdict: 'stop', why: 'sends every prompt away' } })]);
  assert.ok(!r.add.some((x) => x.key === 'bad')); assert.equal(r.dropped.length, 1);
  assert.equal(R.loadSeen().items.bad.s, 'dropped');
});
test('suggest: never a pile of one sort: one new rule at a time, the next waits its turn', () => {
  const sb = (t, why) => `{"t":"${t}","event":"stop-sendback","problems":["${why}"]}`;
  const lines = []; for (let i = 0; i < 4; i++) { lines.push(sb(`2026-11-1${i + 5}T10:00:00Z`, 'it is 170 words')); lines.push(sb(`2026-11-1${i + 5}T11:00:00Z`, 'no \\"Used:\\" line')); }
  w(path.join(st, 'gates.log'), lines.join('\n') + '\n');
  fs.writeFileSync(path.join(nb, 'system', 'lessons.md'), '# Lessons\n');
  const r = R.suggest([]);
  assert.equal(r.add.filter((x) => x.kind === 'protocol').length, 1);
  assert.equal(R.suggest([]).add.length, 0, 'while one rule waits, the next rule waits too');
});
test('suggest: a find the close read sets aside is remembered with its reason and never asked', () => {
  const r = R.suggest([{ key: 'sap-kit', name: 'sap-kit', drop: 'only for a design system none of your work uses' }]);
  assert.equal(r.dropped[0][1], 'only for a design system none of your work uses');
  assert.equal(R.loadSeen().items['sap-kit'].s, 'dropped');
  assert.ok(!listText().includes('sap-kit'));
});
// The weekly look starts off in a new copy; the tests of a running look switch it on first, as the person would.
const switchOn = () => w(path.join(nb, 'system', 'radar', 'switch.md'), R.SWITCH_TEXT.replace('radar: off', 'radar: on'));
test('suggest: at most three wait at once, best first; the rest are held', () => {
  switchOn();
  const r = R.suggest([judged('low', { value: 1 }), judged('top', { value: 3 }), judged('mid', { value: 2 }), judged('mid2', { value: 2 })]);
  // The notes give one more: the repeated, still open lesson.
  const ids = r.add.map((x) => x.key);
  assert.equal(r.add.length, 3);
  assert.equal(ids[0], 'top');
  assert.ok(ids.some((k) => k.startsWith('protocol-lesson-')), 'a correction given more than once comes high');
  assert.ok(r.held.length >= 2);
  const t = listText();
  assert.match(t, /- \[ \] r1 \| 2026-11-19 \| skill \| top \| /);
  assert.equal(R.line(), 'Three ideas are waiting for you.');
  const again = R.suggest([judged('another', { value: 3 })]);
  assert.equal(again.add.length, 0, 'no room until the owner answers');
});
test('suggest: a judged find that waits for room comes back by itself, never read twice', async () => {
  fs.writeFileSync(path.join(nb, 'system', 'lessons.md'), '# Lessons\n');
  R.suggest([judged('a1', { value: 3 }), judged('a2', { value: 3 }), judged('a3', { value: 3 }), judged('later-one', { value: 1 })]);
  assert.ok(R.loadSeen().held['later-one']);
  const sifted = R.addFinds({ queries: [], finds: [{ name: 'later-one', about: 'interface design website components' }] });
  assert.ok(sifted.skipped.some(([, why]) => /already read closely/.test(why)));
  R.answer(R.readList().ideas.find((i) => i.key === 'a1').id, 'never');
  const r = R.suggest([]);
  assert.deepEqual(r.add.map((x) => x.key), ['later-one']);
  assert.ok(!R.loadSeen().held['later-one']);
});
test('answer: yes, not now and never are kept; never is never asked again; not now comes back after the snooze', () => {
  R.suggest([judged('one', { value: 3 }), judged('two', { value: 2 })]);
  const ideas = R.readList().ideas;
  const one = ideas.find((i) => i.key === 'one'); const two = ideas.find((i) => i.key === 'two');
  const y = R.answer(one.id, 'never');
  assert.match(y.next, /not be suggested again/);
  R.answer(two.id, 'not-now');
  assert.throws(() => R.answer(two.id, 'yes'), /already answered/);
  const after = R.readList().ideas;
  assert.equal(after.find((i) => i.key === 'one').answer, 'never');
  assert.match(listText(), /## Answered\n\n- \[x\] /);
  // never: the same find never comes back, even from a new look
  const r1 = R.suggest([judged('one', { value: 3 })]);
  assert.ok(!r1.add.some((x) => x.key === 'one'));
  // not now: back after 30 days
  process.env.HIVE_DATE = '2026-12-30';
  const r2 = R.suggest([]);
  assert.ok(r2.add.some((x) => x.key === 'two'), 'it may come back after the snooze');
});
test('answer: "more" keeps it waiting and asks for the full review; a yes points to the add helper', () => {
  R.suggest([judged('kit', { value: 3 })]);
  const id = R.readList().ideas.find((i) => i.key === 'kit').id;
  assert.match(R.answer(id, 'more').next, /10-point/);
  assert.ok(R.readList().ideas.find((i) => i.key === 'kit').open);
  assert.match(R.answer(id, 'yes').next, /add helper/);
});

// ---------- ideas from the owner's own notes ----------
test('note ideas: a send-back repeated three times becomes a proposed step; a clean-up needs enough days of record', () => {
  const chat = path.join(st, 'gates', 'chat');
  w(path.join(chat, 'a.skills'), '{"s":"impeccable"}\n');
  const sb = (t) => `{"t":"${t}","mode":"stop","event":"stop-sendback","problems":["it is 160 words"]}`;
  w(path.join(st, 'gates.log'), [sb('2026-11-17T10:00:00Z'), sb('2026-11-18T10:00:00Z'), sb('2026-11-19T09:00:00Z')].join('\n') + '\n');
  const sw = { ...R.DEFAULTS, retire_after_days: 14 };
  let ideas = R.noteIdeas(R.buildProfile(), sw);
  assert.ok(ideas.some((i) => i.key === 'protocol-sendback-replies-too-long' && /3 times/.test(i.say)));
  assert.ok(!ideas.some((i) => i.kind === 'retire'), 'two days of record is not enough to suggest a clean-up');
  w(path.join(st, 'gates.log'), '{"t":"2026-10-01T10:00:00Z","event":"record"}\n');
  const reg = JSON.parse(fs.readFileSync(path.join(nb, 'system', 'registry.json'), 'utf8'));
  for (let i = 0; i < 6; i++) reg.entries.push({ id: `unused-${i}`, kind: 'skill', state: 'installed-unused', source: 'folder' });
  fs.writeFileSync(path.join(nb, 'system', 'registry.json'), JSON.stringify(reg));
  ideas = R.noteIdeas(R.buildProfile(), sw);
  const ret = ideas.find((i) => i.kind === 'retire');
  assert.ok(ret && /8 of your 9 installed skills/.test(ret.say), 'one grouped clean-up, never a pile');
});

// ---------- the guard, the line, the end of a look ----------
test('check: off until switched on; one look a week; a date is needed', () => {
  assert.match(R.check('2026-11-19').why, /switch is off/, 'a new copy has no weekly look until the person switches it on');
  assert.match(R.SWITCH_TEXT, /^radar: off$/m);
  assert.match(R.SWITCH_TEXT, /What it costs:/);
  w(path.join(nb, 'system', 'radar', 'switch.md'), R.SWITCH_TEXT.replace('radar: off', 'radar: on'));
  assert.equal(R.check('2026-11-19').go, true);
  assert.equal(R.check('soon').go, false);
  R.finish('2026-11-19', { searches: 2 });
  assert.match(R.check('2026-11-22').why, /next look is on or after 2026-11-26/);
  assert.equal(R.check('2026-11-26').go, true);
});
test('line: says nothing when nothing waits or when switched off', () => {
  switchOn();
  assert.equal(R.line(), '');
  R.suggest([judged('solo', { value: 3 })]);
  R.readList().ideas.filter((i) => i.key !== 'solo').forEach((i) => R.answer(i.id, 'not-now'));
  assert.equal(R.line(), 'One idea is waiting for you.');
  w(path.join(nb, 'system', 'radar', 'switch.md'), 'radar: off\n');
  assert.equal(R.line(), '');
});
test('done: the ledger words carry the counts; going over the budget is said', () => {
  R.addFinds({ queries: ['a', 'b'], finds: [] });
  const r = R.finish('2026-11-19', { fetches: 20, seconds: 30 });
  assert.match(r.ledger, /^Radar: 2 searches, 20 page reads, 0 new finds/);
  assert.match(r.ledger, /Tokens: not measured\.$/);
  assert.ok(r.over.some((o) => /page reads, over the budget of 12/.test(o)));
});
test('export: the waiting ideas, for the page, without the raw line', () => {
  R.suggest([judged('pagey', { value: 3 })]);
  const x = R.exportOpen();
  assert.ok(x.length >= 1 && x.every((i) => i.id && i.say && !('line' in i)));
});
