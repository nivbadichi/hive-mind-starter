#!/usr/bin/env node
// App brief: writes, from the notebook, the text a project in the Claude app carries (its instructions and its knowledge).
// The notebook stays the one home of every truth (rule 8); this text is a dated copy that says so.
//
//   node core/engine/app-brief.mjs <project> [--out <folder>]   writes instructions.md and digest.md
//   node core/engine/app-brief.mjs <project> --check [--out ..]  OK|text or NEEDS|text: is the written copy current?
//
// Reads only: system/rules.md, system/decisions-in-force.md, projects/<project>/state.md. Never me/ or archive/.
// Writes only to the folder named (default system/generated/app/). Never calls the app, uploads or publishes.
// Places: HIVE_ROOT (the notebook), HIVE_DATE (for tests).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.env.HIVE_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const LIMIT = 16000;
export const TARGET = 6000;
export const EDIT_LINE = 'Edit the notebook, not this text. This text is a dated copy made by a program; a change made only here is lost at the next copy.';
const today = () => process.env.HIVE_DATE || (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();

// A secret-shaped string stops the copy; a copy that leaks is worse than no copy (rule 9).
const SECRET = [/\bsk-[A-Za-z0-9_-]{16,}/, /\bghp_[A-Za-z0-9]{16,}/, /\bgithub_pat_[A-Za-z0-9_]{16,}/, /\bAKIA[0-9A-Z]{12,}/,
  /\beyJ[A-Za-z0-9_-]{20,}\./, /\bxox[abp]-[A-Za-z0-9-]{10,}/, /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\b(api[_-]?key|secret|token|password)\s*[:=]\s*\S{8,}/i];
export const hasSecret = (t) => SECRET.some((r) => r.test(t));

const read = (rel) => { try { return fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n'); } catch { return ''; } };
const clip = (s, n) => (s.length <= n ? s : s.slice(0, n - 1).replace(/\s+\S*$/, '') + '...');
const plain = (s) => s.replace(/\*\*/g, '').replace(/`/g, '').trim();

export function frontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n?/);
  const fm = {};
  if (m) for (const line of m[1].split('\n')) { const i = line.indexOf(':'); if (i > 0) fm[line.slice(0, i).trim()] = line.slice(i + 1).trim(); }
  return { fm, body: m ? text.slice(m[0].length) : text };
}

export function shortRules(text) {
  const out = [];
  for (const line of text.split('\n')) {
    const m = line.match(/^(\d+)\.\s+(.*)$/);
    if (!m) continue;
    const first = plain(m[2]).match(/^.*?[.!?](\s|$)/);
    out.push(`${m[1]}. ${clip(first ? first[0].trim() : plain(m[2]), 170)}`);
  }
  return out;
}

export function decisionLines(text) {
  return text.split('\n').filter((l) => /^- /.test(l)).map((l) => '- ' + clip(plain(l.slice(2)), 260));
}

export function build(project, date = today()) {
  const rulesText = read('system/rules.md');
  const decisions = read('system/decisions-in-force.md');
  const stateText = read(`projects/${project}/state.md`);
  if (!stateText) throw new Error(`no state note for project "${project}" (projects/${project}/state.md)`);
  const { fm, body } = frontmatter(stateText);
  const employer = /^(employer|shared)\b/i.test(fm.kind || '') || /employer or shared project:\s*yes/i.test(read(`projects/${project}/profile.md`));
  const rules = shortRules(rulesText);
  const name = fm.project || project;

  const stateLines = [`- Stage: ${plain(fm.stage || 'not set')}`, `- Health: ${plain(fm.health || 'not set')}`, `- Next step: ${plain(fm.next_step || 'not set')}`];
  if (!employer) {
    if (fm.needs_you) stateLines.push(`- Needs the person: ${plain(fm.needs_you)}`);
    if (fm.design_direction) stateLines.push(`- Design direction note: ${fm.design_direction}`);
  }
  stateLines.push(`- State note updated: ${fm.updated || 'not set'}`);
  const goal = body.split('\n').map((l) => l.trim()).find((l) => l && !l.startsWith('#') && !l.startsWith('-'));

  const header = (kind) => [`# ${name}: ${kind}`, '', `Generated: ${date}. Source: the notebook (system/rules.md, system/decisions-in-force.md, projects/${project}/state.md).`, `**${EDIT_LINE}**`, ''];
  const stateBlock = ['## Where the project stands', ...(goal ? [plain(goal), ''] : []), ...stateLines, ...(employer ? ['', 'Employer or shared project: this text stays high level on purpose.'] : []), ''];

  const instructions = [
    ...header('project instructions'),
    '## The notebook is the truth',
    '- Decisions, rules and lessons go to the notebook in a commit, never only to project memory or to this project.',
    '- Project memory holds pointers only: where in the notebook to look.',
    '- Before work, read the notebook root `CLAUDE.md`, then `projects/' + project + '/state.md`.',
    '',
    '## Rules in short (full text: system/rules.md)',
    ...rules, '',
    ...stateBlock,
    '## How to work here',
    '- Understand first, then plan, then build; ask the person before anything public, anything that leaves the machine, any spend.',
    '- Say what was checked and what was not. Plain words, short reports.',
    '- A helper chat started by another chat reports back with SendMessage, not to the person.',
    '',
  ].join('\n');

  const dlines = decisionLines(decisions);
  const digestHead = [...header('digest for chat project knowledge'), '## Rules (full text: system/rules.md)', ...rules, '', ...stateBlock, '## Decisions in force (full text: system/decisions-in-force.md)'];
  let digest = '';
  for (let kept = dlines.length; kept >= 0; kept--) {
    const note = kept < dlines.length ? [`(${dlines.length - kept} more lines: read system/decisions-in-force.md in the notebook.)`] : [];
    digest = [...digestHead, ...dlines.slice(0, kept), ...note, ''].join('\n');
    if (digest.length <= LIMIT) break;
  }
  const out = { 'instructions.md': instructions, 'digest.md': digest };
  for (const [f, t] of Object.entries(out)) {
    if (t.length > LIMIT) throw new Error(`${f} is ${t.length} characters, over the limit of ${LIMIT}`);
    if (hasSecret(t)) throw new Error(`${f} holds a secret-shaped string; nothing written`);
  }
  return out;
}

const stripDate = (t) => t.replace(/^Generated: \S+?\./m, 'Generated: -.');

function main(argv) {
  const args = argv.slice(2);
  const oi = args.indexOf('--out');
  const outDir = path.resolve(ROOT, oi >= 0 ? args[oi + 1] : path.join('system', 'generated', 'app'));
  const project = args.find((a, i) => !a.startsWith('--') && (oi < 0 || i !== oi + 1));
  if (!project) { console.error('usage: app-brief.mjs <project> [--out <folder>] [--check]'); return 2; }
  const rel = path.relative(ROOT, outDir).split(path.sep);
  if (['me', 'archive'].includes(rel[0])) { console.error('refused: the output folder may not be me/ or archive/'); return 2; }
  let files;
  try { files = build(project); } catch (e) { console.error(e.message); return 1; }
  if (args.includes('--check')) {
    const stale = Object.entries(files).filter(([f, t]) => { try { return stripDate(fs.readFileSync(path.join(outDir, f), 'utf8')) !== stripDate(t); } catch { return true; } }).map(([f]) => f);
    console.log(stale.length ? `NEEDS|app brief out of date: ${stale.join(', ')} (run: node core/engine/app-brief.mjs ${project})` : 'OK|app brief is current');
    return stale.length ? 1 : 0;
  }
  fs.mkdirSync(outDir, { recursive: true });
  for (const [f, t] of Object.entries(files)) { fs.writeFileSync(path.join(outDir, f), t); console.log(`${path.join(outDir, f)}  ${t.length} characters`); }
  return 0;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv);
