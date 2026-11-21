// The five standing protocols, held by a program. How a check is shaped: core/checks/README.md.
//  1. A question to the person is asked with the app's question card, never in a paragraph          -> debt "question-format"
//  2. An update that reports progress opens with the bars printed by core/engine/progress.mjs
//     from counted steps, then one line per thing they asked for, then "Needs you:"            -> debt "sitrep", which
//     stays until a reply carries a correct sitrep, so a second reply without one blocks work
//  3. "Finished", "ready" or "perfect" said of a part needs a PASS from the checker on record -> debt "unproven-finished"
//  4. A recap that leaves out a line of the log or a decision of its period may not be called finished: the write that
//     marks it finished is refused, and a reply that calls it finished is a debt              -> "recap-unfinished"
//  5. Work that changed files ends with no learning note of the day in the learned note      -> one reminder (say)
// The recap comparison itself is recap-compare.mjs, next to this file.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { render, load as loadProgress, checkDisplay } from '../../engine/progress.mjs';
import { compare, notebookInputs, periodOf, stems } from './recap-compare.mjs';
import { judgedText, requestNames } from '../_lib/reply-parts.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
let DEFAULTS = {};
try { DEFAULTS = JSON.parse(fs.readFileSync(path.join(HERE, 'settings.json'), 'utf8')); } catch { DEFAULTS = {}; }
const WHO = 'the person';
const ID = 'his-protocols';

const conf = (ctx) => ({ ...DEFAULTS, ...((ctx && ctx.settings) || {}) });
const slash = (p) => String(p || '').replace(/\\/g, '/');
const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const phraseRe = (list) => new RegExp(`(?:^|[^a-z'])(?:${(list || []).map(esc).join('|')})(?![a-z])`, 'i');
const cut = (s, n = 120) => { const t = String(s).replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 3) + '...' : t; };
const overlap = (a, b) => { if (!a.size) return 0; let n = 0; for (const x of a) if (b.has(x)) n++; return n / a.size; };

