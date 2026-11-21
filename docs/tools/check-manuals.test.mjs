// Tests for check-manuals.mjs. Run: node --test docs/tools/check-manuals.test.mjs
// Each check gets a copy that passes and a known-bad copy that must fail. Everything happens in temporary folders.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { run, slug, checkLinks, checkYou, checkPhrases, checkParts, checkLeaves, checkWords, syllables, readingEase, phrasesOf, installedNames, manualFiles } from './check-manuals.mjs';

function copy(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'manuals test '));
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), body);
  }
  return root;
}

const GOOD = {
  'README.md': '# Hive Mind\n\nRead [the first hour](docs/first-hour.md). It is short. You will like it.\n',
  'SETUP.md': '# Setup\n\nSee [the steps](docs/first-hour.md#step-1-make-your-copy).\n',
  'CLAUDE.md': 'Use hive-start when the person says hive start.\n',
  'docs/first-hour.md': '# Your first hour\n\n## Step 1. Make your copy\n\nOpen GitHub. Click the button. Under **Owner**, pick your name. Go to [the map](map.md).\n',
  'docs/daily-use.md': '# Every day\n\n## Things to say\n\n| Say | What happens |\n|---|---|\n| "hive start" | Claude reads your notes. |\n| "close" (for example: close now) | Claude saves. |\n\n## Later\n\n| "not a phrase row" | x |\n',
  'docs/parts.md': '# Parts\n\n`README.md`, `SETUP.md`, `CLAUDE.md`, `docs`, `core`, `system` and `start.ps1`, `settings.json`, `pre-commit`, `.claude/skills`.\n',
  'docs/map.md': '# Map\n\nnotes --> leaves your computer: your notes\nbrief --> leaves your computer: only if\n\n## Arrows that leave your computer\n\n| What | Where it goes | When |\n|---|---|---|\n| Your notes | GitHub, your copy | Every save |\n| The brief | The cloud | Only if you set it up |\n',
  'docs/words.md': '# Words\n\n| Word | Meaning |\n|---|---|\n| **GitHub** | A website. |\n| **Checks, gates** | Small programs. |\n| **Brief** | A short note. |\n',
  'core/skills/hive-close/SKILL.md': '---\nname: hive-close\ndescription: Use when the user says close.\n---\n',
  'core/gates/install.ps1': "Put-File (Join-Path $Root 'core\\start\\start.ps1') (Join-Path $hive 'start.ps1')\n$settings = Join-Path $ClaudeDir 'settings.json'\nPut-File (Join-Path $Root 'core\\guard\\pre-commit') (Join-Path $hooks 'pre-commit')\n",
  'system/what-leaves.md': '| What | Where it goes |\n|---|---|\n| Your notes | GitHub, your own private copy |\n',
};

test('a copy that is in order passes every check', () => {
  const root = copy(GOOD);
  const lines = run(root);
  assert.deepEqual(lines.filter((l) => l.startsWith('NEEDS|')), [], lines.join('\n'));
  assert.ok(lines.some((l) => l.startsWith('SCORE|docs/first-hour.md|')));
});

test('slug follows GitHub: lowercase, punctuation gone, spaces become hyphens', () => {
  assert.equal(slug('Step 1. Make your copy'), 'step-1-make-your-copy');
  assert.equal(slug("Claude's own parts, which Hive Mind uses"), 'claudes-own-parts-which-hive-mind-uses');
  assert.equal(slug('"node was not found"'), 'node-was-not-found');
  assert.equal(slug('Your notes: the hive-mind folder'), 'your-notes-the-hive-mind-folder');
});

test('a link to a missing page or a missing heading fails', () => {
  const root = copy({ ...GOOD, 'README.md': 'See [gone](docs/nothing.md) and [bad part](docs/map.md#nowhere) and [web](https://example.com).\n' });
  const bad = checkLinks(root, manualFiles(root));
  assert.equal(bad.length, 2);
  assert.match(bad[0], /no such file/);
  assert.match(bad[1], /no such heading/);
});

