#!/usr/bin/env node
// Questions for him: one list, kept by a program (upgrade of 2026-11-19, helper V).
// No question for the owner is parked, lost, or quietly decided for him.
//
//   node core/engine/questions.mjs ingest <file|-> --by "<who>"    every question in a helper's report goes in as new
//   node core/engine/questions.mjs add --by .. --text .. [--why ..] [--default ..] [--kind A|B] [--source ..]
//   node core/engine/questions.mjs sort <id> A|B [--why ..] [--was-decided ..]   A: ask at once. B: before publishing. Only upward.
//   node core/engine/questions.mjs reword <id> --text ".."   |   merge <id> --into <id>   (plain words; one question asked twice)
//   node core/engine/questions.mjs decide <id> --what .. --why .. --undo ..   kind C: refused for A, B, and anything his
//   node core/engine/questions.mjs drop <id> --why ..                kind E: a builder's own choice; refused for A, B
//   node core/engine/questions.mjs answer <id> --words "his words" [--where ..] [--date ..]   only his words close A and B
//   node core/engine/questions.mjs asked <id..> | asked --reply <file|->   mark as put to him
//   node core/engine/questions.mjs prompt                            run at each of his messages: what Claude must ask now
//   node core/engine/questions.mjs reply-check <file|->              faults in a reply: held back, or announced as decided
//   node core/engine/questions.mjs work "<name>"                     a new piece of work starts
//   node core/engine/questions.mjs list [--kind k] [--state s]
//   node core/engine/questions.mjs line                              the one line a status report carries
//   node core/engine/questions.mjs render                            writes system/questions-for-him.md
//   node core/engine/questions.mjs check                             OK|text or NEEDS|text lines (exit 1 on NEEDS)
//
// Places: HIVE_ROOT (the notebook), HIVE_STATE (the per-computer state folder, default ~/.claude/hive),
// HIVE_DATE and HIVE_NOW (for tests).
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = () => process.env.HIVE_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DATA = () => path.join(ROOT(), 'system', 'questions.json');
const PAGE = () => path.join(ROOT(), 'system', 'questions-for-him.md');
const STATE = () => path.join(process.env.HIVE_STATE || path.join(os.homedir(), '.claude', 'hive'), 'questions-state.json');
const now = () => process.env.HIVE_NOW || new Date().toISOString().slice(0, 16);
const today = () => process.env.HIVE_DATE || now().slice(0, 10);

export const KINDS = ['new', 'A', 'B', 'C', 'D', 'E'];
export const KIND_WORDS = {
  new: 'New, not sorted yet',
  A: 'Ask at once: it changes what is being built now, or what strangers will read',
  B: 'Needed before anything goes public: your yes, money, deleting, your private choices',
  C: 'Decided for you today, each with a one-step undo',
  D: 'Already answered: you said it before',
  E: 'Dropped: a builder\'s own choice, not yours',
};
// Words that make a question his whatever the lead thinks: public, paid, deleting, installing, private, or his meaning.
export const HIS = /\b(free|price|priced|pay|paid|cost|costs|money|spend|spending|credits?|plan usage|publish\w*|public|visitor|strangers?|front page|legal|licen[cs]e|name (shown|on|goes)|delete\w*|remove\w*|retire\w*|install(s|ed|ing|ation|ations)?|packages?|connect\w*|account|sign-in for|private|personal|his own|your own|meant|mean by|reverse\w*|instead of what (he|you) said|his words|your words)\b/i;
const STOP = new Set('should would could there their about which where when what with from that this have been into also than then them they your yours does doing done only more most some such each every other just like make made want need needs keep kept will shall being here very much many same both after before over under while because'.split(' '));

