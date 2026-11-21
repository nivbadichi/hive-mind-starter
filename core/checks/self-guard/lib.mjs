// The self-guard check's working parts: where the guarded places are, whether a change weakens a check, the hash
// comparison of installed copies with the notebook's, the hooks the app's settings must carry, the canary marks,
// and the log read back in plain words. No part of this file switches anything on or off by itself.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { approvedBy } from '../_lib/his-words.mjs';

// ---------- small tools ----------
export const slash = (p) => String(p || '').replace(/\\/g, '/').replace(/\/+/g, '/').toLowerCase();
// Text with its line ends made the same, and a leading byte-order mark taken off: Windows and git change line ends, and
// PowerShell writes the mark, so two copies that differ only there are the same file (2026-11-20, seen live).
export const norm = (s) => String(s).replace(/^﻿/, '').replace(/\r\n?/g, '\n');
const isText = (buf) => !buf.includes(0);
export const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
// The fingerprint a hash decides on: of the text with its line ends made the same (raw bytes for a binary file).
export const textSha = (buf) => sha(isText(buf) ? Buffer.from(norm(buf.toString('utf8'))) : buf);
function readBuf(p) { try { return fs.readFileSync(p); } catch { return null; } }
function readText(p) { const b = readBuf(p); return b === null ? null : b.toString('utf8'); }
function readJson(p, fallback) { try { return JSON.parse(fs.readFileSync(p, 'utf8').replace(/^﻿/, '')); } catch { return fallback; } }
function writeJson(p, v) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(v)); }
function isDir(p) { try { return fs.statSync(p).isDirectory(); } catch { return false; } }
function walk(dir, base = dir, out = []) {
  let list = [];
  try { list = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of list) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, base, out); else if (e.isFile()) out.push(path.relative(base, p));
  }
  return out;
}
const under = (file, dir) => { const f = slash(file), d = slash(dir).replace(/\/$/, ''); return f === d || f.startsWith(d + '/'); };
export const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// The places, from the check's ctx: the notebook, the Hive folder, the app's folder, this check's own records.
export function places(ctx) {
  const root = ctx.root;
  const state = ctx.state;
  if (!root || !state) throw new Error('the notebook or the Hive folder is not known');
  const claudeDir = ctx.claudeDir || path.dirname(state);
  return { root, state, claudeDir, own: path.join(state, 'self-guard'), cwd: ctx.cwd || '' };
}

