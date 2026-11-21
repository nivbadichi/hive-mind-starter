// Tests for the privacy check. Run: node --test core/guard/privacy-guard.test.mjs
// Every secret here is made up and built from parts while the test runs, so this file holds none.
// Every run happens in a temporary git folder with a made-up user name; nothing real is read or changed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PRIVATE = "me"; // the folder of private notes that may hold email addresses
const HAS_BANNED_PHRASE_RULE = false;
const HERE = process.env.GUARD_DIR ?? dirname(fileURLToPath(import.meta.url));
const NAME = "zed-tester"; // the made-up user name of "this computer"
const KEY = "sk-" + "a".repeat(24);
const AWS = "AKIA" + "B".repeat(16);
const ENV = { ...process.env, HIVE_USER_NAME: NAME, HIVE_NAMES_FILE: join(tmpdir(), "no-such-names-file.txt"), HIVE_ROOT: "" };
delete ENV.HIVE_GUARD;
const havePowershell = spawnSync("powershell", ["-NoProfile", "-Command", "exit 0"]).status === 0;

const made = [];
function repo(files = {}, { withGuard = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "guardtest-"));
  made.push(dir);
  const git = (...a) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8", env: ENV });
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@example.invalid");
  git("config", "user.name", "t");
  git("config", "core.autocrlf", "false");
  if (withGuard) {
    mkdirSync(join(dir, "core", "guard"), { recursive: true });
    for (const f of ["privacy-guard.mjs", "privacy-guard.ps1", "cloud-hooks", "pre-commit", "pre-push"]) {
      if (existsSync(join(HERE, f))) cpSync(join(HERE, f), join(dir, "core", "guard", f), { recursive: true });
    }
    writeFileSync(join(dir, ".gitignore"), "");
  }
  put(dir, files);
  return { dir, git };
}
function put(dir, files) {
  for (const [rel, body] of Object.entries(files)) {
    const p = join(dir, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, body);
  }
}
const run = (args, extra = {}) => {
  const r = spawnSync(process.execPath, [join(HERE, "privacy-guard.mjs"), ...args], { encoding: "utf8", env: { ...ENV, ...extra.env }, input: extra.input ?? "" });
  return { code: r.status, out: r.stdout + r.stderr };
};
const guard = (dir, extra) => run([dir], extra);
process.on("exit", () => { for (const d of made) try { rmSync(d, { recursive: true, force: true }); } catch {} });

test("a clean notebook passes", () => {
  const { dir } = repo({ "a.md": "hello\n", "b.mjs": "export const x = 1;\n" });
  const r = guard(dir);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /CLEAN/);
});

test("a made-up key is caught in every kind of text file, not only notes (the roast's fault 7)", () => {
  const files = {};
  for (const name of ["a.mjs", "b.ts", "c.html", "d.css", "e.sh", "f.tsx", "g.js", "h.env.example", "Dockerfile", "i.yaml", "j.ps1", "k.json"]) {
    files[name] = `line one\nconst k = "${KEY}";\n`;
  }
  const { dir } = repo(files);
  const r = guard(dir);
  assert.equal(r.code, 1, r.out);
  for (const name of Object.keys(files)) assert.ok(r.out.includes(`${name}:2 - looks like: API key (sk-)`), `${name} was not caught:\n${r.out}`);
  assert.ok(!r.out.includes(KEY), "the key itself must never be printed");
});

test("every rule fires on its own made-up value", () => {
  const cases = {
    "GitHub token": "gh" + "p_" + "c".repeat(36),
    "GitHub fine-grained token": "github" + "_pat_" + "d".repeat(40),
    "AWS key id": AWS,
    "Private key": "-----BEGIN " + "RSA PRIVATE KEY-----",
    "Slack token": "xo" + "xb-" + "1234567890-abcdef",
    "Google API key": "AI" + "za" + "e".repeat(35),
    "Password or secret assignment": "pass" + "word" + ' = "' + "hunter2hunter2" + '"',
  };
  for (const [name, value] of Object.entries(cases)) {
    const { dir } = repo({ "x.ts": `// ${value}\n` });
    const r = guard(dir);
    assert.equal(r.code, 1, `${name}: ${r.out}`);
    assert.ok(r.out.includes(`looks like: ${name}`), `${name}: ${r.out}`);
  }
});

