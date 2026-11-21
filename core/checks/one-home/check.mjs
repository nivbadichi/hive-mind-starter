// The one-home check (rule 8: "Stale is dangerous. One home for each truth.").
// At the save step (before a Write or Edit of a living note) it refuses a save that gives a truth a second home:
// the same fact (a count, a size, a state) already stated in another living note, with the same value or a
// different one. The refusal names the first home. It only notes (does not refuse) a new line whose review day
// has passed, a pointer to a file that does not exist, a line that calls an existing file missing, and a stamp
// left behind the note's own lines. The whole-notebook list for the health check is scan.mjs.
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULTS, classify, factsIn, noteFacts, livingIndex, pointerProblems, reviewsPast, stampBehind } from './scan.mjs';

const WRITES = new Set(['Write', 'Edit', 'MultiEdit']);

function settingsOf(ctx) { return ctx && ctx.settings && Object.keys(ctx.settings).length ? { ...DEFAULTS, ...ctx.settings } : DEFAULTS; }

// The note's text after the save, or null when the save cannot be read as text.
export function afterSave(tool, input, before) {
  if (tool === 'Write') return typeof input.content === 'string' ? input.content : null;
  const edits = tool === 'MultiEdit' ? input.edits || [] : [input];
  let text = before ?? '';
  for (const e of edits) {
    if (typeof e.old_string !== 'string' || typeof e.new_string !== 'string') return null;
    if (e.old_string === '') { text = e.new_string + text; continue; }
    if (!text.includes(e.old_string)) return null; // the tool itself will fail; nothing to judge
    text = e.replace_all ? text.split(e.old_string).join(e.new_string) : text.replace(e.old_string, () => e.new_string);
  }
  return text;
}

export function addedLines(before, after) {
  const old = new Set((before || '').split(/\r?\n/));
  return after.split(/\r?\n/).filter((l) => l.trim() && !old.has(l));
}

const quote = (s) => (s.length > 90 ? s.slice(0, 87).trim() + '...' : s).trim();

export function pretool(ev, ctx) {
  const tool = ev.tool || ev.tool_name;
  if (!WRITES.has(tool)) return null;
  const input = ev.input || ev.tool_input || {};
  if (!input.file_path || !ctx || !ctx.root) return null;
  const rel = path.relative(ctx.root, path.resolve(input.file_path)).split(path.sep).join('/');
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  const settings = settingsOf(ctx);
  const kind = classify(rel, settings);
  if (!kind || kind.kind !== 'living') return null; // history (logs, dated notes) and code are not judged here

  let before = null;
  try { before = ctx.read ? ctx.read(rel) : fs.readFileSync(path.join(ctx.root, rel), 'utf8'); } catch { before = null; }
  if (tool !== 'Write' && before == null) return null;
  const after = afterSave(tool, input, before);
  if (after == null) return null;
  const added = addedLines(before, after);
  if (!added.length) return null;

  const homes = settings.homes || {};
  const refuse = [];
  const note = [];
  const seen = new Set();
  const facts = [];
  // A fact this note already stated, with the same value, is not new: an edit near it is not judged again.
  const had = new Set(before ? noteFacts(before, settings).map((f) => `${f.key}|${f.value}`) : []);
  for (const line of added) for (const f of factsIn(line, settings)) if (!seen.has(f.key) && !had.has(`${f.key}|${f.value}`)) { seen.add(f.key); facts.push([line, f]); }
  // Most saves state no fact: then the other notes are not read at all.
  const index = facts.length ? livingIndex(ctx.root, settings, { state: ctx.state || null }) : new Map();
  for (const [line, f] of facts) {
    const home = homes[f.key];
    if (typeof home === 'string' && home !== rel) {
      refuse.push(`The truth "${f.about}" has one home, ${home}; this save writes it again into ${rel} ("${quote(line)}"). Point to ${home} instead, or change it there.`);
      continue;
    }
    const others = (index.get(f.key) || []).filter((x) => x.rel !== rel);
    if (!others.length) continue;
    const first = others[0];
    const generic = f.key.startsWith('count: ');
    const words = first.value === f.value
      ? `The truth "${f.about}" already has its home in ${first.rel} (line ${first.line}); this save would give it a second home in ${rel}. Point to ${first.rel} instead of writing it again.`
      : `${first.rel} (line ${first.line}) says ${first.value} for "${f.about}"; this save would write ${f.value} into ${rel}, so two notes would disagree. Change it in ${first.rel}, its first home, and point there.`;
    (generic ? note : refuse).push(words);
  }
  const today = (ctx.today || new Date().toISOString().slice(0, 10));
  const addedText = added.join('\n');
  for (const r of reviewsPast(addedText, today, settings)) note.push(`A new line in ${rel} is already past its own review day (${r.date}): check it now, or leave the review day out.`);
  const p = pointerProblems(rel, addedText, ctx.root, settings, { skipNotesCheckScope: false });
  for (const m of p.missing) note.push(`A new line in ${rel} points to ${m.target}, which does not exist.`);
  for (const m of p.claimedMissing) note.push(`A new line in ${rel} says ${m.target} is missing, but that file exists.`);
  const s = stampBehind(after, today, settings);
  if (s) note.push(`${rel} would say it was updated on ${s.stamp}, but it speaks of ${s.newest}: bring its "Updated" line up to date in the same save.`);

  if (refuse.length) {
    if (ctx.log) ctx.log('one-home-deny', { rel, count: refuse.length });
    return { deny: `HIVE CHECK (one home, rule 8): this save was stopped. ${refuse.join(' ')}${note.length ? ' Also: ' + note.join(' ') : ''}` };
  }
  if (note.length) {
    if (ctx.log) ctx.log('one-home-note', { rel, count: note.length });
    return { say: `HIVE NOTICE (one home, rule 8): ${note.join(' ')}` };
  }
  return null;
}

// A discipline check: on its own error it lets the save through and writes the error to the log.
function guarded(step) {
  return (ev, ctx) => {
    try { return step(ev, ctx); } catch (err) {
      try { if (ctx && ctx.log) ctx.log('error', { check: 'one-home', message: String(err && err.message || err) }); } catch {}
      return null;
    }
  };
}

export default {
  id: 'one-home',
  rule: 'rule 8',
  kind: 'discipline',
  mode: 'refuse',
  about: 'A save that gives a truth a second home in the living notes is stopped, with the first home named.',
  steps: { pretool: guarded(pretool) },
};
