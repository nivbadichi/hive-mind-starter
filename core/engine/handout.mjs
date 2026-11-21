#!/usr/bin/env node
// Handing out by rule (the factory's orchestrator, its exact part). Before the lead starts a helper beside others:
//
//   node core/engine/handout.mjs check <plan.json>     (or the plan on stdin)
//       prints "GO" (exit 0), or "STOP: <why, in whole sentences>" (exit 3).
//
// plan.json: { "running": [ { "name": "A", "files": ["core/gates/**"] }, { "name": "B", "brief": "path/to/brief.md" } ],
//              "next": { "name": "C", "brief": "path/to/brief.md" }, "maxAtOnce": 6 }
// A helper gives its files as "files" (paths or globs) or as "brief" (a file whose line "Files touched: ..." is read,
// the line of the part "How it will be proven" in core/templates/build-brief.md; a relative path is read from the
// plan file's folder, or from the current folder for a plan on stdin). Paths compare without letter case. maxAtOnce is optional: the default
// is "handout.maxAtOnce" in core/gates/settings.json, else 6.
//
// It refuses the next helper when its files overlap a running helper's, when either side names no files (then
// nobody can tell), or when starting it would put more helpers at once than the top number. Overlap is decided
// cautiously: two globs whose fixed folders sit one inside the other count as overlapping.
// On its own error it fails open: prints "GO (not checked: ...)", exit 0, and logs an "error" line in the gates log.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.env.HIVE_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const STATE = process.env.HIVE_STATE || path.join(process.env.HIVE_HOME || os.homedir(), '.claude', 'hive');
const DEFAULT_MAX = 6;

// ---------- reading the files a helper touches ----------
export function normPath(p) {
  let s = String(p || '').trim().replace(/^[`'"<]+|[`'">]+$/g, '').replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/{2,}/g, '/');
  s = s.replace(/\.$/, '');
  if (s.endsWith('/')) s += '**';
  return s.toLowerCase();
}
// The paths on the line "Files touched: ..." of a brief, or [] when there is no such line or it is still a blank.
export function filesTouched(text) {
  const m = String(text || '').match(/^[\s*_>-]*files touched[*_]*\s*:\s*(.*)$/im);
  if (!m) return [];
  const value = m[1].split(/\bout of scope\s*:/i)[0];
  return value.split(/\s*(?:,|;|\band\b)\s*/i).map(normPath).filter((s) => s && !/^<|>$/.test(s) && /[\w*]/.test(s) && !/\s/.test(s));
}

// ---------- overlap ----------
const isGlob = (p) => /[*?[{]/.test(p);
function fixedPart(p) { const segs = p.split('/'); const i = segs.findIndex((s) => isGlob(s)); return (i < 0 ? segs : segs.slice(0, i)).join('/'); }
function globRe(g) {
  let re = '';
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === '*' && g[i + 1] === '*') { if (g[i + 2] === '/') { re += '(?:.*/)?'; i += 2; } else { re += '.*'; i += 1; } }
    else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp('^' + re + '$');
}
const inside = (a, folder) => folder === '' || a === folder || a.startsWith(folder + '/');
export function overlap(a, b) {
  a = normPath(a); b = normPath(b);
  if (!a || !b) return false;
  const ga = isGlob(a), gb = isGlob(b);
  if (!ga && !gb) return inside(a, b) || inside(b, a); // the same file, or one is a folder that holds the other
  if (ga && gb) { const fa = fixedPart(a), fb = fixedPart(b); return inside(fa, fb) || inside(fb, fa); }
  const [g, l] = ga ? [a, b] : [b, a];
  return globRe(g).test(l) || inside(fixedPart(g), l);
}

// ---------- the decision ----------
function filesOf(h, base) {
  if (Array.isArray(h.files)) return h.files.map(normPath).filter(Boolean);
  if (h.brief) return filesTouched(fs.readFileSync(path.resolve(base || ROOT, h.brief), 'utf8'));
  if (h.text) return filesTouched(h.text);
  return [];
}
export function maxFromSettings(root = ROOT) {
  try { const n = JSON.parse(fs.readFileSync(path.join(root, 'core', 'gates', 'settings.json'), 'utf8')).handout.maxAtOnce; if (Number.isInteger(n) && n > 0) return n; } catch {}
  return DEFAULT_MAX;
}
export function decide(plan, base) {
  const running = plan.running || [];
  const next = plan.next || {};
  const max = Number.isInteger(plan.maxAtOnce) && plan.maxAtOnce > 0 ? plan.maxAtOnce : maxFromSettings();
  const who = (h, i) => h.name ? `helper ${h.name}` : `running helper ${i + 1}`;
  const newName = next.name ? `the new helper ${next.name}` : 'the new helper';
  const reasons = [];
  if (running.length + 1 > max) reasons.push(`${running.length} helpers are running already, and the top number at once is ${max}. Start ${newName} when one of them has finished.`);
  const mine = filesOf(next, base);
  if (!mine.length) reasons.push(`${newName[0].toUpperCase() + newName.slice(1)} names no files it will touch, so nobody can tell whether it collides with the others. Fill in the line "Files touched" of its part "How it will be proven".`);
  running.forEach((h, i) => {
    const theirs = filesOf(h, base);
    if (!theirs.length) { if (mine.length) reasons.push(`${who(h, i)[0].toUpperCase() + who(h, i).slice(1)} names no files it touches, so I cannot tell whether ${newName} would collide with it. Wait until it has finished, or write down its files.`); return; }
    const pairs = [];
    for (const a of mine) for (const b of theirs) if (overlap(a, b)) pairs.push(a === b ? a : `${a} and ${b}`);
    if (pairs.length) reasons.push(`${newName[0].toUpperCase() + newName.slice(1)} and ${who(h, i)} would both touch ${pairs.slice(0, 3).join('; ')}. Start it after ${who(h, i)} has finished, or split the files so they do not overlap.`);
  });
  return { go: reasons.length === 0, reasons, max };
}

// ---------- run ----------
function logError(e) {
  try { if (fs.existsSync(STATE)) fs.appendFileSync(path.join(STATE, 'gates.log'), JSON.stringify({ t: new Date().toISOString(), mode: 'handout', event: 'error', error: String(e && e.message || e).slice(0, 300) }) + '\n'); } catch {}
}
function main(argv) {
  const [cmd, file] = argv;
  if (cmd !== 'check') { process.stdout.write('Use: node core/engine/handout.mjs check <plan.json>   (or the plan on stdin)\n'); return 2; }
  try {
    if (process.env.HIVE_HANDOUT_CRASH === '1') throw new Error('test crash');
    const raw = file ? fs.readFileSync(file, 'utf8') : fs.readFileSync(0, 'utf8');
    const d = decide(JSON.parse(raw), file ? path.dirname(path.resolve(file)) : process.cwd());
    process.stdout.write(d.go ? 'GO\n' : 'STOP: ' + d.reasons.join(' ') + '\n');
    return d.go ? 0 : 3;
  } catch (e) {
    logError(e);
    process.stdout.write(`GO (not checked: the handing-out check broke, ${String(e && e.message || e).slice(0, 120)}; the lead decides by hand this time)\n`);
    return 0;
  }
}
const isMain = process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
if (isMain) process.exitCode = main(process.argv.slice(2));