test("a new file that is not saved yet is read too", () => {
  const { dir, git } = repo({ "a.md": "ok\n" });
  git("add", "-A");
  put(dir, { "fresh.ts": `const k = "${KEY}";\n` });
  assert.equal(guard(dir).code, 1);
});

test("a file git is told to ignore is not read", () => {
  const { dir } = repo({ ".gitignore": "secret-local.ts\n", "secret-local.ts": `const k = "${KEY}";\n` });
  assert.equal(guard(dir).code, 0);
});

test("the line number is true, with Windows line ends and with a key on a late line", () => {
  const { dir } = repo({ "w.mjs": `a\r\nb\r\n${"x\r\n".repeat(40)}const k = "${KEY}";\r\n` });
  const r = guard(dir);
  assert.ok(r.out.includes("w.mjs:43 - "), r.out);
});

test("a binary file is skipped, a text file with a strange ending is not", () => {
  const { dir } = repo({
    "pic.png": `\x89PNG\r\n\x1a\n${KEY}`,
    "blob.dat": `head\0\0\0${KEY}`,
    "node_modules/pkg/index.js": `const k = "${KEY}";\n`,
    "package-lock.json": `{"x":"${KEY}"}\n`,
  });
  const r = guard(dir);
  assert.equal(r.code, 0, r.out);
  const { dir: dir2 } = repo({ "notes.dat": `plain text ${KEY}\n` });
  assert.equal(guard(dir2).code, 1, "a text file is read by its content, whatever its ending");
});

test("a file too large to read is named, and does not stop the run", () => {
  const { dir } = repo({ "big.txt": "x".repeat(5 * 1024 * 1024 + 10) });
  const r = guard(dir);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /not read, too large: big\.txt/);
});

test("a password or key on the next line is not mistaken for an assignment", () => {
  const { dir } = repo({ "a.md": "the password:\n  is kept somewhere else entirely\n" });
  assert.equal(guard(dir).code, 0);
});

test("a program that only reads a key from its settings is not a leak, a program that holds one is", () => {
  const fine = {
    "env.ts": "const token = process.env.KV_REST_API_TOKEN || '';\n",
    "list.mjs": "const SECRET = [/\\bsk-[A-Za-z0-9_-]{16,}/, /\\bAKIA[0-9A-Z]{12,}/];\n",
    "name.mjs": 'const c = secure ? "__Secure-authjs.session-token" : "authjs.session-token";\n',
    "obj.mjs": "const mint = encode({ secret: process.env.AUTH_SECRET, salt: cookieName });\n",
  };
  const { dir } = repo(fine);
  const r = guard(dir);
  assert.equal(r.code, 0, r.out);
  const held = { "a.ts": 'const ' + "pass" + 'word = "hunter2hunter2";\n', "b.mjs": "const o = { \"to" + "ken\": 'abcdefgh1234' };\n", "c.md": "to" + "ken: abcdefgh1234\n" };
  for (const [name, body] of Object.entries(held)) {
    const { dir: d } = repo({ [name]: body });
    assert.ok(guard(d).out.includes(`${name}:1 - looks like: Password or secret assignment`), name);
  }
});

test("a known test file with a made-up key is let through for that one rule, and says so", () => {
  const list = "# fixtures\nt.test.mjs | API key (sk-)\n";
  const { dir } = repo({ "core/guard/allowed-fixtures.txt": list, "t.test.mjs": `assert(leaks('${KEY}'));\n` });
  const r = guard(dir);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /1 made-up keys in known test files let through/);
  const other = repo({ "core/guard/allowed-fixtures.txt": list, "t.test.mjs": `x('${KEY}'); y('${AWS}');\n` });
  assert.ok(guard(other.dir).out.includes("t.test.mjs:1 - looks like: AWS key id"), "any other rule still applies in that file");
  const notListed = repo({ "core/guard/allowed-fixtures.txt": list, "u.test.mjs": `x('${KEY}');\n` });
  assert.equal(guard(notListed.dir).code, 1, "a file that is not listed is not let through");
});