// ---------- reading a reply ----------
// The reply's prose: code blocks, quoted words (the person's own words, a title) and block quotes are not Claude asking or claiming.
export function prose(text) {
  return String(text || '').replace(/\r/g, '')
    .replace(/```[\s\S]*?(```|$)/g, '\n')
    .replace(/`[^`\n]*`/g, ' ')
    .replace(/"[^"\n]*"|“[^”\n]*”/g, ' ')
    .split('\n').filter((l) => !/^\s*>/.test(l)).join('\n');
}
const sentences = (text) => prose(text).split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);

// ---------- 1. a question in a paragraph ----------
export function proseQuestions(text, c) {
  const starts = new Set((c.askStarts || []).map((w) => w.toLowerCase()));
  const you = phraseRe(c.secondPerson);
  return sentences(text).filter((s) => {
    if (!s.endsWith('?')) return false;
    const body = s.replace(/^[\s*_#>\-\d.)]+/, '');
    const first = (body.match(/^[A-Za-z']+/) || [''])[0].toLowerCase();
    return starts.has(first) || you.test(body);
  });
}
function cardRecordPath(ctx) { return ctx.state ? path.join(ctx.state, 'checks', ID, 'cards.json') : ''; }
function readCards(ctx) { const f = cardRecordPath(ctx); if (!f) return {}; try { return JSON.parse(fs.readFileSync(f, 'utf8')) || {}; } catch { return {}; } }
const eventsOf = (ctx) => (Array.isArray(ctx && ctx.events) ? ctx.events : []);
const toolOf = (e) => e.tool || e.tool_name || e.name || '';
function cardQuestionsThisTurn(ev, ctx, c) {
  const ran = eventsOf(ctx).filter((e) => toolOf(e) === 'AskUserQuestion' && e.ok !== false);
  const sid = ev.session_id || ctx.sid || '';
  const rec = (readCards(ctx)[sid] || []).filter((x) => Date.now() - x.t < (c.cardHours || 2) * 3600e3);
  const since = ran.length ? Math.min(...ran.map((e) => e.t || Date.now())) - 5000 : Infinity;
  const texts = rec.filter((x) => x.t >= since).flatMap((x) => x.questions);
  return { ran: ran.length > 0, texts };
}
// The open questions of the questions list (core/engine/questions.mjs keeps it in system/questions.json). A sitrep's
// "Needs you:" line names them word for word; there that is a listing of the list, not a new question.
function openListed(ctx) {
  try {
    const d = JSON.parse(fs.readFileSync(path.join(ctx.root, 'system', 'questions.json'), 'utf8'));
    return (d.questions || []).filter((q) => q.state === 'open').map((q) => stems(q.text));
  } catch { return []; }
}
function questionFaults(ev, ctx, c) {
  const needsLine = String(ev.text || '').split('\n').filter((l) => /^\s*[-*•]?\s*\**needs you\**\s*:/i.test(l)).join('\n');
  const listed = needsLine ? openListed(ctx) : [];
  const onList = (q) => needsLine.includes(q.replace(/^[-*•\s]*\**needs you\**\s*:\s*/i, '').slice(0, 40)) && listed.some((s) => overlap(s, stems(q)) >= (c.cardMatch || 0.6));
  const qs = proseQuestions(ev.text, c).filter((q) => !onList(q));
  if (!qs.length) return [];
  const cards = cardQuestionsThisTurn(ev, ctx, c);
  const cardStems = cards.texts.map((t) => stems(t));
  const loose = qs.filter((q) => { const s = stems(q); return !cardStems.some((cs) => overlap(s, cs) >= (c.cardMatch || 0.6)); });
  return loose;
}

// ---------- 2. the sitrep ----------
const STATE_LINE = (c) => new RegExp(`^[^:\\n]{2,90}:\\s*(?:${(c.stateWords || []).map(esc).join('|')})\\b`, 'i');
export function isProgressReport(text, ctx, c) {
  const t = String(text || '');
  if (ctx && typeof ctx.said === 'function' && !ctx.isHelperChat && ctx.said(c.askedForStatus || [])) return true;
  if (/[█░▓▒■□▰▱]{4,}/.test(t) || /\[[#=\-.\s|]{6,}\]/.test(t) || /(^|\s)\d{1,3}\s?%(?![a-z])/i.test(prose(t))) return true;
  if (/^\s*[-*•]?\s*\**(needs you|map|progress)\**\s*:/im.test(t)) return true; // a sitrep's last line, or the old row of steps
  const lines = prose(t).split('\n');
  if (lines.filter((l) => STATE_LINE(c).test(l.replace(/^[\s*\-\d.)]+/, ''))).length >= 2) return true;
  if (new RegExp(`\\b\\d+\\s+of\\s+\\d+\\s+(?:${(c.progressUnits || []).map(esc).join('|')})\\b`, 'i').test(t)) return true;
  const hits = (c.progressPhrases || []).filter((p) => phraseRe([p]).test(prose(t))).length;
  return hits >= 2;
}
const NEEDS = /^\s*[-*•]?\s*\**needs you\**\s*:/im;
const normLines = (s) => String(s).replace(/\r/g, '').split('\n').map((l) => l.replace(/\s+$/, '')).join('\n').replace(/^\n+|\n+$/g, '');

// The faults of a progress report against the protocol, or [] when it is right.
export function sitrepFaults(text, list, c) {
  const faults = [];
  const t = String(text || '').replace(/\r/g, '');
  const wanted = normLines(render(list));
  const items = (list && list.items) || [];
  if (!items.length) faults.push('the list of what was asked for is empty, so there is nothing counted to show: start it with "node core/engine/progress.mjs new" and "add" for each thing asked for');
  const m = t.match(/^\s*```[^\n]*\n([\s\S]*?)\n\s*```/);
  if (!m) {
    faults.push(`it does not open with the progress bars in a fixed-width block, printed by "${c.progressCommand}"`);
  } else {
    const block = normLines(m[1]);
    const wrong = checkDisplay(block);
    if (wrong.length) faults.push(`its bars do not match their own numbers (${wrong.join('; ')})`);
    else if (block !== wanted) faults.push(`its bars are not the ones the program prints now from the counted steps (typed by hand, or out of date): paste the output of "${c.progressCommand}" as it is`);
  }
  const after = m ? t.slice(m.index + m[0].length) : t;
  const lines = prose(after).split('\n').filter((l) => l.trim());
  const missing = items.filter((it) => {
    const s = stems(it.name);
    return !lines.some((l) => l.includes(':') && (l.toLowerCase().includes(String(it.name).toLowerCase()) || overlap(s, stems(l.split(':')[0])) >= (c.itemMatch || 0.6) || overlap(s, stems(l)) >= 0.8));
  });
  if (missing.length) faults.push(`it has no bullet "- <thing>: <state>" for ${missing.map((it) => `"${cut(it.name, 60)}"`).join(', ')}`);
  if (!NEEDS.test(after)) faults.push('it has no bullet "- Needs you:" after the bullets for each thing (say "- Needs you: nothing." when nothing does)');
  // His order of 2026-11-20: "Sitrep needs to be in bullet points so it's more understandable to read".
  const thingLines = lines.filter((l) => STATE_LINE(c).test(l.replace(/^[\s*\-•\d.)]+/, '')) || /^\s*[-*•]?\s*\**needs you\**\s*:/i.test(l));
  const plain = thingLines.filter((l) => !/^\s*[-*•]\s+/.test(l));
  if (plain.length) faults.push(`${plain.length === 1 ? 'a line' : plain.length + ' lines'} for the things they asked for ${plain.length === 1 ? 'is' : 'are'} not a bullet point ("${cut(plain[0], 50)}"): a sitrep has one bullet per thing ("- <thing>: <state>. <what comes next>") and a bullet "- Needs you: ..."`);
  // Bars anywhere else in the reply must be right too: a hand-made bar is never a progress line.
  if (m) { const rest = checkDisplay(after); if (rest.length) faults.push(`a bar later in the reply does not match its number (${rest.join('; ')})`); }
  return faults;
}

// ---------- 3. "finished", "ready", "perfect" with no PASS ----------
export function passRecords(ctx, c) {
  const dir = ctx.state ? path.join(ctx.state, c.verifyFolder || 'verify') : '';
  const out = [];
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return out; }
  for (const n of names) {
    let text = '';
    try { text = fs.readFileSync(path.join(dir, n, 'result.md'), 'utf8'); } catch { continue; }
    if (!/\*\*Verdict:\s*PASS\*\*/.test(text)) continue;
    const title = (text.match(/^#\s*Check:\s*(.+)$/m) || ['', ''])[1];
    out.push({ run: n, title, stems: stems(title + ' ' + n.replace(/^\d{4}-\d{2}-\d{2}_/, '').replace(/[-_]/g, ' ')) });
  }
  return out;
}
export function finishedClaims(text, c) {
  const word = new RegExp(`\\b(${(c.finishedWords || []).map(esc).join('|')})\\b`, 'i');
  const not = phraseRe(c.notAClaim);
  const self = phraseRe(c.selfReady);
  const out = [];
  for (const s of sentences(text)) {
    if (s.endsWith('?') || self.test(s)) continue;
    const m = s.match(word);
    if (!m) continue;
    const before = s.slice(0, m.index).split(/\s+/).slice(-6).join(' ');
    const after1 = s.slice(m.index + m[0].length).split(/\s+/).slice(0, 2).join(' ');
    if (not.test(' ' + before + ' ') || /^\s*(yet|\?)/i.test(after1)) continue;
    out.push(s);
  }
  return out;
}

// ---------- 4. the recap ----------
const recapRe = (c) => new RegExp(c.recapFile || '^system/recap-\\d{4}-\\d{2}-\\d{2}\\.md$', 'i');
const markedFinished = (text, c) => (c.recapFinishedMarks || []).some((p) => new RegExp(p, 'im').test(String(text || '')));
function relInRoot(file, ctx, cwd) {
  const abs = path.resolve(cwd || ctx.root, String(file || ''));
  const rel = slash(path.relative(ctx.root, abs));
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel : '';
}
function newContent(ev, abs) {
  const input = ev.input || ev.tool_input || {};
  const tool = ev.tool || ev.tool_name;
  if (tool === 'Write') return String(input.content || '');
  let cur = '';
  try { cur = fs.readFileSync(abs, 'utf8'); } catch { cur = ''; }
  const edits = tool === 'MultiEdit' ? input.edits || [] : [input];
  for (const e of edits) {
    if (typeof e.old_string !== 'string') continue;
    cur = e.replace_all ? cur.split(e.old_string).join(String(e.new_string || '')) : cur.replace(e.old_string, () => String(e.new_string || ''));
  }
  return cur;
}
export function compareRecap(ctx, rel, text) {
  const period = periodOf(text, path.basename(rel));
  if (!period) return { error: 'its period is not known' };
  const nb = notebookInputs(ctx.root, period);
  return compare({ recap: text, recapName: path.basename(rel), logs: nb.logs, decisions: nb.decisions, settings: conf(ctx).recapSettings || {} });
}
function latestRecap(ctx, c) {
  let names = [];
  try { names = fs.readdirSync(path.join(ctx.root, 'system')); } catch { return ''; }
  const re = recapRe(c);
  const list = names.map((n) => 'system/' + n).filter((r) => re.test(r)).sort();
  return list.length ? list[list.length - 1] : '';
}
function missingText(r, rel) {
  if (r.error) return `${rel} could not be compared (${r.error})`;
  const all = [...r.missingLog.map((e) => `log ${e.date} ${e.time}: ${cut(e.text, 80)}`), ...r.missingDecisions.map((d) => `decision ${d.date}: ${cut(d.text, 80)}`)];
  return `${rel} leaves out ${all.length} (${r.missingLog.length} log lines, ${r.missingDecisions.length} decisions of its period): ${all.slice(0, 6).join(' | ')}${all.length > 6 ? ` | and ${all.length - 6} more` : ''}`;
}
const recapClaim = (s) => /\brecaps?\b/i.test(s) && /\b(finished|complete|completed|done|ready|final)\b/i.test(s);

// ---------- 5. the learning note ----------
// At the end of a piece of work that changed files, when the notebook holds no learning note for today, one reminder is
// put in front of Claude (at the person's next message, as every word at the end of a reply is): write a few plain lines
// of what was learned into the learned note, never into the reply. Once per chat per day; nothing at any other step.
const dayOf = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function learnedRecordPath(ctx) { return ctx.state ? path.join(ctx.state, 'checks', ID, 'learned.json') : ''; }
function learnedReminder(ev, ctx, c) {
  const L = c.learned || {};
  const file = L.file || 'system/learned.md';
  const fileKey = slash(path.resolve(ctx.root, file)).toLowerCase();
  const wrote = eventsOf(ctx).filter((e) => e && e.kind === 'write' && e.path).map((e) => slash(path.resolve(String(e.path))).toLowerCase())
    .filter((p) => p !== fileKey && !(L.skipMarks || []).some((m) => p.includes(String(m).toLowerCase())));
  if (!wrote.length) return null;
  if (!phraseRe(L.endWords || ['done', 'finished']).test(prose(ev.text))) return null;
  const day = dayOf();
  const text = typeof ctx.read === 'function' ? ctx.read(file) : '';
  if (new RegExp(`^##\\s+${day}\\b`, 'm').test(text || '')) return null;
  const sid = ev.session_id || ctx.sid || '';
  const f = learnedRecordPath(ctx);
  let rec = {};
  try { rec = JSON.parse(fs.readFileSync(f, 'utf8')) || {}; } catch { rec = {}; }
  if (rec[sid] === day) return null;
  for (const k of Object.keys(rec)) if (rec[k] !== day) delete rec[k];
  rec[sid] = day;
  if (f) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(rec)); }
  if (ctx.log) ctx.log('learned-reminder', { day });
  return `HIVE (standing protocols, the learning note): the last piece of work changed files, and ${file} has no learning note for today yet. Add one under "## ${day}": what was learned, in a few plain lines. It goes in that file only, never in the reply.`;
}

