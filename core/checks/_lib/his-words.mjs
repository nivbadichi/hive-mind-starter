// His own words, and only his (2026-11-20, the faults seen live in the afternoon).
// 1. The step "at his message" (UserPromptSubmit) also fires for turns he did not type: the hooks page (read
//    2026-11-20) says it "also fires on turns Claude Code starts on its own", among them "a background subagent
//    reporting back to the session that started it" and "a message another session sends to your main conversation".
//    A helper's report that held the words "accept the installed copies" was taken as his ruling. ownWords() takes out
//    of a prompt every part that is not his: the framed blocks the app puts around a helper's report, a task notice, a
//    message from another chat or a reminder, and every line that is a line of a helper report this chat received.
//    What is left is his; when nothing is left, the prompt was not his and his last own message stays what it was.
// 2. His answer on a question card is his word for the act that card asked about, and for nothing else.
//    cardAnswers() reads the card's answers; approvedBy() says whether one of them is his yes for an act.
// The gates (core/gates/gates.mjs) hold the same reading in their own file, because they are installed apart from the
// notebook; core/checks/_lib/test/his-words.test.mjs proves the two give the same answer.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// The frames the app puts around words that are not his. A block from its opening tag to its closing tag (or to the
// end when it is never closed) is taken out whole.
export const FRAME_TAGS = ['task-notification', 'agent-message', 'teammate-message', 'cross-session-message', 'channel-message', 'session-message', 'peer-message', 'system-reminder', 'subagent-report', 'background-task', 'local-command-stdout', 'local-command-stderr', 'local-command-caveat', 'tool-result', 'function_results', 'bash-stdout', 'bash-stderr'];
// Words the app writes in front of a report or a notice. One of them outside a frame makes the whole prompt not his.
export const FRAME_PHRASES = ['[subagent hand-back]', 'another claude session sent a message', 'the text below is the final report of a subagent', 'this is an automated background-task event', '[system notification - not user input]', 'background command "', 'this agent\'s report was delivered to you'];