test("an email address is a CHECK outside the private folder, in any kind of file", () => {
  const mail = "someone@" + "mailhost.org";
  const { dir } = repo({ "a.mjs": `// ${mail}\n`, [`${PRIVATE}/b.md`]: `${mail}\n` });
  const r = guard(dir);
  assert.equal(r.code, 2, r.out);
  assert.ok(r.out.includes("a.mjs:1"));
  assert.ok(!r.out.includes(`${PRIVATE}/b.md`), "the private folder may hold addresses");
});

test("an address at a domain set aside for examples is not personal", () => {
  const { dir } = repo({ "a.mjs": "// a@example.com b@example.invalid c@x.test d@localhost.test\n" });
  assert.equal(guard(dir).code, 0, guard(dir).out);
  const { dir: d2 } = repo({ "a.mjs": "// a@notexample" + ".com\n" });
  assert.equal(guard(d2).code, 2);
});

test("a path that holds the user name of this computer is a warning, never a stop", () => {
  const bad = [
    "C:\\Users\\" + NAME + "\\notes",
    "C:/Users/" + NAME + "/notes",
    "/c/Users/" + NAME + "/notes",
    "/home/" + NAME + "/x",
    "c:\\users\\" + NAME.toUpperCase() + "\\x",
  ];
  for (const p of bad) {
    const { dir } = repo({ "n.md": `see ${p}\n` });
    const r = guard(dir);
    assert.equal(r.code, 2, `${p}: ${r.out}`);
    assert.match(r.out, /CHECK/);
    assert.ok(r.out.includes("a path that holds the user name of this computer (a warning: the save goes on)"), r.out);
    assert.ok(!r.out.includes(NAME), "the user name must never be printed");
  }
  // With a real secret beside it, the save still stops, and both are named.
  const both = guard(repo({ "n.md": `see C:\\Users\\${NAME}\\x\n`, "k.mjs": `const k = "${KEY}";\n` }).dir);
  assert.equal(both.code, 1, both.out);
  assert.match(both.out, /k\.mjs:1 - looks like: API key/);
  const fine = ["C:\\Users\\Public\\x", "~/notes", "C:\\Users\\" + NAME + "-other\\x", "the Users folder"];
  for (const p of fine) {
    const { dir } = repo({ "n.md": `see ${p}\n` });
    assert.equal(guard(dir).code, 0, p);
  }
});

test("the chat's scratch folder is a finding", () => {
  const p = ["AppData", "Local", "Temp", "cl" + "aude"].join("\\");
  const { dir } = repo({ "n.md": `look in ${p}\\x\n` });
  const r = guard(dir);
  assert.equal(r.code, 1, r.out);
});

test("a protected name is caught in a program file too", { skip: false }, () => {
  const names = join(mkdtempSync(join(tmpdir(), "names-")), "names.txt");
  made.push(dirname(names));
  writeFileSync(names, "# one per line\nAcmeCorp\n");
  const { dir } = repo({ "x.tsx": "const client = 'AcmeCorp';\n" });
  const r = guard(dir, { env: { HIVE_NAMES_FILE: names } });
  assert.equal(r.code, 1, r.out);
  assert.ok(r.out.includes("a protected name") && !r.out.includes("AcmeCorp"));
});

test("the banned phrase is still caught", { skip: !HAS_BANNED_PHRASE_RULE }, () => {
  const phrase = "vi" + "be" + " cod" + "ing";
  const { dir } = repo({ "x.md": `we do ${phrase} here\n` });
  assert.equal(guard(dir).code, 1);
});

// ---- the second look before a push ------------------------------------------------------------
test("push: a key in an earlier save is caught even when a later save removed it", () => {
  const { dir, git } = repo({ "a.md": "ok\n" });
  git("add", "-A"); git("commit", "-q", "-m", "one");
  const base = git("rev-parse", "HEAD").trim();
  put(dir, { "k.mjs": `const k = "${KEY}";\n` });
  git("add", "-A"); git("commit", "-q", "-m", "two", "--no-verify");
  put(dir, { "k.mjs": "const k = 1;\n" });
  git("add", "-A"); git("commit", "-q", "-m", "three");
  const tip = git("rev-parse", "HEAD").trim();
  const r = run(["--push", dir], { input: `refs/heads/main ${tip} refs/heads/main ${base}\n` });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /k\.mjs:1 - looks like: API key/);
  assert.ok(!r.out.includes(KEY));
  const ok = run(["--push", dir], { input: `refs/heads/main ${base} refs/heads/main ${base}\n` });
  assert.equal(ok.code, 0, ok.out);
});

