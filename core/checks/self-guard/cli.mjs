#!/usr/bin/env node
// The self-guard program, for the person, the health check and the daily brief. None of these commands switches
// anything; only "probe" runs a script, and only against a made-up Hive folder it removes afterwards.
//   node core/checks/self-guard/cli.mjs start    one line for the start of a chat: the full hash comparison (with its time) and the hooks
//   node core/checks/self-guard/cli.mjs verify   the installed copies against the notebook's, by hash
//   node core/checks/self-guard/cli.mjs hooks    the hooks the app's settings must carry, and any that are missing
//   node core/checks/self-guard/cli.mjs canary   when each hook last left its mark
//   node core/checks/self-guard/cli.mjs probe    runs the installed gates on a made-up write of the off switch: refused?
//   node core/checks/self-guard/cli.mjs log      the log in plain words: what was stopped, what is owed, what was switched
//   node core/checks/self-guard/cli.mjs count    one line for the daily brief (yesterday, or --day YYYY-MM-DD)
// Options: --home <folder> (a made-up home), --root <folder> (the notebook), --json, --days <n> or --all (log).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as G from './lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const cmd = argv[0] || 'help';
const opt = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
const has = (k) => argv.includes(k);
const home = opt('--home') || process.env.HIVE_HOME || os.homedir();
const claudeDir = path.join(home, '.claude');
const state = process.env.HIVE_STATE && !opt('--home') ? process.env.HIVE_STATE : path.join(claudeDir, 'hive');
const cfgRoot = (() => { const c = G.readJson(path.join(state, 'config.json'), {}); return String(c.root || '').trim(); })();
const root = opt('--root') || process.env.HIVE_ROOT || cfgRoot || path.resolve(HERE, '..', '..', '..');
const S = JSON.parse(fs.readFileSync(path.join(HERE, 'settings.json'), 'utf8'));
const say = (s) => process.stdout.write(s + '\n');

