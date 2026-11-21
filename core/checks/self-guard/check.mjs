// The self-guard check: the checks cannot be weakened quietly.
// Before a tool: Claude may not write an off switch, delete or empty the log, change an installed copy, run the
// installer, or make a check, its settings or the app's hooks weaker, unless the person names that act in their own
// message. While an installed copy differs from the notebook's and the person has not ruled, every step but reading stops.
// At the person’s message: the installed copies are compared with the notebook's by hash; hooks missing from the app's
// settings are said; a chat with no start record is said and given one; the canary says which hooks did not fire;
// a switch that changed is written to the log with who changed it. Every step leaves a canary mark.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as G from './lib.mjs';
import { prefilled, approvedBy } from '../_lib/his-words.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
let OWN_SETTINGS = null;
function settingsOf(ctx) {
  if (ctx && ctx.settings && ctx.settings.writeWords) return ctx.settings;
  if (!OWN_SETTINGS) OWN_SETTINGS = JSON.parse(fs.readFileSync(path.join(HERE, 'settings.json'), 'utf8'));
  return OWN_SETTINGS;
}
function logTo(ctx, P, event, detail) {
  try {
    if (ctx && typeof ctx.log === 'function') return ctx.log(event, detail);
    if (P) fs.appendFileSync(path.join(P.state, 'gates.log'), JSON.stringify({ t: new Date().toISOString(), event, ...detail }) + '\n');
  } catch {}
}
// The tools that only read, fixed here too, so they pass even when the settings file itself cannot be read.
const READ_TOOLS = ['Read', 'Grep', 'Glob', 'LS', 'NotebookRead', 'ToolSearch'];
const toolOf = (ev) => (ev && (ev.tool || ev.tool_name)) || '';
const inputOf = (ev) => ev.input || ev.tool_input || {};
const commandOf = (ev) => ev.command ?? inputOf(ev).command ?? '';
const sidOf = (ev) => ev.session_id || 'none';

const WHAT_TO_DO = {
  switch: 'Ask the person in one plain sentence whether to change this switch; it passes once their own message names it (for example "gates off").',
  log: 'The log is the person’s record of what was refused; it is never deleted or emptied by Claude. If they want it cleared, they say so in their own message.',
  installed: 'Installed copies change only through the installer, and the installer runs only when their own message asks for it (for example "reinstall the gates").',
  records: "The gates' records are written by the gates alone. Leave them; if something in them is wrong, tell the person.",
  own: "The self-guard check's records are written by that check alone.",
  hive: 'The Hive folder is written by Hive Mind\'s programs and by the person. Ask the person first.',
  weaker: 'Making a check softer or switching it off needs their own words in this chat (for example "switch the reply check to notice"). Stricter is always fine.',
  'check-source': "Deleting or moving the checks' files needs their own words in this chat.",
};
function allowedOnWord(ctx, P, label, S, words, file) {
  if (!G.saidAny(ctx, words)) return false;
  logTo(ctx, P, 'self-guard-allowed', { what: label, words: String(ctx.hisLast || '').slice(0, 120) });
  try {
    const f = path.join(P.own, 'allowed.json');
    const list = G.readJson(f, []).filter((x) => Date.now() - Date.parse(x.at) < 6 * 3600e3);
    list.push({ what: label, group: file ? G.groupOf(file, P) : '', at: new Date().toISOString(), words: String(ctx.hisLast || '').slice(0, 120) });
    G.writeJson(f, list.slice(-50));
  } catch {}
  return true;
}
function deny(ctx, P, what, why, todo, tool) {
  logTo(ctx, P, 'self-guard-deny', { check: 'self-guard', what: String(what).slice(0, 160), why, tool });
  return { deny: `HIVE GATE (self-guard): stopped ${what}, because ${why}. ${todo}` };
}

