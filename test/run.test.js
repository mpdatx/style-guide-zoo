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

test('parseArgs rejects a non-numeric --runs value', () => {
  assert.throws(() => parseArgs(['--runs', 'abc']), /--runs/);
  assert.throws(() => parseArgs(['--runs', 'abc']), /abc/);
});

test('parseArgs rejects a non-numeric --concurrency value', () => {
  assert.throws(() => parseArgs(['--concurrency', 'abc']), /--concurrency/);
  assert.throws(() => parseArgs(['--concurrency', 'abc']), /abc/);
});

test('parseArgs rejects a zero or negative --runs value', () => {
  assert.throws(() => parseArgs(['--runs', '0']), /--runs/);
  assert.throws(() => parseArgs(['--runs', '-1']), /--runs/);
});

test('parseArgs rejects a non-integer --concurrency value', () => {
  assert.throws(() => parseArgs(['--concurrency', '1.5']), /--concurrency/);
});

test('parseArgs rejects an unrecognized --backend value', () => {
  assert.throws(() => parseArgs(['--backend', 'real-money']), /backend/i);
});

test('parseArgs accepts the cli and fake backends', () => {
  assert.equal(parseArgs(['--backend', 'cli']).backend, 'cli');
  assert.equal(parseArgs(['--backend', 'fake']).backend, 'fake');
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

test('every expected record from a full fake run exists and is well-formed', async () => {
  const { code, resultsDir } = await runFake();
  assert.equal(code, 0);
  const guideIds = ['alpha', 'beta'];
  const passageIds = ['one', 'two'];
  for (const guideId of guideIds) {
    for (const passageId of passageIds) {
      for (const runIndex of [1, 2]) {
        const record = await readRecord(recordPath(resultsDir, guideId, passageId, runIndex));
        assert.ok(record, `missing record for ${guideId}/${passageId}/r${runIndex}`);
        assert.equal(record.run_id, `${guideId}__${passageId}__r${runIndex}`);
        assert.equal(record.run_index, runIndex);
        assert.equal(record.guide.id, guideId);
        assert.equal(record.passage.id, passageId);
        assert.equal(record.request.backend, 'fake');
        assert.equal(record.request.model_requested, 'claude-sonnet-5');
        assert.equal(typeof record.request.system_prompt, 'string');
        assert.ok(record.request.system_prompt.length > 0);
        assert.match(record.request.user_prompt, /rewrite this passage/i);
        assert.equal(record.response.ok, true);
        assert.equal(record.response.attempts, 1);
        assert.match(record.response.text, new RegExp(`\\[fake run ${runIndex}\\]`));
      }
    }
  }
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

test('a persistently failing cell is retried, recorded as a failure, and fails the run', async () => {
  const failingRunId = 'alpha__one__r1';
  const { code, resultsDir } = await runFake(['--fail-for', failingRunId]);

  // The run must still complete every other item.
  assert.equal(code, 1);
  const guideDirs = (await readdir(resultsDir)).sort();
  assert.deepEqual(guideDirs, ['alpha', 'beta']);
  const alphaOneFiles = (await readdir(join(resultsDir, 'alpha', 'one'))).sort();
  assert.deepEqual(alphaOneFiles, ['r1.json', 'r2.json']);

  const failed = await readRecord(recordPath(resultsDir, 'alpha', 'one', 1));
  assert.equal(failed.response.ok, false);
  assert.equal(failed.response.attempts, 3);
  assert.equal(failed.response.error.stage, 'spawn');
  assert.match(failed.response.error.message, /fake backend was told to fail/);

  // Everything else in the same cell and run succeeded normally.
  const other = await readRecord(recordPath(resultsDir, 'alpha', 'one', 2));
  assert.equal(other.response.ok, true);
  const untouched = await readRecord(recordPath(resultsDir, 'beta', 'two', 1));
  assert.equal(untouched.response.ok, true);
});

test('a fake run with no failures injected exits 0', async () => {
  const { code } = await runFake(['--fail-for', '']);
  assert.equal(code, 0);
});

test('a parse-stage failure is not retried, unlike spawn/timeout stages', async () => {
  const failingRunId = 'alpha__one__r1';
  const { code, resultsDir } = await runFake(['--fail-for', `${failingRunId}:parse`]);

  assert.equal(code, 1);
  const failed = await readRecord(recordPath(resultsDir, 'alpha', 'one', 1));
  assert.equal(failed.response.ok, false);
  assert.equal(failed.response.attempts, 1);
  assert.equal(failed.response.error.stage, 'parse');

  // Everything else still succeeded normally.
  const other = await readRecord(recordPath(resultsDir, 'alpha', 'one', 2));
  assert.equal(other.response.ok, true);
});

test('a cli-stage failure is not retried, unlike spawn/timeout stages', async () => {
  const failingRunId = 'beta__two__r1';
  const { code, resultsDir } = await runFake(['--fail-for', `${failingRunId}:cli`]);

  assert.equal(code, 1);
  const failed = await readRecord(recordPath(resultsDir, 'beta', 'two', 1));
  assert.equal(failed.response.ok, false);
  assert.equal(failed.response.attempts, 1);
  assert.equal(failed.response.error.stage, 'cli');
});
