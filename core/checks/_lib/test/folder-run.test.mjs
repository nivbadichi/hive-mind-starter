// The brief's command is "node --test core/checks/_lib/". Node 24 does not search a folder given to --test: it runs the
// folder as one program, which Node finds through the folder's package.json "main". That file must run every test
// file in test/, so a test file added later is never left out.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LIB = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

test('the folder can be run as one program, and that program runs every test file', async () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(LIB, 'package.json'), 'utf8'));
  assert.ok(pkg.main, 'package.json names the program Node runs for the folder');
  const { testFiles } = await import(new URL('file:' + path.join(LIB, pkg.main).replace(/\\/g, '/')).href + '?list');
  const found = fs.readdirSync(path.join(LIB, 'test')).filter((f) => f.endsWith('.test.mjs')).sort();
  assert.deepEqual(testFiles().map((f) => path.basename(f)), found);
  assert.ok(found.includes('folder-run.test.mjs'));
});
