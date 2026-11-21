// Is a tool call only reading? Used where the contract says "every tool except reading is refused" (an overdue debt,
// a broken safety check). It is strict on purpose: anything it cannot read as plainly harmless counts as not reading.
// A shell command is reading only when every simple command in it starts with a reading word, nothing is written
// with > or >>, and nothing runs inside $( ), backticks or a nested shell.

// Splits at ; && || | & and new lines outside quotes. Returns null when the text has a redirect, a substitution or an
// unclosed quote (then the command is not reading).
export function simpleCommands(cmd) {
  const s = String(cmd || '');
  const parts = [];
  let cur = '', q = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === q) q = '';
      else if (q === '"' && (c === '`' || (c === '$' && s[i + 1] === '('))) return null;
      cur += c;
      continue;
    }
    if (c === '"' || c === "'") { q = c; cur += c; continue; }
    if (c === '`' || (c === '$' && s[i + 1] === '(') || c === '>' || c === '<' && s[i + 1] === '(') return null;
    if (c === ';' || c === '\n' || c === '|' || c === '&') { parts.push(cur); cur = ''; continue; }
    cur += c;
  }
  if (q) return null;
  parts.push(cur);
  return parts.map((p) => p.trim()).filter(Boolean);
}

function words(seg) {
  return (seg.match(/"[^"]*"|'[^']*'|\S+/g) || []).map((w) => w.replace(/^["']|["']$/g, ''));
}

const NEVER_READING_FLAGS = /^(-i|--in-place|-delete|-exec|-execdir|-ok|-fprint|-o|--output)$/i;

export function isReadingCommand(cmd, S) {
  const segs = simpleCommands(cmd);
  if (!segs || !segs.length) return false;
  const read = new Set((S.readingCommands || []).map((x) => x.toLowerCase()));
  const git = new Set((S.gitReading || []).map((x) => x.toLowerCase()));
  for (const seg of segs) {
    const w = words(seg);
    const name = (w[0] || '').replace(/\\/g, '/').split('/').pop().toLowerCase().replace(/\.(exe|cmd|bat)$/, '');
    if (name === 'git') {
      const sub = (w.slice(1).find((x) => !x.startsWith('-')) || '').toLowerCase();
      if (!git.has(sub)) return false;
      continue;
    }
    if (!read.has(name)) return false;
    if (w.slice(1).some((x) => NEVER_READING_FLAGS.test(x))) return false;
  }
  return true;
}

export function isReading(tool, input, S) {
  const t = String(tool || '');
  if ((S.readingTools || []).includes(t)) return true;
  if (t === 'Bash' || t === 'PowerShell') return isReadingCommand((input && input.command) || '', S);
  return false;
}
