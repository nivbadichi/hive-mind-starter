#!/usr/bin/env node
/**
 * Hive Mind snapshot: reads the notebook and writes the ONE file your page may show,
 * app/src/data/snapshot.json. Plain Node, no dependencies.
 *
 *   node system/snapshot.mjs                 the notebook this file lives in
 *   node system/snapshot.mjs --root <dir>    another notebook (used by the test)
 *   node system/snapshot.mjs --out <file>    write somewhere else
 *
 * It takes exactly these fields and nothing else: generatedAt, notebookCommit, inSync, map,
 * nextStep, projects, needsYou, decisionsInForce, rulesCount, log, brief (the newest brief, parsed),
 * ledger (the newest 14 lines, parsed; never a file name), whatLeaves (the table in
 * system/what-leaves.md), health.
 *
 * Privacy, by construction:
 *  - every read goes through readText/listDir, which refuse the DENYLIST and anything outside
 *    the notebook, and throw (the script then stops with exit code 1);
 *  - a project's state note is read only up to the end of its front matter, so no note body,
 *    and never an employer's, is ever read from disk;
 *  - every text field is cut at 400 characters.
 */
import { spawnSync } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

/** Never read, whatever asks. A folder entry ends in "/". */
export const DENYLIST = Object.freeze(["me/", "archive/", "system/design/", "system/lessons.md", "system/decisions.md"]);

export const MAX_TEXT = 400;
const SNAPSHOT_REL = "app/src/data/snapshot.json";

/* ---------- Guarded access ---------- */

/** The notebook-relative path, with forward slashes, or a thrown error if it is refused. */
export function guard(root, rel) {
  const abs = resolve(root, rel);
  const r = relative(resolve(root), abs);
  if (r === "" ) return "";
  if (r.startsWith("..") || isAbsolute(r)) throw new Error(`Refused: "${rel}" is outside the notebook.`);
  const norm = r.split(sep).join("/");
  const lower = norm.toLowerCase();
  for (const d of DENYLIST) {
    const bare = d.replace(/\/$/, "");
    if (lower === bare || lower.startsWith(d.endsWith("/") ? d : `${d}/`)) {
      throw new Error(`Refused: "${norm}" is on the snapshot's denylist (${d}). Nothing there may be read.`);
    }
  }
  return norm;
}

function readText(root, rel) {
  const norm = guard(root, rel);
  return stripBom(readFileSync(join(root, norm), "utf8"));
}

function listDir(root, rel) {
  const norm = guard(root, rel);
  const abs = join(root, norm);
  if (!existsSync(abs)) return [];
  return readdirSync(abs);
}

function exists(root, rel) {
  return existsSync(join(root, guard(root, rel)));
}

/**
 * Reads a state note only as far as the end of its front matter, in small chunks, and stops there.
 * Returns the front matter text (without the --- lines), or null when there is none.
 */
export function readFrontMatterOnly(root, rel) {
  const norm = guard(root, rel);
  const fd = openSync(join(root, norm), "r");
  try {
    const chunk = Buffer.alloc(256);
    let text = "";
    let pos = 0;
    while (text.length < 8192) {
      const n = readSync(fd, chunk, 0, chunk.length, pos);
      if (n === 0) break;
      pos += n;
      text += chunk.subarray(0, n).toString("utf8");
      const t = stripBom(text).replace(/\r\n/g, "\n");
      if (!t.startsWith("---\n")) return null;
      const end = t.indexOf("\n---", 3);
      if (end !== -1) return t.slice(4, end);
    }
    return null;
  } finally {
    closeSync(fd);
  }
}

/* ---------- Small helpers ---------- */

