// Minimal, scoped YAML reader/writer for Backstage catalog-info.yaml and mkdocs.yml.
//
// This is NOT a general-purpose YAML parser. It only understands the subset of
// YAML that Backstage catalog files and mkdocs.yml actually use:
//   - `---` multi-document separators
//   - flat and nested block mappings (`key: value`, indented sub-maps)
//   - block sequences (`- item`, including sequences of maps)
//   - flow sequences (`[a, b, c]`)
//   - plain, single-quoted, and double-quoted scalars
//   - block scalars introduced with `|` (literal) — kept as raw text
//   - comments (`# ...`) stripped outside of quoted strings
//
// Anchors, aliases, tags, and folded (`>`) scalars are NOT supported. If a file
// uses them, parseYamlDocuments will throw — callers should fall back to
// treating the file as opaque text (see SKILL.md's fallback guidance).

export function parseYamlDocuments(text) {
  const docs = splitDocuments(text);
  return docs.map((doc) => parseDocument(doc));
}

export function splitDocuments(text) {
  const normalized = text.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  const docs = [];
  let current = [];
  for (const line of lines) {
    if (line.trim() === '---') {
      if (current.length) docs.push(current.join('\n'));
      current = [];
      continue;
    }
    current.push(line);
  }
  if (current.some((l) => l.trim() !== '')) docs.push(current.join('\n'));
  return docs.length ? docs : [text];
}

function stripComment(line) {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (ch === '#' && !inSingle && !inDouble) {
      if (i === 0 || /\s/.test(line[i - 1])) return line.slice(0, i);
    }
  }
  return line;
}

function indentOf(line) {
  const m = line.match(/^(\s*)/);
  return m[1].length;
}