// ---------- the list ----------
export function load() {
  try { return JSON.parse(fs.readFileSync(DATA(), 'utf8')); } catch { return { version: 1, work: null, questions: [] }; }
}
export function save(d) {
  fs.mkdirSync(path.dirname(DATA()), { recursive: true });
  fs.writeFileSync(DATA(), JSON.stringify(d, null, 2) + '\n');
}
function loadState() { try { return JSON.parse(fs.readFileSync(STATE(), 'utf8')); } catch { return { messages: 0, seen: {} }; } }
function saveState(s) { fs.mkdirSync(path.dirname(STATE()), { recursive: true }); fs.writeFileSync(STATE(), JSON.stringify(s, null, 2) + '\n'); }

export const norm = (s) => String(s || '').toLowerCase().replace(/[`*_"'’“”]/g, '').replace(/[^a-z0-9$]+/g, ' ').trim();
export const words = (s) => [...new Set(norm(s).split(' ').filter((w) => w.length > 3 && !STOP.has(w)))];
const nextId = (d) => `q-${String(d.questions.reduce((m, q) => Math.max(m, Number(q.id.slice(2)) || 0), 0) + 1).padStart(3, '0')}`;
const get = (d, id) => { const q = d.questions.find((x) => x.id === id); if (!q) throw new Error(`No question "${id}"`); return q; };
const everHis = (q) => q.kind === 'A' || q.kind === 'B' || (q.history || []).some((h) => /^sorted (A|B)/.test(h.what));
// The helper's own words count too: rewording a question never makes it the lead's.
const isHis = (q) => HIS.test(q.text) || HIS.test(q.original || '') || Boolean(q.touches);
const open = (q) => q.state === 'open';
const note = (q, what) => { (q.history ||= []).push({ on: now(), what }); };

// A question that a decision in force already speaks to: rule 7 says never ask twice, and only he may reverse it.
export function touchesDecision(text) {
  let doc = '';
  try { doc = fs.readFileSync(path.join(ROOT(), 'system', 'decisions-in-force.md'), 'utf8'); } catch { return null; }
  // only the long, telling words count: a shared "check" or "should" means nothing
  const long = (s) => words(s).filter((w) => w.length >= 6);
  const qw = long(text); if (qw.length < 2) return null;
  let best = null;
  for (const line of doc.split(/\r?\n/)) {
    if (!/^\s*-\s+/.test(line)) continue;
    const lw = new Set(long(line));
    const hit = qw.filter((w) => lw.has(w)).length;
    if (hit >= 2 && hit / qw.length >= 0.4 && (!best || hit > best.hit)) best = { hit, line: line.replace(/^\s*-\s+/, '').trim() };
  }
  return best ? best.line.slice(0, 240) : null;
}

export function add(f) {
  const d = load();
  const text = String(f.text || '').trim();
  if (text.length < 6) throw new Error('Give the question with --text');
  const dup = d.questions.find((q) => norm(q.text) === norm(text));
  if (dup) return { q: dup, added: false };
  if (f.kind && !['A', 'B', 'new'].includes(f.kind)) throw new Error('A new question is new, A or B; use decide, drop or answer for C, E and D');
  const q = {
    id: nextId(d), text, why: f.why || '', default: f.default || '', kind: f.kind || 'new', state: 'open',
    raised_by: f.by || 'not recorded', raised_on: f.date || now(), source: f.source || '',
    asked: [], answer: null, decision: null, moved_from: null, touches: touchesDecision(text), history: [],
  };
  note(q, `added as ${q.kind}`);
  d.questions.push(q); save(d);
  return { q, added: true };
}

// wasDecided: what the lead had already decided on his behalf before the question was sorted up (it stays visible).
export function sort(id, kind, why = '', wasDecided = '') {
  const d = load(); const q = get(d, id);
  if (!['A', 'B'].includes(kind)) throw new Error('sort takes A or B. For C use decide, for E use drop, for D use answer');
  if (q.state === 'decided' && q.kind === 'C') { q.state = 'open'; q.moved_from = 'C'; wasDecided ||= q.decision.what; }
  if (!open(q)) throw new Error(`${id} is already closed (${q.state})`);
  if (q.kind === 'A' && kind === 'B') throw new Error(`${id} is kind A; only his own words close it, and it is never moved down`);
  if (wasDecided) { q.moved_from = 'C'; q.lead_had_decided = wasDecided; }
  q.kind = kind; if (why) q.moved_why = why; note(q, `sorted ${kind}${why ? ': ' + why : ''}`); save(d); return q;
}

// Plain words for him; the helper's own wording is kept in the history.
export function reword(id, text) {
  const d = load(); const q = get(d, id);
  if (!text || text.length < 6) throw new Error('reword needs --text');
  q.original ||= q.text; q.text = text; q.touches = touchesDecision(text) || q.touches; note(q, 'reworded'); save(d); return q;
}

// The same question asked twice: one stays, the other points to it.
export function merge(id, into) {
  const d = load(); const q = get(d, id); const t = get(d, into);
  if (id === into) throw new Error('A question cannot be merged into itself');
  if (t.state === 'merged') throw new Error(`${into} is itself merged; merge into ${t.merged_into}`);
  if ((everHis(q) || isHis(q)) && !(t.kind === 'A' || t.kind === 'B' || t.state === 'answered')) throw new Error(`${id} is his; merge it only into a question of kind A or B, or one he answered`);
  q.state = 'merged'; q.merged_into = into; (t.also ||= []).push(q.original || q.text); note(q, 'merged into ' + into); save(d); return q;
}

export function decide(id, f) {
  const d = load(); const q = get(d, id);
  if (everHis(q)) throw new Error(`${id} is kind ${q.kind === 'A' || q.kind === 'B' ? q.kind : 'A or B (it was sorted so before)'}: the lead may not decide it. Only his own words close it`);
  guardHis(q, f['not-his'], 'decide');
  if (!f.what || !f.why || !f.undo) throw new Error('decide needs --what, --why and --undo (one step)');
  q.kind = 'C'; q.state = 'decided'; q.decision = { what: f.what, why: f.why, undo: f.undo, on: f.date || today() };
  if (f['not-his']) q.not_his = f['not-his'];
  note(q, 'decided by the lead'); save(d); return q;
}

// A question whose words sound like his (public, paid, ...) is his, unless the lead says in one line why it is not.
// That line is printed beside it on his page, so he can overrule it at a glance.
// The match with his decisions is by words, so it can be wrong both ways; a real reversal is always kind A.
function guardHis(q, notHis, verb) {
  if (notHis) return;
  if (q.touches) throw new Error(`${q.id} may reverse a decision he made ("${q.touches.slice(0, 80)}..."): only he may change that, so sort it A. If it does not touch that decision, ${verb} with --not-his "<why>", which he will see`);
  if (isHis(q)) throw new Error(`${q.id} touches what is his (public, paid, deleting, installing, private, or his meaning): sort it A or B and ask him. If it truly is not his, ${verb} with --not-his "<why>", which he will see`);
}

export function drop(id, why, notHis) {
  const d = load(); const q = get(d, id);
  if (everHis(q)) throw new Error(`${id} is his to answer; it cannot be dropped`);
  guardHis(q, notHis, 'drop');
  if (!why) throw new Error('drop needs --why');
  q.kind = 'E'; q.state = 'dropped'; q.dropped_why = why; if (notHis) q.not_his = notHis;
  note(q, 'dropped: ' + why); save(d); return q;
}

export function answer(id, f) {
  const d = load(); const q = get(d, id);
  if (!f.words) throw new Error('answer needs --words: his own words, quoted');
  if (q.kind === 'new' || q.kind === 'E') q.kind = 'D';
  q.state = 'answered'; q.answer = { words: f.words, on: f.date || today(), where: f.where || '' };
  note(q, 'answered in his words'); save(d); return q;
}

// Did a reply put this question to him? Word for word, or nearly all of its words.
export function inReply(q, reply) {
  const r = norm(reply); if (!r) return false;
  if (r.includes(norm(q.text))) return true;
  if (r.includes(`[${q.id}]`) || new RegExp(`\\b${q.id.replace('-', ' ')}\\b`).test(r)) return true;
  const qw = words(q.text); if (!qw.length) return false;
  const rw = new Set(r.split(' '));
  return qw.filter((w) => rw.has(w)).length / qw.length >= 0.8;
}

export function asked(ids, reply = null) {
  const d = load(); const s = loadState(); const marked = [];
  for (const q of d.questions) {
    if (!open(q)) continue;
    const hit = reply !== null ? inReply(q, reply) : ids.includes(q.id);
    if (!hit) continue;
    q.asked.push({ on: now(), at_message: s.messages, how: reply !== null ? 'found in a reply' : 'marked' });
    marked.push(q.id);
  }
  if (reply === null) for (const id of ids) if (!marked.includes(id)) get(d, id);
  save(d); return marked;
}

export function work(name) { const d = load(); d.work = { name, since: now() }; save(d); return d.work; }

// ---------- reading a helper's report ----------
const HEAD = /(?:open\s+)?questions?\s+(?:for|to)\s+(?:the\s+owner|the\s+user|you|him)\b|\bfor\s+the\s+owner\b|(?:^|\n)[ \t]*(?:\d+\.\s*)?questions(?=\s*:)/gi;
const STOPLINE = /^\s*(?:\d+\.\s*)?(?:which\s+)?(?:model|note for the lead|notes? for the lead|left alone|also found|skills|connectors|protocols|what was not checked|suggested line|nothing was|not checked)\b/i;
const ITEM = /^\s*(?:[-*•]|\d+[.)]|\(?[a-z0-9]\))\s+(.*)$/i;
const NONE = /^\s*[:.]?\s*(none|no questions|nothing|n\/a)\b/i;

function splitInline(t) {
  t = t.replace(/\s+\d{1,2}\.\s+(?:which\s+)?model\b[\s\S]*$/i, '').trim();
  if (!t) return [];
  if (/\(([a-z])\)\s/.test(t)) return t.split(/\s*\([a-z]\)\s+/).filter((x) => x.trim());
  const qs = t.match(/[^?]*\?/g) || [];
  if (qs.length >= 2) return qs;
  if (qs.length === 1) return [t.slice(0, t.indexOf('?') + 1)];
  const semi = t.split(/;\s+/);
  if (semi.length >= 2) return semi;
  return t.split(/(?<=\.)\s+(?=[A-Z])/);
}
function clean(item) {
  let s = item.replace(/\s+/g, ' ').replace(/^[\s:;,.-]+/, '').replace(/[;,]\s*$/, '').trim();
  if (s.includes('?')) s = s.slice(0, s.lastIndexOf('?') + 1);
  else s = (s.match(/^.*?[.!](?=\s|$)/) || [s])[0];
  return s.trim();
}
export function parseQuestions(text) {
  const t = String(text || '').replace(/\r/g, '').replace(/\*\*|__/g, '');
  const out = [];
  for (const m of t.matchAll(HEAD)) {
    let rest = t.slice(m.index + m[0].length);
    const nl = rest.indexOf('\n'); const first = nl < 0 ? rest : rest.slice(0, nl);
    // a heading is followed by ":", ".", "(" or the end of the line; anything else is a sentence that mentions questions
    if (!/^\s*([:.(]|$)/.test(first)) continue;
    let headRest = first;
    const colon = first.indexOf(':');
    if (/^\s*\(/.test(first)) headRest = first.replace(/^\s*\([^)]*\)\s*:?/, '');
    else if (colon >= 0 && colon < 140 && /^\s*:/.test(first)) headRest = first.slice(colon + 1);
    else headRest = first.replace(/^\s*[.:]/, '');
    const body = [];
    for (const line of (nl < 0 ? [] : rest.slice(nl + 1).split('\n'))) {
      if (/^#{1,6}\s/.test(line) || /<\/?agent-message|<\/system-reminder/.test(line) || STOPLINE.test(line)) break;
      body.push(line);
    }
    while (body.length && !body[body.length - 1].trim()) body.pop();
    // a blank line followed by text that is not an item ends the section
    const lines = []; let blank = false;
    for (const l of body) { if (!l.trim()) { blank = true; continue; } if (blank && !ITEM.test(l)) break; blank = false; lines.push(l); }
    if (NONE.test(headRest) || (!headRest.trim() && lines.length && NONE.test(lines[0]))) continue;
    const items = []; let inlineTail = [];
    for (const l of lines) {
      const im = l.match(ITEM);
      if (im) items.push(im[1]);
      else if (items.length) items[items.length - 1] += ' ' + l.trim();
      else inlineTail.push(l.trim());
    }
    const inline = [headRest.trim(), ...inlineTail].filter(Boolean).join(' ');
    const found = items.length ? [...(inline && !/^\(?[^)]*\)?$/.test(inline) && inline.length > 12 ? splitInline(inline) : []), ...items] : splitInline(inline);
    for (const f of found) { const c = clean(f); if (c.length >= 8 && !STOPLINE.test(c)) out.push(c); }
  }
  const seen = new Set();
  return out.filter((q) => { const k = norm(q); if (seen.has(k)) return false; seen.add(k); return true; });
}

export function ingest(text, by, date) {
  const found = parseQuestions(text);
  const res = { found: found.length, added: [], already: [] };
  for (const text1 of found) {
    const { q, added } = add({ text: text1, by, date, source: 'helper report' });
    (added ? res.added : res.already).push(q);
  }
  return res;
}

// ---------- what Claude must do at each of his messages ----------
const ask = (q) => q.kind === 'A' || q.kind === 'new';
export function prompt() {
  const d = load(); const s = loadState();
  s.messages = (s.messages || 0) + 1; s.seen ||= {};
  const live = d.questions.filter((q) => open(q) && ask(q));
  for (const q of live) if (!(q.id in s.seen)) s.seen[q.id] = s.messages;
  saveState(s);
  const late = (q) => s.messages - s.seen[q.id] >= 1;
  const toAsk = live.filter((q) => q.kind === 'A' || late(q));
  const toSort = live.filter((q) => q.kind === 'new' && !late(q));
  const out = [];
  if (toAsk.length) {
    out.push('HIVE QUESTIONS: ASK THESE NOW, before anything else in your reply. Put each to him word for word. Only his own words close one; "do not disturb me" never holds these back.');
    toAsk.forEach((q, i) => out.push(`${i + 1}. [${q.id}] ${q.text}${q.why ? `\n   Why it matters: ${q.why}` : ''}${q.default ? `\n   If he does not answer: ${q.default}` : ''}${q.asked.length ? `\n   (put to him before, ${q.asked.length} time${q.asked.length > 1 ? 's' : ''}; still no answer)` : late(q) && q.kind === 'new' ? '\n   (not sorted in time, so it is asked as kind A)' : ''}`));
    const held = toAsk.filter((q) => !q.asked.length && late(q));
    if (held.length) out.push(`HELD BACK: ${held.map((q) => q.id).join(', ')} reached you at an earlier message and were not put to him. That is the fault this list exists to stop.`);
  }
  if (toSort.length) {
    out.push('HIVE QUESTIONS: SORT THESE before your reply ends (new from a report). A or B: node core/engine/questions.mjs sort <id> A|B; your own cheap choice: decide <id> --what --why --undo; not his: drop <id> --why. Unsorted at his next message means asked as A.');
    toSort.forEach((q) => out.push(`- [${q.id}] ${q.text} (from ${q.raised_by})`));
  }
  return out.join('\n');
}

// ---------- faults in a reply ----------
const ANNOUNCE = /\b(I|we|the lead)\s+(have\s+)?(decided|chose|picked|went with|settled on|ruled|answered (it|them|this) (myself|for you))\b|\bdecided (for|on behalf of) (you|him)\b|\btold to (you|him) in the recap\b|\b(ask|tell|put it to) (you|him) at the end\b|\bpark(ed|ing)? (it|this|them|that)\b|\bsaved? (it )?for the end\b/i;
export function replyFaults(reply) {
  const d = load(); const faults = [];
  const sentences = String(reply || '').split(/(?<=[.!?])\s+|\n+/);
  for (const q of d.questions.filter((x) => open(x) && (x.kind === 'A' || x.kind === 'B'))) {
    const qw = words(q.text); if (qw.length < 2) continue;
    for (const s of sentences) {
      if (!ANNOUNCE.test(s)) continue;
      const sw = new Set(words(s));
      if (qw.filter((w) => sw.has(w)).length >= Math.max(2, Math.ceil(qw.length * 0.4))) { faults.push(`ANNOUNCED AS DECIDED: [${q.id}] is kind ${q.kind}; only his words close it. Put it to him as a question: "${q.text}"`); break; }
    }
  }
  const s = loadState();
  for (const q of d.questions.filter((x) => open(x) && x.kind === 'A' && s.seen && x.id in s.seen)) {
    if (!inReply(q, reply)) faults.push(`HELD BACK: [${q.id}] was handed to this reply and is not in it: "${q.text}"`);
  }
  return faults;
}

// ---------- the line and the page ----------
export function needsYou(d = load()) {
  const o = d.questions.filter(open);
  const a = o.filter((q) => q.kind === 'A' || q.kind === 'new'), b = o.filter((q) => q.kind === 'B');
  return { a, b, all: [...a, ...b] };
}
export function statusLine() {
  const { a, b, all } = needsYou();
  if (!all.length) return 'Needs you: nothing.';
  return `Needs you: ${all.length} question${all.length > 1 ? 's' : ''} (${a.length} now, ${b.length} before publishing), the first is: ${all[0].text}`;
}

const cellText = (s) => String(s || '').replace(/\s+/g, ' ').trim();
export function renderPage() {
  const d = load(); const Q = d.questions;
  const by = (k, st) => Q.filter((q) => q.kind === k && (!st || q.state === st));
  const answered = Q.filter((q) => q.state === 'answered');
  const merged = Q.filter((q) => q.state === 'merged').length;
  const raised = Q.length, reached = Q.filter((q) => q.asked.length).length;
  let md = `# Questions for you\n\nMade from system/questions.json on ${today()}. Do not edit this page: answer in the chat, and your words close the question.\n\n`;
  md += `In short: ${needsYou(d).a.length} to answer now, ${by('B', 'open').length} before anything goes public, ${by('C', 'decided').length} decided for you (each can be undone in one step), ${answered.length} already answered, ${by('E', 'dropped').length} dropped. ${raised} in all, ${merged} of them the same question asked twice and folded into one; ${reached} were put to you.\n\n`;
  const sec = (title, intro, items, fn) => { md += `## ${title}\n\n${intro}\n\n`; if (!items.length) { md += '_None._\n\n'; return; } items.forEach((q, i) => { md += fn(q, i + 1) + '\n'; }); md += '\n'; };
  const ask1 = (q, n) => `${n}. **${cellText(q.text)}**${q.why ? `\n   Why it matters: ${cellText(q.why)}` : ''}${q.default ? `\n   If you do not answer: ${cellText(q.default)}` : ''}${q.moved_from ? `\n   I had decided this for you (${cellText(q.lead_had_decided || 'see the list')}). It is yours to answer: ${cellText(q.moved_why)}` : ''}${q.also && q.also.length ? `\n   Also asked as: ${q.also.map(cellText).join(' / ')}` : ''}${q.asked.length ? `\n   Put to you on ${q.asked[0].on.slice(0, 10)}.` : '\n   Not put to you yet.'}`;
  const fresh = by('new', 'open');
  if (fresh.length) sec('New, not sorted yet', 'Just arrived from a report. Each is sorted before the next reply, or it is asked at once.', fresh, ask1);
  sec('A. Please answer now', 'Each changes what is being built right now or what strangers will read. One word or one short sentence is enough.', by('A', 'open'), ask1);
  sec('B. Before anything goes public', 'Your yes, money, deleting, or your own private choices. Nothing here happens without your answer.', by('B', 'open'), ask1);
  sec('C. Decided for you today', 'Cheap to undo and nothing public, paid or private. Say "undo" and the number to overrule one.', by('C', 'decided'), (q, n) => `${n}. ${cellText(q.text)}\n   Decided: ${cellText(q.decision.what)}\n   Why: ${cellText(q.decision.why)}\n   To undo: ${cellText(q.decision.undo)}${q.not_his ? `\n   Look at this one: its words sound like yours. Why I took it: ${cellText(q.not_his)}` : ''}`);
  sec('D. Already answered', 'You said these before, so they are not asked again.', answered, (q, n) => `${n}. ${cellText(q.text)}\n   You said: "${cellText(q.answer.words)}"${q.answer.where ? ` (${cellText(q.answer.where)})` : ''}`);
  sec('E. Dropped', 'A builder\'s own choice, not yours. Listed so nothing disappears.', by('E', 'dropped'), (q, n) => `${n}. ${cellText(q.text)}\n   Why dropped: ${cellText(q.dropped_why)}${q.not_his ? `\n   Look at this one: its words sound like yours. Why it is not: ${cellText(q.not_his)}` : ''}`);
  return md.trimEnd() + '\n';
}
export function render() { fs.writeFileSync(PAGE(), renderPage()); return PAGE(); }

// ---------- check ----------
export function check() {
  const d = load(); const out = []; const say = (ok, t) => out.push(`${ok ? 'OK' : 'NEEDS'}|${t}`);
  if (!fs.existsSync(DATA())) { say(true, 'No questions for him yet'); return out; }
  const bad = [];
  for (const q of d.questions) {
    if (!KINDS.includes(q.kind)) bad.push(`${q.id} has no valid kind`);
    if ((q.kind === 'A' || q.kind === 'B') && q.state === 'decided') bad.push(`${q.id} is kind ${q.kind} and was decided by the lead`);
    if (q.kind === 'C' && !(q.decision && q.decision.undo)) bad.push(`${q.id} is decided with no undo`);
    if (q.state === 'answered' && !(q.answer && q.answer.words)) bad.push(`${q.id} is closed without his words`);
    if (q.state === 'merged' && !d.questions.some((x) => x.id === q.merged_into)) bad.push(`${q.id} is merged into a question that does not exist`);
    if ((q.kind === 'C' || q.kind === 'E') && isHis(q) && !q.not_his) bad.push(`${q.id} is filed as ${q.kind} but touches what is his`);
  }
  say(!bad.length, 'Every question is sorted honestly' + (bad.length ? `: ${bad.join('; ')}` : ''));
  const cur = (() => { try { return fs.readFileSync(PAGE(), 'utf8').replace(/\r\n/g, '\n'); } catch { return null; } })();
  const strip = (s) => s.replace(/on \d{4}-\d{2}-\d{2}/, '');
  say(cur !== null && strip(cur) === strip(renderPage()), 'The page for him is up to date with the list' + (cur === null ? ': the page is missing (run render)' : strip(cur) === strip(renderPage()) ? '' : ': behind (run render)'));
  const s = loadState(); const seen = s.seen || {};
  for (const q of d.questions.filter((x) => open(x) && x.kind === 'A')) {
    if (!q.asked.length) say(false, `NEEDS YOU: [${q.id}] "${q.text}" is kind A and was never put to him${q.id in seen ? ` (waiting ${s.messages - seen[q.id]} of his messages)` : ''}`);
    else if (d.work && q.raised_on < d.work.since) say(false, `NEEDS YOU: [${q.id}] "${q.text}" is still open from before the current work ("${d.work.name}") began`);
  }
  for (const q of d.questions.filter((x) => open(x) && x.kind === 'new' && x.id in seen && s.messages - seen[x.id] >= 1)) say(false, `[${q.id}] came from a report and was not sorted before his next message`);
  if (!out.some((l) => l.startsWith('NEEDS') && /NEEDS YOU|not sorted/.test(l))) say(true, `No question of kind A is held back (${d.questions.filter((x) => open(x) && x.kind === 'A').length} open, all put to him)`);
  return out;
}

// ---------- command line ----------
function parseFlags(args) {
  const f = {}; const rest = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) f[args[i].slice(2)] = args[i + 1] !== undefined && !args[i + 1].startsWith('--') ? args[++i] : 'true';
    else rest.push(args[i]);
  }
  return { f, rest };
}
const readIn = (p) => (p === '-' || !p ? fs.readFileSync(0, 'utf8') : fs.readFileSync(p, 'utf8'));
const show = (q) => `${q.id} | ${q.kind} | ${q.state} | ${q.text}`;

