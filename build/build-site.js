import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadGuides, loadPassages } from '../runner/content.js';
import { cellKey, readRecord, recordPath } from '../runner/record.js';
import { computeMetrics } from './metrics.js';

export const SITE_SCHEMA_VERSION = 1;

function toRun(record) {
  const ok = record.response?.ok === true;
  const text = ok ? record.response.text : '';
  return {
    run_index: record.run_index,
    ok,
    text,
    metrics: ok ? computeMetrics(text) : null,
    generated_at: record.generated_at,
    request: record.request,
    response: {
      model_reported: record.response?.model_reported ?? '',
      usage: record.response?.usage ?? {},
      total_cost_usd: record.response?.total_cost_usd ?? 0,
      duration_ms: record.response?.duration_ms ?? 0,
      session_id: record.response?.session_id ?? '',
      num_turns: record.response?.num_turns ?? 0
    },
    error: ok ? null : (record.response?.error ?? { message: 'unknown', stage: 'unknown' })
  };
}

export async function buildSite({
  guidesDir = 'guides',
  corpusDir = 'corpus',
  resultsDir = 'results/runs',
  outDir = 'site/data',
  runsPerCell = 5
} = {}) {
  const [guides, passages] = await Promise.all([
    loadGuides(guidesDir), loadPassages(corpusDir)
  ]);

  const warnings = [];
  const cells = {};
  const cellFiles = [];

  for (const guide of guides) {
    for (const passage of passages) {
      const key = cellKey(guide.id, passage.id);
      const runs = [];
      for (let runIndex = 1; runIndex <= runsPerCell; runIndex += 1) {
        const record = await readRecord(
          recordPath(resultsDir, guide.id, passage.id, runIndex)
        );
        if (record) runs.push(toRun(record));
      }
      if (runs.length === 0) warnings.push(`No records for cell ${key}`);

      cells[key] = {
        guide_id: guide.id,
        passage_id: passage.id,
        runs: runs.length,
        failures: runs.filter((r) => !r.ok).length,
        file: `cells/${key}.json`
      };
      cellFiles.push([key, { guide_id: guide.id, passage_id: passage.id, runs }]);
    }
  }

  const index = {
    schema_version: SITE_SCHEMA_VERSION,
    guides: guides.map(({ id, name, description, source_url, license_note, order }) => ({
      id, name, description, source_url, license_note, order
    })),
    passages: passages.map(({ id, title, genre, source, license, order, text }) => ({
      id, title, genre, source, license, order, text, metrics: computeMetrics(text)
    })),
    cells
  };

  await rm(outDir, { recursive: true, force: true });
  await mkdir(join(outDir, 'cells'), { recursive: true });
  await writeFile(join(outDir, 'index.json'), `${JSON.stringify(index, null, 2)}\n`, 'utf8');
  for (const [key, payload] of cellFiles) {
    await writeFile(
      join(outDir, 'cells', `${key}.json`),
      `${JSON.stringify(payload, null, 2)}\n`,
      'utf8'
    );
  }

  return { index, warnings };
}

const invokedDirectly = process.argv[1]?.endsWith('build-site.js');
if (invokedDirectly) {
  const { index, warnings } = await buildSite();
  for (const warning of warnings) process.stderr.write(`warning: ${warning}\n`);
  const cellCount = Object.keys(index.cells).length;
  process.stdout.write(
    `Built site data: ${index.guides.length} guides, ` +
    `${index.passages.length} passages, ${cellCount} cells, ` +
    `${warnings.length} warning(s).\n`
  );
}
