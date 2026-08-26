import { readdir, readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { parseFrontmatter } from './frontmatter.js';
import { sha256 } from './hash.js';

export class ContentError extends Error {
  constructor(message, file) {
    super(`${message} (${file})`);
    this.name = 'ContentError';
    this.file = file;
  }
}

const GUIDE_FIELDS = ['id', 'name', 'description', 'order'];
const PASSAGE_FIELDS = ['id', 'title', 'genre', 'source', 'license', 'order'];

async function loadDir(dir, required, build) {
  const names = (await readdir(dir)).filter((n) => n.endsWith('.md')).sort();
  const items = [];
  for (const name of names) {
    const file = join(dir, name);
    const raw = await readFile(file, 'utf8');
    let parsed;
    try {
      parsed = parseFrontmatter(raw);
    } catch (error) {
      throw new ContentError(error.message, file);
    }
    const { data, body } = parsed;
    for (const field of required) {
      if (data[field] === undefined || data[field] === '') {
        throw new ContentError(`Missing required frontmatter field \`${field}\``, file);
      }
    }
    if (data.id !== basename(name, '.md')) {
      throw new ContentError(
        `Frontmatter id \`${data.id}\` does not match the filename`, file
      );
    }
    if (body.trim() === '') {
      throw new ContentError('Body is empty', file);
    }
    items.push(build(data, body, sha256(raw), file));
  }
  return items.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

export function loadGuides(dir = 'guides') {
  return loadDir(dir, GUIDE_FIELDS, (data, body, sourceHash, file) => ({
    id: data.id,
    name: data.name,
    description: data.description,
    source_url: data.source_url ?? '',
    license_note: data.license_note ?? '',
    order: data.order,
    systemPrompt: body,
    sourceHash,
    file
  }));
}

export function loadPassages(dir = 'corpus') {
  return loadDir(dir, PASSAGE_FIELDS, (data, body, sourceHash, file) => ({
    id: data.id,
    title: data.title,
    genre: data.genre,
    source: data.source,
    license: data.license,
    order: data.order,
    text: body,
    sourceHash,
    file
  }));
}

export async function loadTemplate(file) {
  const raw = await readFile(file, 'utf8');
  let parsed;
  try {
    parsed = parseFrontmatter(raw);
  } catch (error) {
    throw new ContentError(error.message, file);
  }
  if (!parsed.data.id) throw new ContentError('Missing required field `id`', file);
  if (!parsed.body.includes('{{PASSAGE}}')) {
    throw new ContentError('Template must contain the `{{PASSAGE}}` placeholder', file);
  }
  return { id: parsed.data.id, body: parsed.body, sourceHash: sha256(raw), file };
}

export async function loadConfig(file = 'config/experiment.json') {
  const config = JSON.parse(await readFile(file, 'utf8'));
  for (const field of ['model', 'runs_per_cell', 'prompt_template', 'concurrency']) {
    if (config[field] === undefined) {
      throw new ContentError(`Missing required config field \`${field}\``, file);
    }
  }
  config.cli_flags ??= [];
  return config;
}