const normLine = (l) => String(l).toLowerCase().replace(/[’`]/g, "'").replace(/\s+/g, ' ').trim();
const lineHash = (l) => crypto.createHash('sha1').update(normLine(l)).digest('hex').slice(0, 16);
const MIN_LINE = 24; // a line shorter than this ("yes", "ok, go ahead") is never taken for a report's line

// The lines of a helper's report, as hashes, appended to the chat's record (at most maxKeep kept).
export function recordReport(file, text, maxKeep = 6000) {
  const lines = String(text || '').replace(/\r/g, '').split('\n').map(normLine).filter((l) => l.length >= MIN_LINE);
  if (!file || !lines.length) return 0;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    let have = [];
    try { have = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean); } catch {}
    const set = new Set(have);
    for (const l of lines) { const h = lineHash(l); if (!set.has(h)) { set.add(h); have.push(h); } }
    fs.writeFileSync(file, have.slice(-maxKeep).join('\n') + '\n');
  } catch { return 0; }
  return lines.length;
}
export function reportLines(file) { try { return new Set(fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)); } catch { return new Set(); } }

const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// { own, his, why }: own is the text that is his; his is false when none of the prompt is his.
export function ownWords(prompt, { known = new Set(), helperChat = false } = {}) {
  const raw = String(prompt || '');
  if (helperChat) return { own: '', his: false, why: 'a helper chat: its prompts come from the chat that started it' };
  let t = raw.replace(/\r/g, '');
  const why = [];
  const tags = new RegExp(`<(${FRAME_TAGS.map(esc).join('|')})\\b[^>]*>[\\s\\S]*?(?:<\\/\\1\\s*>|$)`, 'gi');
  t = t.replace(tags, (m, tag) => { why.push(tag); return '\n'; });
  const low = t.toLowerCase();
  const phrase = FRAME_PHRASES.find((p) => low.includes(p));
  if (phrase) return { own: '', his: false, why: `the words "${phrase}" that the app writes in front of a report or a notice` };
  const kept = [];
  let dropped = 0;
  for (const l of t.split('\n')) {
    const n = normLine(l);
    if (n.length >= MIN_LINE && known.has(lineHash(n))) { dropped++; continue; }
    kept.push(l);
  }
  if (dropped) why.push(`${dropped} line${dropped === 1 ? '' : 's'} of a helper's report`);
  const own = kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return { own, his: !!own, why: why.join(', ') };
}

// ---------- the question card ----------
// The hooks page gives the card's input ({ questions: [{ question, header, options, multiSelect }], answers: { question:
// label } }, "Claude doesn't set this field") and no shape for its result: the answers are read from the result first
// (its answers, or "question"="answer" in its text), then from the input's answers.
const textOf = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((b) => (typeof b === 'string' ? b : (b && b.text) || '')).join('\n') : '');
export function cardAnswers(ti, resp) {
  const found = new Map();
  const take = (m) => { if (m && typeof m === 'object' && !Array.isArray(m)) for (const [q, a] of Object.entries(m)) { const v = Array.isArray(a) ? a.join(', ') : a && typeof a === 'object' ? (a.answer || a.label || a.text || JSON.stringify(a)) : a; if (String(q).trim() && String(v ?? '').trim() && !found.has(String(q).trim())) found.set(String(q).trim(), String(v).trim()); } };
  if (resp && typeof resp === 'object') { take(resp.answers); if (resp.data) take(resp.data.answers); }
  const text = typeof resp === 'string' ? resp : resp && typeof resp === 'object' ? [textOf(resp.content), typeof resp.result === 'string' ? resp.result : '', typeof resp.output === 'string' ? resp.output : ''].join('\n') : '';
  for (const m of String(text).matchAll(/"([^"\n]{3,600})"\s*=\s*"([^"\n]{1,2000})"/g)) if (!found.has(m[1].trim())) found.set(m[1].trim(), m[2].trim());
  take(ti && ti.answers);
  return [...found].map(([question, answer]) => ({ question, answer }));
}
// A card that arrives with its answers already filled in was answered by whoever wrote it, not by him.
export function prefilled(ti) { const a = ti && ti.answers; return !!(a && typeof a === 'object' && Object.keys(a).length); }

const YES_START = /^(yes|yep|yeah|ok|okay|sure|go|go ahead|do it|please do|approved?|allow|agreed?|confirm(ed)?|fine|right|correct)\b/;
const NO_WORD = /\b(no|not|don't|dont|do not|never|cancel|stop|wait|later|hold|skip|keep the installed|leave)\b/;
// Is a card's answer a yes? It starts with a yes word and holds no "no" word; or it is one of the card's own offers
// that names the act (then the act is checked by approvedBy).
export function isYesAnswer(answer) {
  const a = normLine(answer).replace(/^["'(]+/, '');
  if (!a) return false;
  if (YES_START.test(a)) return !NO_WORD.test(a.replace(YES_START, ''));
  return false;
}
const names = (text, w) => new RegExp('(^|[^a-z0-9#])' + esc(String(w).toLowerCase().trim()) + '($|[^a-z0-9])').test(' ' + normLine(text) + ' ');
const negatedBefore = (text, w) => { const t = normLine(text); const i = t.indexOf(String(w).toLowerCase()); return i >= 0 && /\b(don't|dont|do not|never|not|no|without|stop)\b[^.,;!?]{0,20}$/.test(t.slice(Math.max(0, i - 30), i)); };
// His yes for an act through a card: the card asked about that act (its question names one of the words) and his
// answer is a yes; or his answer itself names the act, not negated. Answers to other questions never count.
export function approvedBy(cards, words) {
  for (const c of cards || []) for (const w of words || []) {
    if (!String(w).trim()) continue;
    if (names(c.answer, w) && !negatedBefore(c.answer, w) && !NO_WORD.test(normLine(c.answer).split(String(w).toLowerCase())[0])) return { card: c, word: w };
    if (names(c.question, w) && !negatedBefore(c.question, w) && isYesAnswer(c.answer)) return { card: c, word: w };
  }
  return null;
}