test("push: a first push (no remote commit) reads every save, a delete reads nothing", () => {
  const { dir, git } = repo({ "k.ts": `const k = "${KEY}";\n` });
  git("add", "-A"); git("commit", "-q", "-m", "one", "--no-verify");
  const tip = git("rev-parse", "HEAD").trim();
  const zero = "0".repeat(40);
  assert.equal(run(["--push", dir], { input: `refs/heads/main ${tip} refs/heads/main ${zero}\n` }).code, 1);
  assert.equal(run(["--push", dir], { input: `(delete) ${zero} refs/heads/old ${tip}\n` }).code, 0);
});

// ---- saves that skipped the check ---------------------------------------------------------------
test("unchecked: no record yet says so; saves not in the record are named and read", () => {
  const { dir, git } = repo({ "a.md": "ok\n" });
  git("add", "-A"); git("commit", "-q", "-m", "one");
  assert.match(run(["--unchecked", dir]).out, /no record of checked saves/);
  assert.equal(run(["--unchecked", dir]).code, 0);

  const gitdir = git("rev-parse", "--absolute-git-dir").trim();
  const tree1 = git("rev-parse", "HEAD^{tree}").trim();
  writeFileSync(join(gitdir, "hive-guard-checked.log"), `since 2000-01-01T00:00:00Z\n${tree1} 2026-01-01T00:00:00Z\n`);
  assert.equal(run(["--unchecked", dir]).code, 0, "a checked save is not named");

  put(dir, { "b.md": "two\n" });
  git("add", "-A"); git("commit", "-q", "-m", "skipped one", "--no-verify");
  let r = run(["--unchecked", dir]);
  assert.equal(r.code, 3, r.out);
  assert.match(r.out, /1 save was made without the privacy check/);
  assert.match(r.out, /skipped one/);
  assert.match(r.out, /nothing the check would stop/);

  put(dir, { "c.ts": `const k = "${KEY}";\n` });
  git("add", "-A"); git("commit", "-q", "-m", "skipped two", "--no-verify");
  r = run(["--unchecked", dir]);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /2 saves were made without/);
  assert.match(r.out, /c\.ts:1 - looks like: API key/);
  assert.ok(!r.out.includes(KEY));
});

// ---- the real hooks, end to end ---------------------------------------------------------------
function hookRepo(hookDir) {
  const r = repo({ "a.md": "ok\n" }, { withGuard: true });
  r.git("config", "core.hooksPath", join(r.dir, "core", "guard", hookDir));
  return r;
}
const tryGit = (git, ...a) => {
  try { return { code: 0, out: git(...a) }; } catch (e) { return { code: e.status ?? 1, out: String(e.stdout ?? "") + String(e.stderr ?? "") }; }
};

test("hooks: a clean save is recorded, a key is refused, --no-verify gets through but is named, and the push is stopped", () => {
  const { dir, git } = hookRepo("cloud-hooks");
  const bare = mkdtempSync(join(tmpdir(), "guardremote-"));
  made.push(bare);
  execFileSync("git", ["init", "-q", "--bare", bare]);
  git("remote", "add", "origin", bare);

  git("add", "-A");
  assert.equal(tryGit(git, "commit", "-q", "-m", "clean").code, 0, "a clean save goes through");
  const logFile = join(git("rev-parse", "--absolute-git-dir").trim(), "hive-guard-checked.log");
  assert.ok(existsSync(logFile), "the pre-commit hook writes its record");
  assert.ok(readFileSync(logFile, "utf8").includes(git("rev-parse", "HEAD^{tree}").trim()));
  assert.equal(run(["--unchecked", dir]).code, 0);

  put(dir, { "leak.ts": `const k = "${KEY}";\n` });
  git("add", "-A");
  const refused = tryGit(git, "commit", "-q", "-m", "leak");
  assert.notEqual(refused.code, 0, "the save with a key is refused");
  assert.match(refused.out, /save refused/);

  assert.equal(tryGit(git, "commit", "-q", "-m", "skipping the check", "--no-verify").code, 0);
  const named = run(["--unchecked", dir]);
  assert.equal(named.code, 1, named.out);
  assert.match(named.out, /skipping the check/);

  const push = tryGit(git, "push", "-q", "origin", "main");
  assert.notEqual(push.code, 0, "the push of an unchecked save with a key is stopped: " + push.out);
  assert.match(push.out, /push refused/);
  put(dir, { "leak.ts": "const k = 1;\n" });
  git("add", "-A");
  assert.equal(tryGit(git, "commit", "-q", "-m", "removed").code, 0);
  assert.notEqual(tryGit(git, "push", "-q", "origin", "main").code, 0, "the key is still in an earlier save, so the push stays stopped");
});

