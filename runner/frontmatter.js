function coerce(raw) {
  const value = raw.trim();
  const quoted = value.match(/^"(.*)"$/s) ?? value.match(/^'(.*)'$/s);
  if (quoted) return quoted[1];
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^-?\d+$/.test(value)) return Number(value);
  return value;
}

/**
 * Parse a flat `key: value` frontmatter block.
 * @returns {{ data: Record<string, string|number|boolean>, body: string }}
 */
export function parseFrontmatter(text) {
  const normalized = text.replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---\n')) {
    throw new Error('Document must begin with a `---` frontmatter fence');
  }
  const end = normalized.indexOf('\n---', 3);
  if (end === -1) {
    throw new Error('Frontmatter block has no closing `---` fence');
  }
  const block = normalized.slice(4, end);
  const body = normalized.slice(end + 4).replace(/^\n+/, '').trimEnd();

  const data = {};
  for (const line of block.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf(':');
    if (separator === -1) {
      throw new Error(`Frontmatter line is not \`key: value\`: ${trimmed}`);
    }
    data[trimmed.slice(0, separator).trim()] = coerce(trimmed.slice(separator + 1));
  }
  return { data, body };
}
