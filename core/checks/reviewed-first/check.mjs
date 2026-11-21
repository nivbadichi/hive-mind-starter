// reviewed-first: rule 10, "Outside tools are reviewed first."
// Before a tool runs, this check finds an install or a first use of an outside tool (a package, a plugin, a skill
// folder, a connector's tools) and looks for its review: the registry's review field, then the review notes. No review
// means the step is refused, naming the review step. A review that says "do not use" means it is refused always.
// It reads only the notebook; it never runs, fetches or installs anything.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
let OWN_SETTINGS = null;
function ownSettings() {
  if (OWN_SETTINGS) return OWN_SETTINGS;
  try { OWN_SETTINGS = JSON.parse(fs.readFileSync(path.join(HERE, 'settings.json'), 'utf8')); } catch { OWN_SETTINGS = {}; }
  return OWN_SETTINGS;
}
function settingsOf(ctx) { return { ...ownSettings(), ...((ctx && ctx.settings) || {}) }; }

// ---- names -------------------------------------------------------------------------------------------------
export const slug = (s) => String(s || '').toLowerCase().replace(/[`"'*]/g, '').replace(/[^a-z0-9@/.:-]+/g, '-').replace(/^-+|-+$/g, '');
const SUFFIX = /-(skill|skills|plugin|mcp|mcp-server|server|connector)$/;
const GENERIC = new Set(['mcp', 'server', 'mcp-server', 'cli', 'core', 'sdk', 'app', 'skill', 'skills', 'plugin', 'plugins', 'connector', 'tool', 'tools', 'api', 'main', 'src']);
// Common package names: one of these is a reference only when it is the whole name, never as part of another.
const COMMON = new Set(['react', 'react-dom', 'vue', 'next', 'svelte', 'angular', 'preact', 'solid', 'node', 'lodash', 'express', 'typescript', 'ui', 'utils', 'util', 'types', 'config', 'eslint', 'babel', 'webpack', 'vite', 'jest', 'test', 'tests', 'docs', 'web', 'js', 'ts', 'dom', 'router', 'client', 'components', 'icons', 'hooks', 'styles', 'theme', 'runtime', 'store', 'tap', 'kit', 'native', 'react-native']);

// Turns "owner/repo", a git address, "@scope/pkg@1.2", "name@marketplace" or "pkg==1.0" into a reference.
export function refOf(raw) {
  let s = String(raw || '').trim().replace(/^['"]|['"]$/g, '');
  const git = s.match(/(?:github\.com|gitlab\.com|bitbucket\.org)[/:]([^/\s]+)\/([^/\s#?]+?)(?:\.git)?(?:[/#?].*)?$/i);
  let repo = '';
  if (git) { repo = `${git[1]}/${git[2]}`.toLowerCase(); s = repo; }
  s = s.replace(/^(npm:|github:|gh:)/i, '');
  s = s.replace(/\[.*?\]/g, '').replace(/(===?|~=|!=|>=|<=|>|<).*$/, ''); // python extras and versions
  let name = s.toLowerCase();
  if (name.startsWith('@')) { const i = name.indexOf('@', 1); if (i > 0) name = name.slice(0, i); } else if (name.includes('@')) name = name.slice(0, name.indexOf('@'));
  if (!repo && /^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i.test(name)) repo = name;
  if (!repo && name.startsWith('@') && name.includes('/')) repo = name.slice(1);
  const last = name.split('/').pop();
  // 2026-11-20 (found by the helper that wrote thirteen review notes): a scoped package (@base-ui/react) is named only
  // by its whole scoped name, never by its last part, else a note on @base-ui/react passed "react" and any @evil/react
  // as reviewed. A bare common package name ("react", "utils") never becomes a name on its own either; only when it is
  // the whole name (a note on "react" itself).
  const scoped = name.startsWith('@') && name.includes('/');
  const forms = new Set(scoped ? [name] : [name, last, last.replace(SUFFIX, '')]);
  if (repo) { const [owner] = repo.split('/'); forms.add(repo); forms.add(`${last.replace(SUFFIX, '')}-${owner}`); }
  // A bare last part like "mcp" (from "@maker/mcp") would match every tool called mcp: such words are no name.
  const whole = slug(name);
  return { raw: String(raw), name, repo, forms: [...forms].filter(Boolean).map(slug).filter((f) => f && !GENERIC.has(f) && (f === whole || !COMMON.has(f))) };
}

// ---- what a review says --------------------------------------------------------------------------------------
// 'block' (do not use), 'ok' (reviewed, official, your own), 'none' (needed, not reviewed, not found)
export function classifyReview(text, entry) {
  const t = String(text || '').trim().toLowerCase();
  if (/do not use|don't use|not to be used|do not install|don't install/.test(t)) return 'block';
  if (/^not reviewed|^needed|^not found|^owed/.test(t)) return 'none';
  if (/^reviewed|^official|^not-applicable|^not applicable|^use\b|^use with limits|^ok to authorise|^authorise with care/.test(t)) return 'ok';
  if (!t && entry) {
    if (entry.source === 'owner') return 'ok';
    return 'grand';
  }
  return 'none';
}

// The review notes: each "## N." section, and each "**8a. ...**" part inside it, with its names and its verdict.
export function parseReviews(text, file) {
  const units = [];
  let cur = null;
  const open = (title, line) => {
    cur = { file, title: title.trim(), names: new Set(), repos: new Set(), verdict: '', line };
    for (const m of title.matchAll(/`([^`]+)`/g)) { const r = refOf(m[1]); if (r.repo) cur.repos.add(r.repo); r.forms.forEach((f) => cur.names.add(f)); }
    const head = title.replace(/`[^`]*`/g, '').replace(/^\s*\d+[a-z]?\.\s*/i, '').split(/[(:]/)[0].replace(/\*/g, '').replace(/[.\s]+$/, '').trim();
    if (head) { const s = slug(head); cur.names.add(s); cur.names.add(s.replace(SUFFIX, '')); }
    for (const m of title.matchAll(/\(([a-z0-9.-]+\.[a-z]{2,})\)/gi)) cur.names.add(slug(m[1]));
    units.push(cur);
  };
  const lines = String(text || '').split(/\r?\n/);
  lines.forEach((ln, i) => {
    let m;
    if ((m = ln.match(/^##\s+(\d+\.\s*.+)$/))) open(m[1], i + 1);
    else if (cur && (m = ln.match(/^\*\*(\d+[a-z]\.\s*[^*]+)\*\*/i))) open(m[1], i + 1);
    else if (cur && (m = ln.match(/\*\*(?:Verdict|Result):\s*([^*]+?)\.?\*\*/i))) cur.verdict = m[1].trim();
  });
  return units.map((u) => ({ ...u, names: [...u.names].filter((n) => /[a-z0-9]/.test(n) && !GENERIC.has(n)), repos: [...u.repos] }));
}

// The catalogue (system/catalogue.md) is prose, so only two shapes are read from it: a bold line that names its tool
// and gives a verdict ("**Some MCP (`@maker/some-mcp` 1.0), reviewed 2026-01-01, verdict: authorise with
// care.**"), and a "**Verdict: ...**" line inside a "## Review: <tool>" section, whose names come from its heading and
// the `owner/repo` names in the section.
export function parseCatalogue(text, file) {
  const units = [];
  let sec = null;
  const headNames = (s, set) => {
    const head = String(s).replace(/`[^`]*`/g, '').replace(/^review:\s*/i, '').split(/[(,:]/)[0].replace(/["*]/g, '').replace(/[.\s]+$/, '').trim();
    if (head) { const h = slug(head); set.add(h); set.add(h.replace(SUFFIX, '')); }
  };
  const addRefs = (s, names, repos, repoOnly) => {
    for (const m of String(s).matchAll(/`([^`]+)`/g)) {
      const raw = m[1].trim().split(/\s+/)[0];
      const r = refOf(raw);
      if (repoOnly && !r.repo) continue;
      if (r.repo) repos.add(r.repo);
      r.forms.forEach((f) => names.add(f));
    }
  };
  String(text || '').split(/\r?\n/).forEach((ln, i) => {
    let m;
    if ((m = ln.match(/^##\s+(.+)$/))) {
      sec = /^review\b/i.test(m[1]) ? { title: m[1].trim(), names: new Set(), repos: new Set(), line: i + 1 } : null;
      if (sec) headNames(m[1], sec.names);
      return;
    }
    if (sec) addRefs(ln, sec.names, sec.repos, true);
    const bold = ln.match(/\*\*([^*]*\bverdict\b[^*]*)\*\*/i);
    if (!bold) return;
    const vm = bold[1].match(/\bverdict\b\s*:?\s*(.+)$/i);
    const verdict = vm ? vm[1].replace(/[.\s]+$/, '').trim() : '';
    const before = bold[1].slice(0, bold[1].search(/\bverdict\b/i));
    if (/`[^`]+`/.test(before) || before.replace(/[\s,:-]+/g, '').length > 3) {
      const u = { file, title: before.replace(/[\s,]+$/, '').trim(), names: new Set(), repos: new Set(), verdict, line: i + 1 };
      headNames(before, u.names);
      addRefs(before, u.names, u.repos, false);
      units.push(u);
    } else if (sec) {
      units.push({ file, title: sec.title, names: new Set(sec.names), repos: new Set(sec.repos), verdict, line: i + 1 });
    }
  });
  return units.map((u) => ({ ...u, names: [...u.names].filter((n) => /[a-z0-9]/.test(n) && !GENERIC.has(n)), repos: [...u.repos] }));
}

// ---- the notebook's records, read once per change --------------------------------------------------------------
const CACHE = new Map();
function cached(key, file, make) {
  let st;
  try { st = fs.statSync(file); } catch { return make(null); }
  const k = `${key}|${file}`;
  const hit = CACHE.get(k);
  if (hit && hit.mtime === st.mtimeMs && hit.size === st.size) return hit.value;
  const value = make(fs.readFileSync(file, 'utf8'));
  CACHE.set(k, { mtime: st.mtimeMs, size: st.size, value });
  return value;
}

export function loadKnown(root, S) {
  const regFile = path.join(root, S.registry || 'system/registry.json');
  const entries = cached('reg', regFile, (txt) => {
    if (txt == null) return [];
    const j = JSON.parse(txt);
    return (j.entries || []).filter((e) => e && (e.kind === 'skill' || e.kind === 'connector'));
  });
  const dir = path.join(root, S.reviews || 'system/reviews');
  let units = [];
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.md')); } catch {}
  for (const f of files) units = units.concat(cached('rev', path.join(dir, f), (txt) => parseReviews(txt || '', `${(S.reviews || 'system/reviews')}/${f}`)));
  if (S.catalogue) units = units.concat(cached('cat', path.join(root, S.catalogue), (txt) => parseCatalogue(txt || '', S.catalogue)));
  return { entries, units };
}

// The answer for one reference: { status: 'ok'|'block'|'none'|'unknown', where, said }
const RANK = { block: 3, none: 2, ok: 1 };
export function lookup(ref, known, S) {
  const r = typeof ref === 'string' ? refOf(ref) : ref;
  const results = [];
  const fromEntry = (e) => {
    let c = classifyReview(e.review, e);
    if (c === 'grand') c = S.grandfather !== false && e.source !== 'third-party' && (e.state === 'active' || e.state === 'installed-unused') ? 'ok' : 'none';
    return { status: c, where: `the registry entry "${e.id}" (system/registry.json)`, said: e.review || '(empty)' };
  };
  const fromUnit = (u) => ({ status: u.verdict ? classifyReview(u.verdict) : 'none', where: `${u.file}, "${u.title.replace(/\*/g, '')}"`, said: u.verdict || '(no verdict)' });
  // 1. The exact repository wins: two tools can share a name (the same name from two different makers).
  if (r.repo) {
    for (const u of known.units) if (u.repos.includes(r.repo)) results.push(fromUnit(u));
    for (const e of known.entries) if (`${e.text || ''} ${e.about || ''}`.toLowerCase().includes(r.repo)) results.push(fromEntry(e));
    if (results.length) return worst(results);
  }
  // 2. The registry by id.
  for (const e of known.entries) { const id = slug(e.id); if (r.forms.includes(id)) results.push(fromEntry(e)); }
  // 3. The review notes by name. When the registry already knows the name, a note section about one exact
  // repository is left out: it may be another maker's tool of the same name (a "do not use" for one maker's tool
  // must not refuse the other maker's tool that the registry records as reviewed).
  const byId = results.length > 0;
  for (const u of known.units) if (!(byId && u.repos.length) && u.names.some((n) => r.forms.includes(n))) results.push(fromUnit(u));
  if (!results.length) return { status: 'unknown', where: '', said: '' };
  return worst(results);
}
function worst(list) {
  // A "do not use" anywhere wins; otherwise a cleared review beats a missing one (a heading with no verdict of its own).
  const block = list.find((x) => x.status === 'block');
  if (block) return block;
  return list.find((x) => x.status === 'ok') || list.sort((a, b) => RANK[b.status] - RANK[a.status])[0];
}

// ---- finding installs in a shell command ------------------------------------------------------------------------
const VALUE_FLAGS = new Set(['--registry', '--prefix', '--workspace', '-w', '--tag', '--cache', '--index-url', '-i', '--extra-index-url', '--target', '-t', '--python', '--from', '--scope', '--source', '--version', '--root', '--path', '-r', '--requirement', '-c', '--constraint', '-e', '--editable']);
function split(cmd) {
  return String(cmd || '').split(/&&|\|\||;|\r?\n|(?<!\|)\|(?!\|)/).map((seg) => (seg.match(/"[^"]*"|'[^']*'|\S+/g) || []).map((t) => t.replace(/^["']|["']$/g, '')));
}
// A segment like `bash -c "npm i x"` carries its command inside quotes; split those too.
function segments(cmd) {
  const out = [];
  for (const toks of split(cmd)) {
    out.push(toks);
    toks.forEach((t, k) => { if (k > 0 && /^(-c|-command|\/c|\/k)$/i.test(toks[k - 1]) && /\s/.test(t)) out.push(...segments(t)); });
  }
  return out;
}
const isLocal = (t) => /^(\.{1,2}[\\/]|[\\/]|~[\\/]|[a-z]:[\\/]|file:)/i.test(t) || /\.(tgz|tar\.gz|whl|zip)$/i.test(t) || t === '.';
function argsAfter(toks, i, flags = VALUE_FLAGS) {
  const out = [];
  for (let j = i; j < toks.length; j++) {
    const t = toks[j];
    if (/^[>]|^\d?>/.test(t)) break;
    if (t.startsWith('-')) { if (flags.has(t)) j++; continue; }
    out.push(t);
  }
  return out;
}
const SKILLS_DIR = /[\\/]\.claude[\\/]skills[\\/]?([^\\/\s"']*)/i;

// Every install or outside run in a command: [{ what, name, how }]
export function findInCommand(cmd) {
  const found = [];
  const add = (what, name, how) => { if (name && !isLocal(name)) found.push({ what, name, how }); };
  const text = String(cmd || '');
  // A downloaded script piped into a shell: no review can see what it runs.
  const pipe = text.match(/\b(curl|wget|iwr|irm|invoke-webrequest|invoke-restmethod)\b[^|]*?(https?:\/\/\S+)[^|]*\|\s*(sudo\s+)?(ba|z)?sh\b|\b(iwr|irm|invoke-webrequest|invoke-restmethod)\b[^|]*?(https?:\/\/\S+)[^|]*\|\s*iex\b/i);
  if (pipe) found.push({ what: 'script', name: (pipe[2] || pipe[6] || '').replace(/["')]+$/, ''), how: 'a web script piped into a shell' });
  for (const toks of segments(text)) {
    const low = toks.map((t) => t.toLowerCase());
    for (let i = 0; i < low.length; i++) {
      const a = low[i].replace(/\.(exe|cmd)$/, '').replace(/^.*[\\/]/, ''), b = low[i + 1] || '', c = low[i + 2] || '';
      if (['npm', 'pnpm', 'cnpm'].includes(a) && ['i', 'install', 'add', 'isntall'].includes(b)) argsAfter(toks, i + 2).forEach((p) => add('package', p, `${a} ${b}`));
      else if (a === 'yarn' && (b === 'add' || (b === 'global' && c === 'add'))) argsAfter(toks, b === 'add' ? i + 2 : i + 3).forEach((p) => add('package', p, 'yarn add'));
      else if (a === 'bun' && ['add', 'i', 'install'].includes(b)) argsAfter(toks, i + 2).forEach((p) => add('package', p, `bun ${b}`));
      else if (a === 'npx' && b === 'skills' && c === 'add') argsAfter(toks, i + 3).slice(0, 1).forEach((p) => add('skill', p, 'npx skills add'));
      else if (['npx', 'bunx', 'pnpx', 'uvx'].includes(a) || (['pnpm', 'yarn'].includes(a) && b === 'dlx') || (a === 'npm' && b === 'exec') || (a === 'bun' && b === 'x') || (a === 'pipx' && b === 'run')) {
        const start = ['npx', 'bunx', 'pnpx', 'uvx'].includes(a) ? i + 1 : i + 2;
        const pk = toks.slice(start).find((t, k, arr) => t.startsWith('--package=') || ((arr[k - 1] === '-p' || arr[k - 1] === '--package') && !t.startsWith('-')));
        const first = pk ? pk.replace(/^--package=/, '') : argsAfter(toks, start)[0];
        if (!(a === 'npx' && b === 'skills')) add('run', first, `${a}${start === i + 2 ? ' ' + b : ''}`);
      }
      else if (/^pip3?$/.test(a) && b === 'install') argsAfter(toks, i + 2).forEach((p) => add('package', p, 'pip install'));
      else if (/^(python3?|py)$/.test(a) && b === '-m' && c === 'pip' && low[i + 3] === 'install') argsAfter(toks, i + 4).forEach((p) => add('package', p, 'pip install'));
      else if (a === 'uv' && b === 'pip' && c === 'install') argsAfter(toks, i + 3).forEach((p) => add('package', p, 'uv pip install'));
      else if (a === 'uv' && b === 'add') argsAfter(toks, i + 2).forEach((p) => add('package', p, 'uv add'));
      else if (a === 'uv' && b === 'tool' && c === 'install') argsAfter(toks, i + 3).forEach((p) => add('package', p, 'uv tool install'));
      else if (a === 'pipx' && b === 'install') argsAfter(toks, i + 2).forEach((p) => add('package', p, 'pipx install'));
      else if (['cargo', 'gem', 'brew', 'choco', 'scoop'].includes(a) && b === 'install') argsAfter(toks, i + 2).forEach((p) => add('package', p, `${a} install`));
      else if (a === 'go' && b === 'install') argsAfter(toks, i + 2).forEach((p) => add('package', p.replace(/@.*$/, ''), 'go install'));
      else if (a === 'winget' && b === 'install') {
        const k = low.indexOf('--id', i);
        const id = k > 0 ? toks[k + 1] : argsAfter(toks, i + 2)[0];
        add('package', id, 'winget install');
      }
      else if (a === 'claude' && b === 'plugin' && (c === 'install' || c === 'i')) argsAfter(toks, i + 3).forEach((p) => add('plugin', p, 'claude plugin install'));
      else if (a === 'claude' && b === 'plugin' && c === 'marketplace' && low[i + 3] === 'add') argsAfter(toks, i + 4).slice(0, 1).forEach((p) => add('plugin', p, 'claude plugin marketplace add'));
      else if (a === 'claude' && b === 'mcp' && (c === 'add' || c === 'add-json' || c === 'add-from-claude-desktop')) {
        const args = argsAfter(toks, i + 3);
        if (c === 'add-from-claude-desktop') add('connector', 'claude-desktop-servers', 'claude mcp add-from-claude-desktop');
        else if (args[0]) { add('connector', args[0], `claude mcp ${c}`); const url = args.slice(1).find((t) => /github\.com/.test(t)); if (url) add('connector', url, `claude mcp ${c}`); }
      }
      else if (a === 'git' && b === 'clone') {
        const args = argsAfter(toks, i + 2);
        if (args[1] && SKILLS_DIR.test(args[1]) || /[\\/]\.claude[\\/]plugins/i.test(args[1] || '')) add('skill', args[0], 'git clone into the skills folder');
      }
      else if (['cp', 'copy', 'copy-item', 'cpi', 'xcopy', 'robocopy', 'mv', 'move', 'move-item', 'ln', 'rsync'].includes(a)) {
        const args = argsAfter(toks, i + 1, new Set());
        const dst = args[args.length - 1] || '';
        const m = dst.match(SKILLS_DIR);
        if (m && args.length >= 2) {
          const src = args[0].replace(/[\\/]+$/, '');
          const name = m[1] || src.split(/[\\/]/).pop();
          found.push({ what: 'skill', name, how: `${a} into the skills folder`, from: src });
        }
      }
    }
  }
  return found;
}

// ---- finding installs in a file write -----------------------------------------------------------------------------
function editsOf(ev) {
  const i = ev.input || {};
  if (Array.isArray(i.edits)) return i.edits.map((e) => ({ neu: e.new_string || '', old: e.old_string || '' }));
  if (typeof i.content === 'string') return [{ neu: i.content, old: '' }];
  return [{ neu: i.new_string || '', old: i.old_string || '' }];
}
export function findInWrite(ev, home) {
  const found = [];
  const file = String((ev.input || {}).file_path || (ev.input || {}).notebook_path || '');
  if (!file) return found;
  const norm = file.replace(/\\/g, '/');
  const m = norm.match(/\/\.claude\/skills\/([^/]+)\//i);
  if (m) {
    const dir = norm.slice(0, norm.toLowerCase().indexOf('/.claude/skills/') + '/.claude/skills/'.length) + m[1];
    let exists = false;
    try { exists = fs.statSync(dir).isDirectory(); } catch {}
    if (!exists) found.push({ what: 'skill', name: m[1], how: 'a new folder in the skills folder' });
  }
  const base = norm.split('/').pop().toLowerCase();
  const edits = editsOf(ev);
  if (/^settings(\.local)?\.json$/.test(base)) {
    for (const { neu, old } of edits) for (const p of neu.matchAll(/"([^"\s]+@[^"\s]+)"\s*:\s*true/g)) if (!old.includes(`"${p[1]}"`)) found.push({ what: 'plugin', name: p[1], how: 'turned on in a settings file' });
  }
  if (base === '.mcp.json' || base === '.claude.json' || base === 'claude_desktop_config.json') {
    for (const { neu, old } of edits) {
      let names = [];
      try { const j = JSON.parse(neu); names = Object.keys(j.mcpServers || {}); } catch {
        names = [...neu.matchAll(/"([^"\s]+)"\s*:\s*\{\s*"(?:command|url|type|args)"/g)].map((x) => x[1]);
      }
      for (const n of names) if (!old.includes(`"${n}"`)) found.push({ what: 'connector', name: n, how: 'added to a connector settings file' });
    }
  }
  return found;
}

// ---- connectors ------------------------------------------------------------------------------------------------------
export function connectorOf(tool) {
  const m = String(tool || '').match(/^mcp__(.+?)__(.+)$/);
  if (!m) return null;
  const server = m[1];
  const pl = server.match(/^plugin_([^_]+)_(.+)$/);
  return { server, tool: m[2], plugin: pl ? pl[1] : '', inner: pl ? pl[2] : '' };
}
const matchesList = (name, list) => (list || []).some((p) => (p.endsWith('*') ? name.startsWith(p.slice(0, -1)) : name === p));

// ---- the decision ------------------------------------------------------------------------------------------------------
function localBin(cwd, name) {
  if (!/^[a-z0-9._-]+$/i.test(name)) return false;
  for (const ext of ['', '.cmd']) { try { if (fs.statSync(path.join(cwd, 'node_modules', '.bin', name + ext)).isFile()) return true; } catch {} }
  return false;
}
function localDeps(cwd) {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8'));
    return new Set(Object.keys({ ...j.dependencies, ...j.devDependencies, ...j.optionalDependencies, ...j.peerDependencies }).map((x) => x.toLowerCase()));
  } catch { return new Set(); }
}

const WHAT = { package: 'the package', run: 'the outside package', plugin: 'the plugin', skill: 'the skill folder', connector: 'the connector', script: 'a script from' };
function refusal(item, res) {
  const thing = item.skillCall ? `the skill "${item.name}"` : `${WHAT[item.what] || 'the tool'} "${item.name}"`;
  if (res.status === 'block') {
    return `HIVE GATE (reviewed first): I stopped this step. It would ${item.what === 'run' ? 'run' : item.how === 'a call' ? 'use' : 'install or connect'} ${thing}${item.how === 'a call' ? '' : ` (${item.how})`}, and its review says not to use it: "${res.said}" (${res.where}). Rule 10 holds this always, whatever is said in the chat. The one thing to do: leave it out; only a new review that changes that verdict can lift it.`;
  }
  const why = res.status === 'none' ? `its record says "${res.said}" (${res.where})` : 'the notebook has no review of it, neither in the registry nor in the review notes';
  if (item.what === 'script') return `HIVE GATE (reviewed first): I stopped this step. It downloads a script from ${item.name} and runs it in a shell at once, so nobody can review what it does (rule 10). The one thing to do: run the hive-review skill on the tool, read the script first, and install it another way.`;
  return `HIVE GATE (reviewed first): I stopped this step. It would ${item.what === 'run' ? 'run' : item.how === 'a call' ? 'use' : 'install or connect'} ${thing} (${item.how === 'a call' ? 'a first use' : item.how}), and ${why}. Rule 10: outside tools are reviewed first. The one thing to do: run the hive-review skill on "${item.name}", record its verdict in the registry, then ask the person.`;
}

export function decide(ev, ctx) {
  const S = settingsOf(ctx);
  const root = (ctx && ctx.root) || process.env.HIVE_ROOT || path.join(os.homedir(), 'hive-mind');
  const home = (ctx && ctx.home) || os.homedir();
  const tool = String(ev.tool || ev.tool_name || '');
  const input = ev.input || ev.tool_input || {};
  const items = [];

  const con = connectorOf(tool);
  if (con) {
    // Claude Code gives a connector call its provenance: ev.mcp_server = { name, source } (the hooks page says to
    // trust "source", not the name). "sdk" is the app's own; "claudeai" is a connector added in claude.ai (the
    // directory); "user", "project" and "local" are servers written into a settings file by hand, which is how an
    // unreviewed server gets in, so for those the names below are not trusted. With no provenance (an older
    // Claude Code) the names are all there is.
    const prov = ev.mcp_server && typeof ev.mcp_server === 'object' ? ev.mcp_server : null;
    const src = prov ? String(prov.source || '').toLowerCase() : '';
    const byHand = prov ? (S.handSources || ['user', 'project', 'local']).includes(src) : false;
    if (src === 'sdk') return null;
    if (src === 'claudeai' && S.claudeaiIsDirectory !== false) return null;
    if (!byHand && matchesList(con.server, S.builtIn)) return null;
    if (!byHand && S.directoryIds !== false && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(con.server)) return null;
    if (src === 'plugin' && prov.name) {
      const p = String(prov.name).match(/^plugin:([^:]+):(.+)$/);
      if (p) { con.plugin = p[1]; con.inner = p[2]; }
    }
    items.push({ what: 'connector', name: con.plugin ? con.inner : con.server, how: 'a call', plugin: con.plugin });
  } else if (tool === 'Skill') {
    const name = String(input.skill || input.name || '');
    if (name) items.push({ what: 'skill', name, how: 'a call', skillCall: true });
  } else if (/^(Bash|PowerShell)$/.test(tool) || ev.command) {
    items.push(...findInCommand(ev.command || input.command || ''));
  } else if (/^(Write|Edit|MultiEdit|NotebookEdit)$/.test(tool)) {
    items.push(...findInWrite({ ...ev, input }, home));
  }
  if (!items.length) return null;

  const known = loadKnown(root, S);
  const deps = items.some((x) => x.what === 'run' || x.what === 'package') ? localDeps(ev.cwd || (ctx && ctx.cwd) || process.cwd()) : new Set();
  for (const item of items) {
    if (item.what === 'script') { if (!(S.shellScripts || []).some((u) => item.name.startsWith(u))) return refusal(item, { status: 'unknown' }); continue; }
    const ref = refOf(item.name);
    if ((item.what === 'run' || item.what === 'package') && deps.has(ref.name)) continue; // already part of this project
    if (item.what === 'run' && localBin(ev.cwd || (ctx && ctx.cwd) || process.cwd(), ref.name)) continue; // npx runs the project's own copy
    if (item.what === 'run' && S.trustedRun && Object.prototype.hasOwnProperty.call(S.trustedRun, ref.name)) continue;
    if (item.what === 'skill') {
      const own = ref.forms.find((f) => { try { return fs.statSync(path.join(root, S.ownSkills || 'core/skills', f)).isDirectory(); } catch { return false; } });
      if (own && !item.skillCall) continue; // your own skill, copied from the notebook
    }
    let res = lookup(ref, known, S);
    if (item.what === 'connector' && item.plugin) {
      // A plugin's own server: cleared when the plugin is (its skills are in the registry as "plugin:skill").
      const pr = lookup(item.plugin, known, S);
      const viaSkills = known.entries.filter((e) => String(e.id).toLowerCase().startsWith(item.plugin.toLowerCase() + ':'));
      const plugRes = viaSkills.length ? worst(viaSkills.map((e) => { const c = classifyReview(e.review, e); return { status: c === 'grand' ? (S.grandfather !== false && e.source !== 'third-party' && e.state !== 'removed' ? 'ok' : 'none') : c, where: `the registry entries of the plugin "${item.plugin}"`, said: e.review || '(empty)' }; })) : pr;
      if (plugRes.status === 'block' || res.status === 'block') res = plugRes.status === 'block' ? plugRes : res;
      else if (res.status !== 'ok') res = plugRes;
    }
    if (item.skillCall) {
      // Calling a skill: refuse a "do not use" or a missing review; an unknown name is a built-in or a plugin's skill,
      // unless a folder of that name sits in the skills folder (installed past this check). A skill of the notebook's
      // own (a folder of that name in core/skills) passes unless a review says do not use.
      const bare = item.name.includes(':') ? '' : item.name;
      const ownFolder = bare && /^[a-z0-9._-]+$/i.test(bare) && (() => { try { return fs.statSync(path.join(root, S.ownSkills || 'core/skills', bare)).isDirectory(); } catch { return false; } })();
      if (ownFolder && res.status !== 'block') continue;
      if (res.status === 'unknown') {
        let folder = false;
        if (bare && /^[a-z0-9._-]+$/i.test(bare)) try { folder = fs.statSync(path.join(home, '.claude', 'skills', bare)).isDirectory(); } catch {}
        if (!folder) continue;
      }
    }
    if (res.status === 'ok') continue;
    return refusal(item, res);
  }
  return null;
}

// Does a step look like this check's business? Used only when the check itself breaks (a safety check refuses then).
export function looksRelevant(ev) {
  try { return relevant(ev); } catch { return true; } // a step that cannot even be read is refused: this is a safety check
}
function relevant(ev) {
  const tool = String(ev.tool || ev.tool_name || '');
  if (tool.startsWith('mcp__') || tool === 'Skill') return true;
  const cmd = String(ev.command || (ev.input || ev.tool_input || {}).command || '');
  if (/\b(install|add|clone|npx|dlx|uvx|bunx|plugin|mcp)\b|\|\s*(ba)?sh\b|\|\s*iex\b/i.test(cmd)) return true;
  const f = String((ev.input || ev.tool_input || {}).file_path || '');
  return /[\\/]\.claude[\\/]skills[\\/]|settings(\.local)?\.json$|\.mcp\.json$|\.claude\.json$/i.test(f);
}

export function pretool(ev, ctx) {
  try {
    const deny = decide(ev || {}, ctx || {});
    if (deny) { try { ctx && ctx.log && ctx.log('deny', { what: deny.slice(0, 200) }); } catch {} return { deny }; }
    return null;
  } catch (err) {
    try { ctx && ctx.log && ctx.log('error', { what: `reviewed-first broke: ${String(err && err.message).slice(0, 160)}` }); } catch {}
    if (looksRelevant(ev || {})) return { deny: `HIVE GATE (reviewed first): I stopped this step to be safe. It looks like an install or a first use of an outside tool, and the reviewed-first check broke while reading it (${String(err && err.message).slice(0, 120)}). The one thing to do: ask the person in one plain sentence; the break is written in the log.` };
    return null;
  }
}

export default {
  id: 'reviewed-first',
  rule: 'rule 10',
  kind: 'safety',
  mode: 'refuse',
  about: 'Installing, connecting or first using an outside tool with no review in the notebook is refused, and a tool whose review says do not use is refused always.',
  steps: { pretool },
};
