// The records the checks stand on. Two sources, both built from the hook's own input:
// 1. the gates' records, read only (core/gates/gates.mjs writes them): the chat record (helper-chat mark), the skills
//    this chat loaded (by it or its helpers), this turn's events (files written, checks run);
// 2. the checks' own records under <hive folder>/checks/: the person's latest own message in its own case (the gates keep it in
//    lower case), every tool that ran in this turn with its command and exit code, the says carried to the person's next message.
import fs from 'node:fs';
import path from 'node:path';

export const safe = (s) => String(s || '').replace(/[^\w-]/g, '_').slice(0, 120);
export function readJson(p, fallback) { try { return JSON.parse(fs.readFileSync(p, 'utf8').replace(/^﻿/, '')); } catch { return fallback; } }
export function writeJson(p, v) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = p + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(v));
  fs.renameSync(tmp, p);
}
export function appendLine(p, v) { try { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.appendFileSync(p, JSON.stringify(v) + '\n'); } catch {} }
export function readLines(p) {
  try { return fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; }
}

export function paths(state, sid) {
  const g = path.join(state, 'gates');
  const c = path.join(state, 'checks');
  const s = safe(sid);
  return {
    gatesChat: path.join(g, 'chat', s + '.json'),
    gatesSkills: path.join(g, 'chat', s + '.skills'),
    gatesTurn: path.join(g, 'turn', s + '.json'),
    gatesEvents: path.join(g, 'turn', s + '.events'),
    start: path.join(g, 'start', s + '.json'),
    chat: path.join(c, 'chat', s + '.json'),
    events: path.join(c, 'turn', s + '.events'),
    carry: path.join(c, 'chat', s + '.carry'),
    debts: path.join(c, 'debts', s + '.json'),
    reports: path.join(c, 'chat', s + '.reportlines'),
    cardsSeen: path.join(c, 'chat', s + '.cards-seen'),
    log: path.join(state, 'gates.log'),
  };
}

// One tool that ran, as the checks see it. PostToolUse comes only after a tool that succeeded; a failed one is seen
// only through PostToolUseFailure (its error's first line is "Exit code N" for a shell).
export function toolEvent(input, failed) {
  const tool = String(input.tool_name || '');
  const ti = input.tool_input || {};
  const resp = input.tool_response || {};
  let exit = null;
  for (const k of ['exitCode', 'exit_code', 'returnCode', 'code']) if (typeof resp[k] === 'number') { exit = resp[k]; break; }
  if (failed) { const m = String(input.error || '').match(/^Exit code (\d+)/); exit = m ? Number(m[1]) : (exit ?? 1); }
  const ok = !failed && !resp.interrupted && (exit === null || exit === 0);
  const e = { kind: 'tool', tool, ok, t: Date.now() };
  if (exit !== null) e.exit = exit;
  if (tool === 'Bash' || tool === 'PowerShell') e.command = String(ti.command || '').slice(0, 2000);
  const file = ti.file_path || ti.notebook_path;
  if (file) e.path = String(file);
  if (input.agent_id) e.agent = String(input.agent_id);
  // A helper's report, delivered with the handback tool, is that tool's input; its last words at stop are not it.
  if (tool === 'SubagentHandback' && typeof ti.message === 'string') e.report = ti.message.slice(0, 8000);
  return e;
}

// The facts read once per hook run and shared by every check of that run.
export function gatherFacts(P) {
  const gchat = readJson(P.gatesChat, {}) || {};
  const mine = readJson(P.chat, {}) || {};
  const gturn = readJson(P.gatesTurn, {}) || {};
  const isHelperChat = !!gchat.helper;
  const hisLast = isHelperChat ? '' : String(mine.hisLast ?? gturn.his ?? gturn.ask ?? '');
  // hisNow: the prompt of this step is his own (false for a helper's report, a notice or another chat's message).
  const hisNow = !isHelperChat && mine.hisNow !== false;
  const cards = isHelperChat ? [] : (Array.isArray(mine.cards) ? mine.cards : []);
  const loaded = [...new Set(readLines(P.gatesSkills).map((x) => String(x.s || '').toLowerCase()).filter(Boolean))];
  const events = [
    ...readLines(P.events),
    ...readLines(P.gatesEvents).map((x) => (x.k === 'write' ? { kind: 'write', path: x.p, agent: x.a } : x.k === 'check' ? { kind: 'check', ok: !!x.ok, command: x.cmd } : null)).filter(Boolean),
  ];
  return { isHelperChat, hisLast, hisNow, cards, loaded, events, prompts: mine.prompts || 0, brokenSaid: mine.brokenSaid || '' };
}
