// The one door the gates call: runChecks({ mode, input, root, state, sid, outbox, log, deadline, started }).
// It runs every check's step for this hook, keeps the records and the debts, and returns the gates' output merged with
// the checks' (one JSON answer per hook, as Claude Code expects). It never throws; the gates still guard the call.
//   gates mode       step        what the checks can do there
//   pretool          pretool     refuse the tool (deny), put words in front of Claude (say); an overdue debt refuses
//                                every tool except reading
//   posttool         posttool    say (next to the tool's result); clear a debt; the tool is written to this turn's record
//   posttoolfailure  posttool    the same, for a tool that failed (only when that hook is installed)
//   prompt           prompt      say; open debts and words carried from the last reply are put in front of Claude
//   stop             stop        raise a debt; say (carried to the person's next message: words at the end of a reply would
//                                make Claude reply a second time, which is forbidden); clear
//   subagentstop     helperstop  say (carried to the person's next message); clear
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { stepIn } from './worker.mjs';
import { paths, gatherFacts, toolEvent, readJson, writeJson, appendLine, readLines } from './records.mjs';
import * as Debts from './debts.mjs';
import { isReading } from './reading.mjs';
import { ownWords, reportLines, recordReport, cardAnswers, prefilled } from './his-words.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const STEP_OF = { pretool: 'pretool', posttool: 'posttool', posttoolfailure: 'posttool', prompt: 'prompt', stop: 'stop', subagentstop: 'helperstop' };
const EVENT_OF = { pretool: 'PreToolUse', posttool: 'PostToolUse', posttoolfailure: 'PostToolUseFailure', prompt: 'UserPromptSubmit' };

export function libSettings() { return readJson(path.join(HERE, 'settings.json'), {}) || {}; }

