import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadGuides, loadPassages, loadTemplate, loadConfig } from '../runner/content.js';

test('every guide in guides/ loads and validates', async () => {
  const guides = await loadGuides('guides');
  assert.ok(guides.length >= 9, `expected at least 9 guides, got ${guides.length}`);
});

// There is no generated control column. The baseline is the corpus passage
// itself, which the site reads from the index, so a guide that asks the model
// to echo its input back would be a wasted CLI call per cell.
test('no guide reproduces the passage as a control', async () => {
  const guides = await loadGuides('guides');
  assert.ok(!guides.some((g) => g.id === 'control'), 'the control guide was retired');
});

test('guide ids are unique and orders do not collide', async () => {
  const guides = await loadGuides('guides');
  assert.equal(new Set(guides.map((g) => g.id)).size, guides.length);
  assert.equal(new Set(guides.map((g) => g.order)).size, guides.length);
});

test('every passage in corpus/ loads and validates', async () => {
  const passages = await loadPassages('corpus');
  assert.ok(passages.length >= 9, `expected at least 9 passages, got ${passages.length}`);
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

// corpus/project-docs.md is an excerpt of this repository's own documentation.
// Two copies of the same prose drift apart silently, so assert they have not.
test('the project-docs passage matches docs/architecture.md verbatim', async () => {
  const passages = await loadPassages('corpus');
  const passage = passages.find((p) => p.id === 'project-docs');
  assert.ok(passage, 'the project-docs passage must exist');
  const doc = await readFile('docs/architecture.md', 'utf8');
  const flatten = (text) => text.replace(/\s+/g, ' ').trim();
  assert.ok(
    flatten(doc).includes(flatten(passage.text)),
    'corpus/project-docs.md is no longer a verbatim excerpt of docs/architecture.md'
  );
});
