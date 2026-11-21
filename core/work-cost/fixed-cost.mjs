#!/usr/bin/env node
// What Hive Mind costs in every chat before any work is done: the fixed part of the bill.
// It counts what is paid in EVERY chat, whatever the work: the start message, the instruction files, the list of
// helpers Claude is shown, and the text and time each hook adds at a message, at a tool step and at a reply's end.
//
//   node core/work-cost/fixed-cost.mjs [--root <notebook>] [--runs 5] [--save <file.json>] [--compare <file.json>] [--json]
//
// It never touches your real Claude folder or your notebook: the notebook (default: the one this file sits in) is copied
// into a new temporary folder, the copy's own installer puts Hive Mind into a made-up home folder there, every hook is
// run exactly as the installed settings name it, and the temporary folder is removed at the end.
// Tokens are estimated as characters / 4 (a rough rule; the real count depends on the words).
// Times are the fastest of --runs runs (default 5) on this computer; the first, slower run is shown too.
// --save writes the numbers to a file; --compare <file> prints them beside the ones saved there (before and after).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const tokens = (chars) => Math.round(chars / 4);
// The start message of a fresh copy must stay under this many tokens (characters / 4), so a person on the simplest
// Claude plan does not pay for a long start in every chat. fixed-cost.test.mjs fails when it is passed.
export const START_BUDGET_TOKENS = 1500;

function args(argv) {
  const o = { root: path.resolve(HERE, '..', '..'), runs: 5, save: '', compare: '', json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--root') o.root = path.resolve(argv[++i]);
    else if (a === '--runs') o.runs = Math.max(1, parseInt(argv[++i], 10) || 5);
    else if (a === '--save') o.save = path.resolve(argv[++i]);
    else if (a === '--compare') o.compare = path.resolve(argv[++i]);
    else if (a === '--json') o.json = true;
  }
  return o;
}

const SKIP = new Set(['.git', 'node_modules', '.next', 'archive']);
function copyNotebook(from, to) {
  fs.cpSync(from, to, { recursive: true, filter: (src) => !SKIP.has(path.basename(src)) });
}

// The front matter's name and description: the part of a helper Claude is shown in every chat.
export function listedText(skillMd) {
  const m = String(skillMd || '').match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return '';
  return m[1].split(/\r?\n/).filter((l) => /^(name|description|when_to_use):/.test(l)).join('\n');
}