const normP = (p) => { const s = path.resolve(String(p || '')).replace(/\\/g, '/'); return process.platform === 'win32' ? s.toLowerCase() : s; };
// May this tool run although debts are overdue? Reading always; a tool or a path the debt itself names as its way out.
function allowedBy(debt, ev, root) {
  const a = debt.allow || {};
  if ((a.tools || []).includes(ev.tool)) return true;
  const f = ev.input && (ev.input.file_path || ev.input.notebook_path);
  if (!f || !['Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(ev.tool)) return false;
  const abs = normP(path.resolve(root, f));
  return (a.paths || []).some((p) => { const t = normP(path.resolve(root, p)); return abs === t || abs.startsWith(t.replace(/\/$/, '') + '/'); });
}

// Puts the checks' words into the gates' answer for this event.
export function merge(outbox, mode, { deny, context }, max) {
  const event = EVENT_OF[mode];
  const list = [...(outbox || [])];
  if (!event || (!deny && !context)) return list;
  const cap = (s) => (s.length > max ? s.slice(0, max - 20) + ' ... (cut short)' : s);
  let i = list.findIndex((o) => o && typeof o === 'object' && o.hookSpecificOutput);
  const o = i >= 0 ? { ...list[i], hookSpecificOutput: { ...list[i].hookSpecificOutput } } : { hookSpecificOutput: { hookEventName: event } };
  const h = o.hookSpecificOutput;
  if (mode === 'pretool' && (deny || h.permissionDecision === 'deny')) {
    const parts = [h.permissionDecision === 'deny' ? h.permissionDecisionReason : '', deny, context, h.permissionDecision === 'deny' ? '' : h.additionalContext].filter(Boolean);
    h.permissionDecision = 'deny';
    h.permissionDecisionReason = cap(parts.join('\n\n'));
    delete h.additionalContext;
  } else if (context) {
    h.additionalContext = cap([h.additionalContext, context].filter(Boolean).join('\n'));
  }
  if (i >= 0) list[i] = o; else list.push(o);
  return list;
}

// Runs the step in a worker thread, ended at its time limit: a check that never returns cannot hold the hook up.
// It costs about 150 ms more per step on this computer (measured 2026-11-20), so it is on only when the library's
// settings say "isolate": true. Inline (the default) a check that never returns holds the hook until Claude Code ends it
// at the hook's own time limit (10 s), and then the tool runs: that one case fails open.
function isolated(job, until, inline) {
  const empty = { denies: [], says: [], debts: [], clears: [], ran: [], errors: [], modules: [], broken: [] };
  if (inline) return stepIn(job);
  return new Promise((resolve) => {
    let done = false;
    const w = new Worker(new URL('./worker.mjs', import.meta.url), { workerData: job });
    const finish = (r) => { if (done) return; done = true; clearTimeout(t); w.terminate().catch(() => {}); resolve(r); };
    const t = setTimeout(() => finish({ ...empty, timedOut: true }), Math.max(50, until - Date.now()));
    w.on('message', (m) => finish(m && m.ok ? m.r : { ...empty, errors: [{ id: '*', kind: 'safety', why: 'broke: ' + String(m && m.error) }], failed: true }));
    w.on('error', (e) => finish({ ...empty, errors: [{ id: '*', kind: 'safety', why: 'broke: ' + String(e && e.message || e) }], failed: true }));
    w.on('exit', () => finish({ ...empty, timedOut: true }));
  });
}

export async function runChecks(args) {
  const { mode, input = {}, root, state, sid = '', log, deadline, started = true } = args || {};
  const outbox = Array.isArray(args && args.outbox) ? args.outbox : [];
  const step = STEP_OF[mode];
  // The gates' log when the gates call; else a line in <hive folder>/gates.log, the same file.
  const L = (event, detail) => { try { if (log) log(event, { where: 'checks', ...detail }); else if (state && fs.existsSync(state)) appendLine(path.join(state, 'gates.log'), { t: new Date().toISOString(), mode: 'checks', sid, event, where: 'checks', ...detail }); } catch {} };
  try {
    if (!step || !root || !state) return outbox;
    if (step === 'stop' && input.stop_hook_active) return outbox; // the reply was already sent back once by the gates
    const S = { ...libSettings(), ...(args.settings || {}) };
    const who = S.who || 'the person';
    const dir = args.dir || process.env.HIVE_CHECKS_DIR || path.dirname(HERE); // the variable is for the gates' own tests
    const P = paths(state, sid);
    const gchat = readJson(P.gatesChat, {}) || {};
    // The records first, so this step's checks see this step.
    if (step === 'prompt') {
      const mine = readJson(P.chat, {}) || {};
      // Only his own words: a helper's report, a task notice or another chat's message that reaches this step is not
      // his (the hooks page: this step "also fires on turns Claude Code starts on its own"). When none of the prompt
      // is his, his last own message stays what it was, and hisNow is false: nothing at this step counts as his ruling.
      const w = ownWords(input.prompt, { known: reportLines(P.reports), helperChat: !!gchat.helper });
      if (w.his) writeJson(P.chat, { ...mine, hisLast: w.own, hisNow: true, cards: [], at: Date.now(), prompts: (mine.prompts || 0) + 1, brokenSaid: mine.brokenSaid || '' });
      else {
        writeJson(P.chat, { ...mine, hisLast: gchat.helper ? '' : String(mine.hisLast || ''), hisNow: false, notHis: { at: Date.now(), why: w.why.slice(0, 160) }, prompts: mine.prompts || 0, brokenSaid: mine.brokenSaid || '' });
        L('not-his-words', { why: w.why.slice(0, 160) });
      }
      try { fs.rmSync(P.events, { force: true }); } catch {}
    }
    if (step === 'posttool') {
      appendLine(P.events, toolEvent(input, mode === 'posttoolfailure'));
      const tn = String(input.tool_name || '');
      // A helper's report: its lines are remembered, so they are never taken for his words when they come back as a
      // notice at the step "at his message".
      if (tn === 'SubagentHandback') recordReport(P.reports, (input.tool_input || {}).message);
      if (tn === 'Agent' || tn === 'Task') { const r = input.tool_response || {}; recordReport(P.reports, typeof r.content === 'string' ? r.content : Array.isArray(r.content) ? r.content.map((b) => (b && b.text) || '').join('\n') : ''); }
      // His answers on a question card, kept until his next own message: each is his word for the act its card asked about.
      // Only a card the step before it saw going out with no answers in it: a card whose answers were filled in by
      // whoever sent it is never his (and when the before-a-tool step does not watch the card, no card counts).
      const seen = !!input.tool_use_id && readLines(P.cardsSeen).some((x) => x.id === input.tool_use_id);
      if (tn === 'AskUserQuestion' && mode !== 'posttoolfailure' && !gchat.helper && seen) {
        const got = cardAnswers(input.tool_input || {}, input.tool_response);
        if (got.length) { const mine = readJson(P.chat, {}) || {}; writeJson(P.chat, { ...mine, cards: [...(mine.cards || []), ...got.map((c) => ({ ...c, t: Date.now() }))].slice(-20) }); L('card-answers', { count: got.length }); }
      }
    }
    if (step === 'helperstop') recordReport(P.reports, input.last_assistant_message);
    if (step === 'pretool' && String(input.tool_name || '') === 'AskUserQuestion' && input.tool_use_id && !prefilled(input.tool_input || {})) appendLine(P.cardsSeen, { id: String(input.tool_use_id), t: Date.now() });

    const facts = gatherFacts(P);
    const store = Debts.load(P.debts);
    const ti = input.tool_input || {};
    // At helperstop the text is the helper's delivered report when the after-tool hook saw its handback (ev.report
    // true); else its last words.
    const handback = step === 'helperstop' && input.agent_id
      ? facts.events.filter((e) => e.tool === 'SubagentHandback' && e.agent === String(input.agent_id) && typeof e.report === 'string').at(-1) : null;
    const ev = {
      ...input, step, tool: String(input.tool_name || ''), input: ti,
      command: (input.tool_name === 'Bash' || input.tool_name === 'PowerShell') ? String(ti.command || '') : '',
      text: step === 'prompt' ? String(input.prompt || '') : handback ? handback.report : (step === 'stop' || step === 'helperstop') ? String(input.last_assistant_message || '') : '',
    };
    if (step === 'helperstop') ev.report = !!handback;
    const until = Math.min(Date.now() + (S.totalMs || 1500) + 300, deadline || Infinity);
    const job = { __hiveChecks: true, step, dir, ev, facts, root, state, sid, agentId: input.agent_id || '', who, settings: S, deadline: until - 100, started, debts: store.items };
    const res = await isolated(job, until, args.inline ?? !S.isolate);
    if (res.timedOut || res.failed) {
      L(res.timedOut ? 'check-timeout' : 'error', { kind: 'safety', why: res.timedOut ? 'the checks did not finish in time; the worker was ended' : 'the worker that runs the checks broke' });
      if (step === 'pretool' && !isReading(ev.tool, ti, S)) res.denies.push({ id: '*', text: `HIVE CHECKS stopped this step to be safe: the checks ${res.timedOut ? 'did not finish in time (a check may never return)' : 'broke while running'}. Steps that only read still run. Tell ${who} in one plain sentence; "node core/checks/_lib/cli.mjs doctor" names the slow one.` });
    }
    for (const e of res.errors) L(/too long|out of time/.test(e.why) ? 'check-timeout' : 'check-error', { check: e.id, kind: e.kind, why: e.why.slice(0, 200) });
    const all = { modules: res.modules, broken: res.broken };
    res.ran = new Set(res.ran);

    const known = new Set([...all.modules.map((m) => m.id), ...all.broken.map((b) => b.id)]);
    const modeOf = new Map(all.modules.map((m) => [m.id, m.mode]));
    const says = res.says.map((s) => s.text);
    let deny = res.denies.map((d) => d.text).join('\n\n');
    for (const d of res.denies) L('check-deny', { check: d.id, tool: ev.tool, why: d.text.slice(0, 160) });

    if (step === 'pretool') {
      // The debt rule: overdue debts of refusing checks stop every tool but reading, in the lead's own turn.
      const od = Debts.overdue(store).filter((d) => modeOf.get(d.check) === 'refuse' || (!modeOf.has(d.check) && known.has(d.check)));
      // A helper is never held by the lead's reply debt, wherever it writes (the ruling of 2026-11-20:
      // the debt is about how the lead spoke to the person, not about the helper's work).
      if (od.length && !input.agent_id && !isReading(ev.tool, ti, S) && !od.every((d) => allowedBy(d, ev, root))) {
        const text = `HIVE DEBT (overdue): this step is refused because a fault of your earlier reply was still there at the end of the next one; until a reply clears it, only reading runs. ${od.map((d) => `[${d.check}] ${d.text}`).join(' ')} The one thing to do: write the next reply without these faults.`;
        deny = [deny, text].filter(Boolean).join('\n\n');
        L('debt-refuse', { tool: ev.tool, debts: od.map((d) => d.check + ':' + d.key).join(', ').slice(0, 200) });
      }
    }
    if (step !== 'stop' && res.clears.length) {
      Debts.update(P.debts, (st) => { for (const c of res.clears) { const n = Debts.applyClears(st, c.check, c.keys); if (n) L('debt-clear', { check: c.check, keys: c.keys.join(',') }); } });
    }
    if (step === 'stop' && !res.timedOut && !res.failed) {
      const changed = Debts.update(P.debts, (st) => Debts.afterReply(st, { raised: res.debts, ran: res.ran, known, clears: res.clears }));
      for (const k of ['opened', 'overdue', 'cleared', 'dropped']) if (changed[k].length) L('debt-' + k, { debts: changed[k].join(', ').slice(0, 200) });
    }
    if (step === 'stop' || step === 'helperstop') {
      for (const s of says) appendLine(P.carry, { t: Date.now(), text: s });
      if (says.length) L('check-carry', { count: says.length });
      return outbox; // nothing is said at the end of a reply: it would make a second reply
    }

    let context = '';
    if (step === 'prompt') {
      const lines = [];
      const mine = readJson(P.chat, {}) || {};
      const brokenNow = all.broken.map((b) => `${b.id} (${b.kind}: ${b.problems.slice(0, 2).join('; ')})`);
      const offSafety = all.modules.filter((m) => m.kind === 'safety' && m.mode !== 'refuse').map((m) => `${m.id} is set to "${m.mode}"`);
      const sig = res.timedOut || res.failed ? mine.brokenSaid || '' : [...brokenNow, ...offSafety].join(' | ');
      if (sig && (mine.prompts <= 1 || sig !== mine.brokenSaid)) {
        lines.push(`HIVE CHECKS NOT WHOLE: ${[brokenNow.length ? 'broken: ' + brokenNow.join(', ') + '. A broken safety check refuses every step but reading.' : '', offSafety.length ? 'safety checks not refusing: ' + offSafety.join(', ') + '.' : ''].filter(Boolean).join(' ')} Tell ${who} in one plain sentence first.`);
        writeJson(P.chat, { ...mine, brokenSaid: sig });
        L('check-broken', { broken: sig.slice(0, 200) });
      } else if (!sig && mine.brokenSaid) writeJson(P.chat, { ...mine, brokenSaid: '' });
      if (!started) lines.push('HIVE CHECKS: this chat has no start record, so only the safety checks run. Run the hive-start skill.');
      const fresh = Debts.load(P.debts);
      const dt = Debts.promptText(fresh, who);
      if (dt) { lines.push(dt); L('debt-said', { count: fresh.items.length }); }
      const carried = readLines(P.carry).map((x) => String(x.text || '')).filter(Boolean);
      try { fs.rmSync(P.carry, { force: true }); } catch {}
      if (carried.length) lines.push('About your last reply: ' + carried.join(' '));
      lines.push(...says);
      context = lines.join('\n');
    } else context = says.join('\n');
    if (says.length) L('check-say', { count: says.length });
    return merge(outbox, mode, { deny, context }, S.maxContext || 9000);
  } catch (e) {
    L('error', { kind: 'safety', error: String(e && e.message || e).slice(0, 200) });
    // The loader itself broke: it carries the safety checks, so before a tool it fails closed, except for reading.
    try {
      if (STEP_OF[mode] === 'pretool' && !isReading(input.tool_name, input.tool_input || {}, libSettings())) {
        return merge(outbox, mode, { deny: 'HIVE CHECKS stopped this step to be safe: the program that runs the checks broke (the error is in the gates log). Steps that only read still run. Tell ' + (libSettings().who || 'the person') + ' in one plain sentence.', context: '' }, 9000);
      }
    } catch {}
    return outbox;
  }
}
