// Runs one step of every check in a worker thread, so that a check that never returns (a loop with no end) can be
// stopped from outside: the hook ends the worker at its time limit and treats the step by kind (hook.mjs).
import { parentPort, workerData } from 'node:worker_threads';
import { loadAll, runStep } from './loader.mjs';
import { buildCtx, makeReader, makeLogger } from './ctx.mjs';

export async function stepIn(d) {
  const all = await loadAll(d.dir);
  const loaded = d.started ? all : { ...all, modules: all.modules.filter((m) => m.kind === 'safety'), broken: all.broken.filter((b) => b.kind === 'safety') };
  const reader = makeReader(d.root);
  const logFor = makeLogger(d.state, d.sid, d.step, null);
  const ctxFor = (mod) => buildCtx({ root: d.root, state: d.state, sid: d.sid, step: d.step, agentId: d.agentId, who: d.who, facts: d.facts, reader, logFor, mod, debts: d.debts });
  const res = await runStep(d.step, loaded, d.ev, ctxFor, { settings: d.settings, deadline: d.deadline, who: d.who });
  return {
    ...res, ran: [...res.ran],
    modules: all.modules.map((m) => ({ id: m.id, kind: m.kind, mode: m.mode })),
    broken: all.broken.map((b) => ({ id: b.id, kind: b.kind, problems: b.problems })),
  };
}

if (parentPort && workerData && workerData.__hiveChecks) {
  stepIn(workerData).then((r) => parentPort.postMessage({ ok: true, r }), (e) => parentPort.postMessage({ ok: false, error: String(e && e.message || e) }));
}
