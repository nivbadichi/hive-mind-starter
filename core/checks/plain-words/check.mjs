// Plain words (rule 6). At the end of every reply to the person, five things are measured: length, whole sentences,
// reading ease, file names and code, and inside words without their meaning. Each fault is part of one debt
// (key "plain-words"); a clean reply clears it. A reply cannot be un-sent, so this check never holds one back.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { withoutNames, withoutTyped, limitedText, explainedAt, requestNames, openQuestions } from '../_lib/reply-parts.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const KEY = 'plain-words';
let DEFAULTS = {};
try { DEFAULTS = JSON.parse(fs.readFileSync(path.join(HERE, 'settings.json'), 'utf8')); } catch { DEFAULTS = {}; }

const low = (s) => String(s || '').toLowerCase();
const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const hasAny = (text, words) => { const t = low(text); return (words || []).some((w) => t.includes(low(w))); };
const section = (S, name) => ({ ...(DEFAULTS[name] || {}), ...((S && S[name]) || {}) });

// ---------- what of the reply is prose ----------
// Left out: the progress display (bar lines made by core/engine/progress.mjs, the name line above each, the
// "n of m steps" head line, and the older "[ A ✓ ] ► [ B ]" row), the Saved: and Used: lines, and web addresses.
const BAR = /[█░]{4,}/;
const OLD_MAP = /\[[^\]]*[✓✔][^\]]*\].*(►|→|>)|►\s*\[/;
const OWN_LINE = /^\s*[*_>\-]*\s*(saved|used|skills used|what was used)\s*[*_]*\s*:/i;
export function proseOf(text) {
  let t = String(text || '').replace(/\r/g, '');
  t = t.replace(/```[^\n]*\n([\s\S]*?)```/g, (m, body) => (BAR.test(body) ? '' : m));
  const out = [];
  for (const l of t.split('\n')) {
    if (OWN_LINE.test(l) || OLD_MAP.test(l)) continue;
    if (BAR.test(l)) {
      const prev = out[out.length - 1];
      if (prev !== undefined && prev.trim() && prev.length <= 80 && !/[.!?]\s*$/.test(prev)) out.pop();
      continue;
    }
    out.push(l);
  }
  return out.join('\n').replace(/https?:\/\/\S+/g, ' ');
}
const withoutCode = (t) => t.replace(/```[\s\S]*?```/g, ' ').replace(/`[^`\n]+`/g, ' ');
export const countWords = (t) => (String(t).match(/[\p{L}\p{N}][^\s]*/gu) || []).length;

// ---------- 1. length ----------
export function lengthFault(prose, ask, L) {
  const n = countWords(prose);
  if (hasAny(ask, L.longAskWords) || n <= L.maxWords) return '';
  return `it was ${n} words, where a reply is at most ${L.maxWords} unless they ask for a long one`;
}

// ---------- 2. whole sentences ----------
const ENDS = /[.!?:;)"”]\s*$/;
export function isSitrep(prose, ask, T) {
  return hasAny(ask, T.sitrepWords) || /^\s*[-*•>]*\s*\**\s*needs you\s*\**\s*:/im.test(prose);
}
export function labelLines(prose, T) {
  const found = [];
  let table = false;
  for (const raw of withoutCode(prose).split('\n')) {
    const l = raw.trim();
    if (!l) continue;
    if (/^\|.*\|$/.test(l)) { if (!table) { found.push('a table'); table = true; } continue; }
    table = false;
    const bare = l.replace(/^(?:[-*•>]|\d+[.)])\s+/, '');
    const flat = bare.replace(/\*\*|__/g, '');
    if (/^#{1,6}\s/.test(l) || /^(\*\*|__)[^*_]+(\*\*|__):?$/.test(bare)) { found.push(l); continue; }
    // A label: a bold "**Status:**" always; a plain "Status: merged" when what follows it is a fragment.
    const m = flat.match(/^([A-Za-z][^:\n]{0,60}?)\s*:(?:\s+|$)(.*)$/);
    if (m && countWords(m[1]) <= T.labelWords && !(T.exemptLabels || []).includes(low(m[1]).trim())) {
      const bold = /^(\*\*|__)[^*_:]+(:\s*)?(\*\*|__)\s*:?/.test(bare);
      const rest = m[2].trim();
      if (bold || countWords(rest) < T.fragmentWords || !/[.!?]\s*$/.test(rest)) { found.push(l); continue; }
    }
    const isList = bare !== l;
    if (isList && countWords(flat) < T.fragmentWords && !ENDS.test(flat)) found.push(l);
  }
  return found;
}
export function sentenceFault(prose, ask, T) {
  if (isSitrep(prose, ask, T)) return '';
  const found = labelLines(prose, T);
  if (found.length <= T.maxLabelLines) return '';
  const show = found.slice(0, 2).map((l) => `"${l.slice(0, 50)}"`).join(', ');
  return `it had ${found.length} lines that were a label or a fragment instead of a sentence (${show})`;
}

// ---------- 3. reading ease ----------
// The same count as starter/docs/tools/check-manuals.mjs (syllables, readingEase), copied so this check stands alone;
// the test compares the two when that file is present.
export function syllables(word) {
  let w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return 0;
  if (w.length <= 3) return 1;
  w = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').replace(/^y/, '');
  const groups = w.match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups ? groups.length : 1);
}
export function readingEase(text) {
  const sentences = text.split(/[.!?\n]+/).map((s) => s.trim()).filter((s) => /[a-z]/i.test(s));
  const words = text.match(/[A-Za-z][A-Za-z'-]*/g) || [];
  if (!sentences.length || !words.length) return null;
  const syl = words.reduce((n, w) => n + syllables(w), 0);
  return Math.round((206.835 - 1.015 * (words.length / sentences.length) - 84.6 * (syl / words.length)) * 10) / 10;
}
export function easeFault(prose, E) {
  const text = withoutCode(prose).replace(/[#>*_|[\]]/g, ' ');
  if (countWords(text) < E.minWords) return '';
  const score = readingEase(text);
  if (score === null || score >= E.minScore) return '';
  return `it was hard to read (a reading-ease score of ${score}, where plain English is ${E.minScore} or more): the sentences were long or the words were long`;
}

// ---------- 4. file names and code ----------
export function codeIn(prose) {
  const found = [];
  if (/```/.test(prose)) found.push('a block of code');
  const code = prose.match(/`[^`\n]+`/g); if (code) found.push(code[0]);
  const files = (prose.match(/\b[\w.-]+\.(md|ps1|mjs|cjs|js|ts|tsx|jsx|json|css|scss|html|sh|py|yml|yaml|log|txt)\b/gi) || []).filter((x) => !/^[A-Z][a-z]+\.js$/.test(x)); if (files.length) found.push(files[0]); // Next.js, Node.js: names, not files
  const paths = (prose.match(/(?:^|\s)(?:~\/|\.{1,2}\/)[\w./-]+|[A-Za-z]:\\[\w\\.-]+|(?:^|\s)[\w.-]+\/[\w.-]+\/[\w./-]*/g) || []).filter((x) => /[A-Za-z]/.test(x));
  if (paths.length) found.push(paths[0].trim());
  return [...new Set(found)];
}
export function codeFault(prose, ask, C) {
  if (hasAny(ask, C.techAskWords)) return '';
  const found = codeIn(prose);
  return found.length ? `it showed file names or code they did not ask for (${found.slice(0, 2).join(', ')})` : '';
}

// ---------- 5. inside words ----------
export function insideWords(prose, ask, W, skills) {
  const text = low(withoutCode(prose));
  const said = ' ' + low(ask) + ' ';
  const entries = Object.entries(W.words || {}).map(([w, plain]) => [low(w), String(plain)]);
  if (W.skillNames) {
    const names = new Set([...(skills || [])].map(low));
    for (const m of text.matchAll(/(?:^|[^a-z0-9-])(hive-[a-z][a-z0-9-]*|(?:engineering|anthropic-skills|data|vercel):[a-z][a-z0-9-]*)/g)) names.add(m[1]);
    for (const s of names) if ((s.includes('-') || s.includes(':')) && s.length > 4 && !entries.some(([w]) => w === s)) entries.push([s, 'what it does for them, not its name']);
  }
  if (W.codes) for (const m of String(prose).matchAll(/\b([A-Z]{1,2}\d{1,2})\b/g)) if (!entries.some(([w]) => w === low(m[1]))) entries.push([low(m[1]), 'what that piece of work is, not its code']);
  const found = [];
  for (const [w, plain] of entries) {
    if (new RegExp('(^|[^a-z0-9-])' + esc(w) + '(s|es|d|ed)?($|[^a-z0-9-])').test(said)) continue;
    if (plain && text.includes(low(plain))) continue;
    const re = new RegExp('(^|[^a-z0-9-])' + esc(w) + '(s|es)?(?=$|[^a-z0-9-])', 'g');
    let m, any = false, explained = false;
    while ((m = re.exec(text))) {
      any = true;
      // Explained when its meaning follows in the same sentence in any ordinary form (reply-parts.mjs, explainedAt).
      if (explainedAt(text, m.index + m[0].length, m.index + m[1].length, W.explainMarks)) { explained = true; break; }
    }
    if (any && !explained) found.push(`"${w}" (say: ${plain})`);
  }
  return found;
}
export function insideFault(prose, ask, W, skills) {
  const found = insideWords(prose, ask, W, skills);
  if (!found.length) return '';
  const max = W.maxNamed || 4;
  return `it used words they may not know without saying what they mean: ${found.slice(0, max).join(', ')}${found.length > max ? ` and ${found.length - max} more` : ''}`;
}

// ---------- all five ----------
// opts: names (the names of what the person asked for, never judged), questions (their open questions, quoted word for
// word). The length counts what is left after the display, the one line per thing they asked for and the quoted
// questions; the words are judged without their names for things and without a quoted phrase they are asked to type.
export function faultsOf(reply, ask, S, skills, opts = {}) {
  const raw = proseOf(reply);
  const prose = withoutTyped(withoutNames(raw, opts.names || []));
  const sitrep = isSitrep(raw, ask, section(S, 'sentences'));
  const counted = sitrep ? limitedText(raw, { questions: opts.questions || [] }) : raw;
  return [
    lengthFault(counted, ask, section(S, 'length')),
    sentenceFault(prose, ask, section(S, 'sentences')),
    easeFault(prose, section(S, 'ease')),
    codeFault(prose, ask, section(S, 'code')),
    insideFault(prose, ask, section(S, 'insideWords'), skills),
  ].filter(Boolean);
}
export function debtText(faults) {
  return `Your last reply to the person was not plain: ${faults.join('; ')}. In this reply, talk the way you would to a friend: short whole sentences that say why, everyday words, and the meaning of any word they may not know. Put the detail in the notebook, not in the reply (rule 6).`;
}

function stop(ev, ctx) {
  try {
    if (ctx && ctx.isHelperChat) return null;
    const reply = ev && typeof ev.text === 'string' ? ev.text : (ev && ev.last_assistant_message) || '';
    if (!reply.trim()) return null;
    const skills = ctx && ctx.loaded ? [...ctx.loaded] : [];
    const faults = faultsOf(reply, (ctx && ctx.hisLast) || '', (ctx && ctx.settings) || DEFAULTS, skills, { names: requestNames(ctx), questions: openQuestions(ctx) });
    if (!faults.length) return { clear: [KEY] };
    return { debt: { key: KEY, text: debtText(faults) } };
  } catch (e) {
    // A discipline check: on its own error the reply goes through and the error is logged.
    try { ctx && typeof ctx.log === 'function' && ctx.log('error', `plain-words: ${e && e.message}`); } catch {}
    return null;
  }
}

export default {
  id: 'plain-words',
  rule: 'rule 6',
  kind: 'discipline',
  mode: 'refuse',
  about: 'A reply to the person must be short, in whole sentences, easy to read, free of file names and code they did not ask for, and free of inside words left unexplained; each fault becomes a debt.',
  steps: { stop },
};
