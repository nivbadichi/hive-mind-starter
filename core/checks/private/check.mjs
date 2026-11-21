// Hive Mind check: private (rule 9). Before anything leaves the computer.
// A web search, a web fetch, a connector call, a publish, a helper sent to the cloud, or a shell
// command that sends something out is refused when it carries a protected name, a key shape, text
// from the private folders (the private folder and every employer project), or names such a file.
// It never prints or logs what it found in full: only the kind, a length, a list number.
// Safety check: on its own error it refuses the step and says so.
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
let defaults = null;
// The settings can add to these lists, never take from them: the file is not a way to switch a safety check off.
const FLOOR = {
  searchTools: ["WebSearch"],
  fetchTools: ["WebFetch"],
  shellTools: ["Bash", "PowerShell"],
  publishTools: ["Artifact"],
  privateDirs: ["me", "private"],
};
const PROBE = "mcp__somemail__send_message"; // a local-tool pattern that would also match an outside connector is dropped
function settingsOf(ctx, build = true) {
  if (!defaults) defaults = JSON.parse(readFileSync(join(HERE, "settings.json"), "utf8"));
  const s = { ...defaults, ...(ctx?.settings || {}) };
  for (const [k, v] of Object.entries(FLOOR)) s[k] = [...new Set([...v, ...(Array.isArray(s[k]) ? s[k] : [])])];
  if (!build) return s;
  // Every pattern is built here, at every step, so a broken setting always stops the step (never only sometimes).
  s.re = {
    local: (Array.isArray(s.localToolPatterns) ? s.localToolPatterns : []).map((p) => new RegExp(p)).filter((r) => !r.test(PROBE)),
    marker: new RegExp(s.employerMarker, "im"),
    outbound: new RegExp(s.outboundCommandPattern, "i"),
    files: s.protectedFilePatterns.map((p) => new RegExp(p, "i")),
  };
  if (!Array.isArray(s.projectNotes)) s.projectNotes = ["state.md"];
  s.re.own = ownSearchPatterns(s);
  return s;
}

// ---------- the person's own accounts (ownAccounts in settings.json; empty out of the box) ----------
// A search of their own connected mail or drive may carry a protected name: the search stays inside their own account.
// Only the name part of the scan is skipped there; keys and words from private notes are still refused, and every
// other tool (a web search, a fetch, a send, a draft, a share) is read exactly as before. A pattern on the list that
// would also match a sending or writing tool, a tool that is not a connector, or a tool whose own name is not a
// search, is dropped, so the list is never a way out.
const OWN_PROBES = [PROBE, "mcp__somemail__create_draft", "mcp__somemail__reply", "mcp__somedrive__create_file", "mcp__somedrive__share_file", "mcp__somedrive__update_file", "mcp__someslack__post_message", "WebSearch", "WebFetch", "Bash", "PowerShell"];
const SEARCH_TAIL = /^search(_[a-z]+)*$/;
// The one shape a pattern may have: one connector (or a choice of its names) and one search tool, whole.
const OWN_SHAPE = /^\^mcp__(\([A-Za-z0-9_\-|]+\)|[A-Za-z0-9_\-]+)__search(_[a-z]+)*\$$/;
function ownSearchPatterns(s) {
  const list = s.ownAccounts && Array.isArray(s.ownAccounts.allowSearchTools) ? s.ownAccounts.allowSearchTools : [];
  return list.map((p) => [String(p), new RegExp(p)]).filter(([p, re]) => OWN_SHAPE.test(p) && !OWN_PROBES.some((t) => re.test(t))).map(([, re]) => re);
}
function ownAccountSearch(tool, s) {
  if (!tool.startsWith("mcp__") || !SEARCH_TAIL.test(tool.split("__").pop())) return false;
  return s.re.own.some((re) => re.test(tool));
}
const stat = (p) => statSync(p, { throwIfNoEntry: false });

