// What of a reply the reply checks judge (2026-11-20: they contradicted each other and the display they demand).
// Never judged as a claim, a number or an inside word:
//   - the progress display (core/engine/progress.mjs show): a fixed-width block that holds a bar goes whole; an unfenced
//     bar goes with its name line above it; the "<n> of <m> steps" head line goes with it;
//   - the names of the things he asked for, from the progress list (his own words: "Ready for a new person" is a name,
//     not a claim of "ready"; "The Agent Architects repository" is his name for it);
//   - a quoted phrase he is asked to type, in a sentence that asks him to say, type or answer it ("say 'reinstall the
//     gates'").
// The word limit of a report counts what is left after the display, the one line per thing he asked for, and his open
// questions put word for word under "Needs you:". The gates (core/gates/gates.mjs: withoutDisplay, judgedText,
// explainedAt) hold the same reading; core/checks/_lib/test/sitreps.test.mjs runs every reply check together.
import fs from 'node:fs';
import path from 'node:path';

const BAR = /[█░]{10,}\s+\d{1,3}%/;
const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function withoutDisplay(text) {
  const t = String(text || '').replace(/\r/g, '').replace(/```[^\n]*\n([\s\S]*?)```/g, (m, body) => (body.split('\n').some((l) => BAR.test(l)) ? '' : m));
  const out = [];
  for (const l of t.split('\n')) {
    if (!BAR.test(l)) { out.push(l); continue; }
    const prev = out[out.length - 1];
    if (prev !== undefined && prev.trim() && prev.length <= 80 && !BAR.test(prev) && !/[.!?]\s*$/.test(prev)) out.pop();
    const head = out[out.length - 1];
    if (head !== undefined && /\b\d+ of \d+ steps\s*$/.test(head)) out.pop();
  }
  return out.join('\n');
}

// The names of what he asked for: the progress list's work and items (read through ctx.read when given).
export function requestNames(ctx) {
  let raw = '';
  try { raw = ctx && typeof ctx.read === 'function' ? String(ctx.read('system/progress.json') || '') : ''; } catch {}
  if (!raw && ctx && ctx.root) { try { raw = fs.readFileSync(path.join(ctx.root, 'system', 'progress.json'), 'utf8'); } catch {} }
  try {
    const j = JSON.parse(raw);
    return [j.work, ...(Array.isArray(j.items) ? j.items.map((i) => i && i.name) : [])].map((x) => String(x || '').trim()).filter((x) => x.length >= 3);
  } catch { return []; }
}
export function withoutNames(text, names) {
  let t = String(text || '');
  for (const n of [...(names || [])].sort((a, b) => b.length - a.length)) t = t.replace(new RegExp('(^|[^\\p{L}\\p{N}])' + esc(n) + '(?=$|[^\\p{L}\\p{N}])', 'giu'), '$1it');
  return t;
}
const TYPE_VERBS = /\b(say|says|said|type|types|typed|write|writes|answer|answers|reply|replies|tap|taps|tell me|send|sends|choose|pick)\b/i;
export function withoutTyped(text) {
  return String(text || '').split(/(?<=[.!?])\s+|\n/).map((s) => (TYPE_VERBS.test(s) ? s.replace(/"[^"\n]{1,80}"|“[^”\n]{1,80}”|(?<=^|[\s(])'[^'\n]{1,80}'(?=$|[\s.,;:!?)])|‘[^’\n]{1,80}’/g, 'it') : s)).join('\n');
}
// The reply as the checks judge its claims, numbers and words.
export function judgedText(text, names) { return withoutTyped(withoutNames(withoutDisplay(text), names)); }

// Is the word that ends at `end` (and starts at `start`) of the lower-case text explained in its own sentence?
// Right after it (one of marks), or later in the same sentence after a comma, a dash, a colon, "which is", "that is",
// "means", "in other words" (and the like) with at least three words of meaning; or the word stands in brackets after
// at least three words that say what it is.
const EXPLAIN_LATER = /^[^.!?\n]{0,40}?(\(|\s[—–-]\s|:\s|,\s+(a|an|the|which|that is|meaning|i\.e\.|in other words|or)\b|\s(means|meaning|which is|which are|that is|i\.e\.|is what|stands for|is a|is an|is the|are the|in other words|or in plain words|that is to say|so called|called)\b)/;
export function explainedAt(low, end, start, marks) {
  const after = low.slice(end, end + 12);
  if ((marks || []).some((k) => after.startsWith(k))) return true;
  const stop = low.slice(end).search(/[.!?\n]/);
  const rest = low.slice(end, stop < 0 ? undefined : end + stop);
  const m = rest.match(EXPLAIN_LATER);
  if (m && (rest.slice(m.index + m[0].length).match(/[\p{L}\p{N}]+/gu) || []).length >= 3) return true;
  const sStart = Math.max(low.lastIndexOf('.', start - 1), low.lastIndexOf('\n', start - 1), low.lastIndexOf('?', start - 1), low.lastIndexOf('!', start - 1)) + 1;
  const before = low.slice(sStart, start);
  return /\(\s*(the\s+|a\s+|an\s+)?$/.test(before) && (before.match(/[\p{L}\p{N}]+/gu) || []).length >= 3;
}

// The open questions of the questions list (system/questions.json): put word for word under "Needs you:", they are his
// list, not words of the reply.
export function openQuestions(ctx) {
  let raw = '';
  try { raw = ctx && typeof ctx.read === 'function' ? String(ctx.read('system/questions.json') || '') : ''; } catch {}
  try { const d = JSON.parse(raw); return (d.questions || []).filter((q) => q && q.state === 'open').map((q) => String(q.text || '')).filter(Boolean); } catch { return []; }
}
// A sitrep's "<thing>: <state>" line, and its "Needs you:" line.
export const isStateLine = (l, stateWords) => new RegExp('^[^:\\n]{2,90}:\\s*(' + (stateWords || []).map(esc).join('|') + ')\\b', 'i').test(String(l).replace(/^[-*•>\s]+/, '').replace(/\*\*/g, ''));
export const isNeedsLine = (l) => /^\s*[-*•>]*\s*\**\s*needs you\s*\**\s*:/i.test(String(l));
// The text whose words count against the limit: the display, the lines for each thing, and the open questions quoted
// under "Needs you:" taken out.
export function limitedText(text, { stateWords, questions } = {}) {
  let t = withoutDisplay(text);
  const lines = t.split('\n').filter((l) => !isStateLine(l, stateWords || DEFAULT_STATES));
  t = lines.join('\n');
  for (const q of questions || []) if (q) t = t.split(q).join(' ');
  return t;
}
// A sitrep (a "Needs you:" line and at least one "<thing>: <state>" line) without its headline and its state lines:
// they read the states from the progress list, so they claim nothing new. Anything else is returned as it was.
export function sitrepClaimsText(text, stateWords) {
  const ls = String(text || '').split('\n');
  const st = (l) => isStateLine(l, stateWords || DEFAULT_STATES);
  const ni = ls.findIndex(isNeedsLine);
  const first = ls.findIndex(st);
  if (ni < 0 || first < 0 || first > ni) return String(text || '');
  let head = first - 1; while (head >= 0 && !ls[head].trim()) head--;
  return ls.filter((l, i) => !(i < ni && (st(l) || i === head))).join('\n');
}
export const DEFAULT_STATES = ['done', 'chosen', 'ready', 'being worked on', 'in work', 'not started', 'stuck', 'not checked', 'waiting on you', 'finished'];