// ---------- the steps ----------
export function pretool(ev, ctx) {
  try {
    const c = conf(ctx);
    const tool = ev.tool || ev.tool_name;
    if (!['Write', 'Edit', 'MultiEdit'].includes(tool)) return null;
    const input = ev.input || ev.tool_input || {};
    const rel = relInRoot(input.file_path, ctx, ev.cwd);
    if (!rel || !recapRe(c).test(rel)) return null;
    const abs = path.resolve(ctx.root, rel);
    const text = newContent(ev, abs);
    if (!markedFinished(text, c)) return null;
    const r = compareRecap(ctx, rel, text);
    if (!r.error && !r.missingLog.length && !r.missingDecisions.length) return null;
    if (ctx.log) ctx.log('recap-deny', { file: rel, missing: r.error ? -1 : r.missingLog.length + r.missingDecisions.length });
    return { deny: `HIVE CHECK (standing protocols, the whole recap): I stopped this write. It marks the recap finished, but ${missingText(r, rel)}. The protocol: everything done is mentioned in the recap. The one thing to do: add one line for each, then mark it finished again. To see the list: node core/checks/his-protocols/recap-compare.mjs ${rel}` };
  } catch (err) {
    try { ctx.log && ctx.log('error', { check: ID, step: 'pretool', message: String(err && err.message || err) }); } catch { /* nothing more */ }
    return null;
  }
}

