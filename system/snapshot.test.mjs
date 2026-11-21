/**
 * Tests for the snapshot: node --test system/snapshot.test.mjs
 * Each test builds a tiny fake notebook in a temp folder, so the real notebook is never read.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { DENYLIST, MAX_TEXT, buildSnapshot, guard, parseBrief, parseHealth, parseLedgerLine, parseSync, parseWhatLeaves, readFrontMatterOnly } from "./snapshot.mjs";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "snapshot.mjs");
let root;

function put(rel, text) {
  const p = join(root, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, text, "utf8");
}

const note = (fields, body = "") => `---\n${Object.entries(fields).map(([k, v]) => `${k}: ${v}`).join("\n")}\n---\n${body}`;

before(() => {
  root = mkdtempSync(join(tmpdir(), "hive-snapshot-"));
  put("me/context-map.md", "MESECRET: who they are.\n");
  put("archive/old.md", "ARCHIVESECRET\n");
  put("system/lessons.md", "- LESSONSECRET\n");
  put("system/decisions.md", "- HISTORYSECRET\n");
  put("system/design/plan.md", "DESIGNSECRET\n");
  put(
    "system/start-here.md",
    [
      "# Start here",
      "",
      "## Progress map",
      "",
      "`[ Audit ✓ ] [ Design ✓ approved ] ► [ Slice 3: step 4 of 8 done ] [ Slice 4: engine ]`",
      "",
      "## Exact next step",
      "",
      "Wire the `dashboard` to the notebook.",
      "Second line of the same paragraph.",
      "",
      "A second paragraph that must not appear.",
      "",
      "## Open, waiting for the user",
      "",
      "- Names for the protected list.",
      "- A very long open item " + "x".repeat(600),
      "",
      "## Avoid",
      "",
      "- Not an open item.",
    ].join("\n"),
  );
  put("system/decisions-in-force.md", "# Decisions in force\n\n## How we work\n- One.\n\n- Two.\n\n## Tools\n- Three.\n");
  put("system/rules.md", "# Rules\n\n1. First.\n2. Second.\n3. Third.\n");
  put("log/2026-11-14.md", "# Log\n\n- older line A\n- older line B\n");
  put("log/2026-11-15.md", "﻿# Log\n\n- first today\n- latest today\n");
  put("log/2026-11-10-daily-summary.md", "# Summary\n\nNot a bullet.\n- oldest line\n");
  put("log/notes.txt", "- not a log file\n");
  put(
    "projects/alpha/state.md",
    note({ project: "Alpha", kind: "personal", stage: "build (step 2)", health: "good", next_step: "Do the thing: carefully.", needs_you: "Your answer.", updated: "2026-11-15" }, "# Alpha\nPERSONALBODY\n"),
  );
  put(
    "projects/beta/state.md",
    note({ project: "Beta", kind: "personal", stage: "not set up", health: "unknown", next_step: "Wait.", needs_you: "Nothing yet.", updated: "2026-11-14" }),
  );
  put(
    "projects/work/state.md",
    note(
      { project: "Work thing", kind: "employer", folder: "~/work", stage: "design", health: "waiting", next_step: "Plan it.", needs_you: "A rule.", updated: "2026-11-14" },
      "# Work\n" + "SECRETBODY ".repeat(200) + "\n",
    ),
  );
  put("projects/broken/state.md", "no front matter here at all\nSECRETBROKEN\n");
  put("projects/halfopen/state.md", "---\nproject: Half\nSECRETNOEND\n");
  put("projects/empty-folder/readme.md", "not a state note\n");
  put("brief/2026-11-14.md", "# Brief, Saturday 14 November\n\n**Needs you**\n1. OLDBRIEF\n");
  put(
    "brief/2026-11-15.md",
    [
      "# Brief, Sunday 15 November",
      "",
      "**Needs you**",
      "1. Pick the `final` draft.",
      "2. Set the clock.",
      "",
      "**Today's best moves**",
      "1. Alpha: send the draft.",
      "",
      "**Deadlines this week**",
      "None written down yet.",
      "",
      "**While you were away**",
      "The repository was reorganised.",
      "",
      "**Found, not touched**",
      "- A stale note.",
    ].join("\n"),
  );
  put("brief/notes.txt", "not a brief\n");
  put("ledger/2026-10.md", "# Ledger 2026-10\n\n- 2026-10-31, PC sessions: 1 session, 10k new tokens in, 2.0M reread from cache, 3k out.\n");
  put(
    "ledger/2026-11.md",
    [
      "# Ledger 2026-11",
      "",
      "- 2026-11-14, PC sessions: 5 sessions, 2.4M new tokens in, 166.2M reread from cache, 417k out. By project: hive-mind 2.0M in / 294k out (2).",
      "- 2026-11-15 05:10:49 UTC, daily run: claude-haiku-5-5, 40 seconds. Changed: brief/2026-11-15.md, projects/alpha/state.md (date fixed), ledger/2026-11.md. Tokens: not measured.",
      "- 2026-11-15, backup: copied the notebook.",
      "Not a ledger line.",
    ].join("\n"),
  );
  put(
    "system/what-leaves.md",
    [
      "# What leaves the PC",
      "",
      "| What | Where it goes | When |",
      "|---|---|---|",
      "| The notes | GitHub, `private` | After every save |",
      "| Talk | Anthropic | While a session runs |",
      "",
      "Stays on the PC: the protected names.",
    ].join("\n"),
  );
});

after(() => rmSync(root, { recursive: true, force: true }));

test("produces every field, and only those", () => {
  const warnings = [];
  const s = buildSnapshot(root, { warn: (m) => warnings.push(m) });
  assert.deepEqual(Object.keys(s).sort(), ["answers", "brief", "decisionsInForce", "generatedAt", "health", "inSync", "ledger", "log", "map", "needsYou", "nextStep", "notebookCommit", "projects", "rulesCount", "whatLeaves"]);
  assert.ok(!Number.isNaN(Date.parse(s.generatedAt)));
  // The temp folder is not a git repository.
  assert.equal(s.notebookCommit, null);
  assert.equal(s.inSync.inSync, false);
  assert.match(s.inSync.reason, /git/);

  assert.deepEqual(s.map, [
    { label: "Audit", state: "done" },
    { label: "Design approved", state: "done" },
    { label: "Slice 3: step 4 of 8 done", state: "current" },
    { label: "Slice 4: engine", state: "waiting" },
  ]);
  assert.equal(s.nextStep, "Wire the dashboard to the notebook. Second line of the same paragraph.");

  assert.deepEqual(
    s.projects.map((p) => p.id),
    ["alpha", "beta", "work"],
  );
  const alpha = s.projects.find((p) => p.id === "alpha");
  assert.deepEqual(alpha, { id: "alpha", project: "Alpha", kind: "personal", stage: "build (step 2)", health: "good", nextStep: "Do the thing: carefully.", needsYou: "Your answer.", updated: "2026-11-15" });
  assert.equal(s.projects.find((p) => p.id === "beta").needsYou, null);

  assert.deepEqual(s.needsYou.slice(0, 2), [
    { project: "Alpha", text: "Your answer." },
    { project: "Work thing", text: "A rule." },
  ]);
  assert.equal(s.needsYou[2].project, "Hive Mind");
  assert.equal(s.needsYou[2].text, "Names for the protected list.");
  assert.equal(s.needsYou.length, 4, "the Avoid section is not an open item");

  assert.deepEqual(s.decisionsInForce, [
    { heading: "How we work", items: ["One.", "Two."] },
    { heading: "Tools", items: ["Three."] },
  ]);
  assert.equal(s.rulesCount, 3);
  assert.deepEqual(s.log, [
    { date: "2026-11-15", text: "latest today" },
    { date: "2026-11-15", text: "first today" },
    { date: "2026-11-14", text: "older line B" },
    { date: "2026-11-14", text: "older line A" },
    { date: "2026-11-10", text: "oldest line" },
  ]);
  assert.equal(s.health.status, "not checked");
  assert.match(s.health.reason, /check\.ps1/);
});

test("an employer note gives its header lines only, marked protected", () => {
  const s = buildSnapshot(root, { warn: () => {} });
  const work = s.projects.find((p) => p.id === "work");
  assert.deepEqual(work, {
    id: "work",
    project: "Work thing",
    kind: "employer",
    stage: "design",
    health: "waiting",
    nextStep: "Plan it.",
    needsYou: "A rule.",
    updated: "2026-11-14",
    protected: true,
  });
  // The reader stops at the end of the front matter: the body is never read from disk.
  const fm = readFrontMatterOnly(root, "projects/work/state.md");
  assert.ok(!fm.includes("SECRETBODY"));
  assert.ok(!fm.includes("# Work"));
});

test("nothing from me/, the archive, design, lessons, history or any note body reaches the output", () => {
  const s = buildSnapshot(root, { warn: () => {} });
  const out = JSON.stringify(s);
  for (const word of ["OLDBRIEF", "MESECRET", "ARCHIVESECRET", "LESSONSECRET", "HISTORYSECRET", "DESIGNSECRET", "SECRETBODY", "PERSONALBODY", "SECRETBROKEN", "SECRETNOEND", "~/work"]) {
    assert.ok(!out.includes(word), `${word} leaked into the snapshot`);
  }
});

test("the denylist refuses, loudly", () => {
  for (const rel of ["me/context-map.md", "me", "ME/x.md", "archive/old.md", "system/design/plan.md", "system/lessons.md", "system/decisions.md", "system/../me/x.md", "../outside.md"]) {
    assert.throws(() => guard(root, rel), /Refused/, rel);
  }
  assert.throws(() => readFrontMatterOnly(root, "me/context-map.md"), /Refused/);
  assert.equal(guard(root, "system/decisions-in-force.md"), "system/decisions-in-force.md");
  assert.ok(DENYLIST.includes("me/"));
});

test("malformed state notes are left out without a crash", () => {
  const warnings = [];
  const s = buildSnapshot(root, { warn: (m) => warnings.push(m) });
  assert.ok(!s.projects.some((p) => ["broken", "halfopen", "empty-folder"].includes(p.id)));
  assert.ok(warnings.some((w) => w.includes("broken")));
  assert.ok(warnings.some((w) => w.includes("halfopen")));
});

test("every text is cut at 400 characters", () => {
  const s = buildSnapshot(root, { warn: () => {} });
  const long = s.needsYou.find((n) => n.text.startsWith("A very long"));
  assert.equal(long.text.length, MAX_TEXT);
  assert.ok(long.text.endsWith("…"));
});

test("the newest brief is parsed into its parts, not kept as markdown", () => {
  const s = buildSnapshot(root, { warn: () => {} });
  assert.deepEqual(s.brief, {
    date: "2026-11-15",
    kind: "morning",
    title: "Brief, Sunday 15 November",
    parts: {
      needsYou: ["Pick the final draft.", "Set the clock."],
      moves: ["Alpha: send the draft."],
      deadlines: ["None written down yet."],
      away: ["The repository was reorganised."],
      found: ["A stale note."],
    },
  });
  assert.ok(!JSON.stringify(s.brief).includes("**"));
});

test("a brief with parts left out keeps only the parts it has", () => {
  const b = parseBrief("# Brief, Monday 16 November\n\n**Deadlines this week**\nTuesday 17 November, 23:59: the essay.\n\n**Something new**\n- ignored line\n\n**Needs you**\n\n", "2026-11-16");
  assert.deepEqual(b, { date: "2026-11-16", kind: "morning", title: "Brief, Monday 16 November", parts: { deadlines: ["Tuesday 17 November, 23:59: the essay."] } });
  assert.deepEqual(parseBrief("", "2026-11-16"), { date: "2026-11-16", kind: "morning", title: null, parts: {} });
  const long = parseBrief("**Needs you**\n1. " + "word ".repeat(200), "2026-11-16");
  assert.equal(long.parts.needsYou[0].length, MAX_TEXT);
});

test("the evening brief of a day is newer than its morning brief, and keeps its own parts", () => {
  const dir = mkdtempSync(join(tmpdir(), "hive-snapshot-evening-"));
  try {
    mkdirSync(join(dir, "brief"), { recursive: true });
    writeFileSync(join(dir, "brief", "2026-11-16.md"), "# Brief, Monday 16 November\n\n**Needs you**\n1. Morning line.\n");
    writeFileSync(join(dir, "brief", "2026-11-16-evening.md"), "# Evening brief, Monday 16 November\n\n**Done today**\n- The site shows the brief.\n\n**Tomorrow's best moves**\n1. Alpha: send the draft.\n\n**Needs you**\n1. Evening line.\n");
    let s = buildSnapshot(dir, { health: false, warn: () => {} });
    assert.equal(s.brief.kind, "evening");
    assert.deepEqual(s.brief.parts, { done: ["The site shows the brief."], tomorrow: ["Alpha: send the draft."], needsYou: ["Evening line."] });
    // The next morning's brief replaces it.
    writeFileSync(join(dir, "brief", "2026-11-17.md"), "# Brief, Tuesday 17 November\n\n**Needs you**\n1. Next morning.\n");
    s = buildSnapshot(dir, { health: false, warn: () => {} });
    assert.equal(s.brief.date, "2026-11-17");
    assert.equal(s.brief.kind, "morning");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("no brief, no ledger and no what-leaves note: empty, not an error", () => {
  const bare = mkdtempSync(join(tmpdir(), "hive-snapshot-bare-"));
  try {
    const s = buildSnapshot(bare, { health: false, warn: () => {} });
    assert.equal(s.brief, null);
    assert.deepEqual(s.ledger, []);
    assert.deepEqual(s.whatLeaves, { rows: [], stays: null });
  } finally {
    rmSync(bare, { recursive: true, force: true });
  }
});

test("the ledger: newest first, across months, in plain parts and with no file names", () => {
  const s = buildSnapshot(root, { warn: () => {} });
  assert.deepEqual(s.ledger, [
    { date: "2026-11-15", time: null, kind: "other", what: "backup", text: "copied the notebook." },
    { date: "2026-11-15", time: "05:10", kind: "run", seconds: 40, changed: 3, tokens: null },
    { date: "2026-11-14", time: null, kind: "sessions", sessions: 5, tokensIn: "2.4M", tokensCached: "166.2M", tokensOut: "417k" },
    { date: "2026-10-31", time: null, kind: "sessions", sessions: 1, tokensIn: "10k", tokensCached: "2.0M", tokensOut: "3k" },
  ]);
  const out = JSON.stringify(s.ledger);
  for (const word of ["brief/", "state.md", ".md", "hive-mind 2.0M"]) assert.ok(!out.includes(word), `${word} reached the ledger`);
  assert.equal(parseLedgerLine("Not a ledger line."), null);
  const measured = parseLedgerLine("2026-11-16 06:00:00 UTC, daily run: model, 12 seconds. Changed: nothing. Tokens: 1.2k in, 300 out.");
  assert.equal(measured.changed, 0);
  assert.equal(measured.tokens, "1.2k in, 300 out");
});

test("the ledger keeps at most the 14 newest lines", () => {
  const many = mkdtempSync(join(tmpdir(), "hive-snapshot-ledger-"));
  try {
    const rows = Array.from({ length: 20 }, (_, i) => `- 2026-11-${String(i + 1).padStart(2, "0")}, PC sessions: ${i + 1} sessions, 1k new tokens in, 1k reread from cache, 1k out.`);
    mkdirSync(join(many, "ledger"), { recursive: true });
    writeFileSync(join(many, "ledger", "2026-11.md"), `# Ledger 2026-11\n\n${rows.join("\n")}\n`, "utf8");
    const s = buildSnapshot(many, { health: false, warn: () => {} });
    assert.equal(s.ledger.length, 14);
    assert.equal(s.ledger[0].date, "2026-11-20");
    assert.equal(s.ledger[13].date, "2026-11-07");
  } finally {
    rmSync(many, { recursive: true, force: true });
  }
});

test("what leaves the PC: each row of the table, and the line that stays", () => {
  const s = buildSnapshot(root, { warn: () => {} });
  assert.deepEqual(s.whatLeaves, {
    rows: [
      { what: "The notes", where: "GitHub, private", when: "After every save" },
      { what: "Talk", where: "Anthropic", when: "While a session runs" },
    ],
    stays: "the protected names.",
  });
  assert.deepEqual(parseWhatLeaves("No table here."), { rows: [], stays: null });
  assert.equal(parseWhatLeaves("| What | Where | When |\n|---|---|---|\n| A | B | C |\n\nStays on your computer: the private names.").stays, "the private names.");
});

test("git status and health output are read correctly", () => {
  assert.deepEqual(parseSync("## main...origin/main\n"), { inSync: true });
  assert.deepEqual(parseSync("## main...origin/main\n M app/src/data/snapshot.json\n"), { inSync: true });
  assert.equal(parseSync("## main...origin/main [ahead 2]\n").reason, "2 commits not on GitHub yet");
  assert.equal(parseSync("## main...origin/main [behind 1]\n?? x.md\n").reason, "1 commit behind GitHub, 1 unsaved change");
  assert.equal(parseSync("## main\n").reason, "no link to GitHub");
  assert.deepEqual(parseHealth("OK  a\nOK  b\n\nALL FINE: 2 of 2 checks passed.\n"), { passed: 2, total: 2, needsYou: [], ok: 2 });
  assert.deepEqual(parseHealth("OK  a\nNEEDS YOU  Something is off (2 unsaved)\n\nNEEDS YOU: 1 of 2 checks. 1 passed.\n"), {
    passed: 1,
    total: 2,
    needsYou: ["Something is off (2 unsaved)"],
    ok: 1,
  });
  assert.equal(parseHealth("garbage"), null);
});

test("the command writes the file where it is told", () => {
  const out = join(root, "out", "snap.json");
  const r = spawnSync(process.execPath, [SCRIPT, "--root", root, "--out", out, "--no-health"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  const s = JSON.parse(readFileSync(out, "utf8"));
  assert.equal(s.projects.length, 3);
  assert.equal(s.health.status, "not checked");
});

test("questions: a project's question lines carry choices, a deadline and what waits", async () => {
  const { parseQuestions } = await import("./snapshot.mjs");
  const qs = parseQuestions(
    "project: X\nquestion: Which one? | choices: Short; Long | by: 2026-11-17 23:59 | waits: The submission | asked: 2026-11-16\nquestion: Plain one?\nquestion:   \n",
  );
  assert.deepEqual(qs, [
    { text: "Which one?", choices: ["Short", "Long"], by: "2026-11-17 23:59", waits: "The submission", asked: "2026-11-16" },
    { text: "Plain one?" },
  ]);
});

test("answers: lines from the page are read, with the tick and what was done", async () => {
  const { parseAnswers } = await import("./snapshot.mjs");
  const text = ["# Answers", "- [ ] 2026-11-16T16:10Z | answer | Alpha | Which one? | Short", "- [x] 2026-11-16T12:00Z | note | Alpha | (a note) | Exam on 3 December | done: added to Alpha", "- [ ] broken line"].join(String.fromCharCode(10));
  assert.deepEqual(parseAnswers(text), [
    { at: "2026-11-16T16:10Z", kind: "answer", project: "Alpha", question: "Which one?", answer: "Short", done: false },
    { at: "2026-11-16T12:00Z", kind: "note", project: "Alpha", question: "(a note)", answer: "Exam on 3 December", done: true, did: "added to Alpha" },
  ]);
});

test("projects come most important first, by their order line, then by folder name", () => {
  const dir = mkdtempSync(join(tmpdir(), "hive-snapshot-order-"));
  try {
    const put2 = (rel, text) => {
      mkdirSync(dirname(join(dir, rel)), { recursive: true });
      writeFileSync(join(dir, rel), text, "utf8");
    };
    put2("projects/aaa/state.md", note({ project: "A", kind: "personal", stage: "s", order: 2 }));
    put2("projects/bbb/state.md", note({ project: "B", kind: "personal", stage: "s", order: 1 }));
    put2("projects/ccc/state.md", note({ project: "C", kind: "personal", stage: "s" }));
    const s = buildSnapshot(dir, { health: false, warn: () => {} });
    assert.deepEqual(s.projects.map((p) => p.id), ["bbb", "aaa", "ccc"]);
    assert.ok(!("order" in s.projects[0]), "order is not an output field");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the progress map line that hive-setup writes after the first conversation reads as done, then current", async () => {
  const { parseMap } = await import("./snapshot.mjs");
  const line = "`[ The first conversation ✓ ] ► [ Notes saved to your private copy ] [ Daily brief (optional) ] [ Your page online (optional, not built yet) ]`";
  assert.deepEqual(parseMap(`## Progress map\n\n${line}\n`).map((s) => s.state), ["done", "current", "waiting", "waiting"]);
});

test("the two progress map lines that hive-setup writes after the first save online read as done, then current", async () => {
  const { parseMap } = await import("./snapshot.mjs");
  const withBrief = "`[ The first conversation ✓ ] [ Notes saved to your private copy ✓ ] ► [ Daily brief (optional) ] [ Your page online (optional, not built yet) ]`";
  const noBrief = "`[ The first conversation ✓ ] [ Notes saved to your private copy ✓ ] [ Daily brief (optional) ] ► [ Your page online (optional, not built yet) ]`";
  assert.deepEqual(parseMap(`## Progress map\n\n${withBrief}\n`).map((s) => s.state), ["done", "done", "current", "waiting"]);
  assert.deepEqual(parseMap(`## Progress map\n\n${noBrief}\n`).map((s) => s.state), ["done", "done", "waiting", "current"]);
});

test("a progress map and a project note saved with Windows line endings (CRLF) are read the same", async () => {
  const { parseMap } = await import("./snapshot.mjs");
  const cr = String.fromCharCode(13);
  const text = "## Progress map\n\n`[ The first conversation ✓ ] ► [ Notes saved to your private copy ]`\n".split("\n").join(cr + "\n");
  assert.deepEqual(parseMap(text).map((s) => s.state), ["done", "current"]);
});