test('"the owner" fails, GitHub\'s own **Owner** label does not', () => {
  const root = copy({ ...GOOD, 'docs/map.md': GOOD['docs/map.md'] + '\nAsk the owner first.\n' });
  assert.deepEqual(checkYou(root, ['docs/map.md']), ['docs/map.md:13']);
  assert.deepEqual(checkYou(root, ['docs/first-hour.md']), []);
});

test('only rows of the Things to say table count as phrases, and a phrase no helper answers to fails', () => {
  assert.deepEqual(phrasesOf(GOOD['docs/daily-use.md']), ['hive start', 'close']);
  const root = copy({ ...GOOD, 'docs/daily-use.md': GOOD['docs/daily-use.md'].replace('"close"', '"make me a sandwich"') });
  assert.deepEqual(checkPhrases(root).missing, ['make me a sandwich']);
});

test('a top-level folder or an installed file missing from parts.md fails', () => {
  const root = copy({ ...GOOD, 'newfolder/x.md': 'x', 'core/gates/install.ps1': GOOD['core/gates/install.ps1'] + "Put-File (Join-Path $Root 'x') (Join-Path $hive 'gates\\gates.mjs')\n" });
  assert.deepEqual(installedNames(root).sort(), ['gates.mjs', 'pre-commit', 'settings.json', 'start.ps1']);
  assert.deepEqual(checkParts(root), ['top level: newfolder', 'installed: gates.mjs']);
});

test('a leaving arrow to a place not in What leaves fails, unless it is marked "only if"', () => {
  const map = GOOD['docs/map.md'].replace('| GitHub, your copy |', '| Somewhere else |');
  const root = copy({ ...GOOD, 'docs/map.md': map });
  assert.deepEqual(checkLeaves(root), ['Your notes -> Somewhere else is not in system/what-leaves.md']);
  const extra = copy({ ...GOOD, 'docs/map.md': GOOD['docs/map.md'] + '\nmore --> leaves your computer: oops\n' });
  assert.match(checkLeaves(extra)[0], /draws 3 leaving arrows, the table lists 2/);
});

test('an inside word with no row in words.md fails; one with a row passes', () => {
  const root = copy({ ...GOOD, 'docs/first-hour.md': GOOD['docs/first-hour.md'] + '\nThe gates hold. Then commit the repository.\n' });
  const bad = checkWords(root, manualFiles(root));
  assert.ok(bad.some((b) => b.startsWith('commit ')), bad.join());
  assert.ok(bad.some((b) => b.startsWith('repository ')), bad.join());
  assert.ok(!bad.some((b) => b.startsWith('gate ')), 'gates has a row');
});

test('Docker and container are inside words: a manual using them with no row fails', () => {
  const root = copy({ ...GOOD, 'docs/first-hour.md': GOOD['docs/first-hour.md'] + '\nA project with code runs in Docker, in a container.\n' });
  const bad = checkWords(root, manualFiles(root));
  assert.ok(bad.some((b) => b.startsWith('Docker ')), bad.join());
  assert.ok(bad.some((b) => b.startsWith('container ')), bad.join());
});

test('code is not read for inside words', () => {
  const root = copy({ ...GOOD, 'docs/first-hour.md': GOOD['docs/first-hour.md'] + '\nRun `git commit` here.\n\n```\ngit push\n```\n' });
  assert.deepEqual(checkWords(root, ['docs/first-hour.md']), []);
});

test('syllables and the reading-ease score match the textbook example', () => {
  assert.equal(syllables('platypus'), 3);
  assert.equal(syllables('the'), 1);
  // The usual textbook sentence scores 37.5.
  assert.equal(readingEase('The Australian platypus is seemingly a hybrid of a mammal and reptilian creature.'), 37.5);
  assert.ok(readingEase('The cat sat on the mat.') > 100);
});

test('a hard page fails the reading-ease bar', () => {
  const hard = '# Your first hour\n\nThe configuration necessitates comprehensive initialization of interdependent infrastructural components, notwithstanding considerable organizational heterogeneity.\n';
  const lines = run(copy({ ...GOOD, 'docs/first-hour.md': hard }));
  assert.ok(lines.some((l) => l.startsWith('NEEDS|') && /reading ease/.test(l) && /docs\/first-hour\.md/.test(l)), lines.join('\n'));
});
