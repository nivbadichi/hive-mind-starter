#!/usr/bin/env node
// The recap comparison (the standing protocol: everything done is mentioned in the recap).
// It lists every line of the log and every decision of the recap's period that the recap does not mention. While it
// lists anything, the recap may not be called finished: the his-protocols check (the standing protocols) refuses the write that marks it
// finished, and makes a reply that calls it finished a debt.
//
//   node core/checks/his-protocols/recap-compare.mjs <recap.md> [--log <log/day.md>]... [--decisions <decisions.md>]
//        [--from YYYY-MM-DD] [--to YYYY-MM-DD]
//
// With no --log, the log files of the period are taken from the notebook's log folder; with no --decisions,
// system/decisions.md. The period is --from/--to, else a "period: <date> to <date>" line in the recap, else the
// date in the recap's file name. Exit 0: nothing missing. Exit 1: something missing (each listed). Exit 2: it could
// not compare (a file missing, no period).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const STOP = new Set(('the and for with that this from into were was are has have had his her him you your yours its ' +
  'they them their there then than when what which who whom will would shall should could can may might must also only ' +
  'each every both after before over under about while because being been here very much many more most some such just ' +
  'like make made making does doing done dont lead leads chat chats claude hive mind said says say now not all one two ' +
  'three four five six seven eight nine ten first last next today tonight same other others own way ways part parts ' +
  'given gives give got still yet till until again ever even well thing things line lines note notes step steps').split(' '));

