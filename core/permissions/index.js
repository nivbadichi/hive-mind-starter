// So that `node --test core/permissions/` works: Node opens a folder given to --test as one module (this file), so it
// loads every *.test.mjs file next to it. Running one file by name (node --test core/permissions/permissions.test.mjs)
// works too.
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

for (const f of fs.readdirSync(__dirname).filter((n) => n.endsWith('.test.mjs')).sort()) {
  import(pathToFileURL(path.join(__dirname, f)).href);
}
