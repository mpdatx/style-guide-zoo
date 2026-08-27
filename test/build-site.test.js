import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildSite } from '../build/build-site.js';
import { buildRecord, recordPath, writeRecord } from '../runner/record.js';

const GUIDES = 'test/fixtures/guides';
const CORPUS = 'test/fixtures/corpus';
const template = { id: 't', sourceHash: 'sha256:t' };

async function seeded() {
  const root = await mkdtemp(join(tmpdir(), 'sgz-'));
  const resultsDir = join(root, 'runs');
  const outDir = join(root, 'data');

  const cells = [
    ['alpha', 'one', 1, true], ['alpha', 'one', 2, true],
    ['alpha', 'two', 1, true], ['beta', 'one', 1, false]
  ];
  for (const [guideId, passageId, runIndex, ok] of cells) {
    await writeRecord(recordPath(resultsDir, guideId, passageId, runIndex), buildRecord({
      guide: { id: guideId, sourceHash: 'sha256:g' },
      passage: { id: passageId, sourceHash: 'sha256:p' },
      template,
      runIndex,
      generatedAt: '2026-08-26T00:00:00.000Z',
      request: {
        backend: 'fake', cli_version: 'fake-1', model_requested: 'm',
        argv: ['-p'], system_prompt: 'SYS', user_prompt: 'USR'
      },
      response: ok
        ? { ok: true, text: 'The cat sat on the mat. The dog ran.', duration_ms: 5 }
        : { ok: false, error: { message: 'boom', stage: 'spawn' } }
    }));
  }
  return { resultsDir, outDir };
}

function build({ resultsDir, outDir }) {
  return buildSite({
    guidesDir: GUIDES, corpusDir: CORPUS, resultsDir, outDir, runsPerCell: 2
  });
}

test('index lists every guide and passage, including cells with no runs', async () => {
  const { index } = await build(await seeded());
  assert.deepEqual(index.guides.map((g) => g.id), ['beta', 'alpha']);
  assert.deepEqual(index.passages.map((p) => p.id), ['one', 'two']);
  assert.equal(Object.keys(index.cells).length, 4);
});

test('index records run and failure counts per cell', async () => {
  const { index } = await build(await seeded());
  assert.equal(index.cells['alpha__one'].runs, 2);
  assert.equal(index.cells['alpha__one'].failures, 0);
  assert.equal(index.cells['beta__one'].runs, 1);
  assert.equal(index.cells['beta__one'].failures, 1);
  assert.equal(index.cells['beta__two'].runs, 0);
});

test('passages carry their own metrics for comparison', async () => {
  const { index } = await build(await seeded());
  assert.ok(index.passages[0].metrics.words > 0);
});

test('warns about a cell with no records', async () => {
  const { warnings } = await build(await seeded());
  assert.ok(warnings.some((w) => w.includes('beta__two')));
});

test('writes index.json and one file per cell', async () => {
  const seed = await seeded();
  await build(seed);
  const index = JSON.parse(await readFile(join(seed.outDir, 'index.json'), 'utf8'));
  assert.equal(index.schema_version, 1);
  const cell = JSON.parse(
    await readFile(join(seed.outDir, 'cells', 'alpha__one.json'), 'utf8')
  );
  assert.equal(cell.runs.length, 2);
  assert.deepEqual(cell.runs.map((r) => r.run_index), [1, 2]);
});

test('a cell run carries text, metrics, and full provenance', async () => {
  const seed = await seeded();
  await build(seed);
  const cell = JSON.parse(
    await readFile(join(seed.outDir, 'cells', 'alpha__one.json'), 'utf8')
  );
  const [run] = cell.runs;
  assert.equal(run.ok, true);
  assert.equal(run.text, 'The cat sat on the mat. The dog ran.');
  assert.equal(run.metrics.sentences, 2);
  assert.equal(run.request.system_prompt, 'SYS');
  assert.deepEqual(run.request.argv, ['-p']);
});

