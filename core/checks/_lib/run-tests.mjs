// "node --test core/checks/_lib/" runs this file: Node 24 runs a folder given to --test as one program, found through
// package.json "main". It runs every test/*.test.mjs, so a test file added later is never left out. Imported for its
// list only (a test does that), it runs nothing.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export function testFiles() {
  const dir = path.join(HERE, 'test');
  return fs.readdirSync(dir).filter((f) => f.endsWith('.test.mjs')).sort().map((f) => path.join(dir, f));
}

const arg = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (arg === HERE || arg === fileURLToPath(import.meta.url)) {
  for (const f of testFiles()) await import(pathToFileURL(f).href);
}
