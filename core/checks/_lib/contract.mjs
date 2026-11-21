// The contract every check module follows (system/design/enforcement-2026-11-20.md, "The contract every check module
// follows"). This file is the one place the shape is written as code: the loader, the harness and the doctor all use it.
// The types are in types.d.ts next to this file.

export const STEPS = ['pretool', 'posttool', 'prompt', 'stop', 'helperstop'];
export const KINDS = ['safety', 'discipline'];
export const MODES = ['refuse', 'notice', 'off'];
// Which result keys a step may return. A key outside its steps makes the result malformed (an error of the check).
export const RESULT_STEPS = { deny: ['pretool'], say: STEPS, debt: ['stop'], clear: STEPS };
export const ID_RE = /^[a-z0-9][a-z0-9-]{0,47}$/;
export const MAX_TEXT = 2000;
export const MAX_DEBT_TEXT = 600;
export const MAX_KEY = 80;

const isStr = (s) => typeof s === 'string' && s.trim().length > 0;

// Checks the default export of a check.mjs. Returns a list of problems in plain words; empty means it is well formed.
export function validateCheck(def, folderId) {
  const p = [];
  if (!def || typeof def !== 'object') return ['check.mjs has no default export object'];
  if (!isStr(def.id)) p.push('id is missing');
  else if (!ID_RE.test(def.id)) p.push(`id "${def.id}" is not lower-case letters, digits and dashes`);
  else if (folderId && def.id !== folderId) p.push(`id "${def.id}" is not the folder name "${folderId}"`);
  if (!isStr(def.rule)) p.push('rule is missing (which rule or protocol it holds)');
  if (!KINDS.includes(def.kind)) p.push(`kind must be "safety" or "discipline", not ${JSON.stringify(def.kind)}`);
  if (def.mode !== undefined && !MODES.includes(def.mode)) p.push(`mode must be "refuse", "notice" or "off", not ${JSON.stringify(def.mode)}`);
  if (!isStr(def.about)) p.push('about is missing (one plain sentence)');
  if (!def.steps || typeof def.steps !== 'object') p.push('steps is missing');
  else {
    const names = Object.keys(def.steps);
    if (!names.length) p.push('steps is empty');
    for (const n of names) {
      if (!STEPS.includes(n)) p.push(`step "${n}" is not one of ${STEPS.join(', ')}`);
      else if (typeof def.steps[n] !== 'function') p.push(`step "${n}" is not a function`);
    }
  }
  const known = new Set(['id', 'rule', 'kind', 'mode', 'about', 'steps']);
  for (const k of Object.keys(def)) if (!known.has(k)) p.push(`unknown field "${k}"`);
  return p;
}

// Checks one debt. Returns [problems, normalised debt].
function validateDebt(d) {
  const p = [];
  if (!d || typeof d !== 'object') return [['a debt must be an object { key, text }'], null];
  if (!isStr(d.key) || d.key.length > MAX_KEY) p.push(`debt key must be a word of at most ${MAX_KEY} characters`);
  if (!isStr(d.text)) p.push('debt text is missing');
  if (d.auto !== undefined && typeof d.auto !== 'boolean') p.push('debt auto must be true or false');
  if (d.allow !== undefined) {
    const a = d.allow;
    if (!a || typeof a !== 'object') p.push('debt allow must be { tools, paths }');
    else {
      if (a.tools !== undefined && !(Array.isArray(a.tools) && a.tools.every(isStr))) p.push('debt allow.tools must be a list of tool names');
      if (a.paths !== undefined && !(Array.isArray(a.paths) && a.paths.every(isStr))) p.push('debt allow.paths must be a list of paths inside the notebook');
    }
  }
  for (const k of Object.keys(d)) if (!['key', 'text', 'auto', 'allow'].includes(k)) p.push(`unknown debt field "${k}"`);
  if (p.length) return [p, null];
  return [[], { key: d.key.trim(), text: d.text.trim().slice(0, MAX_DEBT_TEXT), auto: d.auto !== false, allow: { tools: (d.allow && d.allow.tools) || [], paths: (d.allow && d.allow.paths) || [] } }];
}

// Checks what a step returned. null/undefined is "nothing to say". Several keys may be combined in one object.
// Returns { problems, result: { deny, say, debts: [], clear: [] } }.
export function validateResult(step, r) {
  const result = { deny: '', say: '', debts: [], clear: [] };
  if (r === null || r === undefined) return { problems: [], result };
  if (typeof r !== 'object' || Array.isArray(r)) return { problems: ['a step must return null or an object'], result };
  const p = [];
  for (const k of Object.keys(r)) {
    if (!RESULT_STEPS[k]) { p.push(`unknown result key "${k}"`); continue; }
    if (!RESULT_STEPS[k].includes(step)) p.push(`"${k}" is not allowed at the ${step} step`);
  }
  if (r.deny !== undefined) { if (isStr(r.deny)) result.deny = r.deny.trim().slice(0, MAX_TEXT); else p.push('deny must be plain words'); }
  if (r.say !== undefined) { if (isStr(r.say)) result.say = r.say.trim().slice(0, MAX_TEXT); else p.push('say must be plain words'); }
  if (r.debt !== undefined) {
    for (const d of Array.isArray(r.debt) ? r.debt : [r.debt]) {
      const [dp, nd] = validateDebt(d);
      p.push(...dp);
      if (nd) result.debts.push(nd);
    }
  }
  if (r.clear !== undefined) {
    if (Array.isArray(r.clear) && r.clear.every(isStr)) result.clear = r.clear.map((k) => k.trim());
    else p.push('clear must be a list of debt keys');
  }
  if (p.length) return { problems: p, result: { deny: '', say: '', debts: [], clear: [] } };
  return { problems: [], result };
}
