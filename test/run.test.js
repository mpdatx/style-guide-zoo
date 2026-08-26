import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs, main } from '../runner/run.js';
import { readRecord, recordPath } from '../runner/record.js';

test('parseArgs reads defaults', () => {
  const options = parseArgs([]);
  assert.equal(options.force, false);
  assert.equal(options.dryRun, false);
  assert.equal(options.backend, 'cli');
  assert.deepEqual(options.guideIds, []);
});

test('parseArgs splits comma-separated filters', () => {
  const options = parseArgs(['--guide', 'a,b', '--passage', 'c']);
  assert.deepEqual(options.guideIds, ['a', 'b']);
  assert.deepEqual(options.passageIds, ['c']);
});

test('parseArgs reads numeric and boolean flags', () => {
  const options = parseArgs(['--runs', '2', '--concurrency', '3', '--force', '--dry-run']);
  assert.equal(options.runs, 2);
  assert.equal(options.concurrency, 3);
  assert.equal(options.force, true);
  assert.equal(options.dryRun, true);
});

test('parseArgs rejects an unknown flag', () => {
  assert.throws(() => parseArgs(['--nope']), /unknown option/i);
});

async function runFake(extra = []) {
  const resultsDir = join(await mkdtemp(join(tmpdir(), 'sgz-')), 'runs');
  const code = await main([
    '--backend', 'fake',
    '--guides-dir', 'test/fixtures/guides',
    '--corpus-dir', 'test/fixtures/corpus',
    '--template', 'test/fixtures/prompts/rewrite-test.md',
    '--results-dir', resultsDir,
    '--runs', '2',
    '--quiet',
    ...extra
  ]);
  return { code, resultsDir };
}

test('a full fake run writes one record per guide x passage x run', async () => {
  const { code, resultsDir } = await runFake();
  assert.equal(code, 0);
  const guideDirs = (await readdir(resultsDir)).sort();
  assert.deepEqual(guideDirs, ['alpha', 'beta']);
  const files = await readdir(join(resultsDir, 'alpha', 'one'));
  assert.deepEqual(files.sort(), ['r1.json', 'r2.json']);
});

test('a written record contains the full prompts and backend metadata', async () => {
  const { resultsDir } = await runFake();
  const record = await readRecord(recordPath(resultsDir, 'alpha', 'one', 1));
  assert.equal(record.request.backend, 'fake');
  assert.equal(record.request.model_requested, 'claude-sonnet-5');
  assert.equal(record.request.system_prompt, 'Rewrite the text in the Alpha style.');
  assert.match(record.request.user_prompt, /quick brown fox/);
  assert.equal(record.response.ok, true);
  assert.match(record.response.text, /\[fake run 1\]/);
});

test('a second run is a no-op because every record is current', async () => {
  const { resultsDir } = await runFake();
  const before = await readRecord(recordPath(resultsDir, 'alpha', 'one', 1));
  const code = await main([
    '--backend', 'fake',
    '--guides-dir', 'test/fixtures/guides',
    '--corpus-dir', 'test/fixtures/corpus',
    '--template', 'test/fixtures/prompts/rewrite-test.md',
    '--results-dir', resultsDir,
    '--runs', '2',
    '--quiet'
  ]);
  assert.equal(code, 0);
  assert.deepEqual(await readRecord(recordPath(resultsDir, 'alpha', 'one', 1)), before);
});

test('dry run writes nothing', async () => {
  const { code, resultsDir } = await runFake(['--dry-run']);
  assert.equal(code, 0);
  await assert.rejects(() => readdir(resultsDir));
});

test('a filtered run only touches the named guide', async () => {
  const { resultsDir } = await runFake(['--guide', 'beta']);
  assert.deepEqual(await readdir(resultsDir), ['beta']);
});
