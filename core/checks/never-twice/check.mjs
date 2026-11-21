// never-twice: rule 7 ("never ask twice; save the moment it appears; a lesson closes with a change; the front door").
//
// Steps (the contract is system/design/enforcement-2026-11-20.md):
//   prompt   at each message of the person: records what the person sent (links, files) for the front door; at the first message of
//            a chat, puts the lessons that nothing real has closed (older than a day) in front of Claude.
//   pretool  refuses a question card (AskUserQuestion) that a saved decision already answers, with the decision quoted;
//            refuses the end of a piece of work (the close skill, a closing save) while something the person sent in this chat
//            is missing from the list of what the person sends.
//   stop     a debt when the reply asks the person what a saved decision answers; when a rule, wish, decision or correction the
//            person stated is not written to the notes in the same turn (it stays owed until it is); when the notes were saved
//            and the reply has no "Saved:" line; when something the person sent in their last message is not in the list.
//
// Kind "discipline": when this check itself breaks, the step is let through and the error is logged.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseLessons, judge } from '../../engine/lessons.mjs';
import { words as qWords } from '../../engine/questions.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ID = 'never-twice';
const DEBT_KEY = ID;

// The wording of what Claude is told. The starter's copy changes only this block.
const WHO = {
  him: 'the person', his: "the person's", he: 'the person',
  list: 'the list of what the person sends',
};

let DEFAULT_SETTINGS = {};
try { DEFAULT_SETTINGS = JSON.parse(fs.readFileSync(path.join(HERE, 'settings.json'), 'utf8')); } catch { DEFAULT_SETTINGS = {}; }
const conf = (ctx, part) => ({ ...(DEFAULT_SETTINGS[part] || {}), ...((ctx && ctx.settings && ctx.settings[part]) || {}) });

// ---------- small exact parts (exported for the tests) ----------
const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function hasAny(text, words) {
  const t = ' ' + String(text || '').toLowerCase() + ' ';
  return (words || []).some((w) => new RegExp('(^|[^a-z#])' + esc(String(w).toLowerCase()) + '($|[^a-z])').test(t));
}
export function firstOf(text, words) {
  return (words || []).find((w) => hasAny(text, [w])) || null;
}
export const sentences = (text) => String(text || '').replace(/\r/g, '').split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
const today = (ctx) => (ctx && ctx.today) || process.env.HIVE_DATE || (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();
const dayNumber = (s) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / 86400000;
const short = (s, n = 200) => { const t = String(s).replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1).replace(/\s+\S*$/, '') + '...' : t; };

function readNote(ctx, rel) {
  if (ctx && typeof ctx.read === 'function') { const t = ctx.read(rel); return t == null ? '' : String(t); }
  try { return fs.readFileSync(path.join(ctx.root, rel), 'utf8'); } catch { return ''; }
}

// Questions put to the person in a reply: sentences that end in "?" and ask them for a choice or a yes.
export function directedQuestions(text, askWords) {
  return sentences(text).filter((s) => /\?\s*[*_)]*\s*$/.test(s) && hasAny(s, askWords));
}

// Saved decisions, the list in force first (it is what holds today), then the history, newest first.
export function decisionLines(decisionsText, inForceText) {
  const inForce = String(inForceText || '').replace(/\r/g, '').split('\n')
    .filter((l) => /^\s*-\s+\S/.test(l)).map((l) => ({ from: 'in force', date: null, text: l.replace(/^\s*-\s+/, '').trim() }));
  const rows = String(decisionsText || '').replace(/\r/g, '').split('\n')
    .map((l) => l.match(/^\|\s*(\d{4}-\d{2}-\d{2})\s*\|([^|]*)\|/)).filter(Boolean)
    .map((m) => ({ from: 'decision', date: m[1], text: m[2].trim() }))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return [...inForce, ...rows];
}

