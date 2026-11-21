#!/usr/bin/env node
// Do the manuals start from what Claude already does? (change C11 of the app-fit note; its section 5 lists what a
// newcomer gets from the Claude app with no Hive Mind at all). It only reads; it changes nothing.
//
//   node core/appfit/manual-fit.mjs [<copy folder>]     one line per check, OK or NEEDS; exit 1 on any NEEDS
//
// What it checks:
//   parts     docs/claude-app.md has a row for each of Claude's own parts in FEATURES, each with a link to Claude's own help
//   sits-on   each part of Hive Mind on that page says which of Claude's parts it sits on ("Sits on:")
//   reteach   no other manual teaches one of Claude's own commands (they link to Claude's help instead)
//   pointer   README.md points to docs/claude-app.md
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The first words of each row of the table, in the order of the fit note's section 5.
export const FEATURES = [
  'Instructions file and memory notes', 'Skills', 'Plugins and the plugin marketplace', 'Tools Claude can connect to',
  'The desktop app: chats side by side', 'Messages between chats', 'Scheduled runs on this computer', 'Scheduled runs in the cloud',
  'The phone app and Remote Control', 'Chats in the cloud', 'Projects with threads', 'Private pages', 'Fixes for a change on GitHub',
  'The browser in the app',
];
export const HIVE_PARTS = ['Your notes, in one place', 'Your rules, held by checks', 'A start for every chat', 'A front door',
  'A list of your skills, tools, rules and habits', 'A page at one address'];
// Claude's own commands; a manual of Hive Mind links to Claude's help for them and does not teach them.
export const APP_COMMANDS = ['/schedule', '/loop', '/btw', '/memory', '/fork', 'claude remote-control', '/remote-control'];
const OFFICIAL = /\]\((https:\/\/(code\.claude\.com\/docs\/|support\.claude\.com\/|claude\.com\/)[^)]*)\)/;

const read = (root, rel) => { try { return fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n'); } catch { return null; } };

export function checkFit(root) {
  const out = [];
  const ok = (t) => out.push(`OK|${t}`), bad = (t) => out.push(`NEEDS|${t}`);
  const page = read(root, 'docs/claude-app.md');
  if (page === null) { bad('docs/claude-app.md is missing: the manuals have no page for what Claude already does'); return out; }
  const rows = page.split('\n').filter((l) => l.startsWith('| '));
  const missing = [], noLink = [];
  for (const f of FEATURES) {
    const row = rows.find((r) => r.slice(2).startsWith(f));
    if (!row) missing.push(f); else if (!OFFICIAL.test(row)) noLink.push(f);
  }
  if (missing.length) bad(`docs/claude-app.md has no row for: ${missing.join('; ')}`); else ok(`docs/claude-app.md names all ${FEATURES.length} of Claude's own parts`);
  if (noLink.length) bad(`these rows have no link to Claude's own help: ${noLink.join('; ')}`); else ok('every row links to Claude\'s own help');
  const lines = page.split('\n');
  const noBase = HIVE_PARTS.filter((p) => { const l = lines.find((x) => x.startsWith(`- **${p}.**`)); return !l || !/Sits on: /.test(l); });
  if (noBase.length) bad(`these parts of Hive Mind do not say what they sit on: ${noBase.join('; ')}`); else ok('every part of Hive Mind says what it sits on');
  const taught = [];
  const manuals = ['README.md', 'SETUP.md'];
  try { for (const f of fs.readdirSync(path.join(root, 'docs')).sort()) if (f.endsWith('.md') && f !== 'claude-app.md') manuals.push(`docs/${f}`); } catch {}
  for (const m of manuals) {
    const t = read(root, m);
    if (t === null) continue;
    for (const c of APP_COMMANDS) if (new RegExp(`(^|[\\s\`(])${c.replace(/[/-]/g, '\\$&')}(?![\\w-])`, 'm').test(t)) taught.push(`${m} (${c})`);
  }
  if (taught.length) bad(`these manuals teach one of Claude's own commands; link to Claude's help instead: ${taught.join(', ')}`); else ok('no manual teaches one of Claude\'s own commands');
  const readme = read(root, 'README.md') || '';
  if (/\]\(docs\/claude-app\.md[)#]/.test(readme)) ok('README.md points to the page'); else bad('README.md does not point to docs/claude-app.md');
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(process.argv[2] || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..'));
  const r = checkFit(root);
  console.log(r.join('\n'));
  process.exitCode = r.some((l) => l.startsWith('NEEDS')) ? 1 : 0;
}
