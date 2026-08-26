import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  loadGuides, loadPassages, loadTemplate, loadConfig, ContentError
} from '../runner/content.js';

const GUIDES = 'test/fixtures/guides';
const CORPUS = 'test/fixtures/corpus';

test('loads guides sorted by order then id', async () => {
  const guides = await loadGuides(GUIDES);
  assert.deepEqual(guides.map((g) => g.id), ['beta', 'alpha']);
});

test('a guide exposes its body as systemPrompt and a content hash', async () => {
  const [, alpha] = await loadGuides(GUIDES);
  assert.equal(alpha.id, 'alpha');
  assert.equal(alpha.name, 'Alpha Guide');
  assert.equal(alpha.systemPrompt, 'Rewrite the text in the Alpha style.');
  assert.match(alpha.sourceHash, /^sha256:[0-9a-f]{64}$/);
});

test('loads passages with their text', async () => {
  const passages = await loadPassages(CORPUS);
  assert.deepEqual(passages.map((p) => p.id), ['one', 'two']);
  assert.match(passages[1].text, /^Sphinx of black quartz/);
});

test('loads a prompt template', async () => {
  const template = await loadTemplate('test/fixtures/prompts/rewrite-test.md');
  assert.equal(template.id, 'rewrite-test');
  assert.match(template.body, /\{\{PASSAGE\}\}/);
});

test('loads the experiment config', async () => {
  const config = await loadConfig('config/experiment.json');
  assert.equal(config.runs_per_cell, 5);
  assert.ok(Array.isArray(config.cli_flags));
});

async function fixtureDir(files) {
  const dir = await mkdtemp(join(tmpdir(), 'sgz-'));
  for (const [name, body] of Object.entries(files)) {
    await writeFile(join(dir, name), body, 'utf8');
  }
  return dir;
}

test('rejects a guide whose id does not match its filename', async () => {
  const dir = await fixtureDir({
    'gamma.md': '---\nid: delta\nname: N\ndescription: D\norder: 1\n---\nBody\n'
  });
  await assert.rejects(() => loadGuides(dir), (error) => {
    assert.ok(error instanceof ContentError);
    assert.match(error.message, /filename/i);
    assert.match(error.file, /gamma\.md$/);
    return true;
  });
});

test('rejects a guide missing a required field', async () => {
  const dir = await fixtureDir({ 'gamma.md': '---\nid: gamma\n---\nBody\n' });
  await assert.rejects(() => loadGuides(dir), /name/);
});

test('rejects a guide with an empty body', async () => {
  const dir = await fixtureDir({
    'gamma.md': '---\nid: gamma\nname: N\ndescription: D\norder: 1\n---\n'
  });
  await assert.rejects(() => loadGuides(dir), /empty/i);
});

test('rejects a passage missing a required field', async () => {
  const dir = await fixtureDir({ 'solo.md': '---\nid: solo\ntitle: T\n---\nText\n' });
  await assert.rejects(() => loadPassages(dir), /genre/);
});