// Their own words name the act: one of the phrases in the list, never a bare yes-word.
export function saidAny(ctx, words) {
  if (!ctx || ctx.isHelperChat) return false;
  const msg = ' ' + String(ctx.hisLast || '').toLowerCase().replace(/[’`]/g, "'").replace(/\s+/g, ' ') + ' ';
  // "don't switch the gates off" names the act too, but forbids it: a phrase with a "no" word just before it never counts.
  const negated = (i) => /\b(don't|dont|do not|never|not|no|without|stop)\b[^.,;!?]{0,20}$/.test(msg.slice(Math.max(0, i - 30), i));
  const inMessage = (words || []).some((w) => {
    const p = String(w).toLowerCase();
    for (let i = msg.indexOf(p); i >= 0; i = msg.indexOf(p, i + 1)) if (!negated(i)) return true;
    return false;
  });
  // His answer on a question card is his word for the act that card asked about, and only for it (2026-11-20: he
  // tapped "Yes, reinstall the gates" and the install was still refused).
  return inMessage || (!!ctx.cards && !!approvedBy(ctx.cards, words));
}
// Only his message of THIS step (at his message), never one kept from before: a ruling is made by what he just said.
// A helper's report, a task notice or another chat's message at this step is not his (ctx.hisNow is false then).
export function saidNow(ctx, words) {
  if (!ctx || ctx.isHelperChat || ctx.hisNow === false) return false;
  return saidAny({ ...ctx, cards: [] }, words);
}

// ---------- what is guarded ----------
// kind: switch (an off switch or the hold), log (the record of refusals), installed (a copy the app runs),
// records (the gates' per-chat records), own (this check's records), hive (anything else in the Hive folder),
// app-settings / check-settings / check-module (changes are looked at: only a weakening is refused),
// check-source (the checks' other files in the notebook: a write passes, a delete or move by shell does not).
export function guardedPlace(file, P, S = {}) {
  if (!file) return null;
  const f = slash(path.resolve(String(file)));
  const st = slash(P.state);
  if (under(f, st)) {
    const rel = f.slice(st.length + 1);
    if (/^(gates-off|factory-off|publish-hold)$/.test(rel)) return { kind: 'switch', label: `the ${rel} file` };
    if (/^(gates\.log(\.1)?|corrections\.log|checks\.log(\.1)?)$/.test(rel)) return { kind: 'log', label: `the log ${rel}` };
    if (rel.startsWith('self-guard/')) return { kind: 'own', label: "the self-guard check's own records" };
    if ((S.freeFolders || ['verify', 'sources']).some((d) => rel.startsWith(slash(d) + '/'))) return null; // a checker's evidence, what the person sent
    if (rel === 'gates/gates.mjs' || rel === 'start.ps1' || /^[^/]+\.mjs$/.test(rel) || /^privacy-guard\./.test(rel) || rel.startsWith('checks/') || rel.startsWith(slash(S.installedChecksDir || 'checks-installed') + '/') || rel === 'install-record.json' || rel === 'config.json')
      return { kind: 'installed', label: `the installed copy ${rel}` };
    if (rel.startsWith('gates/')) return { kind: 'records', label: "the gates' records" };
    return { kind: 'hive', label: `${rel} in the Hive folder` };
  }
  const sk = slash(path.join(P.claudeDir, 'skills'));
  if (under(f, sk)) {
    const name = f.slice(sk.length + 1).split('/')[0];
    if (name && isDir(path.join(P.root, 'core', 'skills', name))) return { kind: 'installed', label: `the installed skill ${name}` };
  }
  if (/\/\.claude\/settings(\.local)?\.json$/.test(f)) return { kind: 'app-settings', label: "the app's settings" };
  const rt = slash(P.root);
  if (under(f, rt)) {
    const rel = f.slice(rt.length + 1);
    if (rel === 'core/gates/settings.json' || /^core\/checks\/[^/]+\/settings\.json$/.test(rel)) return { kind: 'check-settings', label: `the settings ${rel}` };
    if (/^core\/checks\/[^/]+\/check\.mjs$/.test(rel)) return { kind: 'check-module', label: `the check ${rel}` };
    if (rel.startsWith('core/gates/') || rel.startsWith('core/checks/')) return { kind: 'check-source', label: rel };
    if (rel === '.git/hooks/pre-commit') return { kind: 'installed', label: 'the privacy save hook' };
  }
  return null;
}

// ---------- does a change weaken a check? ----------
const RANK = { off: 0, notice: 1, on: 1, refuse: 2 };
function weakerJson(a, b, S, at = '') {
  const loose = new RegExp(S.looserLists || 'skip|ignore|allow', 'i');
  if (Array.isArray(a)) {
    const B = Array.isArray(b) ? b.map((x) => JSON.stringify(x)) : [];
    const A = a.map((x) => JSON.stringify(x));
    const key = at.split('.').pop();
    if (!loose.test(key)) { const gone = A.filter((x) => !B.includes(x)); if (gone.length) return `it takes ${plural(gone.length, 'entry', 'entries')} out of ${at}`; }
    return '';
  }
  if (a && typeof a === 'object') {
    for (const k of Object.keys(a)) {
      const p = at ? `${at}.${k}` : k;
      if (k.startsWith('_')) continue;
      const bk = b && typeof b === 'object' ? b[k] : undefined;
      if (bk === undefined) { if (/^(mode|enabled|kind)$/.test(k) || (a[k] && typeof a[k] === 'object')) return `it removes ${p}`; continue; }
      if (k === 'mode' && typeof a[k] === 'string' && (RANK[String(bk)] ?? 0) < (RANK[a[k]] ?? 0)) return `it turns ${p} from "${a[k]}" to "${bk}"`;
      // How hard the lock bites while an installed copy differs: "strict" (every step but reading) is harder than "narrow".
      if (k === 'bite' && a[k] === 'strict' && bk !== 'strict') return `it turns ${p} from "strict" to "${bk}", which lets more through while an installed copy differs`;
      if (k === 'enabled' && a[k] === true && bk !== true) return `it sets ${p} to ${JSON.stringify(bk)}`;
      if (k === 'kind' && a[k] === 'safety' && bk !== 'safety') return `it makes ${p} "${bk}" instead of "safety"`;
      const r = weakerJson(a[k], bk, S, p); if (r) return r;
    }
    if (b && typeof b === 'object') for (const k of Object.keys(b)) {
      if (Array.isArray(b[k]) && loose.test(k)) {
        const A = Array.isArray(a[k]) ? a[k].map((x) => JSON.stringify(x)) : [];
        const added = b[k].filter((x) => !A.includes(JSON.stringify(x)));
        if (added.length) return `it adds ${plural(added.length, 'entry', 'entries')} to ${at ? at + '.' : ''}${k}, which lets more through`;
      }
    }
  }
  return '';
}
const OURS = /(start\.(ps1|mjs)|gates\.mjs|on-(edit|stop)\.mjs|core[\\/]+checks)/i;
function hookSigs(s) {
  const out = [];
  for (const [ev, list] of Object.entries((s && s.hooks) || {})) for (const e of (Array.isArray(list) ? list : [])) for (const h of (e.hooks || [])) {
    const t = [h.command, ...(h.args || [])].join(' ');
    if (OURS.test(t)) out.push(`${ev} ${sigOf(t)} [${e.matcher || ''}]`);
  }
  return out;
}
function weakerAppSettings(a, b) {
  if (b && b.disableAllHooks === true && !(a && a.disableAllHooks === true)) return 'it sets disableAllHooks, which switches every hook off';
  const A = hookSigs(a), B = hookSigs(b);
  const gone = A.filter((x) => !B.includes(x));
  if (gone.length) return `it takes Hive Mind's hook out (${gone[0]})`;
  for (const k of ['deny', 'ask']) {
    const pa = (a && a.permissions && a.permissions[k]) || [], pb = (b && b.permissions && b.permissions[k]) || [];
    const lost = pa.filter((x) => !pb.includes(x));
    if (lost.length) return `it takes ${plural(lost.length, 'rule', 'rules')} out of the app's "${k}" list (${lost[0]})`;
  }
  if (b && b.permissions && b.permissions.defaultMode === 'bypassPermissions' && !(a && a.permissions && a.permissions.defaultMode === 'bypassPermissions')) return 'it sets the app to skip every permission question';
  return '';
}
function moduleFacts(t) {
  const kind = (String(t).match(/\bkind\s*:\s*['"](\w+)['"]/) || [])[1] || '';
  const mode = (String(t).match(/\bmode\s*:\s*['"](\w+)['"]/) || [])[1] || '';
  const steps = new Set((String(t).match(/\b(pretool|posttool|prompt|stop|helperstop)\s*(?=[(:,])/g) || []));
  return { kind, mode, steps };
}
function weakerModule(a, b) {
  const A = moduleFacts(a), B = moduleFacts(b);
  if (A.kind === 'safety' && B.kind !== 'safety') return `it makes the check "${B.kind || 'no kind'}" instead of "safety"`;
  if (A.mode && (RANK[B.mode] ?? 0) < (RANK[A.mode] ?? 0)) return `it turns the check from "${A.mode}" to "${B.mode || 'no mode'}"`;
  const lost = [...A.steps].filter((s) => !B.steps.has(s));
  if (lost.length) return `it takes the step "${lost[0]}" out of the check`;
  return '';
}
const parse = (t) => JSON.parse(String(t).replace(/^﻿/, ''));
// The text after the tool runs, from what is on disk now and the tool's input; null when it cannot be known.
export function textAfter(tool, input, before) {
  const cur = before ?? '';
  if (tool === 'Write') return typeof input.content === 'string' ? input.content : null;
  // As the app's Edit tool applies it (2026-11-20, the second roast, R18m and N18m): the text as written; else with the
  // file's Windows line ends; else with every line end made the same. An old text that is not there at all: the new
  // text cannot be known (null), so a guarded file's edit is judged as one that cannot be told, and refused.
  const one = (t, e) => {
    if (typeof e.old_string !== 'string' || typeof e.new_string !== 'string' || !e.old_string) return null;
    const put = (s, a, b) => (e.replace_all ? s.split(a).join(b) : s.replace(a, () => b));
    if (t.includes(e.old_string)) return put(t, e.old_string, e.new_string);
    if (/\r\n/.test(t)) {
      const a2 = e.old_string.replace(/\r?\n/g, '\r\n'), b2 = e.new_string.replace(/\r?\n/g, '\r\n');
      if (t.includes(a2)) return put(t, a2, b2);
    }
    const tn = norm(t), an = norm(e.old_string);
    if (an && tn.includes(an)) return put(tn, an, norm(e.new_string));
    return null;
  };
  if (tool === 'Edit') return one(cur, input);
  if (tool === 'MultiEdit') { let t = cur; for (const e of input.edits || []) { t = one(t, e); if (t === null) return null; } return t; }
  return null;
}
export function weakens(kind, beforeText, afterText, S) {
  if (afterText === null) return 'its new text cannot be known before it runs';
  if (kind === 'check-module') return weakerModule(beforeText || '', afterText);
  let a = {}, b;
  try { a = beforeText ? parse(beforeText) : {}; } catch { a = {}; }
  try { b = parse(afterText); } catch { return 'its new text is not readable settings'; }
  return kind === 'app-settings' ? weakerAppSettings(a, b) : weakerJson(a, b, S);
}

// ---------- shell commands ----------
// Lower case, forward slashes, the home folder written out; the markers of a guarded place it names.
export function shellLook(cmd, P, S) {
  const home = slash(path.dirname(P.claudeDir));
  const c = slash(String(cmd || ''))
    .replace(/\$env:userprofile|%userprofile%|\$\{?home\}?|~(?=\/)/g, home);
  const marks = [];
  const add = (m, label, kind) => { if (c.includes(m)) marks.push({ label, kind }); };
  // The Hive folder, unless every place named in it is a free folder (a checker's evidence, what the person sent).
  const free = (S.freeFolders || ['verify', 'sources']).map((d) => slash(d) + '/');
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const hiveRe = new RegExp(`(?:${esc(slash(P.state))}|\\.claude/hive)(/[^\\s"';|&<>]*)?`, 'g');
  const inHive = [...c.matchAll(hiveRe)].map((m) => (m[1] || '/').slice(1));
  if (inHive.length && !inHive.every((rel) => free.some((d) => rel.startsWith(d)))) marks.push({ label: 'the Hive folder', kind: 'hive' });
  for (const s of ['gates-off', 'factory-off', 'publish-hold']) add(s, `the ${s} file`, 'switch');
  add('disableallhooks', 'the switch that turns every hook off', 'switch');
  add('.claude/settings', "the app's settings", 'app-settings');
  add(slash(path.join(P.claudeDir, 'skills')) + '/hive-', 'an installed Hive skill', 'installed');
  add('core/gates/', "the gates' files", 'check-source');
  add('core/checks/', "the checks' files", 'check-source');
  const unquoted = c.replace(/"(?:[^"\\]|\\.)*"|'[^']*'/g, '""');
  const redirect = /(^|[^-=<>&2])>{1,2}\s*(?!&|\$null|\/dev\/null|nul\b)\S/.test(unquoted);
  const words = (S.writeWords || []).filter((w) => new RegExp('(^|[^a-z0-9_-])' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?=$|[^a-z0-9_-])').test(c));
  // A command only reads when every part of it does: "ls && node x.mjs" is not a reading command because it starts
  // with ls. Each part (split at ; && || | and new lines) starts with a reading word or is one of our own readers,
  // and nothing in it runs a hidden command ($( ) or backticks).
  const readsOnly = (seg) => {
    const first = (seg.trim().match(/^[&.\s]*([^\s;|&]+)/) || [])[1] || '';
    // git's own reading commands read too (2026-11-20: "git status" was frozen while the lock held).
    return (S.readVerbs || []).includes(first.replace(/\.exe$/, '')) || (S.ourReaders || []).some((r) => seg.includes(r)) || /^\s*git\s+(-C\s+\S+\s+)?(status|log|diff|show|branch|rev-parse|ls-files|blame|grep|describe)\b(?![^\n]*\s(-o|--output)\b)/.test(seg);
  };
  const parts = unquoted.split(/;|&&|\|\||\||\n/).filter((s) => s.trim());
  const reader = parts.length > 0 && !/\$\(|`/.test(c) && parts.every(readsOnly);
  const run = installerRun(cmd, P, S);
  return { text: c, marks, writes: redirect || words.length > 0, reader, installer: run.runs && !run.test, installerTest: run.runs && run.test, installerLooks: run.onlyLooks, words };
}

// Does the command RUN an installer, and for real? (2026-11-20, seen live: a command that only named the installer's
// file, a note being written that named it, and the copy's own installer aimed at a made-up home were all refused as
// "running the installer".) It runs one when a part of the command starts with the installer's file, or with a
// program (node, sh, bash, powershell, pwsh, cmd, the & or . call) whose first file is the installer. It is not a real
// install when it asks only for the help, starts with no command (install.mjs prints its help then), or is a dry run.
// test: it is aimed at a folder under the system temp folder that is not the Claude folder this check guards.
const RUNNERS = new Set(['node', 'sh', 'bash', 'zsh', 'powershell', 'pwsh', 'cmd', 'start-process', '&', '.']);
const VALUED = new Set(['-executionpolicy', '-ep', '-command', '-c', '-workingdirectory', '-wd']);
function words(seg) {
  const out = []; const re = /"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+)/g; let m;
  while ((m = re.exec(seg))) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}
function splitTop(cmd) { // the parts of a command at ; && || | and new lines that are not inside quotes
  const parts = []; let cur = '', q = '';
  for (let i = 0; i < cmd.length; i++) {
    const ch = cmd[i];
    if (q) { cur += ch; if (ch === q) q = ''; continue; }
    if (ch === '"' || ch === "'") { q = ch; cur += ch; continue; }
    if (ch === ';' || ch === '\n' || ch === '|' || (ch === '&' && cmd[i + 1] === '&')) { parts.push(cur); cur = ''; if (cmd[i + 1] === ch) i++; continue; }
    cur += ch;
  }
  parts.push(cur);
  return parts.map((p) => p.trim()).filter(Boolean);
}
export function installerRun(cmd, P, S = {}) {
  const list = (S.installers || []).map((x) => slash(x)).filter((x) => !/\s/.test(x));
  const isInst = (w) => { const s = slash(w).replace(/^\.\//, ''); return list.some((x) => s === x || s.endsWith('/' + x)); };
  const home = slash(path.dirname(P.claudeDir || ''));
  const tmp = [os.tmpdir(), process.env.TEMP, process.env.TMP, process.env.TMPDIR].filter(Boolean).map((t) => slash(path.resolve(t)));
  let runs = false, real = false, acts = false;
  for (const part of splitTop(String(cmd || ''))) {
    let w = words(part);
    while (w.length && /^[A-Za-z_]\w*=/.test(w[0])) w.shift();
    if (!w.length) continue;
    let i = 0;
    if (!isInst(w[0])) {
      const first = path.basename(slash(w[0])).replace(/\.exe$/, '');
      if (!RUNNERS.has(first)) continue;
      i = 1;
      while (i < w.length && (w[i].startsWith('-') || w[i].startsWith('/'))) { if (VALUED.has(w[i].toLowerCase())) i++; i++; if (/^-file$/i.test(w[i - 1] || '')) break; }
      if (i >= w.length || !isInst(w[i])) continue;
    }
    runs = true;
    const args = w.slice(i + 1).map((a) => a.toLowerCase());
    const inst = slash(w[i]);
    const asksHelp = args.some((a) => ['--help', '-h', 'help', '/?', '-?'].includes(a));
    const dry = args.some((a) => ['--dry-run', '-dryrun', '-whatif'].includes(a));
    const noCmd = /install\.(mjs|sh)$/.test(inst) && !args.some((a) => ['install', 'uninstall', 'remove-gates', 'clear'].includes(a));
    if (asksHelp || dry || noCmd) continue;
    acts = true;
    // The folder it is aimed at: --claude-dir / -ClaudeDir / --home; none named is the real Claude folder.
    const at = (names) => { const k = w.slice(i + 1).findIndex((a) => names.includes(a.toLowerCase())); return k >= 0 ? w[i + 2 + k] : ''; };
    const target = at(['--claude-dir', '-claudedir']) || (at(['--home']) ? path.join(at(['--home']), '.claude') : '');
    const t = target ? slash(path.resolve(target.replace(/^~(?=[\\/])/, home))) : slash(P.claudeDir || '');
    const guarded = slash(P.claudeDir || '');
    const underTmp = tmp.some((d) => t === d || t.startsWith(d + '/'));
    const isGuarded = !!guarded && (t === guarded || t.startsWith(guarded + '/') || guarded.startsWith(t + '/'));
    if (!target || !underTmp || isGuarded) real = true;
  }
  // onlyLooks: every run of it only shows the help or lists what it would change (a dry run).
  return { runs, test: runs && !real, onlyLooks: runs && !acts };
}

// ---------- installed copies against the notebook ----------
// The pairs the installer puts in place (core/install/install.mjs, function desired), minus the merged files
// (the app's settings, the CLAUDE.md block, config.json), which are looked at by other means.
export function installPairs(root, state, claudeDir, S = {}) {
  const pairs = [];
  const add = (src, dst) => pairs.push({ src, dst });
  const R = (...a) => path.join(root, ...a);
  add(R('core', 'start', 'start.ps1'), path.join(state, 'start.ps1'));
  try { for (const f of fs.readdirSync(R('core', 'start'))) if (f.endsWith('.mjs') && !f.endsWith('.test.mjs')) add(R('core', 'start', f), path.join(state, f)); } catch {}
  add(R('core', 'gates', 'gates.mjs'), path.join(state, 'gates', 'gates.mjs'));
  add(R('core', 'guard', 'privacy-guard.ps1'), path.join(state, 'privacy-guard.ps1'));
  add(R('core', 'guard', 'privacy-guard.mjs'), path.join(state, 'privacy-guard.mjs'));
  // The checks, when an installer puts copies of them in the Hive folder (today the gates read them from the notebook).
  // Not <hive>/checks: that is where the loader keeps its records (the second roast, finding 1: taking it for the
  // installed copies locked every chat from its third message).
  const inst = path.join(state, S.installedChecksDir && S.installedChecksDir !== 'checks' ? S.installedChecksDir : 'checks-installed');
  if (isDir(inst)) for (const rel of walk(R('core', 'checks'))) if (!/\.test\.mjs$|README\.md$/i.test(rel)) add(R('core', 'checks', rel), path.join(inst, rel));
  if (isDir(R('.git', 'hooks'))) add(R('core', 'guard', 'pre-commit'), R('.git', 'hooks', 'pre-commit'));
  // The skills last: the most files, the least weight.
  try { for (const d of fs.readdirSync(R('core', 'skills'), { withFileTypes: true })) if (d.isDirectory()) for (const rel of walk(R('core', 'skills', d.name))) add(R('core', 'skills', d.name, rel), path.join(claudeDir, 'skills', d.name, rel)); } catch {}
  return pairs.filter((p) => fs.existsSync(p.src));
}
// The hash of a file's content (text with its line endings made the same, as the installer writes it), kept in a
// cache by size and time stamp so the next message only looks at the time stamps. fresh: never trust the cache
// (the verify and start commands), so a copy changed with its time stamp put back is still found.
function hasher(cacheFile, fresh = false) {
  const cache = fresh ? {} : readJson(cacheFile, {});
  let dirty = false;
  return {
    // 'gone' when there is no file, the hash when the cache knows it, null when it must be read.
    peek(p) {
      let st; try { st = fs.statSync(p); } catch { return 'gone'; }
      const c = cache[slash(p)];
      return c && c[0] === st.mtimeMs && c[1] === st.size ? c[2] : null;
    },
    get(p) {
      const known = this.peek(p);
      if (known === 'gone') return null;
      if (known) return known;
      let st; try { st = fs.statSync(p); } catch { return null; }
      const b = readBuf(p); if (b === null) return null;
      const h = textSha(b);
      cache[slash(p)] = [st.mtimeMs, st.size, h, sha(b)]; dirty = true;
      return h;
    },
    // The hash of the raw bytes (what the installer writes in its record), from the cache when it knows it.
    raw(p) {
      const c = cache[slash(p)];
      let st; try { st = fs.statSync(p); } catch { return null; }
      if (c && c[0] === st.mtimeMs && c[1] === st.size && c[3]) return c[3];
      const b = readBuf(p); return b === null ? null : sha(b);
    },
    save() { if (dirty) try { writeJson(cacheFile, cache); } catch {} },
  };
}
// budgetMs: stop reading new files once this call has taken that long (a message must stay fast); what is
// left is counted as "pending" and finished at the next calls. Files the cache already knows cost only a look at
// their time stamp and are always compared, and at least one new pair is read at every call, so the work always
// moves on. The pairs come in order of weight: the gates and the start step first, the skills last.
export function compareInstalled({ root, state, claudeDir, S = {}, budgetMs = 0, fresh = false }) {
  const t0 = performance.now();
  // hashcache2: the hashes of the line ends made the same with the byte-order mark taken off (2026-11-20); the older
  // cache held hashes made the other way, so it is not read.
  const H = hasher(path.join(state, 'self-guard', 'hashcache2.json'), fresh);
  const differs = [];
  const pairs = installPairs(root, state, claudeDir, S);
  let pending = 0, readNew = 0;
  for (let i = 0; i < pairs.length; i++) {
    const p = pairs[i];
    const isNew = H.peek(p.src) === null || H.peek(p.dst) === null;
    if (isNew && budgetMs && readNew > 0 && performance.now() - t0 > budgetMs) { pending++; continue; }
    if (isNew) readNew++;
    const want = H.get(p.src), have = H.get(p.dst);
    if (have === null) { differs.push({ dst: p.dst, src: p.src, why: 'missing' }); continue; }
    if (want !== have) { differs.push({ dst: p.dst, src: p.src, why: 'differs from the notebook' }); continue; }
    // Here the installed copy equals the notebook's own (want === have): it is level, whatever an older install record
    // says (the ruling of 2026-11-20: a file equal to the notebook's is never counted as changed).
  }
  H.save();
  const fingerprint = sha(Buffer.from(differs.map((d) => `${slash(d.dst)}|${d.why}|${H.get(d.dst) || ''}`).join('\n')));
  return { differs, checked: pairs.length - pending, pending, fingerprint: differs.length ? fingerprint : '', ms: Math.round(performance.now() - t0) };
}

// ---------- the hooks the app's settings must carry ----------
export function sigOf(text) {
  const t = String(text);
  const m = t.match(/(start\.(?:ps1|mjs)|gates\.mjs|on-(?:edit|stop)\.mjs)/i);
  if (!m) return '';
  const part = (t.match(/-Part\s+(\w+)/i) || [])[1] || (t.split(/(?:start\.mjs|gates\.mjs)['"]?\s*/i)[1] || '').split(/\s/)[0];
  return `${m[1].toLowerCase()}${part ? ' ' + part.toLowerCase() : ''}`;
}
function snippetOf(root) {
  const node = fs.existsSync(path.join(root, 'core', 'start', 'settings-snippet.node.json')) && fs.existsSync(path.join(root, 'core', 'start', 'start.mjs'));
  return readJson(path.join(root, 'core', 'start', node ? 'settings-snippet.node.json' : 'settings-snippet.json'), null);
}
// An exact matcher is names joined by | or by commas (the hooks page, 2026-11-20); anything else is a pattern.
const plainTokens = (m) => String(m || '').split(/[|,]/).map((x) => x.trim()).filter((x) => /^[A-Za-z]\w*$/.test(x));
export function hooksMissing({ root, claudeDir, cwd }) {
  const out = [];
  const snip = snippetOf(root);
  const userFile = path.join(claudeDir, 'settings.json');
  const user = readJson(userFile, null);
  for (const f of [userFile, path.join(claudeDir, 'settings.local.json'), path.join(root, '.claude', 'settings.json'), path.join(root, '.claude', 'settings.local.json'),
    ...(cwd ? [path.join(cwd, '.claude', 'settings.json'), path.join(cwd, '.claude', 'settings.local.json')] : [])]) {
    const s = readJson(f, null);
    if (s && s.disableAllHooks === true) out.push({ event: 'all', why: `disableAllHooks is true in ${f}: every hook is off` });
  }
  if (!snip) { out.push({ event: 'all', why: "the notebook's list of hooks (core/start/settings-snippet) is missing or broken, so nothing can be compared" }); return out; }
  if (!user) { out.push({ event: 'all', why: `the app's settings ${userFile} are missing or not readable: no Hive Mind hook is in place` }); return out; }
  const have = (ev) => (user.hooks && Array.isArray(user.hooks[ev]) ? user.hooks[ev] : []);
  for (const [ev, list] of Object.entries(snip.hooks || {})) for (const e of list || []) for (const h of e.hooks || []) {
    const sig = sigOf([h.command, ...(h.args || [])].join(' '));
    if (!sig) continue;
    const found = have(ev).filter((x) => (x.hooks || []).some((y) => sigOf([y.command, ...(y.args || [])].join(' ')) === sig));
    if (!found.length) { out.push({ event: ev, why: `no ${ev} hook runs ${sig}` }); continue; }
    const want = plainTokens(e.matcher);
    if (!want.length) continue;
    const got = new Set(found.flatMap((x) => plainTokens(x.matcher)));
    const anyAll = found.some((x) => !x.matcher || x.matcher === '*');
    const lost = anyAll ? [] : want.filter((w) => !got.has(w));
    if (lost.length) out.push({ event: ev, why: `the ${ev} hook for ${sig} no longer covers ${lost.join(', ')}` });
  }
  return out;
}

// ---------- the switches, for "what was switched and by whom" ----------
export function switchSnapshot(P) {
  const snap = {};
  for (const f of ['gates-off', 'factory-off', 'publish-hold']) snap[`the ${f} file`] = fs.existsSync(path.join(P.state, f)) ? 'present' : 'absent';
  const walkModes = (o, at, label) => {
    if (!o || typeof o !== 'object' || Array.isArray(o)) return;
    for (const [k, v] of Object.entries(o)) {
      if (k.startsWith('_')) continue;
      if ((k === 'mode' || k === 'enabled') && (typeof v === 'string' || typeof v === 'boolean')) snap[`${label}: ${at ? at + '.' : ''}${k}`] = String(v);
      else walkModes(v, at ? `${at}.${k}` : k, label);
    }
  };
  walkModes(readJson(path.join(P.root, 'core', 'gates', 'settings.json'), null), '', "the gates' settings");
  const cdir = path.join(P.root, 'core', 'checks');
  let ids = []; try { ids = fs.readdirSync(cdir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch {}
  for (const id of ids) {
    const t = readText(path.join(cdir, id, 'check.mjs'));
    if (t !== null) { const m = moduleFacts(t); snap[`the check ${id}: kind`] = m.kind; snap[`the check ${id}: mode`] = m.mode; }
    else snap[`the check ${id}`] = 'no check.mjs';
    walkModes(readJson(path.join(cdir, id, 'settings.json'), null), '', `the check ${id}'s settings`);
  }
  for (const [name, f] of [["the app's settings", path.join(P.claudeDir, 'settings.json')], ["the notebook's project settings", path.join(P.root, '.claude', 'settings.json')], ["the notebook's local settings", path.join(P.root, '.claude', 'settings.local.json')]]) {
    const s = readJson(f, null);
    snap[`${name}: disableAllHooks`] = String(!!(s && s.disableAllHooks === true));
    if (name === "the app's settings") snap[`${name}: Hive Mind hooks`] = String(hookSigs(s).length);
  }
  return snap;
}
// The name a guarded place has in the snapshot above, so a change Claude made on the person’s word is matched to its switch.
export function groupOf(file, P) {
  const f = slash(path.resolve(String(file || '')));
  const rel = f.startsWith(slash(P.root) + '/') ? f.slice(slash(P.root).length + 1) : '';
  if (rel === 'core/gates/settings.json') return "the gates' settings";
  const m = rel.match(/^core\/checks\/([^/]+)\//); if (m) return `the check ${m[1]}`;
  if (f === slash(path.join(P.claudeDir, 'settings.json'))) return "the app's settings";
  if (rel === '.claude/settings.json') return "the notebook's project settings";
  if (rel === '.claude/settings.local.json') return "the notebook's local settings";
  const st = slash(P.state);
  if (f.startsWith(st + '/')) return `the ${f.slice(st.length + 1)} file`;
  return '';
}
export function switchChanges(before, after) {
  const out = [];
  for (const k of new Set([...Object.keys(before || {}), ...Object.keys(after || {})])) {
    const a = before ? before[k] : undefined, b = after[k];
    if (a !== b) out.push({ what: k, from: a === undefined ? 'not there' : a, to: b === undefined ? 'not there' : b });
  }
  return out;
}

// ---------- the canary: marks that prove the hooks fire ----------
// The canary was wrong, not the hook (2026-11-20: "the end-of-reply hook did not fire" was said several times while
// replies were being judged). The step at his message also fires for a helper's report, a task notice and another
// chat's message, and a message can arrive while a reply is still being written; one reply then spans several such
// steps and ends with ONE end-of-reply step. So: only his own message starts a new turn here (opts.own); when a tool
// ran after the last message and lately, his message may have come in the middle of a reply, and the missing end is
// judged one message later instead (it is said only if no end came at all since). And the before-a-tool step is
// missing only for a tool it has watched before in this chat (the after-tool step watches more tools, such as Read).
const BUSY_MS = 120000;
export function mark(P, sid, step, opts = {}) {
  const f = path.join(P.own, 'beat', `${String(sid || 'none').replace(/[^\w-]/g, '_').slice(0, 120)}.json`);
  const b = readJson(f, { turn: 0 });
  const g = path.join(P.own, 'canary.json');
  const now = new Date().toISOString();
  const ms = Date.now();
  if (step === 'prompt') {
    const issues = [];
    if (opts.own === false) { b.otherAt = ms; try { writeJson(f, b); } catch {} return { issues, turn: b.turn }; }
    const STOP = 'the end-of-reply hook did not fire after the last reply (unless the person stopped that reply), so the checks on replies did not run';
    if (b.suspect && b.suspect.turn < b.turn) { if (!((b.stopAt || 0) > b.suspect.at)) issues.push(STOP); b.suspect = null; }
    if (b.turn > 0) {
      if (b.stop !== b.turn && !issues.length) {
        const busy = (b.toolAt || 0) > (b.promptAt || 0) && ms - (b.toolAt || 0) < BUSY_MS;
        if (busy) b.suspect = { turn: b.turn, at: ms }; else issues.push(STOP);
      }
      const ever = new Set([...(b.preEver || []), ...(opts.preWatched || ['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Bash', 'PowerShell'])]), pre = new Set(b.preTurn || []);
      const missed = (b.postTurn || []).filter((t) => ever.has(t) && !pre.has(t));
      if (b.posttool === b.turn && missed.length) issues.push(`the before-a-tool hook did not fire on ${missed.slice(0, 3).join(', ')} in the last turn, though the after-tool hook did and the before-a-tool hook had watched ${missed.length === 1 ? 'that tool' : 'those tools'} before: the checks that stop a step were not running`);
    }
    b.turn += 1; b.prompt = b.turn; b.promptAt = ms; b.preTurn = []; b.postTurn = [];
    try { writeJson(f, b); } catch {}
    try { const c = readJson(g, {}); c.prompt = now; writeJson(g, c); } catch {}
    return { issues, turn: b.turn };
  }
  b[step] = b.turn;
  if (step === 'stop') b.stopAt = ms;
  if (step === 'pretool' || step === 'posttool') {
    b.toolAt = ms;
    const t = String(opts.tool || '');
    if (t) {
      const k = step === 'pretool' ? 'preTurn' : 'postTurn';
      b[k] = [...new Set([...(b[k] || []), t])].slice(-60);
      if (step === 'pretool') b.preEver = [...new Set([...(b.preEver || []), t])].slice(-200);
    }
  }
  try { writeJson(f, b); } catch {}
  try { const c = readJson(g, {}); if (String(c[step] || '').slice(0, 13) !== now.slice(0, 13)) { c[step] = now; writeJson(g, c); } } catch {} // once an hour is enough for "last fired"
  return { issues: [], turn: b.turn };
}

// ---------- the log, read back in plain words ----------
const OWED_RAISE = /^(debt|debt-open|debt-new|debt-carry)$/;
const OWED_CLEAR = /^debt-clear(ed)?$/;
const REPLY_FAULTS = new Set(['reply-carry', 'pref-missed', 'used-mismatch', 'done-no-proof', 'asked-again', 'saved-unsaid', 'model-unsaid', 'verdict-unreviewed', 'skills-unfit', 'stop-sendback']);
const isRefusal = (e) => /(^|-)deny$/.test(e) || e === 'deny';
const isSwitch = (e) => /^(self-guard-switch|self-guard-allowed|self-guard-ruled|switch)$/.test(e);
const isBreak = (e) => /^(error|timeout|self-guard-error|check-error|check-broken)$/.test(e);
export function readLog(state) {
  const out = [];
  for (const f of ['gates.log.1', 'gates.log', 'checks.log.1', 'checks.log']) {
    const t = readText(path.join(state, f));
    if (!t) continue;
    for (const l of t.split('\n')) { if (!l.trim()) continue; try { const o = JSON.parse(l); if (o && typeof o === 'object' && o.event) out.push(o); } catch {} }
  }
  return out.sort((a, b) => String(a.t).localeCompare(String(b.t)));
}
const short = (s, n = 90) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
function whoStopped(l) {
  if (l.check || l.id || l.gate) return `the ${l.check || l.id || l.gate} check`;
  const m = String(l.event).match(/^(.+)-deny$/);
  return m ? `the ${m[1]} check` : 'a check';
}
function whatOf(l) { return short(l.what || l.target || l.tool || l.reason || l.text || ''); }
function owedNow(lines) {
  const open = new Map();
  for (const l of lines) {
    if (OWED_RAISE.test(l.event)) open.set(l.key || `${l.t}-${open.size}`, l);
    else if (OWED_CLEAR.test(l.event)) { for (const k of [].concat(l.key || l.keys || [])) open.delete(k); }
  }
  return [...open.values()];
}
function dayName(d) {
  try { return new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }); } catch { return d; }
}
export function plainLog(lines, { since } = {}) {
  const shown = since ? lines.filter((l) => String(l.t) >= since) : lines;
  const days = new Map();
  for (const l of shown) { const d = String(l.t || '').slice(0, 10) || 'no date'; if (!days.has(d)) days.set(d, []); days.get(d).push(l); }
  const out = [];
  for (const [d, ls] of days) {
    const part = [];
    const den = ls.filter((l) => isRefusal(l.event));
    if (den.length) {
      const by = new Map();
      for (const l of den) { const w = whoStopped(l); if (!by.has(w)) by.set(w, []); by.get(w).push(whatOf(l)); }
      part.push(`- ${den.length === 1 ? '1 step was stopped' : `${den.length} steps were stopped`}: ` + [...by].map(([w, xs]) => `${w} (${xs.length}${xs[0] ? `, for example: ${xs[0]}` : ''})`).join('; ') + '.');
    }
    const raised = ls.filter((l) => OWED_RAISE.test(l.event));
    const cleared = ls.filter((l) => OWED_CLEAR.test(l.event));
    if (raised.length) part.push(`- ${raised.length === 1 ? '1 fault in a reply became a debt' : `${raised.length} faults in replies became debts`}; ${plural(cleared.length, 'debt was', 'debts were')} cleared by a later reply.`);
    const notes = ls.filter((l) => REPLY_FAULTS.has(l.event));
    if (notes.length) part.push(`- ${plural(notes.length, 'fault in a reply was', 'faults in replies were')} noted and handed back to Claude.`);
    for (const l of ls.filter((x) => isSwitch(x.event))) {
      if (l.event === 'self-guard-switch') part.push(`- A switch changed: ${l.what} went from ${l.from} to ${l.to}, by ${l.who}.`);
      else if (l.event === 'self-guard-allowed') part.push(`- Claude changed ${l.what}, on the person’s word: "${short(l.words, 70)}".`);
      else if (l.event === 'self-guard-ruled') part.push(`- The person ruled on installed copies that differed from the notebook: ${short(l.ruling || 'accepted as they are')}.`);
      else part.push(`- A switch changed: ${whatOf(l)}.`);
    }
    const br = ls.filter((l) => isBreak(l.event));
    if (br.length) part.push(`- ${br.length === 1 ? 'Once a check broke' : `${br.length} times a check broke`} (it then let the step through, or stopped it if it was a safety check): ${short(br[0].error || br[0].what || br[0].event, 80)}.`);
    if (part.length) { out.push(`${dayName(d)}:`); out.push(...part); }
  }
  if (!out.length) out.push('Nothing was stopped, owed, switched or broken in this period.');
  const owed = owedNow(lines);
  out.push('');
  out.push(owed.length ? `Still owed now (${owed.length}): ` + owed.map((l) => short(l.text || l.key, 70)).join('; ') + '. The next reply must clear these; until one does, every step but reading is refused.' : 'Still owed now: nothing.');
  return out;
}
export function dailyCount(state, day) {
  const lines = readLog(state).filter((l) => String(l.t).startsWith(day));
  const den = lines.filter((l) => isRefusal(l.event)).length;
  const cleared = new Set(lines.filter((l) => OWED_CLEAR.test(l.event)).flatMap((l) => [].concat(l.key || l.keys || [])));
  const owed = lines.filter((l) => OWED_RAISE.test(l.event) && !cleared.has(l.key)).length;
  const sw = lines.filter((l) => isSwitch(l.event)).length;
  const br = lines.filter((l) => isBreak(l.event)).length;
  const c = readJson(path.join(state, 'self-guard', 'canary.json'), {});
  const hooks = ['prompt', 'pretool', 'posttool', 'stop'];
  const fired = hooks.filter((h) => String(c[h] || '').startsWith(day));
  const canary = fired.length === hooks.length ? 'every hook fired that day' : fired.length ? `hooks that did not fire that day: ${hooks.filter((h) => !fired.includes(h)).join(', ')}` : 'no hook left a mark that day';
  const st = readJson(path.join(state, 'self-guard', 'status.json'), null);
  const inst = !st ? 'installed copies not compared yet' : st.differs && st.differs.length ? `${plural(st.differs.length, 'installed copy differs', 'installed copies differ')} from the notebook` : 'installed copies match the notebook';
  return `On ${day}: ${plural(den, 'step stopped', 'steps stopped')}, ${plural(owed, 'fault owed', 'faults owed')}, ${plural(sw, 'switch', 'switches')}, ${plural(br, 'break', 'breaks')}; ${canary}; ${inst}.`;
}
export { readJson, writeJson };
