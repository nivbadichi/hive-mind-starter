// The proof check (rule 5: small steps, with proof; never invent a fact, a number or a result).
//
// Three behaviours:
//   1. stop: a reply that says "done", "works", "passes", "fixed", "ready", "live" (and the like) with no test or
//      check that passed in that turn, after the last change to a code file -> a debt.
//   2. stop: a number in a reply that no command of the turn printed, that the person's own message does not hold, and that no
//      note read in the turn (or listed in settings.numbers.notes) holds -> a debt ("never invent").
//   3. pretool: a real publish (a deploy command, a publish script, a deploy tool) run "as a test" while the person's latest own
//      message did not ask to publish -> refused.
// A debt stays open until a reply puts it right: it says plainly what was not checked or not counted, or a check
// passed in that turn. A reply that only stays quiet about it carries the debt again.
//
// The contract is system/design/enforcement-2026-11-20.md. It needs one part of core/checks/_lib: reply-parts.mjs,
// the one reading of what of a reply is judged (shared by every reply check since 2026-11-20). It keeps its own small record of the turn (checks, their outcome, code files written, numbers the
// tools printed) under <ctx.state>/proof/, written by its posttool step and reset by its prompt step; when that record
// is empty it falls back to ctx.events.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withoutDisplay, withoutNames, withoutTyped, requestNames, sitrepClaimsText } from '../_lib/reply-parts.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
let OWN = null;
function ownSettings() {
  if (!OWN) { try { OWN = JSON.parse(fs.readFileSync(path.join(HERE, 'settings.json'), 'utf8')); } catch { OWN = {}; } }
  return OWN;
}
function settingsOf(ctx) {
  const s = ctx && ctx.settings;
  return s && typeof s === 'object' && Object.keys(s).length ? s : ownSettings();
}
const esc = (w) => String(w).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const reCache = new Map();
function wordsRe(words) {
  const key = (words || []).join('\u0001');
  let re = reCache.get(key);
  if (!re) {
    const alts = (words || []).map((w) => esc(String(w).toLowerCase())).sort((a, b) => b.length - a.length).join('|') || '(?!)';
    re = new RegExp(`(^|[^a-z0-9'])(${alts})(?=$|[^a-z0-9])`, 'i');
    reCache.set(key, re);
  }
  return re;
}
const hasAny = (text, words) => wordsRe(words).test(' ' + String(text || '').toLowerCase() + ' ');
const log = (ctx, event, detail) => { try { if (ctx && typeof ctx.log === 'function') ctx.log(event, detail); } catch {} };
const toolOf = (ev) => String(ev.tool || ev.tool_name || '');
const inputOf = (ev) => ev.input || ev.tool_input || {};
const isShell = (tool) => tool === 'Bash' || tool === 'PowerShell';
const WRITE_TOOLS = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit'];
// A tool that failed reaches the after-tool step as PostToolUseFailure: no tool_response, its text in `error`.
const failedTool = (ev) => ev.hook_event_name === 'PostToolUseFailure' || (ev.tool_response == null && ev.error != null);
const commandOf = (ev) => String(ev.command != null ? ev.command : (inputOf(ev).command || ''));
const replyOf = (ev) => String(ev.text != null ? ev.text : (ev.last_assistant_message || ''));

// ---------- the turn's own record ----------
const safe = (s, n) => String(s || '').replace(/[^\w.-]/g, '_').slice(0, n);
function recFile(ctx, ev, agent) { return path.join(ctx.state, 'proof', `${safe(ev.session_id || 'nosession', 80)}.${safe(agent || 'main', 60)}.jsonl`); }
function debtFile(ctx, ev) { return path.join(ctx.state, 'proof', `${safe(ev.session_id || 'nosession', 80)}.debt.json`); }
function readRecs(file) {
  let raw = '';
  try { raw = fs.readFileSync(file, 'utf8'); } catch { return []; }
  const out = [];
  for (const l of raw.split('\n')) { if (!l) continue; try { out.push(JSON.parse(l)); } catch {} }
  return out;
}
function appendRecs(file, recs) {
  if (!recs.length) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, recs.map((r) => JSON.stringify(r)).join('\n') + '\n');
}

