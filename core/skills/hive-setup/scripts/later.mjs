#!/usr/bin/env node
// Hive Mind learns as it goes: the questions it did not ask at set-up are asked once, the first time they matter.
// This program keeps the small record of what was already asked (me/asked.md), so nothing is asked twice.
// The questions themselves, their moment and who asks each live in one place: the table under
// "## Later, as it goes" in ../SKILL.md. This program reads that table.
//
//   node later.mjs begin                   at set-up: writes me/asked.md with its title, if it is not there
//   node later.mjs check <id>              ASK|id|the words   (ask it now, then mark it)
//                                          DONE|id|asked <date> or skipped <date>   (never ask it again)
//                                          WAIT|id|not set up yet   (only the set-up asks things before me/profile.md exists)
//   node later.mjs mark <id> [--skipped]   writes "- id: asked <date>" (or skipped) into me/asked.md; one line per question
//   node later.mjs list                    one line per question: DONE|.. or OPEN|id|when|who asks
//   node later.mjs table                   OK|.. or NEEDS|.. : every asker exists and runs the check for its question
//
// The record holds only which question was asked and when, never an answer: an answer goes where it is used
// (a private name only into the protected names list). Place: HIVE_ROOT (the notebook), else the notebook this
// file sits in, else ~/hive-mind. HIVE_DATE stands in for today (tests).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILL = path.join(HERE, '..', 'SKILL.md');
const today = () => process.env.HIVE_DATE || new Date().toISOString().slice(0, 10);
const readText = (p) => { try { return fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n'); } catch { return null; } };

export function notebookRoot() {
  if (process.env.HIVE_ROOT) return process.env.HIVE_ROOT;
  const mine = path.resolve(HERE, '..', '..', '..', '..');
  if (fs.existsSync(path.join(mine, 'system', 'rules.md'))) return mine;
  return path.join(os.homedir(), 'hive-mind');
}

/** The rows of the "Later, as it goes" table: id, the question's words, when it is asked, the helpers that ask it. */
export function parseTable(text) {
  const part = ((text || '').split(/^## Later, as it goes.*$/m)[1] || '').split(/^## /m)[0];
  const rows = part.split('\n').filter((l) => /^\|/.test(l) && !/^\|\s*-/.test(l)).slice(1);
  return rows.map((l) => {
    const [id, words, when, by] = l.split('|').slice(1, -1).map((c) => c.trim());
    return { id: id.replace(/`/g, ''), words, when, by: [...(by || '').matchAll(/`(hive-[\w-]+)`/g)].map((m) => m[1]) };
  }).filter((r) => r.id);
}

/** Problems with the table: an asker that does not exist, or one whose own instructions never run the check for its question. */
export function checkTable(root) {
  const rows = parseTable(readText(path.join(root, 'core', 'skills', 'hive-setup', 'SKILL.md')));
  if (!rows.length) return ['core/skills/hive-setup/SKILL.md has no "Later, as it goes" table'];
  const problems = [];
  for (const r of rows) {
    if (!r.by.length) problems.push(`${r.id}: no helper is named to ask it`);
    for (const who of r.by) {
      const text = readText(path.join(root, 'core', 'skills', who, 'SKILL.md'));
      if (text === null) problems.push(`${r.id}: the helper ${who} does not exist`);
      else if (!text.includes(`later.mjs check ${r.id}`)) problems.push(`${r.id}: ${who} never runs "later.mjs check ${r.id}"`);
    }
  }
  return problems;
}

const recordPath = (root) => path.join(root, 'me', 'asked.md');
const HEAD = '# What I have asked you\n\nHive Mind learns as it goes: each question is asked once, the first time it matters. A line here means it was asked; the answer lives where it is used. Tell me any time to change an answer.\n\n';

/** What the record says: id -> "asked <date>" | "skipped <date>". */
export function readRecord(root) {
  const out = {};
  for (const m of (readText(recordPath(root)) || '').matchAll(/^- ([\w-]+): ((?:asked|skipped) \d{4}-\d{2}-\d{2})/gm)) out[m[1]] = m[2];
  return out;
}

export function check(root, id) {
  const rows = parseTable(readText(SKILL));
  const row = rows.find((r) => r.id === id);
  if (!row) return null;
  const setUp = fs.existsSync(path.join(root, 'me', 'profile.md'));
  const hasRecord = fs.existsSync(recordPath(root));
  if (!setUp) return `WAIT|${id}|not set up yet`;
  if (!hasRecord) return `DONE|${id}|set up before questions were asked later, so it was asked then`;
  const seen = readRecord(root)[id];
  return seen ? `DONE|${id}|${seen}` : `ASK|${id}|${row.words}`;
}

export function mark(root, id, how = 'asked') {
  const text = readText(recordPath(root)) ?? HEAD;
  const line = `- ${id}: ${how} ${today()}`;
  const re = new RegExp(`^- ${id}:.*$`, 'm');
  const next = re.test(text) ? text.replace(re, line) : text.replace(/\n*$/, '\n') + line + '\n';
  fs.mkdirSync(path.dirname(recordPath(root)), { recursive: true });
  fs.writeFileSync(recordPath(root), next);
  return line;
}

function main(argv) {
  const [cmd, id, ...rest] = argv;
  const root = notebookRoot();
  const rows = parseTable(readText(SKILL));
  const known = (x) => rows.some((r) => r.id === x);
  const refuse = (why) => { console.log(`REFUSED|${why}`); process.exitCode = 2; };
  if (cmd === 'begin') {
    if (fs.existsSync(recordPath(root))) return console.log('OK|me/asked.md is already there');
    fs.mkdirSync(path.dirname(recordPath(root)), { recursive: true });
    fs.writeFileSync(recordPath(root), HEAD);
    console.log('WROTE|me/asked.md');
  } else if (cmd === 'check') {
    if (!known(id)) return refuse(`no later question is called "${id}"; the questions: ${rows.map((r) => r.id).join(', ')}`);
    console.log(check(root, id));
  } else if (cmd === 'mark') {
    if (!known(id)) return refuse(`no later question is called "${id}"`);
    if (rest.some((a) => a !== '--skipped')) return refuse('mark takes only --skipped: the record never holds an answer');
    console.log(`MARKED|${mark(root, id, rest.includes('--skipped') ? 'skipped' : 'asked').slice(2)}`);
  } else if (cmd === 'list') {
    for (const r of rows) {
      const c = check(root, r.id);
      console.log(c.startsWith('ASK|') ? `OPEN|${r.id}|${r.when}|${r.by.join(', ')}` : c);
    }
  } else if (cmd === 'table') {
    const p = checkTable(root);
    console.log(p.length ? p.map((x) => `NEEDS|${x}`).join('\n') : `OK|${rows.length} later questions, each asked by a helper that runs its check`);
    if (p.length) process.exitCode = 1;
  } else {
    console.log('Commands: begin | check <id> | mark <id> [--skipped] | list | table');
    process.exitCode = 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
