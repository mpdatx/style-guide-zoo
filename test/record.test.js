import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  SCHEMA_VERSION, cellKey, recordPath, buildRecord, readRecord, writeRecord, isCurrent
} from '../runner/record.js';

const guide = { id: 'caveman', sourceHash: 'sha256:aaa' };
const passage = { id: 'gettysburg', sourceHash: 'sha256:bbb' };
const template = { id: 'rewrite-v1', sourceHash: 'sha256:ccc' };

function sample(overrides = {}) {
  return buildRecord({
    guide,
    passage,
    template,
    runIndex: 3,
    generatedAt: '2026-08-26T00:00:00.000Z',
    request: {
      backend: 'fake',
      cli_version: 'fake-1',
      model_requested: 'claude-sonnet-5',
      argv: ['-p', '--safe-mode'],
      system_prompt: 'SYS',
      user_prompt: 'USR'
    },
    response: { ok: true, text: 'OUT', duration_ms: 12 },
    ...overrides
  });
}

test('cellKey joins ids with a double underscore', () => {
  assert.equal(cellKey('caveman', 'gettysburg'), 'caveman__gettysburg');
});

test('recordPath nests guide, passage, and run index', () => {
  assert.equal(
    recordPath('results/runs', 'caveman', 'gettysburg', 3).replaceAll('\\', '/'),
    'results/runs/caveman/gettysburg/r3.json'
  );
});

test('buildRecord captures schema version, ids, hashes, and prompts', () => {
  const record = sample();
  assert.equal(record.schema_version, SCHEMA_VERSION);
  assert.equal(record.run_id, 'caveman__gettysburg__r3');
  assert.equal(record.run_index, 3);
  assert.equal(record.guide.source_hash, 'sha256:aaa');
  assert.equal(record.passage.source_hash, 'sha256:bbb');
  assert.equal(record.prompt_template.source_hash, 'sha256:ccc');
  assert.equal(record.request.system_prompt, 'SYS');
  assert.equal(record.response.text, 'OUT');
});

test('writeRecord creates parent directories and readRecord round-trips', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sgz-'));
  const path = recordPath(join(dir, 'runs'), 'caveman', 'gettysburg', 3);
  await writeRecord(path, sample());
  assert.deepEqual(await readRecord(path), sample());
});

test('writeRecord writes newline-terminated pretty JSON', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sgz-'));
  const path = join(dir, 'r1.json');
  await writeRecord(path, sample());
  const raw = await readFile(path, 'utf8');
  assert.ok(raw.endsWith('\n'));
  assert.ok(raw.includes('\n  "schema_version"'));
});

test('readRecord returns null for a missing file', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sgz-'));
  assert.equal(await readRecord(join(dir, 'nope.json')), null);
});

test('isCurrent is true when all three hashes and ok match', () => {
  assert.equal(isCurrent(sample(), { guide, passage, template }), true);
});

test('isCurrent is false when the guide hash changed', () => {
  const changed = { id: 'caveman', sourceHash: 'sha256:zzz' };
  assert.equal(isCurrent(sample(), { guide: changed, passage, template }), false);
});

test('isCurrent is false when the passage hash changed', () => {
  const changed = { id: 'gettysburg', sourceHash: 'sha256:zzz' };
  assert.equal(isCurrent(sample(), { guide, passage: changed, template }), false);
});

test('isCurrent is false when the template hash changed', () => {
  const changed = { id: 'rewrite-v1', sourceHash: 'sha256:zzz' };
  assert.equal(isCurrent(sample(), { guide, passage, template: changed }), false);
});

test('isCurrent is false for a failed record', () => {
  const failed = sample({ response: { ok: false, error: { message: 'boom' } } });
  assert.equal(isCurrent(failed, { guide, passage, template }), false);
});

test('isCurrent is false for a record from an older schema version', () => {
  const old = { ...sample(), schema_version: 0 };
  assert.equal(isCurrent(old, { guide, passage, template }), false);
});

test('isCurrent is false for null', () => {
  assert.equal(isCurrent(null, { guide, passage, template }), false);
});
