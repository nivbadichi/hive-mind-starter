// Resolve hook for modules-fallback.mjs: a bare package name that is not found where it was asked for is tried again
// from the main checkout's app folder. Relative paths, node: built-ins and found packages are left alone.
import path from 'node:path';
import { pathToFileURL } from 'node:url';

let parent = '';
export function initialize(data) { parent = pathToFileURL(path.join(data.dir, 'package.json')).href; }

export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context);
  } catch (e) {
    const bare = !/^(\.|\/|[A-Za-z]:|node:|file:|data:)/.test(specifier);
    if (!parent || !bare || e.code !== 'ERR_MODULE_NOT_FOUND') throw e;
    return next(specifier, { ...context, parentURL: parent });
  }
}