// One hook entry, run with the program and arguments the settings name (every Hive Mind hook is node and a .mjs
// file), with the input Claude Code would send. Returns the text it adds for Claude (additionalContext, a refusal
// reason, a sent-back reason), what the person sees (systemMessage) and the time.
function runHook(h, input, env) {
  if (!/node(\.exe)?"?$/i.test(String(h.command || '')) || !h.args || !/\.mjs$/.test(String(h.args[0]))) throw new Error(`a hook that is not node and a .mjs file: ${h.command}`);
  const t0 = process.hrtime.bigint();
  const r = spawnSync(process.execPath, h.args, { input: JSON.stringify(input), env, encoding: 'utf8', timeout: 60000 });
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  let forClaude = '', forPerson = '';
  for (const line of String(r.stdout || '').split(/\r?\n/)) {
    if (!line.trim().startsWith('{')) continue;
    try {
      const j = JSON.parse(line);
      const hs = j.hookSpecificOutput || {};
      forClaude += (hs.additionalContext || '') + (hs.permissionDecisionReason || '') + (j.reason || '');
      forPerson += j.systemMessage || '';
    } catch {}
  }
  return { forClaude, forPerson, ms, code: r.status };
}
const sum = (list) => list.reduce((a, b) => ({ forClaude: a.forClaude + b.forClaude, forPerson: a.forPerson + b.forPerson, ms: a.ms + b.ms }), { forClaude: '', forPerson: '', ms: 0 });
function timed(fn, runs) {
  const all = []; let last = null;
  for (let i = 0; i < runs; i++) { last = fn(i); all.push(last.ms); }
  return { ...last, ms: Math.min(...all), firstMs: all[0], text: last.forClaude };
}

export function measure({ root, runs = 5 }) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hive-fixed-cost-'));
  const nb = path.join(tmp, 'notebook'), home = path.join(tmp, 'home'), claude = path.join(home, '.claude');
  try {
    copyNotebook(root, nb);
    fs.mkdirSync(claude, { recursive: true });
    const env = { ...process.env, HIVE_HOME: home, HIVE_PLUGIN_LIST: 'none' };
    for (const k of ['HIVE_ROOT', 'HIVE_STATE', 'HIVE_CLAUDE', 'HIVE_SKILLS_DIR', 'HIVE_CLOUD', 'HIVE_IN_SELFTEST']) delete env[k];
    const inst = spawnSync(process.execPath, [path.join(nb, 'core', 'install', 'install.mjs'), 'install', '--claude-dir', claude, '--root', nb, '--home', home], { env, encoding: 'utf8', timeout: 120000 });
    if (inst.status !== 0) throw new Error('the copy\'s installer failed in the made-up home: ' + String(inst.stderr || inst.stdout).slice(-400));
    const settings = JSON.parse(fs.readFileSync(path.join(claude, 'settings.json'), 'utf8'));
    const hooksOf = (ev) => (settings.hooks?.[ev] || []).flatMap((e) => e.hooks || []);
    const rows = [];
    const texts = {};
    const add = (key, what, when, text, ms, firstMs) => {
      texts[key] = text;
      rows.push({ key, what, when, chars: text.length, tokens: tokens(text.length), ms: ms == null ? null : Math.round(ms), firstMs: firstMs == null ? null : Math.round(firstMs) });
    };

    // 1. The start message: each start part, fastest of the runs (each run is a new chat).
    let startChars = 0, banner = '';
    hooksOf('SessionStart').forEach((h, i) => {
      const r = timed((n) => runHook(h, { session_id: `cost-start-${n}`, cwd: nb, source: 'startup', hook_event_name: 'SessionStart' }, env), runs);
      const name = (h.args || []).slice(-1)[0] || `part ${i + 1}`;
      add(`start-${i + 1}`, `start message, part ${i + 1} (${name})`, 'every new chat', r.text, r.ms, r.firstMs);
      startChars += r.text.length; banner += r.forPerson;
    });
    // 2. The instruction files: the home one (every chat on the computer) and the notebook's own (chats in the notebook).
    const readOr = (p) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '');
    const homeMd = readOr(path.join(claude, 'CLAUDE.md'));
    const nbMd = readOr(path.join(nb, 'CLAUDE.md'));
    add('claude-home', 'instructions in the home Claude folder (CLAUDE.md)', 'every chat', homeMd);
    add('claude-notebook', 'instructions in the notebook (CLAUDE.md)', 'chats in the notebook', nbMd);
    // 3. The helpers' names and descriptions, which Claude is shown in every chat.
    const listed = [];
    const sk = path.join(claude, 'skills');
    for (const d of fs.existsSync(sk) ? fs.readdirSync(sk, { withFileTypes: true }) : []) {
      const f = path.join(sk, d.name, 'SKILL.md');
      if (d.isDirectory() && fs.existsSync(f)) listed.push(listedText(fs.readFileSync(f, 'utf8')));
    }
    add('skills', `the list of Hive Mind's ${listed.length} helpers (names and descriptions)`, 'every chat', listed.join('\n'));
    const chatStart = startChars + homeMd.length + nbMd.length + texts.skills.length;

    // 4. At each message of the person, at each tool step and at a reply's end, in one chat that had a real start.
    const sid = 'cost-chat';
    for (const h of hooksOf('SessionStart')) runHook(h, { session_id: sid, cwd: nb, source: 'startup', hook_event_name: 'SessionStart' }, env);
    const at = (ev, extra) => ({ session_id: sid, transcript_path: path.join(tmp, 't.jsonl'), cwd: nb, permission_mode: 'default', hook_event_name: ev, ...extra });
    const fire = (ev, extra) => sum(hooksOf(ev).map((h) => runHook(h, at(ev, extra), env)));
    const replyEnd = () => fire('Stop', { stop_hook_active: false, last_assistant_message: 'I keep your notes and your rules in one place, so each new chat starts knowing where you are.', background_tasks: [] });
    const m1 = fire('UserPromptSubmit', { prompt: 'Hello, what can you do?' });
    add('msg-first', 'at the first message', 'once a chat', m1.forClaude, m1.ms);
    replyEnd(); // a real chat answers each message, so the next message follows a reply's end
    const later = timed((n) => { const x = fire('UserPromptSubmit', { prompt: `And the next thing, number ${n + 2}?` }); replyEnd(); return x; }, runs);
    add('msg-later', 'at each later message', 'every message', later.text, later.ms, later.firstMs);
    const readIn = { tool_name: 'Read', tool_input: { file_path: path.join(nb, 'README.md') }, tool_use_id: 'toolu_1' };
    const pre = timed(() => fire('PreToolUse', readIn), runs);
    add('pretool', 'before each tool step (reading a file)', 'every tool step', pre.text, pre.ms, pre.firstMs);
    const post = timed(() => fire('PostToolUse', { ...readIn, tool_response: { success: true } }), runs);
    add('posttool', 'after each tool step (reading a file)', 'every tool step', post.text, post.ms, post.firstMs);
    const stop = timed(() => fire('Stop', { stop_hook_active: false, last_assistant_message: 'I keep your notes and your rules in one place, so each new chat starts knowing where you are.', background_tasks: [] }), runs);
    add('stop', 'at the end of each reply', 'every reply', stop.text, stop.ms, stop.firstMs);

    // 5. What runs or starts without the person asking: the daily runs' switch and the helper model policy.
    const sw = readOr(path.join(nb, 'system', 'engine-switch.md'));
    const gs = JSON.parse(readOr(path.join(nb, 'core', 'gates', 'settings.json')) || '{}');
    const facts = {
      dailyRuns: (sw.match(/^engine:\s*(\w+)/m) || [])[1] || 'no switch note',
      helperModelPolicy: (gs.model?.allowed || []).length ? gs.model.allowed.join(', ') : 'any model, and every helper must name one',
      modelTable: gs.modelFor || {},
    };
    return { at: new Date().toISOString(), runs, rows, startChars, startTokens: tokens(startChars), chatStart, chatStartTokens: tokens(chatStart), texts, banner, facts };
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  }
}