// A question card that ran is written down with its questions, so the reply at the end of the turn can be compared
// with it. The tool's input is { questions: [{ question, header, options, multiSelect }] } (the hooks page).
export function posttool(ev, ctx) {
  try {
    const tool = ev.tool || ev.tool_name;
    if (tool !== 'AskUserQuestion') return null;
    const sid = ev.session_id || ctx.sid;
    const f = cardRecordPath(ctx);
    if (!sid || !f) return null;
    const qs = ((ev.input || ev.tool_input || {}).questions || []).map((q) => String((q && q.question) || '')).filter(Boolean);
    const rec = readCards(ctx);
    const keep = Date.now() - (conf(ctx).cardHours || 2) * 3600e3;
    for (const k of Object.keys(rec)) { rec[k] = (rec[k] || []).filter((x) => x.t > keep); if (!rec[k].length) delete rec[k]; }
    (rec[sid] ||= []).push({ t: Date.now(), questions: qs });
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, JSON.stringify(rec));
    return null;
  } catch (err) {
    try { ctx.log && ctx.log('error', { check: ID, step: 'posttool', message: String(err && err.message || err) }); } catch { /* nothing more */ }
    return null;
  }
}

// At the person's message: while a sitrep is owed, or when they ask for one, the display as the program prints it now is put in
// front of Claude, so the next report can open with it even while every other tool is refused.
export function prompt(ev, ctx) {
  try {
    if (ctx.isHelperChat) return null;
    const c = conf(ctx);
    const owed = (ctx.debts || []).some((d) => d.key === 'sitrep');
    const asked = typeof ctx.said === 'function' && ctx.said(c.askedForStatus || []);
    if (!owed && !asked) return null;
    const display = render(loadProgress(path.join(ctx.root, c.progressFile || 'system/progress.json')));
    return { say: `HIVE (standing protocols, the sitrep): ${owed ? 'a sitrep is owed. ' : ''}A report on progress opens with this display, exactly as "${c.progressCommand}" prints it now, inside a fixed-width block; then one headline sentence; then one bullet "- <thing they asked for>: <state>. <what it means>" for each thing in it; then a bullet "- Needs you: ...".\n\`\`\`\n${display}\n\`\`\`` };
  } catch (err) {
    try { ctx.log && ctx.log('error', { check: ID, step: 'prompt', message: String(err && err.message || err) }); } catch { /* nothing more */ }
    return null;
  }
}

