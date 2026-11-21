// The debt store and its rule (system/design/enforcement-2026-11-20.md, layer 3).
// A reply cannot be un-sent and sending it twice is forbidden, so a fault in a reply becomes a debt:
//   reply N carries a fault      -> the debt is "open"; at the person's next message it is put in front of Claude;
//   reply N+1 still carries it   -> the debt is "overdue": every tool except reading is refused (in the lead's chat)
//   a reply that no longer carries it (auto debt), or a step that returns { clear: [key] } -> the debt is cleared.
// "Still carries it": for an auto debt (the default) the check's stop step ran and raised the same key again; for a
// debt with auto: false it is still there at the next reply's end because nothing cleared it.
// A debt of a check in "notice" mode is said at every message but never becomes overdue.
// One store per chat: <hive folder>/checks/debts/<chat>.json. Writes take a short lock, because tools can finish at once.
import fs from 'node:fs';
import path from 'node:path';
import { readJson, writeJson } from './records.mjs';

export function load(file) {
  const s = readJson(file, null);
  return s && Array.isArray(s.items) ? { replies: s.replies || 0, items: s.items } : { replies: 0, items: [] };
}

// Read, change and write the store under a lock. fn(store) changes it in place and returns a value.
export function update(file, fn) {
  const lock = file + '.lock';
  const until = Date.now() + 300;
  let got = false;
  while (!got) {
    try { fs.mkdirSync(lock, { recursive: false }); got = true; } catch (e) {
      if (e.code === 'ENOENT') { fs.mkdirSync(path.dirname(file), { recursive: true }); continue; }
      try { if (Date.now() - fs.statSync(lock).mtimeMs > 2000) { fs.rmSync(lock, { recursive: true, force: true }); continue; } } catch {}
      if (Date.now() > until) break; // a stuck lock never holds the work up: write without it
      const t = Date.now() + 5; while (Date.now() < t) { /* wait a moment */ }
    }
  }
  try {
    const store = load(file);
    const r = fn(store);
    writeJson(file, store);
    return r;
  } finally { if (got) { try { fs.rmSync(lock, { recursive: true, force: true }); } catch {} } }
}

const same = (a, check, key) => a.check === check && a.key === key;

// A check clears its own debts only.
export function applyClears(store, check, keys) {
  const before = store.items.length;
  store.items = store.items.filter((d) => !(d.check === check && keys.includes(d.key)));
  return before - store.items.length;
}

// At the end of a reply. raised: [{ check, debt, notice }]; ran: the ids whose stop step ran without an error;
// known: every check id found (broken ones too); clears: [{ check, keys }]. Returns what changed, for the log.
export function afterReply(store, { raised, ran, known, clears }) {
  store.replies = (store.replies || 0) + 1;
  const n = store.replies;
  const changed = { opened: [], overdue: [], cleared: [], dropped: [] };
  for (const c of clears || []) for (const k of c.keys) if (store.items.some((d) => same(d, c.check, k))) { changed.cleared.push(c.check + ':' + k); }
  for (const c of clears || []) applyClears(store, c.check, c.keys);
  const keep = [];
  for (const d of store.items) {
    if (!known.has(d.check)) { changed.dropped.push(d.check + ':' + d.key); continue; } // its check is gone
    const again = raised.find((r) => same({ check: r.check, key: r.debt.key }, d.check, d.key));
    if (again) {
      d.text = again.debt.text; d.allow = again.debt.allow; d.auto = again.debt.auto; d.notice = !!again.notice;
      if (!d.notice && d.status !== 'overdue') { d.status = 'overdue'; d.overdueAt = n; changed.overdue.push(d.check + ':' + d.key); }
      keep.push(d); continue;
    }
    if (d.auto && ran.has(d.check)) { changed.cleared.push(d.check + ':' + d.key); continue; } // the fault is gone
    if (!d.auto && !d.notice && d.status !== 'overdue' && d.since < n) { d.status = 'overdue'; d.overdueAt = n; changed.overdue.push(d.check + ':' + d.key); }
    keep.push(d);
  }
  for (const r of raised) {
    if (keep.some((d) => same(d, r.check, r.debt.key))) continue;
    keep.push({ check: r.check, key: r.debt.key, text: r.debt.text, auto: r.debt.auto, allow: r.debt.allow, notice: !!r.notice, status: 'open', since: n, at: Date.now() });
    changed.opened.push(r.check + ':' + r.debt.key);
  }
  store.items = keep;
  return changed;
}

export function overdue(store) { return store.items.filter((d) => d.status === 'overdue' && !d.notice); }

// The words put in front of Claude at the person's message while debts are open.
export function promptText(store, who) {
  const od = overdue(store);
  const open = store.items.filter((d) => !od.includes(d));
  const parts = [];
  if (od.length) parts.push(`HIVE DEBT, OVERDUE (every tool except reading is refused until a reply clears it): ${od.map((d) => `[${d.check}] ${d.text}`).join(' ')} Your next reply must not carry these faults again; it clears them.`);
  if (open.length) parts.push(`HIVE DEBT (from your last reply, which reached ${who} as it was): ${open.map((d) => `[${d.check}] ${d.text}`).join(' ')} ` +
    (open.some((d) => !d.notice) ? 'Put this right in this reply, without mentioning this note. If this reply still carries it, every tool except reading is refused until a reply clears it.' : 'Put this right in this reply, without mentioning this note.'));
  return parts.join('\n');
}
