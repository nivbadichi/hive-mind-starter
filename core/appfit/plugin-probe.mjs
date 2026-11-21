#!/usr/bin/env node
// The cloud plugin probe (change C8 of the app-fit note): one question, answered by one real run.
// "Does a plugin added in Project settings > Plugins run its hooks in a cloud thread of a Claude Code Project?"
// The official pages, read 2026-11-20: a cloud thread does not run the hooks in a repository's .claude/settings.json;
// plugins added in Project settings > Plugins "load into each new cloud thread" (code.claude.com/docs/en/claude-projects);
// nothing there says whether their hooks run. So the probe is the smallest plugin that answers it: one SessionStart hook
// that prints one fixed line, which a SessionStart hook's plain output adds to the chat's context (hooks page).
// It carries nothing of the notebook, so a copy of it anywhere shows no note.
//
//   node core/appfit/plugin-probe.mjs build <empty folder>   write the probe: a marketplace with the one plugin
//   node core/appfit/plugin-probe.mjs check <folder>         offline check of the layout against the plugin pages; one
//                                                            line per check, OK or NEEDS; exit 1 on any NEEDS
//   node core/appfit/plugin-probe.mjs steps                  the steps of the real run, for you
// The real run needs you: the folder must be put where claude.ai can reach it (your GitHub), then added to a
// Project. That leaves the computer, so it waits for your yes. Tell Claude the answer, so it can be saved in your notes.
// The official check `claude plugin validate <folder>` is not run here; the lead runs it before the real run.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const NAME = 'hive-probe';
export const PROBE_TEXT = 'HIVE PLUGIN PROBE: the start hook of the hive-probe plugin ran in this session.';
// Plain words and spaces only, so the same line works in bash (cloud), cmd and PowerShell.
export const hookCommand = () => `echo ${PROBE_TEXT}`;

// Exactly these files make the probe; the check refuses anything else.
const FILES = ['.claude-plugin/marketplace.json', `plugins/${NAME}/.claude-plugin/plugin.json`, `plugins/${NAME}/hooks/hooks.json`, 'README.md'];

function write(dir, rel, text) { const p = path.join(dir, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); }
const json = (o) => JSON.stringify(o, null, 2) + '\n';

export function steps() {
  return [
    'The real run (needs you: it puts a folder on GitHub and adds a plugin to a Project in your account).',
    '1. Make the probe: node core/appfit/plugin-probe.mjs build <empty folder>; then node core/appfit/plugin-probe.mjs check <folder>; then claude plugin validate <folder>.',
    '2. Put that folder alone in a new private GitHub repository of yours (not the notebook: the probe must carry no note).',
    '3. In claude.ai/code, open a test Project (Projects are in public beta and rolling out), Project settings > Plugins, add the plugin hive-probe from that repository.',
    '4. Start a new cloud thread in that Project and ask it: "Is the line HIVE PLUGIN PROBE in your context? Answer yes or no, and quote it."',
    '5. Yes: plugin hooks run in cloud threads, so the gates could ride in the Hive Mind plugin there. No: cloud threads stay held by text only (decision D2).',
    '6. Tell Claude the answer, then remove the plugin from the Project and delete the test repository.',
  ].join('\n');
}

export function build(dir) {
  if (fs.existsSync(dir) && fs.readdirSync(dir).length) throw new Error(`${dir} is not empty; the probe is built only in an empty folder, so it carries nothing else`);
  write(dir, '.claude-plugin/marketplace.json', json({
    name: NAME,
    description: 'One test plugin that answers whether plugin hooks run in a cloud thread of a Claude Code Project.',
    owner: { name: 'Hive Mind' },
    plugins: [{ name: NAME, source: `./plugins/${NAME}`, description: 'Prints one fixed line when a session starts.' }],
  }));
  write(dir, `plugins/${NAME}/.claude-plugin/plugin.json`, json({
    name: NAME, version: '0.0.1', description: 'Prints one fixed line when a session starts, to prove that its hook ran.', author: { name: 'Hive Mind' },
  }));
  write(dir, `plugins/${NAME}/hooks/hooks.json`, json({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command: hookCommand(), timeout: 10 }] }] } }));
  write(dir, 'README.md', `# hive-probe\n\nA test plugin with one start hook. When a session starts, it prints:\n\n    ${PROBE_TEXT}\n\nIf that line is in a cloud thread's context, plugin hooks run there.\n\n${steps()}\n`);
  return FILES.map((f) => path.join(dir, f));
}