export function stop(ev, ctx) {
  try {
    if (ctx.isHelperChat) return null;
    const c = conf(ctx);
    const who = ctx.who || WHO;
    const text = String(ev.text || '');
    const debt = [], clear = [];

    const loose = questionFaults(ev, ctx, c);
    if (loose.length) debt.push({ key: 'question-format', text: `Your reply asked ${who} in a paragraph, not with the question card: ${loose.slice(0, 3).map((q) => `"${cut(q, 90)}"`).join(' ')}. The protocol: questions for the person are asked in the question format. The one thing to do: ask it again with the AskUserQuestion tool, and leave it out of the prose.` });

    if (isProgressReport(text, ctx, c)) {
      const list = loadProgress(path.join(ctx.root, c.progressFile || 'system/progress.json'));
      const f = sitrepFaults(text, list, c);
      if (f.length) debt.push({ key: 'sitrep', auto: false, text: `Your reply reported progress, but not as a sitrep: ${f.join('; ')}. The protocol: every update that reports progress is a sitrep. The one thing to do: give the sitrep in its exact shape (the display is put in front of you at their next message). This debt stays until a reply carries a correct sitrep.` });
      else clear.push('sitrep');
    }

    // The names of what the person asked for are their words, never a claim ("Ready for the trip: in work" claims nothing).
    const claims = finishedClaims(judgedText(text, requestNames(ctx)), c);
    const recapSays = claims.filter(recapClaim);
    const partSays = claims.filter((s) => !recapClaim(s));
    if (partSays.length) {
      const passes = passRecords(ctx, c);
      const unproven = partSays.filter((s) => { const ss = stems(s); return !passes.some((p) => { let n = 0; for (const x of p.stems) if (ss.has(x)) n++; return n >= Math.min(c.passMinShared || 2, p.stems.size); }); });
      if (unproven.length) debt.push({ key: 'unproven-finished', text: `Your reply called a part finished, ready or perfect with no PASS from the checker on record for it: ${unproven.slice(0, 3).map((s) => `"${cut(s, 90)}"`).join(' ')}. The protocol: Claude proves the system, not the person; if it is not proven it is not finished. The one thing to do: run the checker (the hive-verify skill) and say its verdict, or say plainly "not proven yet".` });
    }
    if (recapSays.length || /\brecap\b[^.\n]{0,40}\b(is|now)\s+(finished|complete)\b/i.test(prose(text))) {
      const rel = latestRecap(ctx, c);
      if (rel) {
        let body = '';
        try { body = fs.readFileSync(path.join(ctx.root, rel), 'utf8'); } catch { body = ''; }
        const r = compareRecap(ctx, rel, body);
        if (r.error || r.missingLog.length || r.missingDecisions.length) debt.push({ key: 'recap-unfinished', text: `Your reply called the recap finished, but ${missingText(r, rel)}. The protocol: everything done is mentioned in the recap. The one thing to do: add what is missing, or say plainly that the recap is not finished.` });
      }
    }
    const learned = learnedReminder(ev, ctx, c);
    if (!debt.length && !clear.length && !learned) return null;
    const out = {};
    if (debt.length) out.debt = debt;
    if (clear.length) out.clear = clear;
    if (learned) out.say = learned;
    if (ctx.log && debt.length) ctx.log('his-protocols-debt', { keys: debt.map((d) => d.key).join(',') });
    return out;
  } catch (err) {
    try { ctx.log && ctx.log('error', { check: ID, step: 'stop', message: String(err && err.message || err) }); } catch { /* nothing more */ }
    return null;
  }
}

export default {
  id: ID,
  rule: 'the standing protocols: the question card, the sitrep with counted bars, proof by the checker, the whole recap, the learning note in a file',
  kind: 'discipline',
  mode: 'refuse',
  about: 'Questions for the person go in the question card, every progress report is a sitrep that opens with the counted bars, nothing is called finished without a PASS from the checker, a recap is not finished while it leaves something out, and work that changed files ends with a learning note of the day in a file (one reminder).',
  steps: { pretool, posttool, prompt, stop },
};
