// Loaded with `node --import <this file>` by on-stop.mjs, only in a git worktree that has no app/node_modules of its own.
// When a package import cannot be found, it is looked up once more in the main checkout's app folder (HIVE_FACTORY_MODULES),
// so the tests of a helper's copy run against the packages already installed there. Nothing is installed or copied.
import { register } from 'node:module';

const dir = process.env.HIVE_FACTORY_MODULES || '';
if (dir) register(new URL('./modules-fallback-hooks.mjs', import.meta.url), { data: { dir } });
