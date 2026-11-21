// understand-first: rule 4 ("No building before the plan is approved"), as a check module of the 2026-11-20 contract
// (system/design/enforcement-2026-11-20.md). It takes over, stricter, the gates' stage gate and proof-part gate,
// which only reminded.
//
// Before a tool runs (pretool) it refuses:
//  1. a code file written (Write, Edit, MultiEdit, NotebookEdit, or a shell command that writes it) inside a project
//     whose state note has no dated plan_approved: line, or whose stage is not one where code is written;
//  2. a write to a project's state note that adds or changes plan_approved:, or moves the stage to where code is
//     written, when the owner's own latest message carries no yes (Claude cannot approve its own plan);
//  3. a helper launched without the part "How it will be proven" with its four lines really filled in. Every helper
//     that is not read-only needs it: no guessing whether the work "looks like" change work.
// Kind "discipline": on its own error it lets the step through and logs "error" (rule 4 is not one of the safety rules).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// The words that differ between the owner's copy and the newcomer's copy (this is the newcomer's copy; the owner's lives in core/checks/understand-first).
const WHO = { him: 'the person', his: "the person's", he: 'they' };

let DEFAULT_SETTINGS = null;
function defaults() {
  if (!DEFAULT_SETTINGS) {
    try { DEFAULT_SETTINGS = JSON.parse(fs.readFileSync(path.join(HERE, 'settings.json'), 'utf8')); } catch { DEFAULT_SETTINGS = {}; }
  }
  return DEFAULT_SETTINGS;
}
function cfg(ctx) { return { ...defaults(), ...((ctx && ctx.settings) || {}) }; }

