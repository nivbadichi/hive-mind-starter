// "node --test core/install/" runs this file: Node 24 runs a folder given to --test as one program, found through
// package.json "main" (the same as core/checks/_lib/run-tests.mjs). It runs every *.test.mjs next to it. Imported for
// its list only, it runs nothing.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export function testFiles() {
  return fs.readdirSync(HERE).filter((f) => f.endsWith('.test.mjs')).sort().map((f) => path.join(HERE, f));
}

const arg = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (arg === HERE || arg === fileURLToPath(import.meta.url)) {
  for (const f of testFiles()) await import(pathToFileURL(f).href);
}
