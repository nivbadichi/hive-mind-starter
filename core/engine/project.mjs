#!/usr/bin/env node
// Sets up a new project in the notebook (gap review E1). It only ever creates; it never touches an existing project folder.
//
//   node core/engine/project.mjs new-project --name "Garden" --purpose "The garden at home: what to plant and when" \
//        [--folder "~/garden"] [--kind personal|employer] [--stage discover]
//
// Writes projects/<name>/state.md (every field the health check demands), projects/<name>/profile.md (the template) and
// projects/<name>/stack.md (the full stack checklist, core/engine/stack.mjs), then prints the health check's project lines as OK|text or NEEDS|text. Places: HIVE_ROOT, HIVE_DATE (for tests).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { newNote } from './stack.mjs';

const ROOT = process.env.HIVE_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const today = () => process.env.HIVE_DATE || (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();
export const STAGES = ['discover', 'define', 'plan', 'design', 'build', 'verify', 'release', 'maintain', 'close', 'paused', 'not set up'];
export const FIELDS = ['project', 'kind', 'stage', 'health', 'next_step', 'needs_you', 'updated'];
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const oneLine = (s) => String(s || '').replace(/\s+/g, ' ').trim();

export function newProject(o) {
  const name = oneLine(o.name);
  if (!name) throw new Error('A project needs a name (--name)');
  const purpose = oneLine(o.purpose);
  if (!purpose) throw new Error('Say what the project is for (--purpose)');
  const kind = (o.kind || 'personal').toLowerCase();
  if (!['personal', 'employer'].includes(kind)) throw new Error('The kind must be personal or employer');
  const stage = o.stage || 'discover';
  if (!STAGES.includes(stage)) throw new Error(`The stage must be one of: ${STAGES.join(', ')}`);
  const dir = path.join(ROOT, 'projects', slug(name));
  if (!slug(name)) throw new Error('The name has no usable letters');
  if (fs.existsSync(dir)) throw new Error(`projects/${slug(name)} already exists; it was not touched`);

  const lines = ['---', `project: ${name}`, `kind: ${kind}`];
  if (oneLine(o.folder)) lines.push(`folder: ${oneLine(o.folder)}`);
  lines.push(`stage: ${stage}`, 'health: unknown', 'next_step: Confirm what this project is for and who it is for.', 'needs_you: Nothing yet.');
  if (stage === 'design' || stage === 'build') lines.push('design_direction: none (set one before design or build work)');
  lines.push(`updated: ${today()}`, '---', '', `# ${name}`, '', purpose + (kind === 'employer' ? ' Employer project: keep notes high level, no confidential details and no secrets.' : ''), '');
  const tpl = path.join(ROOT, 'core', 'templates', 'project-profile.md');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'state.md'), lines.join('\n'));
  let profile = '# Project profile\n';
  try { profile = fs.readFileSync(tpl, 'utf8').replace('<project name>', name).replace('Employer or shared project: <yes or no>', `Employer or shared project: ${kind === 'employer' ? 'yes' : 'no'}`); } catch {}
  fs.writeFileSync(path.join(dir, 'profile.md'), profile);
  // The full stack checklist (promise 13). Left out only when this notebook has no system/stack.md to copy the lines from.
  let stack = null;
  try { stack = newNote(slug(name), { purposeKnown: true }); } catch (e) { stack = null; }
  return { dir, slug: slug(name), stack };
}

// The health check's lines for one project (system/check.ps1 section 6 and 7b), read-only.
export function projectLines(slugName) {
  const out = []; const say = (ok, t) => out.push(`${ok ? 'OK' : 'NEEDS'}|${t}`);
  let t = null;
  try { t = fs.readFileSync(path.join(ROOT, 'projects', slugName, 'state.md'), 'utf8'); } catch {}
  if (t === null) { say(false, `Project ${slugName} has no state note`); return out; }
  const has = (k) => new RegExp(`^${k}:\\s*\\S`, 'm').test(t);
  const missing = FIELDS.filter((k) => !has(k));
  say(!missing.length, `Project ${slugName}: state has every field` + (missing.length ? ` (missing: ${missing.join(', ')})` : ''));
  say(t.length <= 2500, `Project ${slugName}: state is short`);
  const m = t.match(/^updated:\s*(\d{4}-\d{2}-\d{2})/m);
  if (m) say((Date.parse(today()) - Date.parse(m[1])) / 86400000 <= 14, `Project ${slugName}: state updated in the last 14 days`);
  const st = (t.match(/^stage:\s*(.+?)\s*$/m) || [])[1] || '';
  say(STAGES.some((s) => st === s || st.startsWith(s + ' ') || st.startsWith(s + ' (') || st.startsWith(s + ',')), `Project ${slugName}: stage starts with a word from the fixed list (${st || 'empty'})`);
  if (/^stage:\s*(design|build)/m.test(t)) {
    const dd = (t.match(/^design_direction:\s*(.+?)\s*$/m) || [])[1] || '';
    say(/^none\b/.test(dd) || (dd && fs.existsSync(path.join(ROOT, dd))), `Project ${slugName}: names its design direction note (${dd || 'missing'})`);
  }
  return out;
}

function main(argv) {
  const [cmd, ...args] = argv; const f = {};
  for (let i = 0; i < args.length; i++) if (args[i].startsWith('--')) f[args[i].slice(2)] = args[i + 1] !== undefined && !args[i + 1].startsWith('--') ? args[++i] : 'true';
  try {
    if (cmd !== 'new-project') { console.log('Command: new-project --name .. --purpose .. [--folder ..] [--kind personal|employer] [--stage ..]'); process.exitCode = 2; return; }
    const { slug: s, stack } = newProject(f);
    console.log(`Created projects/${s}/state.md and projects/${s}/profile.md` + (stack ? ` and projects/${s}/stack.md (tags: ${stack.tags.join(', ')}; see the first three missing lines: node core/engine/stack.mjs next ${s}).` : '. No stack checklist was made: the project is paused or not set up, or system/stack.md was not found.'));
    const lines = projectLines(s); lines.forEach((l) => console.log(l));
    process.exitCode = lines.some((l) => l.startsWith('NEEDS')) ? 1 : 0;
  } catch (e) { console.error(`NEEDS|${e.message}`); process.exitCode = 1; }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
