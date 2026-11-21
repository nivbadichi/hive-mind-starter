#!/usr/bin/env node
// Checks the manuals (README.md, SETUP.md, docs/*.md) against the rest of this copy. It only reads; it changes nothing.
//
//   node docs/tools/check-manuals.mjs            one line per check: OK|text or NEEDS|text, then SCORE lines; exit 1 on any NEEDS
//   node docs/tools/check-manuals.mjs --report   the same, always exit 0
//
// What it checks:
//   links     every link between pages leads to a file that exists, and every #part to a heading on that page
//   you       no manual speaks of "the owner": a manual speaks to "you"
//   phrases   every phrase in the "Things to say" table of daily-use.md is one a helper or CLAUDE.md answers to
//   parts     every top-level file and folder of this copy, and every file the installer puts in place, is named in parts.md
//   leaves    every arrow of the map that leaves the computer goes somewhere listed in system/what-leaves.md (or is marked "only if")
//   words     every inside word a manual uses is explained in words.md
//   ease      the reading-ease score (Flesch) of each manual; the person's pages must reach MIN_EASE
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const MIN_EASE = 60;
// Pages a person reads from start to end. parts.md and words.md are tables of names, looked up rather than read; they are scored but not held to the bar.
export const HELD_TO_EASE = ['README.md', 'SETUP.md', 'docs/first-hour.md', 'docs/daily-use.md', 'docs/when-it-breaks.md', 'docs/map.md'];
// Words a newcomer may not know. Each one a manual uses must have its own row in words.md.
export const INSIDE_WORDS = ['repository', 'repo', 'template', 'fork', 'commit', 'push', 'hook', 'gate', 'session', 'subagent', 'protocol',
  'connector', 'MCP', 'dashboard', 'snapshot', 'deploy', 'terminal', 'command', 'winget', 'installer', 'CLI', 'worktree', 'plugin',
  'marketplace', 'PATH', 'backup', 'Node', 'Git', 'GitHub', 'skill', 'helper', 'brief', 'permission mode', 'Claude Code', 'health check', 'Docker', 'container'];