// ---------- commands that check ----------
function segments(cmd) { return String(cmd).split(/&&|\|\||[;|\n]/).map((s) => s.trim()).filter(Boolean); }
function firstWord(seg) {
  const w = seg.replace(/^[&.]\s+/, '').replace(/^["'(]+/, '').split(/\s+/)[0] || '';
  return w.toLowerCase().replace(/^.*[\\/]/, '').replace(/\.(exe|cmd)$/, '');
}
// Inline program code (node -e "console.log('test ok')", python -c ...) names a check and runs none (the second roast,
// N54): it is never proof. Only a program that really runs checks counts.
const INLINE = /^(node|deno|bun|python3?|py|ruby|perl|php|bash|sh|zsh)$/;
function inlineCode(seg) { const w = seg.split(/\s+/); return INLINE.test(firstWord(seg)) && w.slice(1).some((a) => /^(-e|--eval|-p|--print|-c)$/i.test(a)); }
export function isCheckCommand(cmd, S) {
  const read = new Set((S.checks.readCommands || []).map((x) => x.toLowerCase()));
  return segments(cmd).some((seg) => !read.has(firstWord(seg)) && !inlineCode(seg) && hasAny(seg, S.checks.words));
}
// 'pass', 'fail' or 'empty' (a check that ran no test at all is no proof).
export function outcome(resp, S) {
  if (resp && typeof resp === 'object') {
    if (resp.interrupted) return 'fail';
    for (const k of ['exitCode', 'exit_code', 'returnCode', 'code', 'status']) if (typeof resp[k] === 'number' && resp[k] !== 0) return 'fail';
  }
  const text = resp == null ? '' : typeof resp === 'string' ? resp
    : (typeof resp.stdout === 'string' || typeof resp.stderr === 'string') ? `${resp.stdout || ''}\n${resp.stderr || ''}` : JSON.stringify(resp);
  const tail = text.slice(-8000);
  // Case matters here: node's runner prints "# fail 0" on a pass, and "FAIL" or "# fail 2" on a failure.
  if ((S.checks.failMarkers || []).some((p) => new RegExp(p).test(tail))) return 'fail';
  if ((S.checks.emptyMarkers || []).some((p) => new RegExp(p, 'i').test(tail))) return 'empty';
  return 'pass';
}

// ---------- numbers ----------
const NUM_ANY = /\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g;
const PAIR = /(\d[\d,]*)\s*(?:of|out of|\/)\s*(\d[\d,]*)/gi;
const val = (s) => Number(String(s).replace(/,/g, ''));
function numbersSeen(text, cap) {
  const out = new Set();
  for (const m of String(text).matchAll(NUM_ANY)) { out.add(val(m[0])); if (out.size >= cap) break; }
  return out;
}
function pairsSeen(text, cap) {
  const out = [];
  for (const m of String(text).matchAll(PAIR)) { const a = val(m[1]), b = val(m[2]); if (b > 0) out.push([a, b]); if (out.length >= cap) break; }
  return out;
}
function clip(text, max) { const t = String(text); return t.length <= max ? t : t.slice(0, max / 2) + '\n' + t.slice(-max / 2); }
// The numbers in a reply that claim something: every percentage, and every plain number from minPlain up.
// Dates, times, versions, list markers, paths, addresses, "rule 5", "E4", years and units glued to a number are left out.
export function replyNumbers(text, S) {
  const N = S.numbers;
  let t = ' ' + String(text) + ' ';
  t = t.replace(/https?:\/\/\S+/g, ' ')
    .replace(/\S*[A-Za-z]\S*[\\/]\S*|\S*[\\/]\S*[A-Za-z]\S*/g, ' ')
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, ' ')
    .replace(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g, ' ')
    .replace(/\bv?\d+\.\d+\.\d+\b/gi, ' ')
    .replace(/^\s*\d+[.)]\s/gm, ' ');
  const pre = (N.prefixWords || []).map((w) => esc(w)).join('|');
  if (pre) t = t.replace(new RegExp(`(^|[^a-z])(?:${pre})\\s*#?\\s*\\d+(?:\\s*(?:and|,|-|to)\\s*\\d+)*`, 'gim'), '$1 ');
  const found = [];
  const re = /(?<![\w.,:\/#-])(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?(\s*(?:%|percent\b))?(?![\w])/gi;
  for (const m of t.matchAll(re)) {
    const v = val(m[1] + (m[2] || ''));
    const pct = !!m[3];
    if (!pct && v < (N.minPlain || 0)) continue;
    if (!pct && !m[2] && v >= 1900 && v <= 2100) continue;
    const before = t.slice(Math.max(0, m.index - 24), m.index).toLowerCase();
    const approx = /~\s*$/.test(before) || hasAny(before.split(/\s+/).slice(-3).join(' '), N.approxWords);
    found.push({ v, pct, approx, raw: m[0].trim() });
  }
  return { found, pairs: pairsSeen(t, 200) };
}

// ---------- claims ----------
function sentences(text) {
  return String(text)
    .replace(/"[^"\n]{0,120}"|“[^”\n]{0,120}”|`[^`\n]*`/g, ' ')
    .split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
}
export function findClaims(text, S) {
  const C = S.claims;
  const out = [];
  const re = new RegExp(wordsRe(C.phrases).source, 'gi');
  for (const s of sentences(text)) {
    if (/\?\s*$/.test(s) || hasAny(s, C.honestMarks)) continue;
    const low = ' ' + s.toLowerCase() + ' ';
    for (const m of low.matchAll(re)) {
      const at = m.index + m[1].length;
      const before = low.slice(0, at).trim().split(/\s+/).slice(-4).join(' ');
      if (hasAny(before, C.negators)) continue;
      out.push({ phrase: m[2], sentence: s.slice(0, 100) });
      break;
    }
  }
  return out;
}

// The turn's events, in order: the check's own record, else ctx.events.
function turnEvents(ctx, ev, S) {
  const own = readRecs(recFile(ctx, ev, ''));
  const events = Array.isArray(ctx.events) ? ctx.events : [];
  const acts = own.filter((r) => r.k === 'check' || r.k === 'write');
  if (acts.length) return { recs: own, events };
  const norm = [];
  for (const e of events) {
    if (!e || typeof e !== 'object') continue;
    const k = e.k || e.type || e.kind;
    if (k === 'check') norm.push({ k: 'check', st: e.st || (e.ok === false ? 'fail' : 'pass') });
    else if (k === 'write' || (!k && (e.file || e.p)) || (WRITE_TOOLS.includes(e.tool) && (e.path || e.file))) norm.push({ k: 'write', p: e.p || e.file || e.path || '' });
    else if ((e.command || e.cmd) && isCheckCommand(e.command || e.cmd, S)) {
      const code = [e.exitCode, e.exit, e.code].find((x) => typeof x === 'number');
      norm.push({ k: 'check', st: e.ok === false || (code != null && code !== 0) ? 'fail' : 'pass' });
    }
  }
  return { recs: own.concat(norm), events };
}
function proofState(recs, S) {
  const notes = new Set((S.claims.noteExtensions || []).map((x) => x.toLowerCase()));
  let lastWrite = -1, lastPass = -1, lastFail = -1, ranAny = false;
  recs.forEach((r, i) => {
    if (r.k === 'write' && !notes.has(path.extname(String(r.p || '')).toLowerCase())) lastWrite = i;
    if (r.k === 'check') { ranAny = true; if (r.st === 'pass') lastPass = i; else if (r.st === 'fail') lastFail = i; }
  });
  return { proven: lastPass > lastWrite && lastPass >= 0, stale: lastPass >= 0 && lastPass < lastWrite, failedLast: lastFail > lastPass, ranAny };
}
function sources(ctx, recs, events, S) {
  const N = S.numbers;
  const nums = new Set(), pairs = [];
  for (const r of recs) if (r.k === 'seen') { for (const n of r.n || []) nums.add(n); for (const p of r.pr || []) pairs.push(p); }
  const extra = [String(ctx.hisLast || ''), JSON.stringify(events).slice(0, N.maxScan || 200000)];
  for (const rel of N.notes || []) {
    let t = '';
    try { t = typeof ctx.read === 'function' ? String(ctx.read(rel) || '') : ''; } catch {}
    if (!t && ctx.root) { try { t = fs.readFileSync(path.join(ctx.root, rel), 'utf8'); } catch {} }
    if (t) extra.push(clip(t, N.maxScan || 200000));
  }
  for (const t of extra) { for (const n of numbersSeen(t, N.maxRecorded || 5000)) nums.add(n); pairs.push(...pairsSeen(t, 500)); }
  return { nums, pairs };
}
function inventedNumbers(text, ctx, recs, events, S) {
  const { found, pairs: replyPairs } = replyNumbers(text, S);
  if (!found.length) return [];
  const { nums, pairs } = sources(ctx, recs, events, S);
  const pcts = new Set();
  const addPct = ([a, b]) => { if (b > 0) { pcts.add(Math.floor((a / b) * 100)); pcts.add(Math.round((a / b) * 100)); } };
  pairs.forEach(addPct);
  replyPairs.filter(([a, b]) => nums.has(a) && nums.has(b)).forEach(addPct);
  const tol = S.numbers.approxTolerance || 0;
  const list = [...nums];
  const held = (x) => nums.has(x.v) || (x.pct && pcts.has(x.v)) ||
    (x.approx && list.some((n) => n !== 0 && Math.abs(n - x.v) / Math.abs(n) <= tol)) ||
    (x.approx && x.pct && [...pcts].some((n) => n !== 0 && Math.abs(n - x.v) / n <= tol));
  const bad = [];
  for (const x of found) if (!held(x) && !bad.includes(x.raw)) bad.push(x.raw);
  return bad;
}

function readDebt(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } }
function writeDebt(file, d) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(d)); }
function asked(ctx, pattern) {
  const re = new RegExp(pattern, 'i');
  try { if (typeof ctx.said === 'function' && ctx.said(re)) return true; } catch {}
  return re.test(String(ctx.hisLast || ''));
}

