#!/usr/bin/env node
// A helper's report must not leave a line empty (proposal 5 of the Agent Architects breakdowns:
// "a report with an empty files or checks line is rejected"). Four parts are looked for:
//   files      a path that was made or changed, or the words "nothing built" / "read-only"
//   checks     a command that was run (in backticks, or starting with node, npm, git, pwsh ...), or "not checked"
//   questions  the heading "Questions for the person" followed by at least one question, or "none"
//   model      the model that did the work (Opus, Sonnet, Haiku, Fable)
// It reads only. The helper-stop step of the checks can call faults(); the command line is for a person.
//
//   node core/report-shape/report-shape.mjs [<report file>]     (no file: reads the report from stdin)
// Prints OK| or one NEEDS| line per missing part; exit 1 when anything is missing.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PATH = /(?<![\w@])(?:[\w.-]+\/)+[\w.-]+\.[A-Za-z0-9]+\b/;
const NOTHING_BUILT = /\b(nothing (was )?(built|made|changed|written)|read-only|no files? (changed|touched|written))\b/i;
const COMMAND = /`[^`\n]*\b(node|npm|npx|pnpm|git|pwsh|powershell|python|pytest|bash|sh)\b[^`\n]*`|^\s*[-*]?\s*(node|npm|npx|git|pwsh)\s+\S/im;
const NOT_CHECKED = /\bnot checked\b/i;
const MODEL = /\b(opus|sonnet|haiku|fable)\b/i;
// In this copy the build brief's heading is "Questions for the person"; "for you" and "for the owner" are read too.
const QHEAD = /^\s*#*\s*\**Questions for (?:the person|you|the owner)\**\s*:?\s*(.*)$/im;

export function faults(report) {
  const text = String(report || '').replace(/\r\n/g, '\n');
  const out = [];
  // A path inside a command that was run is not a file that was made, so commands are left out here.
  const prose = text.replace(/`[^`\n]*\b(node|npm|npx|pnpm|git|pwsh|powershell|python|pytest|bash|sh)\b[^`\n]*`/gi, '');
  if (!PATH.test(prose) && !NOTHING_BUILT.test(text)) out.push({ key: 'files', text: 'No file is named as made or changed, and the report does not say nothing was built.' });
  if (!COMMAND.test(text) && !NOT_CHECKED.test(text)) out.push({ key: 'checks', text: 'No command that was run is named, and nothing is marked "not checked".' });
  const q = text.match(QHEAD);
  if (!q) out.push({ key: 'questions', text: 'There is no "Questions for the person" heading (write the questions, or "none").' });
  else {
    const after = (q[1] + '\n' + text.slice(q.index + q[0].length)).trim();
    if (!after) out.push({ key: 'questions', text: 'The "Questions for the person" heading is empty (write the questions, or "none").' });
  }
  if (!MODEL.test(text)) out.push({ key: 'model', text: 'The report does not say which model did the work.' });
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const file = process.argv[2];
  const text = file ? fs.readFileSync(file, 'utf8') : fs.readFileSync(0, 'utf8');
  const f = faults(text);
  console.log(f.length ? f.map((x) => `NEEDS|${x.key}: ${x.text}`).join('\n') : 'OK|The report names its files, its checks, its questions and its model.');
  process.exit(f.length ? 1 : 0);
}