// ---------- key shapes (the privacy check's shapes, plus the ones a call can carry) ----------
export const KEY_SHAPES = [
  ["a GitHub token", /\bgh[pousr]_[A-Za-z0-9]{30,}/],
  ["a GitHub fine-grained token", /\bgithub_pat_[A-Za-z0-9_]{30,}/],
  ["an API key (sk-)", /\bsk-[A-Za-z0-9_-]{20,}/],
  ["a payment key (sk_ or rk_)", /\b[sr]k_(?:live|test)_[A-Za-z0-9]{16,}/],
  ["an AWS key id", /\bAKIA[0-9A-Z]{16}\b/],
  ["a private key block", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["a Slack token", /\bxox[baprs]-[A-Za-z0-9-]{10,}/],
  ["a Google API key", /\bAIza[0-9A-Za-z_-]{35}/],
  ["a signed web token (JWT)", /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
  ["a bearer token", /\bbearer\s+(?!\$)(?=[A-Za-z0-9._~+\/-]*\d)[A-Za-z0-9._~+\/-]{16,}=*/i],
  ["a password inside an address", /\b[a-z][a-z0-9+.-]*:\/\/[^\/\s:@]+:[^\/\s@]{3,}@/i],
  ["a key in an address", /[?&](?:api[_-]?key|apikey|access[_-]?token|auth[_-]?token|token|secret|client[_-]?secret|password|passwd|pwd|signature|sig|key)=(?!\$)[^&\s#]{12,}/i],
  // A value after "password =" and the like only counts when it looks made up (letters and digits,
  // no dots or brackets), so a sentence or "api_key = os.environ[...]" passes (lessons, 2026-11-14).
  ["a password or secret assignment", /\b(?:password|passwd|secret|api[_-]?key|token)\b\s*[:=]\s*["']?(?=[^\s"'<>]*\d)(?=[^\s"'<>]*[A-Za-z])[^\s"'<>.()[\]{}$]{12,}/i],
];
// In search words only: a long made-up string (upper, lower and digits), the shape of a bare key
// with no known prefix (the roast: "a bare Vercel or Upstash key ... passes").
const RANDOM = /[A-Za-z0-9_\-]{32,}/g;
function randomTokens(text, min) {
  const out = [];
  for (const m of text.matchAll(RANDOM)) {
    const t = m[0];
    if (t.length >= min && /[A-Z]/.test(t) && /[a-z]/.test(t) && /\d/.test(t)) out.push(t);
  }
  return out;
}

// ---------- protected names (where the privacy check keeps them) ----------
export function namesFileOf(ctx) {
  return ctx?.namesFile ?? process.env.HIVE_NAMES_FILE ?? join(ctx?.home ?? homedir(), ".claude", "hive", "protected-names.txt");
}
let namesMemo = null;
function loadNames(ctx) {
  const file = namesFileOf(ctx);
  const st = stat(file);
  if (!st) return { found: false, list: [] };
  const stamp = `${file}|${st.mtimeMs}|${st.size}`;
  if (namesMemo?.stamp === stamp) return namesMemo.names;
  const list = [];
  readFileSync(file, "utf8").split(/\r?\n/).forEach((raw, i) => {
    const n = raw.trim();
    if (n.length < 3 || n.startsWith("#")) return;
    const body = n
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      .replace(/\s+/g, "[\\s+_.\\-]*");
    list.push({ line: i + 1, re: new RegExp("(?<![\\p{L}\\p{N}])" + body + "(?![\\p{L}\\p{N}])", "iu") });
  });
  namesMemo = { stamp, names: { found: true, list } };
  return namesMemo.names;
}

// ---------- the private folders and their fingerprints ----------
const TEXT_EXT = /\.(md|txt|json|csv|tsv|yml|yaml|html|htm|xml|ini|toml)$/i;
function wordsOf(text) {
  return text.normalize("NFKC").toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
}
function cyrb53(str, seed = 0) {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
export function shingles(text, s) {
  const n = s.shingleWords, minLong = s.shingleMinLongWords;
  const w = wordsOf(text);
  const out = [];
  for (let i = 0; i + n <= w.length; i++) {
    const win = w.slice(i, i + n);
    if (win.filter((x) => x.length >= 4).length < minLong) continue;
    out.push(cyrb53(win.join(" ")));
  }
  return out;
}

// One cache file in the Hive folder. Per file it keeps a fingerprint of the path (never the path itself), the
// file's time and size, whether a project note marks an employer project, and for private notes the hashes of
// their six-word runs (never the words). Unchanged files are never read again, which keeps a step fast; the
// cache is also kept in memory between steps of one run.
let mem = null;
function openCache(ctx, s) {
  const file = ctx.state ? join(ctx.state, "private-index.json") : null;
  const st = file ? stat(file) : null;
  const stamp = st ? `${st.mtimeMs}:${st.size}` : "";
  const fits = (d) => d && d.v === 2 && d.n === s.shingleWords && d.k === s.shingleMinLongWords && d.mk === s.employerMarker && d.p && d.f;
  if (mem && mem.file === file && mem.stamp === stamp && fits(mem.data)) return mem;
  let data = { v: 2, n: s.shingleWords, k: s.shingleMinLongWords, mk: s.employerMarker, p: {}, f: {} };
  if (st) {
    try { const d = JSON.parse(readFileSync(file, "utf8")); if (fits(d)) data = d; } catch { /* a broken cache is rebuilt */ }
  }
  mem = { file, stamp, data, set: null, dirty: false };
  return mem;
}
function saveCache(c) {
  if (!c || !c.dirty || !c.file) return;
  c.dirty = false;
  try {
    mkdirSync(dirname(c.file), { recursive: true });
    writeFileSync(c.file, JSON.stringify(c.data));
    const st = stat(c.file);
    c.stamp = st ? `${st.mtimeMs}:${st.size}` : "";
  } catch { /* the check still works without its cache */ }
}

export function privateRoots(ctx, s, c = openCache(ctx, s)) {
  const root = ctx.root;
  const roots = [];
  if (!root) return roots;
  for (const d of s.privateDirs) {
    const p = join(root, d);
    if (stat(p)?.isDirectory()) roots.push(p);
  }
  const projects = join(root, "projects");
  let names = [];
  try { names = readdirSync(projects, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name); } catch { /* no projects folder */ }
  const marker = s.re.marker;
  for (const name of names) {
    let employer = false;
    for (const note of s.projectNotes) {
      const p = join(projects, name, note);
      const st = stat(p);
      if (!st || !st.isFile()) continue;
      const k = cyrb53(p);
      const old = c.data.p[k];
      let flag;
      if (old && old.m === st.mtimeMs && old.s === st.size) flag = old.e;
      else {
        flag = marker.test(readFileSync(p, "utf8").slice(0, 4000));
        c.data.p[k] = { m: st.mtimeMs, s: st.size, e: flag };
        c.dirty = true;
      }
      if (flag) employer = true;
    }
    if (employer) roots.push(join(projects, name));
  }
  return roots;
}

function walk(dir, out, limit = 5000) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (out.length >= limit) return;
    const p = join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== "node_modules" && e.name !== ".git") walk(p, out, limit); }
    else if (e.isFile() && TEXT_EXT.test(e.name)) out.push(p);
  }
}

// The fingerprints of every private note: only the notes that changed since the last step are read.
function loadIndex(s, roots, c) {
  const files = [];
  for (const r of roots) walk(r, files);
  const keys = new Set();
  for (const f of files) {
    const st = stat(f);
    if (!st) continue;
    const k = cyrb53(f);
    keys.add(k);
    const old = c.data.f[k];
    if (old && old.m === st.mtimeMs && old.s === st.size) continue;
    const text = readFileSync(f, "utf8").slice(0, s.maxFileBytes);
    c.data.f[k] = { m: st.mtimeMs, s: st.size, h: [...new Set(shingles(text, s))] };
    c.dirty = true;
    c.set = null;
  }
  // A note that was deleted, or moved out of the private part, stops counting.
  const sig = [...keys].sort().join(",");
  if (!c.set || c.sig !== sig) {
    for (const k of Object.keys(c.data.f)) if (!keys.has(k)) { delete c.data.f[k]; c.dirty = true; }
    c.sig = sig;
    c.set = new Set();
    for (const k of keys) for (const h of c.data.f[k]?.h || []) c.set.add(h);
  }
  return c.set;
}

// ---------- paths ----------
function inside(child, parent) {
  const r = relative(parent, child);
  return r === "" || (!!r && !r.startsWith("..") && !isAbsolute(r));
}
function toAbs(tok, cwd, home) {
  let t = tok;
  if (t.startsWith("~")) t = join(home, t.slice(1));
  if (process.platform === "win32") {
    const m = /^\/([a-zA-Z])(\/.*)?$/.exec(t);
    if (m) t = m[1] + ":" + (m[2] || "/");
  }
  return isAbsolute(t) ? resolve(t) : resolve(cwd, t);
}
function looksLikePath(t, dirs = []) {
  if (!t || t.length > 400 || /:\/\//.test(t)) return false;
  return /[\\/]/.test(t) || /\.[A-Za-z0-9]{1,5}$/.test(t) || t.startsWith("~") || /^\.env/.test(t) || dirs.includes(t);
}

// ---------- the scan ----------
function scanText(text, where, env) {
  const found = [];
  const s = env.s;
  const variants = [text];
  try {
    let d = text.replace(/\+/g, " ");
    for (let i = 0; i < 2; i++) { const n = decodeURIComponent(d); if (n === d) break; d = n; }
    if (d !== text) variants.push(d);
  } catch { /* text that is not an address */ }
  const all = variants.join("\n").slice(0, s.maxScanChars);
  for (const [kind, re] of KEY_SHAPES) {
    const m = re.exec(all);
    if (m) found.push(`${kind} (${m[0].length} characters, value hidden) in ${where}`);
  }
  if (env.random) for (const t of randomTokens(all, s.randomTokenMinLength)) found.push(`a long made-up string, the shape of a key (${t.length} characters, value hidden) in ${where}`);
  if (!env.ownAccount) for (const n of env.names.list) if (n.re.test(all)) found.push(`protected name number ${n.line} on the list (name hidden) in ${where}`);
  // Text too short to hold a six-word run never needs the private notes' fingerprints.
  const runs = shingles(all, s);
  if (runs.length) {
    const ix = env.index();
    if (ix.size && runs.some((h) => ix.has(h))) found.push(`words copied from a private note (six or more in a row) in ${where}`);
  }
  return found;
}

function scanPath(tok, where, env, { ancestorRule }) {
  const abs = toAbs(tok, env.cwd, env.home);
  for (const r of env.roots()) {
    if (inside(abs, r)) return [`a file or folder from the private part of the notebook in ${where}`];
    if (ancestorRule && inside(r, abs) && stat(abs)?.isDirectory()) return [`a folder that holds the private part of the notebook in ${where}`];
  }
  const norm = abs.split(sep).join("/");
  for (const re of env.s.re.files) if (re.test(norm) || re.test(tok)) return [`a protected file (keys, sign-ins or the list of names) in ${where}`];
  const st = stat(abs);
  if (st) {
    if (st.isFile() && st.size <= env.s.maxFileBytes) {
      const buf = readFileSync(abs);
      if (!buf.subarray(0, 4096).includes(0)) return scanText(buf.toString("utf8"), "a file it sends", env);
    }
  }
  return [];
}

function strings(v, out = [], depth = 0) {
  if (depth > 8 || out.length > 2000) return out;
  if (typeof v === "string") out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => strings(x, out, depth + 1));
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) { out.push(k); strings(x, out, depth + 1); }
  return out;
}

const SKIP_AFTER = /^(cd|set-location|pushd|sl|-c|-o|--output|-outfile|--output-document|-O)$/i;
function commandPaths(cmd, dirs) {
  const toks = cmd.split(/[\s"'`|;&<>(),]+/).filter(Boolean);
  const out = [];
  for (let i = 0; i < toks.length; i++) {
    if (i > 0 && SKIP_AFTER.test(toks[i - 1])) continue;
    for (let t of toks[i].split("=")) {
      t = t.replace(/^@/, "");
      // scp and rsync write remote places as host:path; the local side is what leaves.
      if (/^[^\\/:]+@?[^\\/:]*:[^\\]/.test(t) && !/^[a-zA-Z]:[\\/]/.test(t)) continue;
      if (looksLikePath(t, dirs)) out.push(t);
    }
  }
  return out;
}

export function examine(ev, ctx) {
  const tool = ev.tool ?? ev.tool_name ?? "";
  const input = ev.input ?? ev.tool_input ?? {};
  // A step that sends nothing out (reading, writing a local file) is never looked at, even with broken settings,
  // so the way to mend the check stays open.
  const raw = settingsOf(ctx, false);
  const lists = [raw.searchTools, raw.fetchTools, raw.shellTools, raw.publishTools, raw.textTools || []];
  if (!tool.startsWith("mcp__") && !lists.some((l) => l.includes(tool)) && !(tool === "Agent" && input.isolation === "remote")) return { kind: null, found: [] };
  const s = settingsOf(ctx);
  const isLocal = s.re.local.some((re) => re.test(tool));
  let kind = null;
  if (s.searchTools.includes(tool)) kind = "search";
  else if (s.fetchTools.includes(tool)) kind = "fetch";
  else if (s.shellTools.includes(tool)) kind = "shell";
  else if (s.publishTools.includes(tool)) kind = "publish";
  else if ((s.textTools || []).includes(tool) || (tool.startsWith("mcp__") && !isLocal)) kind = "connector";
  // A helper sent to the cloud takes its instructions with it.
  else if (tool === "Agent" && input.isolation === "remote") kind = "cloud";
  if (!kind) return { kind: null, found: [] };

  let c = null, roots = null, idx = null;
  const cache = () => (c ??= openCache(ctx, s));
  const env = {
    s,
    roots: () => (roots ??= privateRoots(ctx, s, cache())),
    names: loadNames(ctx),
    home: ctx.home ?? homedir(),
    cwd: ev.cwd ?? ctx.root ?? process.cwd(),
    random: false,
    ownAccount: kind === "connector" && ownAccountSearch(tool, s),
    index: () => (idx ??= loadIndex(s, env.roots(), cache())),
  };
  if (env.ownAccount) ctx.log?.("private-own-account", { tool });
  try {
    return { kind, found: [...new Set(scan(kind, ev, input, env))], namesChecked: env.names.found };
  } finally {
    saveCache(c);
  }
}

// The part of a shell command that can send: what it does, not the words inside a quoted text or the body of a note
// it writes (2026-11-20, a commit message and a note that held web addresses were refused as "sending
// something out"). Quoted text counts again when it is code an interpreter runs (node -e, python -c, a shell's -c,
// PowerShell -Command), or a command run inside $( ) or backticks.
const RUNS_QUOTED = /\b(node|deno|bun|python3?|py|ruby|perl|php|pwsh|powershell|bash|sh|zsh|cmd)(\.exe)?\b[^|;&\n]*\s(-e|--eval|-p|--print|-c|-lc|-command|\/c|\/k)\b|\$\(|`|\b(iex|invoke-expression|eval)\b/i;
export function sendingPart(cmd) {
  const c = String(cmd || "");
  if (RUNS_QUOTED.test(c)) return c;
  return c
    .replace(/<<-?\s*(['"]?)(\w+)\1[^\n]*\n[\s\S]*?\n\s*\2\s*(\n|$)/g, " ") // a heredoc's body
    .replace(/@'[\s\S]*?'@|@"[\s\S]*?"@/g, " ") // a PowerShell here-string
    .replace(/"(?:[^"\\]|\\.)*"|'[^']*'/g, '""');
}
function scan(kind, ev, input, env) {
  const s = env.s;
  const found = [];
  if (kind === "cloud") {
    found.push(...scanText([input.prompt, input.description].filter((x) => typeof x === "string").join("\n"), "the instructions of a helper sent to the cloud", env));
  } else if (kind === "search") {
    env.random = true;
    found.push(...scanText(strings(input).join("\n"), "the search words", env));
  } else if (kind === "fetch") {
    found.push(...scanText(String(input.url ?? ""), "the address", env));
  } else if (kind === "shell") {
    const cmd = String(ev.command ?? input.command ?? "");
    if (!s.re.outbound.test(sendingPart(cmd))) return found;
    found.push(...scanText(cmd, "the command", env));
    const ancestorRule = /\b(scp|rsync|rclone|gsutil|sftp|ftp|aws\s+s3)\b/i.test(cmd);
    for (const p of commandPaths(cmd, s.privateDirs)) found.push(...scanPath(p, "a path the command names", env, { ancestorRule }));
  } else if (kind === "publish") {
    const paths = [input.file_path, ...(input.file_paths || [])];
    if (input.files && typeof input.files === "object") {
      for (const v of Object.values(input.files)) paths.push(typeof v === "string" ? v : v?.from);
    }
    const base = input.root ? toAbs(input.root, env.cwd, env.home) : env.cwd;
    for (const p of paths.filter((x) => typeof x === "string")) found.push(...scanPath(p, "the page it publishes", { ...env, cwd: base }, { ancestorRule: false }));
    for (const k of ["title", "description", "label"]) if (typeof input[k] === "string") found.push(...scanText(input[k], "the page's title or description", env));
  } else {
    const all = strings(input);
    found.push(...scanText(all.join("\n"), "what the connector is sent", env));
    for (const v of all) if (looksLikePath(v) && (isAbsolute(v) || v.startsWith("~") || /^\/[a-zA-Z]\//.test(v))) found.push(...scanPath(v, "a file the connector is given", env, { ancestorRule: true }));
  }
  return found;
}

// ---------- text marked private is never stored by the notebook's own programs ----------
// The idea kept from claude-mem (2026-11-19): a person can wrap words in <private> ... </private>, and Hive Mind's own
// programs (the questions list, the lessons, the front-door list, the snapshot, the in-flight note and the others in
// settings.json, "privateMark") never store them. A write into one of those notes, or a run of one of the programs that
// write them, that carries the mark is refused. The mark and the lists come from the settings; the floor below is kept
// whatever the settings say. The marked words are never shown or logged.
const STORE_FLOOR = {
  patterns: ["<private\\b[^>]*>", "</private\\s*>"],
  notes: ["system/questions.json", "system/questions-for-him.md", "system/lessons.md", "inbox/sources.md", "inbox/answers.md", "app/src/data/snapshot.json"],
  programs: ["core/engine/questions\\.mjs", "system/snapshot\\.mjs"],
  writeTools: ["Write", "Edit", "MultiEdit", "NotebookEdit"],
};
function storeSettings(raw) {
  const m = raw && typeof raw.privateMark === "object" && raw.privateMark ? raw.privateMark : {};
  const list = (k) => [...new Set([...STORE_FLOOR[k], ...(Array.isArray(m[k]) ? m[k] : [])])];
  return { patterns: list("patterns"), notes: list("notes").map((n) => n.replace(/\\/g, "/")), programs: list("programs"), writeTools: list("writeTools") };
}
const slash = (p) => String(p).split(sep).join("/").replace(/\\/g, "/");
function programNote(abs, root, notes) {
  if (!root) return null;
  const r = slash(relative(resolve(root), abs));
  if (!r || r.startsWith("..") || isAbsolute(r)) return null;
  return notes.find((n) => (n.endsWith("/") ? r.startsWith(n) : r === n)) ? r : null;
}
function newText(tool, input) {
  if (tool === "Write") return [input.content];
  if (tool === "Edit") return [input.new_string];
  if (tool === "MultiEdit") return (Array.isArray(input.edits) ? input.edits : []).map((e) => e && e.new_string);
  if (tool === "NotebookEdit") return [input.new_source];
  return strings(input);
}

/** What a step would store that is marked private: a list of places (never the words), or [] when nothing. */
export function examineStore(ev, ctx) {
  const tool = ev.tool ?? ev.tool_name ?? "";
  const input = ev.input ?? ev.tool_input ?? {};
  const raw = settingsOf(ctx, false);
  const st = storeSettings(raw);
  const cwd = ev.cwd ?? ctx.root ?? process.cwd();
  const home = ctx.home ?? homedir();
  let where = [];
  if (st.writeTools.includes(tool)) {
    const target = typeof input.file_path === "string" ? input.file_path : typeof input.notebook_path === "string" ? input.notebook_path : "";
    const note = target ? programNote(toAbs(target, cwd, home), ctx.root, st.notes) : null;
    if (!note) return [];
    const mark = new RegExp(st.patterns.join("|"), "i");
    if (newText(tool, input).some((t) => typeof t === "string" && mark.test(t))) where.push(`the note ${note}, which the notebook's own programs keep`);
  } else if (raw.shellTools.includes(tool)) {
    const cmd = slash(String(ev.command ?? input.command ?? ""));
    const runs = st.programs.map((p) => new RegExp(p, "i")).find((re) => re.test(cmd));
    if (!runs) return [];
    const mark = new RegExp(st.patterns.join("|"), "i");
    if (mark.test(cmd)) where.push("the words given to a program that writes the notebook's notes");
    for (const p of commandPaths(String(ev.command ?? input.command ?? ""), [])) {
      const abs = toAbs(p, cwd, home);
      const s = stat(abs);
      if (!s || !s.isFile() || s.size > (raw.maxFileBytes || 1048576)) continue;
      if (mark.test(readFileSync(abs, "utf8"))) { where.push("a file given to a program that writes the notebook's notes"); break; }
    }
  }
  return [...new Set(where)];
}

const WHAT = { search: "a web search", fetch: "a web fetch", shell: "a shell command that sends something out", publish: "a publish", connector: "a connector call", cloud: "a helper sent to the cloud" };

export default {
  id: "private",
  rule: "rule 9",
  kind: "safety",
  mode: "refuse",
  about: "Before anything leaves the computer, a search, a fetch, a connector call, a publish, a helper sent to the cloud or a shell command that carries a protected name, a key, private text or a private file is refused; text marked <private> is never stored in the notes the notebook's own programs keep.",
  steps: {
    pretool(ev, ctx) {
      const s = (() => { try { return settingsOf(ctx, false); } catch { return {}; } })();
      s.askWho = ctx?.who || s.askWho || "the person";
      try {
        const kept = examineStore(ev, ctx);
        if (kept.length) {
          ctx.log?.("private-deny", { tool: ev.tool ?? ev.tool_name, kind: "store", count: kept.length });
          return {
            deny:
              `HIVE GATE (private): stopped this step, because it would store text marked private (between <private> and </private>) in ${kept.join("; ")}. ` +
              `Text marked private is never stored by Hive Mind's own programs: take the marked part out, keep it only where it was written, and try again.`,
          };
        }
        const r = examine(ev, ctx);
        if (!r.kind || !r.found.length) return null;
        ctx.log?.("private-deny", { tool: ev.tool ?? ev.tool_name, kind: r.kind, count: r.found.length });
        return {
          deny:
            `HIVE GATE (private): stopped ${WHAT[r.kind]}, because it would send out: ${r.found.slice(0, 5).join("; ")}. ` +
            `Rule 9: nothing private leaves the computer. Take that part out and try again; if it truly must go, ask ${s.askWho} in one plain sentence first.`,
        };
      } catch (e) {
        ctx.log?.("error", { check: "private", step: "pretool", code: e?.code ?? e?.name ?? "error" });
        return {
          deny: `HIVE GATE (private): the private check broke on this step, so the step is stopped to be safe (it is a safety check). Run "node --test core/checks/private/check.test.mjs" and tell ${s.askWho} in one plain sentence.`,
        };
      }
    },
  },
};
