#!/usr/bin/env node
// Hive Mind gates. One script, one mode per hook event:
//   pretool    PreToolUse   design gate, stage gate, helper-prompt gate, helper-model gate, proof-part gate, yes gate
//   posttool   PostToolUse  writes the records: design reads, skills loaded, files written, checks run; a helper's
//                           report (Agent result, SubagentHandback) goes to the questions list
//   subagentstop SubagentStop a helper's last words go to the questions list (when it handed nothing over)
//   prompt     UserPromptSubmit  reminder line; mid-chat refresh; correction detector; long-chat notice; notes the ask
//   stop       Stop         reply check, saved-preference check, "Used:" check, "done" without proof, sitrep, inside words
//                           (faults are carried to their next message; only "refuse" sends a reply back, never a sitrep)
//   precompact PreCompact   tells the summary what to keep; clears the design record
//   fit        (a command)  node gates.mjs fit <words>: the skills, connectors and protocols that fit a piece of work
// Every newer check has a mode in settings.json: "off", "notice" (never blocks: logs and reminds) or "refuse".
// Failing: the script as a whole fails OPEN (exit 0, no output) and logs to ~/.claude/hive/gates.log. Inside it each
// check runs on its own (guard): a discipline check that breaks lets the step through; a safety check (publish, yes)
// that breaks on a step it is about stops that one step (CHECK_KIND below).
// The gates do nothing when ~/.claude/hive/gates-off exists (and Claude cannot create that file, or weaken the
// settings, unless their latest own message asks: the self guard). When the notebook is missing, only the safety checks
// run (publish, yes, self guard), on their built-in settings. A chat with no start record runs every check (2026-11-20:
// a start that failed never switches the gates off). A missing notebook is said out loud, once per chat, at the
// person's message. The notebook is found as the start step finds it (HIVE_ROOT, config.json, ~/hive-mind).
// The check modules (core/checks/<id>/, the contract of 2026-11-20) are run at every step after the gates' own safety
// checks, through the loader in core/checks/_lib/ (nothing, logged, when it is not there).
//   where     (a command)  prints where the gates look for the notebook and whether it is there (for the health check)
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';

const T0 = Date.now();
const MODE = process.argv[2] || '';
const HOME = process.env.HIVE_HOME || os.homedir();
const STATE = process.env.HIVE_STATE || path.join(HOME, '.claude', 'hive');
// Where the notebook is, found exactly as the start step finds it: HIVE_ROOT if set; else "root" in
// <hive folder>/config.json (the installer writes it); else ~/hive-mind.
function rootFromConfig() {
  try {
    const c = JSON.parse(fs.readFileSync(path.join(STATE, 'config.json'), 'utf8').replace(/^﻿/, ''));
    const r = String(c.root || c.notebook || '').trim();
    if (r) return r === '~' ? HOME : r.replace(/^~[\\/]/, HOME + path.sep);
  } catch {}
  return '';
}
const ROOT = process.env.HIVE_ROOT || rootFromConfig() || path.join(HOME, 'hive-mind');
const SKILLS_DIR = process.env.HIVE_SKILLS_DIR || path.join(HOME, '.claude', 'skills');
const GDIR = path.join(STATE, 'gates');
const LOG = path.join(STATE, 'gates.log');
const OFF = path.join(STATE, 'gates-off');

// A gate must never hold the person up: give up quietly after 2.5 s. The prompt hook may run the mid-chat refresh
// (its own 4 s limit for the fetch, a total budget of 8 s), so it gets 9 s; the hook's own limit is 10 s.
const LIMIT_MS = MODE === 'prompt' ? 9000 : 2500;
// Only when run as the hook: a program that imports this file (the tests) keeps its own time.
const RUN_AS_HOOK = !!process.argv[1] && import.meta.url.toLowerCase().endsWith(path.basename(process.argv[1]).toLowerCase());
if (RUN_AS_HOOK) setTimeout(() => { log('timeout', {}); flush(OUTBOX); process.exit(0); }, LIMIT_MS).unref();


let INPUT = {};
let SID = '';

