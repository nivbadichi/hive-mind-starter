// The ctx object a check's step receives. One per check per step; the facts and the note cache are shared by every
// check of the same hook run. See types.d.ts for the shape.
import fs from 'node:fs';
import path from 'node:path';
import { appendLine } from './records.mjs';
import { approvedBy } from './his-words.mjs';

const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// The gates' word match: a word or phrase, not inside another word.
export function names(text, pattern) {
  const t = ' ' + String(text || '').toLowerCase() + ' ';
  if (!t.trim()) return false;
  if (pattern instanceof RegExp) return pattern.test(String(text || ''));
  if (Array.isArray(pattern)) return pattern.some((p) => names(text, p));
  const w = String(pattern || '').toLowerCase().trim();
  if (!w) return false;
  return new RegExp('(^|[^a-z0-9#])' + esc(w) + '($|[^a-z0-9])').test(t);
}

export function makeReader(root, cache = new Map()) {
  const base = path.resolve(root);
  return (rel) => {
    const key = String(rel || '');
    if (cache.has(key)) return cache.get(key);
    const abs = path.resolve(base, key);
    let text = '';
    if (abs === base || abs.startsWith(base + path.sep)) { try { text = fs.readFileSync(abs, 'utf8'); } catch {} }
    cache.set(key, text);
    return text;
  };
}

// logger(event, detail) is the gates' log when the gates call the checks, else a line in <state>/gates.log.
export function makeLogger(state, sid, step, given) {
  return (id) => (event, detail) => {
    const d = { check: id, step, ...(detail && typeof detail === 'object' ? detail : { detail: String(detail ?? '') }) };
    if (given) { try { given(String(event), d); } catch {} return; }
    if (!state || !fs.existsSync(state)) return;
    appendLine(path.join(state, 'gates.log'), { t: new Date().toISOString(), mode: 'checks', sid, event: String(event), ...d });
  };
}

export function buildCtx({ root, state, sid, step, agentId, who, facts, reader, logFor, mod, debts }) {
  const loaded = facts.loaded || [];
  const tails = new Set(loaded.map((n) => n.split(':').pop()));
  return Object.freeze({
    root, state, sid: sid || '', step, agentId: agentId || '', who: who || 'the person',
    hisLast: facts.hisLast || '',
    said: (pattern) => names(facts.hisLast || '', pattern),
    // hisNow: this step's prompt is his own message (at the step "at his message"; false for a helper's report).
    hisNow: facts.hisNow !== false,
    // His answers on question cards since his last own message: { question, answer }.
    cards: Object.freeze([...(facts.cards || [])]),
    // His word for an act: his latest own message names it, or he said yes on a card that asked about it.
    approved: (words) => { const list = Array.isArray(words) ? words : [words]; return names(facts.hisLast || '', list) || !!approvedBy(facts.cards || [], list.filter((w) => typeof w === 'string')); },
    isHelperChat: !!facts.isHelperChat,
    loaded,
    hasLoaded: (name) => { const n = String(name || '').toLowerCase(); return loaded.includes(n) || tails.has(n.split(':').pop()); },
    events: facts.events || [],
    read: reader,
    settings: mod.settings || {},
    debts: (debts || []).filter((d) => d.check === mod.id).map((d) => ({ key: d.key, text: d.text, status: d.status })),
    log: logFor(mod.id),
  });
}