const RESERVED_EXACT = ['claude', 'anthropic', 'anthropics', 'claude-code', 'claude-mods'];
function nameFault(n) {
  if (typeof n !== 'string' || !n) return 'has no name';
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(n)) return `name "${n}" may use only letters, digits, ".", "_" and "-"`;
  const k = n.toLowerCase();
  if (/^(claude|anthropic|anthropics|cc-plugin)-/.test(k) || RESERVED_EXACT.includes(k) || /official/.test(k) && /claude|anthropic/.test(k)) return `name "${n}" is reserved: it passes as one of Anthropic's own`;
  return '';
}
function listAll(dir, base = dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) listAll(p, base, out); else out.push(path.relative(base, p).replace(/\\/g, '/'));
  }
  return out;
}

/** Offline check: OK|... and NEEDS|... lines. */
export function check(dir) {
  const out = [];
  const ok = (t) => out.push(`OK ${t}`), bad = (t) => out.push(`NEEDS ${t}`);
  const load = (rel) => { try { return JSON.parse(fs.readFileSync(path.join(dir, rel), 'utf8')); } catch { return null; } };
  const mk = load('.claude-plugin/marketplace.json');
  if (!mk) { bad('.claude-plugin/marketplace.json is missing or not JSON'); return out; }
  const mf = nameFault(mk.name);
  if (mf) bad(`marketplace ${mf}`); else ok(`marketplace name ${mk.name}`);
  if (!mk.owner || !mk.owner.name) bad('marketplace owner.name is missing'); else ok('marketplace owner');
  if (!Array.isArray(mk.plugins) || mk.plugins.length !== 1) { bad('the marketplace must list exactly one plugin'); return out; }
  const entry = mk.plugins[0];
  const src = String(entry.source || '');
  if (!src.startsWith('./') || src.includes('..') || src.includes('\\')) bad(`plugin source "${src}" must start with ./ and stay inside the marketplace`); else ok(`plugin source ${src}`);
  const pdir = path.join(dir, src);
  const pj = load(path.posix.join(src, '.claude-plugin/plugin.json'));
  if (!pj) { bad('the plugin has no .claude-plugin/plugin.json'); return out; }
  const pf = nameFault(pj.name);
  if (pf) bad(`plugin ${pf}`); else ok(`plugin name ${pj.name}`);
  if (entry.name !== pj.name) bad(`the marketplace lists "${entry.name}" but the plugin is named "${pj.name}"`);
  const hk = load(path.posix.join(src, 'hooks/hooks.json'));
  if (!hk) bad('hooks/hooks.json is missing or not JSON');
  else if (!hk.hooks || typeof hk.hooks !== 'object') bad('hooks/hooks.json must wrap its events in a top-level "hooks" wrapper');
  else {
    const ss = hk.hooks.SessionStart;
    const cmds = Array.isArray(ss) ? ss.flatMap((g) => (g.hooks || [])) : [];
    if (!cmds.length || cmds.some((h) => h.type !== 'command')) bad('hooks/hooks.json needs one SessionStart command hook');
    else if (!cmds.some((h) => String(h.command || '').includes(PROBE_TEXT))) bad('the SessionStart hook does not print the probe line');
    else ok('one SessionStart hook that prints the probe line');
  }
  if (fs.existsSync(path.join(pdir, 'CLAUDE.md'))) bad('a CLAUDE.md at the plugin root is not loaded; remove it');
  const extra = listAll(dir).filter((f) => !FILES.includes(f));
  if (extra.length) bad(`files that are not part of the probe: ${extra.join(', ')}`); else ok('nothing else in the folder');
  return out;
}

function main(argv) {
  const [cmd, dir] = argv;
  if (cmd === 'steps') { console.log(steps()); return 0; }
  if (cmd === 'build' && dir) { try { build(path.resolve(dir)); } catch (e) { console.log(`Refused: ${e.message}`); return 1; } console.log(`Built the probe in ${dir}. Next: node core/appfit/plugin-probe.mjs check ${dir}`); return 0; }
  if (cmd === 'check' && dir) { const r = check(path.resolve(dir)); console.log(r.join('\n')); return r.some((l) => l.startsWith('NEEDS')) ? 1 : 0; }
  console.log('Use: build <empty folder> | check <folder> | steps');
  return 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