test("hooks: a save with a user-name path goes through both save hooks, with the warning shown", () => {
  for (const hooks of ["cloud-hooks", "."]) {
    const { dir, git } = repo({ "a.md": "ok\n" }, { withGuard: true });
    git("config", "core.hooksPath", join(dir, "core", "guard", hooks));
    put(dir, { "n.md": `see C:\\Users\\${NAME}\\notes\n` });
    git("add", "-A");
    const r = tryGit(git, "commit", "-m", "a path with the user name");
    assert.equal(r.code, 0, `${hooks}: the save must go through: ${r.out}`);
    assert.match(git("log", "-1", "--format=%s"), /a path with the user name/);
  }
});
test("push: a user-name path only warns at a push; a real secret beside it still stops", () => {
  const { dir, git } = repo({ "a.md": "ok\n" });
  git("add", "-A"); git("commit", "-q", "-m", "one");
  const base = git("rev-parse", "HEAD").trim();
  put(dir, { "n.md": `see C:\\Users\\${NAME}\\x\n` });
  git("add", "-A"); git("commit", "-q", "-m", "two");
  const r = run(["--push", dir], { input: `refs/heads/main ${git("rev-parse", "HEAD").trim()} refs/heads/main ${base}\n` });
  assert.equal(r.code, 2, r.out);
  assert.match(r.out, /CHECK/);
  assert.ok(r.out.includes("a path that holds the user name of this computer (a warning: the push goes on)"), r.out);
  assert.ok(!r.out.includes(NAME), "the user name must never be printed");
  // A real secret beside it: the push stops, and the warning is still named.
  put(dir, { "k.mjs": `const k = "${KEY}";\n` });
  git("add", "-A"); git("commit", "-q", "-m", "three");
  const both = run(["--push", dir], { input: `refs/heads/main ${git("rev-parse", "HEAD").trim()} refs/heads/main ${base}\n` });
  assert.equal(both.code, 1, both.out);
  assert.match(both.out, /k\.mjs:1 - looks like: API key/);
  assert.ok(!both.out.includes(NAME) && !both.out.includes(KEY));
});

test("push hooks: a push holding only a user-name path goes through both pre-push hooks, with the warning shown", { skip: !existsSync(join(HERE, "pre-push")) }, () => {
  const remote = mkdtempSync(join(tmpdir(), "guardremote-"));
  made.push(remote);
  execFileSync("git", ["init", "-q", "--bare", remote]);
  for (const hooks of ["cloud-hooks", "."]) {
    const { dir, git } = repo({ "a.md": "ok\n" }, { withGuard: true });
    git("remote", "add", "origin", remote);
    git("add", "-A"); git("commit", "-q", "-m", "one");
    put(dir, { "n.md": `see C:\\Users\\${NAME}\\notes\n` });
    git("add", "-A"); git("commit", "-q", "--no-verify", "-m", "a path with the user name");
    git("config", "core.hooksPath", join(dir, "core", "guard", hooks));
    const r = tryGit(git, "push", "-q", "-f", "origin", "main");
    assert.equal(r.code, 0, `${hooks}: the push must go through: ${r.out}`);
    assert.match(r.out, /a warning: the push goes on/);
  }
});

