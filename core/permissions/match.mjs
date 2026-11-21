// A small copy of how Claude Code matches permission rules, written from https://code.claude.com/docs/en/permissions
// (read 2026-11-20), so the tests can show which tool calls our entries catch. It is an approximation for the tests,
// not the app: the app's own matcher decides. What it copies:
//  - Bash and PowerShell: the command is split on && || ; | |& & and new lines (outside quotes); a deny or ask rule
//    applies when any part matches; a leading NAME=value is passed over; * stands for any text; "x *" also matches a
//    bare "x"; ":*" at the end is the same as " *". PowerShell is case-insensitive and its common aliases (rm, del, ri,
//    rd, rmdir, erase, iex) count as the cmdlet.
//  - Edit(path) covers Edit, Write and NotebookEdit; gitignore-style paths; ~/ is the home folder, // the root,
//    Windows paths become /c/...
//  - Tool names may hold * in deny and ask rules (mcp__*__delete*); Tool(param:value) matches one input field.
import path from 'node:path';

const SEP = new Set(['&&', '||', '|&', ';', '|', '&', '\n']);
export function split(cmd) {
  const parts = []; let cur = ''; let q = null;
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    if (q) { cur += c; if (c === q) q = null; continue; }
    if (c === '"' || c === "'") { q = c; cur += c; continue; }
    const two = cmd.slice(i, i + 2);
    if (SEP.has(two)) { parts.push(cur); cur = ''; i++; continue; }
    if (SEP.has(c)) { parts.push(cur); cur = ''; continue; }
    cur += c;
  }
  parts.push(cur);
  return parts.map((p) => p.trim().replace(/^(\w+=\S*\s+)+/, '')).filter(Boolean);
}

const esc = (s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
function cmdPattern(spec, ci) {
  if (spec.endsWith(':*')) spec = spec.slice(0, -2) + ' *';
  const re = new RegExp('^' + spec.split('*').map(esc).join('[\\s\\S]*') + '$', ci ? 'i' : '');
  const stars = (spec.match(/\*/g) || []).length;
  const bare = stars === 1 && spec.endsWith(' *') ? spec.slice(0, -2) : null;
  return (t) => re.test(t) || (bare !== null && (ci ? t.toLowerCase() === bare.toLowerCase() : t === bare));
}
const PS_ALIAS = { rm: 'Remove-Item', del: 'Remove-Item', ri: 'Remove-Item', rd: 'Remove-Item', rmdir: 'Remove-Item', erase: 'Remove-Item', iex: 'Invoke-Expression' };
function canonPs(t) {
  const m = /^(\S+)(.*)$/s.exec(t);
  if (!m) return t;
  const a = PS_ALIAS[m[1].toLowerCase()];
  return a ? a + m[2] : t;
}

const toPosix = (p) => {
  let s = p.replace(/\\/g, '/');
  const m = /^([A-Za-z]):\/?(.*)$/.exec(s);
  if (m) s = `/${m[1].toLowerCase()}/${m[2]}`;
  return s;
};
function globRe(g) {
  let out = '';
  for (let i = 0; i < g.length; i++) {
    if (g.startsWith('**/', i)) { out += '(?:.*/)?'; i += 2; }
    else if (g.startsWith('/**', i) && i + 3 === g.length) { out += '(?:/.*)?'; i += 2; }
    else if (g.startsWith('**', i)) { out += '.*'; i += 1; }
    else if (g[i] === '*') out += '[^/]*';
    else out += esc(g[i]);
  }
  return new RegExp('^' + out + '$', 'i');
}
function pathPattern(spec, { home, cwd }) {
  let abs;
  if (spec.startsWith('//')) abs = spec.slice(1);
  else if (spec.startsWith('~/')) abs = toPosix(home).replace(/\/$/, '') + spec.slice(1);
  else if (spec === '~') abs = toPosix(home);
  else abs = toPosix(cwd).replace(/\/$/, '') + '/' + (spec.startsWith('**/') ? spec : '**/' + spec.replace(/^\.\//, ''));
  return globRe(abs);
}

const EDIT_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit', 'MultiEdit']);
const toolRe = (name) => new RegExp('^' + name.split('*').map(esc).join('.*') + '$');

// Does one rule match one call? call: { tool, command?, file_path?, input? }; ctx: { home, cwd }.
export function ruleMatches(rule, call, ctx) {
  const m = /^([^()]+?)(?:\(([\s\S]*)\))?$/.exec(rule);
  if (!m) return false;
  const [, name, spec] = m;
  if (name === 'Edit' && spec !== undefined) {
    if (!EDIT_TOOLS.has(call.tool) || !call.file_path) return false;
    return pathPattern(spec, ctx).test(toPosix(path.resolve(ctx.cwd, call.file_path)));
  }
  if ((name === 'Bash' || name === 'PowerShell') && spec !== undefined) {
    if (call.tool !== name || typeof call.command !== 'string') return false;
    const ci = name === 'PowerShell';
    const test = cmdPattern(spec, ci);
    return split(call.command).some((p) => test(ci ? canonPs(p) : p));
  }
  if (!toolRe(name).test(call.tool)) return false;
  if (spec === undefined || spec === '*') return true;
  const pm = /^\s*(\w+)\s*:\s*(.*)$/.exec(spec);
  if (pm) {
    const v = call.input && call.input[pm[1]];
    return v !== undefined && toolRe(pm[2]).test(String(v));
  }
  return false;
}

// The first list (deny, then ask) whose rules match the call, as the app evaluates them; null when none does.
export function decide(perms, call, ctx) {
  for (const list of ['deny', 'ask']) {
    const hit = (perms[list] || []).find((r) => ruleMatches(r, call, ctx));
    if (hit) return { list, rule: hit };
  }
  return null;
}