// ---------- paths ----------
function homeOf(ctx) { return (ctx && ctx.home) || os.homedir(); }
export function normPath(p, base, home) {
  if (!p) return '';
  let s = String(p).trim().replace(/^["']+|["']+$/g, '');
  if (s === '~' || s.startsWith('~/') || s.startsWith('~\\')) s = path.join(home || os.homedir(), s.slice(1));
  const m = s.match(/^\/([a-zA-Z])\/(.*)$/); // Git Bash style /c/Users/...
  if (m) s = `${m[1]}:/${m[2]}`;
  s = path.isAbsolute(s) ? path.resolve(s) : path.resolve(base || process.cwd(), s);
  s = s.replace(/\\/g, '/');
  return process.platform === 'win32' ? s.toLowerCase() : s;
}
const under = (abs, folder) => abs === folder || abs.startsWith(folder + '/');

// ---------- the projects, read from their state headers ----------
export function header(text) {
  const m = String(text || '').match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const h = {};
  if (!m) return h;
  for (const line of m[1].split(/\r?\n/)) {
    const k = line.match(/^([a-z_]+):\s*(.*?)\s*$/);
    if (k && !(k[1] in h)) h[k[1]] = k[2];
  }
  return h;
}
function readNote(ctx, rel) {
  if (ctx && typeof ctx.read === 'function') { const t = ctx.read(rel); if (typeof t === 'string') return t; }
  try { return fs.readFileSync(path.join(ctx.root, rel), 'utf8'); } catch { return null; }
}
function projects(ctx) {
  let names = [];
  try { names = fs.readdirSync(path.join(ctx.root, 'projects'), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch { return []; }
  const out = [];
  for (const name of names) {
    const rel = `projects/${name}/state.md`;
    const text = readNote(ctx, rel);
    if (text == null) continue;
    const h = header(text);
    out.push({ name, rel, title: h.project || name, stage: h.stage || '', planApproved: (h.plan_approved || '').trim(),
      folder: h.folder ? normPath(h.folder, ctx.root, homeOf(ctx)) : '' });
  }
  return out;
}
function projectFor(ctx, abs) {
  let best = null;
  for (const p of projects(ctx)) if (p.folder && under(abs, p.folder) && (!best || p.folder.length > best.folder.length)) best = p;
  return best;
}
export function stageWord(stage, S) {
  const s = String(stage || '').trim().toLowerCase();
  return (S.stageWords || []).find((w) => s === w || s.startsWith(w + ' ') || s.startsWith(w + '(') || s.startsWith(w + ',')) || '';
}
// A plan_approved: value counts only when it holds a real date, not later than today, and does not say "no" or "pending".
export function approvalProblem(value, today) {
  const v = String(value || '').trim();
  if (!v) return 'its state note has no plan_approved: line, so there is no record that ' + WHO.he + ' approved a plan';
  if (/^(no|not|none|pending|waiting|tbd|todo|n\/a|false|-)\b/i.test(v)) return `its plan_approved: line says "${v.slice(0, 40)}", which is not an approval`;
  const d = v.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (!d) return `its plan_approved: line ("${v.slice(0, 40)}") holds no date (YYYY-MM-DD), so it cannot be checked`;
  const t = today || isoToday();
  if (d[0] > t) return `its plan_approved: line carries a date in the future (${d[0]})`;
  return '';
}
function isoToday() {
  if (process.env.HIVE_DATE) return process.env.HIVE_DATE;
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ---------- is this file code of a project? ----------
function isCodeFile(abs, S) { return !abs.endsWith('.md') && (S.codeExtensions || []).some((e) => abs.endsWith(e)); }
function codeProblem(ctx, abs, S) {
  if (!abs || !isCodeFile(abs, S)) return null;
  const root = normPath(ctx.root, undefined, homeOf(ctx));
  if (under(abs, root) && (S.notesFolders || []).some((f) => under(abs, root + '/' + String(f).toLowerCase()))) return null;
  const p = projectFor(ctx, abs);
  if (!p) return null;
  const rel = abs === p.folder ? '' : abs.slice(p.folder.length + 1);
  if (rel.split('/').slice(0, -1).some((seg) => (S.skipFolders || []).includes(seg))) return null;
  const issues = [];
  const w = stageWord(p.stage, S);
  if (!w) issues.push(`its stage line ("${p.stage || 'empty'}") does not start with a stage word`);
  else if (!(S.codeAllowedAt || []).includes(w)) issues.push(`it is at the "${w}" stage, and code is written only at ${(S.codeAllowedAt || []).join(', ')}`);
  const a = approvalProblem(p.planApproved, ctx.today);
  if (a) issues.push(a);
  return issues.length ? { p, issues } : null;
}
function codeDeny(what, ci) {
  return `HIVE GATE (understand first): I stopped this step. ${what} is code for the project "${ci.p.title}", and ${ci.issues.join('; and ')}. ` +
    `Rule 4: no building before the plan is approved. The one thing to do: show ${WHO.him} the plan, get ${WHO.his} yes in ${WHO.his} own message, ` +
    `then set "stage: build" and "plan_approved: <the date and ${WHO.his} words>" in ${ci.p.rel}.`;
}

// ---------- reading what a shell command writes ----------
function dropBodies(cmd) {
  const lines = String(cmd || '').split(/\r?\n/);
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    out.push(line);
    const hd = line.match(/<<-?\s*['"]?([A-Za-z_][\w-]*)['"]?/);
    if (hd) { while (i + 1 < lines.length && lines[i + 1].trim() !== hd[1]) i++; i++; continue; }
    if (/@['"]\s*$/.test(line)) { const close = line.trim().endsWith('"') ? '"@' : "'@"; while (i + 1 < lines.length && !lines[i + 1].startsWith(close)) i++; i++; }
  }
  return out.join('\n');
}
// Simple commands, each a list of words (quotes removed) and the files its unquoted > or >> writes to.
export function simpleCommands(cmd) {
  const text = dropBodies(cmd);
  const cmds = [];
  let words = [], word = '', inWord = false, q = '', redirectNext = false, inputNext = false, writes = [];
  const endWord = () => {
    if (!inWord) return;
    if (redirectNext) { writes.push(word); redirectNext = false; } else if (inputNext) inputNext = false; else words.push(word);
    word = ''; inWord = false;
  };
  const endCmd = () => { endWord(); if (words.length || writes.length) cmds.push({ words, writes }); words = []; writes = []; redirectNext = false; inputNext = false; };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === q) q = ''; else word += c; continue; }
    if (c === '"' || c === "'") { q = c; inWord = true; continue; }
    if (c === '\\' && text[i + 1] && text[i + 1] !== '\n' && process.platform !== 'win32') { word += text[++i]; inWord = true; continue; }
    if (c === '<') { // an input (< file, << marker, <<< text) is read, never written
      endWord();
      while (text[i + 1] === '<' || text[i + 1] === '-') i++;
      if (text[i + 1] === '(') { endCmd(); i++; continue; } // <( ... ) runs a command
      inputNext = true; continue;
    }
    if (c === '>') {
      const fd = inWord && /^\d$/.test(word); // 2> is a redirect of errors, still a write
      if (fd) { word = ''; inWord = false; } else endWord();
      if (text[i + 1] === '>') i++;
      if (text[i + 1] === '&') { i++; continue; } // >&2 is not a file
      redirectNext = true; continue;
    }
    if (c === ';' || c === '\n' || c === '|' || c === '&' || c === '(' || c === ')' || c === '{' || c === '}' || c === '`') { endCmd(); continue; }
    if (c === '$' && text[i + 1] === '(') { endCmd(); i++; continue; }
    if (/\s/.test(c)) { endWord(); continue; }
    word += c; inWord = true;
  }
  endCmd();
  return cmds;
}
const NOT_FILES = new Set(['/dev/null', '$null', 'nul', 'null', '/dev/stderr', '/dev/stdout']);
const PS_PATH_FLAGS = ['-path', '-filepath', '-literalpath', '-destination'];
// The files a shell command writes, each made absolute. "cd X" and Set-Location move the folder for what follows.
export function shellWrites(command, cwd, home) {
  let dir = cwd;
  const found = [];
  const add = (f) => { if (f && !NOT_FILES.has(String(f).toLowerCase()) && !/^-/.test(f)) found.push(normPath(f, dir, home)); };
  for (const { words, writes } of simpleCommands(command)) {
    writes.forEach(add);
    if (!words.length) continue;
    const name = path.basename(words[0]).toLowerCase().replace(/\.exe$/, '');
    const args = words.slice(1);
    const plain = args.filter((a) => !a.startsWith('-'));
    if (['cd', 'set-location', 'sl', 'pushd', 'chdir'].includes(name) && plain[0]) { dir = normPath(plain[0], dir, home); continue; }
    if (['tee', 'touch', 'tee-object'].includes(name)) plain.forEach(add);
    else if (['cp', 'mv', 'copy', 'move', 'copy-item', 'move-item', 'cpi', 'mi', 'install', 'rsync', 'ln'].includes(name) && plain.length >= 2) add(plain[plain.length - 1]);
    else if (name === 'sed' && args.some((a) => /^-[a-z]*i/.test(a) || a === '--in-place') && plain.length) add(plain[plain.length - 1]);
    else if (['set-content', 'add-content', 'out-file', 'new-item', 'sc', 'ac', 'ni'].includes(name)) {
      const at = args.findIndex((a) => PS_PATH_FLAGS.includes(a.toLowerCase()));
      if (at >= 0 && args[at + 1]) add(args[at + 1]); else if (plain[0]) add(plain[0]);
    } else if (name === 'git' && args[0] === 'checkout' && args.includes('--')) args.slice(args.indexOf('--') + 1).forEach(add);
  }
  return found;
}

// ---------- the owner's own approval of a plan ----------
function hisYes(ctx, S) {
  const words = (S.approvalWords || []).map((w) => String(w).toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (!words.length) return false;
  const re = new RegExp('(^|[^a-z])(' + words.join('|') + ')($|[^a-z])', 'i');
  if (typeof ctx.said === 'function') return !!ctx.said(re);
  return re.test(String(ctx.hisLast || ''));
}
function applyEdits(old, edits) {
  let t = String(old || '');
  for (const e of edits || []) {
    if (!e || typeof e.old_string !== 'string') continue;
    t = e.replace_all ? t.split(e.old_string).join(String(e.new_string || '')) : t.replace(e.old_string, () => String(e.new_string || ''));
  }
  return t;
}
// The new text of a state note after this tool call, or null when it is not a state note.
function stateAfter(ctx, ev, abs) {
  const root = normPath(ctx.root, undefined, homeOf(ctx));
  const m = abs.match(/\/projects\/([^/]+)\/state\.md$/);
  if (!m || !under(abs, root + '/projects')) return null;
  const rel = `projects/${m[1]}/state.md`;
  let before = '';
  try { before = fs.readFileSync(path.join(ctx.root, rel), 'utf8'); } catch {}
  const ti = ev.input || {};
  let after;
  if (ev.tool === 'Write') after = String(ti.content || '');
  else if (ev.tool === 'Edit') after = applyEdits(before, [ti]);
  else if (ev.tool === 'MultiEdit') after = applyEdits(before, ti.edits);
  else return null;
  return { rel, before, after };
}
export function unlocks(before, after, S) {
  const a = header(before), b = header(after);
  const reasons = [];
  const pa = (a.plan_approved || '').trim(), pb = (b.plan_approved || '').trim();
  if (pb && pb !== pa) reasons.push(`it writes plan_approved: "${pb.slice(0, 60)}"`);
  const allowed = S.codeAllowedAt || [];
  const wa = stageWord(a.stage, S), wb = stageWord(b.stage, S);
  if (wb && allowed.includes(wb) && !allowed.includes(wa)) reasons.push(`it moves the stage from "${wa || a.stage || 'empty'}" to "${wb}"`);
  return reasons;
}
function selfApprovalDeny(rel, reasons) {
  return `HIVE GATE (understand first): I stopped this step. It changes ${rel} so that code may be written (${reasons.join('; and ')}), ` +
    `and ${WHO.his} own latest message carries no yes. Only ${WHO.him} approves a plan, never Claude and never a helper (rule 4). ` +
    `The one thing to do: show ${WHO.him} the plan in one plain message and ask; write the line after ${WHO.his} yes, with the date and ${WHO.his} words.`;
}

// ---------- the proof part of a helper's brief ----------
function isHelperTool(tool, S) {
  return (S.helperTools || []).includes(tool) || (S.helperToolEndings || []).some((e) => String(tool).endsWith(e));
}
function readOnlyHelper(input, S) {
  if ((S.readOnlyAgents || []).includes(input.subagent_type || '')) return true;
  const text = String(input.prompt || '');
  return !!S.readOnlyMarker && text.toLowerCase().includes(String(S.readOnlyMarker).toLowerCase());
}
function placeholder(value, S) {
  const v = String(value || '').replace(/<[^>]*>/g, '').replace(/out of scope\s*:.*/i, '').trim().toLowerCase().replace(/[\s.,;:*_`-]+$/g, '').replace(/^[\s.,;:*_`-]+/g, '');
  if (v.replace(/[^a-z0-9]/g, '').length < 3) return true;
  return (S.proof.placeholders || []).includes(v);
}
// The names of the lines of the proof part that are missing, empty or not of the right kind. All when the part is missing.
export function proofMissing(text, S) {
  const P = S.proof;
  const lines = String(text || '').split(/\r?\n/);
  const heading = String(P.heading).toLowerCase();
  // The heading must be a heading line of its own (a "#" line, a bold line, or the line itself), not a mention in a sentence.
  const at = lines.findIndex((l) => l.trim().replace(/^#{1,6}\s*/, '').replace(/^\d+[.)]\s*/, '').replace(/[*_:]/g, '').trim().toLowerCase() === heading);
  if (at < 0) return P.parts.map((x) => x.name);
  const body = [];
  for (let i = at + 1; i < lines.length && i <= at + 40; i++) { if (/^\s*#{1,6}\s/.test(lines[i])) break; body.push(lines[i]); }
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  const missing = [];
  for (const part of P.parts) {
    const re = new RegExp('^[\\s*_>-]*' + esc(part.name) + '[*_]*\\s*:\\s*(.*)$', 'i');
    const hit = body.map((l) => l.match(re)).find(Boolean);
    if (!hit || placeholder(hit[1], S)) { missing.push(part.name); continue; }
    const value = hit[1].replace(/out of scope\s*:.*/i, '');
    if (part.needs && !new RegExp(part.needs, 'i').test(value)) missing.push(part.name + ' (' + part.needsWhat + ')');
  }
  return missing;
}
function proofDeny(lacks, S) {
  const all = lacks.length === S.proof.parts.length;
  const what = all ? `the part "${S.proof.heading}"` : `these lines of the part "${S.proof.heading}": ${lacks.join(', ')}`;
  return `HIVE GATE (understand first): I stopped this helper from starting, because its brief lacks ${what}. ` +
    `Rule 4 and rule 5: a helper that may change anything must know before it starts how to see the fault today, the steps a checker walks, ` +
    `the checks that must pass (with their commands) and the files it may touch. The one thing to do: fill in that part from core/templates/build-brief.md ` +
    `and launch it again. A helper that only searches or reads carries the line "${S.readOnlyMarker}", or is an Explore helper.`;
}

// ---------- the step ----------
function pretoolStep(ev, ctx) {
  if (ctx && ctx.settings && ctx.settings.__crash) throw new Error('test crash in understand-first');
  const S = cfg(ctx);
  const tool = ev.tool || ev.tool_name || '';
  const input = ev.input || ev.tool_input || {};
  const cwd = ev.cwd || ctx.root;
  const home = homeOf(ctx);
  if (isHelperTool(tool, S)) {
    if (readOnlyHelper(input, S)) return null;
    const lacks = proofMissing(input.prompt || input.message || input.task || '', S);
    return lacks.length ? { deny: proofDeny(lacks, S) } : null;
  }
  if (['Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(tool)) {
    const abs = normPath(input.file_path || input.notebook_path || '', cwd, home);
    const st = stateAfter(ctx, { ...ev, tool, input }, abs);
    if (st) {
      const r = unlocks(st.before, st.after, S);
      if (r.length && !hisYes(ctx, S)) return { deny: selfApprovalDeny(st.rel, r) };
      return null;
    }
    const ci = codeProblem(ctx, abs, S);
    return ci ? { deny: codeDeny(`${tool === 'Write' ? 'Writing' : 'Editing'} ${abs}`, ci) } : null;
  }
  if (tool === 'Bash' || tool === 'PowerShell') {
    const command = String(ev.command || input.command || '');
    const root = normPath(ctx.root, undefined, home);
    for (const abs of shellWrites(command, normPath(cwd, undefined, home), home)) {
      if (/\/projects\/[^/]+\/state\.md$/.test(abs) && under(abs, root + '/projects') && /plan_approved|stage\s*:/i.test(command) && !hisYes(ctx, S)) {
        return { deny: selfApprovalDeny(abs.slice(root.length + 1), ['a shell command rewrites its plan_approved: or stage: line']) };
      }
      const ci = codeProblem(ctx, abs, S);
      if (ci) return { deny: codeDeny(`This shell command writes ${abs}`, ci) };
    }
  }
  return null;
}
// Discipline: an error of this check lets the step through and is logged; it never stops work because it broke.
function guarded(fn) {
  return (ev, ctx) => {
    try { return fn(ev || {}, ctx || {}); } catch (e) {
      try { ctx && typeof ctx.log === 'function' && ctx.log('error', { check: 'understand-first', error: String((e && e.message) || e).slice(0, 200) }); } catch {}
      return null;
    }
  };
}

export default {
  id: 'understand-first',
  rule: 'rule 4',
  kind: 'discipline',
  mode: 'refuse',
  about: 'Code is written only in a project whose plan the person approved, only they approve it, and no helper that may change things starts without its proof part.',
  steps: { pretool: guarded(pretoolStep) },
};