// ---------- small helpers ----------
function log(event, detail) {
  try {
    if (!fs.existsSync(STATE)) return;
    try { if (fs.statSync(LOG).size > 1_000_000) fs.renameSync(LOG, LOG + '.1'); } catch {}
    fs.appendFileSync(LOG, JSON.stringify({ t: new Date().toISOString(), mode: MODE, sid: SID, event, ms: Date.now() - T0, ...detail }) + '\n');
  } catch {}
}
// The gates and the check modules give Claude Code one answer: everything goes into OUTBOX and is written once, at the
// end (the loader's contract, core/checks/README.md "How the gates call it"). flush() writes it once, also when the
// time limit ends the run, so a refusal already decided is never lost to a slow step.
const OUTBOX = []; function out(obj) { OUTBOX.push(obj); }
let FLUSHED = false;
function flush(list) { if (FLUSHED) return; FLUSHED = true; for (const o of list) process.stdout.write(typeof o === 'string' ? o : JSON.stringify(o)); }
function safe(s) { return String(s || '').replace(/[^\w-]/g, '_').slice(0, 120); }
function readJson(p, fallback) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; } }
function writeJson(p, v) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(v)); }
function appendLine(p, v) { try { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.appendFileSync(p, JSON.stringify(v) + '\n'); } catch {} }
function readLines(p) { try { return fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; } }
function hasAny(text, words) { const t = ' ' + String(text).toLowerCase() + ' '; return (words || []).some((w) => new RegExp('(^|[^a-z#])' + String(w).toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($|[^a-z])').test(t)); }

const STAGE_WORDS = ['discover', 'define', 'plan', 'design', 'build', 'verify', 'release', 'maintain', 'close', 'paused', 'not set up'];
const DEFAULTS = {
  enabled: true,
  reply: { mode: 'notice', maxWords: 150, minReportWords: 40, checkFileNames: true, checkProgressMap: true, checkUsedLine: true,
    longAskWords: ['in detail', 'detailed', 'full report', 'full document', 'everything', 'step by step', '#long'],
    techAskWords: ['path', 'file', 'files', 'code', 'command', 'script', 'log', 'error', '#tech'] },
  reminder: 'Hive rules: talk like a friend: whole sentences, plain words, say why. Name things by what they are for them; give a needed word half a sentence of meaning. Under 150 words, no file names or code. Progress as a sitrep. Used: line after design work. Design first needs direction, taste, hive-scout.',
  design: { stagesThatNeedDirection: ['design', 'build'], defaultTasteNotes: ['me/taste.md'],
    scoutSkill: 'hive-scout', extensions: ['.tsx', '.jsx', '.css', '.scss', '.html', '.htm', '.vue', '.svelte', '.astro', '.svg'],
    skipFolders: ['node_modules', '.next', 'dist', 'build', 'out', '.git', '.vercel', 'coverage'],
    figmaWriteTools: ['use_figma', 'send_code_to_figma', 'generate_diagram', 'create_new_file', 'upload_assets'] },
  helpers: { readOnlyAgents: ['Explore', 'web-fetch', 'claude-code-guide'], readOnlyMarker: 'Mode: read-only', alsoKnownSkills: [],
    ownerOnly: { mode: 'notice', skills: [] } },
  intake: { enabled: true, list: 'inbox/sources.md', skill: 'hive-intake', maxItems: 12, ignoreHosts: ['localhost', '127.0.0.1'] },
  refresh: { mode: 'on', everySeconds: 120, fetchTimeoutMs: 4000, budgetMs: 8000, maxNames: 5 },
  stage: { mode: 'notice', words: STAGE_WORDS, beforeBuild: ['discover', 'define', 'plan', 'design', 'not set up'],
    codeExtensions: ['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.py', '.ps1', '.psm1', '.sh', '.css', '.scss', '.html', '.htm', '.vue', '.svelte', '.astro', '.swift', '.kt', '.java', '.c', '.cpp', '.h', '.cs', '.go', '.rs', '.rb', '.php', '.sql'],
    notesFolders: ['projects', 'me', 'inbox', 'knowledge', 'log', 'ledger', 'archive'] },
  model: { mode: 'refuse', exemptAgents: ['fork'], allowed: [] },
  modelFor: { 'planning and review': 'opus (the strongest)', 'building with judgment': 'sonnet (the middle one)', 'search, counting, moving, formatting': 'haiku (the smallest)' },
  correction: { mode: 'on', log: 'corrections.log', words: ['for the last time', 'i told you', 'i already said', 'i already told you', 'again?', "why aren't you", 'why are you not', "why didn't you", 'why did you not', 'stop doing', 'how many times', "i've said", 'i said this before'] },
  preference: { mode: 'notice', words: ['always', 'never', 'from now on', 'i prefer', 'i want you to', "i'd rather", 'i would rather', 'every time', 'each time', 'make sure you', 'remember that', "don't ever", 'do not ever'],
    saveTargets: ['me/', 'system/rules.md', 'system/decisions.md', 'system/decisions-in-force.md', 'system/registry.json'] },
  usedCheck: { mode: 'notice', ignoreWords: ['run', 'init', 'loop', 'schedule', 'none', 'skill', 'skills'] },
  proof: { mode: 'notice', claimWords: ['done', 'fixed', 'works', 'working now', 'passes', 'passing', 'passed', 'published', 'all green', 'is live', 'shipped'],
    checkWords: ['test', 'tests', 'spec', 'build', 'check', 'lint', 'tsc', 'vitest', 'jest', 'pytest', 'playwright', 'eslint', 'typecheck', 'verify', '--test'] },
  yes: { mode: 'refuse', yesWords: ['yes', 'yep', 'yeah', 'go ahead', 'do it', 'approved', 'approve', 'ok', 'okay', 'sure', 'confirm', 'confirmed'],
    actions: [], deleteWords: ['delete', 'remove', 'clean', 'wipe', 'erase', 'empty'], paidTools: ['buy_domain', 'create_or_transfer_domain'], paidWords: ['buy', 'purchase', 'pay', 'register', 'transfer'],
    paidPatterns: ['^vercel\\s+domains?\\s+(buy|transfer-in|renew)\\b', '^vercel\\s+(buy|transfer-in)\\b'],
    sendTools: ['send_message', 'send_email', 'send_mail', 'reply', 'forward', 'create_event', 'respond_to_event', 'post_message', 'chat_post_message', 'slack_send_message', 'add_issue_comment', 'add_reply_to_pull_request_comment', 'reply_to_board_thread', 'start_board_thread', 'reply-to-comment', 'comment-on-design'],
    sendWords: ['send', 'email', 'e-mail', 'mail', 'reply', 'answer', 'forward', 'post', 'invite', 'message', 'comment'],
    publishWords: ['deploy', 'publish', 'production', 'prod', 'go live', 'live', 'release', 'preview'],
    installWords: ['install', 'add the package', 'add the skill', 'add the connector', 'add the server', 'connect'],
    deleteAllowFolders: ['node_modules', '.next', 'dist', '.turbo', 'coverage', '.playwright-cli', '.playwright-mcp', 'playwright-report', 'test-results'],
    ownCleanup: { mode: 'on' },
    bareMaxWords: 8, fillerWords: ['please', 'thanks', 'thank', 'you', 'go', 'ahead', 'it', 'that', 'this', 'now', 'then', 'fine', 'great', 'good', 'alright', 'all', 'right', 'do', 'absolutely', 'definitely', 'of', 'course', 'yes'],
    holdWords: ['but', 'first', 'wait', 'not', 'no', 'later', 'before', 'after', 'if', 'unless', 'only', 'except', 'tomorrow', 'stop', 'hold', "don't", 'dont', 'never'],
    notYetWords: ['but first', 'wait', 'not yet', 'hold on', 'hold off', 'before you', 'later', 'tomorrow', 'not now', 'first tell me', 'first show me', 'first check'],
    negations: ['not', "don't", 'dont', 'never', 'without', "doesn't", "won't", 'nothing', 'nor', 'stop', 'avoid', 'cannot', "can't"] },
  selfGuard: { mode: 'refuse',
    offWords: ['gates off', 'switch off the gates', 'switch the gates off', 'turn off the gates', 'turn the gates off', 'disable the gates', 'pause the gates', 'gates-off'],
    weakenWords: ['softer', 'soften', 'less strict', 'loosen', 'weaken', 'switch off', 'turn off', 'switch it off', 'turn it off', 'disable', 'to notice', 'a notice', 'a reminder', 'reminder only', 'to off', 'mode off'],
    installWords: ['install the gates', 'reinstall', 'uninstall', 'update the gates', 'install them', 'hooks', 'hook', 'claude settings', 'settings.json', 'permission', 'permissions', 'update-config', 'check module', 'check modules', 'join the checks'],
    hooksSettings: '/\\.claude/settings(\\.local)?\\.json$' },
  checks: { folder: 'core/checks' },
  longChat: { mode: 'on', maxMessages: 60 },
  ticket: { mode: 'notice', heading: 'How it will be proven', parts: ['Today', 'Steps', 'Must pass', 'Files touched'] },
  handout: { mode: 'refuse', maxAtOnce: 6, staleMinutes: 120 },
  quiet: { mode: 'on', finishedWords: ['done', 'finished', 'built', 'fixed', 'shipped', 'completed', 'is ready', 'are ready', 'published', 'is live', 'went live'],
    decisionWords: ['should i', 'shall i', 'do you want', 'want me to', 'which one', 'which do you', 'ok to', 'okay to', 'can i go', 'may i', 'approve', 'go ahead', 'pick', 'choose', 'prefer', 'yes or no'] },
  publish: { mode: 'refuse', holdFile: 'publish-hold',
    patterns: ['^(npm|pnpm|yarn)\\s+publish\\b', '^netlify\\s+deploy\\b', '^wrangler\\s+(deploy|publish|pages\\s+deploy)\\b', '^firebase\\s+deploy\\b', '^gh\\s+release\\s+create\\b',
      '^(powershell|pwsh|bash|sh|cmd|start-process)\\b.*\\bpublish(-public|-quiet)?\\.ps1\\b', '^(\\S*[\\\\/])?publish(-public|-quiet)?\\.ps1\\b',
      '^gh\\s+workflow\\s+run\\b', '^gh\\s+api\\b.*\\/dispatches\\b', '^gh\\s+workflow\\s+enable\\b'],
    gitPublishTools: ['push_files', 'create_or_update_file', 'delete_file', 'merge_pull_request'], defaultBranches: ['main', 'master', 'gh-pages', 'production', 'prod', 'live', 'release'],
    vercelDeploy: ['deploy', 'promote', 'redeploy', 'rollback', 'alias'],
    vercelQuiet: ['env', 'ls', 'list', 'link', 'logs', 'inspect', 'whoami', 'login', 'logout', 'pull', 'dev', 'build', 'domains', 'dns', 'certs', 'project', 'projects', 'teams', 'switch', 'help', 'init', 'git', 'integration', 'bisect', 'remove', 'rm', 'curl', 'httpstat', 'cache', 'blob', 'telemetry', 'open', 'target', 'microfrontends', 'mcp', 'install', 'guidance'],
    tools: ['create_deployment', 'request_promote', 'deploy_to_vercel', 'promote_deployment', 'theme_publish', 'publish-digital-product', 'request_rollback',
      'assign_alias', 'start_rolling_release', 'approve_rolling_release_stage', 'complete_rolling_release', 'publish-brand-template'],
    liftWords: ['lift the hold', 'remove the hold', 'delete the hold', 'end the hold', 'drop the hold', 'clear the hold', 'release the hold', 'take the hold off', 'take off the hold', 'lift the publish hold', 'remove the publish hold', 'delete the publish hold'],
    liftReplyWords: ['hold'],

    testWords: ['test', 'testing', 'as a test', 'try', 'trying', 'trial', 'dry run', 'smoke', 'probe', 'experiment', 'see if', 'see whether', 'sanity'],
    dryRunFlags: ['--dry-run', '--dryrun', '-whatif', '-dryrun'],
    askWords: ['publish', 'deploy', 'go live', 'live', 'production', 'prod', 'online', 'release'] },
  asked: { mode: 'notice', decisions: 'system/decisions.md', topics: [
    { name: 'publishing or going live', ask: ['publish', 'go live', 'going live', 'put it online', 'deploy', 'make it live', 'push it live'], decided: ['publish', 'published', 'go live', 'go-live', 'deploy', 'online'] },
    { name: 'installing', ask: ['install', 'installing', 'installation'], decided: ['install', 'installs', 'installation', 'installations'] }] },
  savedLine: { mode: 'notice', targets: ['me/', 'system/rules.md', 'system/decisions.md', 'system/decisions-in-force.md', 'system/lessons.md', 'system/preferences.md', 'system/registry.json'],
    claimWords: ['i saved', "i've saved", 'i have saved', 'saved it', 'saved this', 'saved that', 'i noted', "i've noted", 'noted it', 'wrote it down', 'written down', 'i recorded', 'added it to the notes', 'added it to the rules', 'added it to the decisions'] },
  modelLine: { mode: 'notice', helperWords: ['helper', 'helpers', 'subagent', 'subagents', 'sub-agent', 'reviewer', 'checker', 'scout'],
    reportWords: ['reported', 'found', 'finished', 'came back', 'built', 'wrote', 'reviewed', 'checked', 'made', 'did', 'fixed'],
    modelWords: ['opus', 'sonnet', 'haiku', 'fable', 'strongest model', 'middle model', 'smallest model', 'the strongest', 'the middle one', 'the smallest'] },
  reviewFirst: { mode: 'notice', reviews: 'system/reviews', alsoNames: [],
    verdictWords: ['recommend', 'i recommend', "i'd use", 'i would use', "i'd pick", 'i would pick', 'go with', 'worth it', 'worth using', 'worth installing', 'safe to use', 'safe to install', 'is safe', 'is good', 'is great', 'is solid', 'is better', 'better than', 'the best', 'best choice', 'should use', 'should install', 'do not use', "don't use", 'avoid it', 'verdict'],
    hedgeWords: ['not reviewed', 'no review', 'review first', 'after the review', 'once reviewed', 'before the review'] },
  fit: { mode: 'on', registry: 'system/registry.json', announce: ['design', 'motion'], maxSkills: 8, maxConnectors: 5,
    kinds: { design: ['design', 'redesign', 'screen', 'screens', 'page', 'pages', 'layout', 'hero', 'landing', 'ui', 'interface', 'wireframe', 'prototype', 'restyle', 'css', 'component', 'website', 'site'],
      build: ['build', 'implement', 'code', 'fix', 'bug', 'script', 'feature', 'refactor', 'gate', 'hook', 'program', 'function'],
      motion: ['animate', 'animation', 'animations', 'motion', 'transition', 'gsap', 'scroll effect'],
      research: ['research', 'compare', 'look up', 'precedent', 'precedents', 'scout', 'find out'],
      documents: ['document', 'pdf', 'deck', 'slides', 'spreadsheet', 'word file', 'report'],
      data: ['chart', 'charts', 'dashboard', 'data', 'analysis', 'metrics'] },
    categories: { build: 'coding' },
    always: { design: ['hive-scout', 'impeccable'], motion: ['animate'] },
    connectors: { design: ['figma', 'canva', 'built-in-browser', 'playwright', 'shadcn-ui-components'], build: ['github', 'playwright', 'vercel'], research: ['chrome', 'built-in-browser'], documents: ['google-docs-sheets-and-slides', 'drive'], motion: ['built-in-browser', 'playwright'] },
    protocols: { design: ['rule-4', 'rule-13', 'rule-14'], build: ['rule-4', 'rule-5', 'rule-14', 'rule-15'], motion: ['rule-13', 'rule-14'], research: ['rule-3', 'rule-10'], all: ['rule-12'] } },
  skillsFit: { mode: 'notice' },
  sitrep: { mode: 'on', maxWords: 120, extraWords: 60,
    askWords: ['sitrep', 'sit rep', 'sit-rep', 'status?', "what's the status", 'what is the status', 'status update', 'where are we', 'where do we stand', 'how far along', "what's left", 'what is left'],
    stateWords: ['done', 'finished', 'chosen', 'ready', 'being worked on', 'in work', 'in progress', 'under way', 'being built', 'being checked', 'being tested', 'not started', 'not yet', 'stuck', 'blocked', 'waiting', 'paused', 'not checked'],
    needsWords: ['needs you', 'waiting on you', 'waiting for you'],
    faultWords: ['broke', 'broken', 'failed', 'fails', 'fault', 'problem', 'error', 'risk', 'danger', 'stuck', 'lost'],
    helperWords: ['helper', 'helpers', 'subagent', 'subagents', 'sub-agent', 'sub-agents', 'agent', 'agents', 'the lead', 'the checker', 'the fixer', 'reviewer', 'worktree'] },
  plainWords: { mode: 'notice', maxNamed: 4, skillNames: true,
    explainMarks: ['(', ' (', ' means', ' meaning', ' that is', ' i.e.', ' which is', ' which are', ' is what', ' stands for', ' is a ', ' is an ', ' is the ', ' are the ', ', a ', ', an ', ', the ', ' - ', ' – ', ' — ', ': '],
    words: {} },
  questions: { mode: 'on', program: 'core/engine/questions.mjs', ingest: ['ingest'], lineArgs: ['line'], listArgs: ['list', '--open', '--json'], timeoutMs: 1500, maxOpen: 8,
    say: 'Ask these now, before anything else in your reply:' },
  decidedFor: { mode: 'notice',
    decidedWords: ['i decided', "i've decided", 'i have decided', 'i went ahead and', 'i chose to', "i've chosen to", 'i settled on', 'already decided', 'i assumed you meant', 'i took it that you meant', 'i guessed', 'i parked', "i've parked", 'parked it', 'parked them'],
    kinds: [
      { name: 'reversing what they said', words: ['instead of what you', 'reversed', 'reverse', 'undid', 'overrode', 'went against'] },
      { name: 'changing what strangers read', words: ['public', 'the site', 'website', 'front page', 'home page', 'published', 'publish', 'live page', 'headline', 'tagline'] },
      { name: 'spending', words: ['paid', 'pay', 'bought', 'buy', 'spent', 'spend', 'subscription', 'credits'] },
      { name: 'deleting', words: ['deleted', 'delete', 'removed', 'remove', 'wiped', 'erased'] },
      { name: 'guessing what they meant', words: ['you meant', 'what you meant', 'guessed', 'assumed'] },
      { name: 'holding a question back', words: ['question', 'questions', 'for the end', 'until the end'] }] },
};
// Each check is safety or discipline. A discipline check that breaks lets the step through and logs "error";
// a safety check that breaks stops the step it is about (only that step, never all work) and logs "error".
export const CHECK_KIND = { design: 'discipline', stage: 'discipline', helpers: 'discipline', model: 'discipline', ticket: 'discipline',
  yes: 'safety', publish: 'safety', 'publish-detect': 'safety', reply: 'discipline', intake: 'discipline', preference: 'discipline', usedCheck: 'discipline', proof: 'discipline',
  correction: 'discipline', refresh: 'discipline', longChat: 'discipline', asked: 'discipline', savedLine: 'discipline', modelLine: 'discipline',
  reviewFirst: 'discipline', fit: 'discipline', skillsFit: 'discipline', sitrep: 'discipline', plainWords: 'discipline', questions: 'safety', decidedFor: 'discipline',
  selfGuard: 'safety', hold: 'safety', handout: 'discipline', ownerOnly: 'discipline', checks: 'safety', debts: 'safety' };
// Runs one check on its own: an error in it is logged and the other checks still run. HIVE_GATES_CRASH_CHECK=<name>
// makes that one check throw, for the tests.
function guard(name, fn, fallback) {
  try {
    if (process.env.HIVE_GATES_CRASH_CHECK === name) throw new Error('test crash in ' + name);
    return fn();
  } catch (e) { log('error', { where: name, kind: CHECK_KIND[name] || 'discipline', error: String(e && e.message || e).slice(0, 200) }); return fallback; }
}
function today() {
  if (process.env.HIVE_DATE) return process.env.HIVE_DATE;
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function loadSettings() {
  const s = readJson(path.join(ROOT, 'core', 'gates', 'settings.json'), null);
  if (!s) return DEFAULTS;
  const m = { ...DEFAULTS, ...s };
  for (const k of Object.keys(DEFAULTS)) {
    const d = DEFAULTS[k];
    if (d && typeof d === 'object' && !Array.isArray(d)) m[k] = { ...d, ...((s[k] && typeof s[k] === 'object') ? s[k] : {}) };
  }
  return m;
}
let S = DEFAULTS;
// The mode of a check: "off", "notice" or "refuse" ("on" for the checks that only add a line). Anything else: the default.
function M(name, def) {
  const v = String((S[name] && S[name].mode) || def).toLowerCase();
  return ['off', 'notice', 'refuse', 'on'].includes(v) ? v : def;
}

// Paths: absolute, forward slashes, lower case, so they compare on Windows.
function norm(p, base) {
  if (!p) return '';
  let s = String(p).trim().replace(/^["']+|["']+$/g, '');
  if (s === '~' || s.startsWith('~/') || s.startsWith('~\\')) s = path.join(HOME, s.slice(1));
  if (process.platform === 'win32' && (s === '/tmp' || s.startsWith('/tmp/'))) s = path.join(os.tmpdir(), s.slice(4)); // Git Bash /tmp
  const m = s.match(/^\/([a-zA-Z])\/(.*)$/); // Git Bash style /c/Users/...
  if (m) s = `${m[1]}:/${m[2]}`;
  s = path.isAbsolute(s) ? path.resolve(s) : path.resolve(base || ROOT, s);
  s = s.replace(/\\/g, '/');
  return process.platform === 'win32' ? s.toLowerCase() : s;
}
function noteAbs(p) { // a path in a state header is inside the notebook unless absolute or ~
  const t = String(p).trim();
  if (!t) return '';
  if (t.startsWith('~') || path.isAbsolute(t) || /^\/[a-zA-Z]\//.test(t)) return norm(t);
  return norm(path.join(ROOT, t));
}
function globToRe(g) {
  const s = g.trim().replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase()
    .replace(/[.+^${}()|[\]]/g, '\\$&').replace(/\*\*\/?/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]').replace(/\u0000/g, '.*');
  return new RegExp('^' + s + '$');
}
function under(abs, folder) { return abs === folder || abs.startsWith(folder + '/'); }

// ---------- the projects, read from their state headers ----------
function header(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const h = {};
  if (!m) return h;
  for (const line of m[1].split(/\r?\n/)) {
    const k = line.match(/^([a-z_]+):\s*(.*?)\s*$/);
    if (k && !(k[1] in h)) h[k[1]] = k[2];
  }
  return h;
}
let PROJECTS = null;
function projects() {
  if (PROJECTS) return PROJECTS;
  PROJECTS = [];
  const dir = path.join(ROOT, 'projects');
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return PROJECTS; }
  for (const name of names) {
    const sf = path.join(dir, name, 'state.md');
    let text;
    try { text = fs.readFileSync(sf, 'utf8'); } catch { continue; }
    const h = header(text);
    const p = { name, title: h.project || name, stage: h.stage || '', folder: h.folder ? norm(h.folder) : '', stateFile: sf, planApproved: (h.plan_approved || '').trim() };
    p.stageWord = (S.stage.words || STAGE_WORDS).find((w) => p.stage.toLowerCase().startsWith(String(w).toLowerCase())) || '';
    const dd = h.design_direction;
    if (dd === undefined || dd === '') {
      const needs = S.design.stagesThatNeedDirection.some((st) => p.stage.toLowerCase().startsWith(st));
      p.status = needs ? 'unnamed' : 'none';
    } else if (/^none\b/i.test(dd)) {
      p.status = 'none';
    } else {
      p.status = 'gated';
      p.direction = noteAbs(dd);
      const taste = h.taste_notes ? h.taste_notes.split(/[;,]/) : S.design.defaultTasteNotes;
      p.taste = taste.map(noteAbs).filter((t) => t && fs.existsSync(t)); // a missing taste note is never demanded
      p.interface = (h.interface || '').split(/[;,]/).map((g) => g.trim()).filter(Boolean).map(globToRe);
    }
    PROJECTS.push(p);
  }
  return PROJECTS;
}
function projectFor(absPath) {
  let best = null;
  for (const p of projects()) {
    if (!p.folder) continue;
    if (under(absPath, p.folder) && (!best || p.folder.length > best.folder.length)) best = p;
  }
  return best;
}
function relIn(p, abs) { return abs === p.folder ? '' : abs.slice(p.folder.length + 1); }
function inSkipped(rel) { return rel.split('/').slice(0, -1).some((s) => S.design.skipFolders.includes(s)); }
function isInterface(p, abs) {
  if (!p || !p.folder || abs.endsWith('.md')) return false;
  const rel = relIn(p, abs);
  if (inSkipped(rel)) return false;
  if (S.design.extensions.some((e) => rel.endsWith(e))) return true;
  return (p.interface || []).some((re) => re.test(rel));
}

// ---------- the records ----------
// The design record (per chat and per helper; cleared by compaction).
function recFile(agentId) { return path.join(GDIR, 'rec', safe(SID) + (agentId ? '__' + safe(agentId) : '') + '.json'); }
function loadRec(agentId) { return readJson(recFile(agentId), { reads: [], scout: false }); }
function saveRec(agentId, rec) { writeJson(recFile(agentId), rec); }
function clearRecs() {
  try {
    const d = path.join(GDIR, 'rec');
    for (const f of fs.readdirSync(d)) if (f === safe(SID) + '.json' || f.startsWith(safe(SID) + '__')) fs.rmSync(path.join(d, f), { force: true });
  } catch {}
}
// The chat record (kept through compaction): the person's message count, the notes' version this chat last saw,
// the long-chat flags. Only the prompt and precompact hooks write it, one at a time.
const chatFile = () => path.join(GDIR, 'chat', safe(SID) + '.json');
const loadChat = () => readJson(chatFile(), { prompts: 0 });
const saveChat = (c) => writeJson(chatFile(), c);
// Append-only lists, safe when several tools finish at once: the skills loaded in this chat (by it or its helpers),
// the files this chat wrote, and this turn's events (files written, checks run; reset at each message from the person).
const skillsFile = () => path.join(GDIR, 'chat', safe(SID) + '.skills');
const writesFile = () => path.join(GDIR, 'chat', safe(SID) + '.writes');
const eventsFile = () => path.join(GDIR, 'turn', safe(SID) + '.events');
const helpersFile = () => path.join(GDIR, 'chat', safe(SID) + '.helpers'); // every helper this chat started, with its model
const turnFile = () => path.join(GDIR, 'turn', safe(SID) + '.json');

const notebookFound = () => fs.existsSync(path.join(ROOT, 'system', 'rules.md'));
// The gates are installed but cannot find the notebook: every gate would be off without a word. Say it, loudly, once
// per chat, at the person's message: to them (systemMessage) and to Claude (context). Nothing is stopped.
function sayNotebookMissing() {
  if (!fs.existsSync(STATE) || fs.existsSync(OFF) || S.enabled === false || notebookFound()) return;
  const mark = path.join(GDIR, 'blind', safe(SID || 'no-chat') + '.json');
  if (SID && fs.existsSync(mark)) return;
  try { writeJson(mark, { root: ROOT }); } catch {}
  log('error', { error: `notebook not found at ${ROOT}: only the safety checks run` });
  const cfg = path.join(STATE, 'config.json');
  out({
    systemMessage: `HIVE MIND: most checks are off. They look for your notebook at ${ROOT} and it is not there. Publishing, deleting, paying, installing and switching the checks off are still stopped.`,
    hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: `HIVE GATES MOSTLY OFF: the gates look for the notebook at ${ROOT} (from HIVE_ROOT, else ${cfg}, else ~/hive-mind) and it is not there, so only the safety checks run in this chat (publish, yes, self guard). Tell the person first, in plain words, then follow the hive-doctor skill: if the notebook was moved, running the installer again from its new place fixes it.` },
  });
}

// What runs: false (switched off by the gates-off file or "enabled": false), 'safety' (the notebook is missing: the
// publish check, the yes gate and the self guard still run, on the built-in settings) or 'all'. A chat with no start
// record runs everything: a start that failed, timed out or never ran no longer switches the gates off (fault 4 of the roast).
let SAFETY_ONLY = false;
// 2026-11-20 (the second roast, N15): the off switch no longer silences the four safety checks. With gates-off (or
// "enabled": false) the publish hold, the hold file, the self guard and the yes gate still run, and every message of
// theirs says the gates are off, from the file itself; the check modules and the discipline checks are off.
const offOn = () => fs.existsSync(OFF) || S.enabled === false;
function active() {
  if (offOn()) return 'safety';
  if (!notebookFound()) return 'safety';
  return 'all';
}
// Said at every message while the off switch is there: to them and to Claude.
function sayOff() {
  if (!offOn()) return;
  let since = ''; try { since = fs.statSync(OFF).mtime.toISOString().slice(0, 16).replace('T', ' '); } catch {}
  log('gates-off-said', { since });
  out({
    systemMessage: `HIVE MIND: the gates are switched off${since ? ' (the off switch was made ' + since + ')' : ''}. Publishing, deleting, paying, installing and the checks' own files are still guarded. Delete the file gates-off in the Hive folder to switch them on.`,
    hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: `HIVE GATES OFF: the off switch (${OFF}) is there${since ? ', made ' + since : ''}, so only the four safety checks run (publish hold, the hold file, self guard, yes). Tell the person in one plain sentence first. Claude may never make that file itself; if they did not ask for it, say so.` },
  });
}

// The empty copy has no helper-chat mode (the main copy has): these answer "not a helper chat".
function helperMarkIn() { return null; }
function helperOf() { return null; }

// ---------- reading a shell command ----------
// Splits a command into simple commands (at ; && || | & and new lines, and inside $( ) <( ) { }), honouring quotes, and
// drops heredoc bodies and PowerShell here-strings: they are data, not commands. A > inside quotes (a grep or sed
// pattern) is text, not a redirect. Each simple command gets its words (quotes removed), the files its unquoted
// > or >> writes to, and its text with the quoted parts blanked.
function dropBodies(cmd) {
  const lines = String(cmd).replace(/\r/g, '').split('\n');
  const kept = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const hd = l.match(/(?<!<)<<-?\s*(['"]?)([A-Za-z_][\w-]*)\1/);
    if (hd) {
      kept.push(l);
      while (i + 1 < lines.length && lines[i + 1].trim() !== hd[2]) i++;
      i++; // the end word
      continue;
    }
    const hs = l.match(/@(['"])\s*$/);
    if (hs) {
      kept.push(l.slice(0, hs.index) + "''");
      while (i + 1 < lines.length && !lines[i + 1].startsWith(hs[1] + '@')) i++;
      if (i + 1 < lines.length) { i++; kept[kept.length - 1] += lines[i].slice(2); }
      continue;
    }
    kept.push(l);
  }
  return kept.join('\n');
}
function lex(text) {
  const toks = [];
  let cur = null;
  const begin = () => { if (!cur) cur = { v: '', q: false, bare: '' }; };
  const flush = () => { if (cur) { toks.push({ t: 'w', ...cur }); cur = null; } };
  const sep = () => { flush(); toks.push({ t: 's' }); };
  const n = text.length;
  let i = 0;
  while (i < n) {
    const c = text[i], d = text[i + 1];
    if (c === "'") {
      const j = text.indexOf("'", i + 1); const end = j < 0 ? n : j;
      begin(); cur.q = true; cur.v += text.slice(i + 1, end); cur.bare += "''"; i = end + 1; continue;
    }
    if (c === '"') {
      let j = i + 1, s = '';
      while (j < n && text[j] !== '"') { if ((text[j] === '\\' || text[j] === '`') && text[j + 1] === '"') { s += '"'; j += 2; continue; } s += text[j]; j++; }
      begin(); cur.q = true; cur.v += s; cur.bare += '""'; i = j + 1; continue;
    }
    if (c === '\\' && d && d !== '\n' && /[\s;&|<>'"()]/.test(d)) { begin(); cur.v += d; cur.bare += d; i += 2; continue; }
    if (c === '#' && !cur && (i === 0 || /\s/.test(text[i - 1]))) { while (i < n && text[i] !== '\n') i++; continue; }
    if (c === '\n' || c === ';') { sep(); i++; continue; }
    if (c === '|') { if (d !== '|') { flush(); toks.push({ t: 's', pipe: true }); } else sep(); i += (d === '|' || d === '&') ? 2 : 1; continue; }
    if (c === '&') {
      if (d === '>') { flush(); i += 2; if (text[i] === '>') i++; toks.push({ t: 'r', v: '>' }); continue; }
      flush(); toks.push(d === '&' ? { t: 's' } : { t: 's', amp: true }); i += d === '&' ? 2 : 1; continue; // a single & : in PowerShell the call operator
    }
    if (c === '$' && d === '(') { sep(); i += 2; continue; }
    if (c === '@' && d === '(' && !cur) { sep(); i += 2; continue; }
    if (c === '(' || c === ')') { sep(); i++; continue; }
    if ((c === '{' || c === '}') && !cur) { sep(); i++; continue; }
    if (c === '<') {
      if (d === '(') { sep(); i += 2; continue; }
      flush(); if (d === '<') { i += 2; if (text[i] === '<') { i++; toks.push({ t: 'r', v: '<<<' }); continue; } if (text[i] === '-') i++; toks.push({ t: 'r', v: '<<' }); continue; } else i++;
      toks.push({ t: 'r', v: '<' }); continue;
    }
    if (c === '>') {
      if (cur && /[=-]$/.test(cur.v)) { cur.v += c; cur.bare += c; i++; continue; } // => and -> are not redirects
      if (d === '(') { sep(); i += 2; continue; }
      if (cur && /^(\d|\*)$/.test(cur.v) && !cur.q) cur = null; // 2> and *> name a stream, not a word
      flush(); i++;
      if (text[i] === '>' || text[i] === '|') i++;
      if (text[i] === '&') { i++; while (i < n && /[\d-]/.test(text[i])) i++; continue; } // 2>&1: a copy, no file
      toks.push({ t: 'r', v: '>' }); continue;
    }
    if (/\s/.test(c)) { flush(); i++; continue; }
    begin(); cur.v += c; cur.bare += c; i++;
  }
  flush();
  return toks;
}
export function parseShell(cmd) {
  const toks = lex(dropBodies(cmd));
  const segs = [];
  let seg = { words: [], redirects: [], bare: [] };
  let piped = false;
  const end = () => { if (seg.words.length || seg.redirects.length) { if (piped) seg.piped = true; segs.push(seg); } seg = { words: [], redirects: [], bare: [] }; };
  for (let i = 0; i < toks.length; i++) {
    const k = toks[i];
    if (k.t === 's') { end(); piped = !!k.pipe; if (k.amp) seg.afterAmp = true; continue; }
    if (k.t === 'r') {
      // What a command reads on its standard input: a < file (its name kept), a heredoc or a here-string (text).
      if (k.v === '<<' || k.v === '<<<') seg.stdinText = true;
      const nx = toks[i + 1];
      if (nx && nx.t === 'w') { i++; if (k.v === '>') seg.redirects.push(nx.v); else if (k.v === '<') (seg.inputs = seg.inputs || []).push(nx.v); }
      continue;
    }
    seg.words.push(k.v); seg.bare.push(k.bare);
  }
  end();
  for (const s of segs) s.bare = s.bare.join(' ');
  return segs;
}

// What a simple command writes to. Commands that only read (ls, dir, cat, type, Get-ChildItem, Get-Content,
// git status/log/diff, grep, rg, wc, head, tail, node --test, ...) write nothing but their unquoted redirects.
const PS_ALIASES = new Set(['sc', 'ac', 'ni', 'ri', 'mi', 'cpi', 'rni', 'clc', 'gc', 'gci', 'sl', 'del', 'erase', 'rd', 'md', 'copy', 'move', 'ren']);
const PS_SWITCHES = new Set(['force', 'recurse', 'append', 'nonewline', 'passthru', 'whatif', 'confirm', 'noclobber', 'verbose', 'container', 'file', 'directory', 'hidden', 'asbytestream', 'raw']);
const PS_PATH_PARAMS = new Set(['path', 'literalpath', 'filepath', 'destination', 'outfile']);
const DELETE_CMDS = new Set(['rm', 'rmdir', 'rd', 'del', 'erase', 'unlink', 'shred', 'remove-item', 'ri']);
const READ_CMDS = new Set(['ls', 'dir', 'cat', 'type', 'gc', 'get-content', 'get-childitem', 'gci', 'head', 'tail', 'grep', 'rg', 'wc', 'echo', 'sed', 'awk', 'cut', 'sort', 'uniq', 'find', 'select-string', 'git', 'diff', 'comm', 'tr', 'less', 'more', 'stat', 'test-path', 'write-output', 'write-host']);
function cmdName(w) { return path.basename(String(w || '').replace(/\\/g, '/')).toLowerCase().replace(/\.(exe|cmd|bat)$/, ''); }
function stripPrefix(words) {
  const w = [...words];
  while (w.length) {
    const h = cmdName(w[0]);
    if (/^[A-Za-z_]\w*=/.test(w[0])) { w.shift(); continue; }
    if (['sudo', 'env', 'command', 'builtin', 'exec', 'time', 'nohup', '&', '.'].includes(h)) { w.shift(); continue; }
    if (h === 'xargs') { w.shift(); while (w.length && w[0].startsWith('-')) w.shift(); continue; }
    break;
  }
  return w;
}
function psArgs(args) { // PowerShell style: -Param value pairs, switches and positional words
  const named = {}, pos = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--')) continue; // a long unix flag (--force)
    const m = a.match(/^-([A-Za-z]+)(?::(.*))?$/);
    if (m) {
      const k = m[1].toLowerCase();
      if (m[2] !== undefined) { named[k] = m[2]; continue; }
      if (PS_SWITCHES.has(k) || k.length <= 2 && !PS_PATH_PARAMS.has(k)) continue; // -r, -fo: switches
      if (i + 1 < args.length) named[k] = args[++i];
      continue;
    }
    pos.push(a);
  }
  return { named, pos };
}
function unixPos(args) { return args.filter((a) => !/^-/.test(a)); }
// git's own options before its command: -C <folder>, -c <key=value>, --git-dir=..., and the like.
export function gitArgs(args) {
  let dir = '';
  let i = 0;
  for (; i < args.length; i++) {
    const a = args[i];
    if (a === '-C') { dir = dir && args[i + 1] && !/^([A-Za-z]:[\\/]|[\\/])/.test(args[i + 1]) ? dir + '/' + args[i + 1] : (args[i + 1] || dir); i++; continue; }
    if (a === '-c' || a === '--git-dir' || a === '--work-tree' || a === '--namespace') { i++; continue; }
    if (a.startsWith('-')) continue;
    break;
  }
  return { dir, sub: args[i] || '', rest: args.slice(i + 1) };
}
// The files a patch changes ("+++ b/<path>" and "diff --git a/x b/<path>" lines), or the patch's own name when it cannot be read.
let PATCH_BASE = '';
function patchTargets(file) {
  let text = null;
  try { const abs = path.resolve(PATCH_BASE || ROOT, expand(file) || file); const st = fs.statSync(abs); if (st.isFile() && st.size < 2_000_000) text = fs.readFileSync(abs, 'utf8'); } catch {}
  if (text === null) return [file];
  const out = new Set();
  for (const m of text.matchAll(/^\+\+\+ (?:b\/)?([^\t\r\n]+)/gm)) if (m[1] !== '/dev/null') out.add(m[1].trim());
  for (const m of text.matchAll(/^diff --git a\/\S+ b\/(\S+)/gm)) out.add(m[1]);
  return out.size ? [...out] : [file];
}

const PATHISH = /[A-Za-z]:[\\/][^\s"'|;&<>`,)]+|~[\\/][^\s"'|;&<>`,)]+|[\w.\-~\\/]*[\\/][\w.\-\\/]*|[\w.\-]+\.[A-Za-z]{2,6}\b/g;
function writeTargets(words) {
  const w = stripPrefix(words);
  if (!w.length) return [];
  const name = cmdName(w[0]);
  const args = w.slice(1);
  const isPs = name.includes('-') || PS_ALIASES.has(name);
  const pathOf = (a) => { const { named, pos } = psArgs(a); for (const k of PS_PATH_PARAMS) if (named[k]) return [named[k]]; return pos.slice(0, 1); };
  if (['tee', 'tee-object'].includes(name)) return isPs ? pathOf(args) : unixPos(args);
  if (['touch', 'mkdir', 'truncate', 'new-item', 'ni', 'clear-content', 'clc'].includes(name) || DELETE_CMDS.has(name)) {
    if (isPs || name === 'rm' || name === 'del') { const { named, pos } = psArgs(args); return [...Object.entries(named).filter(([k]) => PS_PATH_PARAMS.has(k)).map(([, v]) => v), ...pos]; }
    return unixPos(args);
  }
  if (['cp', 'install', 'ln', 'rsync', 'scp', 'copy', 'cpi', 'copy-item'].includes(name)) {
    if (isPs) { const { named, pos } = psArgs(args); return named.destination ? [named.destination] : pos.slice(-1); }
    const t = args.indexOf('-t'); if (t >= 0 && args[t + 1]) return [args[t + 1]];
    return unixPos(args).slice(-1);
  }
  if (['mv', 'move', 'mi', 'move-item', 'rename-item', 'ren', 'rni'].includes(name)) {
    if (isPs) { const { named, pos } = psArgs(args); return [...(named.path ? [named.path] : []), ...(named.literalpath ? [named.literalpath] : []), ...(named.destination ? [named.destination] : []), ...pos]; }
    return unixPos(args);
  }
  if (['set-content', 'sc', 'add-content', 'ac', 'out-file', 'export-csv'].includes(name)) return pathOf(args);
  if (name === 'sed') {
    if (!args.some((a) => /^-[a-zA-Z]*i/.test(a) || a.startsWith('--in-place'))) return [];
    const files = []; let script = !args.some((a) => a === '-e' || a === '-f' || a.startsWith('--expression'));
    for (let i = 0; i < args.length; i++) { const a = args[i]; if (a === '-e' || a === '-f') { i++; continue; } if (a.startsWith('-')) continue; if (script) { script = false; continue; } files.push(a); }
    return files;
  }
  if (name === 'perl') {
    if (!args.some((a) => /^-[a-zA-Z]*i/.test(a))) return [];
    const files = []; for (let i = 0; i < args.length; i++) { if (/^-[a-zA-Z]*e$/.test(args[i])) { i++; continue; } if (!args[i].startsWith('-')) files.push(args[i]); }
    return files;
  }
  if (name === 'git') {
    // git -C <folder> rm ... works in that folder (the second roast, R11 and N31): read the global options first.
    const g = gitArgs(args);
    const sub = g.sub;
    if (!['checkout', 'restore', 'mv', 'rm', 'apply', 'clean', 'am'].includes(sub)) return [];
    const rest = unixPos(g.rest).filter((a) => a !== '--').map((a) => (g.dir && !/^([A-Za-z]:[\\/]|[\\/]|~)/.test(a) ? g.dir.replace(/[\\/]+$/, '') + '/' + a : a));
    if (sub === 'clean') return [g.dir || '.'];
    // A patch writes the files it names (roast 2026-11-19: "git apply" wrote interface code unseen). Read from the
    // patch when it can be read here (a path relative to the notebook); else the patch file itself.
    return (sub === 'apply' || sub === 'am') && !args.includes('--check') && !args.includes('--stat') ? rest.flatMap(patchTargets) : rest;
  }
  if (name === 'dd') return args.filter((a) => a.startsWith('of=')).map((a) => a.slice(3));
  if (name === 'patch') { const i = args.findIndex((a) => a === '-i' || a === '--input'); const pf = i >= 0 ? args[i + 1] : null; return pf ? patchTargets(pf) : unixPos(args); }
  if (name === 'find') {
    const ex = args.findIndex((a) => /^-(exec|execdir|ok)$/.test(a));
    const writes = args.includes('-delete') || (ex >= 0 && writeTargets(args.slice(ex + 1).filter((a) => a !== '{}' && a !== ';' && a !== '+').concat('x')).length > 0);
    if (!writes) return [];
    const starts = []; for (const a of args) { if (a.startsWith('-') || a === '!' ) break; starts.push(a); }
    return starts.length ? starts : ['.'];
  }
  const inline = (flags) => { const i = args.findIndex((a) => flags.includes(a.toLowerCase())); return i >= 0 ? args.slice(i + 1).join(' ') : null; };
  if (['powershell', 'pwsh'].includes(name)) { const c = inline(['-command', '-c']); return c ? shellWrites(c).map((x) => x.raw) : []; }
  if (['bash', 'sh', 'zsh'].includes(name)) { const c = inline(['-c', '-lc']); return c ? shellWrites(c).map((x) => x.raw) : []; }
  if (name === 'cmd') { const c = inline(['/c', '/k']); return c ? shellWrites(c).map((x) => x.raw) : []; }
  if (['node', 'deno', 'bun'].includes(name)) {
    const c = inline(['-e', '--eval', '-p', '--print']);
    return c && /writeFile|appendFile|createWriteStream|rmSync|unlink|renameSync|copyFile|mkdirSync|rmdir/.test(c) ? (c.match(PATHISH) || []) : [];
  }
  if (['python', 'python3', 'py'].includes(name)) {
    const c = inline(['-c']);
    return c && /open\([^)]*['"][wax]|write_text|write_bytes|shutil\.|os\.remove|unlink|rename|rmtree/.test(c) ? (c.match(PATHISH) || []) : [];
  }
  return [];
}
// Expands $HOME, ${VAR}, $env:VAR and %VAR% from this process; a word that still holds a variable is unknown ('').
function expand(t) {
  let s = String(t);
  s = s.replace(/\$env:([A-Za-z_]\w*)/gi, (m, v) => process.env[v] ?? process.env[v.toUpperCase()] ?? m)
    .replace(/\$\{([A-Za-z_]\w*)\}|\$([A-Za-z_]\w*)/g, (m, a, b) => (a || b) === 'HOME' ? HOME : (process.env[a || b] ?? m))
    .replace(/%([A-Za-z_]\w*)%/g, (m, v) => process.env[v] ?? m);
  return /\$|%\w+%/.test(s) ? '' : s;
}
// Every file a shell command writes to: [{ abs, raw, seg }]. A cd (or Set-Location, pushd) moves the folder for the
// commands after it.
export function shellWrites(cmd, cwd) {
  const res = [];
  let here = norm(cwd || ROOT);
  for (const seg of parseShell(cmd)) {
    const w = stripPrefix(seg.words);
    const name = cmdName(w[0]);
    if (['cd', 'set-location', 'sl', 'pushd', 'chdir'].includes(name)) {
      const to = w.slice(1).filter((a) => !/^-/.test(a) || a === '-').pop();
      if (to && to !== '-') { const e = expand(to); if (e) here = norm(e, here); }
      continue;
    }
    PATCH_BASE = here;
    for (const raw of [...seg.redirects, ...writeTargets(seg.words)]) {
      const e = expand(raw);
      if (!e || /^(\/dev\/null|nul|\$null)$/i.test(e)) continue;
      res.push({ abs: norm(e, here), raw, seg, cwd: here });
    }
  }
  return res;
}
// Each simple command with the folder it runs in, for the yes gate, the publish check and the proof record.
// A command handed to another shell (powershell -Command "...", bash -c "...", cmd /c "...") is read as well:
// its own simple commands follow the outer one, so a "vercel --prod" inside quotes is still seen.
const INNER_SHELL = { powershell: ['-command', '-c'], pwsh: ['-command', '-c'], bash: ['-c', '-lc'], sh: ['-c'], zsh: ['-c'], cmd: ['/c', '/k'] };
export function shellSegments(cmd, cwd, depth = 0) {
  const res = [];
  let here = norm(cwd || ROOT);
  for (const seg of parseShell(cmd)) {
    const w = stripPrefix(seg.words);
    const name = cmdName(w[0]);
    if (['cd', 'set-location', 'sl', 'pushd', 'chdir'].includes(name)) {
      const to = w.slice(1).filter((a) => !/^-/.test(a)).pop();
      if (to) { const e = expand(to); if (e) here = norm(e, here); }
      continue;
    }
    res.push({ ...seg, name, args: w.slice(1), cwd: here });
    const flags = INNER_SHELL[name];
    if (flags && depth < 3) {
      const i = w.findIndex((a, k) => k > 0 && flags.includes(a.toLowerCase()));
      if (i > 0 && w[i + 1]) res.push(...shellSegments(w.slice(i + 1).join(' '), here, depth + 1));
    }
  }
  return res;
}

// ---------- the design gate ----------
function missing(p, level) {
  const agentId = INPUT.agent_id || '';
  const own = loadRec(agentId);
  const parent = agentId ? loadRec('') : own;
  const reads = new Set(own.reads || []);
  const need = [];
  if (!reads.has(p.direction)) need.push(`Read ${p.direction} with the Read tool (their fixed design picks).`);
  for (const t of p.taste) if (!reads.has(t)) need.push(`Read ${t} with the Read tool (their taste).`);
  if (level === 2 && !(own.scout || parent.scout)) need.push(`Run the ${S.design.scoutSkill} skill with the Skill tool (it finds proven examples and ready-made parts first).`);
  return need;
}
function designProblem(p, level, what) {
  if (!p || p.status === 'none') return null;
  const file = p.stateFile.replace(/\\/g, '/');
  if (p.status === 'unnamed') {
    return `HIVE GATE (design): I stopped this step. ${what} is design or build work in the project "${p.title}" (stage "${p.stage}"), and the project has not said yet which design picks it follows. ` +
      `The one thing to do: add one line to the top of its state note (${file}): "design_direction: <the note that holds the fixed design picks>", ` +
      `or "design_direction: none, because <why it has no screens>". Then read that note, run ${S.design.scoutSkill}, and try again.`;
  }
  if (!fs.existsSync(p.direction)) {
    return `HIVE GATE (design): I stopped this step. The project "${p.title}" says its design picks are in ${p.direction}, but that note does not exist. ` +
      `The one thing to do: fix the design_direction: line in ${file} so it names a note that is there, then try again.`;
  }
  const need = missing(p, level);
  if (!need.length) return null;
  const who = INPUT.agent_id ? 'this helper' : 'this chat';
  return `HIVE GATE (design): I stopped this step. ${what} is design or build work in "${p.title}", and ${who} has not yet looked at the person's design picks and taste. Still to do, in this order:\n` +
    need.map((n, i) => `${i + 1}. ${n}`).join('\n') +
    `\nThen try the same step again. Why: rules 13 and 14 (on 2026-11-16 the picks and the scouting were skipped). ` +
    `Only the person can switch this check off; how it works is in the hive-gates skill.`;
}

// ---------- the stage gate ----------
// A code file in a project that is not at "build" yet, or that has no record of an approved plan (rule 4).
function isCode(abs) { return (S.stage.codeExtensions || []).some((e) => abs.endsWith(e)); }
function stageIssue(abs) {
  if (M('stage', 'notice') === 'off' || !abs || abs.endsWith('.md') || !isCode(abs)) return null;
  const root = norm(ROOT);
  if (under(abs, root) && (S.stage.notesFolders || []).some((f) => under(abs, root + '/' + String(f).toLowerCase()))) return null;
  const p = projectFor(abs);
  if (!p || inSkipped(relIn(p, abs))) return null;
  const words = S.stage.words || STAGE_WORDS;
  const issues = [], fixes = [];
  if (!p.stageWord) {
    issues.push(`its stage line ("${p.stage || 'empty'}") does not start with one of the stage words (${words.join(', ')})`);
    fixes.push('start the stage: line in its state note with one of those words');
  } else if ((S.stage.beforeBuild || []).includes(p.stageWord)) {
    issues.push(`this project is at "${p.stageWord}", before building starts`);
    fixes.push('write the plan, get their yes, then set stage: build and plan_approved: <the date and their words> in its state note');
  }
  if (!p.planApproved) {
    issues.push('its state note has no plan_approved: line, so there is no record that the person approved a plan');
    if (!fixes.length) fixes.push('show them the plan, get their yes, then add plan_approved: <the date and their words> to its state note');
  }
  if (!issues.length) return null;
  return { p, issues, fixes };
}
function stageText(si, what, refuse) {
  const file = si.p.stateFile.replace(/\\/g, '/');
  return refuse
    ? `HIVE GATE (stage): I stopped this step. ${what} is code for the project "${si.p.title}", and ${si.issues.join('; and ')}. The one thing to do: ${si.fixes.join('; ')} (${file}). Rule 4: no building before the plan is approved.`
    : `HIVE NOTICE (stage, a reminder for now; nothing was stopped): ${what} is code for "${si.p.title}", and ${si.issues.join('; and ')}. Rule 4: ${si.fixes.join('; ')} (${file}).`;
}

// Words that make a helper prompt design or build work.
const DESIGN_VERB = /\b(design|redesign|build|rebuild|implement|create|make|code|draw|wireframe|prototype|restyle|style|polish|animate|lay out|mock up)\b/i;
const DESIGN_TARGET = /\b(page|pages|site|website|screen|screens|ui|interface|component|components|hero|landing|wireframes?|layout|dashboard|front ?end|frontend|prototype|mock-?ups?|figma|css|tsx|artifact)\b|\bapp\//i;
function isDesignPrompt(text) {
  if (S.helpers.readOnlyMarker && text.toLowerCase().includes(S.helpers.readOnlyMarker.toLowerCase())) return false;
  for (const sentence of text.split(/(?<=[.!?\n])/)) if (DESIGN_VERB.test(sentence) && DESIGN_TARGET.test(sentence)) return true;
  return false;
}

// ---------- the helper-prompt gate ----------
let KNOWN = null;
function knownSkills() {
  if (KNOWN) return KNOWN;
  KNOWN = new Set((S.helpers.alsoKnownSkills || []).map((s) => s.toLowerCase()));
  try { for (const d of fs.readdirSync(SKILLS_DIR)) KNOWN.add(d.toLowerCase()); } catch {}
  return KNOWN;
}
function namesSkills(text) {
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (!/\bskills?\b/i.test(lines[i])) continue;
    const win = lines.slice(i, i + 6).join('\n');
    if (/\bnone\b[^.\n]{0,20}\bbecause\b/i.test(win)) return true;
    if (/\b[a-z][\w-]*:[a-z][\w-]+\b/i.test(win.replace(/https?:\/\/\S+/g, ''))) return true; // plugin:skill
    const tokens = win.toLowerCase().match(/[a-z][a-z0-9-]*[a-z0-9]/g) || [];
    if (tokens.some((t) => t.includes('-') && knownSkills().has(t))) return true;
    if (tokens.some((t) => knownSkills().has(t) && t.length > 3 && !['skill', 'skills', 'none'].includes(t))) return true;
  }
  return false;
}
function demandsLoadedList(text) {
  return /\bskills?\b[^\n]{0,120}\bactually\s+(loaded|used|invoked)\b/i.test(text) ||
    /\b(list|name|report|say|state|include)\b[^\n.]{0,80}\bskills?\b[^\n.]{0,60}\b(loaded|used|invoked)\b/i.test(text) ||
    /\b(loaded|used|invoked)\s+skills?\b/i.test(text);
}
function pointsToNote(text) { return /[\w~.\-\/\\:]+\.(md|txt)\b/i.test(text); }
function readOnlyHelper(ti) {
  const type = ti.subagent_type || '';
  if ((S.helpers.readOnlyAgents || []).includes(type)) return true;
  return false;
}

function helperGate(ti) {
  if (readOnlyHelper(ti)) return null;
  const text = String(ti.prompt || '');
  const lacks = [];
  if (!namesSkills(text)) lacks.push('a "Skills to load" line naming the exact skills (or "Skills: none, because ...")');
  if (!demandsLoadedList(text)) lacks.push('the demand "list in your report the skills you actually loaded"');
  if (!pointsToNote(text)) lacks.push('a pointer to the brief or note to read first (a .md path, for example the build brief or the project note)');
  let p = null;
  if (isDesignPrompt(text)) {
    p = projectFor(norm(INPUT.cwd || ROOT));
    if (p && p.status === 'gated') {
      const base = path.basename(p.direction).toLowerCase();
      if (!text.toLowerCase().includes(base)) lacks.push(`for design or build work, the pointer to the design direction note ${p.direction}`);
    }
  }
  const problems = [];
  if (lacks.length) {
    problems.push(`HIVE GATE (helper prompt): I stopped this helper from starting, because its instructions are missing ${lacks.length === 1 ? 'one thing' : lacks.length + ' things'}:\n` + lacks.map((l, i) => `${i + 1}. ${l}`).join('\n') +
      `\nThe one thing to do: add ${lacks.length === 1 ? 'it' : 'them'} (the template is ~/hive-mind/core/templates/build-brief.md) and launch it again. ` +
      `A helper that only searches or reads can be an Explore helper, or carry the line "${S.helpers.readOnlyMarker}".`);
  }
  if (p) { const d = designProblem(p, 2, 'Launching this helper'); if (d) problems.push(d); }
  return problems.length ? problems.join('\n\n') : null;
}

// ---------- the proof-part gate (rule 5; the factory's ticket) ----------
// Change work: a helper that is not read-only and whose prompt says what it may write ("Write only", "Edit only"), or
// has one sentence with a change word and a thing that is changed. Such a prompt must carry the part
// "How it will be proven" with its four lines filled in (a line still reading "<...>" counts as empty).
const CHANGE_VERB = /\b(fix|fixes|build|rebuild|implement|add|change|edit|write|refactor|rewrite|migrate|upgrade|patch|wire|remove|delete|rename|replace|extend|create|make)\b/i;
const CHANGE_TARGET = /\b(code|bug|bugs|gate|gates|hook|hooks|script|scripts|program|function|functions|tests?|api|feature|component|components|page|pages|module|file|files|settings|schema|workflow)\b|\.(mjs|cjs|js|ts|tsx|jsx|py|ps1|sh|css|html|json|ya?ml)\b/i;
export function isChangePrompt(text, readOnlyMarker) {
  const t = String(text || '');
  if (readOnlyMarker && t.toLowerCase().includes(readOnlyMarker.toLowerCase())) return false;
  if (/\b(write|edit)s?\s+only\b/i.test(t)) return true;
  for (const sentence of t.split(/(?<=[.!?\n])/)) if (CHANGE_VERB.test(sentence) && CHANGE_TARGET.test(sentence)) return true;
  return false;
}
// The names of the lines of the proof part that are missing or still empty. All of them when the part is missing.
export function proofMissing(text, T) {
  const lines = String(text || '').split(/\r?\n/);
  const parts = (T && T.parts) || [];
  const heading = String((T && T.heading) || 'How it will be proven').toLowerCase();
  const at = lines.findIndex((l) => l.toLowerCase().includes(heading));
  if (at < 0) return parts.slice();
  const body = [];
  for (let i = at + 1; i < lines.length && i <= at + 30; i++) { if (/^\s*#{1,6}\s/.test(lines[i])) break; body.push(lines[i]); }
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  return parts.filter((name) => {
    const re = new RegExp('^[\\s*_>-]*' + esc(name) + '[*_]*\\s*:\\s*(.*)$', 'i');
    const hit = body.map((l) => l.match(re)).find(Boolean);
    if (!hit) return true;
    const value = hit[1].replace(/<[^>]*>/g, '').replace(/out of scope\s*:.*/i, '').replace(/[\s.,;*_`-]/g, '');
    return value.length < 3;
  });
}
function ticketIssue(ti) {
  if (M('ticket', 'notice') === 'off' || readOnlyHelper(ti)) return null;
  if (process.env.HIVE_GATES_CRASH_TICKET === '1') throw new Error('test crash in the proof-part check');
  const text = String(ti.prompt || '');
  if (!isChangePrompt(text, S.helpers.readOnlyMarker)) return null;
  const lacks = proofMissing(text, S.ticket);
  return lacks.length ? lacks : null;
}
function ticketText(lacks, refuse) {
  const heading = S.ticket.heading || 'How it will be proven';
  const all = lacks.length === (S.ticket.parts || []).length;
  const what = all ? `the part "${heading}"` : `these lines of the part "${heading}": ${lacks.join(', ')}`;
  return refuse
    ? `HIVE GATE (proof part): I stopped this helper from starting, because it is change work and its instructions lack ${what}. ` +
      `Rule 5 asks that "done" comes with proof, so the helper must know before it starts how to see the fault today, which steps the checker will walk, which checks must pass and which files it will touch. ` +
      `The one thing to do: fill in that part from ~/hive-mind/core/templates/build-brief.md and launch it again. A helper that only searches or reads can carry the line "${S.helpers.readOnlyMarker}".`
    : `HIVE NOTICE (proof part, a reminder for now; nothing was stopped): this helper changes things, and its instructions lack ${what}. ` +
      `Rule 5: next time fill in that part from the build brief, so its "done" comes with proof.`;
}

// ---------- the helper-model gate (rule 12) ----------
function modelTable() { return Object.entries(S.modelFor || {}).map(([k, v]) => `- ${k}: ${v}`).join('\n'); }
function modelMissing(ti) {
  if (M('model', 'refuse') === 'off' || readOnlyHelper(ti)) return false;
  if ((S.model.exemptAgents || []).includes(ti.subagent_type || '')) return false; // a fork always runs on the lead's model
  const text = String(ti.prompt || '');
  if (S.helpers.readOnlyMarker && text.toLowerCase().includes(S.helpers.readOnlyMarker.toLowerCase())) return false;
  if (String(ti.model || '').trim()) return false;
  return !/^[\s*_>#-]*model\s*:/im.test(text);
}
// The model a helper was started on: the tool's setting, else its "Model:" line, else what its type implies.
function helperModel(ti) {
  const set = String(ti.model || '').trim();
  if (set) return set.toLowerCase();
  const line = String(ti.prompt || '').match(/^[\s*_>#-]*model\s*:\s*([A-Za-z][\w.-]*)/im);
  if (line) return line[1].toLowerCase();
  if ((S.model.exemptAgents || []).includes(ti.subagent_type || '')) return "the lead's model";
  return 'not named';
}
function modelText(refuse) {
  return refuse
    ? `HIVE GATE (helper model): I stopped this helper from starting, because it does not say which model it runs on (rule 12: the strongest model plans and reviews, the smallest one that does the job well does the rest). ` +
      `The one thing to do: pick the model from this table and launch again, with the tool's model setting or a line "Model: <name> (why)" in the prompt.\n${modelTable()}`
    : `HIVE NOTICE (helper model, a reminder for now; nothing was stopped): this helper names no model. Rule 12: next time set the model, or add a line "Model: <name> (why)".\n${modelTable()}`;
}

// ---------- the yes (rules 1 and 2; strict since 2026-11-20) ----------
// A step that publishes, force-pushes, installs, deletes outside the temporary folders or spends is REFUSED unless their
// latest own message names that act ("deploy it", "delete the old folder", "install lodash"), or is a bare yes ("yes",
// "ok, go ahead") to a question in Claude's last reply that named that act. A yes word in a message about something
// else ("sure, but first tell me what is left") is no yes for a delete. A negation in front of the act ("don't delete")
// or a "not yet" ("wait", "but first", "later") is no yes. In a helper chat their yes never comes from the starter's
// words: the ask is empty there. Not gated: a plain git push of the notebook (approved standing), and a bare
// "npm install" (it only restores the packages the project already lists).
const DEFAULT_ACTIONS = [
  { name: 'force-push to GitHub (it can overwrite work there)', pattern: '\\bgit\\b.*\\bpush\\b.*(\\s--force\\b|\\s-f\\b|--force-with-lease|\\s\\+[\\w/.-]+)', words: ['force push', 'force-push', 'push --force', 'push -f'] },
  { name: 'install a package or a skill', pattern: '\\b(npm|pnpm)\\s+(i|install|add)\\b(\\s+-\\S+)*\\s+[^-\\s]|\\byarn\\s+(global\\s+)?add\\b|\\bnpx\\s+skills\\s+add\\b|\\bpip3?\\s+install\\b|\\bpy(thon3?)?\\s+-m\\s+pip\\s+install\\b|\\b(winget|choco|brew)\\s+install\\b', words: ['install', 'add the package', 'add the skill'] },
  { name: 'save or send without the privacy check (--no-verify)', pattern: '\\bgit\\b.*\\b(commit|push|merge|rebase|am|cherry-pick)\\b.*\\s--no-verify\\b|\\bgit\\b.*\\bcommit\\b.*\\s-[a-zA-Z]*n[a-zA-Z]*\\b', words: ['no-verify', 'skip the check', 'skip the checks', 'without the check', 'without the checks'] },
];
// Installs the action patterns do not name: a program fetched and run at once, a connector or plugin added.
const INSTALL_EXTRA = [
  { what: 'a program fetched from the web and run at once', re: /\b(curl|wget|iwr|invoke-webrequest|irm|invoke-restmethod)\b[^|;&\n]*\|\s*(sudo\s+)?(sh|bash|zsh|iex|invoke-expression|python3?|node|pwsh|powershell)\b/i },
  { what: 'a connector or plugin added to Claude', re: /\bclaude\s+(mcp\s+(add|add-json|add-from-claude-desktop)|plugins?\s+(install|add|marketplace\s+add))\b/i },
  { what: 'an outside program run by version (npx, pnpm dlx, bunx, uvx)', re: /\b(npx|bunx|pnpx|uvx)\s+(-\S+\s+)*(@?[\w.-]+\/)?[\w.-]+@[\w.^~-]+|\b(npx|bunx|pnpx)\s+(-y|--yes|-p|--package)\b|\b(pnpm|yarn)\s+dlx\b|\bpipx\s+(run|install)\b/i },
];
const lastAsk = () => String(readJson(turnFile(), {}).ask || '');
const replyFile = () => path.join(GDIR, 'chat', safe(SID) + '.reply.json');
const lastReply = () => String(readJson(replyFile(), {}).text || '');
// The reply his latest own message answers: kept at his message, so a bare "yes" never answers a question asked in a
// later reply (one written after a helper's report, say) that he did not see when he wrote it.
const askedReply = () => { const t = readJson(turnFile(), {}); return typeof t.reply === 'string' ? t.reply : lastReply(); };

// ---------- his own words, and only his (2026-11-20, seen live) ----------
// The step at his message also fires for turns he did not type (the hooks page: it "also fires on turns Claude Code
// starts on its own", among them "a background subagent reporting back" and "a message another session sends").
// A helper's report holding "accept the installed copies" was taken as his ruling. The same reading as
// core/checks/_lib/his-words.mjs (proved the same by its test): the frames the app puts around words that are not his
// are taken out, and every line of a helper report this chat received; what is left is his. When nothing is left the
// prompt was not his: his latest own message stays what it was.
const FRAME_TAGS = ['task-notification', 'agent-message', 'teammate-message', 'cross-session-message', 'channel-message', 'session-message', 'peer-message', 'system-reminder', 'subagent-report', 'background-task', 'local-command-stdout', 'local-command-stderr', 'local-command-caveat', 'tool-result', 'function_results', 'bash-stdout', 'bash-stderr'];
const FRAME_PHRASES = ['[subagent hand-back]', 'another claude session sent a message', 'the text below is the final report of a subagent', 'this is an automated background-task event', '[system notification - not user input]', 'background command "', 'this agent\'s report was delivered to you'];
const normWordsLine = (l) => String(l).toLowerCase().replace(/[’`]/g, "'").replace(/\s+/g, ' ').trim();
const wordsLineHash = (l) => crypto.createHash('sha1').update(normWordsLine(l)).digest('hex').slice(0, 16);
const reportLinesFile = () => path.join(STATE, 'checks', 'chat', safe(SID) + '.reportlines'); // shared with the checks' loader
export function recordReportLines(file, text, maxKeep = 6000) {
  const lines = String(text || '').replace(/\r/g, '').split('\n').map(normWordsLine).filter((l) => l.length >= 24);
  if (!file || !lines.length) return 0;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    let have = []; try { have = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean); } catch {}
    const set = new Set(have);
    for (const l of lines) { const h = wordsLineHash(l); if (!set.has(h)) { set.add(h); have.push(h); } }
    fs.writeFileSync(file, have.slice(-maxKeep).join('\n') + '\n');
  } catch { return 0; }
  return lines.length;
}
export function hisOwnWords(prompt, known = new Set(), helperChat = false) {
  if (helperChat) return { own: '', his: false, why: 'a helper chat' };
  let t = String(prompt || '').replace(/\r/g, '');
  const why = [];
  const tags = new RegExp(`<(${FRAME_TAGS.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b[^>]*>[\\s\\S]*?(?:<\\/\\1\\s*>|$)`, 'gi');
  t = t.replace(tags, (m, tag) => { why.push(tag); return '\n'; });
  const phrase = FRAME_PHRASES.find((p) => t.toLowerCase().includes(p));
  if (phrase) return { own: '', his: false, why: `the words "${phrase}"` };
  const kept = []; let dropped = 0;
  for (const l of t.split('\n')) { const n = normWordsLine(l); if (n.length >= 24 && known.has(wordsLineHash(n))) { dropped++; continue; } kept.push(l); }
  if (dropped) why.push(`${dropped} line(s) of a helper's report`);
  const own = kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return { own, his: !!own, why: why.join(', ') };
}
function knownReportLines() { try { return new Set(fs.readFileSync(reportLinesFile(), 'utf8').split('\n').filter(Boolean)); } catch { return new Set(); } }

// His answers on a question card (the after-tool step of AskUserQuestion), kept until his next own message. Each is his
// word for the act its card asked about, and for nothing else (2026-11-20: he tapped "Yes, reinstall the gates" and the
// install was still refused). The same reading as core/checks/_lib/his-words.mjs, approvedBy.
const cardsFile = () => path.join(GDIR, 'chat', safe(SID) + '.cards.json');
const CARD_YES = /^(yes|yep|yeah|ok|okay|sure|go|go ahead|do it|please do|approved?|allow|agreed?|confirm(ed)?|fine|right|correct)\b/;
const CARD_NO = /\b(no|not|don't|dont|do not|never|cancel|stop|wait|later|hold|skip|keep the installed|leave)\b/;
export function cardYes(answer) { const a = normWordsLine(answer).replace(/^["'(]+/, ''); return CARD_YES.test(a) && !CARD_NO.test(a.replace(CARD_YES, '')); }
export function cardApproves(cards, words, Y, objs) {
  for (const c of cards || []) {
    const q = String(c.question || ''), a = String(c.answer || '');
    const aNames = namesAct(a, words, Y, true) && !CARD_NO.test(normWordsLine(a).split(/[,.;]/)[0].replace(CARD_YES, ''));
    const qNames = namesAct(q, words, Y, false) && cardYes(a);
    if ((aNames || qNames) && namesObject(q + ' ' + a, objs)) return true;
  }
  return false;
}
const loadCards = () => { const c = readJson(cardsFile(), null); return c && Array.isArray(c.items) ? c.items : []; };
// The cards the before-a-tool step saw going out with no answers in them: only their answers count.
const cardsSeenFile = () => path.join(GDIR, 'chat', safe(SID) + '.cards-seen');
const cardSeen = () => !!INPUT.tool_use_id && readLines(cardsSeenFile()).some((x) => x.id === String(INPUT.tool_use_id));
const escLow = (s) => String(s).toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const QUESTION_START = /^\s*(when|why|what|how|where|who|which|should|shall|did|do|does|is|are|was|were|have|has|had)\b/;
// True when the text names one of the words as an act, with no negation in the three words before it.
// asHim: their message, where a question ("should we deploy?") and a "not yet" ("wait", "but first") do not count.
export function namesAct(text, words, Y, asHim = true) {
  const t = String(text || '').toLowerCase();
  if (!t.trim() || !(words || []).length) return false;
  if (asHim && hasAny(t, (Y && Y.notYetWords) || [])) return false;
  const neg = new Set(((Y && Y.negations) || []).map((x) => String(x).toLowerCase()));
  for (const sentence of t.split(/(?<=[.!?;\n])/)) {
    const st = sentence.trim();
    if (asHim && /\?\s*$/.test(st) && QUESTION_START.test(st)) continue;
    for (const w of words) {
      const re = new RegExp('(^|[^a-z#])' + escLow(w) + '($|[^a-z])', 'g');
      let m;
      while ((m = re.exec(sentence))) {
        const prev = sentence.slice(Math.max(0, m.index - 40), m.index + m[1].length).split(/[^a-z']+/).filter(Boolean).slice(-3);
        if (prev.some((p) => neg.has(p))) continue;
        return true;
      }
    }
  }
  return false;
}
// A bare yes: a short answer that is only a yes ("yes", "ok, go ahead, thanks"): every word is a yes word or a filler
// word, with no "but", "first", "wait" and no question. "ok, and what about the colours" is not one.
export function bareYes(text, Y) {
  const t = String(text || '').trim().toLowerCase();
  if (!t || t.length > 80 || t.includes('?')) return false;
  const words = t.split(/[^a-z']+/).filter(Boolean);
  if (!words.length || words.length > ((Y && Y.bareMaxWords) || 8)) return false;
  if (!hasAny(t, (Y && Y.yesWords) || []) || hasAny(t, (Y && Y.holdWords) || [])) return false;
  const ok = new Set([...((Y && Y.yesWords) || []).flatMap((w) => String(w).toLowerCase().split(/\s+/)), ...((Y && Y.fillerWords) || [])]);
  return words.every((w) => ok.has(w));
}
// The last question Claude asked in its reply: the last sentence that ends in a question mark (2026-11-20, N28: a
// bare "ok" answers that question only, not an act named somewhere else in the reply).
export function lastQuestion(reply) {
  const t = String(reply || '').slice(-1500);
  const qs = t.split(/(?<=[.!?:\n])\s+/).map((s) => s.trim()).filter((s) => /\?\s*$/.test(s));
  return qs.length ? qs[qs.length - 1] : '';
}
// The object of an act, named in words: one of the words (a part of the path, a package, a domain, a person).
// No words given: nothing to name. (N29: "delete the extra comma" is no yes for deleting the notes.)
export function namesObject(text, objs) {
  if (!objs || !objs.length) return true;
  const t = ' ' + String(text || '').toLowerCase().replace(/\\/g, '/') + ' ';
  return objs.some((o) => o && t.includes(String(o).toLowerCase()));
}
const GENERIC_PARTS = new Set(['the', 'and', 'for', 'users', 'user', 'home', 'src', 'app', 'lib', 'core', 'md', 'mjs', 'js', 'json', 'txt', 'tmp', 'temp', 'hive', 'mind', 'hive-mind', 'claude', 'local', 'appdata', 'documents', 'desktop', 'www', 'com', 'org', 'net', 'invalid', 'example']);
// The words that name a path: its last two parts, whole and split at - _ . (at least three letters, not generic).
export function objectWords(abs) {
  const parts = String(abs || '').replace(/\\/g, '/').toLowerCase().split('/').filter(Boolean).slice(-2);
  const out = new Set();
  for (const p of parts) {
    if (p.length >= 3 && !GENERIC_PARTS.has(p) && !/^[a-z]:$/.test(p)) out.add(p);
    for (const q of p.split(/[-_.\s]+/)) if (q.length >= 3 && !GENERIC_PARTS.has(q)) out.add(q);
  }
  return [...out];
}
// Their yes for an act: their latest own message names the act and its object, or is a bare yes to the last question of
// Claude's reply that named both.
export function yesFor(ask, reply, words, replyWords, Y, objs) {
  if (namesAct(ask, words, Y, true) && namesObject(ask, objs)) return true;
  const q = lastQuestion(reply);
  return bareYes(ask, Y) && !!q && namesAct(q, replyWords || words, Y, false) && namesObject(q, objs);
}
// His latest OWN message (never a helper's report or a notice), against the reply he saw when he wrote it; or his yes
// on a question card that asked about this act.
const saidYes = (words, replyWords, objs) => yesFor(lastAsk(), askedReply(), words, replyWords, S.yes, objs) || (!loadChat().helper && cardApproves(loadCards(), [...new Set([...(words || []), ...(replyWords || [])])], S.yes, objs));
function tempish(abs) {
  const tmps = [os.tmpdir(), process.env.TEMP, process.env.TMP, process.env.TMPDIR].filter(Boolean).map((t) => norm(t));
  // The notebook is never a temporary folder, wherever it lies (a made-up one in a test lies under the temp folder).
  if (under(abs, norm(ROOT)) && !/\/\.claude\/worktrees\//.test(abs)) return false;
  return tmps.some((t) => under(abs, t)) || under(abs, '/tmp') || /\/appdata\/local\/temp(\/|$)/.test(abs);
}

// ---------- every command a step really runs (2026-11-20: the publish check reads the act, not the word) ----------
// The simple commands of a shell step, followed into everything a hook can see: another shell (powershell -Command,
// bash -c, cmd /c, an -EncodedCommand), eval and Invoke-Expression, Start-Process, a variable that holds a program
// ($v='vercel'; & $v --prod), the string literals of node -e and python -c, an npm, pnpm, yarn or bun script (read
// from package.json), and a script file that is run (.bat .cmd .ps1 .sh .mjs .js .py, read from the disk). A script
// written and run in the same step is marked. What no hook can see: a program that builds the command at run time
// from pieces, a file that imports another file, or a script changed between this check and its run.
const EVAL_CMDS = new Set(['eval', 'iex', 'invoke-expression']);
const INTERP = new Set(['node', 'deno', 'bun', 'python', 'python3', 'py', 'sh', 'bash', 'zsh', 'dash', 'ksh', 'pwsh', 'powershell', 'cmd', 'ruby', 'perl', 'php', 'tsx', 'ts-node', 'osascript']);
// Does an interpreter's command line itself say what it runs (a script file, inline code, a module, a version)?
function hasCodeSource(name, args) {
  const low = args.map((a) => a.toLowerCase());
  if (low.some((a) => ['-v', '--version', '-version', '-h', '--help', '-?', '/?', '--test', '-m', '-e', '--eval', '-p', '--print', '-c', '-lc', '-command', '-encodedcommand', '-enc', '-ec', '-file', '-f', '/c', '/k', 'run', 'eval', 'test', '--check', '-i'].includes(a))) return true;
  return args.some((a) => !a.startsWith('-') && !a.startsWith('/') && a !== '-');
}
// A program file and the files it imports by a relative path (import ... from './x', require('./x'), import('./x');
// Python's "from .x import" and "import x" when x.py sits next to it), followed to three levels and at most 30 files.
export function codeFiles(abs, text) {
  const out = [{ abs, text }];
  const seen = new Set([abs]);
  const queue = [{ abs, text, d: 0 }];
  while (queue.length && out.length < 30) {
    const f = queue.shift();
    if (f.d >= 3) continue;
    const dir = path.posix.dirname(f.abs);
    const refs = [];
    for (const m of String(f.text).matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)(['"`])(\.{1,2}\/[^'"`]+)\1/g)) refs.push(m[2]);
    if (/\.py$/i.test(f.abs)) for (const m of String(f.text).matchAll(/^\s*(?:from\s+\.?([\w.]+)\s+import|import\s+([\w.]+))/gm)) refs.push('./' + String(m[1] || m[2]).replace(/\./g, '/') + '.py');
    for (const r of refs) {
      let p = norm(r, dir);
      let t = readSmall(p);
      if (t === null) for (const x of ['.mjs', '.js', '.cjs', '.ts', '/index.js', '/index.mjs']) { t = readSmall(p + x); if (t !== null) { p = p + x; break; } }
      if (t === null || seen.has(p)) continue;
      seen.add(p); out.push({ abs: p, text: t }); queue.push({ abs: p, text: t, d: f.d + 1 });
    }
  }
  return out;
}
const START_CMDS = new Set(['start-process', 'saps', 'start']);
const SCRIPT_EXT = /\.(bat|cmd|ps1|psm1|sh|bash|zsh|mjs|cjs|js|ts|py)$/i;
const CODE_EXT = /\.(mjs|cjs|js|ts|py)$/i;
const PM_BUILTIN = new Set(['install', 'i', 'ci', 'add', 'remove', 'rm', 'uninstall', 'update', 'up', 'upgrade', 'list', 'ls', 'outdated', 'init', 'create', 'dlx', 'exec', 'x', 'why', 'info', 'view', 'audit', 'publish', 'pack', 'link', 'unlink', 'config', 'cache', 'help', 'login', 'logout', 'whoami', 'version', 'set', 'global', 'workspace', 'workspaces', 'import', 'patch', 'store', 'env', 'prune', 'dedupe', 'fund', 'doctor']);
function readSmall(abs) { try { const st = fs.statSync(abs); if (!st.isFile() || st.size > 262144) return null; return fs.readFileSync(abs, 'utf8'); } catch { return null; } }
export function literalsIn(code) { const res = []; const re = /(['"`])((?:\\.|(?!\1)[^\\\n])*)\1/g; let m; while ((m = re.exec(String(code)))) res.push(m[2]); return res; }
// The commands program code hands to a shell or starts, when they are written out: execSync('vercel --prod'),
// spawn('vercel', ['--prod']), subprocess.run(['vercel', '--prod']), os.system('...'). A command built from a variable
// is not seen here (see the hint while the hold is on).
// In a program FILE (inFile), a call that sits inside a string of its line (a test's sample command, a message) is
// text, not a call: a quote of one kind left open before it on its line skips it.
export function execLiterals(code, inFile = false) {
  const res = [];
  const src = String(code);
  const re = /\b(execSync|exec|execFile|execFileSync|execa|execaSync|spawn|spawnSync|fork|system|run|call|Popen|check_call|check_output|getoutput|getstatusoutput)\s*\(\s*((['"`])(?:\\.|(?!\3)[^\\])*\3(\s*,\s*\[[^\]]*\])?|\[[^\]]*\])/g;
  let m;
  while ((m = re.exec(src))) {
    if (inFile) {
      const before = src.slice(src.lastIndexOf('\n', m.index) + 1, m.index).replace(/\\./g, '');
      if (['"', "'", '`'].some((q) => (before.split(q).length - 1) % 2 === 1)) continue;
      // In a comment (// or # before it on its line, or a line of a /* */ block): words, not a call.
      if (/(^|\s)(\/\/|#)/.test(before) || /^\s*\*/.test(before)) continue;
    }
    res.push(literalsIn(m[2]).join(' '));
  }
  return res.filter(Boolean);
}
function packageScript(dir, name) {
  let d = dir;
  for (let i = 0; i < 5; i++) {
    const pj = readJson(path.join(d, 'package.json'), null);
    if (pj) return pj.scripts && typeof pj.scripts[name] === 'string' ? pj.scripts[name] : null;
    const up = path.dirname(d); if (up === d) break; d = up;
  }
  return undefined; // no package.json found
}
function inlineCode(w, flags) { const i = w.findIndex((a, k) => k > 0 && flags.includes(a.toLowerCase())); return i > 0 ? w.slice(i + 1).join(' ') : null; }
const DEEP = new Map();
// The shell the step runs in: 'ps' for the PowerShell tool, 'sh' otherwise (set from the hook's input; a test may set it).
let SHELL_KIND = 'sh';
export function setShellKind(k) { SHELL_KIND = k === 'ps' ? 'ps' : 'sh'; }
export function deepSegs(cmd, cwd, depth = 0, fromFile = false) {
  const key = depth === 0 ? `${SHELL_KIND}\u0000${cwd}\u0000${cmd}` : '';
  if (key && DEEP.has(key)) return DEEP.get(key);
  const res = [];
  const vars = {};
  const writes = depth === 0 ? new Set((() => { try { return shellWrites(cmd, cwd).map((x) => x.abs); } catch { return []; } })()) : new Set();
  const push = (s) => { if (res.length < 400) res.push({ ...s, fromFile: s.fromFile || fromFile }); };
  const deeper = (text, here, file) => { if (depth < 4 && text) for (const s of deepSegs(text, here, depth + 1, fromFile || !!file)) push(s); };
  // as: the interpreter that reads it (a file fed on standard input has no telling extension).
  const script = (p, here, as) => {
    const e = expand(p) || p;
    const abs = norm(e, here);
    let text = readSmall(abs);
    if (text === null && !/[\\/.]/.test(e)) for (const x of ['.bat', '.cmd']) { text = readSmall(abs + x); if (text !== null) break; }
    const isCode = CODE_EXT.test(abs) || ['node', 'deno', 'bun', 'python', 'python3', 'py', 'tsx', 'ts-node'].includes(as || '');
    if (text !== null) {
      if (isCode) {
        // The file and what it imports (relative imports, followed): a deploy written in an imported file is seen too
        // (N08), and a program started by a name built at run time is marked (opaque).
        for (const f of codeFiles(abs, text)) {
          for (const lit of execLiterals(f.text, true)) deeper(lit, here, true);
          push({ words: ['(code)'], name: '(code)', args: [], bare: '', cwd: here, code: f.text, fromFile: true, file: f.abs });
        }
      } else deeper(text, here, true);
    } else if (writes.has(abs)) push({ words: ['(script)'], name: '(script)', args: [], bare: '', cwd: here, writtenScript: abs });
  };
  for (const s0 of shellSegments(cmd, cwd)) {
    const ws = s0.words;
    // A variable set here: $v='vercel', $v = 'vercel', v=vercel. A PowerShell $x = <command> also runs the command.
    const one = ws.length <= 2 && ws[0] && ws[0].match(/^\$?([A-Za-z_]\w*)=(.*)$/s);
    if (one) { vars[one[1].toLowerCase()] = one[2] || ws[1] || ''; push({ ...s0, assign: true }); continue; }
    // A setting set, as a value, not a program (2026-11-20, seen live: "$env:HIVE_NO_PUBLISH=1; git commit" was read as
    // a program named by a variable): $env:X=1, $env:X = 1, ${env:X} = 1, $x.Prop = 1, $x[0] = 1, $x += 1.
    const setOne = ws.length <= 2 && ws[0] && ws[0].match(/^\$\{?(env:)?([A-Za-z_]\w*)\}?((?:\.[\w]+|\[[^\]]*\])*)([+\-*/]?=)(.*)$/is);
    if (setOne) { if (!setOne[3]) vars[setOne[2].toLowerCase()] = setOne[5] || ws[1] || ''; push({ ...s0, assign: true }); continue; }
    if (ws.length >= 3 && /^\$\{?(env:)?[A-Za-z_]\w*\}?((?:\.[\w]+|\[[^\]]*\])*)$/i.test(ws[0]) && /^[+\-*/]?=$/.test(ws[1])) {
      const simple = ws[0].match(/^\$\{?(?:env:)?([A-Za-z_]\w*)\}?$/i);
      if (simple && ws[1] === '=') vars[simple[1].toLowerCase()] = ws.slice(2).join(' ');
      push({ ...s0, assign: true });
      const rhs = String(s0.bare || '').split(/\s+/)[2] || '';
      if (!/^['"$\d@(\[]/.test(rhs)) deeper(ws.slice(2).join(' '), s0.cwd);
      continue;
    }
    const subbed = ws.map((x) => x.replace(/\$\{?([A-Za-z_]\w*)\}?/g, (m, v) => (vars[v.toLowerCase()] !== undefined ? vars[v.toLowerCase()] : m)));
    if (subbed.some((x, i) => x !== ws[i])) {
      deeper(subbed.join(' '), s0.cwd);
      // A value with a space (C:\Program Files\...\docker.exe) is one word where it stands: read it that way too, so
      // "& $d pull x" with $d holding docker's full path is read as docker. Both readings are kept: Bash splits an
      // unquoted value into words, PowerShell never does.
      const whole = subbed.map((x, i) => (x !== ws[i] && /\s/.test(x) ? `"${x.replace(/"/g, '')}"` : x));
      if (whole.some((x, i) => x !== subbed[i])) deeper(whole.join(' '), s0.cwd);
      continue;
    }
    push(s0);
    if (depth >= 4) continue;
    const w = stripPrefix(ws);
    const name = cmdName(w[0]);
    const here = s0.cwd;
    // Code an interpreter reads on its standard input (the second roast, N04, N05, N09): a < file is read as its
    // script; a pipe, a heredoc, a here-string or "-" is code no hook can read.
    if (INTERP.has(name) && !hasCodeSource(name, w.slice(1))) {
      if (s0.inputs && s0.inputs.length && !s0.stdinText) { script(s0.inputs[s0.inputs.length - 1], here, name); continue; }
      if (s0.piped || s0.stdinText || w.slice(1).includes('-')) push({ ...s0, stdinCode: name });
    }
    // iex alone reads a pipe or a parenthesised expression (split off by the reader): text made at run time either way.
    if (EVAL_CMDS.has(name) && (w.length === 1 || /[$(\[`]/.test(w.slice(1).join(' ')))) push({ ...s0, stdinCode: name });
    // node -r ./x.js / --require / --import: a file loaded before the script runs.
    if (['node', 'bun', 'deno'].includes(name)) for (let k = 1; k < w.length - 1; k++) if (['-r', '--require', '--import', '--loader', '--experimental-loader'].includes(w[k]) && /[\\/.]/.test(w[k + 1])) script(w[k + 1], here, 'node');
    if (/^\$/.test(w[1] || '') && ['node', 'python', 'python3', 'py', 'bash', 'sh', 'pwsh', 'powershell', 'deno', 'bun'].includes(name) && !expand(w[1])) push({ ...s0, varScript: w[1] });
    // A program named by a variable: in Bash a first word $v runs the program v holds; in PowerShell only the call
    // operators run one (& $v, . $v): a bare $_.Name, $x.Count or "$($x)" there is a value that is read, not run
    // (2026-11-20, seen live: reading a property of the current item in a pipeline was refused). A %v% is cmd's.
    const callOp = ['&', '.'].includes(String(ws[0] || '')) || !!s0.afterAmp;
    if (/^%/.test(w[0] || '') || (/^\$/.test(w[0] || '') && !/^\$(true|false|null)$/i.test(w[0]) && (SHELL_KIND !== 'ps' || callOp))) push({ ...s0, varProgram: w[0] });
    if (EVAL_CMDS.has(name)) deeper(w.slice(1).join(' '), here);
    if (START_CMDS.has(name)) {
      const { named, pos } = psArgs(w.slice(1));
      const fp = named.filepath || pos[0];
      const al = named.argumentlist !== undefined ? named.argumentlist : pos.slice(1).join(' ');
      if (fp) deeper(`${/\s/.test(fp) ? `"${fp}"` : fp} ${String(al).replace(/,/g, ' ')}`, here);
    }
    if (name === 'powershell' || name === 'pwsh') {
      const e = w.findIndex((a) => /^-(e|ec|enc|encodedcommand)$/i.test(a));
      if (e > 0 && w[e + 1]) { try { deeper(Buffer.from(w[e + 1], 'base64').toString('utf16le'), here); } catch {} }
      const f = w.findIndex((a) => /^-file$/i.test(a));
      if (f > 0 && w[f + 1]) script(w[f + 1], here);
    }
    if (['node', 'deno', 'bun', 'python', 'python3', 'py', 'tsx', 'ts-node'].includes(name)) {
      const code = inlineCode(w, ['-e', '--eval', '-p', '--print', '-c']);
      if (code !== null) { for (const lit of execLiterals(code)) deeper(lit, here); push({ words: ['(code)'], name: '(code)', args: [], bare: '', cwd: here, code }); }
      else { const f = w.slice(1).find((a) => !a.startsWith('-')); if (f && SCRIPT_EXT.test(f)) script(f, here); }
    }
    if (['bash', 'sh', 'zsh', 'cmd'].includes(name)) { const f = w.slice(1).find((a) => !a.startsWith('-') && !a.startsWith('/')); if (f && SCRIPT_EXT.test(f) && !w.some((a) => ['-c', '-lc', '/c', '/k'].includes(a.toLowerCase()))) script(f, here); }
    if (w[0] && SCRIPT_EXT.test(w[0])) script(w[0], here);
    else if (w[0] && process.platform === 'win32' && !/[\\/.]/.test(w[0]) && !READ_CMDS.has(name)) script(w[0], here); // deploy -> deploy.bat or deploy.cmd in this folder
    if (['npm', 'pnpm', 'yarn', 'bun'].includes(name)) {
      const a = w.slice(1);
      const VALUED = ['--prefix', '-c', '--dir', '--cwd', '-C', '--filter', '-F', '--workspace', '-w'];
      const pos = a.filter((x, k) => !x.startsWith('-') && !VALUED.includes(a[k - 1]));
      let sc = null;
      if (['run', 'run-script'].includes(pos[0])) sc = pos[1];
      else if (name === 'npm' && ['start', 'test', 'stop', 'restart'].includes(pos[0])) sc = pos[0];
      else if (name !== 'npm' && pos[0] && !PM_BUILTIN.has(pos[0])) sc = pos[0];
      if (sc) {
        const pi = a.findIndex((x) => ['--prefix', '-c', '--dir', '--cwd', '-C'].includes(x));
        const dir = pi >= 0 && a[pi + 1] ? norm(expand(a[pi + 1]) || a[pi + 1], here) : here;
        const body = packageScript(dir, sc);
        if (typeof body === 'string') deeper(body, dir);
        else if (/deploy|publish|release|ship|prod|live/i.test(sc)) push({ ...s0, unknownDeploy: `${name} run ${sc} (its package.json was not found, and its name says it publishes)` });
      }
    }
  }
  if (key) DEEP.set(key, res);
  return res;
}

// ---------- the publish check (rule 1; a safety check) ----------
// A command or tool that puts something online. Refused while the publish hold file exists, and refused when it is
// run as a "test" (its description or text says test, try, dry run, ...) without the person's last message naming
// publishing: a real publish is never a test. A command with a dry-run flag is not a publish.
function deployOf(seg) {
  const P = S.publish;
  let w = stripPrefix(seg.words);
  if (['npx', 'bunx', 'pnpx'].includes(cmdName(w[0]))) { w = w.slice(1); while (w.length && w[0].startsWith('-')) w.shift(); }
  if (!w.length) return '';
  const name = cmdName(w[0]);
  const args = w.slice(1).map((a) => a.toLowerCase());
  if ((P.dryRunFlags || []).some((f) => args.includes(f))) return '';
  if (name === 'vercel') {
    if (args.some((a) => a === '--prod' || a === '--production')) return 'vercel --prod';
    if (args.some((a) => ['--version', '-v', '--help', '-h'].includes(a))) return '';
    // The first word that is not a flag. A known command that publishes nothing (env, ls, pull, ...) is not a deploy;
    // anything else is (a bare vercel, deploy, or a folder or flag value as in "vercel --cwd app"): a safety check
    // would rather ask once too often. "vercel project add" makes a new project, whose first deploy is production.
    const pos = args.filter((a) => !a.startsWith('-'));
    const sub = pos[0];
    if ((sub === 'project' || sub === 'projects') && ['add', 'create'].includes(pos[1])) return 'vercel project add (a new project: its first deploy goes to production)';
    if (sub && (P.vercelQuiet || []).includes(sub)) return '';
    const preview = args.some((a) => a === '--target=preview' || a === 'preview') ;
    return 'vercel ' + (sub && (P.vercelDeploy || []).includes(sub) ? sub : '(a deploy)') + (preview ? '' : ' (a production deploy on a new project)');
  }
  const text = [name, ...w.slice(1)].join(' ');
  for (const p of P.patterns || []) { let re; try { re = new RegExp(p, 'i'); } catch { continue; } if (re.test(text)) return text.slice(0, 80); }
  return '';
}
// A word that looks like a deploy anywhere in a command that is not only reading or copying: used only while the hold
// is on (the safe side), so "gh pr create --body 'run vercel --prod'" is refused then too.
const DEPLOY_HINT = /\bvercel\b[^\n]*(--prod\b|--production\b|\bdeploy\b|\bpromote\b|\bredeploy\b)|\bpublish(-public|-quiet)?\.ps1\b|\bnetlify\s+deploy\b|\bwrangler\s+(deploy|publish)\b|\bfirebase\s+deploy\b/i;
const COPY_CMDS = new Set(['cp', 'copy', 'copy-item', 'cpi', 'robocopy', 'xcopy']);
// What it would publish, or '' when the step publishes nothing. holdOn: also the hints a safe side reads.
function publishWhat(tool, ti, cwd, holdOn) {
  if (tool === 'Bash' || tool === 'PowerShell') {
    const segs = deepSegs(String(ti.command || ''), norm(cwd));
    for (const s of segs) {
      if (s.unknownDeploy) return s.unknownDeploy;
      if (s.name === '(code)' || s.name === '(script)') continue;
      const d = deployOf(s); if (d) return d;
    }
    if (holdOn) for (const s of segs) {
      if (s.fromFile) continue; // inside a script file only its real deploys count (above), never a hint
      if (s.writtenScript) return `a script written and run in the same step (${s.writtenScript})`;
      if (s.varProgram) return `a program named by a variable (${s.varProgram})`;
      if (s.code !== undefined) { if (DEPLOY_HINT.test(s.code)) return 'program code that names a deploy'; continue; }
      if (READ_CMDS.has(s.name) || COPY_CMDS.has(s.name)) continue;
      if (DEPLOY_HINT.test(s.words.join(' '))) return s.words.join(' ').slice(0, 80);
    }
    return '';
  }
  if (tool.startsWith('mcp__')) {
    const short = tool.split('__').pop();
    if ((S.publish.tools || []).includes(short)) return short;
    // A connector that writes to a repository's main branch (GitHub's push_files and the like): a host that builds on
    // push publishes it (N03). While the hold is on only; a plain git push of the notebook stays a standing approval.
    if (holdOn && (S.publish.gitPublishTools || []).includes(short)) {
      const br = String(ti.branch || ti.base || '').toLowerCase().replace(/^refs\/heads\//, '');
      if (short === 'merge_pull_request' || !br || (S.publish.defaultBranches || ['main', 'master']).includes(br)) return `${short} to ${br || 'the default branch'} of ${ti.owner || '?'}/${ti.repo || '?'} (a host that builds on push puts it online)`;
    }
    return '';
  }
  return '';
}
const holdPath = () => path.join(STATE, S.publish.holdFile || 'publish-hold');
function publishIssue(what, ti) {
  if (process.env.HIVE_GATES_CRASH_CHECK === 'publish') throw new Error('test crash in publish');
  const P = S.publish;
  const hold = holdPath();
  if (fs.existsSync(hold)) {
    let why = ''; try { why = fs.readFileSync(hold, 'utf8').split(/\r?\n/)[0].trim().slice(0, 240); } catch {}
    return `HIVE GATE (publish): I stopped this step. It would put something online (${what}), and the publish hold is on${why ? ': "' + why + '"' : ''}. ` +
      `Nothing goes online while the hold file exists, whoever runs it and however it is called. The one thing to do: finish what the hold names; once the person says to lift the hold, the lead deletes the hold file and runs the publish then.`;
  }
  const said = `${ti.description || ''} ${ti.command || ''}`;
  if (hasAny(said, P.testWords) && !hasAny(lastAsk(), P.askWords)) {
    return `HIVE GATE (publish): I stopped this step. It would really put something online (${what}), and it is being run as a test, while the person's last message did not ask to publish. ` +
      `A real publish is never a test (rule 1). The one thing to do: test it on a copy that cannot reach the live site, or with the tool's dry-run option, or ask the person in one plain sentence first.`;
  }
  return '';
}
// The safety wrapper: an error after the step was seen to publish stops that step; an error before it lets the step through.
function publishCheck(tool, ti, cwd) {
  if (M('publish', 'refuse') === 'off') return null;
  const holdOn = fs.existsSync(holdPath());
  const what = guard('publish-detect', () => publishWhat(tool, ti, cwd, holdOn), '');
  if (!what) return null;
  try {
    const t = publishIssue(what, ti);
    return t ? { text: t, refuse: M('publish', 'refuse') === 'refuse' } : null;
  } catch (e) {
    log('error', { where: 'publish', kind: 'safety', error: String(e && e.message || e).slice(0, 200) });
    return { text: `HIVE GATE (publish): I stopped this step to be safe. It would put something online (${what}), and the publish check broke while reading it. The one thing to do: ask the person in one plain sentence whether to publish now; the break is written in the gates log.`, refuse: true };
  }
}

// ---------- the hold file itself (2026-11-20) ----------
// While the hold exists, deleting, renaming, emptying or moving it (or a folder that holds it) is refused unless their
// latest own message asks to lift the hold, or is a bare yes to Claude's question naming the hold.
function holdIssue(tool, ti, cwd) {
  if (M('publish', 'refuse') === 'off') return '';
  const hold = norm(holdPath());
  if (!fs.existsSync(holdPath())) return '';
  const hits = [];
  if (['Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(tool)) {
    const abs = norm(ti.file_path || ti.notebook_path || '', cwd);
    if (abs === hold) hits.push(abs);
  } else if (tool.startsWith('mcp__')) {
    for (const abs of connectorPaths(tool, ti)) if (abs === hold || under(hold, abs)) hits.push(abs);
  } else if (tool === 'Bash' || tool === 'PowerShell') {
    const cmd = String(ti.command || '');
    for (const x of allShellTargets(cmd, cwd)) if (x.abs === hold || under(hold, x.abs)) hits.push(x.abs);
    const name = String(S.publish.holdFile || 'publish-hold').toLowerCase();
    for (const s of deepSegs(cmd, norm(cwd))) {
      if (s.fromFile || READ_CMDS.has(s.name) && !(s.name === 'find' && s.args.includes('-delete'))) continue;
      const text = (s.code !== undefined ? s.code : s.words.join(' ')).toLowerCase();
      if (text.includes(name)) { hits.push(`a command that names the hold file (${s.name})`); break; }
    }
  }
  if (!hits.length) return '';
  if (saidYes(S.publish.liftWords || [], S.publish.liftReplyWords || ['hold'])) return '';
  return `HIVE GATE (publish hold): I stopped this step. It would delete, empty, rename or move the publish hold (${hits[0]}), and while the hold is on nothing goes online. ` +
    `Only the person lifts the hold. The one thing to do: ask them in one plain sentence whether to lift the hold now; after their yes to that question, run it again.`;
}

// ---------- every target of a shell step, followed into everything it runs (2026-11-20, the second roast) ----------
// shellWrites reads the outer command; this adds the targets of each simple command deepSegs found (another shell,
// an encoded command, eval, an npm script, a script file), each in its own folder. del: a delete; gone: the file
// leaves its place (a delete, or the source of a move).
const MOVE_CMDS = ['mv', 'move', 'mi', 'move-item', 'rename-item', 'ren', 'rni'];
function targetOf(seg, raw, abs) {
  const n = cmdName(stripPrefix(seg.words || [])[0]);
  const mv = MOVE_CMDS.includes(n);
  const words = (seg.words || []).filter((a) => !a.startsWith('-'));
  return { abs, raw, del: DELETE_CMDS.has(n), gone: DELETE_CMDS.has(n) || (mv && raw !== words[words.length - 1]) };
}
function allShellTargets(cmd, cwd) {
  const out = shellWrites(cmd, cwd).map((x) => targetOf(x.seg, x.raw, x.abs));
  const seen = new Set(out.map((x) => x.abs));
  let segs = []; try { segs = deepSegs(cmd, norm(cwd)); } catch {}
  for (const s of segs) {
    if (s.name === '(code)' || s.name === '(script)' || !s.words) continue;
    let raws = []; try { raws = [...(s.redirects || []), ...writeTargets(s.words)]; } catch {}
    for (const raw of raws) {
      const e = expand(raw);
      if (!e || /^(\/dev\/null|nul|\$null)$/i.test(e)) continue;
      const abs = norm(e, s.cwd);
      if (!seen.has(abs)) { seen.add(abs); out.push(targetOf(s, raw, abs)); }
    }
  }
  // .NET file calls in PowerShell ([IO.File]::WriteAllText('...')): a written-out path is a target.
  for (const m of dropBodies(cmd).matchAll(/\[(?:system\.)?io\.(?:file|directory)\]::(\w+)\s*\(\s*(['"])([^'"]+)\2/gi)) {
    if (!/^(write|append|create|copy|move|delete|replace|set)/i.test(m[1])) continue;
    const abs = norm(m[3], cwd);
    if (!seen.has(abs)) { seen.add(abs); out.push({ abs, raw: m[3], del: /^delete/i.test(m[1]), gone: /^(delete|move)/i.test(m[1]) }); }
  }
  return out;
}
// A connector tool that names a local file (an absolute path in path, file_path, destination, ...): judged as a
// write to it. A path in a remote repository is relative and is not read as a local one.
const CONN_PATH_KEYS = /^(path|paths|file_path|filepath|file|filename|destination|dest|target|source|to|from|to_path|from_path|new_path|old_path|output|output_path)$/i;
function connectorPaths(tool, ti) {
  if (!String(tool).startsWith('mcp__') || !ti || typeof ti !== 'object') return [];
  const out = [];
  for (const [k, v] of Object.entries(ti)) {
    if (!CONN_PATH_KEYS.test(k)) continue;
    for (const x of Array.isArray(v) ? v : [v]) if (typeof x === 'string' && /^([A-Za-z]:[\\/]|\/(?!\/)|~[\\/])/.test(x)) out.push(norm(x));
  }
  return out;
}

// ---------- what no hook can read, refused while it matters (2026-11-20, the second roast) ----------
// A step whose program or target is made at run time cannot be judged: a program name or a path built from pieces in
// program code, a variable, code fed to an interpreter on its standard input (a pipe, a < file the gate cannot read, a
// heredoc), text decoded and handed to a shell or iex, a script named by a variable, or a script (or a file it
// imports) that starts a program by a built name. Such a step is REFUSED while the publish hold is on, or when it
// names the protected places (the home folder, the Hive folder, Claude's settings, the gates, the checks, the hold,
// an off switch). The cost, said in the hive-gates manual: write the program and every file it writes in the command
// itself. A script in the notebook's own program folders that git knows (core/, system/, starter/) is trusted: it was
// saved and can be read; one written in this chat, or anywhere else, is not.
const NEAR_GUARDED = /userprofile|\$\{?home\b|\$home\b|homedir|expanduser|getenv|appdata|localappdata|process\.env|\$env:|%[a-z_]+%|\.claude|[\\/'"]hive\b|gates|checks|settings|publish-hold|hold|-off\b|disableallhooks|uninstall/i;
const WRITE_CALL = /(?<![\w$])(?:fs\.|fsp\.|promises\.|fs\.promises\.)?(writeFileSync|writeFile|appendFileSync|appendFile|createWriteStream|renameSync|rename|copyFileSync|copyFile|cpSync|rmSync|rm|unlinkSync|unlink|rmdirSync|rmdir|mkdirSync|truncateSync|symlinkSync|linkSync|outputFile|outputFileSync|remove|removeSync|move|moveSync)\s*\(/g;
const PY_WRITE_CALL = /\b(?:shutil\.(?:copy|copy2|copyfile|copytree|move|rmtree)|os\.(?:remove|unlink|rename|replace|rmdir|removedirs|makedirs|mkdir|symlink|link))\s*\(/g;
const EXEC_CALL = /(?<![\w$])(execSync|execFile|execFileSync|spawn|spawnSync|fork|execa|execaSync|execaCommand|execaCommandSync|exec)\s*\(/g;
// Inside a string on its line (a message, a sample command): text, not a call.
function inString(src, i) { const before = src.slice(src.lastIndexOf('\n', i) + 1, i).replace(/\\./g, ''); return ['"', "'", '`'].some((q) => (before.split(q).length - 1) % 2 === 1); }
const PY_EXEC_CALL = /\b(?:subprocess\.(?:run|call|Popen|check_output|check_call|getoutput|getstatusoutput)|os\.(?:system|popen|exec\w*|spawn\w*))\s*\(/g;
// The first (or the n-th) argument of a call whose "(" ends at i, as written.
function argAt(src, i, n = 0) {
  let depth = 0, q = '', cur = '', k = 0;
  for (let j = i; j < src.length && j < i + 600; j++) {
    const c = src[j];
    if (q) { cur += c; if (c === '\\') { cur += src[++j] || ''; continue; } if (c === q) q = ''; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; cur += c; continue; }
    if (c === '(' || c === '[' || c === '{') depth++;
    if (c === ')' || c === ']' || c === '}') { if (depth === 0) return k === n ? cur.trim() : null; depth--; }
    if (c === ',' && depth === 0) { if (k === n) return cur.trim(); k++; cur = ''; continue; }
    cur += c;
  }
  return k === n ? cur.trim() : null;
}
const plainLiteral = (a) => /^(['"])(?:(?!\1)[^\\]|\\.)*\1$/.test(a) || /^`[^`$]*`$/.test(a);
const literalList = (a) => /^\[\s*(['"])[^'"]*\1(\s*,\s*([^\]]*))?\]$/.test(a);
// What code does that cannot be judged: a program started by a name that is not written out, or (onlyExec false) a
// file written, moved or deleted by a path that is not written out. '' when nothing.
export function codeOpaque(code, onlyExec = false) {
  const src = String(code || '');
  const usesCp = /child_process|execa|subprocess|\bos\.(system|popen|exec|spawn)/.test(src);
  if (usesCp) {
    for (const re of [EXEC_CALL, PY_EXEC_CALL]) {
      re.lastIndex = 0; let m;
      while ((m = re.exec(src))) {
        if (inString(src, m.index)) continue;
        { const ln = src.slice(src.lastIndexOf('\n', m.index) + 1, m.index); if (/(^|\s)(\/\/|#)/.test(ln) || /^\s*\*/.test(ln)) continue; } // in a comment
        if (m[1] === 'exec') { const rcv = (src.slice(Math.max(0, m.index - 30), m.index).match(/([\w$]+)\s*\.\s*$/) || [])[1]; if (rcv && !/^(cp|child_process|childProcess|proc|child)$/.test(rcv)) continue; } // a regular expression's exec
        const a = argAt(src, m.index + m[0].length, 0);
        if (a === null || a === '') continue;
        if (plainLiteral(a) || literalList(a) || /^(process\.execPath|sys\.executable)$/.test(a)) continue;
        return `a program started by a name that is not written out (${m[0].replace(/\s*\($/, '')}(${a.slice(0, 40)}...))`;
      }
    }
  }
  if (onlyExec) return '';
  for (const re of [WRITE_CALL, PY_WRITE_CALL]) {
    re.lastIndex = 0; let m;
    while ((m = re.exec(src))) {
      const two = /rename|copy|cp|move|symlink|link/i.test(m[1] || m[0]);
      for (const n of two ? [0, 1] : [0]) {
        const a = argAt(src, m.index + m[0].length, n);
        if (a === null || a === '') continue;
        if (!plainLiteral(a)) return `a file written, moved or deleted by a path that is not written out (${(m[1] || m[0]).replace(/\s*\($/, '')}(${a.slice(0, 50)}))`;
      }
    }
  }
  for (const m of src.matchAll(/\bopen\s*\(\s*([^,)]+),\s*(['"])[^'"]*[wax+][^'"]*\2/g)) if (!plainLiteral(m[1].trim())) return `a file opened for writing by a path that is not written out (open(${m[1].slice(0, 50)}))`;
  for (const m of src.matchAll(/\bPath\s*\(\s*([^)]*)\)\s*\.\s*(write_text|write_bytes|unlink|rename|replace|touch|mkdir|rmdir)\b/g)) if (!plainLiteral(m[1].trim())) return `a file written or removed by a path that is not written out (Path(${m[1].slice(0, 50)}).${m[2]})`;
  return '';
}
const TRUST_CACHE = new Map();
function trustedScript(abs) {
  if (!abs) return false;
  if (TRUST_CACHE.has(abs)) return TRUST_CACHE.get(abs);
  // In the notebook or in a copy of it (a helper's worktree): git knows the file, in core/, system/ or starter/.
  const ok = (() => {
    try {
      let real = abs; try { real = fs.realpathSync.native(abs); } catch {}
      const r = spawnSync('git', ['-C', path.dirname(real), 'ls-files', '--full-name', '--error-unmatch', path.basename(real)], { encoding: 'utf8', timeout: 1500, windowsHide: true });
      return r.status === 0 && /^(core|system|starter)\//.test(String(r.stdout || '').trim().split(/\r?\n/)[0]);
    } catch { return false; }
  })();
  TRUST_CACHE.set(abs, ok);
  return ok;
}
export function opaqueWhat(tool, ti, cwd) {
  if (tool !== 'Bash' && tool !== 'PowerShell') return null;
  const cmd = String(ti.command || '');
  const segs = deepSegs(cmd, norm(cwd));
  for (const s of segs) {
    if (s.stdinCode) return { what: `code handed to ${s.stdinCode} on its standard input (a pipe, a heredoc or text built at run time), which no hook can read` };
    if (s.varScript) return { what: `a script named by a variable (${s.varScript})` };
  }
  for (const s of segs) {
    if (s.code === undefined) continue;
    const x = codeOpaque(s.code, !!s.fromFile);
    if (!x) continue;
    if (s.fromFile && trustedScript(s.file)) continue;
    return { what: x + (s.file ? ` in ${s.file}` : ''), code: s.code };
  }
  for (const s of segs) {
    if (s.fromFile || !s.words || s.name === '(code)' || s.name === '(script)') continue;
    let raws = []; try { raws = [...(s.redirects || []), ...writeTargets(s.words)]; } catch {}
    for (const raw of raws) {
      if (/^(\/dev\/null|nul|\$null|&\d?)$/i.test(raw) || /^\d$/.test(raw)) continue;
      if (!expand(raw)) return { what: `a write, move or delete whose target is not written out (${String(raw).slice(0, 60)})` };
    }
  }
  for (const m of dropBodies(cmd).matchAll(/\[(?:system\.)?io\.(?:file|directory)\]::(write\w*|append\w*|create\w*|copy|move|delete|replace)\s*\(\s*([^,)]*)/gi)) {
    if (!plainLiteral(m[2].trim())) return { what: `a .NET file call by a path that is not written out ([IO.File]::${m[1]}(${m[2].slice(0, 40)}))` };
  }
  return null;
}
function opaqueIssue(tool, ti, cwd) {
  if (M('publish', 'refuse') === 'off' && M('selfGuard', 'refuse') === 'off') return '';
  const x = opaqueWhat(tool, ti, cwd);
  if (!x) return '';
  const holdOn = fs.existsSync(holdPath());
  const near = NEAR_GUARDED.test(String(ti.command || '')) || (x.code && NEAR_GUARDED.test(x.code)) || under(norm(cwd), norm(path.join(HOME, '.claude')));
  if (!holdOn && !near) return '';
  return `HIVE GATE (unknown step): I stopped this step. It runs ${x.what}, so no check can tell what it starts or writes, and ${holdOn ? 'the publish hold is on' : 'it names the protected places (the home or Hive folder, Claude\'s settings, the gates or the checks)'}. ` +
    `The one thing to do: run it in a visible, literal form: the program and every file it writes written out in the command itself (no variable, no path or name glued together at run time, no code on standard input, no encoded text); for program code, put it in a file and run that file by its name.`;
}

// ---------- the self guard (2026-11-20: Claude cannot switch off its own gates) ----------
// Refused unless their latest own message asks for it: creating the off switch (gates-off); a change to the gates'
// settings that makes a check softer (a mode lowered, "enabled": false, a safety list shortened or an allow list
// grown); any shell write to those settings (the gate cannot see what it writes); writing, moving or deleting the
// installed gates, the Hive folder's config (it says where the notebook is), Claude's own settings files (they hold the
// hooks, and "disableAllHooks"), a check module's settings that lower its mode, or running the gates' uninstall.
const MODE_RANK = { off: 0, notice: 1, on: 1, refuse: 2 };
const rankOf = (v) => (MODE_RANK[String(v || '').toLowerCase()] ?? 1);
const LIST_RULES = {
  publish: { keep: ['tools', 'patterns', 'vercelDeploy', 'testWords', 'gitPublishTools', 'defaultBranches'], noGrow: ['vercelQuiet', 'dryRunFlags', 'askWords', 'liftWords', 'liftReplyWords'], same: ['holdFile'] },
  yes: { keep: ['paidTools', 'actions', 'holdWords', 'notYetWords', 'negations', 'paidPatterns', 'sendTools'], noGrow: ['yesWords', 'fillerWords', 'deleteWords', 'paidWords', 'deleteAllowFolders', 'publishWords', 'installWords', 'sendWords'], up: ['bareMaxWords'] },
  selfGuard: { noGrow: ['offWords', 'weakenWords', 'installWords'], same: ['hooksSettings'] },
  model: { noGrow: ['exemptAgents', 'allowed'] },
  helpers: { noGrow: ['readOnlyAgents'] },
  checks: { same: ['folder'] },
  handout: { up: ['maxAtOnce', 'staleMinutes'] },
};
export function weakerSettings(oldS, newS, defaults) {
  const out = [];
  if (!newS || typeof newS !== 'object' || Array.isArray(newS)) return ['the new settings cannot be read, so what they would switch cannot be told'];
  const o = oldS || {}, d = defaults || {};
  if (o.enabled !== false && newS.enabled === false) out.push('every gate switched off ("enabled": false)');
  for (const k of new Set([...Object.keys(o), ...Object.keys(d), ...Object.keys(newS)])) {
    const om = (o[k] && o[k].mode) ?? (d[k] && d[k].mode);
    const nm = (newS[k] && newS[k].mode) ?? (d[k] && d[k].mode);
    if (om !== undefined && rankOf(nm) < rankOf(om)) out.push(`${k}: from ${om} to ${nm}`);
    const ok = (o[k] && o[k].modes) || {}, nk = (newS[k] && newS[k].modes) || {};
    for (const id of Object.keys(ok)) if (rankOf(nk[id] ?? 'refuse') < rankOf(ok[id])) out.push(`${k}.modes.${id}: from ${ok[id]} to ${nk[id]}`);
    for (const id of Object.keys(nk)) if (!(id in ok) && rankOf(nk[id]) < 2) out.push(`${k}.modes.${id}: set to ${nk[id]}`);
  }
  for (const [k, r] of Object.entries(LIST_RULES)) {
    const ov = { ...(d[k] || {}), ...(o[k] || {}) }, nv = { ...(d[k] || {}), ...(newS[k] || {}) };
    const set = (a) => new Set((Array.isArray(a) ? a : []).map((x) => JSON.stringify(x).toLowerCase()));
    for (const f of r.keep || []) { const n = set(nv[f]); if ([...set(ov[f])].some((x) => !n.has(x))) out.push(`${k}.${f}: an entry taken out`); }
    for (const f of r.noGrow || []) {
      const old = set(ov[f]);
      if (f === 'allowed') { // an empty list allows any model: emptying it is softer, filling an empty one is stricter
        if (old.size && !set(nv[f]).size) out.push(`${k}.${f}: emptied (any model)`);
        else if (old.size && [...set(nv[f])].some((x) => !old.has(x))) out.push(`${k}.${f}: a model added`);
        continue;
      }
      if ([...set(nv[f])].some((x) => !old.has(x))) out.push(`${k}.${f}: an entry added`);
    }
    for (const f of r.same || []) if (JSON.stringify(ov[f]) !== JSON.stringify(nv[f])) out.push(`${k}.${f}: changed`);
    for (const f of r.up || []) if (Number(nv[f]) > Number(ov[f])) out.push(`${k}.${f}: raised from ${ov[f]} to ${nv[f]}`);
  }
  return out;
}
// The new text of a file after a Write, Edit or MultiEdit, or null when it cannot be told.
// One edit, as the app's Edit tool applies it: the text as written; else with the file's Windows line ends (the app
// matches an edit written with plain line ends against a file with Windows ones, seen 2026-11-20); else with every
// line end made the same. undefined: the old text is not in the file, so what the edit does cannot be told.
export function applyEdit(text, a, b, all) {
  const put = (t, x, y) => (all ? t.split(x).join(y) : t.replace(x, () => y));
  if (!a) return undefined;
  if (text.includes(a)) return put(text, a, b);
  if (/\r\n/.test(text)) {
    const a2 = a.replace(/\r?\n/g, '\r\n'), b2 = b.replace(/\r?\n/g, '\r\n');
    if (text.includes(a2)) return put(text, a2, b2);
  }
  const tn = text.replace(/\r\n/g, '\n'), an = a.replace(/\r\n/g, '\n');
  if (an && tn.includes(an)) return put(tn, an, b.replace(/\r\n/g, '\n'));
  return undefined;
}
function newTextOf(tool, ti, abs) {
  if (tool === 'Write') return String(ti.content ?? '');
  let text; try { text = fs.readFileSync(abs, 'utf8'); } catch { return null; }
  const edits = tool === 'MultiEdit' ? (ti.edits || []) : [ti];
  for (const e of edits) {
    const t = applyEdit(text, String(e.old_string ?? ''), String(e.new_string ?? ''), !!e.replace_all);
    if (t === undefined) return undefined; // not found, even with the line ends made the same
    text = t;
  }
  return text;
}
function selfIssue(tool, ti, cwd) {
  if (M('selfGuard', 'refuse') === 'off') return '';
  const G = S.selfGuard;
  const conn = connectorPaths(tool, ti);
  const isFile = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(tool) || conn.length > 0;
  const isShell = tool === 'Bash' || tool === 'PowerShell';
  if (!isFile && !isShell) return '';
  const off = norm(OFF), gdir = norm(GDIR), state = norm(STATE), cfg = norm(path.join(STATE, 'config.json'));
  const settings = norm(path.join(ROOT, 'core', 'gates', 'settings.json'));
  const checksDir = norm(path.join(ROOT, (S.checks && S.checks.folder) || 'core/checks'));
  let hooksRe; try { hooksRe = new RegExp(G.hooksSettings || '/\\.claude/settings(\\.local)?\\.json$', 'i'); } catch { hooksRe = /\/\.claude\/settings(\.local)?\.json$/i; }
  const cmd = isShell ? String(ti.command || '') : '';
  const targets = conn.length ? conn.map((abs) => ({ abs, del: /delete|remove|move|rename/i.test(tool.split('__').pop()), gone: /delete|remove|move|rename/i.test(tool.split('__').pop()) }))
    : isFile ? [{ abs: norm(ti.file_path || ti.notebook_path || '', cwd), del: false }]
    : allShellTargets(cmd, cwd);
  const hold = norm(holdPath());
  const free = ((S.selfGuard && S.selfGuard.freeFolders) || ['verify', 'sources']).map((d) => norm(path.join(STATE, d)));
  const rules = norm(path.join(ROOT, 'system', 'rules.md'));
  const found = [];
  for (const t of targets) {
    if (!t.abs) continue;
    // Without its rules note the notebook is "not found" and most gates stop: moving or deleting it is the off switch too.
    if (t.gone && (t.abs === rules || under(rules, t.abs))) { found.push({ kind: 'install', what: 'move or delete the rules note (without it most gates stop)' }); continue; }
    if (t.abs === off) { if (!t.del) found.push({ kind: 'off', what: 'create the off switch (every gate would stop)' }); continue; }
    if (t.abs === settings) {
      if (isFile) {
        const nt = conn.length ? null : newTextOf(tool, ti, t.abs);
        if (nt === undefined) { found.push({ kind: 'weaken', what: "edit the gates' settings with an old text that is not in the file as it is now, so what the edit changes cannot be told (read the file again and edit what is there)" }); continue; }
        let ns = null; try { ns = nt === null ? null : JSON.parse(nt); } catch {}
        const weak = weakerSettings(readJson(t.abs, {}), ns, DEFAULTS);
        if (weak.length) found.push({ kind: 'weaken', what: `make the gates' settings softer (${weak.slice(0, 3).join('; ')})` });
      } else found.push({ kind: 'weaken', what: 'change the gates\' settings from the shell (the gate cannot see what it writes; use the Edit tool)' });
      continue;
    }
    if (under(t.abs, checksDir) && /\/settings\.json$/.test(t.abs)) {
      if (isFile) {
        const nt = conn.length ? null : newTextOf(tool, ti, t.abs);
        if (nt === undefined) { found.push({ kind: 'weaken', what: "edit a check module's settings with an old text that is not in the file as it is now, so what the edit changes cannot be told (read the file again)" }); continue; }
        let ns = null; try { ns = nt === null ? null : JSON.parse(nt); } catch {}
        const om = readJson(t.abs, {}).mode || 'refuse', nm = ns && typeof ns === 'object' ? (ns.mode || 'refuse') : 'unreadable';
        if (nm === 'unreadable' || rankOf(nm) < rankOf(om)) found.push({ kind: 'weaken', what: `lower a check module's mode (${t.abs.split('/').slice(-2, -1)[0]}: from ${om} to ${nm})` });
      } else found.push({ kind: 'weaken', what: 'change a check module\'s settings from the shell (use the Edit tool)' });
      continue;
    }
    // A module's program runs inside the hooks, unchecked: writing one could undo any gate (delete the hold, write the off switch).
    if (under(t.abs, checksDir) && !t.abs.endsWith('.md')) { found.push({ kind: 'install', what: `change a check module's program, which runs inside the hooks (${t.abs})` }); continue; }
    if (t.abs === cfg) { found.push({ kind: 'install', what: 'change where the gates find the notebook (config.json)' }); continue; }
    if ((path.posix.dirname(t.abs) === gdir && !/\.(json|log)$/.test(t.abs)) || t.abs === gdir || t.abs === state || under(state, t.abs)) { found.push({ kind: 'install', what: `change the installed gates (${t.abs})` }); continue; }
    if (hooksRe.test(t.abs)) { found.push({ kind: 'install', what: `change Claude's settings, where the hooks live (${t.abs})` }); continue; }
    // Anything else in the Hive folder (the debt store, the checks' and the gates' records, the self guard's records):
    // written by Hive Mind's programs and by the person, never by Claude. Free: a checker's evidence, what they sent, and making
    // the hold (stricter); the hold's own deletion is the hold check's.
    if (under(t.abs, state) && t.abs !== hold && !free.some((f) => under(t.abs, f))) { found.push({ kind: 'install', what: `write inside the Hive folder (${t.abs}), which only Hive Mind's programs and the person write` }); continue; }
  }
  if (isShell) {
    for (const s of deepSegs(cmd, norm(cwd))) {
      if (s.fromFile) continue;
      const nm = s.name;
      const text = (s.code !== undefined ? s.code : s.words.join(' ')).toLowerCase();
      // Only a step that RUNS the gates' installer counts, never one that names its file (2026-11-20, seen live: a loop
      // over file names and a read of the file were refused). A dry run, and a run aimed at a made-up Claude folder under
      // the system temp folder that is not the real one, change nothing he uses.
      const ir = s.code === undefined ? installerRunOf(s) : '';
      if (ir === 'uninstall') found.push({ kind: 'uninstall', what: 'uninstall the gates' });
      else if (ir === 'install') found.push({ kind: 'install', what: 'install the gates again (it rewrites the hooks)' });
      if (/settings-merge\.mjs/.test(text) && /\b(unmerge|remove|--remove|uninstall)\b/.test(text)) found.push({ kind: 'uninstall', what: 'take the gates out of the hooks' });
      if (s.code !== undefined || !READ_CMDS.has(nm)) {
        if (text.includes('gates-off') && !DELETE_CMDS.has(nm)) found.push({ kind: 'off', what: 'a command that names the off switch' });
        if (/disableallhooks/.test(text)) found.push({ kind: 'install', what: 'switch every hook off (disableAllHooks)' });
        if (s.code !== undefined && /gates[\\/]+settings\.json/.test(text) && /writefile|appendfile|rename|unlink|rmsync|open\([^)]*['"][wa]/.test(text)) found.push({ kind: 'weaken', what: 'change the gates\' settings from program code' });
      }
    }
  }
  if (!found.length) return '';
  // "undo the Hive Mind setup": the person's own phrase from the manuals (docs/when-it-breaks.md) for the full undo.
  const words = { off: G.offWords, weaken: G.weakenWords, install: G.installWords, uninstall: ['uninstall', 'remove the gates', 'take the gates out', 'undo the hive mind setup'] };
  const left = found.filter((f) => !saidYes(words[f.kind] || [], words[f.kind] || []));
  if (!left.length) return '';
  return `HIVE GATE (self guard): I stopped this step. It would ${left[0].what}${left.length > 1 ? `, and ${left.length - 1} more of the same kind` : ''}. ` +
    `The gates guard Claude, so Claude cannot switch them off or make them softer on its own. The one thing to do: ask the person in one plain sentence; only their own words (or their yes to that question) let it through.`;
}

// ---------- Docker ----------
// Needs the person's words (the yes gate): a remote Docker (-H/--host, docker context use, DOCKER_HOST), --privileged,
// the host's network or process space, a mount of the Docker socket, of the home folder or of a drive root, deleting
// volumes, and the first pull of an image not named in the notebook's own container files (Dockerfile, compose files).
// Free: build, run of a known image, compose up, down, run and watch on this computer, listing. A push, a build with
// --push, a compose push and docker login are publishes (publish.patterns): stopped while the hold is on.
// Every option of docker run and docker create that takes a value (docker 29, `docker run --help`): its value is
// never the image ("--cpu-shares 2" is not the image "2").
const RUN_VALUED = new Set(['-v', '--volume', '-e', '--env', '-p', '--publish', '--name', '-w', '--workdir', '--network', '--net', '-u', '--user', '--entrypoint', '--mount', '--env-file', '-l', '--label', '--cpus', '-m', '--memory', '--platform', '--pid', '-h', '--hostname', '--add-host', '--device', '--restart', '--gpus', '--ipc', '--cap-add', '--cap-drop', '--security-opt', '--tmpfs', '--ulimit', '--log-driver', '--log-opt', '--expose', '--link', '--pull', '--shm-size', '--stop-signal', '--uts', '--userns', '--cgroupns', '--dns', '--runtime',
  '-a', '--attach', '-c', '--cpu-shares', '--annotation', '--blkio-weight', '--blkio-weight-device', '--cgroup-parent', '--cidfile', '--cpu-count', '--cpu-percent', '--cpu-period', '--cpu-quota', '--cpu-rt-period', '--cpu-rt-runtime', '--cpuset-cpus', '--cpuset-mems', '--detach-keys', '--device-cgroup-rule', '--device-read-bps', '--device-read-iops', '--device-write-bps', '--device-write-iops', '--dns-option', '--dns-opt', '--dns-search', '--domainname', '--group-add', '--health-cmd', '--health-interval', '--health-retries', '--health-start-period', '--health-start-interval', '--health-timeout', '--ip', '--ip6', '--isolation', '--kernel-memory', '--label-file', '--link-local-ip', '--mac-address', '--memory-reservation', '--memory-swap', '--memory-swappiness', '--network-alias', '--net-alias', '--oom-score-adj', '--pids-limit', '--stop-timeout', '--storage-opt', '--sysctl', '--volume-driver', '--volumes-from']);
// docker run's one-letter switches that take no value (-d -i -t -P -q), which may be joined (-it, -dit); a joined
// group may end in one letter that takes a value (-itv x).
const RUN_SHORT_SWITCHES = 'ditPq';
const RUN_SHORT_VALUED = 'acehlmpuvw';
// What a word starting with "-" is, before the image of docker run: 'value' (it takes the next word), 'switch', or
// 'notDocker' (no option of docker run, such as find's "-type": the image was not written out here, as when a
// program's code holds it in a variable the gate cannot read).
function runOptionKind(x) {
  const f = x.split('=')[0].toLowerCase();
  if (x.includes('=')) return 'switch';
  if (RUN_VALUED.has(f)) return 'value';
  if (x.startsWith('--') || x.length === 2) return 'switch';
  // Docker reads joined letters one by one: switches, then at most one letter that takes a value, whose value is the
  // rest of the word (-ep is -e "p", -v/x:/y is -v "/x:/y", -p8080:80) or, when nothing is left, the next word.
  const letters = x.slice(1);
  for (let i = 0; i < letters.length; i++) {
    if (RUN_SHORT_SWITCHES.includes(letters[i])) continue;
    if (RUN_SHORT_VALUED.includes(letters[i])) return i === letters.length - 1 ? 'value' : 'switch';
    return 'notDocker';
  }
  return 'switch';
}
// A share of the computer's folders at word k of a docker command, as written (capitals kept): { flag, value }, or
// null. Every spelling docker reads: -v x, -vx, -v=x, -itv x, -itvx, --volume x, --volume=x, --mount x, --mount=x.
function shareOf(a, k) {
  const w = String(a[k] || '');
  if (w.startsWith('--')) {
    const i = w.indexOf('=');
    const flag = (i < 0 ? w : w.slice(0, i)).toLowerCase();
    if (flag !== '--volume' && flag !== '--mount') return null;
    const value = i < 0 ? a[k + 1] : w.slice(i + 1);
    return value ? { flag, value: String(value) } : null;
  }
  if (!w.startsWith('-') || w.length < 2) return null;
  for (let i = 1; i < w.length; i++) {
    if (RUN_SHORT_SWITCHES.includes(w[i])) continue;
    if (w[i] !== 'v') return null;
    const value = w.slice(i + 1).replace(/^=/, '') || a[k + 1];
    return value ? { flag: '-v', value: String(value) } : null;
  }
  return null;
}
// An image named by a tag or a fingerprint (redis:7, hello-world@sha256:...), not an address (git@host:x, https://).
const IMAGE_REF = /^[a-z0-9][a-z0-9._/-]*(:[\w.-]+)?(@sha256:[0-9a-f]{6,})?$/i;
const imageShaped = (x) => IMAGE_REF.test(String(x || '')) && /[:@]/.test(String(x || '')) && !/:\/\//.test(String(x || ''));
let KNOWN_IMAGES = null;
export function knownImages(root = ROOT) {
  if (KNOWN_IMAGES && root === ROOT) return KNOWN_IMAGES;
  const out = new Set();
  const skip = new Set(['node_modules', '.git', 'archive', 'me', '.next', 'dist', 'build', '.claude']);
  const walk = (d, depth) => {
    let list = []; try { list = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of list) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (depth < 4 && !skip.has(e.name)) walk(p, depth + 1); continue; }
      if (!/^(dockerfile|containerfile)(\..*)?$|^(docker-)?compose(\.[\w-]+)?\.ya?ml$|\.dockerfile$/i.test(e.name)) continue;
      let t = ''; try { t = fs.readFileSync(p, 'utf8').slice(0, 200000); } catch { continue; }
      for (const m of t.matchAll(/^\s*FROM\s+(?:--platform=\S+\s+)?(\S+)/gim)) out.add(m[1].toLowerCase());
      for (const m of t.matchAll(/^\s*image:\s*["']?([^\s"'#]+)/gim)) out.add(m[1].toLowerCase());
    }
  };
  walk(root, 0);
  for (const x of readLines(path.join(GDIR, 'docker-images.jsonl'))) if (x && x.i) out.add(String(x.i).toLowerCase());
  // The notebook's list of allowed images (docker/allowed-images.txt): an image that no container file builds FROM,
  // each pinned by its fingerprint. It lets exactly that fingerprint through, never another tag or fingerprint of the
  // same name (marked "pinned:").
  for (const p of pinnedImages(root)) out.add(`pinned:${p}`);
  if (root === ROOT) KNOWN_IMAGES = out;
  return out;
}
export const ALLOWED_IMAGES = 'docker/allowed-images.txt';
// The lines of the allowed list that name an image by its fingerprint (name[:tag]@sha256:<64 hex>); any other line is
// left out.
export function pinnedImages(root = ROOT) {
  let t = ''; try { t = fs.readFileSync(path.join(root, ALLOWED_IMAGES), 'utf8'); } catch { return []; }
  return t.replace(/^﻿/, '').split(/\r?\n/).map((l) => l.replace(/#.*$/, '').trim()).filter((l) => /^[a-z0-9][a-z0-9._/-]*(:[\w.-]+)?@sha256:[0-9a-f]{64}$/i.test(l)).map((l) => l.toLowerCase());
}
const imageBase = (i) => String(i || '').toLowerCase().replace(/^docker\.io\/(library\/)?/, '');
// A pinned entry matches the same name and fingerprint only (a tag written beside the fingerprint does not count).
const pinnedSame = (a, b) => { const fa = a.split('@'); const fb = b.split('@'); return fb.length === 2 && fa[1] === fb[1] && fa[0].split(':')[0] === fb[0].split(':')[0]; };
const imageKnown = (img, known) => { const b = imageBase(img); if (!b || b.startsWith('$')) return false; for (const k of known) { if (k.startsWith('pinned:')) { if (pinnedSame(imageBase(k.slice(7)), b)) return true; continue; } const kb = imageBase(k); if (kb === b || kb.split(/[:@]/)[0] === b.split(/[:@]/)[0]) return true; } return false; };
function builtTags(segs) {
  const tags = [];
  for (const s of segs || []) {
    if (!s.words) continue;
    const w = stripPrefix(s.words);
    if (!['docker', 'podman'].includes(cmdName(w[0]))) continue;
    const pos = w.slice(1).filter((x) => !x.startsWith('-'));
    if (!(pos[0] === 'build' || (pos[0] === 'buildx' && pos[1] === 'build') || (pos[0] === 'image' && pos[1] === 'build'))) continue;
    for (let k = 1; k < w.length; k++) { const [f, v] = w[k].split('='); if (f === '-t' || f === '--tag') tags.push(String(v !== undefined ? v : w[k + 1] || '').toLowerCase()); }
  }
  return tags.filter(Boolean);
}
export function dockerRisks(segs, known = null) {
  const out = [];
  const home = norm(HOME);
  known = new Set([...(known || knownImages()), ...builtTags(segs)]);
  for (const s of segs || []) {
    if (!s.words || s.name === '(code)') continue;
    const raw = (s.bare && !s.bare.includes('""') ? s.bare : s.words.join(' '));
    if (/\bDOCKER_HOST\s*=/i.test(raw) || /\$env:DOCKER_HOST\b/i.test(raw) && /=/.test(raw)) { out.push({ kind: 'remote', action: 'point Docker at another computer (DOCKER_HOST)', what: raw.slice(0, 80), objs: [] }); continue; }
    const w = stripPrefix(s.words);
    let name = cmdName(w[0]);
    // A program held in a variable whose value this step does not show (& $d pull x): read as docker when the
    // variable is named for docker, or when it pulls an image by a tag or a fingerprint. "& $g pull origin main" is not.
    if (/^[$%]/.test(w[0] || '') && (/docker|podman/i.test(w[0]) || (String(w[1] || '').toLowerCase() === 'pull' && imageShaped(w.slice(2).find((x) => !x.startsWith('-')))))) name = 'docker';
    if (name !== 'docker' && name !== 'docker-compose' && name !== 'podman') continue;
    const a = w.slice(1);
    const low = a.map((x) => x.toLowerCase());
    const pos = low.filter((x) => !x.startsWith('-'));
    const firstPos = a.findIndex((x) => !x.startsWith('-'));
    const globals = firstPos < 0 ? a : a.slice(0, firstPos);
    if (globals.some((x) => x === '-H' || x === '--host' || /^(-H|--host)=/.test(x)) || (name === 'docker' && low.includes('--context') && globals.some((x) => /^--context/.test(x)))) out.push({ kind: 'remote', action: 'use Docker on another computer (-H)', what: raw.slice(0, 80), objs: [] });
    if (pos[0] === 'context' && pos[1] === 'use') out.push({ kind: 'remote', action: 'switch Docker to another computer (docker context use)', what: raw.slice(0, 80), objs: [] });
    if (low.includes('--privileged')) out.push({ kind: 'privileged', action: 'run a container with every power over this computer (--privileged)', what: raw.slice(0, 80), objs: [] });
    for (let k = 0; k < low.length; k++) {
      const [f, v0] = low[k].split('=');
      const v = v0 !== undefined ? v0 : low[k + 1];
      if (['--network', '--net'].includes(f) && v === 'host') out.push({ kind: 'host', action: "give a container this computer's network (--network host)", what: raw.slice(0, 80), objs: [] });
      if (['--pid', '--ipc', '--uts', '--userns'].includes(f) && v === 'host') out.push({ kind: 'host', action: `give a container this computer's ${f.slice(2)} space (${f} host)`, what: raw.slice(0, 80), objs: [] });
      const share = shareOf(a, k);
      if (share) {
        // The folder as written (not lowered): on Linux a folder's name keeps its capitals.
        const { flag } = share;
        // The home folder by any of its names ($HOME, ${HOME}, $env:USERPROFILE, ${env:USERPROFILE}, %USERPROFILE%) is
        // the home folder, before the share is split at its colons ($env:USERPROFILE:/h would split inside the name).
        const v = share.value.replace(/(\$\{env:(?:USERPROFILE|HOME)\}|\$env:(?:USERPROFILE|HOME)\b|\$\{HOME\}|\$HOME\b|%(?:USERPROFILE|HOME)%)/gi, () => HOME);
        const src = (flag === '--mount' ? ((v.match(/(?:^|,)(?:source|src)=([^,]+)/i) || [])[1] || '') : (v.match(/^([a-z]:[\\/][^:]*|[^:]+)/i) || [])[1] || '').trim();
        const e = expand(src) || src;
        const n = norm(e);
        const drive = /^[a-z]:\/?$/i.test(e.replace(/\\/g, '/')) || e === '/' || n === '/';
        if (/docker\.sock|\/\/\.\/pipe\/docker_engine|\\\\\.\\pipe\\docker_engine/i.test(v)) out.push({ kind: 'socket', action: 'hand a container the Docker socket (it can then run anything on this computer)', what: raw.slice(0, 80), objs: [] });
        else if (drive || (n && (n === home || home.startsWith(n + '/') || n === norm(path.join(HOME, '.claude')) || under(n, norm(path.join(HOME, '.claude')))))) out.push({ kind: 'mount', action: 'mount the home folder or a whole drive into a container', what: raw.slice(0, 80), objs: [] });
      }
    }
    const verb = pos[0] || '';
    if ((verb === 'volume' && ['rm', 'remove', 'prune'].includes(pos[1])) || (verb === 'system' && pos[1] === 'prune' && low.includes('--volumes')) || ((verb === 'compose' || name === 'docker-compose') && pos.includes('down') && (low.includes('-v') || low.includes('--volumes'))) || (verb === 'rm' && (low.includes('-v') || low.includes('--volumes'))))
      out.push({ kind: 'volumes', action: 'delete Docker volumes (the data kept in them is gone)', what: raw.slice(0, 80), objs: pos.slice(2) });
    let img = '';
    if (verb === 'pull' || (verb === 'image' && pos[1] === 'pull')) {
      // docker pull's one option with a value is --platform; its value is never the image.
      const start = a.findIndex((x) => x.toLowerCase() === 'pull');
      for (let k = start + 1; k < a.length; k++) { const x = a[k]; if (x.startsWith('-')) { if (x.toLowerCase() === '--platform') k++; continue; } img = x; break; }
    }
    if (['run', 'create'].includes(verb) || (verb === 'container' && ['run', 'create'].includes(pos[1]))) {
      const start = a.findIndex((x) => x.toLowerCase() === (verb === 'container' ? pos[1] : verb));
      for (let k = start + 1; k < a.length; k++) {
        const x = a[k];
        if (x.startsWith('-')) {
          const kind = runOptionKind(x);
          // No option of docker run: these are the container's own words, so the image was not written out in this
          // step (a program's code holding it in a variable). Nothing is named, so nothing is taken for an image.
          if (kind === 'notDocker') break;
          if (kind === 'value') k++;
          continue;
        }
        img = x; break;
      }
    }
    if (img && !imageKnown(img, known)) out.push({ kind: 'pull', action: `fetch the image ${img}, which none of the notebook's container files names`, what: raw.slice(0, 80), objs: [imageBase(img).split(/[:@]/)[0], imageBase(img).split(/[:@/]/).pop()] });
  }
  // One step read two ways (a variable's value split and whole) names the same act once.
  return out.filter((d, i) => out.findIndex((e) => e.kind === d.kind && e.action === d.action) === i);
}

// 'install', 'uninstall' or '' for one simple command: does it run the gates' install.ps1 or uninstall.ps1 for real?
export function installerRunOf(s) {
  const w = stripPrefix(s.words || []);
  if (!w.length) return '';
  let i = -1;
  const isPs1 = (a) => /(^|[\\/])(un)?install\.ps1$/i.test(String(a || ''));
  if (isPs1(w[0])) i = 0;
  else if (['powershell', 'pwsh'].includes(cmdName(w[0]))) { const f = w.findIndex((a) => /^-file$/i.test(a)); if (f > 0 && isPs1(w[f + 1])) i = f + 1; }
  if (i < 0) return '';
  const p = String(w[i]).replace(/\\/g, '/').toLowerCase();
  if (!/gates\/(un)?install\.ps1$/.test(p) && !/^(un)?install\.ps1$/.test(p.split('/').pop() || '') ) return '';
  if (!/gates|hive/.test((s.words || []).join(' ').toLowerCase()) && !/^\.?\/?(un)?install\.ps1$/.test(p)) return '';
  const args = w.slice(i + 1);
  const low = args.map((a) => a.toLowerCase());
  if (low.some((a) => ['-dryrun', '-whatif', '--dry-run', '-?', '-help', '--help'].includes(a))) return '';
  const k = low.findIndex((a) => a === '-claudedir');
  const target = k >= 0 && args[k + 1] ? norm(expand(args[k + 1]) || args[k + 1]) : '';
  const real = norm(path.join(HOME, '.claude'));
  const tmps = [os.tmpdir(), process.env.TEMP, process.env.TMP, process.env.TMPDIR].filter(Boolean).map((t) => norm(t));
  if (target && tmps.some((t) => under(target, t)) && !under(target, real) && !under(real, target)) return '';
  return /uninstall\.ps1$/.test(p) ? 'uninstall' : 'install';
}

// ---------- the yes gate, the act by act reading ----------
function yesIssues(tool, ti, cwd) {
  if (M('yes', 'refuse') === 'off') return [];
  const Y = S.yes;
  const found = [];
  if (tool === 'Bash' || tool === 'PowerShell') {
    const cmd = String(ti.command || '');
    const segs = deepSegs(cmd, norm(cwd));
    const pub = publishWhat(tool, ti, cwd, false);
    if (pub && !saidYes(Y.publishWords || S.publish.askWords || [])) found.push({ action: 'put something online', what: pub });
    const actions = (Y.actions && Y.actions.length ? Y.actions : DEFAULT_ACTIONS).filter((a) => !/^publish/i.test(a.name || ''));
    for (const a of actions) {
      let re; try { re = new RegExp(a.pattern, 'i'); } catch { continue; }
      // A save that skips the privacy check inside a throw-away repository under the system temp folder (the copy's whole
      // check makes such saves in its own folder) is not his notebook's: let through there, and only there.
      const throwAway = (s) => /no-verify/i.test(a.name || '') && s.name === 'git' && (() => { const g = gitArgs(s.args); const d = g && g.dir ? (expand(g.dir) ? norm(expand(g.dir), s.cwd) : '') : s.cwd; return !!d && tempish(d); })();
      const hit = segs.find((s) => s.name !== '(code)' && re.test(s.bare || s.words.join(' ')) && !throwAway(s));
      if (hit && !saidYes(a.words || [])) found.push({ action: a.name, what: (hit.bare || hit.words.join(' ')).slice(0, 80) });
    }
    const flat = dropBodies(cmd);
    for (const x of INSTALL_EXTRA) {
      const m = flat.match(x.re) || segs.map((s) => (s.code !== undefined ? '' : s.words.join(' '))).join('\n').match(x.re);
      if (m && !saidYes(Y.installWords || ['install'])) { found.push({ action: `install ${x.what}`, what: m[0].slice(0, 80) }); break; }
    }
    const outsideOf = (targets) => targets.filter((t) => t === '?' || (!tempish(t) && !t.split('/').some((seg) => (Y.deleteAllowFolders || []).includes(seg)) && !ownScratch(t)));
    const dels = [];
    for (const s of segs) {
      if (s.fromFile) continue; // a script's own deletes: the script is judged when it is run (not seen: no hook reads it whole)
      const g = s.name === 'git' ? gitArgs(s.args) : null;
      const sub = g ? g.sub : '';
      const gdir = g && g.dir ? (() => { const e = expand(g.dir); return e ? norm(e, s.cwd) : '?'; })() : s.cwd;
      if (DELETE_CMDS.has(s.name) || (s.name === 'find' && s.args.includes('-delete'))) {
        const raw = writeTargets(s.words);
        dels.push(...outsideOf(raw.map((t) => { const e = expand(t); return e ? norm(e, s.cwd) : '?'; })));
      } else if (g && sub === 'clean' && !g.rest.some((a) => /^(-n|--dry-run)$/.test(a))) dels.push(...outsideOf([gdir]));
      else if (g && sub === 'rm' && !g.rest.includes('--cached')) {
        const after = unixPos(g.rest).filter((a) => a !== '--');
        dels.push(...outsideOf(after.map((t) => { const e = expand(t); return e ? (gdir === '?' ? '?' : norm(e, gdir)) : '?'; })));
      } else if (s.name === 'robocopy') {
        // robocopy /MIR and /PURGE delete what the source lacks in the destination; /MOV and /MOVE delete the source (N30).
        const fl = s.args.filter((a) => a.startsWith('/')).map((a) => a.toLowerCase());
        const pos = s.args.filter((a) => !a.startsWith('/'));
        const at = (t) => { const e = t && expand(t); return e ? norm(e, s.cwd) : '?'; };
        if (fl.some((f) => f === '/mir' || f === '/purge')) dels.push(...outsideOf([at(pos[1])]));
        if (fl.some((f) => f === '/mov' || f === '/move')) dels.push(...outsideOf([at(pos[0])]));
      } else if (['mv', 'move', 'mi', 'move-item'].includes(s.name)) {
        const pos = s.name === 'mv' ? unixPos(s.args) : psArgs(s.args).pos;
        const named = s.name === 'mv' ? {} : psArgs(s.args).named;
        const dest = named.destination || pos[pos.length - 1];
        const srcs = named.path ? [named.path] : pos.slice(0, -1);
        const de = dest && expand(dest);
        if (de && tempish(norm(de, s.cwd))) dels.push(...outsideOf(srcs.map((t) => { const e = expand(t); return e ? norm(e, s.cwd) : '?'; })));
      } else if (s.code !== undefined) {
        const re = /\b(rmSync|rmdirSync|unlinkSync|rm|rmdir|unlink|rmtree|remove|removedirs|remove_tree)\s*\(\s*([^,)]*)/g;
        let m;
        while ((m = re.exec(s.code))) {
          const arg = m[2].trim();
          const lit = arg.match(/^(['"`])([^'"`]+)\1$/);
          dels.push(...outsideOf([lit ? norm(lit[2], s.cwd) : '?']));
        }
      }
      if (/\[(system\.)?io\.(file|directory)\]::delete/i.test(s.words.join(' '))) dels.push('?');
    }
    const delObjs = [...new Set(dels.filter((t) => t !== '?').flatMap(objectWords))];
    if (dels.length && !saidYes(Y.deleteWords || [], Y.deleteWords || [], delObjs)) found.push({ action: 'delete files outside the temporary folders', what: [...new Set(dels)].slice(0, 2).map((t) => (t === '?' ? 'a path the gate cannot read (a variable or a program)' : t)).join(', ') });
    // Spending from the command line (vercel domains buy, N39).
    for (const s of segs) {
      if (s.name === '(code)' || !s.words) continue;
      let ws = stripPrefix(s.words); if (['npx', 'bunx', 'pnpx'].includes(cmdName(ws[0]))) { ws = ws.slice(1); while (ws.length && ws[0].startsWith('-')) ws.shift(); }
      const text = [cmdName(ws[0]), ...ws.slice(1)].join(' ');
      if ((Y.paidPatterns || []).some((p) => { try { return new RegExp(p, 'i').test(text); } catch { return false; } })) {
        const objs = ws.slice(1).filter((a) => /\.[a-z]{2,}$/i.test(a)).map((a) => a.toLowerCase()).concat(['domain']);
        if (!saidYes(Y.paidWords || [], Y.paidWords || [], objs)) found.push({ action: 'spend money from the command line', what: text.slice(0, 80) });
        break;
      }
    }
    // A bare install that would add packages: package.json lists a dependency its lock file does not (N34: the list
    // edited, then a bare npm install). npm ci installs only what the lock holds and is not one.
    for (const s of segs) {
      if (!['npm', 'pnpm', 'yarn', 'bun'].includes(s.name) || !s.args) continue;
      const pos = s.args.filter((a) => !a.startsWith('-'));
      const bare = (pos.length === 0 && s.name === 'yarn') || (['install', 'i'].includes(pos[0]) && pos.length === 1);
      if (!bare) continue;
      const added = unlockedDeps(s.cwd);
      if (added.length && !saidYes(Y.installWords || ['install'], Y.installWords || ['install'], added)) { found.push({ action: 'install packages that were added to package.json and are not in its lock file', what: added.slice(0, 3).join(', ') }); break; }
    }
    // Docker (part of every project since 2026-11-20, his order): what reaches past this computer or its sandbox needs
    // his words; building, a sealed run, compose on this computer and listing do not (dockerRisks).
    for (const d of dockerRisks(segs)) {
      const D = Y.docker || {};
      if (!saidYes(D[d.kind] || D.words || ['docker'], D[d.kind] || D.words || ['docker'], d.objs)) found.push({ action: d.action, what: d.what });
    }
  } else if (tool === 'Write') {
    // Writing a note empty is a delete (N32): an existing file of more than 200 bytes outside the temporary folders,
    // written with almost nothing.
    const abs = norm(ti.file_path || '', cwd);
    let size = 0; try { size = fs.statSync(abs).size; } catch {}
    if (size > 200 && String(ti.content ?? '').trim().length < 16 && !tempish(abs) && !abs.split('/').some((seg) => (Y.deleteAllowFolders || []).includes(seg))) {
      if (!saidYes(Y.deleteWords || [], Y.deleteWords || [], objectWords(abs))) found.push({ action: 'empty a file (what is in it would be gone)', what: abs });
    }
  } else if (tool.startsWith('mcp__')) {
    const short = tool.split('__').pop();
    const dom = [ti.name, ti.domain, ti.domainName].filter((x) => typeof x === 'string').map((x) => x.toLowerCase()).concat(['domain']); // the domain, or the word domain ("buy the domain we picked")
    if ((Y.paidTools || []).some((t) => short === t || short.endsWith(t)) && !saidYes(Y.paidWords || [], Y.paidWords || [], dom)) found.push({ action: 'use a paid tool (it can spend money)', what: short });
    // A connector that sends a message on their behalf (an e-mail, a chat message, an invite, a public comment): their words
    // must name the sending and whom it goes to.
    if ((Y.sendTools || []).includes(short)) {
      const to = [ti.to, ti.recipient, ti.recipients, ti.channel, ti.attendees, ti.email].flat().filter((x) => typeof x === 'string').flatMap((x) => x.toLowerCase().split(/[,;\s]+/)).map((x) => x.replace(/@.*$/, '').replace(/^[#@]/, '')).filter((x) => x.length >= 3);
      if (!saidYes(Y.sendWords || ['send'], Y.sendWords || ['send'], to)) found.push({ action: 'send a message on their behalf', what: `${short}${to.length ? ' to ' + to.slice(0, 2).join(', ') : ''}` });
    }
    const pub = publishWhat(tool, ti, cwd, false);
    if (pub && !saidYes(Y.publishWords || [])) found.push({ action: 'put something online', what: pub });
  }
  return found;
}
// Their own clean-up (a setting, on by default; yes.ownCleanup): a delete needs no yes when
// the file (or a folder above it) was CREATED in this same chat, by a step the gates saw, and git does not know it (it
// was never saved in the notebook). A note (a .md or .txt file, or anything in the notebook's note folders), a file
// git knows, or one older than the chat still needs their own words naming the act and its object. Build tools' own
// folders and the temporary folders are deleteAllowFolders and tempish, as before.
const createdFile = () => path.join(GDIR, 'chat', safe(SID) + '.created');
const NOTE_DIRS = ['projects', 'me', 'inbox', 'knowledge', 'log', 'ledger', 'system', 'archive', 'brief', 'docs'];
function isNote(abs) {
  if (/\.(md|txt)$/i.test(abs)) return true;
  const root = norm(ROOT);
  return NOTE_DIRS.some((d) => under(abs, root + '/' + d));
}
function gitKnows(abs) {
  let dir = abs;
  for (let i = 0; i < 40 && dir && !fs.existsSync(dir); i++) { const up = path.posix.dirname(dir); if (up === dir) break; dir = up; }
  if (!fs.existsSync(dir)) return false;
  const base = (() => { try { return fs.statSync(dir).isDirectory() ? dir : path.posix.dirname(dir); } catch { return dir; } })();
  try {
    const r = spawnSync('git', ['-C', base, 'ls-files', '--', abs], { encoding: 'utf8', timeout: 1500, windowsHide: true });
    return r.status === 0 && String(r.stdout || '').trim() !== '';
  } catch { return true; } // cannot tell: the safe side
}
function ownScratch(abs) {
  if (!SID || String((S.yes.ownCleanup || {}).mode || 'on') === 'off' || isNote(abs)) return false;
  const made = new Set(readLines(createdFile()).map((x) => x.p));
  let p = abs, hit = false;
  for (let i = 0; i < 40; i++) { if (made.has(p)) { hit = true; break; } const up = path.posix.dirname(p); if (up === p) break; p = up; }
  if (!hit) return false;
  // older than the chat: not its own
  let since = 0; try { since = fs.statSync(path.join(GDIR, 'start', safe(SID) + '.json')).mtimeMs; } catch {}
  try { if (since && fs.statSync(abs).birthtimeMs && fs.statSync(abs).birthtimeMs < since - 2000) return false; } catch {}
  return !gitKnows(abs);
}
// What a step is about to create (a file or folder not there yet): written down for ownScratch.
function recordCreated(tool, ti, cwd) {
  let list = [];
  if (tool === 'Write' || tool === 'NotebookEdit') list = [norm(ti.file_path || ti.notebook_path || '', cwd)];
  else if (tool === 'Bash' || tool === 'PowerShell') list = allShellTargets(String(ti.command || ''), cwd).filter((t) => !t.del && !t.gone).map((t) => t.abs);
  for (const abs of list) if (abs && !fs.existsSync(abs)) appendLine(createdFile(), { p: abs, t: Date.now() });
}
// The dependencies package.json lists that its lock file does not name (none when there is no package.json).
function unlockedDeps(dir) {
  let d = dir;
  for (let i = 0; i < 5; i++) {
    const pj = readJson(path.join(d, 'package.json'), null);
    if (pj) {
      const deps = Object.keys({ ...(pj.dependencies || {}), ...(pj.devDependencies || {}), ...(pj.optionalDependencies || {}), ...(pj.peerDependencies || {}) });
      if (!deps.length) return [];
      let lock = '';
      for (const f of ['package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lock']) { const t = readSmall(path.join(d, f)) ?? (() => { try { return fs.readFileSync(path.join(d, f), 'utf8'); } catch { return null; } })(); if (t !== null) { lock = t; break; } }
      return deps.filter((n) => !lock.includes(`"${n}"`) && !lock.includes(`node_modules/${n}"`) && !lock.includes(`${n}@`) && !lock.includes(`'${n}'`) && !lock.includes(`\n  ${n}:`));
    }
    const up = path.dirname(d); if (up === d) break; d = up;
  }
  return [];
}
function yesText(found, refuse) {
  const list = found.map((f) => `${f.action} (${f.what})`).join('; ');
  return refuse
    ? `HIVE GATE (yes): I stopped this step. It would ${list}, and the person's latest message does not ask for that (rules 1 and 2): a yes word in a message about something else is no yes. The one thing to do: ask them in one plain sentence what will happen, wait for their yes to that question, then run it again.`
    : `HIVE NOTICE (yes, a reminder for now; nothing was stopped): this step would ${list}, and their latest message does not ask for that. Rules 1 and 2: ask them first.`;
}
// The yes gate is a safety check too: when it breaks on a step that looks public, paid, an install or a delete,
// it says so (in "notice" mode) or stops that step (in "refuse" mode). Other steps go through.
const YES_LOOKS = /\b(vercel|publish|deploy|push|install|add|rm|rmdir|del|remove-item|erase|clean|buy_domain|create_or_transfer_domain|rmsync|unlink|rmtree|npx|curl|mcp)\b/i;
function yesCheck(tool, ti, cwd) {
  try {
    if (process.env.HIVE_GATES_CRASH_CHECK === 'yes') throw new Error('test crash in yes');
    return { found: yesIssues(tool, ti, cwd) };
  } catch (e) {
    log('error', { where: 'yes', kind: 'safety', error: String(e && e.message || e).slice(0, 200) });
    if (!YES_LOOKS.test(String(ti.command || '') + ' ' + tool)) return { found: [] };
    return { broke: true };
  }
}
// A safety check of its own that broke: it stops the step when the step looks like one it guards (its input names
// the Hive folder, Claude's settings, the gates, the checks or the hold), and lets other work through.
const GUARDED_LOOK = /\.claude|gates-off|publish-hold|settings(\.local)?\.json|core[\\/]+gates|core[\\/]+checks|uninstall|config\.json|disableallhooks/i;
function safetyCheck(name, fn) {
  try {
    if (process.env.HIVE_GATES_CRASH_CHECK === name) throw new Error('test crash in ' + name);
    return fn();
  } catch (e) {
    log('error', { where: name, kind: 'safety', error: String(e && e.message || e).slice(0, 200) });
    if (!GUARDED_LOOK.test(JSON.stringify(INPUT.tool_input || {}))) return '';
    return `HIVE GATE (${name}): I stopped this step to be safe: the check broke while reading it. The one thing to do: ask the person in one plain sentence first; the break is written in the gates log.`;
  }
}

// ---------- helpers: how many at once, the policy on models, skills only the person may start (2026-11-20) ----------
const helperEndsFile = () => path.join(GDIR, 'chat', safe(SID) + '.helper-ends');
function helpersRunning() {
  const now = Date.now(), stale = (Number(S.handout.staleMinutes) || 120) * 60000;
  const starts = readLines(helpersFile()).filter((x) => !x.k && now - (x.t || 0) < stale).length;
  const ends = new Set(readLines(helperEndsFile()).filter((x) => now - (x.t || 0) < stale).map((x) => x.id)).size;
  return Math.max(0, starts - ends);
}
function capIssue() {
  if (M('handout', 'refuse') === 'off') return null;
  const max = Number(S.handout.maxAtOnce);
  if (!(max > 0)) return null;
  const n = helpersRunning();
  if (n < max) return null;
  return { refuse: M('handout', 'refuse') === 'refuse', text: `HIVE GATE (helpers at once): I stopped this helper from starting, because ${n} helpers of this chat are still running and the most at once is ${max} (their order; "handout.maxAtOnce" in the gates' settings). The one thing to do: wait for one to report back, then start it. A helper that has not reported for ${S.handout.staleMinutes || 120} minutes no longer counts.` };
}
function markHelperEnd(id) { if (id) appendLine(helperEndsFile(), { id: String(id), t: Date.now() }); }
function modelPolicyIssue(ti) {
  const allowed = (S.model.allowed || []).map((x) => String(x).toLowerCase()).filter(Boolean);
  if (!allowed.length || M('model', 'refuse') === 'off') return null;
  if ((S.model.exemptAgents || []).includes(ti.subagent_type || '')) return null;
  const m = helperModel(ti);
  if (m === 'not named') return null; // the naming check speaks to that
  if (allowed.some((a) => m.includes(a))) return null;
  return { refuse: M('model', 'refuse') === 'refuse', text: `HIVE GATE (helper model): I stopped this helper from starting, because it would run on ${m}, and their policy for helpers is ${allowed.join(' or ')} ("model.allowed" in the gates' settings). The one thing to do: launch it again on ${allowed[0]}; the policy changes only with their words.` };
}
function manualOnly(name) {
  try { return /^disable-model-invocation:\s*true\s*$/im.test((fs.readFileSync(path.join(SKILLS_DIR, name, 'SKILL.md'), 'utf8').match(/^---\r?\n[\s\S]*?\r?\n---/) || [''])[0]); } catch { return false; }
}
export function ownerOnlyIn(text, list, isManual) {
  const names = new Set((list || []).map((s) => String(s).toLowerCase()));
  const found = new Set();
  const lines = String(text || '').split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (!/\bskills?\b/i.test(lines[i])) continue;
    const win = lines.slice(i, i + 4).join('\n').toLowerCase().replace(/https?:\/\/\S+/g, '');
    for (const t of win.match(/\/?[a-z][a-z0-9:-]*[a-z0-9]/g) || []) {
      const base = t.replace(/^\//, '').split(':').pop();
      if (names.has(base) || (isManual && base.length > 3 && isManual(base))) found.add(base);
    }
  }
  return [...found];
}
function ownerOnlyIssue(ti) {
  const O = S.helpers.ownerOnly || {};
  if (String(O.mode || 'notice') === 'off' || readOnlyHelper(ti)) return null;
  const hit = ownerOnlyIn(ti.prompt, O.skills, (n) => knownSkills().has(n) && manualOnly(n));
  if (!hit.length) return null;
  return { refuse: O.mode === 'refuse', text: `HIVE NOTICE (skills only the person starts): this helper's brief names ${hit.join(', ')}, which only the person can start. Drop ${hit.length === 1 ? 'it' : 'them'} from the skills line, or ask the helper to read the skill's file instead of loading it.` };
}

// ---------- modes ----------
function pretool() {
  const tool = INPUT.tool_name || '';
  const ti = INPUT.tool_input || {};
  const cwd = INPUT.cwd || ROOT;
  const deny = [], notice = [];
  const add = (refuse, text) => (refuse ? deny : notice).push(text);
  // Every check runs on its own (guard): a discipline check that breaks is logged and the others still run.
  // With the notebook missing only the safety checks below run.
  if (SAFETY_ONLY) {
    // nothing here: the design, stage and helper checks need the notebook
  } else if (tool === 'Agent' || tool === 'Task') {
    guard('helpers', () => { const h = helperGate(ti); if (h) deny.push(h); });
    guard('model', () => { if (modelMissing(ti)) { const r = M('model', 'refuse') === 'refuse'; add(r, modelText(r)); } });
    guard('model', () => { const x = modelPolicyIssue(ti); if (x) { add(x.refuse, x.text); log(x.refuse ? 'model-deny' : 'model-notice', { model: helperModel(ti) }); } });
    guard('handout', () => { const x = capIssue(); if (x) { add(x.refuse, x.text); log(x.refuse ? 'cap-deny' : 'cap-notice', { running: helpersRunning() }); } });
    guard('ownerOnly', () => { const x = ownerOnlyIssue(ti); if (x) { add(x.refuse, x.text); log('owner-only', {}); } });

    guard('ticket', () => {
      const tk = ticketIssue(ti);
      if (tk) { const r = M('ticket', 'notice') === 'refuse'; add(r, ticketText(tk, r)); log(r ? 'ticket-deny' : 'ticket-notice', { missing: tk.join(', ').slice(0, 160) }); }
    });
  } else if (['Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(tool)) {
    const abs = norm(ti.file_path || ti.notebook_path || '', cwd);
    const verb = tool === 'Write' ? 'Writing' : 'Editing';
    guard('design', () => { const p = projectFor(abs); if (p && isInterface(p, abs)) { const d = designProblem(p, tool === 'Write' ? 2 : 1, `${verb} ${abs}`); if (d) deny.push(d); } });
    guard('stage', () => { const si = stageIssue(abs); if (si) { const r = M('stage', 'notice') === 'refuse'; add(r, stageText(si, `${verb} ${abs}`, r)); } });
  } else if (tool === 'Artifact') {
    const action = ti.action || 'publish';
    guard('design', () => { if (action === 'publish') { const d = designProblem(projectFor(norm(cwd)), 2, 'Publishing a page with the Artifact tool'); if (d) deny.push(d); } });
  } else if (tool === 'Bash' || tool === 'PowerShell') {
    const writes = guard('design', () => shellWrites(String(ti.command || ''), cwd), []);
    guard('design', () => {
      const hit = writes.find((x) => { const p = projectFor(x.abs); return p && p.status !== 'none' && isInterface(p, x.abs); });
      if (hit) { const d = designProblem(projectFor(hit.abs), 2, `This shell command writes to interface code (${hit.abs})`); if (d) deny.push(d); }
    });
    guard('stage', () => {
      for (const x of writes) {
        const si = stageIssue(x.abs);
        if (si) { const r = M('stage', 'notice') === 'refuse'; add(r, stageText(si, `This shell command writes ${x.abs}`, r)); break; }
      }
    });
  } else if (tool.startsWith('mcp__')) {
    guard('design', () => {
      const short = tool.split('__').pop();
      const server = tool.split('__')[1] || '';
      const figmaWrite = S.design.figmaWriteTools.includes(short) || (/figma/i.test(server) && !/^(get|list|search|whoami|download)/.test(short));
      if (figmaWrite) { const d = designProblem(projectFor(norm(cwd)), 2, `The design tool ${short}`); if (d) deny.push(d); }
    });
  }
  // The safety checks: each stops the step it is about when it breaks on that step.
  const pc = publishCheck(tool, ti, cwd);
  if (pc) { add(pc.refuse, pc.text); log(pc.refuse ? 'publish-deny' : 'publish-notice', { tool, why: pc.text.slice(0, 160) }); }
  const hi = safetyCheck('hold', () => holdIssue(tool, ti, cwd));
  if (hi) { deny.push(hi); log('hold-deny', { tool }); }
  const si = safetyCheck('selfGuard', () => selfIssue(tool, ti, cwd));
  if (si) { add(M('selfGuard', 'refuse') === 'refuse' || si.includes('broke'), si); log('self-deny', { tool, why: si.slice(0, 160) }); }
  const ui = safetyCheck('unknown', () => opaqueIssue(tool, ti, cwd));
  if (ui) { deny.push(ui); log('unknown-deny', { tool, why: ui.slice(0, 160) }); }
  const ym = M('yes', 'refuse');
  const yc = ym === 'off' ? { found: [] } : yesCheck(tool, ti, cwd);
  const yi = yc.found || [];
  if (yc.broke) {
    const r = ym === 'refuse';
    add(r, r ? 'HIVE GATE (yes): I stopped this step to be safe. It looks public, paid, an install or a delete, and the yes check broke while reading it. The one thing to do: ask the person in one plain sentence first; the break is written in the gates log.'
      : 'HIVE NOTICE (yes, a reminder; nothing was stopped): the yes check broke on this step, which looks public, paid, an install or a delete. Ask the person first (rules 1 and 2).');
  }
  if (yi.length) { const r = ym === 'refuse'; add(r, yesText(yi, r)); log(r ? 'yes-deny' : 'yes-notice', { tool, what: yi.map((x) => x.action).join('; ').slice(0, 160) }); }
  // The person's answers on a question card are their word for the act it asked about, so a card may never arrive
  // answered: whoever filled them in is not the person (the hooks page: "Claude doesn't set this field").
  if (tool === 'AskUserQuestion' && ym !== 'off' && ti.answers && typeof ti.answers === 'object' && Object.keys(ti.answers).length) {
    deny.push('HIVE GATE (yes): I stopped this question card, because it already holds its answers. The person\'s answers on a card count as their word for what it asks, so only they give them. The one thing to do: send the card with its questions only.');
    log('yes-deny', { tool, what: 'a question card with its answers filled in' });
  } else if (tool === 'AskUserQuestion' && INPUT.tool_use_id && !(ti.answers && typeof ti.answers === 'object' && Object.keys(ti.answers).length)) guard('yes', () => appendLine(cardsSeenFile(), { id: String(INPUT.tool_use_id), t: Date.now() }));
  return { deny, notice };
}
// The end of the before-a-tool step: the gates' own verdict, as one answer (the check modules' loader merges into it).
function pretoolAnswer(own) {
  const tool = INPUT.tool_name || '';
  const ti = INPUT.tool_input || {};
  const deny = own.deny, notice = own.notice;
  // A helper that starts is written down with its model, for the model line of the reply (rule 12) and the count at once.
  if (!deny.length && (tool === 'Agent' || tool === 'Task')) guard('modelLine', () => appendLine(helpersFile(), { t: Date.now(), d: String(ti.description || '').slice(0, 60), m: helperModel(ti), type: ti.subagent_type || '' }));
  if (!deny.length) guard('yes', () => recordCreated(tool, ti, INPUT.cwd || ROOT));
  if (deny.length) {
    const reason = deny.join('\n\n') + (notice.length ? '\n\n' + notice.join('\n\n') : '');
    log('deny', { tool, why: reason.split('\n')[0].slice(0, 200) });
    out({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } });
  } else if (notice.length) {
    log('notice', { tool, why: notice.map((n) => n.slice(0, 40)).join(' | ').slice(0, 200) });
    out({ hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: notice.join('\n\n').slice(0, 2000) } });
  }
}

// A shell command that runs a test, a build, a check or a lint. A command that only reads (cat test.txt) is not one.
// Not inline code: "node -e \"console.log('test ok')\"" names a test and runs none (N54).
function isCheckCommand(cmd, cwd) {
  return shellSegments(cmd, cwd).some((s) => !READ_CMDS.has(s.name) && !(INTERP.has(s.name) && s.args.some((a) => ['-e', '--eval', '-p', '--print', '-c', '-command'].includes(a.toLowerCase()) && !['pwsh', 'powershell'].includes(s.name))) && hasAny(s.words.join(' '), S.proof.checkWords));
}
// Passed? Claude Code calls PostToolUse after a command that succeeded; an exit code or a "FAILED" line still counts.
function passed(resp) {
  if (!resp || typeof resp !== 'object') return true;
  if (resp.interrupted) return false;
  for (const k of ['exitCode', 'exit_code', 'returnCode', 'code', 'status']) if (typeof resp[k] === 'number' && resp[k] !== 0) return false;
  const text = String(resp.stdout || '') + '\n' + String(resp.stderr || '');
  return !/\bFAILED\b|\b[1-9]\d* (failed|failing)\b|npm ERR!/.test(text.slice(-4000));
}
function recordWrite(abs, agentId) { appendLine(eventsFile(), { k: 'write', p: abs, a: agentId || undefined }); appendLine(writesFile(), { p: abs }); }

function posttool() {
  const tool = INPUT.tool_name || '';
  const ti = INPUT.tool_input || {};
  const agentId = INPUT.agent_id || '';
  const cwd = INPUT.cwd || ROOT;
  if (tool === 'AskUserQuestion') {
    guard('questions', () => recordCardAnswers());
    // The person's answers, kept until their next own message as their word for what each card asked (the yes).
    guard('yes', () => {
      if (loadChat().helper || !cardSeen()) return;
      const items = cardAnswers({ ...(ti || {}), answers: undefined }, INPUT.tool_response).concat(cardAnswers(ti || {}, null)).map((x) => ({ question: x.question, answer: x.words, t: Date.now() }));
      const seen = new Set(); const fresh = items.filter((x) => { const k = x.question; if (seen.has(k)) return false; seen.add(k); return true; });
      if (fresh.length) { const c = readJson(cardsFile(), { items: [] }) || { items: [] }; writeJson(cardsFile(), { items: [...(c.items || []), ...fresh].slice(-20) }); log('card-yes-kept', { count: fresh.length }); }
    });
  } else if (tool === 'Read') {

    const abs = norm(ti.file_path || '', cwd);
    const wanted = new Set();
    for (const p of projects()) if (p.status === 'gated') { wanted.add(p.direction); for (const t of p.taste) wanted.add(t); }
    if (!wanted.has(abs)) return;
    const rec = loadRec(agentId);
    if (!rec.reads.includes(abs)) { rec.reads.push(abs); saveRec(agentId, rec); log('record', { read: abs }); }
  } else if (tool === 'Skill') {
    const name = String(ti.skill || ti.name || '').toLowerCase().trim();
    if (name) appendLine(skillsFile(), { s: name, a: agentId || undefined });
    if (name === S.design.scoutSkill || name.endsWith(':' + S.design.scoutSkill)) {
      const rec = loadRec(agentId); rec.scout = true; saveRec(agentId, rec); log('record', { scout: true });
    }
  } else if (['Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(tool)) {
    const abs = norm(ti.file_path || ti.notebook_path || '', cwd);
    if (abs) recordWrite(abs, agentId);
  } else if (tool === 'Agent' || tool === 'Task') {
    // Only when the after-tool hook also watches the Agent tool: the model the helper really ran on.
    const resp = INPUT.tool_response || {};
    if (resp.resolvedModel) appendLine(helpersFile(), { t: Date.now(), d: String(ti.description || '').slice(0, 60), m: String(resp.resolvedModel).toLowerCase(), k: 'resolved' });
    // A foreground helper's report arrives here ("content"); a background one's says "async_launched" and comes later.
    if (resp.status !== 'async_launched') {
      guard('yes', () => recordReportLines(reportLinesFile(), textOf(resp.content)));
      guard('handout', () => markHelperEnd(resp.agentId || INPUT.tool_use_id || 'fg-' + Date.now()));
      guard('questions', () => ingestReport(textOf(resp.content), ti.description || resp.agentId || 'helper'));
    }
  } else if (tool === 'SubagentHandback') {
    // A helper that ends with this tool hands its report over as tool_input.message (the hooks reference, 2026-11-19).
    guard('handout', () => markHelperEnd(agentId));
    guard('yes', () => recordReportLines(reportLinesFile(), String(ti.message || '')));
    guard('questions', () => { markHandback(agentId); ingestReport(String(ti.message || ''), agentId || 'helper'); });
  } else if (tool === 'Bash' || tool === 'PowerShell') {
    const cmd = String(ti.command || '');
    for (const x of shellWrites(cmd, cwd)) recordWrite(x.abs, agentId);
    // An image fetched with his yes (the step ran): from now on it is known, so it is not asked for again.
    guard('yes', () => {
      if (!/\bdocker\b|\bpodman\b/i.test(cmd) || !passed(INPUT.tool_response)) return;
      const segs = deepSegs(cmd, norm(cwd));
      for (const t of builtTags(segs)) appendLine(path.join(GDIR, 'docker-images.jsonl'), { i: t, t: Date.now(), built: true });
      for (const d of dockerRisks(segs)) if (d.kind === 'pull') { const img = (d.action.match(/the image (\S+),/) || [])[1]; if (img) appendLine(path.join(GDIR, 'docker-images.jsonl'), { i: img, t: Date.now() }); }
    });
    if (isCheckCommand(cmd, cwd)) {
      const ok = passed(INPUT.tool_response);
      appendLine(eventsFile(), { k: 'check', ok, cmd: cmd.slice(0, 120) });
      log('record', { check: ok ? 'passed' : 'failed' });
    }
  }
}

// The failed-command step (PostToolUseFailure, once that hook is installed): Claude Code calls PostToolUse only after a
// tool that succeeded, so a test, build or check that failed is written down here, as failed, for the proof check.
function failedTool() {
  const ti = INPUT.tool_input || {};
  if (INPUT.tool_name !== 'Bash' && INPUT.tool_name !== 'PowerShell') return;
  const cmd = String(ti.command || '');
  if (!isCheckCommand(cmd, INPUT.cwd || ROOT)) return;
  appendLine(eventsFile(), { k: 'check', ok: false, cmd: cmd.slice(0, 120) });
  log('record', { check: 'failed' });
}

// ---------- questions for the person (a SAFETY step, 2026-11-19) ----------
// Questions in helpers' reports must reach the person; none is decided or parked by the lead. The list and its program are
// core/engine/questions.mjs with system/questions.json (built by another helper; the commands are in the settings, so a
// change of name is a one-word change there). The gates (1) pass every helper's final report to the program's ingest,
// (2) at each of their messages put the questions that must be asked at once, word for word, at the top of what Claude is
// told, (3) note a sitrep whose "Needs you:" says nothing while a question is open. A missing program or file is
// logged once per call and nothing else happens: work is never held up by its absence.
function questionsProgram() {
  const p = path.join(ROOT, S.questions.program || 'core/engine/questions.mjs');
  if (!fs.existsSync(p)) { log('questions-missing', { program: S.questions.program }); return ''; }
  return p;
}
function runQuestions(args, input) {
  const prog = questionsProgram();
  if (!prog) return null;
  const r = spawnSync(process.execPath, [prog, ...args], { cwd: ROOT, input: input || '', encoding: 'utf8', timeout: S.questions.timeoutMs || 1500, windowsHide: true, env: { ...process.env, HIVE_ROOT: ROOT } });
  if (r.error || r.status !== 0) { log('error', { where: 'questions', kind: 'safety', args: args.join(' '), status: r.status, error: String((r.error && r.error.message) || r.stderr || '').slice(0, 160) }); return null; }
  return String(r.stdout || '');
}
// The text of a tool_response's content: a string, or blocks of { type: "text", text }.
function textOf(c) {
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map((b) => (typeof b === 'string' ? b : (b && b.text) || '')).join('\n');
  return '';
}
const handbacksFile = () => path.join(GDIR, 'chat', safe(SID) + '.handbacks');
function markHandback(agentId) { if (agentId) appendLine(handbacksFile(), { a: agentId, t: Date.now() }); }
// Each report once: the same text from the Agent result and the handback is passed on one time.
function ingestReport(text, from) {
  if (M('questions', 'on') === 'off') return;
  const t = String(text || '').trim();
  if (!t) return;
  const h = crypto.createHash('sha1').update(t).digest('hex').slice(0, 16);
  const seenFile = path.join(GDIR, 'chat', safe(SID) + '.ingested');
  if (readLines(seenFile).some((x) => x.h === h)) return;
  const outText = runQuestions([...(S.questions.ingest || ['ingest']), '--from', String(from).slice(0, 60)], t.slice(0, 60000));
  if (outText === null) return;
  appendLine(seenFile, { h, t: Date.now() });
  log('questions-ingest', { from: String(from).slice(0, 60), said: outText.trim().slice(0, 120) });
}
// SubagentStop: the helper's last words, when it did not hand its report over with the handback tool.
function subagentstop() {
  const agentId = INPUT.agent_id || '';
  guard('handout', () => markHelperEnd(agentId));
  guard('yes', () => recordReportLines(reportLinesFile(), String(INPUT.last_assistant_message || '')));
  if (agentId && readLines(handbacksFile()).some((x) => x.a === agentId)) return; // its report was taken at the handback
  guard('questions', () => ingestReport(String(INPUT.last_assistant_message || ''), INPUT.agent_type || agentId || 'helper'));
}
// The question card (AskUserQuestion), after it ran: each of their answers goes into the list at once, in their words, so a
// restart can never lose them (lesson of 2026-11-20: answers were lost to a restart and the person was told they had not answered).
// The hooks page gives the card's input (questions: [{ question, header, options }], answers: { question: label })
// but no shape for its result, so the answers are read from tool_input.answers, tool_response.answers, or the result's
// text ("question"="answer"). Each asked question is matched to its id in the list (same words, its id written in the
// question, or most of its long words); an answer that matches no id is added as a new question and answered, and
// logged ("questions-card-new"), never dropped. Then the page is rendered.
export function cardAnswers(ti, resp) {
  const found = new Map();
  const take = (m) => { if (m && typeof m === 'object' && !Array.isArray(m)) for (const [q, a] of Object.entries(m)) { const v = Array.isArray(a) ? a.join(', ') : a && typeof a === 'object' ? (a.answer || a.label || a.text || JSON.stringify(a)) : a; if (String(q).trim() && String(v ?? '').trim()) found.set(String(q).trim(), String(v).trim()); } };
  take(ti && ti.answers);
  if (resp && typeof resp === 'object') { take(resp.answers); if (resp.data) take(resp.data.answers); }
  const text = typeof resp === 'string' ? resp : resp && typeof resp === 'object' ? [textOf(resp.content), typeof resp.result === 'string' ? resp.result : '', typeof resp.output === 'string' ? resp.output : ''].join('\n') : '';
  for (const m of String(text).matchAll(/"([^"\n]{3,600})"\s*=\s*"([^"\n]{1,2000})"/g)) if (!found.has(m[1].trim())) found.set(m[1].trim(), m[2].trim());
  const extra = (resp && typeof resp === 'object' && (resp.annotations || resp.notes)) || null; // their own notes on a choice, when the result carries them
  if (extra && typeof extra === 'object') for (const [q, n] of Object.entries(extra)) { const note = typeof n === 'string' ? n : n && (n.notes || n.note || n.text); if (note && found.has(q)) found.set(q, `${found.get(q)} (their note: ${String(note).trim()})`); }
  return [...found].map(([question, words]) => ({ question, words }));
}
export function matchQuestion(question, listed) {
  const nq = String(question || '').toLowerCase().replace(/[^a-z0-9$]+/g, ' ').trim();
  const idIn = String(question).match(/\bq-\d{3,}\b/i);
  if (idIn) { const hit = listed.find((x) => x.id.toLowerCase() === idIn[0].toLowerCase()); if (hit) return hit.id; }
  const same = listed.find((x) => String(x.text).toLowerCase().replace(/[^a-z0-9$]+/g, ' ').trim() === nq);
  if (same) return same.id;
  const long = (s) => [...new Set(String(s).toLowerCase().replace(/[^a-z0-9$]+/g, ' ').split(' ').filter((w) => w.length >= 5))];
  const qw = long(question); if (qw.length < 2) return '';
  let best = null;
  for (const x of listed) {
    const lw = new Set(long(x.text)); const hit = qw.filter((w) => lw.has(w)).length;
    const score = hit / Math.max(qw.length, lw.size);
    if (score >= 0.6 && (!best || score > best.score || (score === best.score && x.state === 'open' && best.state !== 'open'))) best = { id: x.id, score, state: x.state };
  }
  return best ? best.id : '';
}
// The program reads a value that starts with -- as the next flag: a leading space keeps his words whole.
const flagSafe = (s) => (String(s).startsWith('--') ? ' ' + s : String(s));
function recordCardAnswers() {
  if (M('questions', 'on') === 'off') return;
  const items = cardAnswers(INPUT.tool_input || {}, INPUT.tool_response);
  if (!items.length) { log('questions-card', { said: 'no answer found in the card or its result' }); return; }
  const where = 'question card' + (loadChat().helper ? ' (in a helper chat)' : '') + (INPUT.tool_use_id ? ' ' + String(INPUT.tool_use_id).slice(0, 40) : '');
  const listed = String(runQuestions(['list']) || '').split(/\r?\n/).map((l) => l.split(' | ')).filter((p) => p.length >= 4 && /^q-\d+$/.test(p[0].trim()))
    .map((p) => ({ id: p[0].trim(), kind: p[1].trim(), state: p[2].trim(), text: p.slice(3).join(' | ').trim() }));
  for (const it of items) {
    let id = matchQuestion(it.question, listed);
    if (!id) {
      const added = runQuestions(['add', '--by', 'the person (question card)', '--text', flagSafe(it.question.slice(0, 600)), '--source', where]) || '';
      const m = added.match(/\bq-\d+\b/);
      if (!m) { log('error', { where: 'questions-card', kind: 'safety', error: 'the question could not be added', question: it.question.slice(0, 120), words: it.words.slice(0, 200) }); continue; }
      id = m[0]; listed.push({ id, kind: 'new', state: 'open', text: it.question });
      log('questions-card-new', { id, question: it.question.slice(0, 120) });
    }
    const r = runQuestions(['answer', id, '--words', flagSafe(it.words.slice(0, 2000)), '--where', where]);
    if (r === null) log('error', { where: 'questions-card', kind: 'safety', id, error: 'the answer could not be written', words: it.words.slice(0, 200) });
    else log('questions-card', { id, words: it.words.slice(0, 120) });
  }
  runQuestions(['render']);
}
// At their message: the line of questions to ask now (word for word, from the program), and how many are open.
function questionsNow() {
  if (M('questions', 'on') === 'off') return { line: '', open: [] };
  let line = (runQuestions(S.questions.lineArgs || ['line']) || '').trim();
  if (/^needs you:\s*nothing\.?$/i.test(line)) line = ''; // the program's line when nothing is open is not a question to ask
  const raw = runQuestions(S.questions.listArgs || ['list', '--open', '--json']);
  const items = openQuestionItems(raw);
  const now = items.filter((q) => q.kind !== 'B').map((q) => q.text), later = items.filter((q) => q.kind === 'B').map((q) => q.text);
  return { line, open: items.map((q) => q.text), now, later };
}
// The open questions from the list's output, as the questions program counts them (its "line"): only those whose
// state is open. The program prints "<id> | <kind> | <state> | <text>"; a dropped (E), decided (C), answered (D) or
// merged question is not open (seen live 2026-11-20: dropped questions were named as hidden by every sitrep). Kind B
// waits only for publishing. Also read: a JSON array, or an object holding one (questions / items / open), each entry a
// string or { text | question, status | state, kind }; else one question per non-empty line.
export function openQuestionItems(raw) {
  if (raw === null || raw === undefined) return [];
  const s = String(raw).trim();
  if (!s) return [];
  const isOpen = (st) => !st || /^(open|asked|waiting)$/i.test(String(st));
  try {
    const j = JSON.parse(s);
    const arr = Array.isArray(j) ? j : (j.questions || j.items || j.open || []);
    return arr.filter((q) => typeof q === 'string' || isOpen(q.state || q.status))
      .map((q) => (typeof q === 'string' ? { text: q, kind: 'new' } : { text: String(q.text || q.question || ''), kind: String(q.kind || 'new') })).filter((q) => q.text);
  } catch {}
  const out = [];
  for (const l of s.split(/\r?\n/).map((x) => x.trim()).filter(Boolean)) {
    const m = l.match(/^(q-\d+)\s*\|\s*([\w-]+)\s*\|\s*([\w-]+)\s*\|\s*(.+)$/i);
    if (m) { if (isOpen(m[3])) out.push({ text: m[4].trim(), kind: m[2] }); }
    else out.push({ text: l, kind: 'new' });
  }
  return out;
}
export function openQuestions(raw) { return openQuestionItems(raw).map((q) => q.text); }
// A reply that says something of the kinds only they decide was already decided (reversing what they said, changing what
// strangers read, spending, deleting, guessing what they meant). Narrow on purpose: one sentence holds a "decided" phrase
// and a word of one of the kinds.
const COUNT_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
export function namesLater(line, later) {
  const l = String(line).toLowerCase();
  const n = later.length;
  if (!(new RegExp('\\b' + n + '\\b').test(l) || (COUNT_WORDS[n] && new RegExp('\\b' + COUNT_WORDS[n] + '\\b').test(l)))) return false;
  const long = (s) => [...new Set(String(s).toLowerCase().replace(/[^a-z0-9$]+/g, ' ').split(' ').filter((w) => w.length >= 5))];
  const fw = long(later[0]); if (!fw.length) return true;
  const lw = new Set(long(l));
  return fw.filter((w) => lw.has(w)).length / fw.length >= 0.6;
}
export function decidedForThem(text, D) {
  for (const s of sentences(text)) {
    if (!hasAny(s, D.decidedWords)) continue;
    const kind = (D.kinds || []).find((k) => hasAny(s, k.words));
    if (kind) return `it tells them something only they decide was already decided (${kind.name}: "${s.slice(0, 110)}"); ask them instead, with the content inside the question, and leave it undone until they answer`;
  }
  return '';
}

// ---------- the match between the work and what exists (rule 14) ----------
// From a few words about a piece of work: its kinds (design, build, motion, ...), then from the registry the skills,
// connectors and protocols that fit. "always" (in the settings, kept short) are the skills a turn of that kind must load.
//   node core/gates/gates.mjs fit <a few words about the work>
export function workKinds(text, F) {
  return Object.entries((F && F.kinds) || {}).filter(([, words]) => hasAny(text, words)).map(([k]) => k);
}
const STATE_SAY = { active: 'in use', 'installed-unused': 'installed, not used yet', 'listed-not-installed': 'named, not installed' };
export function fitFor(text, reg, F) {
  const kinds = workKinds(text, F);
  const entries = ((reg && reg.entries) || []).filter((e) => e.state !== 'removed');
  const byId = new Map(entries.map((e) => [e.id, e]));
  const always = [];
  for (const k of kinds) for (const s of ((F.always || {})[k] || [])) if (!always.includes(s)) always.push(s);
  const cats = kinds.map((k) => ((F.categories || {})[k] || k));
  const rank = { active: 0, 'installed-unused': 1, 'listed-not-installed': 2 };
  // Order: how many of the person's words the skill's name and description share, then in use before not used, then name.
  const stop = new Set(['the', 'and', 'for', 'with', 'this', 'that', 'into', 'from', 'our', 'his', 'new', 'all', 'make']);
  const stems = String(text).toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !stop.has(w)).map((w) => w.slice(0, 5));
  const score = (e) => { const hay = `${e.id} ${e.about || ''} ${e.group || ''}`.toLowerCase(); return stems.filter((s) => hay.includes(s)).length; };
  const skills = entries.filter((e) => e.kind === 'skill' && !always.includes(e.id) && (e.fits || []).some((f) => cats.includes(f)))
    .map((e) => [score(e), e])
    .sort((a, b) => b[0] - a[0] || (rank[a[1].state] ?? 3) - (rank[b[1].state] ?? 3) || a[1].id.localeCompare(b[1].id))
    .map(([, e]) => e).slice(0, F.maxSkills || 8);
  const connectors = [];
  for (const k of kinds) for (const id of ((F.connectors || {})[k] || [])) { const e = byId.get(id); if (e && e.kind === 'connector' && !connectors.includes(e)) connectors.push(e); }
  const pids = [];
  for (const k of [...kinds, ...(kinds.length ? ['all'] : [])]) for (const id of ((F.protocols || {})[k] || [])) if (!pids.includes(id)) pids.push(id);
  const protocols = pids.map((id) => byId.get(id)).filter(Boolean);
  return { kinds, always, skills, connectors: connectors.slice(0, F.maxConnectors || 5), protocols };
}
function loadRegistry() { return readJson(path.join(ROOT, S.fit.registry || 'system/registry.json'), { entries: [] }); }
function fitCli(words) {
  const text = words.join(' ');
  const r = fitFor(text, loadRegistry(), S.fit);
  if (!r.kinds.length) { out(`Nothing in "${text}" looks like a kind of work the settings know (${Object.keys(S.fit.kinds || {}).join(', ')}). Add a word to a kind, or name the kind.\n`); return; }
  const say = (e) => `${e.id} (${STATE_SAY[e.state] || e.state})`;
  const lines = [
    `Work: ${r.kinds.join(', ')} (from "${text}").`,
    `Always load: ${r.always.length ? r.always.join(', ') : 'nothing is set as always for this kind'}.`,
    `Skills that also fit: ${r.skills.length ? r.skills.map(say).join(', ') : 'none listed'}.`,
    `Connectors that fit: ${r.connectors.length ? r.connectors.map(say).join(', ') : 'none listed'}.`,
    `Protocols that apply: ${r.protocols.length ? r.protocols.map((e) => `${e.id.replace('-', ' ')} (${String(e.text || '').replace(/\.$/, '')})`).join('; ') : 'none listed'}.`,
  ];
  out(lines.join('\n') + '\n');
}


// The front door (the intake gate). What the person sent in a message: links, and files they attached. Each one must end
// up in the list of what they send (inbox/sources.md), so nothing they send lives only in a chat.
export function sentItems(text, I) {
  const items = [];
  const add = (key, show) => { if (key && !items.some((x) => x.key === key)) items.push({ key, show }); };
  for (const m of String(text).matchAll(/https?:\/\/[^\s<>"'`)\]]+/gi)) {
    const url = m[0].replace(/[.,;:!?]+$/, '');
    let host = '';
    try { host = new URL(url).hostname.toLowerCase(); } catch { continue; }
    if ((I.ignoreHosts || []).includes(host)) continue;
    // The key is the part that must appear in the list: the address without its scheme, "www." or a trailing slash.
    add(url.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/+$/, '').toLowerCase(), url);
  }
  // A file they attached: the app saves it under an "uploads" folder and names the path in the message.
  for (const m of String(text).matchAll(/[\\/]uploads[\\/][^\s"'<>|]*?([^\\/\s"'<>|]+\.(pdf|docx?|pptx?|xlsx?|csv|txt|md|epub|zip|mp4|mov|mp3|wav|m4a))\b/gi)) {
    const name = m[1].replace(/^[0-9a-f]{8}-/i, ''); // the app puts a short code in front of the name
    add(name.toLowerCase().replace(/\.[a-z0-9]+$/, '').slice(0, 40), name);
  }
  return items.slice(0, I.maxItems || 12);
}
function listText() { try { return fs.readFileSync(path.join(ROOT, S.intake.list), 'utf8').toLowerCase(); } catch { return ''; } }
export function notLogged(items, list) { return (items || []).filter((x) => !list.includes(x.key)); }

// ---------- the mid-chat refresh ----------
// At most once every two minutes per notebook: a quick git fetch (4 s limit, silent on failure); when GitHub is ahead
// and the tracked files are clean, a fast-forward (git merge --ff-only, the local half of pull --ff-only, so the
// network is used once). Then, at every message: the notes that changed since this chat last looked, read from
// the local history, without this chat's own files. Nothing is touched in the cloud (HIVE_CLOUD=1) or without git.
function git(args, ms, quiet) {
  try {
    // quiet: no pipes, so a stuck helper process (ssh, a credential prompt) cannot hold the hook past the time limit.
    const r = spawnSync('git', ['-C', ROOT, ...args], { encoding: 'utf8', timeout: Math.max(200, ms), windowsHide: true, stdio: quiet ? 'ignore' : 'pipe',
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', GIT_ASKPASS: '' } });
    if (r.error || r.status !== 0) return null;
    return String(r.stdout || '').trim();
  } catch { return null; }
}
function headNow() { // read without starting git when the layout is the usual one
  try {
    const gd = path.join(ROOT, '.git');
    const h = fs.readFileSync(path.join(gd, 'HEAD'), 'utf8').trim();
    if (!h.startsWith('ref: ')) return h;
    const ref = h.slice(5);
    try { return fs.readFileSync(path.join(gd, ref), 'utf8').trim(); } catch {}
    const packed = fs.readFileSync(path.join(gd, 'packed-refs'), 'utf8').split('\n').find((l) => l.endsWith(' ' + ref));
    if (packed) return packed.split(' ')[0];
  } catch {}
  return git(['rev-parse', 'HEAD'], 1500);
}
function refresh(chat) {
  const lines = [];
  if (M('refresh', 'on') === 'off' || process.env.HIVE_CLOUD === '1') return lines;
  if (!fs.existsSync(path.join(ROOT, '.git'))) return lines;
  const R = S.refresh;
  const deadline = T0 + (R.budgetMs || 8000);
  const left = () => deadline - Date.now();
  const stampFile = path.join(GDIR, 'refresh', safe(norm(ROOT)) + '.json');
  const last = readJson(stampFile, { at: 0 }).at || 0;
  if (Date.now() - last >= (R.everySeconds ?? 120) * 1000) {
    writeJson(stampFile, { at: Date.now() }); // first, so two chats do not fetch at once
    const fetched = git(['fetch', '--quiet'], Math.min(R.fetchTimeoutMs || 4000, left()), true);
    if (fetched === null) log('refresh', { fetch: 'failed or no network' });
    else {
      const behind = Number(git(['rev-list', '--count', 'HEAD..@{u}'], Math.min(1500, left())) || 0);
      if (behind > 0) {
        const dirty = git(['status', '--porcelain', '--untracked-files=no'], Math.min(1500, left()));
        const merged = dirty === '' ? git(['merge', '--ff-only', '--quiet', '@{u}'], Math.min(2500, left())) : null;
        if (merged === null) {
          lines.push(`The notes on GitHub are newer than this computer's copy (${behind} saved change${behind === 1 ? '' : 's'}) and were not pulled, because ${dirty ? 'files here have unsaved changes' : 'the two copies went different ways'}. Before relying on a note, say so to the person; do not overwrite.`);
          log('refresh', { behind, pulled: false });
        } else log('refresh', { behind, pulled: true });
      }
    }
  }
  const head = headNow();
  if (head && !chat.head) chat.head = head;
  else if (head && head !== chat.head && left() > 300) {
    const names = git(['diff', '--name-only', chat.head, head], Math.min(1500, left()));
    if (names !== null) {
      const mine = new Set(readLines(writesFile()).map((x) => x.p));
      const root = norm(ROOT);
      const changed = names.split('\n').map((s) => s.trim()).filter(Boolean).filter((n) => !mine.has(norm(path.join(root, n))));
      const max = S.refresh.maxNames || 5;
      if (changed.length) {
        lines.push(`Another chat changed: ${changed.slice(0, max).join(', ')}${changed.length > max ? ` and ${changed.length - max} more` : ''}. Read the ones that matter to this work again before relying on them.`);
        log('refresh', { changed: changed.length });
      }
    }
    chat.head = head;
  }
  return lines;
}

// At the person's message: their own words, the record of what their yes may answer, and their card answers started
// afresh. Returns the text that is theirs ('' when the prompt was a helper's report, a notice or another chat's
// message: then the record of their latest own message is left as it was).
function ownTurn(chat, helper) {
  const w = hisOwnWords(INPUT.prompt, knownReportLines(), !!helper);
  if (!w.his) { if (!helper) log('not-his-words', { why: w.why.slice(0, 160) }); return { own: '', his: false }; }
  try { fs.rmSync(cardsFile(), { force: true }); } catch {}
  return { own: w.own, his: true };
}
function prompt() {
  // Only the person's own words are read as theirs: a report, a notice or another chat's message is not their wish,
  // their link, their correction or their yes. On its own error the reading fails closed (no yes is kept).
  const mine = guard('yes', () => ownTurn(loadChat(), null), { own: '', his: false, broke: true });
  const text = mine.own;
  const before = readJson(turnFile(), {}) || {};
  const keep = mine.his ? { ask: text.toLowerCase().slice(0, 1500), his: text.slice(0, 4000), reply: lastReply() }
    : mine.broke ? { ask: '', his: '', reply: '' }
      : { ask: String(before.ask || ''), his: String(before.his || ''), reply: typeof before.reply === 'string' ? before.reply : '' };
  const sent = S.intake.enabled ? sentItems(text, S.intake) : [];
  const pref = M('preference', 'notice') !== 'off' && hasAny(text, S.preference.words);
  const kinds = guard('fit', () => workKinds(text, S.fit), []);
  // The person asked for a sitrep (the saved word, or "status?", "where are we"): the reply is held to the sitrep's shape.
  const sitrep = M('sitrep', 'on') !== 'off' && guard('sitrep', () => hasAny(text, S.sitrep.askWords), false);
  // Questions for the person (a safety step): asked at every message of theirs, whatever they said ("don't disturb me"
  // included); only their answer, written to the list, takes one off.
  const qs = guard('questions', () => questionsNow(), { line: '', open: [] });
  writeJson(turnFile(), { long: hasAny(text, S.reply.longAskWords), tech: hasAny(text, S.reply.techAskWords), sent, pref, kinds, sitrep, questions: qs.open.slice(0, S.questions.maxOpen || 8).map((q) => String(q).slice(0, 200)), qnow: (qs.now || []).slice(0, S.questions.maxOpen || 8).map((q) => String(q).slice(0, 200)), qlater: (qs.later || []).slice(0, S.questions.maxOpen || 8).map((q) => String(q).slice(0, 200)), ...keep, own: mine.his, at: Date.now() });
  try { fs.rmSync(eventsFile(), { force: true }); } catch {}
  if (/^\s*\/hive-scout\b/i.test(text)) { const rec = loadRec(''); rec.scout = true; saveRec('', rec); log('record', { scout: true, via: 'prompt' }); }
  let line = '';
  const extra = [];
  // What the reply check found in the last reply (notice mode): handed over once, then removed.
  guard('reply', () => {
    const c = readJson(carryFile(), null);
    if (!c) return;
    fs.rmSync(carryFile(), { force: true });
    const note = carryNote(c);
    if (note) { extra.push(note); log('reply-note', { items: (c.items || []).length }); }
  });
  const fresh = notLogged(sent, listText());
  if (fresh.length) {
    log('intake-seen', { count: fresh.length });
    extra.push(`The person sent ${fresh.length === 1 ? 'something' : fresh.length + ' things'} in this message (${fresh.slice(0, 3).map((x) => x.show).join(', ').slice(0, 200)}${fresh.length > 3 ? ', ...' : ''}). ` +
      `If it is material to keep or learn from, log each in the list of what they send (${S.intake.list}) before anything else and use the ${S.intake.skill} skill. If it is only part of a question, log it with "set aside: only a question". Nothing they send may live only in this chat.`);
  }
  // The correction detector: the person is saying something again (rule 7).
  if (M('correction', 'on') !== 'off' && hasAny(text, S.correction.words)) {
    const p = projectFor(norm(INPUT.cwd || ROOT));
    appendLine(path.join(STATE, S.correction.log || 'corrections.log'), { t: new Date().toISOString(), sid: SID, project: p ? p.name : '', text: text.slice(0, 200) });
    log('correction', { project: p ? p.name : '' });
    extra.push('The person is correcting something they have said before. Before anything else: fix it, and make it a check or an automatic step so they never have to say it again (rule 7). Save the lesson with closed_by.');
  }
  // The match, made by the program at the start of the work: for a kind that has "always" skills not yet loaded in
  // this chat, one line names them and the others that fit (rule 14).
  guard('fit', () => {
    if (M('fit', 'on') === 'off') return;
    const announce = kinds.filter((k) => (S.fit.announce || []).includes(k));
    if (!announce.length) return;
    const r = fitFor(text, loadRegistry(), S.fit);
    const loaded = loadedSkills();
    const need = r.always.filter((s) => !isLoaded(s, loaded));
    if (!need.length) return;
    const others = r.skills.filter((e) => e.state === 'active').slice(0, 4).map((e) => e.id);
    extra.push(`This message looks like ${announce.join(' and ')} work. Load at least ${need.join(', ')} with the Skill tool before the first change (rule 14)` +
      `${others.length ? `; also fitting: ${others.join(', ')}` : ''}. The full match: node ~/hive-mind/core/gates/gates.mjs fit <a few words>.`);
    log('fit-said', { kinds: announce.join(','), need: need.join(',') });
  });
  const chat = loadChat();
  chat.prompts = (chat.prompts || 0) + 1;
  // The reminder line: at the first message of a chat, at the first one after the chat was shortened, and then every
  // reminderEvery messages (1 or less: every message). Between them the rules are in the start message, and a fault
  // of a reply is still handed over at the next message. It costs words in every message, so it is said once.
  const every = Number(S.reminderEvery ?? 1);
  if (chat.prompts === 1 || chat.remindAgain || !(every > 1) || (chat.prompts - 1) % every === 0) {
    line = String(S.reminder || '').slice(0, 299);
    chat.remindAgain = false;
  }
  try { extra.push(...refresh(chat)); } catch (e) { log('error', { where: 'refresh', error: String(e && e.message || e).slice(0, 200) }); }
  // The long chat: once, after a compaction or after many messages.
  if (M('longChat', 'on') !== 'off' && !chat.longGiven && (chat.compacted || chat.prompts > (S.longChat.maxMessages || 60))) {
    chat.longGiven = true;
    log('long-chat', { prompts: chat.prompts, compacted: !!chat.compacted });
    extra.push(`This chat is long${chat.compacted ? ' and was already shortened once' : ` (${chat.prompts} messages from the person)`}. At a natural pause, offer the person a fresh chat in one plain sentence; before that, write into the in-flight note what lives only in this conversation (promises, open questions, what the person approved).`);
  }
  saveChat(chat);
  if (pref) log('preference-seen', {});
  if (extra.length) line += (line ? ' ' : '') + extra.join(' ');
  // The questions go first, word for word, above everything else Claude is told.
  if (qs.line) { line = `HIVE QUESTIONS FOR THEM (a safety step): ${S.questions.say} ${qs.line.slice(0, 4000)}` + (line ? '\n' + line : ''); log('questions-said', { open: qs.open.length }); }
  if (line) out({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: line } });
}

// The reply check. Measurable parts of rules 6, 11, 13 and 14.
const MAP_MARK = /[✓✔●○◉►▶→▸]/g;
function isMapLine(l) { return (l.match(/\[[^\]\n]{1,80}\]/g) || []).length >= 3 || (l.match(MAP_MARK) || []).length >= 3 || isBarLine(l); }
// The progress display (core/engine/progress.mjs): a bar of block segments and its counted percentage. It is the
// progress map of rule 11. withoutDisplay takes it out of a reply before the words are read: a fenced block that holds
// a bar goes whole; an unfenced bar goes with the name line above it (a short line with no full stop).
const BAR_RE = /[█░]{10,}\s+\d{1,3}%/;
function isBarLine(l) { return BAR_RE.test(l); }
export function withoutDisplay(text) {
  const t = String(text).replace(/\r/g, '').replace(/```[^\n]*\n([\s\S]*?)```/g, (m, body) => (body.split('\n').some(isBarLine) ? '' : m));
  const out = [];
  for (const l of t.split('\n')) {
    if (!isBarLine(l)) { out.push(l); continue; }
    const prev = out[out.length - 1];
    if (prev !== undefined && prev.trim() && prev.length <= 80 && !isBarLine(prev) && !/[.!?]\s*$/.test(prev)) out.pop();
  }
  return out.join('\n');
}
// ---------- what of a reply is judged (2026-11-20: the reply checks contradicted each other and the display they demand) ----------
// Never judged as a claim, a number or an inside word: the progress display itself (above), the names of the things
// he asked for (his own words, from the progress list: "Ready for a new person" is a name, not a claim of "ready"),
// and a quoted phrase he is asked to type ("say 'reinstall the gates'"). The same reading as
// core/checks/_lib/reply-parts.mjs (its test runs every reply check together on today's real sitreps).
export function requestNames(root = ROOT) {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(root, 'system', 'progress.json'), 'utf8'));
    return [j.work, ...(Array.isArray(j.items) ? j.items.map((i) => i && i.name) : [])].map((x) => String(x || '').trim()).filter((x) => x.length >= 3);
  } catch { return []; }
}
const TYPE_VERBS = /\b(say|says|said|type|types|typed|write|writes|answer|answers|reply|replies|tap|taps|tell me|send|sends|choose|pick)\b/i;
export function withoutNames(text, names) {
  let t = String(text);
  for (const n of [...(names || [])].sort((a, b) => b.length - a.length)) t = t.replace(new RegExp('(^|[^\\p{L}\\p{N}])' + escLow(n) + '(?=$|[^\\p{L}\\p{N}])', 'giu'), '$1it');
  return t;
}
export function withoutTyped(text) {
  return String(text).split(/(?<=[.!?])\s+|\n/).map((s) => (TYPE_VERBS.test(s) ? s.replace(/"[^"\n]{1,80}"|“[^”\n]{1,80}”|(?<=^|[\s(])'[^'\n]{1,80}'(?=$|[\s.,;:!?)])|‘[^’\n]{1,80}’/g, 'it') : s)).join('\n');
}
export function judgedText(text, names) { return withoutTyped(withoutNames(withoutDisplay(text), names)); }
// A sitrep without its headline and its "<thing>: <state>" lines (they read the states from the progress list).
export function sitrepClaimsText(text, T = {}) {
  const ls = String(text || '').split('\n');
  const head = (l) => l.replace(/^[-*•>\s]+/, '').replace(/\*\*/g, '');
  const needs = (l) => new RegExp('^(' + ((T && T.needsWords) || ['needs you']).map(escLow).join('|') + ')\\s*:', 'i').test(head(l));
  const st = (l) => !needs(l) && new RegExp('^[^:\\n]{2,90}:\\s*(' + ((T && T.stateWords) || ['done', 'in work', 'not started']).map(escLow).join('|') + ')\\b', 'i').test(head(l));
  const ni = ls.findIndex(needs), first = ls.findIndex(st);
  if (ni < 0 || first < 0 || first > ni) return String(text || '');
  let h = first - 1; while (h >= 0 && !ls[h].trim()) h--;
  return ls.filter((l, i) => !(i < ni && (st(l) || i === h))).join('\n');
}
function isUsedLine(l) { return /^\s*[*_>\-]*\s*(used|skills used|what was used)\s*[*_]*\s*:/i.test(l); }
const SAVED_LINE_ONE = /^\s*[*_>-]*\s*saved\s*[*_]*\s*:/i;
// Quiet (Q given): the progress map and the Used: line are asked for only when the reply reports finished work or
// asks the person for a decision; the word limit and the file names stay as they are.
function reportsFinished(prose, Q) { return hasAny(prose, Q.finishedWords); }
function asksDecision(prose, Q) {
  return prose.split(/(?<=[.!?])\s+|\n/).some((s) => /\?\s*$/.test(s) && hasAny(s, Q.decisionWords));
}
// SR given: the reply is a sitrep (they asked for one, or it has the sitrep's shape). Its lines are the progress map
// (rule 11), it needs no Used: line, and the sitrep check holds its length and words instead (never sent back).
export function checkReply(text, turn, R, Q, SR) {
  const lines = text.replace(/\r/g, '').split('\n');
  const hasMap = lines.some(isMapLine);
  const hasUsed = lines.some(isUsedLine);
  const prose = withoutDisplay(text).split('\n').filter((l) => !isMapLine(l) && !isUsedLine(l)).join('\n');
  const noUrls = prose.replace(/https?:\/\/\S+/g, ' ');
  const words = (noUrls.match(/[\p{L}\p{N}][^\s]*/gu) || []).length;
  const problems = [];
  if (SR) return { words, problems };
  if (!turn.long && words > R.maxWords) problems.push(`it is ${words} words; the limit is ${R.maxWords} unless the person asked for a long document. Keep what is done, what the person must do and the one question; put the rest in the notebook`);
  if (R.checkFileNames && !turn.tech) {
    const found = [];
    if (/```/.test(prose)) found.push('a code block');
    const code = noUrls.match(/`[^`\n]+`/g); if (code) found.push(code.slice(0, 2).join(' '));
    const files = noUrls.match(/\b[\w.-]+\.(md|ps1|mjs|cjs|js|ts|tsx|jsx|json|css|scss|html|sh|py|yml|yaml|log|txt)\b/gi); if (files) found.push(files.slice(0, 2).join(' '));
    const paths = noUrls.match(/(?:^|\s)(?:~\/|\.{1,2}\/)[\w./-]+|[A-Za-z]:\\[\w\\.-]+|(?:^|\s)[\w.-]+\/[\w.-]+\/[\w./-]*/g);
    const realPaths = (paths || []).filter((x) => /[A-Za-z]/.test(x)); // 16/11/2026 is a date, not a path
    if (realPaths.length) found.push(realPaths[0].trim());
    if (found.length) problems.push(`it has file names or code in the prose (${found.join('; ')}); say what they are in plain words, unless the person asked for them`);
  }
  const loose = words >= R.minReportWords && (/\b(done|finished|built|fixed|shipped|ready|completed?|next step|next|step \d|approved?|decide|decision|which one)\b/i.test(prose) || /\?\s*$/m.test(prose));
  const finished = Q ? reportsFinished(prose, Q) : false;
  const reportish = Q ? words >= R.minReportWords && (finished || asksDecision(prose, Q)) : loose;
  const form = [];
  if (R.checkProgressMap && reportish && !hasMap) form.push('it reports progress or asks for a decision but has no progress map (a sitrep, as the hive-sitrep skill shapes it, or one line of steps in a row with a marker, for example [ A ✓ ] [ B ✓ ] ► [ C ])');
  const designish = /\b(built|designed|redesign(ed)?|wireframes?|prototype|page|screen|component|hero|layout|landing|figma|animation|site|mock-?up)\b/i.test(prose);
  if (R.checkUsedLine && reportish && (Q ? finished : true) && designish && !hasUsed) form.push('it reports design or build work but has no "Used:" line (skills, connectors, ready parts and precedents used; what was skipped and why)');
  problems.push(...form);
  return { words, problems };
}

// ---------- the sitrep (the saved word, 2026-11-19) ----------
// A sitrep: a headline, one line per thing they asked for ("the thing: its state. what that means or comes next"),
// then "Needs you: ..." (what and why, or "nothing"), then at most one sentence. A reply has its shape when it has a
// "Needs you:" line and at least one state line. Returns null (not a sitrep), or { asked, shaped, fault } where fault
// is one plain note ('' when the sitrep is right). Saved: and Used: lines are not part of it.
const wordCount = (s) => (String(s).replace(/https?:\/\/\S+/g, ' ').match(/[\p{L}\p{N}][^\s]*/gu) || []).length;
const escRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function sitrepOf(text, turn, T, skills, names = []) {
  const all = withoutDisplay(text).split('\n').map((l) => l.trim()).filter(Boolean);
  const lines = all.filter((l) => !isUsedLine(l) && !SAVED_LINE_ONE.test(l));
  const head = (l) => l.replace(/^[-*•>\s]+/, '').replace(/\*\*/g, '');
  const isNeeds = (l) => new RegExp('^(' + (T.needsWords || []).map(escRe).join('|') + ')\\s*:', 'i').test(head(l));
  const isState = (l) => !isNeeds(l) && new RegExp('^[^:\\n]{2,80}:\\s*(' + (T.stateWords || []).map(escRe).join('|') + ')\\b', 'i').test(head(l));
  const ni = lines.findIndex(isNeeds);
  const shaped = ni >= 0 && lines.some(isState);
  const asked = !!(turn && turn.sitrep);
  if (!asked && !shaped) return null;
  const faults = [];
  const open = (turn && (turn.qnow || turn.questions)) || []; // to ask now (kind A or not sorted yet)
  const later = (turn && turn.qnow && turn.qlater) || []; // waiting only for publishing (kind B)
  if (!shaped) faults.push('they asked for a sitrep, and this reply is not one');
  // A sitrep is in bullet points (easier to read): one bullet per thing they asked for, and a bullet for "Needs you:".
  const BULLET = /^\s*[-*•]\s+/;
  if (shaped) {
    const notBullet = lines.slice(0, ni + 1).filter((l) => (isState(l) || isNeeds(l)) && !BULLET.test(l));
    if (notBullet.length) faults.push(`its ${notBullet.length === 1 ? 'line' : notBullet.length + ' lines'} for ${notBullet.length === 1 ? 'a thing' : 'the things'} they asked for ${notBullet.length === 1 ? 'is' : 'are'} not bullet points: "- <thing>: <state>. <what comes next>", and "- Needs you: ..."`);
  }
  // Open questions for them belong under "Needs you:" (the questions list, a safety step); "nothing" is then untrue.
  if (shaped && open.length && /:\s*(nothing|none|no\b)/i.test(lines[ni])) faults.push(`it says nothing needs them while ${open.length === 1 ? 'a question for them is' : open.length + ' questions for them are'} open (${open.slice(0, 3).map((q) => `"${String(q).slice(0, 80)}"`).join(', ')}): put ${open.length === 1 ? 'it' : 'them'} under "Needs you:", word for word`);
  // "Nothing now" is true while questions wait only for publishing, when the line names how many and the first one.
  else if (shaped && later.length && /:\s*(nothing|none|no\b)/i.test(lines[ni]) && !namesLater(lines[ni], later)) faults.push(`it says nothing needs them while ${later.length === 1 ? 'a question waits' : later.length + ' questions wait'} for them before publishing (the first: "${String(later[0]).slice(0, 80)}"): say "nothing now", with how many wait before publishing and the first one`);
  // Length: the sitrep lines and the one sentence after them count; more sentences are allowed only for a question
  // that needs their yes or a fault they must know, and then up to extraWords.
  const tail = shaped ? sentences(lines.slice(ni + 1).join(' ')) : [];
  const rest = tail.slice(1).join(' ');
  const restNeeded = !!rest && (/\?/.test(rest) || hasAny(rest, T.faultWords));
  // The limit counts what is left after the display, the one line per thing they asked for, and their open questions
  // put word for word under "Needs you:". Each line for a thing has its own limit instead (lineMaxWords).
  const states = shaped ? lines.slice(0, ni).filter(isState) : [];
  const counted = shaped ? lines.slice(0, ni + 1).filter((l) => !isState(l)) : lines;
  let words = wordCount((shaped ? counted.join(' ') + ' ' + (tail[0] || '') : lines.join(' ')) + (restNeeded ? '' : ' ' + rest));
  const extra = restNeeded ? wordCount(rest) : 0;
  if (shaped && (open.length || later.length)) words -= Math.max(0, wordCount(lines[ni]) - 12);
  const lineMax = T.lineMaxWords || 30;
  const longLine = states.find((l) => wordCount(withoutNames(l, names)) > lineMax);
  if (words > T.maxWords) faults.push(`it is ${words} words where a sitrep is about ${T.maxWords} (the lines for each thing and the questions put under "Needs you:" not counted)`);
  if (shaped && rest && !restNeeded) faults.push(`it has ${tail.length} sentences after "Needs you:" where a sitrep has at most one, unless a question or a fault needs more`);
  if (longLine) faults.push(`a line for one thing is ${wordCount(withoutNames(longLine, names))} words, where one line is about ${lineMax} ("${longLine.slice(0, 36)}")`);
  if (extra > T.extraWords) faults.push(`the sentences after it are ${extra} words where a question or a fault gets about ${T.extraWords}`);
  // What a sitrep leaves out: how the work is made. Their open questions are quoted as they are, and their names for
  // the things they asked for are their words.
  const body = withoutTyped(withoutNames(open.reduce((t, q) => t.split(String(q)).join(' '), lines.join('\n')), names));
  const out = [];
  if (hasAny(body, T.helperWords)) out.push('who did the work');
  if (hasAny(body, (S.modelLine || {}).modelWords)) out.push('model names');
  if (/\b\d+\s*(of|\/)\s*\d+\b|\b\d+\s+(tests?|checks?|cases?|passed|failed|files?)\b/i.test(body)) out.push('test counts');
  if (/`[^`\n]+`|\b[\w.-]+\.(md|ps1|mjs|cjs|js|ts|tsx|jsx|json|css|scss|html|sh|py|yml|yaml|log|txt)\b/i.test(body)) out.push('file names');
  const low = body.toLowerCase();
  if ([...(skills || [])].some((s) => (s.includes('-') || s.includes(':')) && s.length > 4 && new RegExp('(^|[^a-z0-9-])' + escRe(s) + '($|[^a-z0-9-])').test(low))) out.push('skill names');
  if (out.length) faults.push(`it names ${out.join(', ')}`);
  // One note, in two parts (the carried note keeps two): what is wrong; the shape.
  const fault = faults.length ? `as a sitrep, ${faults.join(', and ')}; a sitrep says only how far each thing they asked for has come: the bars, a headline sentence, one line per thing as a bullet ("- the thing: its state. What comes next."), a bullet "Needs you:" with what and why, or "nothing", and at most one sentence more (the hive-sitrep skill)` : '';
  return { asked, shaped, fault };
}

// ---------- inside words (2026-11-19) ----------
// A word from the settings' list (or a skill's name) in a reply to the person, not explained in the same reply and not used
// by them in their own message. Explained: a mark right after the word ("worktree (your own copy)", "a hook, a small
// program", "gate means") or the plain words of the list anywhere in the reply. Map, Used: and Saved: lines are skipped.
// Is the word that ends at `end` (and starts at `start`) explained in its own sentence? Its meaning may follow in any
// ordinary form: right after it, or later in the same sentence after a comma, a dash, a colon or a "which is", "that
// is", "means", "in other words" with at least three words of meaning; or the word stands in brackets after at least
// three words that say what it is.
const EXPLAIN_LATER = /^[^.!?\n]{0,40}?(\(|\s[—–-]\s|:\s|,\s+(a|an|the|which|that is|meaning|i\.e\.|in other words|or)\b|\s(means|meaning|which is|which are|that is|i\.e\.|is what|stands for|is a|is an|is the|are the|in other words|or in plain words|that is to say|so called|called)\b)/;
export function explainedAt(low, end, start, marks) {
  const after = low.slice(end, end + 12);
  if ((marks || []).some((k) => after.startsWith(k))) return true;
  const stop = low.slice(end).search(/[.!?\n]/);
  const rest = low.slice(end, stop < 0 ? undefined : end + stop);
  const m = rest.match(EXPLAIN_LATER);
  if (m && (rest.slice(m.index + m[0].length).match(/[\p{L}\p{N}]+/gu) || []).length >= 3) return true;
  const sStart = Math.max(low.lastIndexOf('.', start - 1), low.lastIndexOf('\n', start - 1), low.lastIndexOf('?', start - 1), low.lastIndexOf('!', start - 1)) + 1;
  const before = low.slice(sStart, start);
  if (/\(\s*(the\s+|a\s+|an\s+)?$/.test(before) && (before.match(/[\p{L}\p{N}]+/gu) || []).length >= 3) return true;
  return false;
}
export function insideWordsIn(text, ask, PW, skills) {
  const prose = withoutDisplay(text).split('\n').filter((l) => !isMapLine(l) && !isUsedLine(l) && !SAVED_LINE_ONE.test(l)).join('\n')
    .replace(/https?:\/\/\S+/g, ' ').replace(/```[\s\S]*?```/g, ' ');
  const low = prose.toLowerCase();
  const said = ' ' + String(ask || '').toLowerCase() + ' ';
  const entries = Object.entries(PW.words || {}).map(([w, plain]) => [String(w).toLowerCase(), String(plain)]);
  if (PW.skillNames) for (const s of skills || []) if ((s.includes('-') || s.includes(':')) && s.length > 4 && !entries.some(([w]) => w === s)) entries.push([s, 'what it does for them, not its name']);
  const found = [];
  for (const [w, plain] of entries) {
    const re = new RegExp('(^|[^a-z0-9-])(' + escRe(w) + ')(s|es)?(?=$|[^a-z0-9-])', 'gi');
    if (new RegExp('(^|[^a-z0-9-])' + escRe(w) + '(s|es)?($|[^a-z0-9-])').test(said)) continue; // their own word
    if (plain && low.includes(plain.toLowerCase())) continue;
    let m, unexplained = false, any = false;
    while ((m = re.exec(low))) {
      any = true;
      if (explainedAt(low, m.index + m[0].length, m.index + m[1].length, PW.explainMarks)) { unexplained = false; break; }
      unexplained = true;
    }
    if (any && unexplained) found.push(`"${w}" (say: ${plain})`);
  }
  if (!found.length) return '';
  const max = PW.maxNamed || 4;
  return `it uses inside words they may not know without saying what they mean; name each thing by what it is for them, or the first time a needed word appears say what it means in half a sentence (rule 6): ${found.slice(0, max).join(', ')}${found.length > max ? ` and ${found.length - max} more` : ''}`;
}
// The skills named on a "Used:" line (before any "Skipped" part): plugin:skill names, and names of installed skills.
export function usedSkills(text, known, ignore) {
  const names = [];
  for (const l of String(text).replace(/\r/g, '').split('\n').filter(isUsedLine)) {
    const body = l.replace(/^[^:]*:/, '').split(/\b(skipped|not used|not loaded|left out)\b/i)[0];
    for (const raw of body.match(/[A-Za-z][\w-]*(?::[A-Za-z][\w-]*)?/g) || []) {
      const t = raw.toLowerCase();
      if ((ignore || []).includes(t)) continue;
      const isSkill = (t.includes(':') && /^[a-z][a-z0-9-]*:[a-z][a-z0-9-]*$/.test(t)) || (known.has(t) && (t.includes('-') || t.length > 4));
      if (isSkill && !names.includes(t)) names.push(t);
    }
  }
  return names;
}
// The skills loaded in this chat, by it or its helpers. "testing-strategy" counts for "engineering:testing-strategy".
function loadedSkills() { return new Set(readLines(skillsFile()).map((x) => x.s)); }
function isLoaded(name, loaded) {
  const n = String(name).toLowerCase(), tail = (x) => x.split(':').pop();
  return loaded.has(n) || [...loaded].some((l) => tail(l) === tail(n));
}
const sentences = (text) => String(text).replace(/\r/g, '').split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);

// The same reading as core/checks/never-twice (sameChoice): a decision answers a question only when it settles the
// same choice, not merely the same topic.
const choiceWords = (s, drop) => [...new Set((String(s).toLowerCase().match(/[\p{L}][\p{L}\p{N}'-]{3,}/gu) || []).map((w) => w.replace(/'s$/, '').replace(/s$/, '')).filter((w) => w.length >= 4 && !drop.has(w)))];
export function sameChoice(question, decision, topic, C = {}) {
  const drop = new Set([...((C && C.stopWords) || []), ...(topic.ask || []), ...(topic.decided || [])].flatMap((w) => String(w).toLowerCase().split(/[^\p{L}\p{N}'-]+/u)).filter(Boolean).map((w) => w.replace(/s$/, '')));
  const q = choiceWords(question, drop);
  if (q.length < ((C && C.minChoiceWords) || 2)) return true;
  const d = new Set(choiceWords(decision, new Set()));
  const shared = q.filter((w) => d.has(w)).length;
  return shared >= ((C && C.minShared) || 2) && shared / q.length >= ((C && C.minShare) || 0.5);
}
// A question to the person about something a decision saved today already answers (rule 7: never ask twice).
// Narrow on purpose: only the topics in the settings (publishing or going live, installing).
export function askedAgainIn(text, decisionsText, day, A) {
  const asks = sentences(text).filter((s) => /\?\s*$/.test(s));
  if (!asks.length) return '';
  const rows = String(decisionsText || '').split(/\r?\n/).filter((l) => l.startsWith(`| ${day} |`));
  if (!rows.length) return '';
  for (const t of A.topics || []) {
    let q = '', row = '';
    for (const s of asks.filter((x) => hasAny(x, t.ask))) {
      row = rows.slice().reverse().find((r) => hasAny(r, t.decided) && sameChoice(s, r.split('|')[2] || r, t, A.sameChoice)) || '';
      if (row) { q = s; break; }
    }
    if (!row) continue;
    const said = row.split('|')[2].trim().replace(/\s+/g, ' ').slice(0, 220);
    return `it asks the person about ${t.name} ("${q.slice(0, 100)}"), but a decision they made today already answers it: "${said}". Act on that decision without asking again, or say in one sentence why it does not cover this case (rule 7: the person never has to say a thing twice)`;
  }
  return '';
}
function askedAgain(text) {
  let d = ''; try { d = fs.readFileSync(path.join(ROOT, S.asked.decisions || 'system/decisions.md'), 'utf8'); } catch { return ''; }
  return askedAgainIn(text, d, today(), S.asked);
}
// A save to the notes in this turn (by this chat, not a helper), or a reply that says it saved, with no "Saved:" line.
const SAVED_LINE = /^\s*[*_>-]*\s*saved\s*[*_]*\s*:/im;
function savedUnsaid(text, events) {
  if (SAVED_LINE.test(text)) return '';
  const root = norm(ROOT);
  const targets = (S.savedLine.targets || []).map((t) => root + '/' + String(t).toLowerCase().replace(/\/$/, ''));
  const wrote = events.find((e) => e.k === 'write' && !e.a && targets.some((t) => under(e.p, t)));
  const claims = hasAny(text, S.savedLine.claimWords);
  if (!wrote && !claims) return '';
  return `${wrote ? 'this turn saved something to the notes' : 'it says something was saved'}, but there is no "Saved: ..." line; add one line that starts with "Saved:" and says in plain words what was kept, so they can see it without asking`;
}
// A reply that relays what helpers did, in a chat that started helpers, and names no model (rule 12).
function modelUnsaid(text) {
  const L = S.modelLine;
  if (!hasAny(text, L.helperWords) || !hasAny(text, L.reportWords) || hasAny(text, L.modelWords)) return '';
  const recs = readLines(helpersFile());
  if (!recs.length) return '';
  const count = {};
  for (const r of recs) if (r.k !== 'resolved') count[r.m] = (count[r.m] || 0) + 1;
  for (const r of recs) if (r.k === 'resolved' && !(r.m in count)) count[r.m] = 0;
  const list = Object.entries(count).map(([m, n]) => (n > 1 ? `${m} (${n} helpers)` : m)).join(', ');
  return `it tells the person what helpers did but does not say which model did the work; the helpers of this chat were started on: ${list}. Add one plain sentence saying which model did what (rule 12)`;
}
// A verdict on an outside tool that has no review note yet (rule 10).
function outsideNames() {
  const names = new Set((S.reviewFirst.alsoNames || []).map((n) => String(n).toLowerCase()));
  for (const e of loadRegistry().entries || []) if (e.kind !== 'protocol' && (e.review === 'needed' || e.source === 'third-party')) names.add(e.id.toLowerCase());
  return [...names].filter((n) => n.length >= 4);
}
export function verdictIn(text, names, reviewsText, V) {
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const s of sentences(text)) {
    if (!hasAny(s, V.verdictWords) || hasAny(s, V.hedgeWords)) continue;
    const low = s.toLowerCase();
    for (const n of names) {
      const forms = [n, n.replace(/-/g, ' '), n.replace(/-mcp$/, '')].filter((f) => f.length >= 4);
      if (!forms.some((f) => new RegExp('(^|[^a-z0-9])' + esc(f) + '($|[^a-z0-9])').test(low))) continue;
      if (forms.some((f) => reviewsText.includes(f))) continue;
      return `it gives a verdict on ${n}, an outside tool that has no review yet ("${s.slice(0, 100)}"). Run the hive-review skill first, or say plainly that it is not reviewed yet (rule 10)`;
    }
  }
  return '';
}
function verdictUnreviewed(text) {
  if (!hasAny(text, S.reviewFirst.verdictWords)) return '';
  let reviews = '';
  try { const d = path.join(ROOT, S.reviewFirst.reviews || 'system/reviews'); for (const f of fs.readdirSync(d)) if (f.endsWith('.md')) reviews += fs.readFileSync(path.join(d, f), 'utf8').toLowerCase() + '\n'; } catch {}
  return verdictIn(text, outsideNames(), reviews, S.reviewFirst);
}
// A turn that did design work (wrote interface files) or motion work, with an "always" skill of that kind never
// loaded in this chat (rule 14). The kinds come from what was written, not from what was said.
function skillsUnfit(turn, events) {
  const kinds = new Set();
  const root = norm(ROOT);
  for (const e of events) {
    if (e.k !== 'write' || !e.p || e.p.endsWith('.md')) continue;
    if (under(e.p, root) && (S.stage.notesFolders || []).some((f) => under(e.p, root + '/' + String(f).toLowerCase()))) continue;
    const p = projectFor(e.p);
    const rel = p ? relIn(p, e.p) : e.p;
    if (inSkipped(rel)) continue;
    const ui = p ? p.status !== 'none' && isInterface(p, e.p) : S.design.extensions.some((x) => e.p.endsWith(x));
    if (ui) kinds.add('design');
    if ((ui || isCode(e.p)) && (turn.kinds || []).includes('motion')) kinds.add('motion');
  }
  if (!kinds.size) return '';
  const loaded = loadedSkills();
  const need = [];
  for (const k of kinds) for (const s of ((S.fit.always || {})[k] || [])) if (!need.includes(s) && !isLoaded(s, loaded)) need.push(s);
  if (!need.length) return '';
  return `this turn did ${[...kinds].join(' and ')} work, and ${need.join(', ')} ${need.length === 1 ? 'was' : 'were'} never loaded in this chat, though the settings name ${need.length === 1 ? 'it' : 'them'} as always needed for that work. Load ${need.length === 1 ? 'it' : 'them'} with the Skill tool and check the work against ${need.length === 1 ? 'it' : 'them'}, or say in one sentence why ${need.length === 1 ? 'it does' : 'they do'} not fit (rule 14)`;
}

// The faults of the last reply, kept for their next message (the reply check in "notice" mode). Read once, then removed.
const carryFile = () => path.join(GDIR, 'chat', safe(SID) + '.carry.json');
function shortFault(p) { return String(p).split(';').slice(0, 2).join(';').replace(/\s+/g, ' ').trim().slice(0, 420); }
export function carryNote(c) {
  const items = (c && c.items) || [];
  if (!items.length) return '';
  return (`About your last reply (it reached the person as it was; nothing was sent back): ${items.map((x, i) => `(${i + 1}) ${x}`).join(' ')}. ` +
    'Correct this in your next reply without mentioning this note or apologising; this note comes once.').slice(0, 1200);
}

function stop() {
  if (INPUT.stop_hook_active) { log('stop-pass', { why: 'already sent back once' }); return; }
  const text = String(INPUT.last_assistant_message || '');
  if (!text.trim()) return;
  const turn = readJson(turnFile(), { long: false, tech: false });
  const names = guard('reply', () => requestNames(), []); // the names of what they asked for: their words, never judged
  // Quiet: the map and the Used: line only for a reply that reports finished work or asks for a decision.
  // A reply is never sent back twice: the rewrite arrives with stop_hook_active and passes (the first line of stop()).
  const quiet = M('quiet', 'on') === 'on';
  // The reply check's mode. "notice" (default): nothing is sent back, so the person never gets the same reply twice; every
  // fault is kept and handed to Claude once, at their next message, to correct in the next reply. "refuse": the old
  // send-back (Claude writes the reply again, and the person sees both). "off": the form checks do nothing.
  const rm = M('reply', 'notice');
  const notes = []; // faults of checks in "notice" mode: carried to the next message when the reply check is in "notice"
  // The sitrep: they asked for one, or the reply has its shape. Its lines count as the progress map; its faults are
  // always carried to their next message, in every reply mode: a sitrep is never sent back. On its own error: null,
  // and the reply is checked as an ordinary one.
  const sr = M('sitrep', 'on') === 'off' ? null : guard('sitrep', () => sitrepOf(text, turn, S.sitrep, knownSkills(), names), null);
  const carried = []; // faults carried in every reply mode (the sitrep's)
  if (sr && sr.fault) { carried.push(sr.fault); log('sitrep-note', { asked: sr.asked, shaped: sr.shaped }); }
  const { words, problems } = rm === 'off' ? { words: 0, problems: [] } : guard('reply', () => checkReply(text, turn, S.reply, quiet ? S.quiet : null, sr), { words: 0, problems: [] });
  if (rm !== 'off') guard('intake', () => {
    const waiting = S.intake.enabled ? notLogged(turn.sent, listText()) : [];
    if (waiting.length) problems.push(`the person sent ${waiting.length === 1 ? 'something' : waiting.length + ' things'} in their last message that ${waiting.length === 1 ? 'is' : 'are'} not in the list of what they send (${waiting.slice(0, 3).map((x) => x.show).join(', ').slice(0, 200)}). Add a line for each to ${S.intake.list} now (waiting, used, or "set aside: why"), with the ${S.intake.skill} skill, and tell them in one sentence that it is kept`);
  });
  const events = readLines(eventsFile());
  // A standing wish the person stated, with nothing saved where wishes live.
  const pm = M('preference', 'notice');
  if (pm !== 'off' && turn.pref) guard('preference', () => {
    const root = norm(ROOT);
    const targets = (S.preference.saveTargets || []).map((t) => root + '/' + String(t).toLowerCase().replace(/\/$/, ''));
    const saved = events.some((e) => e.k === 'write' && targets.some((t) => under(e.p, t)));
    if (!saved) {
      log('pref-missed', {});
      (pm === 'refuse' ? problems : notes).push('the person stated a preference; save it (in the notes about the person, the rules or the decisions, with the hive-capture skill) and say "Saved: ..." in one line');
    }
  });
  // Skills named on the Used: line that were never loaded in this chat (by it or by its helpers).
  const um = M('usedCheck', 'notice');
  if (um !== 'off') guard('usedCheck', () => {
    const named = usedSkills(text, knownSkills(), S.usedCheck.ignoreWords);
    if (named.length) {
      const loaded = new Set(readLines(skillsFile()).map((x) => x.s));
      const tail = (n) => n.split(':').pop();
      const loadedTails = new Set([...loaded].map(tail));
      const never = named.filter((n) => !loaded.has(n) && !loadedTails.has(tail(n))); // "testing-strategy" matches "engineering:testing-strategy"
      if (never.length) {
        log('used-mismatch', { never: never.join(', ').slice(0, 200) });
        (um === 'refuse' ? problems : notes).push(`the "Used:" line names ${never.join(', ')}, but ${never.length === 1 ? 'that skill was' : 'those skills were'} never loaded in this chat; load ${never.length === 1 ? 'it' : 'them'} with the Skill tool, or take ${never.length === 1 ? 'it' : 'them'} off the line (rule 14: never claim a skill that was not used)`);
      }
    }
  });
  // "Done" with no passing check in this turn (rule 5).
  const dm = M('proof', 'notice');
  // A sitrep reads the states from the notes (asked for or not): its headline and its lines for each thing are not a
  // new claim of finished work; its other sentences are judged as ever.
  if (dm !== 'off' && !(sr && sr.asked && sr.shaped)) guard('proof', () => {
    if (hasAny(withoutTyped(sr && sr.shaped ? sitrepClaimsText(withoutNames(withoutDisplay(text), names), S.sitrep) : withoutNames(withoutDisplay(text), names)), S.proof.claimWords) && !events.some((e) => e.k === 'check' && e.ok)) {
      log('done-no-proof', {});
      (dm === 'refuse' ? problems : notes).push('it says the work is done or works, but no test, build or check passed in this turn; run the check and say what it showed, or say plainly that it was not checked (rule 5)');
    }
  });
  // The checks added on 2026-11-19 for the faults of that day. Each runs on its own; "notice" only logs.
  const later = (name, event, fn) => {
    const m = M(name, 'notice');
    if (m === 'off') return;
    const found = guard(name, fn, '');
    if (!found) return;
    log(event, { what: String(found).slice(0, 160) });
    (m === 'refuse' ? problems : notes).push(found);
  };
  later('asked', 'asked-again', () => askedAgain(text));
  later('savedLine', 'saved-unsaid', () => savedUnsaid(text, events));
  if (!sr) later('modelLine', 'model-unsaid', () => modelUnsaid(text)); // a sitrep never names models
  later('reviewFirst', 'verdict-unreviewed', () => verdictUnreviewed(text));
  later('skillsFit', 'skills-unfit', () => skillsUnfit(turn, events));
  // Their open questions are quoted word for word, inside words and all.
  later('plainWords', 'inside-words', () => insideWordsIn(judgedText((turn.questions || []).reduce((t, q) => t.split(String(q)).join(' '), text), names), turn.ask, S.plainWords, knownSkills()));
  later('decidedFor', 'decided-for-them', () => decidedForThem(text, S.decidedFor));
  // No reply fault is a safety fault, so in "notice" nothing blocks: the faults wait for their next message.
  const carry = (all) => {
    if (!all.length) return;
    guard('reply', () => writeJson(carryFile(), { at: Date.now(), words, items: all.map(shortFault) }));
    log('reply-carry', { words, problems: all.map((p) => p.split(';')[0].slice(0, 80)) });
  };
  if (rm !== 'refuse') { carry([...carried, ...problems, ...notes]); return; }
  carry(carried);
  if (!problems.length) return;
  log('stop-sendback', { words, problems: problems.map((p) => p.split(';')[0].slice(0, 80)) });
  out({ decision: 'block', reason:
    'HIVE REPLY CHECK (rules 5, 6, 7, 11, 13, 14): this reply was held back once, because ' + problems.map((p, i) => `(${i + 1}) ${p}`).join(' ') +
    '. The one thing to do: send the person a rewritten reply. Shape: the progress map line if it reports or asks, then say it the way you would say it to a friend: whole sentences, everyday words, the reason behind each thing, no labels and no inside words. Cover what is done, what the person must do and the one question; a "Used:" line after design or build. ' +
    'Do not apologise or mention this check. If the person really asked for a long document, write one line saying so and keep it.' });
}

function precompact() {
  clearRecs();
  log('precompact', {});
  const chat = loadChat(); chat.compacted = true; chat.remindAgain = true; saveChat(chat);
  const p = projectFor(norm(INPUT.cwd || ROOT));
  const lines = [
    'Hive Mind: keep these in the summary, in plain words.',
    '1. The rules are Hive Mind\'s always-rules in ~/hive-mind/system/rules.md; the start message re-delivers them after this summary. Keep their numbers when the chat referred to them.',
    '2. The project in work' + (p ? ` ("${p.title}")` : '') + ', its stage and the one next step.' + (p && p.status === 'gated' ? ` Its design direction note is ${p.direction}; the picks in it are fixed.` : ''),
    '3. Which protocol steps were done in this chat: direction note read, taste notes read, hive-scout run, brief written, review run. After the summary the gates ask for the reads and the scouting again; say so.',
    '4. Helpers still running: what each was told and where its report goes.',
    '5. Promises to the person, questions waiting for them, and what they approved, in their words.',
    '6. After the summary: read ~/hive-mind/system/in-flight.md and the project state note before doing anything.',
  ];
  if (M('longChat', 'on') !== 'off') lines.push('7. This chat is long. After the summary, write into ~/hive-mind/system/in-flight.md what lives only in this conversation, then offer the person a fresh chat in one plain sentence.');
  out(lines.join('\n'));
}

// ---------- the check modules (the contract of 2026-11-20, core/checks/README.md "How the gates call it") ----------
// After the gates' own checks, the loader in core/checks/_lib/hook.mjs runs every check module for this step and
// returns the gates' answer merged with the checks' (it keeps the debts and the carried words itself). It runs when the
// notebook is found and gates-off is absent, also in a chat with no start record (then only the safety checks). No
// loader: the gates' answer is unchanged, and that is logged once per chat ("checks-missing").
const HOOK_MODES = new Set(['pretool', 'posttool', 'posttoolfailure', 'prompt', 'stop', 'subagentstop']);
function checksMissing(lib) {
  if (!HOOK_MODES.has(MODE) || fs.existsSync(OFF) || !notebookFound()) return;
  const mark = path.join(GDIR, 'blind', 'checks-' + safe(SID || 'no-chat') + '.json');
  if (SID && fs.existsSync(mark)) return;
  try { writeJson(mark, { lib }); } catch {}
  log('checks-missing', { lib });
}

// ---------- run ----------
function main() {
  S = loadSettings();
  if (process.env.HIVE_GATES_CRASH === '1') throw new Error('test crash');
  if (MODE === 'fit') { fitCli(process.argv.slice(3)); return; } // a command for Claude, not a hook: no input, no start record needed
  if (MODE === 'where') { out(JSON.stringify({ root: ROOT, found: notebookFound(), off: fs.existsSync(OFF) }) + '\n'); return; } // for the health check
  let raw = '';
  try { raw = fs.readFileSync(0, 'utf8'); } catch {}
  INPUT = raw.trim() ? JSON.parse(raw) : {};
  SID = INPUT.session_id || '';
  // A connector that runs shell commands (the terminal connector's run_in_terminal and the like, N01) is read as the
  // shell it is, by the gates and by the check modules.
  const tn = String(INPUT.tool_name || '');
  if (/^mcp__/.test(tn) && INPUT.tool_input && typeof INPUT.tool_input.command === 'string' && /(^|_)(run_in_terminal|run_command|execute_command|exec_command|run_shell|shell_exec|execute_shell|run_terminal_command|bash|shell|terminal|theme_bash|run_session_command)$/i.test(tn.split('__').pop())) {
    INPUT = { ...INPUT, tool_name: 'Bash', hive_tool: tn, cwd: typeof INPUT.tool_input.cwd === 'string' && INPUT.tool_input.cwd ? INPUT.tool_input.cwd : INPUT.cwd };
  }
  setShellKind(INPUT.tool_name === 'PowerShell' ? 'ps' : 'sh');
  if (MODE === 'prompt') sayNotebookMissing();
  if (MODE === 'prompt') guard('off', () => sayOff());
  const on = active();
  if (!on) return;
  SAFETY_ONLY = on === 'safety';
  if (SAFETY_ONLY) { // only what the safety checks read: their latest message and Claude's last reply
    if (MODE === 'prompt') guard('yes', () => {
      const chat = loadChat();
      const t = String(INPUT.prompt || '');
      if (!chat.helper && !(chat.prompts > 0) && helperMarkIn(t, S.helperChat)) chat.helper = { at: Date.now() };
      chat.prompts = (chat.prompts || 0) + 1; saveChat(chat);
      // A helper chat's prompt is never their yes; nor is a helper's report, a notice or another chat's message here:
      // then their latest own message stays what it was.
      const mine = ownTurn(chat, chat.helper);
      if (mine.his) writeJson(turnFile(), { ask: mine.own.toLowerCase().slice(0, 1500), his: mine.own.slice(0, 4000), reply: lastReply(), own: true, at: Date.now() });
      else if (chat.helper) writeJson(turnFile(), { ask: '', his: '', reply: '', at: Date.now() });
    });
    if (MODE === 'stop') guard('yes', () => writeJson(replyFile(), { text: String(INPUT.last_assistant_message || '').toLowerCase().slice(-1500), at: Date.now() }));
    // The records their yes stands on: their answers on a question card, and the lines of a helper's report.
    if (MODE === 'posttool') guard('yes', () => {
      const tn = String(INPUT.tool_name || ''), ti = INPUT.tool_input || {};
      if (tn === 'AskUserQuestion' && !loadChat().helper && cardSeen()) {
        const items = cardAnswers({ ...ti, answers: undefined }, INPUT.tool_response).concat(cardAnswers(ti, null)).map((x) => ({ question: x.question, answer: x.words, t: Date.now() }));
        if (items.length) { const c = readJson(cardsFile(), { items: [] }) || { items: [] }; writeJson(cardsFile(), { items: [...(c.items || []), ...items].slice(-20) }); }
      }
      if (tn === 'SubagentHandback') recordReportLines(reportLinesFile(), String(ti.message || ''));
      if (tn === 'Agent' || tn === 'Task') recordReportLines(reportLinesFile(), textOf((INPUT.tool_response || {}).content));
    });
    if (MODE === 'subagentstop') guard('yes', () => recordReportLines(reportLinesFile(), String(INPUT.last_assistant_message || '')));
    if (MODE !== 'pretool') return;
  }
  if (MODE === 'pretool') pretoolAnswer(pretool());
  else if (MODE === 'posttool') posttool();
  else if (MODE === 'posttoolfailure') guard('proof', () => failedTool()); // PostToolUseFailure: a test, build or check that failed is written down as failed
  else if (MODE === 'prompt') prompt();
  else if (MODE === 'stop') {
    // Claude's last reply, kept for their next message: a bare "yes" counts only for the act this reply asked about.
    guard('yes', () => writeJson(replyFile(), { text: String(INPUT.last_assistant_message || '').toLowerCase().slice(-1500), at: Date.now() }));
    stop();
  } else if (MODE === 'precompact') precompact();
  else if (MODE === 'subagentstop') subagentstop();
}
const isMain = process.argv[1] && import.meta.url.toLowerCase().endsWith(path.basename(process.argv[1]).toLowerCase());
if (isMain) {
  try { main(); } catch (e) { log('error', { error: String(e && e.message || e).slice(0, 300) }); }
  // The check modules, through their loader (the three lines of core/checks/README.md, "How the gates call it"), plus
  // one change of ours: a missing loader changes nothing and is logged once per chat (checksMissing).
  let final = OUTBOX; const lib = path.join(ROOT, 'core', 'checks', '_lib', 'hook.mjs');
  try { if (fs.existsSync(lib) && !fs.existsSync(OFF) && notebookFound()) final = await (await import(pathToFileURL(lib).href)).runChecks({ mode: MODE, input: INPUT, root: ROOT, state: STATE, sid: SID, outbox: OUTBOX, log, deadline: T0 + LIMIT_MS - 400, started: active() }); else if (!fs.existsSync(lib)) checksMissing(lib); } catch (e) { log('error', { where: 'checks', kind: 'safety', error: String(e && e.message || e).slice(0, 300) }); }
  flush(final);
  process.exit(0);
}