test("hooks: the notebook's own pre-commit and pre-push work the same",{ skip: process.platform === "win32" && !existsSync(join(HERE, "pre-push")) }, () => {
  const { dir, git } = repo({ "a.md": "ok\n" }, { withGuard: true });
  git("config", "core.hooksPath", join(dir, "core", "guard"));
  git("add", "-A");
  put(dir, { "leak.mjs": `const k = "${KEY}";\n` });
  git("add", "-A");
  const refused = tryGit(git, "commit", "-q", "-m", "leak");
  assert.notEqual(refused.code, 0, refused.out);
  assert.match(refused.out, /save refused/);
  put(dir, { "leak.mjs": "const k = 1;\n" });
  git("add", "-A");
  assert.equal(tryGit(git, "commit", "-q", "-m", "fine").code, 0);
  const logFile = join(git("rev-parse", "--absolute-git-dir").trim(), "hive-guard-checked.log");
  assert.ok(existsSync(logFile));
});

// ---- the PowerShell version (the one that runs at every save on the PC) ---------------------
function ps(dir) {
  const r = spawnSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(HERE, "privacy-guard.ps1"), "-Root", dir], { encoding: "utf8", env: ENV });
  return { code: r.status, out: r.stdout + r.stderr };
}
test("powershell version: finds the same things", { skip: !havePowershell }, () => {
  const { dir } = repo({
    "a.mjs": `const k = "${KEY}";\n`,
    "b.ts": `x\r\nconst k = "${KEY}";\r\n`,
    "c.html": `<p>${AWS}</p>\n`,
    "pic.png": `\x89PNG\0${KEY}`,
    "node_modules/z/i.js": `${KEY}\n`,
  });
  const r = ps(dir);
  assert.equal(r.code, 1, r.out);
  assert.ok(r.out.includes("a.mjs:1 - looks like: API key (sk-)"), r.out);
  assert.ok(r.out.includes("b.ts:2 - looks like: API key (sk-)"), r.out);
  assert.ok(r.out.includes("c.html:1 - looks like: AWS key id"), r.out);
  assert.ok(!r.out.includes("pic.png") && !r.out.includes("node_modules"), r.out);
  assert.ok(!r.out.includes(KEY));
});
test("powershell version: clean, email, user path", { skip: !havePowershell }, () => {
  assert.equal(ps(repo({ "a.md": "ok\n", "b.mjs": "x\n" }).dir).code, 0);
  assert.equal(ps(repo({ "a.mjs": "// someone@" + "mailhost.org\n", [`${PRIVATE}/n.md`]: "someone@" + "mailhost.org\n" }).dir).code, 2);
  const r = ps(repo({ "n.md": "see C:\\Users\\" + NAME + "\\x\n" }).dir);
  assert.equal(r.code, 2, r.out);
  assert.ok(r.out.includes("a path that holds the user name of this computer (a warning: the save goes on)") && !r.out.includes(NAME), r.out);
  assert.equal(ps(repo({ "n.md": "see C:\\Users\\" + NAME + "\\x\n", "k.mjs": `const k = "${KEY}";\n` }).dir).code, 1, "a secret beside it still stops");
  assert.equal(ps(repo({ "n.md": "see C:\\Users\\Public\\x and ~/y\n" }).dir).code, 0);
  assert.equal(ps(repo({ "notes.dat": `plain ${KEY}\n` }).dir).code, 1);
});
test("powershell version: program settings, known test files", { skip: !havePowershell }, () => {
  const fine = repo({ "env.ts": "const token = process.env.KV_REST_API_TOKEN || '';\n", "list.mjs": "const SECRET = [/\\bsk-[A-Za-z0-9_-]{16,}/];\n", "n.mjs": 'const c = s ? "__Secure-authjs.session-token" : "authjs.session-token";\n' });
  assert.equal(ps(fine.dir).code, 0, ps(fine.dir).out);
  const held = ps(repo({ "a.ts": "const pass" + 'word = "hunter2hunter2";\n' }).dir);
  assert.ok(held.out.includes("a.ts:1 - looks like: Password or secret assignment"), held.out);
  const list = "t.test.mjs | API key (sk-)\n";
  const ok = ps(repo({ "core/guard/allowed-fixtures.txt": list, "t.test.mjs": `x('${KEY}');\n` }).dir);
  assert.equal(ok.code, 0, ok.out);
  assert.equal(ps(repo({ "core/guard/allowed-fixtures.txt": list, "t.test.mjs": `x('${KEY}'); y('${AWS}');\n` }).dir).code, 1);
});
