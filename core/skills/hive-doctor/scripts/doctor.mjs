#!/usr/bin/env node
// Hive Mind doctor: finds what is broken in the parts on this computer. Reads only; changes nothing.
// Works the same on Windows, Mac and Linux (Node only, no PowerShell).
//
//   node core/skills/hive-doctor/scripts/doctor.mjs            check this computer
//   node core/skills/hive-doctor/scripts/doctor.mjs --json     the same, as JSON
//   node core/skills/hive-doctor/scripts/doctor.mjs --code     only the Hive Mind code (one line, no path or name)
//   options: --online        also ask GitHub, with no sign-in, whether the online copy can be read by anyone. The ONLY
//                            option that sends anything off this computer; use it only after the person said yes.
//            --home <dir>    a made-up home folder (tests; never needed for real use)
//            --claude <dir>  Claude's folder (default <home>/.claude, or CLAUDE_DIR)
//            --root <dir>    the notebook (default: HIVE_ROOT, then <claude>/hive/config.json, then <home>/hive-mind)
//            --here <dir>    the folder the chat is in (default: the current folder)
//   HIVE_STANDIN_ONLINE=public|private   tests and walks only: the answer of a LOCAL folder standing in for GitHub
//
//
// Each line: "OK   <id>  <text>", "FIX  <id>  <text>" or "NOTE <id>  <text>". The id names the fix in SKILL.md.
// Exit code: 0 when nothing needs fixing, 1 when at least one FIX line, 2 for a wrong option. With --code: 0 (the code
// itself says what is not done).
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { encode, systemOf } from '../../../journey/code.mjs';

const GATE_MODES = ['pretool', 'posttool', 'prompt', 'stop', 'precompact'];
const START_PARTS = ['rules', 'state', 'flight'];

function readText(file) { try { return fs.readFileSync(file, 'utf8'); } catch { return null; } }
function isNotebook(dir) { return !!dir && fs.existsSync(path.join(dir, 'system', 'rules.md')); }
function norm(s) { return s.replace(/\r\n/g, '\n'); }
const same = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

export function parseArgs(argv) {
  const o = { json: false, code: false, online: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') { o.json = true; continue; }
    if (a === '--code') { o.code = true; continue; }
    if (a === '--online') { o.online = true; continue; }
    if (['--home', '--claude', '--root', '--here'].includes(a) && argv[i + 1]) { o[a.slice(2)] = argv[++i]; continue; }
    throw new Error(`unknown option: ${a}`);
  }
  return o;
}

// Where the parts look for the notebook, and why. The recorded place (config.json) is written by the newer installer;
// its key is read as "notebook" or "root" (the installer's exact key was not fixed when this was written).
export function findNotebook({ home, claude, root, env }) {
  if (root) return { dir: root, from: 'the --root option' };
  if (env.HIVE_ROOT) return { dir: env.HIVE_ROOT, from: 'the HIVE_ROOT setting' };
  const cfgFile = path.join(claude, 'hive', 'config.json');
  const cfg = readText(cfgFile);
  if (cfg !== null) {
    try {
      const j = JSON.parse(cfg);
      const d = j.notebook || j.root;
      if (d) return { dir: d, from: `the recorded place in ${cfgFile}` };
    } catch { return { dir: null, from: `${cfgFile}, which cannot be read`, badConfig: true }; }
  }
  return { dir: path.join(home, 'hive-mind'), from: 'the usual place (hive-mind in the home folder)' };
}

// Every hook command in settings.json, flattened: { event, text, exe, args }.
function hookList(settings) {
  const out = [];
  for (const [event, groups] of Object.entries(settings.hooks || {})) {
    for (const g of Array.isArray(groups) ? groups : []) {
      for (const h of g.hooks || []) {
        const args = Array.isArray(h.args) ? h.args : [];
        out.push({ event, exe: h.command || '', args, text: [h.command || '', ...args].join(' ') });
      }
    }
  }
  return out;
}

// A path written inside a hook, with $HOME / ~ / %USERPROFILE% made real.
function realPath(p, home) {
  return p.replace(/^"|"$/g, '').replace(/^(\$HOME|~|%USERPROFILE%)(?=[\\/])/, home);
}