const cell = (v) => (v == null ? '-' : String(v));
export function table(now, before) {
  const out = [];
  if (before) {
    out.push('WHAT | WHEN | BEFORE chars | BEFORE ~tokens | AFTER chars | AFTER ~tokens | BEFORE ms | AFTER ms');
    for (const r of now.rows) {
      const b = before.rows.find((x) => x.key === r.key) || {};
      out.push([r.what, r.when, cell(b.chars), cell(b.tokens), r.chars, r.tokens, cell(b.ms), cell(r.ms)].join(' | '));
    }
    out.push(`START MESSAGE (all parts) | every new chat | ${before.startChars} | ${before.startTokens} | ${now.startChars} | ${now.startTokens} | |`);
    out.push(`SUM AT CHAT START | chats in the notebook | ${before.chatStart} | ${before.chatStartTokens} | ${now.chatStart} | ${now.chatStartTokens} | |`);
  } else {
    out.push('WHAT | WHEN | chars | ~tokens | ms (fastest) | ms (first run)');
    for (const r of now.rows) out.push([r.what, r.when, r.chars, r.tokens, cell(r.ms), cell(r.firstMs)].join(' | '));
    out.push(`START MESSAGE (all parts) | every new chat | ${now.startChars} | ${now.startTokens} | |`);
    out.push(`SUM AT CHAT START | chats in the notebook | ${now.chatStart} | ${now.chatStartTokens} | |`);
  }
  out.push(`Daily runs: ${now.facts.dailyRuns}. Helper models: ${now.facts.helperModelPolicy}.`);
  return out.join('\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const o = args(process.argv.slice(2));
  let now;
  try { now = measure(o); } catch (e) { console.log(`COULD NOT LOOK|${e.message}`); process.exit(2); }
  if (o.save) fs.writeFileSync(o.save, JSON.stringify(now, null, 2));
  const before = o.compare && fs.existsSync(o.compare) ? JSON.parse(fs.readFileSync(o.compare, 'utf8')) : null;
  console.log(o.json ? JSON.stringify(now, null, 2) : table(now, before));
}