function stripBom(s) {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

export function cut(s) {
  if (typeof s !== "string") return s;
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > MAX_TEXT ? `${t.slice(0, MAX_TEXT - 1)}…` : t;
}

const noTicks = (s) => s.replace(/`/g, "");

function lines(text) {
  return text.replace(/\r\n/g, "\n").split("\n");
}

/** The lines under "## <name>", up to the next "## " heading. */
function section(text, name) {
  const all = lines(text);
  const at = all.findIndex((l) => l.trim().toLowerCase() === `## ${name}`.toLowerCase());
  if (at === -1) return null;
  const out = [];
  for (let i = at + 1; i < all.length; i++) {
    if (/^##\s/.test(all[i])) break;
    out.push(all[i]);
  }
  return out;
}

const bullet = (l) => l.match(/^\s*[-*]\s+(.*\S)\s*$/)?.[1] ?? null;

/** "Nothing yet." and friends mean there is nothing to ask. */
export function isEmptyAsk(v) {
  if (v == null) return true;
  return /^\s*(nothing( yet)?|none|n\/a|-)?\s*\.?\s*$/i.test(String(v));
}

/* ---------- The parts ---------- */

export function parseFrontMatter(fm) {
  const out = {};
  for (const l of lines(fm)) {
    const m = l.match(/^([A-Za-z_][\w-]*):\s?(.*)$/);
    if (m) out[m[1].toLowerCase()] = m[2].trim();
  }
  return out;
}

/**
 * Open questions of a project: repeated `question:` lines in the note's header.
 * `question: <the question> | choices: A; B | by: 2026-11-17 23:59 | waits: <what waits on it> | asked: 2026-11-16`
 * Only the question itself is required.
 */
export function parseQuestions(fm) {
  const out = [];
  for (const l of lines(fm)) {
    const m = l.match(/^question:\s*(.*\S)\s*$/i);
    if (!m) continue;
    const [text, ...rest] = m[1].split(/\s+\|\s+/);
    if (!text) continue;
    const q = { text: cut(text) };
    for (const part of rest) {
      const kv = part.match(/^(choices|by|waits|asked):\s*(.*\S)\s*$/i);
      if (!kv) continue;
      const k = kv[1].toLowerCase();
      if (k === "choices") {
        const list = kv[2].split(/\s*;\s*/).map((c) => cut(c)).filter(Boolean).slice(0, 4);
        if (list.length) q.choices = list;
      } else q[k] = cut(kv[2]);
    }
    out.push(q);
  }
  return out;
}

/**
 * Answers and notes the user gave on their page: lines in inbox/answers.md.
 * `- [ ] when | answer or note | project | the question | what they said` and, once Claude has acted,
 * `- [x] ... | done: what Claude did`. Only the newest 30 are carried.
 */
export function parseAnswers(text) {
  const out = [];
  for (const l of lines(text)) {
    const m = l.match(/^\s*-\s\[( |x|X)\]\s+(.*\S)\s*$/);
    if (!m) continue;
    const parts = m[2].split(/\s+\|\s+/);
    if (parts.length < 5) continue;
    const [at, kind, project, question, ...rest] = parts;
    let did = null;
    if (rest.length > 1 && /^done:/i.test(rest[rest.length - 1])) did = rest.pop().replace(/^done:\s*/i, "");
    out.push({
      at: cut(at),
      kind: /^note$/i.test(kind) ? "note" : "answer",
      project: cut(project),
      question: cut(question),
      answer: cut(rest.join(" | ")),
      done: m[1] !== " ",
      ...(did ? { did: cut(did) } : {}),
    });
  }
  return out.slice(-30);
}

function readProjects(root, warn) {
  const projects = [];
  const order = new Map();
  for (const id of listDir(root, "projects").sort()) {
    const rel = `projects/${id}/state.md`;
    try {
      if (!statSync(join(root, guard(root, `projects/${id}`))).isDirectory() || !exists(root, rel)) continue;
      const fm = readFrontMatterOnly(root, rel);
      if (fm == null) {
        warn(`projects/${id}/state.md has no front matter; left out.`);
        continue;
      }
      const f = parseFrontMatter(fm);
      if (!f.project && !f.kind && !f.stage) {
        warn(`projects/${id}/state.md has no usable fields; left out.`);
        continue;
      }
      const employer = /^employer\b/i.test(f.kind ?? "");
      const p = {
        id,
        project: cut(f.project ?? id),
        kind: cut(f.kind ?? null),
        stage: cut(f.stage ?? null),
        health: cut(f.health ?? null),
        nextStep: cut(f.next_step ?? null),
        needsYou: isEmptyAsk(f.needs_you) ? null : cut(f.needs_you),
        updated: cut(f.updated ?? null),
      };
      const questions = parseQuestions(fm);
      if (questions.length) p.questions = questions;
      if (employer) p.protected = true;
      order.set(id, /^\d+$/.test(f.order ?? "") ? Number(f.order) : 9999);
      projects.push(p);
    } catch (e) {
      if (String(e.message).startsWith("Refused")) throw e;
      warn(`projects/${id}/state.md could not be read (${e.message}); left out.`);
    }
  }
  // Most important first: by the note's `order:` line (1 = most important), then by folder name.
  return projects.sort((a, b) => order.get(a.id) - order.get(b.id) || a.id.localeCompare(b.id));
}

export function parseMap(text) {
  const sec = section(text, "Progress map");
  if (!sec) return [];
  const line = sec.map((l) => l.match(/`([^`]*\[[^`]*)`/)?.[1]).find(Boolean) ?? sec.find((l) => l.includes("["));
  if (!line) return [];
  const steps = [];
  const re = /(►\s*)?\[([^\]]*)\]/g;
  let m;
  while ((m = re.exec(line))) {
    const raw = m[2];
    const done = raw.includes("✓");
    const label = cut(raw.replace(/✓/g, " "));
    if (!label) continue;
    steps.push({ label, state: m[1] ? "current" : done ? "done" : "waiting" });
  }
  return steps;
}

export function parseNextStep(text) {
  const sec = section(text, "Exact next step");
  if (!sec) return null;
  const para = [];
  for (const l of sec) {
    if (!l.trim()) {
      if (para.length) break;
      continue;
    }
    para.push(l.trim());
  }
  return para.length ? cut(noTicks(para.join(" "))) : null;
}

function parseOpen(text) {
  const sec = section(text, "Open, waiting for the user") ?? [];
  return sec.map(bullet).filter(Boolean).map((t) => ({ project: "Hive Mind", text: cut(noTicks(t)) }));
}

export function parseDecisions(text) {
  const out = [];
  let cur = null;
  for (const l of lines(text)) {
    const h = l.match(/^##\s+(.*\S)/);
    if (h) {
      cur = { heading: cut(h[1]), items: [] };
      out.push(cur);
      continue;
    }
    const b = bullet(l);
    if (b && cur) cur.items.push(cut(noTicks(b)));
  }
  return out;
}

export function countRules(text) {
  return lines(text).filter((l) => /^\s*\d+\.\s+\S/.test(l)).length;
}

function readLog(root) {
  const files = listDir(root, "log")
    .map((name) => ({ name, date: name.match(/^(\d{4}-\d{2}-\d{2})/)?.[1] }))
    .filter((f) => f.date && f.name.endsWith(".md"))
    .sort((a, b) => (a.date === b.date ? b.name.localeCompare(a.name) : b.date.localeCompare(a.date)));
  const out = [];
  for (const f of files) {
    // Within a day, the last line written is the newest.
    const items = lines(readText(root, `log/${f.name}`)).map(bullet).filter(Boolean).reverse();
    for (const t of items) {
      out.push({ date: f.date, text: cut(noTicks(t)) });
      if (out.length >= 30) return out;
    }
  }
  return out;
}

/* ---------- The morning brief ---------- */

/** The brief's parts, in the order the daily run writes them (core/engine/brief.md). */
export const BRIEF_PARTS = Object.freeze([
  ["needsYou", "Needs you"],
  ["moves", "Today's best moves"],
  ["deadlines", "Deadlines this week"],
  ["away", "While you were away"],
  ["found", "Found, not touched"],
  // The evening brief's own two parts.
  ["done", "Done today"],
  ["tomorrow", "Tomorrow's best moves"],
]);

const BRIEF_LABEL = new Map(BRIEF_PARTS.map(([k, label]) => [label.toLowerCase().replace(/[’']/g, "'"), k]));

/**
 * One brief note, parsed: its title, and each part as a list of lines (numbers and bullets
 * dropped). A part that is missing is simply absent; an unknown bold label ends the part before it.
 */
export function parseBrief(text, date, kind = "morning") {
  const out = { date, kind, title: null, parts: {} };
  let cur = null;
  for (const raw of lines(text)) {
    const l = raw.trim();
    if (!l) continue;
    const h = l.match(/^#\s+(.*\S)/);
    if (h && !out.title) {
      out.title = cut(noTicks(h[1]));
      continue;
    }
    const b = l.match(/^\*\*(.+?)\*\*\s*:?\s*(.*)$/);
    if (b) {
      const key = BRIEF_LABEL.get(b[1].trim().replace(/:$/, "").toLowerCase().replace(/[’']/g, "'")) ?? null;
      cur = key;
      if (key && !out.parts[key]) out.parts[key] = [];
      if (key && b[2]) out.parts[key].push(cut(noTicks(b[2])));
      continue;
    }
    if (!cur || /^#/.test(l)) continue;
    const item = l.replace(/^(\d+[.)]|[-*])\s+/, "");
    if (item) out.parts[cur].push(cut(noTicks(item)));
  }
  for (const [k, v] of Object.entries(out.parts)) if (!v.length) delete out.parts[k];
  return out;
}

/**
 * The newest brief, parsed, or null when there is none. A day has a morning brief
 * (brief/<date>.md) and an evening one (brief/<date>-evening.md); the evening one is the newer.
 */
function readBrief(root) {
  const newest = listDir(root, "brief")
    .filter((n) => /^\d{4}-\d{2}-\d{2}(-evening)?\.md$/.test(n))
    .sort((a, b) => a.replace(".md", "-a").localeCompare(b.replace(".md", "-a")))
    .at(-1);
  if (!newest) return null;
  return parseBrief(readText(root, `brief/${newest}`), newest.slice(0, 10), newest.includes("-evening") ? "evening" : "morning");
}

/* ---------- The ledger ---------- */

const n = (s) => (s == null ? null : s.trim());

/**
 * One ledger line, in plain parts. PC sessions: how many, and the tokens. A daily run: how long,
 * how many notes it changed (the count, never the file names), and whether tokens were measured.
 * Anything else keeps only its date and its words.
 */
export function parseLedgerLine(line) {
  const m = line.match(/^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2})(?::\d{2})?\s*(?:UTC)?)?\s*,\s*([^:]+):\s*(.*)$/i);
  if (!m) return null;
  const [, date, time, kindRaw, rest] = m;
  const kind = kindRaw.trim().toLowerCase();
  if (kind === "pc sessions") {
    return {
      date,
      time: time ?? null,
      kind: "sessions",
      sessions: Number(rest.match(/(\d+)\s+sessions?/i)?.[1] ?? NaN) || null,
      tokensIn: n(rest.match(/([\d.]+\s*[kKmMbB]?)\s+new tokens in/)?.[1]),
      tokensCached: n(rest.match(/([\d.]+\s*[kKmMbB]?)\s+reread from cache/)?.[1]),
      tokensOut: n(rest.match(/([\d.]+\s*[kKmMbB]?)\s+out\b/)?.[1]),
    };
  }
  if (kind === "daily run") {
    const changed = (rest.match(/Changed:\s*(.*?)\.\s*Tokens:/i)?.[1] ?? rest.match(/Changed:\s*(.*?)\.?\s*$/i)?.[1] ?? "").trim();
    const tokens = rest.match(/Tokens:\s*(.*?)\.?\s*$/i)?.[1]?.trim() ?? null;
    const notes = changed
      .split(/,(?![^(]*\))/)
      .map((s) => s.trim())
      .filter((s) => s && !/^nothing$/i.test(s));
    return {
      date,
      time: time ?? null,
      kind: "run",
      seconds: Number(rest.match(/(\d+)\s+seconds?/i)?.[1] ?? NaN) || null,
      changed: notes.length,
      tokens: tokens && !/not measured/i.test(tokens) ? cut(tokens) : null,
    };
  }
  return { date, time: time ?? null, kind: "other", what: cut(kindRaw), text: cut(noTicks(rest)) };
}

/** The newest ledger lines, newest first, at most 14. */
function readLedger(root) {
  const files = listDir(root, "ledger")
    .filter((n) => /^\d{4}-\d{2}\.md$/.test(n))
    .sort()
    .reverse();
  const out = [];
  for (const f of files) {
    const items = lines(readText(root, `ledger/${f}`)).map(bullet).filter(Boolean).map(parseLedgerLine).filter(Boolean);
    // Newest first: by date and time, and within the same moment the line written last.
    items.reverse().sort((a, b) => `${b.date} ${b.time ?? "99:99"}`.localeCompare(`${a.date} ${a.time ?? "99:99"}`));
    for (const it of items) {
      out.push(it);
      if (out.length >= 14) return out;
    }
  }
  return out;
}

/* ---------- What leaves the PC ---------- */

/** The table (What | Where it goes | When) and the "Stays on your computer" (or "Stays on the PC") line. */
export function parseWhatLeaves(text) {
  const rows = [];
  let stays = null;
  let header = false;
  for (const raw of lines(text)) {
    const l = raw.trim();
    const s = l.match(/^stays on (?:the pc|your computer)\s*:\s*(.*\S)/i);
    if (s) {
      stays = cut(noTicks(s[1]));
      continue;
    }
    if (!l.startsWith("|")) continue;
    const cells = l.replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
    if (cells.every((c) => /^:?-{2,}:?$/.test(c))) continue;
    if (!header) {
      header = true;
      continue;
    }
    if (cells.length < 3 || !cells[0]) continue;
    rows.push({ what: cut(noTicks(cells[0])), where: cut(noTicks(cells[1])), when: cut(noTicks(cells[2])) });
  }
  return { rows, stays };
}

/* ---------- Git and the health check ---------- */

function git(root, args) {
  const r = spawnSync("git", ["-C", root, ...args], { encoding: "utf8", timeout: 20_000 });
  if (r.error || r.status !== 0) return null;
  return r.stdout;
}

export function parseSync(sb, snapshotRel = SNAPSHOT_REL) {
  if (sb == null) return { inSync: false, reason: "not a git repository, or git is missing" };
  const [head, ...rest] = lines(sb).filter((l) => l.trim());
  const why = [];
  if (!head || !head.startsWith("##")) return { inSync: false, reason: "git status gave no branch line" };
  if (!head.includes("...")) why.push("no link to GitHub");
  const ahead = head.match(/ahead (\d+)/)?.[1];
  const behind = head.match(/behind (\d+)/)?.[1];
  if (ahead) why.push(`${ahead} commit${ahead === "1" ? "" : "s"} not on GitHub yet`);
  if (behind) why.push(`${behind} commit${behind === "1" ? "" : "s"} behind GitHub`);
  // The snapshot itself changes every run; it does not count as unsaved notebook work.
  const dirty = rest.filter((l) => !l.slice(3).replace(/"/g, "").endsWith(snapshotRel));
  if (dirty.length) why.push(`${dirty.length} unsaved change${dirty.length === 1 ? "" : "s"}`);
  return why.length ? { inSync: false, reason: why.join(", ") } : { inSync: true };
}

export function parseHealth(out) {
  const all = lines(out ?? "");
  // Item lines are "NEEDS YOU   <what>"; the summary is "NEEDS YOU: 1 of 46 checks. 45 passed."
  const needsYou = all.map((l) => l.match(/^NEEDS YOU(?!:)\s+(.*\S)/)?.[1]).filter(Boolean).map(cut);
  const ok = all.filter((l) => /^OK\s/.test(l)).length;
  const fine = all.map((l) => l.match(/^ALL FINE:\s*(\d+) of (\d+) checks? passed/i)).find(Boolean);
  if (fine) return { passed: Number(fine[1]), total: Number(fine[2]), needsYou, ok };
  const some = all.map((l) => l.match(/^NEEDS YOU:\s*(\d+) of (\d+) checks?\.\s*(\d+) passed/i)).find(Boolean);
  if (some) return { passed: Number(some[3]), total: Number(some[2]), needsYou, ok };
  return null;
}

function runHealth(root) {
  const rel = "system/check.ps1";
  if (!exists(root, rel)) return { status: "not checked", reason: "system/check.ps1 was not found" };
  const path = join(root, guard(root, rel));
  const attempts = [
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path],
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", `& '${path.replace(/'/g, "''")}'`],
  ];
  let last = "";
  for (const args of attempts) {
    const r = spawnSync("powershell", args, { cwd: root, encoding: "utf8", timeout: 180_000, windowsHide: true });
    if (r.error) {
      last = r.error.code === "ENOENT" ? "PowerShell is not available here" : r.error.message;
      continue;
    }
    const h = parseHealth(r.stdout);
    if (h) return { passed: h.passed, total: h.total, needsYou: h.needsYou, checkedAt: new Date().toISOString() };
    last = cut((r.stderr || r.stdout || "no output").split(/\r?\n/).find((l) => l.trim()) ?? "no output");
  }
  return { status: "not checked", reason: cut(`the health check could not be run: ${last}`) };
}

/* ---------- The whole snapshot ---------- */

export function buildSnapshot(root, { health = true, warn = (m) => process.stderr.write(`snapshot: ${m}\n`) } = {}) {
  const startHere = exists(root, "system/start-here.md") ? readText(root, "system/start-here.md") : "";
  const projects = readProjects(root, warn);
  const sb = git(root, ["status", "-sb"]);
  const commit = git(root, ["rev-parse", "--short", "HEAD"]);
  const sync = parseSync(sb);

  const snap = {
    generatedAt: new Date().toISOString(),
    notebookCommit: commit ? commit.trim() : null,
    inSync: sync.inSync ? true : { inSync: false, reason: cut(sync.reason) },
    map: parseMap(startHere),
    nextStep: parseNextStep(startHere),
    projects,
    needsYou: [
      ...projects.flatMap((p) =>
        p.questions ? p.questions.map((q) => ({ project: p.project, ...q })) : p.needsYou ? [{ project: p.project, text: p.needsYou }] : [],
      ),
      ...parseOpen(startHere),
    ],
    answers: exists(root, "inbox/answers.md") ? parseAnswers(readText(root, "inbox/answers.md")) : [],
    decisionsInForce: exists(root, "system/decisions-in-force.md") ? parseDecisions(readText(root, "system/decisions-in-force.md")) : [],
    rulesCount: exists(root, "system/rules.md") ? countRules(readText(root, "system/rules.md")) : 0,
    log: readLog(root),
    brief: readBrief(root),
    ledger: readLedger(root),
    whatLeaves: exists(root, "system/what-leaves.md") ? parseWhatLeaves(readText(root, "system/what-leaves.md")) : { rows: [], stays: null },
    health: health ? runHealth(root) : { status: "not checked", reason: "skipped on request" },
  };
  return snap;
}

/* ---------- Command line ---------- */

function arg(name) {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
}

function main() {
  const here = dirname(fileURLToPath(import.meta.url));
  const root = resolve(arg("--root") ?? join(here, ".."));
  const out = resolve(arg("--out") ?? join(root, SNAPSHOT_REL));
  const snap = buildSnapshot(root, { health: !process.argv.includes("--no-health") });
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(snap, null, 2)}\n`, "utf8");
  const h = snap.health.status ? `health not checked (${snap.health.reason})` : `health ${snap.health.passed} of ${snap.health.total}`;
  process.stdout.write(`Snapshot written: ${relative(process.cwd(), out) || out} · ${snap.projects.length} projects · ${snap.log.length} log lines · ${h}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (e) {
    process.stderr.write(`SNAPSHOT STOPPED: ${e.message}\n`);
    process.exit(1);
  }
}
