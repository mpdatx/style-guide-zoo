import test from 'node:test';
import assert from 'node:assert/strict';
import { buildUserPrompt } from '../runner/prompt.js';

const template = { id: 't', body: 'Rewrite:\n\n<passage>\n{{PASSAGE}}\n</passage>' };
const passage = { id: 'p', title: 'Title', text: 'Hello world.' };

test('substitutes the passage text', () => {
  assert.equal(
    buildUserPrompt(template, passage),
    'Rewrite:\n\n<passage>\nHello world.\n</passage>'
  );
});

test('substitutes every occurrence of the placeholder', () => {
  assert.equal(
    buildUserPrompt({ id: 't', body: '{{PASSAGE}}|{{PASSAGE}}' }, passage),
    'Hello world.|Hello world.'
  );
});

test('treats `$&` in the passage as a literal, not a replacement pattern', () => {
  const tricky = { id: 'p', title: 'T', text: 'costs $& more' };
  assert.equal(buildUserPrompt({ id: 't', body: '[{{PASSAGE}}]' }, tricky), '[costs $& more]');
});
