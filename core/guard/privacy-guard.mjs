#!/usr/bin/env node
// Hive Mind privacy check, the version that runs anywhere Node runs (the cloud, GitHub, the PC).
// Same rules as privacy-guard.ps1. It never prints a secret, only where it found one.
// Exit 0 = clean. 1 = STOP (a secret was found). 2 = CHECK, a warning only (an email address outside me/, a user-name path).
// Protected names live only on the PC (HIVE_NAMES_FILE or ~/.claude/hive/protected-names.txt);
// where that file is missing, names are not checked, and the output says so.
//
// What it reads: every file git knows about (saved or new), by its content, not by its ending.
// It skips only what is truly binary (a picture, a font, an archive, or any file with a zero byte
// in it) and what is generated (node_modules, lock files). A file too large to read is named in the output.
//
// Three ways to run it:
//   node privacy-guard.mjs [folder]               the whole notebook as it is now (the check before a save);
//                                                 the folder is HIVE_ROOT, then the current folder, when not given
//   node privacy-guard.mjs --push [folder]        reads the lines git gives a pre-push hook on stdin and reads
//                                                 everything that is about to be sent (the second look)
//   node privacy-guard.mjs --unchecked [folder]   names every save that did not go through the check
//                                                 (exit 0 none, 3 some, 1 some that also hold a secret)
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir, userInfo } from "node:os";
import { join } from "node:path";

const args = process.argv.slice(2);
const mode = args.includes("--push") ? "push" : args.includes("--unchecked") ? "unchecked" : "tree";
const root = args.find((a) => !a.startsWith("--")) ?? process.env.HIVE_ROOT ?? process.cwd();
const namesFile = process.env.HIVE_NAMES_FILE ?? join(homedir(), ".claude", "hive", "protected-names.txt");
const PRIVATE_DIR = "me/";
const MAX_BYTES = 5 * 1024 * 1024;
const LOG_NAME = "hive-guard-checked.log"; // written by the pre-commit hook inside the git folder