const read = (root, rel) => { try { return fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n'); } catch { return null; } };

export function manualFiles(root) {
  const out = ['README.md', 'SETUP.md'].filter((f) => fs.existsSync(path.join(root, f)));
  try { for (const f of fs.readdirSync(path.join(root, 'docs')).sort()) if (f.endsWith('.md')) out.push(`docs/${f}`); } catch {}
  return out;
}

/** GitHub's way of turning a heading into a #part of the address. */
export function slug(heading) {
  return heading.trim().toLowerCase().replace(/[`*_]/g, '').replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s/g, '-');
}
export const headings = (text) => (text.match(/^#{1,6} .+$/gm) || []).map((h) => slug(h.replace(/^#+ /, '')));
const withoutCode = (text) => text.replace(/```[\s\S]*?```/g, '');

export function checkLinks(root, files) {
  const bad = [];
  for (const f of files) {
    const text = withoutCode(read(root, f) || '');
    for (const m of text.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
      const target = m[1];
      if (/^(https?:|mailto:)/.test(target)) continue;
      const [file, part] = target.split('#');
      const rel = file ? path.posix.normalize(path.posix.join(path.posix.dirname(f), file)) : f;
      const body = read(root, rel);
      if (body === null) { bad.push(`${f} -> ${target} (no such file)`); continue; }
      if (part && !headings(body).includes(part)) bad.push(`${f} -> ${target} (no such heading)`);
    }
  }
  return bad;
}

export function checkYou(root, files) {
  const bad = [];
  for (const f of files) (read(root, f) || '').split('\n').forEach((l, i) => { if (/\bowners?\b/i.test(l.replace(/\*\*Owner\*\*/g, ''))) bad.push(`${f}:${i + 1}`); });
  return bad;
}

function walk(root, rel, out) {
  let entries = [];
  try { entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) walk(root, r, out); else if (e.name.endsWith('.md')) out.push(r);
  }
  return out;
}

/** The phrases of the "Things to say" table: the first "quoted" text of each row's first cell. */
export function phrasesOf(dailyUse) {
  const part = (dailyUse.split(/^## Things to say$/m)[1] || '').split(/^## /m)[0];
  return part.split('\n').filter((l) => /^\|\s*"/.test(l)).map((l) => (l.match(/"([^"]+)"/) || [])[1]).filter(Boolean);
}

export function checkPhrases(root) {
  const daily = read(root, 'docs/daily-use.md');
  if (daily === null) return { phrases: [], missing: ['docs/daily-use.md is missing'] };
  const sources = [...walk(root, 'core/skills', []), 'CLAUDE.md', 'core/claude-md.md'].map((f) => (read(root, f) || '').toLowerCase()).join('\n');
  const phrases = phrasesOf(daily);
  return { phrases, missing: phrases.filter((p) => !sources.includes(p.toLowerCase())) };
}

/** Files the installer puts in place, read from the installer itself, so a new file shows up here by itself. */
export function installedNames(root) {
  const names = new Set();
  const ps = read(root, 'core/gates/install.ps1') || '';
  for (const m of ps.matchAll(/Put-File\s+\([^)]*\)\s+\(Join-Path\s+\$\w+\s+["']([^"']+)["']\)/g)) names.add(m[1].replace(/\$\([^)]*\)/g, '').split('\\').filter(Boolean).pop());
  for (const m of ps.matchAll(/Join-Path\s+\$ClaudeDir\s+'([^']+)'/g)) names.add(m[1]);
  for (const m of ps.matchAll(/Join-Path\s+\$hooks\s+'([^']+)'/g)) names.add(m[1]);
  names.delete('SKILL.md'); // one per helper; the helpers' folder is what parts.md names
  names.delete('hive');
  return [...names].filter(Boolean);
}

export function checkParts(root) {
  const parts = read(root, 'docs/parts.md');
  if (parts === null) return ['docs/parts.md is missing'];
  const named = (n) => parts.includes('`' + n + '`') || parts.includes('`' + n + '/') || parts.includes('/' + n + '`') || parts.includes(n + '`,');
  const top = fs.readdirSync(root).filter((n) => !['.git', 'node_modules'].includes(n));
  const missing = top.filter((n) => !named(n)).map((n) => `top level: ${n}`);
  for (const n of installedNames(root)) if (!parts.includes(n)) missing.push(`installed: ${n}`);
  if (fs.existsSync(path.join(root, 'core/skills')) && !parts.includes('.claude/skills')) missing.push('installed: the helpers (.claude/skills)');
  return missing;
}

/** Rows of the map's "Arrows that leave your computer" table: what, where to, when. */
export function leavingRows(map) {
  const part = (map.split(/^## Arrows that leave your computer$/m)[1] || '').split(/^## /m)[0];
  return part.split('\n').filter((l) => /^\|/.test(l) && !/^\|\s*-/.test(l)).slice(1).map((l) => l.split('|').slice(1, -1).map((c) => c.trim()));
}

export function checkLeaves(root) {
  const map = read(root, 'docs/map.md');
  const leaves = (read(root, 'system/what-leaves.md') || '').toLowerCase();
  if (map === null) return ['docs/map.md is missing'];
  const rows = leavingRows(map);
  if (!rows.length) return ['docs/map.md has no "Arrows that leave your computer" table'];
  const drawn = (map.match(/leaves your computer:/g) || []).length;
  const bad = [];
  if (drawn !== rows.length) bad.push(`the picture draws ${drawn} leaving arrows, the table lists ${rows.length}`);
  for (const [what, where, when = ''] of rows) {
    if (/only if/i.test(when)) continue; // added to what-leaves.md on the day it is switched on
    const key = where.replace(/\*|`/g, '').split(/[,:(]/)[0].trim().toLowerCase();
    if (!key || !leaves.includes(key)) bad.push(`${what} -> ${where} is not in system/what-leaves.md`);
  }
  return bad;
}

export function glossaryTerms(words) {
  return words.split('\n').filter((l) => /^\|\s*\*\*/.test(l)).flatMap((l) => (l.match(/\*\*([^*]+)\*\*/) || [, ''])[1].split(',')).map((t) => t.replace(/`/g, '').trim().toLowerCase()).filter(Boolean);
}

export function checkWords(root, files) {
  const words = read(root, 'docs/words.md');
  if (words === null) return ['docs/words.md is missing'];
  const terms = glossaryTerms(words);
  const sing = (x) => x.replace(/s$/, '');
  const has = (w) => terms.some((t) => t === w.toLowerCase() || sing(t) === sing(w.toLowerCase()) || t.startsWith(w.toLowerCase() + ' ') || t.split(/\s+/).includes(w.toLowerCase()));
  const bad = new Set();
  for (const f of files) {
    if (f === 'docs/words.md' || f === 'docs/build-log.md') continue;
    const text = withoutCode(read(root, f) || '').replace(/`[^`]*`/g, '').replace(/\]\([^)]*\)/g, ']');
    for (const w of INSIDE_WORDS) {
      const re = new RegExp(`\\b${w.replace(/ /g, '\\s+')}(s|es)?\\b`, w === w.toUpperCase() || /^[A-Z]/.test(w) ? '' : 'i');
      if (re.test(text) && !has(w)) bad.add(`${w} (first in ${f})`);
    }
  }
  return [...bad];
}

/** Syllables of an English word, by the usual vowel-group count. Good enough to compare pages, not exact. */
export function syllables(word) {
  let w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return 0;
  if (w.length <= 3) return 1;
  w = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').replace(/^y/, '');
  const groups = w.match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups ? groups.length : 1);
}

/** Plain text of a page for scoring: no code, no addresses, no table rules, no markup. */
export function proseOf(md) {
  // A table row counts as one sentence (its cells joined by commas), so short cells do not flatter the score.
  return md.replace(/```[\s\S]*?```/g, ' ').replace(/`[^`]*`/g, ' ').replace(/\]\([^)]*\)/g, ']').replace(/^\|\s*-[-|\s]*$/gm, '')
    .replace(/^\s*\|/gm, '').replace(/\|\s*$/gm, '.').replace(/\|/g, ',').replace(/[#>*_\[\]]/g, ' ').replace(/^\s*[-\d]+[.)]?\s+/gm, '');
}

/** Flesch Reading Ease: 206.835 - 1.015 (words per sentence) - 84.6 (syllables per word). 60 and above is plain English. */
export function readingEase(text) {
  const sentences = text.split(/[.!?\n]+/).map((s) => s.trim()).filter((s) => /[a-z]/i.test(s));
  const words = text.match(/[A-Za-z][A-Za-z'-]*/g) || [];
  if (!sentences.length || !words.length) return null;
  const syl = words.reduce((n, w) => n + syllables(w), 0);
  return Math.round((206.835 - 1.015 * (words.length / sentences.length) - 84.6 * (syl / words.length)) * 10) / 10;
}

export function run(root) {
  const lines = [];
  const say = (ok, text) => lines.push(`${ok ? 'OK' : 'NEEDS'}|${text}`);
  const files = manualFiles(root);
  const links = checkLinks(root, files);
  say(!links.length, `Every link between the manuals leads somewhere (${files.length} pages)` + (links.length ? `: ${links.slice(0, 5).join('; ')}` : ''));
  const you = checkYou(root, files);
  say(!you.length, 'No manual speaks of "the owner"' + (you.length ? `: ${you.join(', ')}` : ''));
  const { phrases, missing } = checkPhrases(root);
  say(!missing.length, `Every phrase in "Things to say" is one a helper or CLAUDE.md answers to (${phrases.length} phrases)` + (missing.length ? `; not found: ${missing.join('; ')}` : ''));
  const parts = checkParts(root);
  say(!parts.length, 'Every top-level part and every installed file is named in parts.md' + (parts.length ? `; missing: ${parts.join('; ')}` : ''));
  const leaves = checkLeaves(root);
  say(!leaves.length, 'Every arrow of the map that leaves the computer is in What leaves your computer' + (leaves.length ? `; ${leaves.join('; ')}` : ''));
  const words = checkWords(root, files);
  say(!words.length, 'Every inside word the manuals use is explained in words.md' + (words.length ? `; missing: ${words.join(', ')}` : ''));
  const low = [];
  for (const f of files) {
    const score = readingEase(proseOf(read(root, f) || ''));
    lines.push(`SCORE|${f}|${score}`);
    if (HELD_TO_EASE.includes(f) && (score === null || score < MIN_EASE)) low.push(`${f} ${score}`);
  }
  say(!low.length, `Each page a person reads through scores ${MIN_EASE} or more for reading ease (Flesch)` + (low.length ? `; below: ${low.join(', ')}` : ''));
  return lines;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = process.env.MANUALS_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const lines = run(root);
  process.stdout.write(lines.join('\n') + '\n');
  if (!process.argv.includes('--report') && lines.some((l) => l.startsWith('NEEDS|'))) process.exit(1);
}