// A crude stem: lower case, letters and digits only, the common endings cut, at most seven letters. Good enough to
// see that "installed" and "installs" are one word; it is not meant to be clever.
export function stems(text) {
  const out = new Set();
  for (let w of String(text || '').toLowerCase().replace(/[’']/g, '').split(/[^a-z0-9]+/)) {
    if (w.length < 4 || STOP.has(w) || /^\d+$/.test(w)) continue;
    w = w.replace(/(ations|ation|ings|ing|edly|ers|ies|ied|ed|es|s)$/, '');
    if (w.length < 3) continue;
    out.add(w.slice(0, 7));
  }
  return out;
}
const shared = (a, b) => { let n = 0; for (const x of a) if (b.has(x)) n++; return n; };

// ---------- reading the three kinds of file ----------
export function parseLog(text, fileName = '') {
  const t = String(text || '').replace(/^﻿/, '');
  const head = t.match(/^#\s*(\d{4}-\d{2}-\d{2})/m);
  const fromName = String(fileName).match(/(\d{4}-\d{2}-\d{2})/);
  const date = head ? head[1] : fromName ? fromName[1] : '';
  const out = [];
  for (const line of t.split(/\r?\n/)) {
    const m = line.match(/^\s*[-*]\s*(\d{1,2}:\d{2})\s*\|\s*([^|]*?)\s*\|\s*(.+?)\s*$/);
    if (m) out.push({ date, time: m[1].padStart(5, '0'), project: m[2], text: m[3] });
  }
  return out;
}
export function parseDecisions(text) {
  const out = [];
  for (const line of String(text || '').replace(/^﻿/, '').split(/\r?\n/)) {
    if (!/^\|\s*\d{4}-\d{2}-\d{2}\s*\|/.test(line)) continue;
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    out.push({ date: cells[0], text: cells[1] || '', words: cells.slice(2).join(' | ') });
  }
  return out;
}
export function periodOf(recapText, recapName, from, to) {
  if (from || to) return { from: from || to, to: to || from };
  const m = String(recapText || '').match(/^\s*period:\s*(\d{4}-\d{2}-\d{2})\s*(?:to|-|–|until)\s*(\d{4}-\d{2}-\d{2})/im);
  if (m) return { from: m[1], to: m[2] };
  const n = String(recapName || '').match(/(\d{4}-\d{2}-\d{2})/);
  return n ? { from: n[1], to: n[1] } : null;
}
const inPeriod = (date, p) => !!date && date >= p.from && date <= p.to;

// ---------- the comparison ----------
// The recap's own lines, each with the times it names and its word stems. Code blocks are skipped.
function recapLines(text) {
  const out = [];
  let code = false;
  for (const raw of String(text || '').replace(/^﻿/, '').split(/\r?\n/)) {
    if (/^\s*```/.test(raw)) { code = !code; continue; }
    if (code || !raw.trim()) continue;
    const lead = raw.match(/^\s*(?:[-*]\s*|\d+[.)]\s*)?(?:\*\*)?(\d{1,2}:\d{2})\b/);
    out.push({ raw, leadTime: lead ? lead[1].padStart(5, '0') : '', times: (raw.match(/\b\d{1,2}:\d{2}\b/g) || []).map((x) => x.padStart(5, '0')), stems: stems(raw), used: false });
  }
  return out;
}

// One recap line answers for one log line at most: two log lines at 19:59 need two recap lines at 19:59.
function matchLog(entries, lines, c) {
  const missing = [];
  const byTime = new Map();
  for (const e of entries) { if (!byTime.has(e.time)) byTime.set(e.time, []); byTime.get(e.time).push(e); }
  for (const [time, group] of byTime) {
    const pairs = [];
    group.forEach((e, gi) => {
      const es = stems(e.text);
      lines.forEach((l, li) => {
        if (l.used) return;
        const s = shared(es, l.stems);
        // A line that starts with the time is an entry for it; a line that only names the time in passing must also
        // share words with it.
        if (l.leadTime === time) pairs.push({ gi, li, score: 1000 + s });
        else if (l.times.includes(time) && s >= c.minShared) pairs.push({ gi, li, score: s });
      });
    });
    pairs.sort((a, b) => b.score - a.score);
    const gotG = new Set();
    for (const p of pairs) {
      if (gotG.has(p.gi) || lines[p.li].used) continue;
      gotG.add(p.gi); lines[p.li].used = true;
    }
    group.forEach((e, gi) => { if (!gotG.has(gi)) missing.push(e); });
  }
  return missing;
}

// A decision is mentioned when a recap line shares enough of its words. Lines already used for a log entry may also
// speak for a decision: one event and the decision it made are often the same line.
function matchDecisions(decisions, lines, c) {
  const pairs = [];
  const ds = decisions.map((d) => stems(d.text));
  decisions.forEach((d, di) => lines.forEach((l, li) => {
    const s = shared(ds[di], l.stems);
    const share = l.stems.size ? s / l.stems.size : 0;
    if (s >= c.decisionMinShared && share >= c.decisionMinShare) pairs.push({ di, li, score: s + share });
  }));
  pairs.sort((a, b) => b.score - a.score);
  const gotD = new Set(), gotL = new Set();
  for (const p of pairs) { if (gotD.has(p.di) || gotL.has(p.li)) continue; gotD.add(p.di); gotL.add(p.li); }
  return decisions.filter((_, di) => !gotD.has(di));
}

// minShared: words a line that only names a log line's time in passing must share with it. decisionMinShared and
// decisionMinShare: words a recap line must share with a decision, and the part of the recap line's own words they
// make up. Each decision written in one line of its own passes; a passing mention of a few common words does not.
export const DEFAULTS = { minShared: 2, decisionMinShared: 4, decisionMinShare: 0.3 };

/**
 * recap: text; recapName: its file name (for the period); logs: [{ name, text }]; decisions: text or '';
 * from/to: the period, optional. Returns { period, missingLog, missingDecisions, outside, counted } or { error }.
 */
export function compare({ recap, recapName = '', logs = [], decisions = '', from, to, settings = {} }) {
  const c = { ...DEFAULTS, ...settings };
  const period = periodOf(recap, recapName, from, to);
  if (!period) return { error: 'the recap\'s period is not known: give --from and --to, or a "period:" line, or a date in its file name' };
  const outside = [];
  let entries = [];
  for (const l of logs) {
    const got = parseLog(l.text, l.name);
    const kept = got.filter((e) => inPeriod(e.date, period));
    if (got.length && !kept.length) outside.push(l.name || got[0].date);
    entries = entries.concat(kept);
  }
  const decs = parseDecisions(decisions).filter((d) => inPeriod(d.date, period));
  const lines = recapLines(recap);
  const missingLog = matchLog(entries, lines, c);
  const missingDecisions = matchDecisions(decs, lines, c);
  return { period, missingLog, missingDecisions, outside, counted: { log: entries.length, decisions: decs.length } };
}

const cut = (s, n = 110) => { const t = String(s).replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 3) + '...' : t; };
export function report(r) {
  if (r.error) return `NOT COMPARED: ${r.error}.`;
  const n = r.missingLog.length + r.missingDecisions.length;
  const lines = [];
  lines.push(`Period ${r.period.from}${r.period.to !== r.period.from ? ' to ' + r.period.to : ''}: ${r.counted.log} log lines and ${r.counted.decisions} decisions compared.`);
  for (const o of r.outside) lines.push(`Outside the period, not compared: ${o}.`);
  if (!n) { lines.push('COMPLETE: every log line and every decision of the period is in the recap. It may be called finished.'); return lines.join('\n'); }
  lines.push(`NOT FINISHED: ${n} missing from the recap (${r.missingLog.length} log lines, ${r.missingDecisions.length} decisions). It may not be called finished until each is in it.`);
  for (const e of r.missingLog) lines.push(`- log ${e.date} ${e.time}: ${cut(e.text)}`);
  for (const d of r.missingDecisions) lines.push(`- decision ${d.date}: ${cut(d.text)}`);
  return lines.join('\n');
}

// The files of a period, from the notebook: its log folder and its decisions note.
export function notebookInputs(root, period) {
  const logs = [];
  try {
    for (const n of fs.readdirSync(path.join(root, 'log')).sort()) {
      const m = n.match(/^(\d{4}-\d{2}-\d{2})\.md$/);
      if (m && inPeriod(m[1], period)) logs.push({ name: 'log/' + n, text: fs.readFileSync(path.join(root, 'log', n), 'utf8') });
    }
  } catch { /* no log folder: nothing to compare from it */ }
  let decisions = '';
  try { decisions = fs.readFileSync(path.join(root, 'system', 'decisions.md'), 'utf8'); } catch { /* none */ }
  return { logs, decisions };
}

function main(argv) {
  const files = [], logs = [];
  let decisions = null, from, to;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--log') logs.push(argv[++i]);
    else if (a === '--decisions') decisions = argv[++i];
    else if (a === '--from') from = argv[++i];
    else if (a === '--to') to = argv[++i];
    else files.push(a);
  }
  if (!files[0]) { console.log('Give the recap: recap-compare.mjs <recap.md> [--log <file>]... [--decisions <file>] [--from <date>] [--to <date>]'); return 2; }
  let recap;
  try { recap = fs.readFileSync(files[0], 'utf8'); } catch { console.log(`NOT COMPARED: the recap ${files[0]} cannot be read.`); return 2; }
  const root = process.env.HIVE_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
  const period = periodOf(recap, files[0], from, to);
  const nb = period ? notebookInputs(root, period) : { logs: [], decisions: '' };
  let logIn;
  try { logIn = logs.length ? logs.map((f) => ({ name: f.replace(/\\/g, '/'), text: fs.readFileSync(f, 'utf8') })) : nb.logs; }
  catch (e) { console.log(`NOT COMPARED: a log file cannot be read (${e.message}).`); return 2; }
  let decIn;
  try { decIn = decisions !== null ? fs.readFileSync(decisions, 'utf8') : nb.decisions; }
  catch { console.log(`NOT COMPARED: the decisions file ${decisions} cannot be read.`); return 2; }
  const r = compare({ recap, recapName: path.basename(files[0]), logs: logIn, decisions: decIn, from, to });
  console.log(report(r));
  if (r.error) return 2;
  return r.missingLog.length + r.missingDecisions.length ? 1 : 0;
}
const isMain = process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
if (isMain) { try { process.exitCode = main(process.argv.slice(2)); } catch (e) { console.log(`NOT COMPARED: ${e && e.message || e}`); process.exitCode = 2; } }
