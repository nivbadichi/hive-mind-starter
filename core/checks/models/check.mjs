// The models check (rule 12): every helper names its model, the model policy is held, the policy changes only by
// the words of the person who set it, and a report that relays helpers' work says which model did it.
// Contract: system/design/enforcement-2026-11-20.md. This module never edits the gates.
// The hook fields used here were read from https://code.claude.com/docs/en/hooks (2026-11-20): the Agent tool's
// tool_input { prompt, description, subagent_type, model }, its PostToolUse tool_response { resolvedModel, modelsUsed,
// status }, SubagentStop's last_assistant_message and agent_type, and SubagentHandback's tool_input.message.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
let FILE_SETTINGS = null;
function ownSettings() {
  if (FILE_SETTINGS) return FILE_SETTINGS;
  try { FILE_SETTINGS = JSON.parse(fs.readFileSync(path.join(HERE, 'settings.json'), 'utf8')); } catch { FILE_SETTINGS = {}; }
  return FILE_SETTINGS;
}
const S = (ctx) => (ctx && ctx.settings && Object.keys(ctx.settings).length ? ctx.settings : ownSettings());
const low = (x) => String(x == null ? '' : x).toLowerCase();
const slash = (x) => String(x || '').replace(/\\/g, '/');
const esc = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const hasWord = (text, w) => new RegExp(`(^|[^a-z0-9])${esc(low(w))}([^a-z0-9]|$)`, 'i').test(low(text));
const hasAny = (text, words) => (words || []).some((w) => hasWord(text, w));
const whoOf = (ctx, s) => (ctx && ctx.who) || (s && s.who) || 'the person';

// ---------- models and the policy ----------
// The family of a model name: "claude-opus-5-5", "Opus 5.5", "us.anthropic.claude-opus..." -> "opus". "" when none is known.
export function family(name, s = ownSettings()) {
  const n = low(name);
  if (!n.trim()) return '';
  for (const [fam, words] of Object.entries(s.families || {})) if ((words || [fam]).some((w) => n.includes(low(w)))) return fam;
  return '';
}
// Every family named in a text, in the order of the families table.
export function familiesIn(text, s = ownSettings()) {
  return Object.entries(s.families || {}).filter(([, words]) => (words || []).some((w) => hasWord(text, w))).map(([f]) => f);
}
export function minimumOf(s = ownSettings()) { return low((s.policy || {}).minimum || 'any'); }
// True when a family is at or above the policy's minimum. "any" lets any family this check knows.
export function meets(fam, s = ownSettings()) {
  if (!fam) return false;
  const rank = (s.rank || []).map(low);
  const min = minimumOf(s);
  if (min === 'any') return Object.keys(s.families || {}).includes(fam);
  const a = rank.indexOf(fam), b = rank.indexOf(min);
  return a >= 0 && b >= 0 && a >= b;
}
function policyLine(s, who) {
  const p = s.policy || {};
  const min = minimumOf(s);
  const above = (s.rank || []).slice((s.rank || []).map(low).indexOf(min) + 1);
  const list = min === 'any' ? 'any named model' : `${min} at the least${above.length ? ` (${min} or ${above.join(' or ')})` : ''}`;
  const from = [p.since ? `set ${p.since}` : '', p.words ? `in ${who}'s words: "${p.words}"` : ''].filter(Boolean).join(', ');
  return `The policy is: ${list}${from ? ` (${from})` : ''}.`;
}
const suggestion = (s) => (minimumOf(s) === 'any' ? 'the model that fits the work' : `"${minimumOf(s)}"`);

