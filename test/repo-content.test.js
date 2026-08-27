import test from 'node:test';
import assert from 'node:assert/strict';
import { loadGuides, loadPassages, loadTemplate, loadConfig } from '../runner/content.js';

test('every guide in guides/ loads and validates', async () => {
  const guides = await loadGuides('guides');
  assert.ok(guides.length >= 13, `expected at least 13 guides, got ${guides.length}`);
  assert.ok(guides.some((g) => g.id === 'control'), 'the control guide must exist');
});

test('guide ids are unique and orders do not collide', async () => {
  const guides = await loadGuides('guides');
  assert.equal(new Set(guides.map((g) => g.id)).size, guides.length);
  assert.equal(new Set(guides.map((g) => g.order)).size, guides.length);
});

test('every passage in corpus/ loads and validates', async () => {
  const passages = await loadPassages('corpus');
  assert.ok(passages.length >= 8, `expected at least 8 passages, got ${passages.length}`);
});

test('passages span distinct genres', async () => {
  const passages = await loadPassages('corpus');
  assert.ok(new Set(passages.map((p) => p.genre)).size >= 6);
});

test('every passage declares a permissive licence', async () => {
  const passages = await loadPassages('corpus');
  for (const passage of passages) {
    assert.ok(
      ['public-domain', 'cc0-original'].includes(passage.license),
      `${passage.id} has licence ${passage.license}`
    );
  }
});

test('passages are substantial enough for style differences to show', async () => {
  for (const passage of await loadPassages('corpus')) {
    const words = passage.text.split(/\s+/).filter(Boolean).length;
    assert.ok(words >= 60, `${passage.id} has only ${words} words`);
  }
});

test('the configured prompt template loads', async () => {
  const config = await loadConfig('config/experiment.json');
  const template = await loadTemplate(config.prompt_template);
  assert.ok(template.body.includes('{{PASSAGE}}'));
});