test('a run carries attempts and model_usage when present in the record', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sgz-'));
  const resultsDir = join(root, 'runs');
  const outDir = join(root, 'data');
  await writeRecord(recordPath(resultsDir, 'alpha', 'one', 1), buildRecord({
    guide: { id: 'alpha', sourceHash: 'sha256:g' },
    passage: { id: 'one', sourceHash: 'sha256:p' },
    template,
    runIndex: 1,
    generatedAt: '2026-08-26T00:00:00.000Z',
    request: {
      backend: 'fake', cli_version: 'fake-1', model_requested: 'm',
      argv: ['-p'], system_prompt: 'SYS', user_prompt: 'USR'
    },
    response: {
      ok: true,
      text: 'The cat sat on the mat.',
      duration_ms: 5,
      attempts: 2,
      model_usage: { 'claude-sonnet-5': { outputTokens: 42 } }
    }
  }));
  await buildSite({ guidesDir: GUIDES, corpusDir: CORPUS, resultsDir, outDir, runsPerCell: 1 });
  const cell = JSON.parse(
    await readFile(join(outDir, 'cells', 'alpha__one.json'), 'utf8')
  );
  const [run] = cell.runs;
  assert.equal(run.response.attempts, 2);
  assert.deepEqual(run.response.model_usage, { 'claude-sonnet-5': { outputTokens: 42 } });
});

test('a run without attempts or model_usage builds with documented defaults', async () => {
  const seed = await seeded();
  await build(seed);
  const cell = JSON.parse(
    await readFile(join(seed.outDir, 'cells', 'alpha__one.json'), 'utf8')
  );
  const [run] = cell.runs;
  assert.equal(run.response.attempts, null);
  assert.deepEqual(run.response.model_usage, {});
});

test('a failed run carries its error and no text', async () => {
  const seed = await seeded();
  await build(seed);
  const cell = JSON.parse(
    await readFile(join(seed.outDir, 'cells', 'beta__one.json'), 'utf8')
  );
  const [run] = cell.runs;
  assert.equal(run.ok, false);
  assert.equal(run.text, '');
  assert.equal(run.error.message, 'boom');
});

test('a run carries stop_reason when present in the record', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sgz-'));
  const resultsDir = join(root, 'runs');
  const outDir = join(root, 'data');
  await writeRecord(recordPath(resultsDir, 'alpha', 'one', 1), buildRecord({
    guide: { id: 'alpha', sourceHash: 'sha256:g' },
    passage: { id: 'one', sourceHash: 'sha256:p' },
    template,
    runIndex: 1,
    generatedAt: '2026-08-26T00:00:00.000Z',
    request: {
      backend: 'fake', cli_version: 'fake-1', model_requested: 'm',
      argv: ['-p'], system_prompt: 'SYS', user_prompt: 'USR'
    },
    response: {
      ok: false,
      duration_ms: 5,
      stop_reason: 'refusal',
      error: { message: 'CLI reported an error (stop_reason: refusal)', stage: 'cli' }
    }
  }));
  await buildSite({ guidesDir: GUIDES, corpusDir: CORPUS, resultsDir, outDir, runsPerCell: 1 });
  const cell = JSON.parse(
    await readFile(join(outDir, 'cells', 'alpha__one.json'), 'utf8')
  );
  const [run] = cell.runs;
  assert.equal(run.response.stop_reason, 'refusal');
});

test('a run without stop_reason defaults to null', async () => {
  const seed = await seeded();
  await build(seed);
  const cell = JSON.parse(
    await readFile(join(seed.outDir, 'cells', 'alpha__one.json'), 'utf8')
  );
  const [run] = cell.runs;
  assert.equal(run.response.stop_reason, null);
});

test('a cell with more runs than the default runsPerCell is fully surfaced when raised', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sgz-'));
  const resultsDir = join(root, 'runs');
  const outDir = join(root, 'data');
  for (let runIndex = 1; runIndex <= 7; runIndex += 1) {
    await writeRecord(recordPath(resultsDir, 'alpha', 'one', runIndex), buildRecord({
      guide: { id: 'alpha', sourceHash: 'sha256:g' },
      passage: { id: 'one', sourceHash: 'sha256:p' },
      template,
      runIndex,
      generatedAt: '2026-08-26T00:00:00.000Z',
      request: {
        backend: 'fake', cli_version: 'fake-1', model_requested: 'm',
        argv: ['-p'], system_prompt: 'SYS', user_prompt: 'USR'
      },
      response: { ok: true, text: 'The cat sat on the mat.', duration_ms: 5 }
    }));
  }
  // Default runsPerCell (5) would silently drop runs 6 and 7.
  const { index } = await buildSite({ guidesDir: GUIDES, corpusDir: CORPUS, resultsDir, outDir, runsPerCell: 7 });
  assert.equal(index.cells['alpha__one'].runs, 7);
  const cell = JSON.parse(
    await readFile(join(outDir, 'cells', 'alpha__one.json'), 'utf8')
  );
  assert.deepEqual(cell.runs.map((r) => r.run_index), [1, 2, 3, 4, 5, 6, 7]);
});