// ---------- publishing ----------
// What is named in a refusal and in the log: a token or a long key-like string is masked, never written out.
const mask = (s) => String(s).replace(/(--?(?:token|key|secret)[=\s]+)\S+/gi, '$1***').replace(/\b[A-Za-z0-9_\-]{24,}\b/g, '***');
export function publishWhat(tool, input, cmd, P) {
  return mask(publishRaw(tool, input, cmd, P));
}
function publishRaw(tool, input, cmd, P) {
  if (tool.startsWith('mcp__')) { const short = tool.split('__').pop(); return (P.tools || []).includes(short) ? short : ''; }
  if (!isShell(tool)) return '';
  const vre = /(^|[\s;&|("'`])(?:npx\s+|pnpm\s+dlx\s+|bunx\s+)?vercel(?:\.cmd|\.exe)?(?=$|[\s"'`;&|)])([^;&|\n]*)/gi;
  for (const m of cmd.matchAll(vre)) {
    const args = m[2].trim().split(/\s+/).filter(Boolean);
    if (args.some((a) => ['--version', '-v', '--help', '-h'].includes(a))) continue;
    const sub = args.find((a) => !a.startsWith('-'));
    if (sub && (P.vercelQuiet || []).includes(sub.toLowerCase().replace(/["'`)]+$/, ''))) continue;
    return ('vercel ' + args.join(' ')).trim().slice(0, 80);
  }
  for (const p of P.patterns || []) { const m = cmd.match(new RegExp(p, 'i')); if (m) return m[0].trim().slice(0, 80); }
  return '';
}

function deny(what, who) {
  return `I stopped this step. It would really put something online (${what}), and it is being run as a test, while ${who}'s latest message did not ask to publish. ` +
    `A real publish is never a test (rules 1 and 5). The one thing to do: test it on a copy that cannot reach the live site, or with the tool's dry-run option, or ask ${who} in one plain sentence first.`;
}

export default {
  id: 'proof',
  rule: 'rule 5',
  kind: 'discipline',
  mode: 'refuse',
  about: 'A reply may say done, works or ready only after a check passed in that turn, gives only numbers that something really printed or holds, and a real publish is never run as a test.',
  steps: {
    // A new turn starts at the person's message: the turn's record starts empty.
    prompt(ev, ctx) {
      try { fs.rmSync(recFile(ctx, ev, ''), { force: true }); } catch (e) { log(ctx, 'error', { where: 'proof.prompt', error: String(e && e.message || e).slice(0, 200) }); }
      return null;
    },

    // Writes down what the turn really did: code files changed, checks run with their outcome, numbers the tools printed.
    posttool(ev, ctx) {
      try {
        const S = settingsOf(ctx);
        const tool = toolOf(ev), input = inputOf(ev);
        const recs = [];
        const failed = failedTool(ev);
        if (WRITE_TOOLS.includes(tool)) recs.push({ k: 'write', p: String(input.file_path || input.notebook_path || '') });
        if (isShell(tool)) {
          const cmd = commandOf(ev);
          if (isCheckCommand(cmd, S)) recs.push({ k: 'check', st: failed ? 'fail' : outcome(ev.tool_response, S), cmd: cmd.slice(0, 120) });
        }
        const resp = ev.tool_response != null ? ev.tool_response : (failed ? ev.error : null);
        if (resp != null) {
          const text = clip(typeof resp === 'string' ? resp : JSON.stringify(resp), S.numbers.maxScan || 200000);
          const n = [...numbersSeen(text, 2000)], pr = pairsSeen(text, 300);
          if (n.length || pr.length) recs.push({ k: 'seen', n, pr });
        }
        appendRecs(recFile(ctx, ev, ev.agent_id || ''), recs);
      } catch (e) { log(ctx, 'error', { where: 'proof.posttool', error: String(e && e.message || e).slice(0, 200) }); }
      return null;
    },

    // A real publish run as a test is refused. When the check itself breaks on a step that looks like a publish, it
    // refuses that one step (safer); on any other step it lets the step through and logs the break.
    pretool(ev, ctx) {
      const tool = toolOf(ev);
      let raw = '';
      try {
        raw = isShell(tool) ? commandOf(ev) : '';
        const S = settingsOf(ctx), P = S.publish;
        const input = inputOf(ev);
        const what = publishWhat(tool, input, raw, P);
        if (!what) return null;
        if ((P.dryRunFlags || []).some((f) => new RegExp(`(^|\\s)${esc(f)}(?=$|[\\s=])`, 'i').test(raw))) return null;
        const words = `${input.description || ''} ${raw} ${tool.startsWith('mcp__') ? JSON.stringify(input) : ''}`;
        if (!hasAny(words, P.testWords)) return null;
        if (asked(ctx, P.askPattern)) return null;
        log(ctx, 'proof-deny', { what });
        return { deny: deny(what, S.who || 'the person') };
      } catch (e) {
        log(ctx, 'error', { where: 'proof.pretool', error: String(e && e.message || e).slice(0, 200) });
        if (/vercel|publish|deploy|release|netlify|wrangler|firebase/i.test(raw + ' ' + tool)) {
          return { deny: 'I stopped this step to be safe: it looks like it puts something online, and the proof check broke while reading it. The one thing to do: ask in one plain sentence whether to publish now; the break is in the log.' };
        }
        return null;
      }
    },

    // The reply: "done" without proof, and numbers with no source, become a debt; a reply that puts it right clears it.
    stop(ev, ctx) {
      try {
        const S = settingsOf(ctx);
        const who = S.who || 'the person';
        // The progress display it demands, the names of what he asked for and a phrase he is asked to type are never
        // judged as claims or numbers (2026-11-20, seen live: the display was flagged as an unproven "done").
        // In a sitrep the headline and the "<thing>: <state>" lines read the states from the progress list; they are not
        // new claims of finished work (the gates read it the same way). Its other sentences are judged as ever.
        const text = withoutTyped(sitrepClaimsText(withoutNames(withoutDisplay(replyOf(ev)), requestNames(ctx))));
        const { recs, events } = turnEvents(ctx, ev, S);
        const ps = proofState(recs, S);
        const faults = [], kinds = [];
        const claims = findClaims(text, S);
        if (claims.length && !ps.proven) {
          const c = claims[0];
          const why = ps.stale ? 'a check passed, but code was changed after it, and nothing passed since'
            : ps.ranAny ? 'a check ran, but none passed' : 'no test or check ran';
          faults.push(`Your last reply said "${c.phrase}" ("${c.sentence}"), but in that turn ${why}. Rule 5: never say done without proof. In your next reply, run the check and say what it showed, or tell ${who} plainly that it was not checked.`);
          kinds.push('claim');
        } else if (claims.length && ps.failedLast && !/\bfail/i.test(text)) {
          faults.push(`Your last reply said "${claims[0].phrase}", but the last check of that turn failed and the reply does not say so. In your next reply, tell ${who} what failed.`);
          kinds.push('claim');
        }
        const bad = inventedNumbers(text, ctx, recs, events, S);
        if (bad.length) {
          const them = bad.length === 1 ? 'it' : 'them';
          faults.push(`Your last reply gave ${bad.length === 1 ? 'the number' : 'the numbers'} ${bad.slice(0, 6).join(', ')}, but no command of that turn printed ${them}, ${who}'s message does not hold ${them}, and no note read holds ${them}. Rule 5: never invent a number. In your next reply, say where ${them} came from, or tell ${who} plainly that ${bad.length === 1 ? 'it was' : 'they were'} not counted.`);
          kinds.push('number');
        }
        const dfile = debtFile(ctx, ev);
        const open = readDebt(dfile);
        if (faults.length) {
          writeDebt(dfile, { kinds, text: faults.join(' ') });
          log(ctx, 'proof-debt', { kinds: kinds.join(','), numbers: bad.length });
          return { debt: { key: 'proof', text: faults.join(' ') } };
        }
        if (open) {
          const fixed = hasAny(text, S.claims.honestMarks) || ((open.kinds || []).every((k) => k === 'claim') && ps.proven);
          if (!fixed) {
            log(ctx, 'proof-debt', { carried: true });
            return { debt: { key: 'proof', text: `Not put right yet: ${open.text}` } };
          }
          try { fs.rmSync(dfile, { force: true }); } catch {}
          log(ctx, 'proof-clear', {});
        }
        return { clear: ['proof'] };
      } catch (e) {
        log(ctx, 'error', { where: 'proof.stop', error: String(e && e.message || e).slice(0, 200) });
        return null;
      }
    },
  },
};