// The online copy's address as anyone would ask for it: no user name or key in it, and GitHub's SSH form as https.
// A local folder (a stand-in for GitHub in tests) is kept. Anything else is not asked about (null).
export function publicAddress(url) {
  const u = String(url || '').trim();
  let m = /^(?:ssh:\/\/)?git@github\.com[:/](.+?)\/?$/i.exec(u);
  if (m) return `https://github.com/${m[1]}`;
  m = /^(https?:\/\/)(?:[^@/]*@)?([^/?#]+)(\/[^?#]*)$/i.exec(u);
  if (m) return `${m[1].toLowerCase()}${m[2]}${m[3]}`;
  if (/^file:\/\//i.test(u) || (path.isAbsolute(u) && !u.startsWith('-'))) return u;
  return null;
}

// Asks once whether the copy can be read with no sign-in: every saved sign-in is switched off (credential helpers,
// ask-pass programs, extra headers; SSH is refused, so an address rewritten to SSH by a setting cannot sign in with a
// key), the terminal prompt is off, and it gives up after 10 seconds.
// An answer means public; a refusal means private; anything else is "not checked".
// A local folder standing in for GitHub (tests and walks) can always be read, so it could only ever answer "public".
// HIVE_STANDIN_ONLINE=public|private gives the stand-in's answer instead, and only for a local address: it never
// changes what a real online address answers.
export const isLocalAddress = (addr) => /^file:\/\//i.test(String(addr)) || (path.isAbsolute(String(addr)) && !/^https?:/i.test(String(addr)));
export function askGitHub(url, env = process.env) {
  const addr = publicAddress(url);
  if (!addr) return { answer: 'unknown', why: 'the address is not a GitHub one this check knows' };
  const standIn = String(env.HIVE_STANDIN_ONLINE || '').toLowerCase();
  if (isLocalAddress(addr) && (standIn === 'public' || standIn === 'private')) return { answer: standIn, standIn: true };
  const off = ['credential.helper=', 'core.askPass=', 'http.extraHeader=', 'protocol.ssh.allow=never', 'protocol.ext.allow=never'].flatMap((c) => ['-c', c]);
  const r = spawnSync('git', [...off, 'ls-remote', '--heads', addr], {
    encoding: 'utf8', timeout: 10000, cwd: os.tmpdir(),
    env: { ...process.env, ...env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', GIT_ASKPASS: '', SSH_ASKPASS: '' },
  });
  if (r.error || r.signal) return { answer: 'unknown', why: 'no answer within 10 seconds' };
  if (r.status === 0) return { answer: 'public' };
  if (/not found|could not read username|authentication failed|terminal prompts disabled|invalid username|\b40[13]\b/i.test(r.stderr || '')) return { answer: 'private' };
  return { answer: 'unknown', why: 'GitHub could not be reached' };
}

// Whether a folder is the notebook or inside it.
function inside(dir, root) {
  if (!dir) return false;
  const rel = path.relative(path.resolve(root).toLowerCase(), path.resolve(dir).toLowerCase());
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

export function diagnose(opts = {}) {
  const env = opts.env || process.env;
  const home = opts.home || os.homedir();
  const claude = opts.claude || env.CLAUDE_DIR || path.join(home, '.claude');
  const here = opts.here || process.cwd();
  const lines = [];
  const ok = (id, text) => lines.push({ kind: 'OK', id, text });
  const fix = (id, text) => lines.push({ kind: 'FIX', id, text });
  const note = (id, text) => lines.push({ kind: 'NOTE', id, text });

  // 1. The notebook
  const nb = findNotebook({ home, claude, root: opts.root, env });
  let root = null;
  if (nb.badConfig) fix('notebook-path', `The recorded notebook place (${nb.from}) is broken.`);
  if (nb.dir && isNotebook(nb.dir)) { root = nb.dir; ok('notebook', `The notebook is at ${nb.dir} (found through ${nb.from}).`); }
  else if (isNotebook(here)) {
    root = here;
    if (!nb.badConfig) fix('notebook-path', `The parts look for the notebook at ${nb.dir} (${nb.from}), but it is at ${here}.`);
  } else if (!nb.badConfig) fix('notebook-missing', `No notebook at ${nb.dir} (${nb.from}), and this folder is not one either.`);

  // 2. Tools
  const git = spawnSync('git', ['--version'], { encoding: 'utf8' });
  if (git.status === 0) ok('git', `Git is here (${git.stdout.trim()}).`); else fix('no-git', 'Git is not on this computer: saving your notes needs it.');
  ok('node', `Node is here (${process.version}).`);

  // 3. The parts in Claude's folder
  const hive = path.join(claude, 'hive');
  const settingsText = readText(path.join(claude, 'settings.json'));
  const pluginText = [readText(path.join(claude, 'plugins', 'installed_plugins.json')), readText(path.join(claude, 'plugins', 'known_marketplaces.json'))].join(' ');
  const asPlugin = /hive-mind/i.test(pluginText);
  // Installed or not is told by what the installer leaves, never by the Hive folder existing: setup makes that folder
  // first for the private names list.
  const installed = ['install-record.json', 'config.json', 'start.mjs', 'start.ps1', path.join('gates', 'gates.mjs')].some((f) => fs.existsSync(path.join(hive, f)));
  if (!installed && !asPlugin) {
    fix('not-installed', fs.existsSync(hive)
      ? `Hive Mind's parts are not installed on this computer yet. The folder ${hive} is there, but it holds none of the parts (it may hold only your private names list).`
      : `Hive Mind's parts are not installed on this computer yet (the folder ${hive} does not exist).`);
  } else {
    const startFile = ['start.mjs', 'start.ps1'].find((f) => fs.existsSync(path.join(hive, f)));
    if (startFile) ok('part:start', `The start step is in place (${startFile}).`);
    else if (!asPlugin) fix('part-missing', `The start step is missing from ${hive}.`);
    for (const f of [path.join('gates', 'gates.mjs')]) {
      if (fs.existsSync(path.join(hive, f))) ok('part:gates', 'The gates are in place.');
      else if (!asPlugin) fix('part-missing', `The gates are missing (${path.join(hive, f)}).`);
    }
    if (!['privacy-guard.ps1', 'privacy-guard.mjs'].some((f) => fs.existsSync(path.join(hive, f))) && !asPlugin) {
      note('part:privacy', `No privacy check in ${hive}; the save hook then uses the notebook's own copy.`);
    }

    let settings = null;
    if (settingsText === null) { if (!asPlugin) fix('settings-unreadable', `Claude's settings file is missing (${path.join(claude, 'settings.json')}).`); }
    else { try { settings = JSON.parse(settingsText); } catch { fix('settings-unreadable', "Claude's settings file is not valid JSON, so no hook in it runs."); } }

    if (settings) {
      const hooks = hookList(settings);
      const startHooks = hooks.filter((h) => h.event === 'SessionStart' && /hive[\\/]+start\.(ps1|mjs)/.test(h.text));
      const gateHooks = hooks.filter((h) => /gates\.mjs/.test(h.text));
      const missing = (id, text) => (asPlugin ? note(id, `${text} (Hive Mind came as a plugin, whose own hooks were not checked).`) : fix(id, text));
      if (!startHooks.length) missing('hook-missing', 'The start step is not connected: new chats will not know you.');
      // In three parts (-Part rules|state|flight) every part must be there; one entry with no -Part is the whole start.
      else if (startHooks.some((h) => /start\.ps1/.test(h.text) && /-Part\s/.test(h.text))) {
        for (const p of START_PARTS) {
          if (startHooks.some((h) => new RegExp(`-Part\\s+${p}\\b`).test(h.text))) ok(`hook:start-${p}`, `The start part '${p}' is connected.`);
          else missing('hook-missing', `The start part '${p}' is not connected.`);
        }
      } else ok('hook:start', 'The start step is connected.');
      for (const m of GATE_MODES) {
        if (gateHooks.some((h) => h.args.includes(m) || new RegExp(`gates\\.mjs"?\\s+${m}\\b`).test(h.text))) ok(`hook:gate-${m}`, `The gate '${m}' is connected.`);
        else missing('hook-missing', `The gate '${m}' is not connected.`);
      }
      // Both ways in: the installed parts and the plugin switched on. The plugin stands down, but every helper is twice.
      const pluginOn = Object.entries(settings.enabledPlugins || {}).some(([k, v]) => /^hive-mind@/i.test(k) && v);
      if (pluginOn && (startHooks.length || gateHooks.length)) {
        fix('two-ways', 'Hive Mind is here two ways at once: the installed parts and the plugin, so every helper is there twice. Keep one way. To keep the installed parts, remove the plugin: claude plugin uninstall hive-mind@hive-mind (or /plugin, Installed, hive-mind, Uninstall). To keep the plugin, take the installed parts out: node core/install/install.mjs uninstall (with --dry-run first).');
      }
      // Every file a Hive Mind hook names must exist (a Node moved after install breaks the gates without a word).
      const seen = new Set();
      for (const h of [...startHooks, ...gateHooks]) {
        const files = [];
        // With an args list, the command is one program path (it may hold spaces, as in Program Files).
        if (h.args.length && /[\\/]/.test(h.exe)) files.push(h.exe.trim());
        for (const a of h.args) if (/\.(mjs|ps1|sh)$/.test(a)) files.push(a);
        const m = h.text.match(/-File\s+"([^"]+)"/); if (m) files.push(m[1]);
        for (const f of files) {
          const real = realPath(f, home);
          if (seen.has(real)) continue; seen.add(real);
          if (!fs.existsSync(real)) fix('hook-broken', `A hook points at ${real}, which is not there.`);
        }
      }
    }

    const cm = readText(path.join(claude, 'CLAUDE.md')) || '';
    if (cm.includes('hive-mind:start') && cm.includes('hive-mind:end')) ok('claude-md', "The Hive Mind block is in Claude's instructions file.");
    else if (!asPlugin) fix('claude-md-block', "The Hive Mind block is missing from Claude's instructions file.");

    if (fs.existsSync(path.join(hive, 'gates-off'))) note('gates-off', 'The gates are switched off (the gates-off file is there). That is a choice, not a fault.');

    // The gates really on: ask the installed gates where they look for the notebook, the way a chat runs them.
    // Only when the notebook was found where the parts look (otherwise notebook-path already says it).
    const gatesFile = path.join(hive, 'gates', 'gates.mjs');
    if (root && nb.dir && same(root, nb.dir) && fs.existsSync(gatesFile)) {
      const penv = { ...env, HIVE_HOME: home, HIVE_STATE: hive };
      if (!env.HIVE_ROOT) delete penv.HIVE_ROOT;
      const p = spawnSync(process.execPath, [gatesFile, 'where'], { encoding: 'utf8', env: penv, input: '', timeout: 10000 });
      let w = null; try { w = JSON.parse(String(p.stdout || '').trim()); } catch {}
      if (!w) fix('gates-blind', 'The installed gates are an older version that cannot say where they look for the notebook, so they may be off without a word.');
      else if (!w.found) fix('gates-blind', `The gates look for the notebook at ${w.root} and do not find it, so every gate is off without a word.`);
      else if (!same(w.root, root)) fix('gates-blind', `The gates use the notebook at ${w.root}, but the other parts use ${root}.`);
      else ok('gates-on', 'The gates find the notebook.');
    }
  }

  // 4. The helpers: every folder in the notebook's core/skills is installed and the same
  if (root && (installed || asPlugin)) {
    const src = path.join(root, 'core', 'skills');
    for (const d of fs.existsSync(src) ? fs.readdirSync(src, { withFileTypes: true }).filter((e) => e.isDirectory()) : []) {
      const mine = readText(path.join(src, d.name, 'SKILL.md'));
      const theirs = readText(path.join(claude, 'skills', d.name, 'SKILL.md'));
      if (mine === null) continue;
      if (theirs === null) { if (asPlugin) note('skill-missing', `Helper ${d.name}: no copy in Claude's skills folder (it may come with the plugin).`); else fix('skill-missing', `Helper ${d.name} is missing from Claude's skills folder.`); }
      else if (norm(mine) !== norm(theirs)) fix('skill-stale', `Helper ${d.name}: the installed copy differs from the notebook.`);
      else ok(`skill:${d.name}`, `Helper ${d.name} is installed.`);
    }
  }

  // 5. The notebook as a Git folder, its online copy and its save hook
  if (root && git.status === 0) {
    const inside = spawnSync('git', ['-C', root, 'rev-parse', '--git-dir'], { encoding: 'utf8' });
    if (inside.status !== 0) fix('not-git', 'The notebook is not a Git folder (a downloaded ZIP?), so nothing can be saved.');
    else {
      const gitDir = path.resolve(root, inside.stdout.trim());
      const origin = spawnSync('git', ['-C', root, 'remote', 'get-url', 'origin'], { encoding: 'utf8' });
      if (origin.status === 0) ok('online-copy', 'The notebook is linked to an online copy.'); else fix('no-online-copy', 'The notebook has no online copy yet; your notes are only on this computer.');
      if (fs.existsSync(path.join(gitDir, 'hooks', 'pre-commit'))) ok('save-hook', 'The privacy check runs at every save.');
      else fix('no-save-hook', 'The privacy check does not run at saves (no save hook).');
      // Private or public: asked of GitHub only with --online (the person's yes). Nothing else here leaves the computer.
      if (origin.status === 0 && opts.online) {
        const a = (opts.askOnline || askGitHub)(origin.stdout.trim(), env);
        if (a.answer === 'public') fix('copy-public', 'Anyone can read your online copy: GitHub showed it without a sign-in. Make it private on GitHub (the copy\'s Settings, Change visibility, Private).');
        else if (a.answer === 'private') ok('copy-private', 'GitHub would not show your online copy without a sign-in, so it is private.');
        else note('copy-not-checked', `Whether your online copy is private was not checked: ${a.why || 'no answer'}.`);
      }
      // Saved online: the online branch, as last recorded on this computer (no network), holds me/profile.md.
      if (origin.status === 0 && fs.existsSync(path.join(root, 'me', 'profile.md'))) {
        const up = spawnSync('git', ['-C', root, 'rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], { encoding: 'utf8' });
        const refs = [up.status === 0 ? up.stdout.trim() : '', 'refs/remotes/origin/HEAD', 'origin/main', 'origin/master'].filter(Boolean);
        const saved = refs.some((ref) => spawnSync('git', ['-C', root, 'cat-file', '-e', `${ref}:me/profile.md`], { encoding: 'utf8' }).status === 0);
        if (saved) ok('saved-online', 'Your notes are saved in your online copy.');
        else note('not-saved-online', 'Your notes are not saved online yet (the online copy has no me/profile.md).');
      }
      // The privacy check, as a save runs it.
      const guard = [path.join(root, 'core', 'guard', 'privacy-guard.mjs'), path.join(hive, 'privacy-guard.mjs')].find((f) => fs.existsSync(f));
      if (!guard) note('privacy-not-checked', 'The privacy check was not run: no Node form of it was found.');
      else {
        const g = spawnSync(process.execPath, [guard, root], { encoding: 'utf8', timeout: 60000, env: { ...process.env, ...env, HIVE_NAMES_FILE: env.HIVE_NAMES_FILE || path.join(hive, 'protected-names.txt') } });
        const found = String(g.stdout || '').split(/\r?\n/).filter((l) => l && !/^PRIVACY GUARD/.test(l)).slice(0, 3).join('; ');
        if (g.status === 0) ok('privacy-clean', 'The privacy check finds nothing that should not be saved.');
        else if (g.status === 1) fix('privacy-stop', `The privacy check found something that must not be saved: ${found}.`);
        else if (g.status === 2) note('privacy-check', `The privacy check asks you to look at: ${found}.`);
        else note('privacy-not-checked', 'The privacy check did not finish.');
      }
    }
  }
  if (root) {
    if (fs.existsSync(path.join(root, 'me', 'profile.md'))) {
      ok('set-up', 'The first conversation is done.');
      const dif = readText(path.join(root, 'system', 'decisions-in-force.md')) || '';
      if (/^[ \t]*(?:[-*|][ \t]*)?\**Starting set:\**[ \t]*\S/im.test(dif)) ok('starting-set', 'A starting set is chosen.');
      else note('no-starting-set', 'No starting set is chosen yet (no "Starting set:" line in system/decisions-in-force.md).');
    } else note('not-set-up', 'This Hive Mind is not set up yet (no me/profile.md).');
  }
  // A chat started with Hive Mind: a start record from a chat in the notebook, newer than the install.
  if (root && (installed || asPlugin)) {
    const since = (() => { try { return fs.statSync(path.join(hive, 'install-record.json')).mtimeMs; } catch { return 0; } })();
    const dir = path.join(hive, 'gates', 'start');
    const records = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')) : [];
    const started = records.some((f) => {
      try { const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); return inside(j.cwd, root) && Date.parse(j.at) > since; } catch { return false; }
    });
    if (started) ok('started', 'A new chat in the notebook has started with Hive Mind since the install.');
    else note('not-started', 'No new chat in the notebook has started with Hive Mind since the install yet.');
  }
  if (root && !same(root, here) && isNotebook(here)) note('two-notebooks', `This folder (${here}) is a notebook too, but the parts use ${root}.`);

  const result = { notebook: root, claude, lines, faults: lines.filter((l) => l.kind === 'FIX').length };
  // For the code only; left out of --json so its shape stays the same.
  Object.defineProperty(result, 'facts', { value: { route: installed && asPlugin ? 'both' : installed ? 'installer' : asPlugin ? 'plugin' : 'none', gitRuns: git.status === 0 }, enumerable: false });
  return result;
}

// The faults that mean a part is missing or broken (step 6 of the first hour).
const PART_FAULTS = ['part-missing', 'hook-missing', 'hook-broken', 'skill-missing', 'skill-stale', 'claude-md-block', 'settings-unreadable', 'two-ways'];

// The state the Hive Mind code carries, read from the doctor's lines. A step is 1 only when the doctor saw it.
export function codeState(r, platform = process.platform) {
  const has = (id, kind = 'OK') => r.lines.some((l) => l.id === id && l.kind === kind);
  const route = r.facts ? r.facts.route : 'none';
  return {
    system: systemOf(platform),
    route,
    steps: {
      tools: has('git') && has('node'),
      notebook: !!r.notebook && !!(r.facts && r.facts.gitRuns) && !has('not-git', 'FIX') && !has('notebook-missing', 'FIX'),
      online: has('online-copy'),
      'private-checked': has('copy-private') || has('copy-public', 'FIX'),
      private: has('copy-private'),
      'set-up': has('set-up'),
      'starting-set': has('starting-set'),
      parts: route !== 'none' && !r.lines.some((l) => l.kind === 'FIX' && PART_FAULTS.includes(l.id)),
      gates: has('gates-on'),
      'save-hook': has('save-hook'),
      saved: has('saved-online'),
      started: has('started'),
      clean: has('privacy-clean'),
    },
  };
}

function main() {
  let o;
  try { o = parseArgs(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exit(2); }
  // The code alone: one line, nothing else, so it can be pasted into the steps page without a path or a name.
  // If anything goes wrong, a plain line with no path (an error's own text could hold one).
  if (o.code) {
    let line;
    try { line = encode(codeState(diagnose(o))); } catch { console.error('The doctor stopped before it could make the code. Run it without --code to see why.'); process.exit(1); }
    console.log(line); process.exit(0);
  }
  const r = diagnose(o);
  if (o.json) console.log(JSON.stringify(r, null, 2));
  else {
    for (const l of r.lines) console.log(`${l.kind.padEnd(4)} ${l.id}  ${l.text}`);
    console.log(r.faults ? `NEEDS FIXING: ${r.faults} of ${r.lines.length} lines.` : `ALL FINE: nothing needs fixing (${r.lines.length} lines).`);
  }
  process.exit(r.faults ? 1 : 0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
