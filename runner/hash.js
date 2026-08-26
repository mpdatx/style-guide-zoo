import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

/** Normalize line endings so a Windows checkout hashes like a Linux one. */
function normalize(text) {
  return text.replace(/\r\n/g, '\n');
}

export function sha256(text) {
  const digest = createHash('sha256').update(normalize(text), 'utf8').digest('hex');
  return `sha256:${digest}`;
}

export async function hashFile(filePath) {
  return sha256(await readFile(filePath, 'utf8'));
}