// A write through Write, Edit, MultiEdit or NotebookEdit.
function toolWrite(ev, ctx, P, S) {
  const tool = toolOf(ev), input = inputOf(ev);
  const file = input.file_path || input.notebook_path || input.path;
  const g = G.guardedPlace(file, P, S);
  if (!g || g.kind === 'check-source') return null;
  if (['app-settings', 'check-settings', 'check-module'].includes(g.kind)) {
    let before = null; try { before = fs.readFileSync(file, 'utf8'); } catch {}
    const why = G.weakens(g.kind, before, G.textAfter(tool, input, before), S);
    if (!why) return null;
    if (allowedOnWord(ctx, P, g.label, S, S.switchWords, file)) return null;
    return deny(ctx, P, `a change to ${g.label}`, `${why}, and that makes a check weaker without the person’s word`, WHAT_TO_DO.weaker, tool);
  }
  const words = g.kind === 'installed' ? S.installWords : S.switchWords;
  if (allowedOnWord(ctx, P, g.label, S, words, file)) return null;
  return deny(ctx, P, `a write to ${g.label}`, g.kind === 'switch' ? 'Claude may not work its own off switch' : 'Claude may not change what guards it', WHAT_TO_DO[g.kind] || WHAT_TO_DO.hive, tool);
}
// A shell command.
function shellStep(ev, ctx, P, S) {
  const look = G.shellLook(commandOf(ev), P, S);
  if (look.installer) {
    if (allowedOnWord(ctx, P, 'the installer', S, S.installWords)) return { pass: true };
    return deny(ctx, P, 'running the installer', 'it replaces the installed copies of the checks and the hooks, and their own message did not ask for it', WHAT_TO_DO.installed, toolOf(ev));
  }
  if (!look.marks.length) return null;
  const strong = look.marks.filter((m) => m.kind !== 'check-source');
  if (strong.length) {
    if (look.reader && !look.writes) return null;
    if (!look.writes && /^(git|node --test)/.test(look.text.trim()) && !strong.some((m) => m.kind === 'switch')) return null;
    if (allowedOnWord(ctx, P, strong[0].label, S, S.switchWords.concat(S.installWords))) return { pass: true };
    return deny(ctx, P, `a command that touches ${strong[0].label}`, look.writes ? `it writes or deletes there (${look.words[0] || 'a redirect'})` : 'a program run there can change it, and a command that only reads would start with a reading word', WHAT_TO_DO[strong[0].kind] || WHAT_TO_DO.switch, toolOf(ev));
  }
  if (look.writes && look.words.some((w) => /^(rm|rmdir|del|erase|rd|mv|move|ren|rename|remove-item|ri|move-item|rename-item|rmsync|unlink|git rm|git mv|git checkout|git restore|git reset|git clean|git stash|truncate|clear-content|-delete|os\.remove|os\.unlink|unlinksync|rmdirsync|rimraf|shutil)$/.test(w))) {
    if (allowedOnWord(ctx, P, look.marks[0].label, S, S.switchWords)) return { pass: true };
    return deny(ctx, P, `a command that deletes, moves or resets ${look.marks[0].label}`, 'it takes a check away or puts an older one back', WHAT_TO_DO['check-source'], toolOf(ev));
  }
  return null;
}
// While installed copies differ and he has not ruled. "strict" (the default until he answers held.question): every
// step but reading stops. "narrow": only the acts that matter stop (publish, delete, install, spend, a write to the
// checks, the gates, the Hive folder or Claude's settings), everywhere; the rest of the work goes on. In both, the
// steps that look or that fix it are never stopped: reading, the installer's help and dry run, the comparison, and
// the installer run on his word.
const slashLow = (p) => String(p || '').replace(/\\/g, '/').toLowerCase();
function mattersNarrow(ev, P, S) {
  const tool = toolOf(ev), input = inputOf(ev);
  const H = S.held || {};
  if (tool.startsWith('mcp__')) {
    const short = tool.split('__').pop().toLowerCase();
    return (H.connectorReads || []).some((r) => short === r || short.startsWith(r + '_') || short.startsWith(r + '-')) ? '' : `the connector tool ${short}`;
  }
  if ((S.writeTools || []).includes(tool)) {
    const f = input.file_path || input.notebook_path || input.path;
    if (!f) return '';
    if (G.guardedPlace(f, P, S)) return `a write to ${G.guardedPlace(f, P, S).label}`;
    const s = slashLow(path.resolve(String(f)));
    if (/\/core\/(checks|gates)\//.test(s) || /\/\.git\/hooks\//.test(s)) return 'a write to the checks or the gates';
    return '';
  }
  if ((S.shellTools || []).includes(tool)) {
    const cmd = String(commandOf(ev));
    const l = G.shellLook(cmd, P, S);
    if (l.installer) return 'running the installer';
    if (l.marks.some((m) => m.kind !== 'check-source') && !(l.reader && !l.writes)) return `a command that touches ${l.marks.find((m) => m.kind !== 'check-source').label}`;
    if (l.writes && /core[\\/]+(checks|gates)[\\/]/i.test(cmd)) return 'a command that writes to the checks or the gates';
    for (const p of H.matters || []) { let re; try { re = new RegExp(p, 'i'); } catch { continue; } if (re.test(cmd)) return `a command that may publish, delete, install or spend (${cmd.trim().slice(0, 60)})`; }
    return '';
  }
  if (/^(buy|purchase|create_or_transfer_domain)/i.test(tool)) return `the paid tool ${tool}`;
  return '';
}
function heldStatus(P) {
  const st = G.readJson(path.join(P.own, 'status.json'), null);
  if (!st || !st.differs || !st.differs.length) return null;
  const ruled = G.readJson(path.join(P.own, 'ruling.json'), null);
  if (ruled && ruled.fingerprint === st.fingerprint) return null;
  return st;
}

function pretool(ev, ctx) {
  let P;
  try {
    P = G.places(ctx);
    const S = settingsOf(ctx);
    if ((S.canary || {}).mode !== 'off') G.mark(P, sidOf(ev), 'pretool', { tool: toolOf(ev) });
    const tool = toolOf(ev);
    // A question card that comes with its answers filled in was answered by whoever wrote it, not by him: his answers
    // on a card are his word for an act, so a card may never carry its own (2026-11-20).
    if (tool === 'AskUserQuestion' && prefilled(inputOf(ev))) return deny(ctx, P, 'a question card that already holds its answers', 'the person\'s answers on a card count as their word, so a card may not arrive answered', 'Send the card with its questions only; the person gives the answers.', tool);
    let r = null;
    if ((S.writeTools || []).includes(tool)) r = toolWrite(ev, ctx, P, S);
    else if ((S.shellTools || []).includes(tool)) r = shellStep(ev, ctx, P, S);
    if (r && r.deny) return r;
    const passedOnWord = !!(r && r.pass);
    const held = heldStatus(P);
    if (held && !passedOnWord && !(S.readTools || []).includes(tool)) {
      if ((S.shellTools || []).includes(tool)) { const l = G.shellLook(commandOf(ev), P, S); if ((l.reader && !l.writes) || (l.installerLooks && !l.writes)) return null; }
      const list = held.differs.slice(0, 2).map((d) => `${d.dst} (${d.why})`).join('; ');
      const ask = 'Tell the person in one plain sentence and ask: put the notebook\'s copies back (they say "reinstall the gates"), or keep the installed ones (they say "accept the installed copies"). Reading, the installer\'s help and its dry run still work.';
      if ((S.held || {}).bite === 'narrow') {
        const what = mattersNarrow(ev, P, S);
        if (!what) return null;
        return deny(ctx, P, `${what} (${tool})`, `an installed copy of the checks is not the notebook's (${list}) and the person has not ruled on it yet; while that holds, steps that publish, delete, install, spend or change the checks wait`, ask, tool);
      }
      return deny(ctx, P, `this step (${tool})`, `an installed copy of the checks is not the notebook's (${list}) and the person has not ruled on it yet`, ask, tool);
    }
    return null;
  } catch (e) {
    logTo(ctx, P, 'self-guard-error', { step: 'pretool', error: String(e && e.message || e).slice(0, 200) });
    // Reading stays possible, so the break can be looked into; every other step is stopped.
    if (READ_TOOLS.includes(toolOf(ev))) return null;
    return { deny: `HIVE GATE (self-guard): the self-guard check broke (${String(e && e.message || e).slice(0, 120)}), and it is a safety check, so this step is stopped to be safe. Tell the person in one plain sentence; reading files still works.` };
  }
}

function prompt(ev, ctx) {
  let P;
  try {
    P = G.places(ctx);
    const S = settingsOf(ctx);
    const sid = sidOf(ev);
    const say = [];
    // 1. A chat with no start record: the start step did not run, so the gates would do nothing.
    const startFile = path.join(P.state, 'gates', 'start', `${String(sid).replace(/[^\w-]/g, '_').slice(0, 120)}.json`);
    if (sid !== 'none' && !fs.existsSync(startFile)) {
      G.writeJson(startFile, { session: sid, by: 'self-guard', at: new Date().toISOString(), cwd: ev.cwd || '' });
      logTo(ctx, P, 'self-guard-no-start', { what: 'a chat with no start record' });
      say.push('This chat had no start record: the start step did not run or failed, so the checks were off until now. A record is written, so they act from the next step. Tell the person in one plain sentence, and read the start notes yourself (system/start-here.md and system/in-flight.md).');
    }
    // 2. The canary.
    if ((S.canary || {}).mode !== 'off') {
      const m = G.mark(P, sid, 'prompt', { own: ctx.hisNow !== false, preWatched: (S.canary || {}).preWatched });
      for (const i of m.issues) { logTo(ctx, P, 'self-guard-canary', { what: i.slice(0, 120) }); say.push(`Canary: ${i}. Tell the person in one plain sentence.`); }
    }
    // 3. The installed copies against the notebook's.
    const cmp = G.compareInstalled({ root: P.root, state: P.state, claudeDir: P.claudeDir, S, budgetMs: S.hashBudgetMs || 50 });
    const statusFile = path.join(P.own, 'status.json');
    const prev = G.readJson(statusFile, {});
    G.writeJson(statusFile, { at: new Date().toISOString(), differs: cmp.differs, fingerprint: cmp.fingerprint, checked: cmp.checked, pending: cmp.pending, ms: cmp.ms, logged: prev.fingerprint === cmp.fingerprint ? prev.logged : '' });
    if (cmp.differs.length) {
      const ruled = G.readJson(path.join(P.own, 'ruling.json'), null);
      if (!(ruled && ruled.fingerprint === cmp.fingerprint)) {
        // Only his own message of this step rules (2026-11-20, seen live: a helper's report holding these words was
        // taken as his ruling). A report, a notice or another chat's message is never his; nor is a message kept from
        // before. His yes on a question card that asked exactly this rules too, at the card (the step after a tool).
        if (G.saidNow(ctx, S.acceptWords)) {
          G.writeJson(path.join(P.own, 'ruling.json'), { fingerprint: cmp.fingerprint, at: new Date().toISOString(), words: String(ctx.hisLast || '').slice(0, 160), differs: cmp.differs });
          logTo(ctx, P, 'self-guard-ruled', { ruling: 'the installed copies are accepted as they are', words: String(ctx.hisLast || '').slice(0, 120) });
          say.push(`The person ruled: the installed copies that differ from the notebook (${cmp.differs.length}) are accepted as they are, until they change again. Say so in one line.`);
        } else {
          if (prev.logged !== cmp.fingerprint) { logTo(ctx, P, 'self-guard-differs', { what: cmp.differs.slice(0, 3).map((d) => `${d.dst}: ${d.why}`).join('; ') }); G.writeJson(statusFile, { ...G.readJson(statusFile, {}), logged: cmp.fingerprint }); }
          const list = cmp.differs.slice(0, 5).map((d) => `${d.dst} (${d.why})`).join('; ');
          say.push(`The installed copies of the checks differ from the notebook's in ${cmp.differs.length} place${cmp.differs.length === 1 ? '' : 's'}: ${list}${cmp.differs.length > 5 ? ' and more' : ''}. Until the person rules, every step except reading is refused. Ask the person in one plain sentence: put the notebook's copies back (they say "reinstall the gates"), or keep the installed ones (they say "accept the installed copies").${G.saidNow(ctx, S.installWords) ? ' The person has just asked for the reinstall: run the installer now.' : ''}`);
        }
      }
    }
    // 4. Hooks missing from the app's settings: said at the start of a chat, and again when the list changes.
    const miss = G.hooksMissing({ root: P.root, claudeDir: P.claudeDir, cwd: ev.cwd || ctx.cwd || '' });
    const beatFile = path.join(P.own, 'beat', `${String(sid).replace(/[^\w-]/g, '_').slice(0, 120)}.hooks`);
    const key = miss.map((x) => x.why).join('|');
    let last = null; try { last = fs.readFileSync(beatFile, 'utf8'); } catch {}
    if (miss.length && last !== key) {
      logTo(ctx, P, 'self-guard-hooks', { what: miss.map((x) => x.why).join('; ').slice(0, 200) });
      say.push(`Hooks are missing from the app's settings, so some checks never run: ${miss.map((x) => x.why).join('; ')}. Tell the person in one plain sentence; the installer puts them back when they ask for it.`);
    }
    try { fs.mkdirSync(path.dirname(beatFile), { recursive: true }); fs.writeFileSync(beatFile, key); } catch {}
    // 5. Switches that changed since the last look, with who changed them.
    const snapFile = path.join(P.own, 'switches.json');
    const before = G.readJson(snapFile, null);
    const now = G.switchSnapshot(P);
    if (before) {
      const allowed = G.readJson(path.join(P.own, 'allowed.json'), []);
      for (const ch of G.switchChanges(before, now)) {
        const by = allowed.slice().reverse().find((a) => (a.group && ch.what.startsWith(a.group)) || ch.what.startsWith(a.what));
        const who = by ? `Claude, on the person’s word: "${String(by.words).slice(0, 70)}"` : 'not through any chat\'s tools that the checks saw: by hand, by another program, or in a chat without the checks';
        logTo(ctx, P, 'self-guard-switch', { what: ch.what, from: ch.from, to: ch.to, who });
        say.push(`A switch changed since the last message: ${ch.what} went from ${ch.from} to ${ch.to}, by ${who}.`);
      }
    }
    G.writeJson(snapFile, now);
    return say.length ? { say: say.join('\n') } : null;
  } catch (e) {
    logTo(ctx, P, 'self-guard-error', { step: 'prompt', error: String(e && e.message || e).slice(0, 200) });
    return { say: `The self-guard check broke at this message (${String(e && e.message || e).slice(0, 120)}). It is a safety check: its steps before a tool will refuse until it works again. Tell the person in one plain sentence.` };
  }
}

function markOnly(step) {
  return (ev, ctx) => {
    let P;
    try { P = G.places(ctx); if ((settingsOf(ctx).canary || {}).mode !== 'off') G.mark(P, sidOf(ev), step, { tool: toolOf(ev) }); }
    catch (e) { logTo(ctx, P, 'self-guard-error', { step, error: String(e && e.message || e).slice(0, 200) }); }
    return null;
  };
}
// After a tool: the canary mark, and his answer on a question card that asked exactly whether to keep the installed
// copies is his ruling (the card's question names it and he said yes, or the answer he chose names it).
function posttool(ev, ctx) {
  markOnly('posttool')(ev, ctx);
  let P;
  try {
    if (toolOf(ev) !== 'AskUserQuestion' || ctx.isHelperChat) return null;
    P = G.places(ctx);
    const S = settingsOf(ctx);
    const st = G.readJson(path.join(P.own, 'status.json'), null);
    if (!st || !st.differs || !st.differs.length) return null;
    const hit = approvedBy(ctx.cards || [], S.acceptWords);
    if (!hit) return null;
    G.writeJson(path.join(P.own, 'ruling.json'), { fingerprint: st.fingerprint, at: new Date().toISOString(), words: `question card: ${String(hit.card.question).slice(0, 80)} = ${String(hit.card.answer).slice(0, 60)}`, differs: st.differs });
    logTo(ctx, P, 'self-guard-ruled', { ruling: 'the installed copies are accepted as they are', words: String(hit.card.answer).slice(0, 120), via: 'question card' });
    return { say: `The person ruled on the question card: the installed copies that differ from the notebook (${st.differs.length}) are accepted as they are, until they change again. Say so in one line.` };
  } catch (e) { logTo(ctx, P, 'self-guard-error', { step: 'posttool', error: String(e && e.message || e).slice(0, 200) }); return null; }
}

export default {
  id: 'self-guard',
  rule: 'the checks themselves (rules 1 and 7: nothing weakens a check without the person’s word)',
  kind: 'safety',
  mode: 'refuse',
  about: 'Claude cannot switch off or weaken its own checks without the person’s word, the installed checks must match the notebook, and every hook must be seen to fire.',
  steps: { pretool, posttool, prompt, stop: markOnly('stop') },
};
