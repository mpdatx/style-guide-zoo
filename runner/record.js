import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export const SCHEMA_VERSION = 1;

export function cellKey(guideId, passageId) {
  return `${guideId}__${passageId}`;
}

export function recordPath(resultsDir, guideId, passageId, runIndex) {
  return join(resultsDir, guideId, passageId, `r${runIndex}.json`);
}

export function buildRecord({ guide, passage, template, runIndex, generatedAt, request, response }) {
  return {
    schema_version: SCHEMA_VERSION,
    run_id: `${cellKey(guide.id, passage.id)}__r${runIndex}`,
    run_index: runIndex,
    generated_at: generatedAt,
    guide: { id: guide.id, source_hash: guide.sourceHash },
    passage: { id: passage.id, source_hash: passage.sourceHash },
    prompt_template: { id: template.id, source_hash: template.sourceHash },
    request,
    response
  };
}

export async function readRecord(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return null;
  }
}

export async function writeRecord(path, record) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
}

/** True when this record was produced from exactly the current content. */
export function isCurrent(record, { guide, passage, template, backend }) {
  return Boolean(
    record &&
    record.schema_version === SCHEMA_VERSION &&
    record.response?.ok === true &&
    record.guide?.source_hash === guide.sourceHash &&
    record.passage?.source_hash === passage.sourceHash &&
    record.prompt_template?.source_hash === template.sourceHash &&
    (backend === undefined || record.request?.backend === backend)
  );
}