// An earlier decision answers a question only when it settles the same choice (2026-11-20, seen live: a real question
// about new palettes was refused because a saved decision merely shared its topic). The question's own words, besides
// its topic's words and the small words, are its choice: a question that names no choice of its own ("should I
// publish now?") asks the topic's choice, and a decision on the topic answers it; a question that names one (Mint,
// Raspberry, the examples he sent) is answered only by a decision that holds at least half of those words, and two.
const contentWords = (s, drop) => [...new Set((String(s).toLowerCase().match(/[\p{L}][\p{L}\p{N}'-]{3,}/gu) || []).map((w) => w.replace(/'s$/, '').replace(/s$/, '')).filter((w) => w.length >= 4 && !drop.has(w)))];
export function sameChoice(question, decision, topic, C = {}) {
  const drop = new Set([...(C.stopWords || []), ...(topic.ask || []), ...(topic.decided || [])].flatMap((w) => String(w).toLowerCase().split(/[^\p{L}\p{N}'-]+/u)).filter(Boolean).map((w) => w.replace(/s$/, '')));
  const q = contentWords(question, drop);
  if (q.length < (C.minChoiceWords || 2)) return true;
  const d = new Set(contentWords(decision, new Set()));
  const shared = q.filter((w) => d.has(w)).length;
  return shared >= (C.minShared || 2) && shared / q.length >= (C.minShare || 0.5);
}
// The first topic a question touches that a saved decision already settles. Returns null, or what to quote.
export function answeredBy(questions, lines, topics, quoteAtMost = 2, C = {}) {
  for (const t of topics || []) {
    for (const q of questions.filter((s) => hasAny(s, t.ask))) {
      const hits = lines.filter((l) => hasAny(l.text, t.decided) && sameChoice(q, l.text, t, C));
      if (hits.length) return { topic: t.name, question: q, quotes: hits.slice(0, quoteAtMost) };
    }
  }
  return null;
}
const quoteLine = (l) => (l.date ? `${l.date}: "${short(l.text, 220)}"` : `in force: "${short(l.text, 220)}"`);

// Questions already answered in the person's own words, read from the list the questions program keeps
// (core/engine/questions.mjs; its file is system/questions.json). Each comes with the other wordings it was asked in.
export function answeredQuestions(jsonText) {
  let d = null;
  try { d = JSON.parse(String(jsonText || '')); } catch { return []; }
  return ((d && Array.isArray(d.questions)) ? d.questions : [])
    .filter((q) => q && q.state === 'answered' && q.answer && q.answer.words)
    .map((q) => ({ id: q.id, texts: [q.text, q.original, ...(q.also || [])].filter(Boolean).map(String), words: String(q.answer.words), on: q.answer.on || '' }));
}
// A question that one of them already answers: enough of its long words (the same reading as the questions program)
// appear in one wording of the answered question. Returns null, or the answered question.
export function alreadyAnswered(questions, answered, R = {}) {
  const minLen = R.minWordLength || 5, minShared = R.minShared || 3, minShare = R.minShare || 0.5;
  const long = (s) => qWords(s).filter((w) => w.length >= minLen);
  // Each wording is read once, and each question once, however often it is repeated in a reply.
  const prior = [];
  for (const a of answered || []) for (const t of a.texts) prior.push({ a, t, set: new Set(long(t)) });
  for (const q of [...new Set(questions || [])]) {
    const qw = long(q);
    if (qw.length < minShared) continue;
    for (const p of prior) {
      const hit = qw.filter((w) => p.set.has(w)).length;
      if (hit >= minShared && hit / qw.length >= minShare) return { question: q, prior: p.a, asked: p.t };
    }
  }
  return null;
}
const quoteAnswer = (a) => `${a.id}${a.on ? `, answered ${a.on}` : ''}: "${short(a.words, 160)}"`;

// A rule, wish, decision or correction the person stated: the sentences that carry one. A question of theirs does not count,
// unless it is a correction ("why didn't you, I told you ...?").
export function wishSentences(text, W) {
  const weak = new Set((W.weakWords || []).map((w) => String(w).toLowerCase()));
  return sentences(text).filter((raw) => {
    const s = raw.replace(/\bnever ?mind\b/gi, ' ');
    const hits = (W.words || []).filter((w) => hasAny(s, [w]));
    if (!hits.length) return false;
    // "always" or "never" alone ("it always crashes") is not a wish: it needs a word that speaks to Claude or the work.
    if (hits.every((w) => weak.has(String(w).toLowerCase())) && !hasAny(s, W.weakNeedsOneOf)) return false;
    return !/\?\s*$/.test(s) || hasAny(s, W.questionWords);
  });
}

// The files written in this turn, as paths inside the notebook, lower case with forward slashes.
// ctx.events may be a list of records, or an object with a "files" list; both shapes are read.
const WRITE_TOOLS = /^(write|edit|multiedit|notebookedit)$/i;
const SHELL_WRITE = /(?:>>?|\badd-content\b(?:\s+-path)?|\bset-content\b(?:\s+-path)?|\bout-file\b(?:\s+-filepath)?|\btee\b(?:\s+-a)?|\bsed\s+-i\b(?:\s+'[^']*'|\s+"[^"]*"|\s+\S+)?)\s*['"]?([^\s'"|;&<>]+\.(?:md|json))\b/gi;
export function writtenPaths(events, root) {
  const rootN = String(root || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  const rel = (p) => {
    let n = String(p).replace(/\\/g, '/').toLowerCase();
    if (rootN && n.startsWith(rootN + '/')) n = n.slice(rootN.length + 1);
    return n.replace(/^\.\//, '');
  };
  const out = [];
  const list = Array.isArray(events) ? events : (events && Array.isArray(events.list) ? events.list : []);
  const files = events && !Array.isArray(events) && Array.isArray(events.files) ? events.files : [];
  for (const f of files) out.push(rel(typeof f === 'string' ? f : f.path || f.file || ''));
  for (const e of list) {
    if (!e || typeof e !== 'object') continue;
    if (e.a || e.agent) continue; // written by a helper, not by this chat
    const p = e.file || e.path || e.p || (e.input && (e.input.file_path || e.input.notebook_path));
    const isWrite = e.k === 'write' || e.kind === 'write' || WRITE_TOOLS.test(String(e.tool || e.tool_name || ''));
    if (p && isWrite) out.push(rel(p));
    const cmd = e.command || (e.input && e.input.command);
    // A shell command writes a note only when the note follows a writing word (so "grep x a.md 2>/dev/null" is a read).
    if (cmd) for (const m of String(cmd).matchAll(SHELL_WRITE)) out.push(rel(m[1]));
  }
  return [...new Set(out.filter(Boolean))];
}
export function savedTo(paths, targets) {
  const t = (targets || []).map((x) => String(x).toLowerCase());
  return paths.filter((p) => t.some((x) => (x.endsWith('/') ? p.startsWith(x) || p.includes('/' + x) : p === x || p.endsWith('/' + x))));
}
export const hasSavedLine = (text) => /^\s*[*_>-]*\s*saved\s*[*_]*\s*:/im.test(String(text || ''));
export const hasNotARuleLine = (text) => /^\s*[*_>-]*\s*not (saved|a rule)\s*[*_]*\s*:/im.test(String(text || ''));

// The front door: links and attached files in their message (the same reading as the gates' own front door).
export function sentItems(text, I) {
  const items = [];
  const add = (key, show) => { if (key && !items.some((x) => x.key === key)) items.push({ key, show }); };
  for (const m of String(text || '').matchAll(/https?:\/\/[^\s<>"'`)\]]+/gi)) {
    const url = m[0].replace(/[.,;:!?]+$/, '');
    let host = '';
    try { host = new URL(url).hostname.toLowerCase(); } catch { continue; }
    if ((I.ignoreHosts || []).includes(host)) continue;
    add(url.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/+$/, '').toLowerCase(), url);
  }
  for (const m of String(text || '').matchAll(/[\\/]uploads[\\/][^\s"'<>|]*?([^\\/\s"'<>|]+\.(pdf|docx?|pptx?|xlsx?|csv|txt|md|epub|zip|mp4|mov|mp3|wav|m4a|png|jpe?g|gif|webp))\b/gi)) {
    const name = m[1].replace(/^[0-9a-f]{8}-/i, '');
    add(name.toLowerCase().replace(/\.[a-z0-9]+$/, '').slice(0, 40), name);
  }
  return items.slice(0, I.maxItems || 12);
}
export const notLogged = (items, listText) => { const l = String(listText || '').toLowerCase(); return (items || []).filter((x) => !l.includes(x.key)); };

// Lessons that nothing real has closed, older than the given number of days (an undated lesson is old).
export function owedLessons(lessonsText, root, day, olderThanDays = 1) {
  return parseLessons(String(lessonsText || '').replace(/\r\n/g, '\n'))
    .filter((l) => !l.date || dayNumber(day) - dayNumber(l.date) >= olderThanDays)
    .map((l) => ({ ...l, verdict: judge(l, root) }))
    .filter((l) => l.verdict);
}

// ---------- this chat's record (in the Hive folder) ----------
const sid = (ev) => String((ev && (ev.session_id || ev.sessionId)) || 'no-session').replace(/[^\w.-]/g, '_').slice(0, 80);
function statePath(ctx, ev) { return ctx && ctx.state ? path.join(ctx.state, 'checks', ID, sid(ev) + '.json') : null; }
function loadState(ctx, ev) {
  const p = statePath(ctx, ev);
  try { return { sent: [], ...JSON.parse(fs.readFileSync(p, 'utf8')) }; } catch { return { sent: [] }; }
}
function saveState(ctx, ev, st) {
  const p = statePath(ctx, ev);
  if (!p) return;
  try { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(st)); } catch (e) { ctx.log && ctx.log('state-unwritten', { check: ID, message: String(e && e.message) }); }
}

// ---------- the steps ----------
function prompt(ev, ctx) {
  if (ctx.isHelperChat) return null;
  const st = loadState(ctx, ev);
  const F = conf(ctx, 'frontDoor');
  // Only the person's own words: links in a helper's report or a task notice are not things they sent (2026-11-20).
  const items = sentItems(ctx.hisNow === false ? '' : (ctx.hisLast != null && ctx.hisNow !== undefined ? ctx.hisLast : (ev.text != null ? ev.text : ev.prompt)), F);
  for (const it of items) if (!st.sent.some((x) => x.key === it.key)) st.sent.push({ ...it, at: Date.now() });
  st.last = items.map((x) => x.key);
  const says = [];
  if (!st.started) {
    st.started = Date.now();
    const L = conf(ctx, 'lessons');
    const owed = owedLessons(readNote(ctx, L.file || 'system/lessons.md'), ctx.root, today(ctx), L.olderThanDays ?? 1);
    if (owed.length) {
      const shown = owed.slice(0, L.maxShown || 6).map((l) => `- ${l.date || 'undated'}, line ${l.line}: ${short(l.text, 120)} (${l.verdict.kind})`);
      says.push(`NEVER TWICE (rule 7): ${owed.length} lesson${owed.length === 1 ? ' is' : 's are'} older than a day and not closed by anything real (a check, a helper or a rule that exists). A lesson is closed only by a change. Close one in this chat when the work touches it, or write in the in-flight note what will close it:\n${shown.join('\n')}${owed.length > shown.length ? `\n- and ${owed.length - shown.length} more (node core/engine/lessons.mjs lists them all)` : ''}`);
    }
  }
  saveState(ctx, ev, st);
  return says.length ? { say: says.join('\n\n') } : null;
}

function questionCardText(input) {
  const qs = (input && Array.isArray(input.questions)) ? input.questions : [];
  return qs.map((q) => String((q && (q.question || q.header)) || '')).filter(Boolean)
    .map((s) => (/\?\s*$/.test(s) ? s : s + '?'));
}

function pretool(ev, ctx) {
  const tool = String(ev.tool || ev.tool_name || '');
  const input = ev.input || ev.tool_input || {};
  // 1. A question card about something a saved decision already answers.
  if (/^askuserquestion$/i.test(tool) && !ctx.isHelperChat && !hasAny(JSON.stringify(input), conf(ctx, 'askedAgain').coverWords)) {
    const A = conf(ctx, 'askedAgain');
    const qs = questionCardText(input);
    const lines = decisionLines(readNote(ctx, A.decisions || 'system/decisions.md'), readNote(ctx, A.inForce || 'system/decisions-in-force.md'));
    const hit = answeredBy(qs, lines, A.topics, A.quoteAtMost, A.sameChoice);
    if (hit) {
      return { deny: `Stopped: this question asks ${WHO.him} about ${hit.topic} ("${short(hit.question, 120)}"), and a saved decision already answers it: ${hit.quotes.map(quoteLine).join('; ')}. Rule 7: ${WHO.he} never has to say a thing twice. Act on that decision; if it truly does not cover this case, say in the question itself, in one sentence, why not, and quote the decision.` };
    }
    const R = conf(ctx, 'answered');
    const got = alreadyAnswered(qs, answeredQuestions(readNote(ctx, R.file || 'system/questions.json')), R);
    if (got) {
      return { deny: `Stopped: this question ("${short(got.question, 120)}") was already answered by ${WHO.him} (${quoteAnswer(got.prior)}). Rule 7: ${WHO.he} never has to say a thing twice. Act on that answer; if it truly does not cover this case, say in the question itself, in one sentence, why not, and quote the answer.` };
    }
  }
  // 2. The end of a piece of work while something the person sent is missing from the list.
  if (ctx.isHelperChat) return null;
  const F = conf(ctx, 'frontDoor');
  const skill = String(input.skill || input.name || '').split(':').pop().toLowerCase();
  const cmd = String(ev.command || input.command || '');
  const ending = (/^skill$/i.test(tool) && (F.endSkills || []).includes(skill))
    || (cmd && (F.endCommands || []).some((p) => new RegExp(p, 'i').test(cmd)));
  if (!ending) return null;
  const st = loadState(ctx, ev);
  const waiting = notLogged(st.sent, readNote(ctx, F.list || 'inbox/sources.md'));
  if (!waiting.length) return null;
  return { deny: `Stopped: the piece of work cannot end while ${waiting.length === 1 ? 'something' : waiting.length + ' things'} ${WHO.he} sent in this chat ${waiting.length === 1 ? 'is' : 'are'} missing from ${WHO.list} (${F.list}): ${waiting.slice(0, 4).map((x) => x.show).join(', ')}. Add one line for each with the hive-intake skill (waiting, used, or "set aside: why"), then end the work.` };
}

function stop(ev, ctx) {
  if (ctx.isHelperChat) return null;
  const text = String(ev.text != null ? ev.text : ev.last_assistant_message || '');
  const st = loadState(ctx, ev);
  const faults = [];
  const paths = writtenPaths(ctx.events, ctx.root);

  // 1. Asked again.
  const A = conf(ctx, 'askedAgain');
  const qs = directedQuestions(text, A.askWords);
  if (qs.length && !hasAny(text, A.coverWords)) {
    const lines = decisionLines(readNote(ctx, A.decisions || 'system/decisions.md'), readNote(ctx, A.inForce || 'system/decisions-in-force.md'));
    const hit = answeredBy(qs, lines, A.topics, A.quoteAtMost, A.sameChoice);
    if (hit) faults.push(`it asks ${WHO.him} about ${hit.topic} ("${short(hit.question, 120)}"), and a saved decision already answers it: ${hit.quotes.map(quoteLine).join('; ')}. Act on that decision without asking again, or say in one sentence why it does not cover this case`);
  }
  // 1b. Asked again what was already answered in the person's own words (the list of questions).
  const asks = sentences(text).filter((s) => /\?\s*[*_)]*\s*$/.test(s));
  if (asks.length && !hasAny(text, A.coverWords)) {
    const R = conf(ctx, 'answered');
    const got = alreadyAnswered(asks, answeredQuestions(readNote(ctx, R.file || 'system/questions.json')), R);
    if (got) faults.push(`it asks ${WHO.him} again "${short(got.question, 120)}", which ${WHO.he} already answered (${quoteAnswer(got.prior)}). Act on that answer without asking again, or say in one sentence why it does not cover this case`);
  }

  // 2. A rule, wish, decision or correction the person stated, not written to the notes in the same turn. It stays owed.
  const W = conf(ctx, 'wish');
  const wishes = wishSentences(ctx.hisLast || '', W);
  const savedNow = savedTo(paths, W.saveTargets).length > 0;
  if (savedNow || hasNotARuleLine(text)) st.pending = null;
  else if (wishes.length) st.pending = { text: short(wishes[0], 200), at: Date.now() };
  if (st.pending) faults.push(`${WHO.he} said "${st.pending.text}", and nothing was written to the notes for it. Save it now with the hive-capture skill (a rule, a decision, a lesson or a standing wish, in its one home) and say "Saved: ..." in one line; if it is not a rule or a wish at all, write one line that starts "Not a rule:" and says why`);

  // 3. The notes were saved, and the reply does not say so.
  const S = conf(ctx, 'savedLine');
  const saved = savedTo(paths, S.targets);
  if (saved.length && !hasSavedLine(text)) faults.push(`this turn saved to the notes (${saved.slice(0, 3).join(', ')}), and the reply has no "Saved: ..." line; add one line that starts with "Saved:" and says in plain words what was kept`);

  // 4. Something the person sent in their last message that is not in the list.
  const F = conf(ctx, 'frontDoor');
  // What their last message carried: read from it directly (so it holds even if the prompt step did not run), plus
  // what the prompt step recorded for it.
  const lastItems = [...sentItems(ctx.hisLast || '', F), ...(st.sent || []).filter((x) => (st.last || []).includes(x.key))]
    .filter((x, i, all) => all.findIndex((y) => y.key === x.key) === i);
  const waiting = notLogged(lastItems, readNote(ctx, F.list || 'inbox/sources.md'));
  if (waiting.length) faults.push(`${WHO.he} sent ${waiting.length === 1 ? 'something' : waiting.length + ' things'} that ${waiting.length === 1 ? 'is' : 'are'} not in ${WHO.list} (${waiting.slice(0, 3).map((x) => x.show).join(', ')}). Add a line for each with the hive-intake skill and tell ${WHO.him} in one sentence that it is kept`);

  saveState(ctx, ev, st);
  if (!faults.length) return { clear: [DEBT_KEY] };
  return { debt: { key: DEBT_KEY, text: `Rule 7 (never twice): ${faults.join('. Also, ')}.` } };
}

// On its own error a discipline check lets the step through and logs.
function guarded(name, fn) {
  return (ev, ctx) => {
    try {
      if (!ctx || !ctx.root) throw new Error('no context was given, so nothing could be checked');
      return fn(ev || {}, ctx);
    } catch (e) {
      try { ctx && ctx.log && ctx.log('error', { check: ID, step: name, message: String((e && e.message) || e).slice(0, 200) }); } catch {}
      return null;
    }
  };
}

export default {
  id: ID,
  rule: 'rule 7',
  kind: 'discipline',
  mode: 'refuse',
  about: 'Never ask twice, save what is said the moment it is said, keep lessons honest, and let nothing sent live only in a chat.',
  steps: { prompt: guarded('prompt', prompt), pretool: guarded('pretool', pretool), stop: guarded('stop', stop) },
};