// ---------- the helper launch ----------
const isHelperTool = (ev, s) => (s.helperTools || ['Agent', 'Task']).includes(ev.tool || ev.tool_name);
const inputOf = (ev) => ev.input || ev.tool_input || {};
function promptLine(text) {
  const m = String(text || '').match(/^[\s*_>#-]*model\s*:\s*([^\n]*)/im);
  return m ? m[1].trim() : '';
}
// A helper that only searches or reads: by its type (it has no tools that write), or, only when the settings allow it, by
// the line "Mode: read-only" in its prompt (a line is a claim, so it does not count unless the settings say so).
export function isReadOnly(ti, s) {
  if ((s.readOnlyAgents || []).includes(String(ti.subagent_type || ''))) return true;
  return !!s.readOnlyMarkerCounts && !!s.readOnlyMarker && low(ti.prompt).includes(low(s.readOnlyMarker));
}
// The model the lead chat runs on. No hook input carries it (only SessionStart, and not always), so it is read from
// ctx.leadModel when the loader gives it, else from the last "model" field in the tail of this chat's own record
// (transcript_path). That record's format is not promised by the docs; when nothing is found the answer is ''.
export function leadModel(ev, ctx) {
  const given = String((ctx && ctx.leadModel) || ev.model || '');
  if (given) return given;
  const f = ev.transcript_path;
  if (!f) return '';
  try {
    const fd = fs.openSync(f, 'r');
    try {
      const size = fs.fstatSync(fd).size;
      const len = Math.min(size, 65536);
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, size - len);
      const all = [...buf.toString('utf8').matchAll(/"model"\s*:\s*"(claude-[^"]+)"/g)];
      return all.length ? all[all.length - 1][1] : '';
    } finally { fs.closeSync(fd); }
  } catch { return ''; }
}

// Why the launch is refused, or '' when it may start.
export function launchFault(ev, ctx) {
  const s = S(ctx);
  const who = whoOf(ctx, s);
  const ti = inputOf(ev);
  const type = String(ti.subagent_type || '');
  const setting = String(ti.model || '').trim();
  const line = promptLine(ti.prompt);
  const lineFam = family(line, s);
  const fix = `The one thing to do: launch it again with the Agent tool's model setting set to ${suggestion(s)}${s.requireSetting ? '' : ', or a line "Model: <name> (why)" in the prompt'}.`;
  if (isReadOnly(ti, s) && s.readOnlyFloor !== 'hold') return '';
  const inherits = (s.inheritAgents || ['fork']).includes(type) || low(setting) === 'inherit';
  if (inherits) {
    const lead = family(leadModel(ev, ctx), s);
    if (!lead) {
      if (s.forkWhenLeadUnknown === 'allow') return '';
      return `this helper would run on the lead's own model (a fork, or the setting "inherit"), and this step cannot see which model the lead runs on, so it cannot prove the policy is held. ${policyLine(s, who)} ` +
        `The one thing to do: start a helper that is not a fork, with the model setting set to ${suggestion(s)}.`;
    }
    if (!meets(lead, s)) return `this helper would run on the lead's model, ${lead}, which is below the policy. ${policyLine(s, who)} ${fix}`;
    return '';
  }
  if (setting) {
    const fam = family(setting, s);
    if (!fam) return `the model setting "${setting.slice(0, 40)}" is not a model this check knows, so the policy cannot be proven. ${policyLine(s, who)} ${fix}`;
    if (!meets(fam, s)) return `it would run on ${fam}, which is below the policy. ${policyLine(s, who)} ${fix}`;
    if (lineFam && lineFam !== fam) return `its prompt says "Model: ${line.slice(0, 30)}" but the model setting says ${fam}, so its report would name the wrong model. The one thing to do: make the two agree.`;
    return '';
  }
  if (!line) return `it does not say which model it runs on (rule 12: every helper names its model). ${policyLine(s, who)} ${fix}`;
  if (!lineFam) return `its line "Model: ${line.slice(0, 30)}" names no model this check knows. ${policyLine(s, who)} ${fix}`;
  if (!meets(lineFam, s)) return `it names ${lineFam}, which is below the policy. ${policyLine(s, who)} ${fix}`;
  if (s.requireSetting) return `it names ${lineFam} only in a line of its prompt. A line is a claim; the model it really runs on is decided by the tool's model setting, or by the helper type's own default, which this step cannot see. ${fix}`;
  return '';
}

// ---------- a change of this check's settings ----------
const isPolicyFile = (p, s) => { const f = low(slash(p)); return !!f && (s.policyFiles || ['checks/models/settings.json']).some((x) => f.endsWith(low(x))); };
function readText(p) { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } }
function parse(text) { try { return JSON.parse(text); } catch { return undefined; } }
// The file's text after an Edit / MultiEdit / Write, or null when it cannot be known.
function afterWrite(tool, ti, before) {
  if (tool === 'Write') return String(ti.content ?? '');
  const edits = tool === 'MultiEdit' ? ti.edits || [] : [ti];
  if (before == null) return null;
  let t = before;
  for (const e of edits) {
    const o = String(e.old_string ?? ''); const n = String(e.new_string ?? '');
    if (!o) return null;
    t = e.replace_all ? t.split(o).join(n) : t.replace(o, () => n);
  }
  return t;
}
// The keys whose change weakens or moves the rule (everything but the free word lists).
export function ruleKeysChanged(before, after, s) {
  const free = new Set(s.freeKeys || ['_about']);
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  return [...keys].filter((k) => !free.has(k) && JSON.stringify((before || {})[k]) !== JSON.stringify((after || {})[k]));
}
const WRITE_SHELL = /(^|[^0-9&<>])>>?(?!&)|\b(tee|cp|mv|rm|del|erase|copy|move|ren|rename|touch|truncate|dd|install|rsync)\b|sed\s+-i|perl\s+-[a-z]*i|\b(set-content|add-content|out-file|remove-item|copy-item|move-item|new-item|rename-item|clear-content)\b|writefile|appendfile|\bgit\s+(checkout|restore|apply|reset|stash|mv|rm)\b|\bpython\d?\b|\bnode\s+(?!--test\b)|\bjq\b.*>/i;

