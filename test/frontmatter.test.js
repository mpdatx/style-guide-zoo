import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFrontmatter } from '../runner/frontmatter.js';

test('parses keys and returns the body', () => {
  const { data, body } = parseFrontmatter(
    '---\nid: caveman\nname: Caveman\n---\n\nBody text here.\n'
  );
  assert.equal(data.id, 'caveman');
  assert.equal(data.name, 'Caveman');
  assert.equal(body, 'Body text here.');
});

test('coerces integers and booleans but leaves other values as strings', () => {
  const { data } = parseFrontmatter('---\norder: 20\ndraft: true\nid: 10x\n---\nbody\n');
  assert.equal(data.order, 20);
  assert.equal(data.draft, true);
  assert.equal(data.id, '10x');
});

test('strips matching surrounding quotes', () => {
  const { data } = parseFrontmatter('---\nname: "The Economist: house style"\n---\nbody\n');
  assert.equal(data.name, 'The Economist: house style');
});

test('keeps colons that appear after the first one', () => {
  const { data } = parseFrontmatter('---\nsource_url: https://example.com/a\n---\nbody\n');
  assert.equal(data.source_url, 'https://example.com/a');
});

test('ignores blank lines and # comments inside the block', () => {
  const { data } = parseFrontmatter('---\n\n# a comment\nid: x\n---\nbody\n');
  assert.deepEqual(data, { id: 'x' });
});

test('throws when the document does not open with a fence', () => {
  assert.throws(() => parseFrontmatter('no frontmatter here'), /frontmatter/i);
});

test('throws when the closing fence is missing', () => {
  assert.throws(() => parseFrontmatter('---\nid: x\nbody without fence'), /closing/i);
});