function main(argv) {
  const [cmd, ...args] = argv; const { f, rest } = parseFlags(args);
  try {
    if (cmd === 'ingest') {
      const r = ingest(readIn(rest[0]), f.by || 'a helper', f.date);
      if (!r.found) console.log('No questions for him in this report.');
      for (const q of r.added) console.log(`Added ${q.id} (new, not sorted): ${q.text}${q.touches ? `\n  It touches a decision he made: ${q.touches}` : ''}`);
      for (const q of r.already) console.log(`Already on the list as ${q.id} (${q.state}${q.answer ? `; he said: "${q.answer.words}"` : ''}): ${q.text}`);
      if (r.added.length) render();
    } else if (cmd === 'add') { const { q, added } = add(f); console.log(added ? `Added ${q.id} (${q.kind}).${q.touches ? ' It touches a decision he made: ' + q.touches : ''}` : `Already on the list as ${q.id}.`); render(); }
    else if (cmd === 'sort') { const q = sort(rest[0], rest[1], f.why, f['was-decided']); console.log(`${q.id} is now kind ${q.kind}.`); render(); }
    else if (cmd === 'reword') { const q = reword(rest[0], f.text); console.log(`${q.id} reworded.`); render(); }
    else if (cmd === 'merge') { const q = merge(rest[0], f.into); console.log(`${q.id} merged into ${q.merged_into}.`); render(); }
    else if (cmd === 'decide') { const q = decide(rest[0], f); console.log(`${q.id} decided by the lead, with its undo.`); render(); }
    else if (cmd === 'drop') { const q = drop(rest[0], f.why, f['not-his']); console.log(`${q.id} dropped.`); render(); }
    else if (cmd === 'answer') { const q = answer(rest[0], f); console.log(`${q.id} answered in his words.`); render(); }
    else if (cmd === 'asked') { const m = f.reply ? asked([], readIn(f.reply)) : asked(rest); console.log(m.length ? `Put to him: ${m.join(', ')}` : 'None of the open questions is in that reply.'); render(); }
    else if (cmd === 'prompt') { const t = prompt(); if (t) console.log(t); }
    else if (cmd === 'reply-check') { const r = replyFaults(readIn(rest[0])); r.forEach((l) => console.log(l)); process.exitCode = r.length ? 1 : 0; }
    else if (cmd === 'work') { const w = work(rest.join(' ')); console.log(`Current work: ${w.name}, since ${w.since}.`); }
    else if (cmd === 'list') load().questions.filter((q) => (!f.kind || q.kind === f.kind) && (!f.state || q.state === f.state)).forEach((q) => console.log(show(q)));
    else if (cmd === 'line') console.log(statusLine());
    else if (cmd === 'render') console.log(`Wrote ${path.relative(ROOT(), render())}.`);
    else if (cmd === 'check') { const o = check(); o.forEach((l) => console.log(l)); process.exitCode = o.some((l) => l.startsWith('NEEDS')) ? 1 : 0; }
    else { console.log('Commands: ingest, add, sort, reword, merge, decide, drop, answer, asked, prompt, reply-check, work, list, line, render, check'); process.exitCode = 2; }
  } catch (err) { console.error(`NEEDS|${err.message}`); process.exitCode = 1; }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
