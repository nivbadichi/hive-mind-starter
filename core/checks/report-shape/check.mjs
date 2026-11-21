// The report-shape check (ticket T-B of system/design/architects-proposals-held-2026-11-20.md; proposal 5 of the
// Agent Architects breakdowns). When a helper stops, its report is read for its shape by core/report-shape/'s own
// faults(): the files it made or changed, the commands it ran (or "not checked"), its questions for the person (or
// "none"), and the model that did the work. Each part missing is said to the lead, so the report goes back to that
// helper before its work is joined. A whole report passes in silence. It reads only; it changes nothing.
import { faults } from '../../report-shape/report-shape.mjs';

const ID = 'report-shape';
const WORDS = {
  files: 'names no file it made or changed, and does not say nothing was built',
  checks: 'names no command that was run, and marks nothing "not checked"',
  questions: 'has no "Questions for the person" part with questions or "none"',
  model: 'does not say which model did the work',
};

function helperstop(ev, ctx) {
  const s = ctx.settings || {};
  const type = String(ev.agent_type || '');
  if ((s.skipAgentTypes || []).some((t) => t.toLowerCase() === type.toLowerCase())) return null;
  const text = String(ev.text || '').trim();
  if (!text) { ctx.log && ctx.log('report-empty', { agent: type || ev.agent_id || '' }); return null; }
  const want = new Set(s.parts || Object.keys(WORDS));
  const missing = faults(text).filter((f) => want.has(f.key));
  if (!missing.length) return null;
  const who = type ? `the ${type} helper` : 'the helper';
  const what = ev.report ? 'report' : 'last words (its delivered report was not seen, so this may be only its closing line)';
  ctx.log && ctx.log('report-shape', { agent: type || ev.agent_id || '', missing: missing.map((f) => f.key).join(',') });
  return { say: `HIVE CHECK (report-shape): the ${what} of ${who}${ev.agent_id ? ` (${String(ev.agent_id).slice(0, 40)})` : ''} ${missing.map((f) => WORDS[f.key] || f.text).join('; it ')}. Send it back to that helper for the missing part${missing.length === 1 ? '' : 's'} before joining its work, or say to ${ctx.who || 'the person'} what was not checked.` };
}

/** @type {import('../_lib/types').Check} */
export default {
  id: ID,
  rule: 'proposal 5 (a report names its files, checks, questions and model)',
  kind: 'discipline',
  mode: 'refuse',
  about: "When a helper stops, its report is read for its shape; each missing part (files, checks, questions, model) is said to the lead before the work is joined.",
  steps: { helperstop },
};
