import test from 'node:test';
import assert from 'node:assert/strict';
import { mapPool } from '../runner/pool.js';

test('returns results in input order', async () => {
  const out = await mapPool([3, 1, 2], 2, async (n) => {
    await new Promise((r) => setTimeout(r, n * 5));
    return n * 10;
  });
  assert.deepEqual(out, [30, 10, 20]);
});

test('never exceeds the concurrency limit', async () => {
  let active = 0;
  let peak = 0;
  await mapPool([1, 2, 3, 4, 5, 6], 2, async () => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((r) => setTimeout(r, 5));
    active -= 1;
  });
  assert.equal(peak, 2);
});

test('handles an empty input', async () => {
  assert.deepEqual(await mapPool([], 4, async () => 1), []);
});

test('passes the index to the worker', async () => {
  assert.deepEqual(await mapPool(['a', 'b'], 1, async (v, i) => `${i}${v}`), ['0a', '1b']);
});

test('rejects a NaN limit instead of silently doing nothing', async () => {
  await assert.rejects(() => mapPool([1, 2, 3], Number('abc'), async (n) => n), /limit/i);
});

test('rejects a zero limit', async () => {
  await assert.rejects(() => mapPool([1, 2, 3], 0, async (n) => n), /limit/i);
});

test('rejects a negative limit', async () => {
  await assert.rejects(() => mapPool([1, 2, 3], -2, async (n) => n), /limit/i);
});

test('rejects an infinite limit', async () => {
  await assert.rejects(() => mapPool([1, 2, 3], Infinity, async (n) => n), /limit/i);
});
