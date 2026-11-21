#!/usr/bin/env node
// The guards of the daily run. Exact work, so it is a program and not left to the run's judgment.
//
//   node core/engine/guards.mjs check <morning|evening> <date>   may this run go ahead?
//       prints "GO" (exit 0) or "STOP: <why>" (exit 3). A STOP that switched the run off also prints "SWITCHED OFF".
//   node core/engine/guards.mjs empty <yes|no> <date>            after the brief: count runs that had nothing to say
//       "yes" adds 1 to empty_runs, "no" sets it to 0. At 3 it switches the run off and prints "SWITCHED OFF: ...".
//   node core/engine/guards.mjs long <start time, ISO>           has this run gone on too long?
//       prints "OK <seconds>" (exit 0) or "TOO LONG <seconds>" (exit 4) past the ceiling in the switch note.
//
// It reads and writes only system/engine-switch.md, and looks at the names of the files in brief/.
// HIVE_ROOT names the notebook (default: the folder two levels above this file).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.env.HIVE_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SWITCH = path.join(ROOT, 'system', 'engine-switch.md');
const DEFAULT_CEILING = 600; // seconds
const EMPTY_LIMIT = 3;

export function readSwitch(text) {
  const get = (k) => { const m = text.match(new RegExp('^' + k + ':[ \\t]*(.*)$', 'mi')); return m ? m[1].trim() : ''; };
  const n = (v, d) => (/^\d+$/.test(v) ? Number(v) : d);
  return { engine: get('engine').toLowerCase(), emptyRuns: n(get('empty_runs'), 0), retireOn: get('retire_on'), ceiling: n(get('max_seconds'), DEFAULT_CEILING) };
}
export function setLine(text, key, value) {
  const re = new RegExp('^' + key + ':.*$', 'mi');
  return re.test(text) ? text.replace(re, `${key}: ${value}`) : text.replace(/\s*$/, '') + `\n\n${key}: ${value}\n`;
}
const isDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d || '');

/** The decision, with no file work: what the run may do, and what the switch note should become. */
export function decide(kind, date, sw, briefNames) {
  if (kind !== 'morning' && kind !== 'evening') return { go: false, why: 'the run was not told whether it is the morning or the evening run' };
  if (!isDate(date)) return { go: false, why: 'the run was not given a date like 2026-11-18' };
  if (sw.engine !== 'on') return { go: false, why: 'the switch is off' };
  if (isDate(sw.retireOn) && date >= sw.retireOn) return { go: false, off: true, why: `its last day was set to ${sw.retireOn}, so it has retired` };
  const mine = kind === 'evening' ? `${date}-evening.md` : `${date}.md`;
  if (briefNames.includes(mine)) return { go: false, why: `today's ${kind} brief is already written (one run of each kind a day)` };
  return { go: true };
}
export function countEmpty(sw, wasEmpty) {
  const next = wasEmpty ? sw.emptyRuns + 1 : 0;
  return { emptyRuns: next, off: next >= EMPTY_LIMIT };
}

function main() {
  const [mode, a, b] = process.argv.slice(2);
  let text;
  try { text = fs.readFileSync(SWITCH, 'utf8'); } catch { console.log('STOP: the switch note was not found'); process.exit(3); }
  const sw = readSwitch(text);
  if (mode === 'check') {
    let names = [];
    try { names = fs.readdirSync(path.join(ROOT, 'brief')); } catch {}
    const d = decide(a, b, sw, names);
    if (d.go) { console.log('GO'); return; }
    if (d.off) { fs.writeFileSync(SWITCH, setLine(text, 'engine', 'off')); console.log('SWITCHED OFF'); }
    console.log('STOP: ' + d.why);
    process.exit(3);
  } else if (mode === 'empty') {
    if (a !== 'yes' && a !== 'no') { console.log('Say yes or no: did this run have nothing to say?'); process.exit(2); }
    const c = countEmpty(sw, a === 'yes');
    let out = setLine(text, 'empty_runs', String(c.emptyRuns));
    if (c.off) out = setLine(out, 'engine', 'off');
    fs.writeFileSync(SWITCH, out);
    console.log(c.off ? `SWITCHED OFF: ${EMPTY_LIMIT} runs in a row had nothing to say` : `empty_runs: ${c.emptyRuns}`);
  } else if (mode === 'long') {
    const start = Date.parse(a || '');
    if (!Number.isFinite(start)) { console.log('OK 0'); return; }
    const secs = Math.round((Date.now() - start) / 1000);
    if (secs > sw.ceiling) { console.log(`TOO LONG ${secs}`); process.exit(4); }
    console.log(`OK ${secs}`);
  } else {
    console.log('Use: check <morning|evening> <date> | empty <yes|no> | long <start time>');
    process.exit(2);
  }
}
const isMain = process.argv[1] && import.meta.url.toLowerCase().endsWith(path.basename(process.argv[1]).toLowerCase());
if (isMain) main();