// Why a change of the settings is refused, or '' when it may go ahead.
export function policyFault(ev, ctx) {
  const s = S(ctx);
  const who = whoOf(ctx, s);
  const tool = ev.tool || ev.tool_name || '';
  const ti = inputOf(ev);
  const words = ctx && !ctx.isHelperChat ? String(ctx.hisLast || '') : '';
  let target = '';
  let newMin = null; // the new minimum, when it changes and can be read
  if (['Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(tool)) {
    const p = ti.file_path || ti.notebook_path || '';
    if (!isPolicyFile(p, s)) return '';
    target = slash(p).split('/').slice(-4).join('/');
    const abs = path.isAbsolute(p) ? p : path.join((ev && ev.cwd) || (ctx && ctx.root) || process.cwd(), p);
    const beforeText = readText(abs);
    const afterText = afterWrite(tool, ti, beforeText);
    const before = beforeText == null ? {} : parse(beforeText);
    const after = afterText == null ? undefined : parse(afterText);
    if (afterText != null && after === undefined) return `this write would leave the models check's settings (${target}) unreadable, and an unreadable settings file switches its rules back to the defaults. The one thing to do: write valid JSON.`;
    if (after !== undefined && before !== undefined && !ruleKeysChanged(before, after, s).length) return ''; // only the free word lists change
    if (after !== undefined) {
      const was = low(((before || {}).policy || {}).minimum || 'any'), now = low((after.policy || {}).minimum || 'any');
      if (now !== was) newMin = now;
    }
  } else {
    const cmd = slash(ev.command || ti.command || '');
    if (!cmd || !/models\/+settings\.json/i.test(cmd)) return '';
    if (!WRITE_SHELL.test(cmd)) return '';
    target = 'the models settings file, by a shell command';
  }
  const why = `this changes the rules of the models check (${target}), and the model policy is ${who}'s to set`;
  if (ctx && ctx.isHelperChat) return `${why}; this is a helper chat, and nothing said in it is ${who}'s own word. The one thing to do: the lead asks ${who}, and the change is made in ${who}'s own chat after that message.`;
  const named = familiesIn(words, s);
  if (!named.length && !hasAny(words, s.policyWords || ['model', 'models'])) return `${why}, and ${who}'s latest own message does not speak of models. The one thing to do: ask ${who} in one sentence which models helpers may run on, then make the change after the answer.`;
  if (newMin) {
    const ok = newMin === 'any' ? hasAny(words, ['any model', 'any models', 'all models', 'every model', 'any named model']) : named.includes(newMin);
    if (!ok) return `${why}, and it sets the minimum to ${newMin}, which ${who}'s latest own message does not name. The one thing to do: change only what that message says.`;
  }
  if (!['Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(tool) && !named.length) return `${why}; this step cannot see what a shell command writes, and ${who}'s latest message names no model. The one thing to do: edit the file with the Edit tool after a message that names the model.`;
  return '';
}

// ---------- a helper's own report (SubagentHandback) ----------
export function handbackFault(ev, ctx) {
  const s = S(ctx);
  if (!s.handbackNeedsModel) return '';
  if (!(s.handbackTools || ['SubagentHandback']).includes(ev.tool || ev.tool_name)) return '';
  const text = String(inputOf(ev).message || '');
  if (!text.trim() || familiesIn(text, s).length || hasAny(text, s.modelWords)) return '';
  return 'this report does not say which model did the work (rule 12: say which model did what). The one thing to do: add one plain line naming the model you ran on, and send the report again.';
}

// ---------- the record of helpers, and the report ----------
const safe = (x) => String(x || 'no-session').replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 80);
function recordFile(ev, ctx) { return ctx && ctx.state ? path.join(ctx.state, 'checks', 'models', safe((ctx && ctx.sid) || ev.session_id) + '.jsonl') : ''; }
function readRecords(ev, ctx) {
  const t = readText(recordFile(ev, ctx) || '\0');
  if (!t) return [];
  return t.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}
function eventsList(ctx) {
  const e = ctx && ctx.events;
  if (Array.isArray(e)) return e;
  if (e && Array.isArray(e.tools)) return e.tools;
  return [];
}
// The helpers this chat started (from the record, and from this turn's events), each with its model family.
export function helpersOf(ev, ctx) {
  const s = S(ctx);
  const out = readRecords(ev, ctx).map((r) => ({ d: r.d, m: r.m }));
  for (const e of eventsList(ctx)) {
    const tool = e && (e.tool || e.tool_name || e.name);
    if (!(s.helperTools || ['Agent', 'Task']).includes(tool)) continue;
    const ti = e.input || e.tool_input || {};
    out.push({ d: String(ti.description || '').slice(0, 60), m: family(ti.model || promptLine(ti.prompt), s) || 'not named' });
  }
  return out;
}
export function reportFault(text, helpers, s) {
  if (!helpers.length) return '';
  if (!hasAny(text, s.helperWords) || !hasAny(text, s.reportWords)) return '';
  const ran = [...new Set(helpers.map((h) => h.m))];
  const named = familiesIn(text, s);
  const list = ran.join(', ');
  if (!named.length && !hasAny(text, s.modelWords)) return `the reply tells what helpers did but does not say which model did the work; the helpers of this chat ran on: ${list}. Say in one plain sentence which model did what (rule 12).`;
  if (named.length && !named.some((m) => ran.includes(m)) && !ran.includes('not named')) return `the reply names ${named.join(', ')} as the model, but the helpers of this chat ran on: ${list}. Say the model that really did the work.`;
  return '';
}

// ---------- the steps ----------
const DEBT = 'models:report-unsaid';
function logTo(ctx, event, detail) { try { ctx && ctx.log && ctx.log(event, detail); } catch { /* the log never stops a step */ } }
// Each step runs inside this guard. A safety check: on its own error it refuses the steps it governs (a helper launch,
// a change of its own settings) and says so; every other step is let through and the error is logged.
function guard(step, governs, body) {
  return (ev, ctx) => {
    try { return body(ev || {}, ctx || {}); } catch (err) {
      logTo(ctx, 'error', { check: 'models', step, error: String((err && err.message) || err).slice(0, 200) });
      let gov = false;
      try { gov = governs(ev || {}, ctx || {}); } catch { gov = true; }
      let who = 'the person';
      try { if (ctx && ctx.who) who = ctx.who; } catch { /* the message never depends on what broke */ }
      return gov ? { deny: `HIVE CHECK (models): this check broke on this step, so it stopped the step to be safe (it holds rule 12 and ${who}'s model policy). The one thing to do: run "node --test core/checks/models/check.test.mjs", fix what it shows, and try again.` } : null;
    }
  };
}
// Which steps this check governs, decided without the settings, so it still answers when they are what broke.
const governsPre = (ev) => {
  const ti = inputOf(ev);
  if (['Agent', 'Task'].includes(ev.tool || ev.tool_name)) return true;
  return /models[\\/]+settings\.json/i.test(String(ti.file_path || ti.notebook_path || '') + ' ' + String(ev.command || ti.command || ''));
};

const pretool = guard('pretool', governsPre, (ev, ctx) => {
  const s = S(ctx);
  if (isHelperTool(ev, s)) {
    const f = launchFault(ev, ctx);
    if (f) { logTo(ctx, 'deny', { check: 'models', why: 'launch' }); return { deny: `HIVE CHECK (models): I stopped this helper from starting, because ${f}` }; }
    return null;
  }
  const h = handbackFault(ev, ctx);
  if (h) { logTo(ctx, 'deny', { check: 'models', why: 'handback' }); return { deny: `HIVE CHECK (models): I stopped this report, because ${h}` }; }
  const p = policyFault(ev, ctx);
  if (p) { logTo(ctx, 'deny', { check: 'models', why: 'policy' }); return { deny: `HIVE CHECK (models): I stopped this step, because ${p}` }; }
  return null;
});

// After a helper launch: write it down with its model (for the report check), and say when a model it really ran on
// (resolvedModel, and every one in modelsUsed) is below the policy.
const posttool = guard('posttool', () => false, (ev, ctx) => {
  const s = S(ctx);
  if (!isHelperTool(ev, s)) return null;
  const ti = inputOf(ev);
  const resp = (ev.tool_response && typeof ev.tool_response === 'object' ? ev.tool_response : ev.response) || {};
  const realNames = [resp.resolvedModel, ...(Array.isArray(resp.modelsUsed) ? resp.modelsUsed : [])].filter(Boolean);
  const real = realNames.map((n) => family(n, s)).filter(Boolean);
  const inherits = (s.inheritAgents || ['fork']).includes(String(ti.subagent_type || '')) || low(ti.model) === 'inherit';
  const asked = family(ti.model, s) || family(promptLine(ti.prompt), s) || (inherits ? family(leadModel(ev, ctx), s) : '');
  const m = real[real.length - 1] || asked || 'not named';
  const f = recordFile(ev, ctx);
  if (f) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.appendFileSync(f, JSON.stringify({ t: Date.now(), d: String(ti.description || '').slice(0, 60), type: String(ti.subagent_type || ''), m, real: real.length > 0 }) + '\n'); }
  if (isReadOnly(ti, s) && s.readOnlyFloor !== 'hold') return null;
  const below = [...new Set(real.filter((r) => !meets(r, s)))];
  if (below.length) return { say: `HIVE CHECK (models): the helper "${String(ti.description || '').slice(0, 60)}" really ran on ${below.join(' and ')}, which is below the policy. ${policyLine(s, whoOf(ctx, s))} Stop it if it still runs, start it again on a model the policy allows, and say so in the next report.` };
  return null;
});

// The end of a reply: a report of helpers' work must say which model did it. A sitrep is left alone: by its own rule it
// names no models (lesson of 2026-11-19).
const stop = guard('stop', () => false, (ev, ctx) => {
  const s = S(ctx);
  if (ctx.isHelperChat) return null; // a helper chat's reply goes to its starter; its report is held at the hand-back
  if (s.sitrepWords && hasAny(ctx.hisLast || '', s.sitrepWords)) return { clear: [DEBT] };
  const text = String(ev.text ?? ev.last_assistant_message ?? '');
  const f = reportFault(text, helpersOf(ev, ctx), s);
  if (f) { logTo(ctx, 'debt', { check: 'models', key: DEBT }); return { debt: { key: DEBT, text: `About the model line: ${f}` } }; }
  return { clear: [DEBT] };
});

// When a helper stops: its last words must say which model did the work, so the lead can relay it. A helper that handed
// its report back with SubagentHandback was already held at that step, and its last words are not its report.
const helperstop = guard('helperstop', () => false, (ev, ctx) => {
  const s = S(ctx);
  const text = String(ev.text ?? ev.last_assistant_message ?? '');
  if (!text.trim()) return null;
  const handed = eventsList(ctx).some((e) => e && (s.handbackTools || ['SubagentHandback']).includes(e.tool || e.tool_name) && (!e.agent || !ev.agent_id || e.agent === ev.agent_id));
  if (handed) return null;
  if (familiesIn(text, s).length || hasAny(text, s.modelWords)) return null;
  return { say: `HIVE CHECK (models): the helper that just stopped${ev.agent_type ? ` (${ev.agent_type})` : ''} did not say which model did its work. When you relay it, say which model it ran on (rule 12).` };
});

export default {
  id: 'models',
  rule: 'rule 12',
  kind: 'safety',
  mode: 'refuse',
  about: 'Every helper names its model and runs at or above the model policy, the policy changes only by the words of the person who set it, and a report of helpers\' work says which model did it.',
  steps: { pretool, posttool, stop, helperstop },
};