// ---- the rules ------------------------------------------------------------------------------
const rules = [
  ["GitHub token", /gh[pousr]_[A-Za-z0-9]{30,}/g],
  ["GitHub fine-grained token", /github_pat_[A-Za-z0-9_]{30,}/g],
  ["API key (sk-)", /sk-[A-Za-z0-9_-]{20,}/g],
  ["AWS key id", /AKIA[0-9A-Z]{16}/g],
  ["Private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/g],
  ["Slack token", /xox[baprs]-[A-Za-z0-9-]{10,}/g],
  ["Google API key", /AIza[0-9A-Za-z_-]{35}/g],
  // [ \t] and not \s: a match must not run across a line break, so the line number stays true.
  // In notes and settings the value may be bare; in a program it must be a quoted text, or
  // a program that only reads its key from the settings would be taken for a leak.
  ["Password or secret assignment", /\b(password|passwd|secret|api[_-]?key|token)\b[ \t]*[:=][ \t]*["']?[^\s"'<>]{8,}/gi, "notes"],
  ["Password or secret assignment", /(?<![\w-])(password|passwd|secret|api[_-]?key|token)\b["']?[ \t]*[:=][ \t]*(["'`])[^"'`\s<>$\\]{8,}\2/gi, "code"],
];

// A path that holds the user name of this computer, and the chat's scratch folder.
// The name is read from the machine (HIVE_USER_NAME overrides it, for tests) and is never printed.
const genericNames = new Set(["user", "users", "admin", "administrator", "root", "runner", "ubuntu", "vscode", "node", "default", "public", "guest"]);
function userName() {
  let n = process.env.HIVE_USER_NAME;
  if (n === undefined) {
    try { n = userInfo().username; } catch { n = ""; }
  }
  n = (n ?? "").trim();
  return n.length >= 3 && !genericNames.has(n.toLowerCase()) ? n : "";
}
const me = userName();
// A path holding the user name only warns (the ruling of 2026-11-20, "Warn only, everywhere"). This rule is a CHECK at a save
// and at a push (exit 2, the save or the push goes on); a real secret beside it still stops both.
const USER_PATH = "a path that holds the user name of this computer";
const WARN_ONLY = new Set([USER_PATH]);
if (me) {
  const esc = me.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  rules.push([USER_PATH, new RegExp("[\\\\/](?:Users|home)[\\\\/]+" + esc + "(?![A-Za-z0-9_-])", "gi")]);
}
rules.push(["a path into the chat's scratch folder", /AppData[\\/]+Local[\\/]+Temp[\\/]+claude/gi]);

let namesChecked = false;
if (existsSync(namesFile)) {
  namesChecked = true;
  for (const raw of readFileSync(namesFile, "utf8").split(/\r?\n/)) {
    const n = raw.trim();
    if (n.length >= 3 && !n.startsWith("#")) {
      rules.push(["a protected name", new RegExp("(?<![A-Za-z])" + n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?![A-Za-z])", "gi")]);
    }
  }
}

// An email address: something before the @, and a domain with a dot and letters after it.
// Found by looking at each @, which is far faster than a pattern that starts at every letter.
function emailIndexes(text) {
  const out = [];
  for (let i = text.indexOf("@"); i !== -1; i = text.indexOf("@", i + 1)) {
    if (i === 0 || !/[A-Za-z0-9._%+-]/.test(text[i - 1])) continue;
    const domain = /^[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.exec(text.slice(i + 1, i + 256));
    if (domain && !RESERVED_DOMAIN.test(domain[0])) out.push(i);
  }
  return out;
}
// Addresses at domains that are set aside for examples and tests belong to nobody.
const RESERVED_DOMAIN = /(^|\.)(example(\.(com|org|net))?|invalid|test|localhost)$/i;

// Files that are programs get the stricter assignment rule.
const CODE_EXT = /\.(mjs|cjs|js|jsx|ts|tsx|css|scss|html?|svg|sh|bash|py|rb|go|java|rs|c|cc|cpp|h|swift|kt|php|sql|vue|svelte|astro)$/i;
const isCode = (rel) => CODE_EXT.test(rel);

// Known test files that hold made-up keys on purpose (to test a detector). One line each: path | rule name.
// Read from the notebook being checked, so a change to the list shows in the save. Only that rule is
// allowed in that file; every other rule still applies there.
const ALLOW_FILE = "core/guard/allowed-fixtures.txt";
function loadAllowed() {
  const map = new Map();
  const p = join(root, ALLOW_FILE);
  if (!existsSync(p)) return map;
  for (const raw of readFileSync(p, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const [file, rule] = line.split("|").map((s) => s.trim());
    if (!file || !rule) continue;
    if (!map.has(file)) map.set(file, new Set());
    map.get(file).add(rule);
  }
  return map;
}
const allowed = loadAllowed();
let allowedHits = 0;
const isAllowed = (rel, name) => {
  const ok = allowed.get(rel)?.has(name) ?? false;
  if (ok) allowedHits++;
  return ok;
};

// ---- what is skipped -------------------------------------------------------------------------
const GENERATED = /(^|\/)(node_modules|\.git|\.next|\.turbo|\.vercel)\/|(^|\/)(package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock)$/;
const BINARY_EXT = /\.(png|jpe?g|gif|webp|avif|ico|bmp|tiff?|psd|pdf|zip|gz|tgz|bz2|xz|7z|rar|woff2?|ttf|otf|eot|mp3|mp4|m4a|mov|wav|ogg|webm|mkv|flac|exe|dll|so|dylib|wasm|class|jar|pyc|node|bin|sqlite)$/i;
const SELF = new Set(["core/guard/privacy-guard.ps1"]);
const skipByName = (rel) => GENERATED.test(rel) || BINARY_EXT.test(rel) || SELF.has(rel);
const looksBinary = (buf) => buf.subarray(0, 8000).includes(0);

// ---- reading ---------------------------------------------------------------------------------
const git = (a, opts = {}) =>
  execFileSync("git", ["-C", root, "-c", "core.quotepath=off", ...a], { encoding: "utf8", maxBuffer: 1024 * 1024 * 1024, ...opts });

// Every match of every rule in a piece of text: [{ name, index }]. Never holds the matched value.
function findings(text, rel, withEmail) {
  const out = [];
  const kind = isCode(rel) ? "code" : "notes";
  for (const [name, re, only] of rules) {
    if (only && only !== kind) continue;
    for (const m of text.matchAll(re)) if (!isAllowed(rel, name)) out.push({ name, index: m.index });
  }
  if (withEmail) {
    // A file listed as "path | email" holds an address its owner chose to make public.
    const at = emailIndexes(text);
    if (at.length && !isAllowed(rel, "email")) for (const index of at) out.push({ name: "email", index });
  }
  return out;
}
// Line number (1-based) of a character position, with the line starts worked out once per file.
function lineMaker(text) {
  let starts = null;
  return (index) => {
    if (!starts) {
      starts = [0];
      for (let i = text.indexOf("\n"); i !== -1; i = text.indexOf("\n", i + 1)) starts.push(i + 1);
    }
    let lo = 0, hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= index) lo = mid; else hi = mid - 1;
    }
    return lo + 1;
  };
}
const said = (hit) => (hit.name === "email" ? null : `looks like: ${hit.name} (value hidden)`);

// ---- the three modes -------------------------------------------------------------------------
async function scanTree() {
  const files = git(["ls-files", "-co", "--exclude-standard"]).split("\n").filter((f) => f && !skipByName(f));
  const stop = [], check = [], tooBig = [];
  // Read many files at once: waiting on the disk, not the matching, is what takes the time.
  const results = new Array(files.length);
  let next = 0;
  const worker = async () => {
    for (let i = next++; i < files.length; i = next++) results[i] = await readFile(join(root, files[i])).catch(() => null);
  };
  await Promise.all(Array.from({ length: 32 }, worker));
  files.forEach((rel, i) => {
    const buf = results[i];
    if (!buf || buf.length === 0) return;
    if (buf.length > MAX_BYTES) { tooBig.push(rel); return; }
    if (looksBinary(buf)) return;
    const text = buf.toString("utf8");
    const line = lineMaker(text);
    const seen = new Set();
    for (const h of findings(text, rel, !rel.startsWith(PRIVATE_DIR))) {
      const key = `${h.name}@${line(h.index)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (h.name === "email") check.push(`${rel}:${line(h.index)} - an email address outside your private notes (me/)`);
      else if (WARN_ONLY.has(h.name)) check.push(`${rel}:${line(h.index)} - ${h.name} (a warning: the save goes on)`);
      else stop.push(`${rel}:${line(h.index)} - ${said(h)}`);
    }
  });
  const notes = [];
  if (!namesChecked) notes.push("protected names not checked here: the list lives only on the PC");
  if (allowedHits) notes.push(`${allowedHits} made-up keys in known test files let through, listed in ${ALLOW_FILE}`);
  for (const rel of tooBig) notes.push(`not read, too large: ${rel}`);
  return { stop, check, notes };
}

// Reads the added lines of a patch from `git log -p -U0`; commits start with a \x01 line.
// A warn-only finding (WARN_ONLY) goes in warn, never in stop.
function scanPatch(patch) {
  const stop = [], warn = [];
  let commit = "", file = null, lineNo = 0;
  for (const raw of patch.split("\n")) {
    if (raw.startsWith("\x01")) { commit = raw.slice(1).trim(); file = null; continue; }
    if (raw.startsWith("+++ ")) { file = raw.startsWith("+++ b/") ? raw.slice(6) : null; continue; }
    if (raw.startsWith("--- ") || raw.startsWith("diff ")) continue;
    const hunk = /^@@ -\S+ \+(\d+)/.exec(raw);
    if (hunk) { lineNo = Number(hunk[1]); continue; }
    if (!raw.startsWith("+") || file === null) continue;
    const here = lineNo++;
    if (skipByName(file)) continue;
    const seen = new Set();
    for (const h of findings(raw.slice(1).replace(/\r$/, ""), file, false)) {
      if (seen.has(h.name)) continue;
      seen.add(h.name);
      if (WARN_ONLY.has(h.name)) warn.push(`${commit} ${file}:${here} - ${h.name} (a warning: the push goes on)`);
      else stop.push(`${commit} ${file}:${here} - ${said(h)}`);
    }
  }
  return { stop, warn };
}

function runPush() {
  const input = readFileSync(0, "utf8").split("\n").filter(Boolean);
  const zero = /^0+$/;
  const stop = [], warn = [];
  for (const row of input) {
    const [, local, , remote] = row.trim().split(/\s+/);
    if (!local || zero.test(local)) continue; // a delete sends nothing
    let range = [local, "--not", "--remotes"];
    if (remote && !zero.test(remote)) {
      try { git(["cat-file", "-e", `${remote}^{commit}`], { stdio: "ignore" }); range = [`${remote}..${local}`]; } catch { /* the remote's commit is not here: read everything not yet on a remote */ }
    }
    const found = scanPatch(git(["log", "-p", "-U0", "--no-merges", "--no-ext-diff", "--no-textconv", "--format=%x01%h", ...range]));
    stop.push(...found.stop); warn.push(...found.warn);
  }
  if (stop.length) {
    console.log("PRIVACY GUARD: STOP. This push would send these. Do not push. Remove them from the saves first:");
    stop.forEach((s) => console.log(s));
    warn.forEach((s) => console.log(s));
    process.exit(1);
  }
  // A user-name path warns at a push too (exit 2: the push hooks
  // let it through and show the warning).
  if (warn.length) {
    console.log("PRIVACY GUARD: CHECK. The saves about to be sent hold these:");
    warn.forEach((s) => console.log(s));
    process.exit(2);
  }
  console.log("PRIVACY GUARD: the saves about to be sent are clean");
}

function runUnchecked() {
  const gitdir = git(["rev-parse", "--absolute-git-dir"]).trim();
  const logFile = join(gitdir, LOG_NAME);
  if (!existsSync(logFile)) {
    console.log("PRIVACY GUARD: no record of checked saves in this copy yet. The record starts at the first save that goes through the check.");
    process.exit(0);
  }
  const rows = readFileSync(logFile, "utf8").split("\n").filter(Boolean);
  const since = (rows.find((r) => r.startsWith("since ")) ?? "").slice(6).trim();
  const checked = new Set(rows.filter((r) => !r.startsWith("since ")).map((r) => r.split(" ")[0]));
  const list = git(["log", "--no-merges", "--branches", ...(since ? [`--since=${since}`] : []), "--format=%H%x01%T%x01%h%x01%cs%x01%s"])
    .split("\n").filter(Boolean).map((l) => l.split("\x01"));
  const missed = list.filter(([, tree]) => !checked.has(tree));
  if (!missed.length) {
    console.log(`PRIVACY GUARD: every save since ${since || "the record began"} went through the check`);
    process.exit(0);
  }
  let anyStop = false;
  console.log(`PRIVACY GUARD: ${missed.length} save${missed.length === 1 ? " was" : "s were"} made without the privacy check (a save made with --no-verify, or by a tool that skips it). Read now:`);
  for (const [hash, , short, day, subject] of missed.slice(0, 25)) {
    const { stop: found, warn } = scanPatch(git(["show", "-U0", "--no-ext-diff", "--no-textconv", "--format=%x01%h", hash]));
    if (found.length) anyStop = true;
    const warned = warn.length ? ` (a warning: ${warn.join("; ")})` : "";
    console.log(`  ${short} ${day} "${subject}": ${found.length ? "it holds something the check stops: " + found.join("; ") : "nothing the check would stop"}${warned}`);
  }
  if (missed.length > 25) console.log(`  ...and ${missed.length - 25} older ones`);
  process.exit(anyStop ? 1 : 3);
}

if (mode === "push") runPush();
else if (mode === "unchecked") runUnchecked();
else {
  const { stop, check, notes } = await scanTree();
  const note = notes.length ? ` (${notes.join("; ")})` : "";
  if (stop.length) {
    console.log("PRIVACY GUARD: STOP. Do not save or push. Remove these first:");
    stop.forEach((s) => console.log(s));
    process.exit(1);
  }
  if (check.length) {
    console.log("PRIVACY GUARD: CHECK. Personal details found in the shareable part:");
    check.forEach((s) => console.log(s));
    process.exit(2);
  }
  console.log(`PRIVACY GUARD: CLEAN${note}`);
}