if (cmd === 'verify') {
  // Every file read again, the cache not trusted.
  const r = G.compareInstalled({ root, state, claudeDir, S, fresh: true });
  if (has('--json')) say(JSON.stringify(r));
  else if (!r.differs.length) say(`PASS: all ${r.checked} installed copies match the notebook (compared in ${r.ms} ms).`);
  else { say(`FAIL: ${r.differs.length} of ${r.checked} installed copies are not the notebook's (compared in ${r.ms} ms):`); for (const d of r.differs) say(`- ${d.dst}: ${d.why}`); }
  process.exit(r.differs.length ? 1 : 0);
} else if (cmd === 'start') {
  // For the start of a chat: the full comparison (it may take longer than a message allows, so it says its time),
  // written where the before-a-tool step reads it, so a difference holds from the very first step; and the hooks
  // missing from the app's settings. One line out; it never fails the start.
  let line;
  try {
    const r = G.compareInstalled({ root, state, claudeDir, S, fresh: true });
    const own = path.join(state, 'self-guard');
    const prev = G.readJson(path.join(own, 'status.json'), {});
    G.writeJson(path.join(own, 'status.json'), { at: new Date().toISOString(), by: 'start', differs: r.differs, fingerprint: r.fingerprint, checked: r.checked, pending: 0, ms: r.ms, logged: prev.fingerprint === r.fingerprint ? prev.logged : '' });
    const miss = G.hooksMissing({ root, claudeDir, cwd: process.cwd() });
    const inst = r.differs.length
      ? `${G.plural(r.differs.length, 'installed copy of the checks is', 'installed copies of the checks are')} not the notebook's (${r.differs.slice(0, 3).map((d) => `${d.dst}: ${d.why}`).join('; ')}${r.differs.length > 3 ? '; and more' : ''}), so every step except reading is refused until they say "reinstall the gates" or "accept the installed copies"`
      : `all ${r.checked} installed copies of the checks match the notebook`;
    const hooks = miss.length ? `; hooks missing from the app's settings: ${miss.map((x) => x.why).join('; ')}` : "; every hook the notebook expects is in the app's settings";
    line = `Self-guard: ${inst} (compared in ${r.ms} ms)${hooks}.`;
  } catch (e) { line = `Self-guard: the comparison at the start broke (${String(e && e.message || e).slice(0, 120)}); it is tried again at the person’s first message.`; }
  say(line);
} else if (cmd === 'hooks') {
  const m = G.hooksMissing({ root, claudeDir, cwd: process.cwd() });
  if (has('--json')) say(JSON.stringify(m));
  else if (!m.length) say("PASS: every hook the notebook expects is in the app's settings.");
  else { say(`FAIL: ${m.length} problem${m.length === 1 ? '' : 's'} with the hooks:`); for (const x of m) say(`- ${x.why}`); }
  process.exit(m.length ? 1 : 0);
} else if (cmd === 'canary') {
  const c = G.readJson(path.join(state, 'self-guard', 'canary.json'), {});
  const names = { prompt: 'at the person’s message', pretool: 'before a tool', posttool: 'after a tool', stop: 'at the end of a reply' };
  for (const [k, v] of Object.entries(names)) say(c[k] ? `The hook ${v} last left its mark at ${c[k]}.` : `The hook ${v} has never left a mark (not wired in, or the self-guard check is not called by the gates).`);
} else if (cmd === 'probe') {
  const gates = path.join(state, 'gates', 'gates.mjs');
  if (!fs.existsSync(gates)) { say(`FAIL: no installed gates at ${gates}.`); process.exit(1); }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hive-probe-'));
  const st = path.join(tmp, 'hive');
  fs.mkdirSync(path.join(st, 'gates', 'start'), { recursive: true });
  fs.writeFileSync(path.join(st, 'gates', 'start', 'canary-probe.json'), JSON.stringify({ session: 'canary-probe', by: 'probe' }));
  const run = (sid) => spawnSync(process.execPath, [gates, 'pretool'], {
    input: JSON.stringify({ session_id: sid, hook_event_name: 'PreToolUse', cwd: root, tool_name: 'Write', tool_input: { file_path: path.join(st, 'gates-off'), content: '' } }),
    encoding: 'utf8', timeout: 15000, env: { ...process.env, HIVE_HOME: tmp, HIVE_STATE: st, HIVE_ROOT: root },
  });
  const refused = (r) => /"permissionDecision"\s*:\s*"deny"/.test(r.stdout || '') || r.status === 2;
  const a = run('canary-probe'), b = run('canary-nostart');
  fs.rmSync(tmp, { recursive: true, force: true });
  const lines = [
    refused(a) ? 'The installed gates refuse a made-up write of the off switch.' : 'The installed gates let a made-up write of the off switch through: the self-guard check is not wired into them.',
    refused(b) ? 'They refuse it too in a chat with no start record.' : 'In a chat with no start record they let it through: the checks do nothing there.',
  ];
  say(`${refused(a) && refused(b) ? 'PASS' : 'FAIL'}: ${lines.join(' ')}`);
  process.exit(refused(a) && refused(b) ? 0 : 1);
} else if (cmd === 'log') {
  const lines = G.readLog(state);
  const days = has('--all') ? 0 : Number(opt('--days') || 7);
  const since = days ? new Date(Date.now() - days * 864e5).toISOString() : '';
  if (has('--json')) say(JSON.stringify(lines.filter((l) => !since || l.t >= since)));
  else for (const l of G.plainLog(lines, { since })) say(l);
} else if (cmd === 'count') {
  const day = opt('--day') || new Date(Date.now() - 864e5).toISOString().slice(0, 10);
  say(G.dailyCount(state, day));
} else {
  say('Commands: start, verify, hooks, canary, probe, log, count. Options: --home <folder>, --root <folder>, --json, --days <n>, --all, --day <YYYY-MM-DD>.');
}
