#!/usr/bin/env node
// The notes check themselves: three checks in one program. It reads and reports; it changes nothing.
//   1. Every note named in knowledge/INDEX.md exists, and every note in knowledge/ is in the index.
//   2. Every note that another note points to exists (markdown links, and paths in backticks that start
//      with system/, knowledge/, core/skills/ or projects/).
//   3. Every skill's description (core/skills/*/SKILL.md) says when to use it and is not longer than the
//      official skills page allows: 1,536 characters for the description and when_to_use text together
//      (https://code.claude.com/docs/en/skills, read 2026-11-19).
//
//   node core/engine/notes-check.mjs        prints "OK|text" or "NEEDS|text" lines; exit 1 if anything needs work
// Place: HIVE_ROOT (the notebook), for tests.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const MAX_DESCRIPTION = 1536;
const SCOPE = ['system/', 'knowledge/', 'core/skills/', 'projects/'];
const SKIP_DIRS = new Set(['node_modules', '.git', 'generated']);
const WHEN = /\b(use (it )?(when|whenever|before|after|at|for|to|this|if|on)\b|when (the|a|an|you|he|she|they|asked|asking)\b|trigger)/i;

const rel = (root, p) => path.relative(root, p).split(path.sep).join('/');

function walkMd(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walkMd(path.join(dir, e.name), out); }
    else if (e.name.endsWith('.md')) out.push(path.join(dir, e.name));
  }
  return out;
}

export function checkIndex(root) {
  const problems = [];
  const kdir = path.join(root, 'knowledge');
  const idx = path.join(kdir, 'INDEX.md');
  if (!fs.existsSync(idx)) return ['The index knowledge/INDEX.md does not exist.'];
  const named = [];
  for (const line of fs.readFileSync(idx, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*[-*]\s+`?([^\s:`]+\.md)`?\s*:/);
    if (m) named.push(m[1]);
  }
  for (const n of named) if (!fs.existsSync(path.join(kdir, n))) problems.push(`The index names knowledge/${n}, but that note does not exist.`);
  const have = fs.existsSync(kdir) ? fs.readdirSync(kdir).filter((f) => f.endsWith('.md') && f !== 'INDEX.md') : [];
  for (const f of have) if (!named.includes(f)) problems.push(`The note knowledge/${f} is not in knowledge/INDEX.md.`);
  return problems;
}

const stripCode = (text) => text.replace(/```[\s\S]*?```/g, '');

export function checkLinks(root) {
  const problems = [];
  const files = SCOPE.flatMap((d) => walkMd(path.join(root, d)));
  for (const file of files) {
    const text = stripCode(fs.readFileSync(file, 'utf8'));
    const from = rel(root, file);
    const seen = new Set();
    const report = (target) => { if (!seen.has(target)) { seen.add(target); problems.push(`${from} points to ${target}, which does not exist.`); } };
    for (const m of text.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
      const t = m[1].split('#')[0];
      if (!t || /^[a-z]+:/i.test(t)) continue;
      if (!fs.existsSync(path.resolve(path.dirname(file), t))) report(t);
    }
    for (const m of text.matchAll(/`([^`\n]+)`/g)) {
      const t = m[1].trim().replace(/^\.\//, '');
      if (!SCOPE.some((s) => t.startsWith(s))) continue;
      if (/[\s*<>$~{}|?]|\.\.\./.test(t) || /YYYY/.test(t) || !/\.[a-z0-9]+$/i.test(t)) continue;
      if (!fs.existsSync(path.join(root, t))) report(t);
    }
  }
  return problems;
}

export function parseFrontmatter(text) {
  const m = text.replace(/^﻿/, '').match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return null;
  const fm = {};
  const lines = m[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const kv = lines[i].match(/^([A-Za-z_-]+):\s*(.*)$/);
    if (!kv) continue;
    let v = kv[2].trim();
    if (/^[>|][+-]?$/.test(v)) {
      v = '';
      while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1])) v += ' ' + lines[++i].trim();
      v = v.trim();
    } else v = v.replace(/^(["'])([\s\S]*)\1$/, '$2');
    fm[kv[1]] = v;
  }
  return fm;
}

export function checkSkills(root) {
  const problems = [];
  const sdir = path.join(root, 'core', 'skills');
  if (!fs.existsSync(sdir)) return problems;
  for (const d of fs.readdirSync(sdir, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const f = path.join(sdir, d.name, 'SKILL.md');
    const name = `core/skills/${d.name}/SKILL.md`;
    if (!fs.existsSync(f)) { problems.push(`The skill folder core/skills/${d.name} has no SKILL.md.`); continue; }
    const fm = parseFrontmatter(fs.readFileSync(f, 'utf8'));
    if (!fm || !fm.description) { problems.push(`${name} has no description.`); continue; }
    const total = fm.description.length + (fm.when_to_use ? fm.when_to_use.length : 0);
    if (total > MAX_DESCRIPTION) problems.push(`${name}: the description is ${total} characters; the official limit is ${MAX_DESCRIPTION}.`);
    if (!WHEN.test(fm.description + ' ' + (fm.when_to_use || ''))) problems.push(`${name}: the description does not say when to use the skill.`);
  }
  return problems;
}

export function run(root) {
  const sections = [['index', checkIndex(root)], ['links', checkLinks(root)], ['skills', checkSkills(root)]];
  const lines = [];
  for (const [n, ps] of sections) {
    if (!ps.length) lines.push(`OK|The ${n} check found nothing to fix.`);
    else for (const p of ps) lines.push(`NEEDS|${p}`);
  }
  return lines;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = process.env.HIVE_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const lines = run(root);
  console.log(lines.join('\n'));
  process.exit(lines.some((l) => l.startsWith('NEEDS|')) ? 1 : 0);
}