function parseScalar(raw) {
  const s = raw.trim();
  if (s === '' || s === '~' || s === 'null') return null;
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (/^-?\d+$/.test(s)) return parseInt(s, 10);
  if (/^-?\d+\.\d+$/.test(s)) return parseFloat(s);
  if (s.startsWith('"') && s.endsWith('"')) {
    return s.slice(1, -1).replace(/\\"/g, '"').replace(/\\n/g, '\n');
  }
  if (s.startsWith("'") && s.endsWith("'")) {
    return s.slice(1, -1).replace(/''/g, "'");
  }
  if (s.startsWith('[') && s.endsWith(']')) {
    const inner = s.slice(1, -1).trim();
    if (inner === '') return [];
    return splitFlowItems(inner).map((item) => parseScalar(item.trim()));
  }
  return s;
}

function splitFlowItems(inner) {
  const items = [];
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  let current = '';
  for (const ch of inner) {
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (!inSingle && !inDouble) {
      if (ch === '[' || ch === '{') depth++;
      if (ch === ']' || ch === '}') depth--;
      if (ch === ',' && depth === 0) {
        items.push(current);
        current = '';
        continue;
      }
    }
    current += ch;
  }
  if (current.trim() !== '') items.push(current);
  return items;
}

function parseDocument(text) {
  const rawLines = text.replace(/\r\n/g, '\n').split('\n');
  const lines = [];
  for (const line of rawLines) {
    if (line.trim() === '' || line.trim().startsWith('#')) continue;
    lines.push({ raw: line, stripped: stripComment(line), indent: indentOf(line) });
  }
  if (!lines.length) return null;
  const { value } = parseBlock(lines, 0, lines[0].indent);
  return value;
}

// Parses a contiguous block of lines at a given indent level starting at index `start`.
// Returns { value, next } where `next` is the index of the first line not consumed.
function parseBlock(lines, start, indent) {
  if (start >= lines.length) return { value: null, next: start };
  const first = lines[start];
  if (first.indent !== indent) return { value: null, next: start };

  const firstContent = first.stripped.trim();
  if (firstContent.startsWith('- ') || firstContent === '-') {
    return parseSequence(lines, start, indent);
  }
  return parseMapping(lines, start, indent);
}

function parseSequence(lines, start, indent) {
  const arr = [];
  let i = start;
  while (i < lines.length && lines[i].indent === indent) {
    const content = lines[i].stripped.trim();
    if (!(content.startsWith('- ') || content === '-')) break;
    const rest = content === '-' ? '' : content.slice(2);
    if (rest === '') {
      // Nested block on following lines, indented further.
      const childIndent = i + 1 < lines.length ? lines[i + 1].indent : indent + 2;
      if (i + 1 < lines.length && childIndent > indent) {
        const { value, next } = parseBlock(lines, i + 1, childIndent);
        arr.push(value);
        i = next;
      } else {
        arr.push(null);
        i++;
      }
    } else if (findColon(rest) !== -1) {
      // Inline map start: "- key: value" possibly continued by more indented keys.
      const inlineIndent = indent + 2;
      const syntheticLines = [{ ...lines[i], stripped: ' '.repeat(inlineIndent) + rest, indent: inlineIndent }];
      let j = i + 1;
      while (j < lines.length && lines[j].indent > indent) {
        syntheticLines.push(lines[j]);
        j++;
      }
      const { value } = parseBlock(syntheticLines, 0, inlineIndent);
      arr.push(value);
      i = j;
    } else {
      arr.push(parseScalar(rest));
      i++;
    }
  }
  return { value: arr, next: i };
}

function parseMapping(lines, start, indent) {
  const obj = {};
  let i = start;
  while (i < lines.length && lines[i].indent === indent) {
    const content = lines[i].stripped.trim();
    if (content.startsWith('- ')) break;
    const colonIdx = findColon(content);
    if (colonIdx === -1) { i++; continue; }
    const key = content.slice(0, colonIdx).trim().replace(/^["']|["']$/g, '');
    const rest = content.slice(colonIdx + 1).trim();

    if (rest === '|' || rest === '|-' || rest === '|+') {
      const blockLines = [];
      let j = i + 1;
      const blockIndent = j < lines.length ? lines[j].indent : indent + 2;
      while (j < lines.length && lines[j].indent >= blockIndent) {
        blockLines.push(lines[j].raw.slice(blockIndent));
        j++;
      }
      obj[key] = blockLines.join('\n');
      i = j;
    } else if (rest === '') {
      const nextIndent = i + 1 < lines.length ? lines[i + 1].indent : indent;
      if (i + 1 < lines.length && nextIndent > indent) {
        const { value, next } = parseBlock(lines, i + 1, nextIndent);
        obj[key] = value;
        i = next;
      } else {
        obj[key] = null;
        i++;
      }
    } else {
      obj[key] = parseScalar(rest);
      i++;
    }
  }
  return { value: obj, next: i };
}

function findColon(content) {
  let inSingle = false;
  let inDouble = false;
  let depth = 0;
  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (!inSingle && !inDouble) {
      if (ch === '[' || ch === '{') depth++;
      if (ch === ']' || ch === '}') depth--;
      if (ch === ':' && depth === 0 && (i + 1 === content.length || content[i + 1] === ' ')) return i;
    }
  }
  return -1;
}

// --- Serialization -----------------------------------------------------

export function stringifyDocuments(docs) {
  return docs.map((doc) => stringifyValue(doc, 0).trimEnd()).join('\n---\n') + '\n';
}

function needsQuoting(s) {
  if (s === '') return true;
  if (/^[\s]|[\s]$/.test(s)) return true;
  if (/^(true|false|null|~|yes|no)$/i.test(s)) return true;
  if (/^-?\d+(\.\d+)?$/.test(s)) return true;
  if (/[:#\[\]{}&*!|>'"%@`,]/.test(s)) return true;
  return false;
}

function scalarToString(v) {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'boolean' || typeof v === 'number') return String(v);
  const s = String(v);
  if (s.includes('\n')) {
    return '|\n' + s.split('\n').map((l) => '  ' + l).join('\n');
  }
  if (needsQuoting(s)) return JSON.stringify(s);
  return s;
}

function stringifyValue(value, indent) {
  const pad = '  '.repeat(indent);
  if (Array.isArray(value)) {
    if (!value.length) return pad + '[]\n';
    return value.map((item) => {
      if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
        const entries = Object.entries(item);
        return entries.map(([k, v], idx) => {
          const prefix = idx === 0 ? pad + '- ' : pad + '  ';
          return stringifyEntry(k, v, indent + 1, prefix);
        }).join('\n');
      }
      return pad + '- ' + scalarToString(item);
    }).join('\n') + '\n';
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value);
    if (!entries.length) return pad + '{}\n';
    return entries.map(([k, v]) => stringifyEntry(k, v, indent, pad)).join('\n') + '\n';
  }
  return pad + scalarToString(value) + '\n';
}

function stringifyEntry(key, value, indent, prefixOverride) {
  const pad = prefixOverride !== undefined ? prefixOverride : '  '.repeat(indent);
  const keyStr = /^[A-Za-z0-9_.-]+$/.test(key) ? key : JSON.stringify(key);
  if (value !== null && typeof value === 'object' && (Array.isArray(value) ? value.length : Object.keys(value).length)) {
    const childIndent = prefixOverride !== undefined ? indent + 1 : indent + 1;
    const childStr = stringifyValue(value, childIndent).trimEnd();
    return pad + keyStr + ':\n' + childStr;
  }
  if (Array.isArray(value) && value.length === 0) return pad + keyStr + ': []';
  if (value !== null && typeof value === 'object' && Object.keys(value).length === 0) return pad + keyStr + ': {}';
  return pad + keyStr + ': ' + scalarToString(value);
}
