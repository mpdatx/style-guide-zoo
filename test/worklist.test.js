import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildWorklist } from '../runner/worklist.js';
import { buildRecord, recordPath, writeRecord } from '../runner/record.js';

const guides = [
  { id: 'g1', order: 1, sourceHash: 'sha256:g1' },
  { id: 'g2', order: 2, sourceHash: 'sha256:g2' }
];
const passages = [
  { id: 'p1', order: 1, sourceHash: 'sha256:p1' },
  { id: 'p2', order: 2, sourceHash: 'sha256:p2' }
];
const template = { id: 't', sourceHash: 'sha256:t' };

async function tmp() {
  return join(await mkdtemp(join(tmpdir(), 'sgz-')), 'runs');
}

function base(resultsDir, extra = {}) {
  return { guides, passages, template, runsPerCell: 2, resultsDir, ...extra };
}

async function seed(resultsDir, guide, passage, runIndex, overrides = {}) {
  const path = recordPath(resultsDir, guide.id, passage.id, runIndex);
  await writeRecord(path, buildRecord({
    guide, passage, template, runIndex,
    generatedAt: '2026-08-26T00:00:00.000Z',
    request: { backend: 'fake' },
    response: { ok: true, text: 'x' },
    ...overrides
  }));
  return path;
}

test('enumerates every guide x passage x run in deterministic order', async () => {
  const items = await buildWorklist(base(await tmp()));
  assert.equal(items.length, 8);
  assert.deepEqual(
    items.slice(0, 3).map((i) => `${i.guide.id}/${i.passage.id}/${i.runIndex}`),
    ['g1/p1/1', 'g1/p1/2', 'g1/p2/1']
  );
});

test('run indices start at 1', async () => {
  const items = await buildWorklist(base(await tmp()));
  assert.equal(Math.min(...items.map((i) => i.runIndex)), 1);
});

test('skips a cell run whose record is current', async () => {
  const dir = await tmp();
  await seed(dir, guides[0], passages[0], 1);
  const items = await buildWorklist(base(dir));
  assert.equal(items.length, 7);
  assert.ok(!items.some((i) => i.guide.id === 'g1' && i.passage.id === 'p1' && i.runIndex === 1));
});

test('does not skip a stale record', async () => {
  const dir = await tmp();
  await seed(dir, { ...guides[0], sourceHash: 'sha256:old' }, passages[0], 1);
  const items = await buildWorklist(base(dir));
  assert.equal(items.length, 8);
});

test('does not skip a failed record', async () => {
  const dir = await tmp();
  await seed(dir, guides[0], passages[0], 1, {
    response: { ok: false, error: { message: 'boom' } }
  });
  const items = await buildWorklist(base(dir));
  assert.equal(items.length, 8);
});

test('force includes cells that already have current records', async () => {
  const dir = await tmp();
  await seed(dir, guides[0], passages[0], 1);
  const items = await buildWorklist(base(dir, { force: true }));
  assert.equal(items.length, 8);
});

test('filters by guide id', async () => {
  const items = await buildWorklist(base(await tmp(), { filters: { guideIds: ['g2'] } }));
  assert.equal(items.length, 4);
  assert.ok(items.every((i) => i.guide.id === 'g2'));
});

test('filters by passage id', async () => {
  const items = await buildWorklist(base(await tmp(), { filters: { passageIds: ['p1'] } }));
  assert.equal(items.length, 4);
  assert.ok(items.every((i) => i.passage.id === 'p1'));
});

test('rejects an unknown filter id', async () => {
  await assert.rejects(
    () => buildWorklist(base('x', { filters: { guideIds: ['nope'] } })),
    /unknown guide/i
  );
});

test('each item carries the path its record will be written to', async () => {
  const dir = await tmp();
  const [first] = await buildWorklist(base(dir));
  assert.equal(first.path, recordPath(dir, 'g1', 'p1', 1));
});
