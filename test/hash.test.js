import test from 'node:test';
import assert from 'node:assert/strict';
import { sha256 } from '../runner/hash.js';

test('sha256 returns a prefixed 64-character hex digest', () => {
  const result = sha256('hello');
  assert.match(result, /^sha256:[0-9a-f]{64}$/);
});

test('sha256 is stable across line endings', () => {
  assert.equal(sha256('a\r\nb\r\n'), sha256('a\nb\n'));
});

test('sha256 changes when content changes', () => {
  assert.notEqual(sha256('a'), sha256('b'));
});
