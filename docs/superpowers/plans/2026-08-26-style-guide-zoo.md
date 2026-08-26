# style-guide-zoo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a public repository that applies thirteen prose style guides to a shared corpus using the local `claude -p` CLI, records complete provenance for every generation, and publishes the outputs side by side on GitHub Pages.

**Architecture:** Three separate stages joined only by files on disk. Content lives in markdown files with frontmatter (`guides/`, `corpus/`, `prompts/`). A runner enumerates every (guide x passage x run) cell, skips cells whose recorded content hashes still match, and writes one JSON record per generation into `results/runs/`. A build step folds those records into `site/data/` JSON, which a dependency-free static page reads. Generation is always local and manual; CI only deploys.

**Tech Stack:** Node 22 (ESM, zero runtime dependencies), `node:test` for tests, `child_process.spawn` for the Claude Code CLI, vanilla HTML/CSS/JS for the site, GitHub Actions for Pages deployment.

**Spec:** `docs/superpowers/specs/2026-08-26-style-guide-zoo-design.md`

## Global Constraints

- **Node 22+.** ESM only (`"type": "module"`). Use `node:` prefixed builtin imports.
- **Zero runtime dependencies.** `package.json` must have no `dependencies` and no `devDependencies`. If a task seems to need a library, write the twenty lines instead.
- **No generation in CI.** The Pages workflow deploys committed files and runs nothing else.
- **Line endings.** The repo is developed on Windows. All hashing normalizes CRLF to LF before digesting, so a checkout's line endings never change a hash.
- **Record schema version is `1`.** The constant `SCHEMA_VERSION` lives in `runner/record.js` and is imported everywhere else; never hardcode the literal elsewhere.
- **Cell key format is `` `${guideId}__${passageId}` ``** everywhere it appears (record `run_id`, site data filenames, `index.json` keys).
- **Guide prompts are original prose.** Never transcribe text from a copyrighted style manual into `guides/`.
- **Every commit message** ends with the two trailer lines used in Task 1's example.
- **Tests never spawn `claude`.** The `fake` backend is the default in all tests.

---

### Task 1: Repository scaffolding, hashing, and frontmatter parsing

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `.gitattributes`
- Create: `runner/hash.js`
- Create: `runner/frontmatter.js`
- Test: `test/hash.test.js`
- Test: `test/frontmatter.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `sha256(text: string) -> string` — returns `"sha256:<64 hex chars>"`, normalizing `\r\n` to `\n` first.
  - `hashFile(filePath: string) -> Promise<string>` — same format, reads UTF-8.
  - `parseFrontmatter(text: string) -> { data: Record<string, string|number|boolean>, body: string }` — throws `Error` when the document does not open with a `---` fence.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "style-guide-zoo",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22" },
  "scripts": {
    "test": "node --test test/",
    "generate": "node runner/run.js",
    "build": "node build/build-site.js"
  }
}
```

- [ ] **Step 2: Create `.gitignore`**

```
node_modules/
.DS_Store
*.log
```

- [ ] **Step 3: Create `.gitattributes`**

This keeps committed JSON records byte-stable across platforms.

```
* text=auto eol=lf
```

- [ ] **Step 4: Write the failing hash test**

Create `test/hash.test.js`:

```js
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
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `node --test test/hash.test.js`
Expected: FAIL — cannot find module `../runner/hash.js`.

- [ ] **Step 6: Implement `runner/hash.js`**

```js
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

/** Normalize line endings so a Windows checkout hashes like a Linux one. */
function normalize(text) {
  return text.replace(/\r\n/g, '\n');
}

export function sha256(text) {
  const digest = createHash('sha256').update(normalize(text), 'utf8').digest('hex');
  return `sha256:${digest}`;
}

export async function hashFile(filePath) {
  return sha256(await readFile(filePath, 'utf8'));
}
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `node --test test/hash.test.js`
Expected: PASS, 3 tests.

- [ ] **Step 8: Write the failing frontmatter test**

Create `test/frontmatter.test.js`:

```js
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
```

- [ ] **Step 9: Run the test to verify it fails**

Run: `node --test test/frontmatter.test.js`
Expected: FAIL — cannot find module `../runner/frontmatter.js`.

- [ ] **Step 10: Implement `runner/frontmatter.js`**

This is a deliberately small subset of YAML: flat `key: value` pairs only. That is all the content files use, and it is why the project has no dependencies.

```js
function coerce(raw) {
  const value = raw.trim();
  const quoted = value.match(/^"(.*)"$/s) ?? value.match(/^'(.*)'$/s);
  if (quoted) return quoted[1];
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^-?\d+$/.test(value)) return Number(value);
  return value;
}

/**
 * Parse a flat `key: value` frontmatter block.
 * @returns {{ data: Record<string, string|number|boolean>, body: string }}
 */
export function parseFrontmatter(text) {
  const normalized = text.replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---\n')) {
    throw new Error('Document must begin with a `---` frontmatter fence');
  }
  const end = normalized.indexOf('\n---', 3);
  if (end === -1) {
    throw new Error('Frontmatter block has no closing `---` fence');
  }
  const block = normalized.slice(4, end);
  const body = normalized.slice(end + 4).replace(/^\n+/, '').trimEnd();

  const data = {};
  for (const line of block.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf(':');
    if (separator === -1) {
      throw new Error(`Frontmatter line is not \`key: value\`: ${trimmed}`);
    }
    data[trimmed.slice(0, separator).trim()] = coerce(trimmed.slice(separator + 1));
  }
  return { data, body };
}
```

- [ ] **Step 11: Run both tests to verify they pass**

Run: `node --test test/`
Expected: PASS, 10 tests.

- [ ] **Step 12: Commit**

```bash
git add package.json .gitignore .gitattributes runner/hash.js runner/frontmatter.js test/hash.test.js test/frontmatter.test.js
git commit -m "$(cat <<'EOF'
feat: add project scaffolding, content hashing, and frontmatter parsing

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016UxqbfmvGAwozK28X3jzgA
EOF
)"
```

---

### Task 2: Content loading and validation

**Files:**
- Create: `runner/content.js`
- Create: `config/experiment.json`
- Test: `test/content.test.js`
- Test fixtures: `test/fixtures/guides/*.md`, `test/fixtures/corpus/*.md`, `test/fixtures/prompts/rewrite-test.md`

**Interfaces:**
- Consumes: `parseFrontmatter` from `runner/frontmatter.js`, `sha256` from `runner/hash.js`.
- Produces:
  - `loadGuides(dir: string) -> Promise<Guide[]>` where
    `Guide = { id, name, description, source_url, license_note, order, systemPrompt, sourceHash, file }`,
    sorted by `order` then `id`.
  - `loadPassages(dir: string) -> Promise<Passage[]>` where
    `Passage = { id, title, genre, source, license, order, text, sourceHash, file }`,
    sorted by `order` then `id`.
  - `loadTemplate(filePath: string) -> Promise<Template>` where
    `Template = { id, body, sourceHash, file }`.
  - `loadConfig(filePath: string) -> Promise<Config>` where
    `Config = { model, runs_per_cell, prompt_template, concurrency, max_budget_usd, cli_flags: string[] }`.
  - `ContentError` — an `Error` subclass carrying a `file` property.

- [ ] **Step 1: Create `config/experiment.json`**

`cli_flags` is the fixed part of the argv, kept in config so a reader can see the isolation settings without reading code.

```json
{
  "model": "claude-sonnet-5",
  "runs_per_cell": 5,
  "prompt_template": "prompts/rewrite-v1.md",
  "concurrency": 4,
  "max_budget_usd": 25,
  "cli_flags": [
    "--safe-mode",
    "--no-session-persistence",
    "--strict-mcp-config",
    "--disable-slash-commands"
  ]
}
```

- [ ] **Step 2: Create the test fixtures**

Create `test/fixtures/guides/alpha.md`:

```markdown
---
id: alpha
name: Alpha Guide
description: A fixture guide.
source_url: https://example.com/alpha
license_note: Fixture.
order: 10
---

Rewrite the text in the Alpha style.
```

Create `test/fixtures/guides/beta.md`:

```markdown
---
id: beta
name: Beta Guide
description: Another fixture guide.
source_url: https://example.com/beta
license_note: Fixture.
order: 5
---

Rewrite the text in the Beta style.
```

Create `test/fixtures/corpus/one.md`:

```markdown
---
id: one
title: Passage One
genre: fixture
source: Authored for tests.
license: cc0-original
order: 10
---

The quick brown fox jumps over the lazy dog. It does so twice.
```

Create `test/fixtures/corpus/two.md`:

```markdown
---
id: two
title: Passage Two
genre: fixture
source: Authored for tests.
license: cc0-original
order: 20
---

Sphinx of black quartz, judge my vow.
```

Create `test/fixtures/prompts/rewrite-test.md`:

```markdown
---
id: rewrite-test
---

Rewrite this passage.

<passage>
{{PASSAGE}}
</passage>
```

- [ ] **Step 3: Write the failing content test**

Create `test/content.test.js`:

```js
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
```

Note: a duplicate-id check cannot be exercised through the filesystem because
the filename-match rule already makes duplicates impossible. The rule
subsumes it, so there is no separate duplicate test.

- [ ] **Step 4: Run the test to verify it fails**

Run: `node --test test/content.test.js`
Expected: FAIL — cannot find module `../runner/content.js`.

- [ ] **Step 5: Implement `runner/content.js`**

```js
import { readdir, readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { parseFrontmatter } from './frontmatter.js';
import { sha256 } from './hash.js';

export class ContentError extends Error {
  constructor(message, file) {
    super(`${message} (${file})`);
    this.name = 'ContentError';
    this.file = file;
  }
}

const GUIDE_FIELDS = ['id', 'name', 'description', 'order'];
const PASSAGE_FIELDS = ['id', 'title', 'genre', 'source', 'license', 'order'];

async function loadDir(dir, required, build) {
  const names = (await readdir(dir)).filter((n) => n.endsWith('.md')).sort();
  const items = [];
  for (const name of names) {
    const file = join(dir, name);
    const raw = await readFile(file, 'utf8');
    let parsed;
    try {
      parsed = parseFrontmatter(raw);
    } catch (error) {
      throw new ContentError(error.message, file);
    }
    const { data, body } = parsed;
    for (const field of required) {
      if (data[field] === undefined || data[field] === '') {
        throw new ContentError(`Missing required frontmatter field \`${field}\``, file);
      }
    }
    if (data.id !== basename(name, '.md')) {
      throw new ContentError(
        `Frontmatter id \`${data.id}\` does not match the filename`, file
      );
    }
    if (body.trim() === '') {
      throw new ContentError('Body is empty', file);
    }
    items.push(build(data, body, sha256(raw), file));
  }
  return items.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

export function loadGuides(dir = 'guides') {
  return loadDir(dir, GUIDE_FIELDS, (data, body, sourceHash, file) => ({
    id: data.id,
    name: data.name,
    description: data.description,
    source_url: data.source_url ?? '',
    license_note: data.license_note ?? '',
    order: data.order,
    systemPrompt: body,
    sourceHash,
    file
  }));
}

export function loadPassages(dir = 'corpus') {
  return loadDir(dir, PASSAGE_FIELDS, (data, body, sourceHash, file) => ({
    id: data.id,
    title: data.title,
    genre: data.genre,
    source: data.source,
    license: data.license,
    order: data.order,
    text: body,
    sourceHash,
    file
  }));
}

export async function loadTemplate(file) {
  const raw = await readFile(file, 'utf8');
  let parsed;
  try {
    parsed = parseFrontmatter(raw);
  } catch (error) {
    throw new ContentError(error.message, file);
  }
  if (!parsed.data.id) throw new ContentError('Missing required field `id`', file);
  if (!parsed.body.includes('{{PASSAGE}}')) {
    throw new ContentError('Template must contain the `{{PASSAGE}}` placeholder', file);
  }
  return { id: parsed.data.id, body: parsed.body, sourceHash: sha256(raw), file };
}

export async function loadConfig(file = 'config/experiment.json') {
  const config = JSON.parse(await readFile(file, 'utf8'));
  for (const field of ['model', 'runs_per_cell', 'prompt_template', 'concurrency']) {
    if (config[field] === undefined) {
      throw new ContentError(`Missing required config field \`${field}\``, file);
    }
  }
  config.cli_flags ??= [];
  return config;
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `node --test test/content.test.js`
Expected: PASS, 9 tests.

- [ ] **Step 7: Commit**

```bash
git add config/ runner/content.js test/content.test.js test/fixtures/
git commit -m "$(cat <<'EOF'
feat: load and validate guides, corpus passages, templates, and config

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016UxqbfmvGAwozK28X3jzgA
EOF
)"
```

---

### Task 3: Prompt assembly and the record schema

**Files:**
- Create: `runner/prompt.js`
- Create: `runner/record.js`
- Test: `test/prompt.test.js`
- Test: `test/record.test.js`

**Interfaces:**
- Consumes: `Guide`, `Passage`, `Template` from `runner/content.js`.
- Produces:
  - `buildUserPrompt(template: Template, passage: Passage) -> string`
  - `SCHEMA_VERSION: 1`
  - `cellKey(guideId, passageId) -> string`
  - `recordPath(resultsDir, guideId, passageId, runIndex) -> string`
  - `buildRecord({ guide, passage, template, runIndex, generatedAt, request, response }) -> object`
  - `readRecord(path) -> Promise<object|null>` (null when absent or unparseable)
  - `writeRecord(path, record) -> Promise<void>` (creates parent directories)
  - `isCurrent(record, { guide, passage, template }) -> boolean`

  where `request = { backend, cli_version, model_requested, argv, system_prompt, user_prompt }`
  and `response = { ok, text, model_reported, usage, total_cost_usd, duration_ms, session_id, num_turns, error }`.

- [ ] **Step 1: Write the failing prompt test**

Create `test/prompt.test.js`:

```js
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
```

The third test matters: `String.prototype.replace` interprets `$&` in the
replacement string, which would silently corrupt any passage containing it.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/prompt.test.js`
Expected: FAIL — cannot find module `../runner/prompt.js`.

- [ ] **Step 3: Implement `runner/prompt.js`**

```js
/**
 * Fill a prompt template with a passage. Uses a replacer function so that
 * `$&`, `$1` and friends inside the passage are treated literally.
 */
export function buildUserPrompt(template, passage) {
  return template.body.replaceAll('{{PASSAGE}}', () => passage.text);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/prompt.test.js`
Expected: PASS, 3 tests.

- [ ] **Step 5: Write the failing record test**

Create `test/record.test.js`:

```js
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
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `node --test test/record.test.js`
Expected: FAIL — cannot find module `../runner/record.js`.

- [ ] **Step 7: Implement `runner/record.js`**

```js
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export const SCHEMA_VERSION = 1;

export function cellKey(guideId, passageId) {
  return `${guideId}__${passageId}`;
}

export function recordPath(resultsDir, guideId, passageId, runIndex) {
  return join(resultsDir, guideId, passageId, `r${runIndex}.json`);
}

export function buildRecord({ guide, passage, template, runIndex, generatedAt, request, response }) {
  return {
    schema_version: SCHEMA_VERSION,
    run_id: `${cellKey(guide.id, passage.id)}__r${runIndex}`,
    run_index: runIndex,
    generated_at: generatedAt,
    guide: { id: guide.id, source_hash: guide.sourceHash },
    passage: { id: passage.id, source_hash: passage.sourceHash },
    prompt_template: { id: template.id, source_hash: template.sourceHash },
    request,
    response
  };
}

export async function readRecord(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return null;
  }
}

export async function writeRecord(path, record) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
}

/** True when this record was produced from exactly the current content. */
export function isCurrent(record, { guide, passage, template }) {
  return Boolean(
    record &&
    record.schema_version === SCHEMA_VERSION &&
    record.response?.ok === true &&
    record.guide?.source_hash === guide.sourceHash &&
    record.passage?.source_hash === passage.sourceHash &&
    record.prompt_template?.source_hash === template.sourceHash
  );
}
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `node --test test/`
Expected: PASS, all suites green.

- [ ] **Step 9: Commit**

```bash
git add runner/prompt.js runner/record.js test/prompt.test.js test/record.test.js
git commit -m "$(cat <<'EOF'
feat: add prompt assembly and the versioned generation record schema

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016UxqbfmvGAwozK28X3jzgA
EOF
)"
```

---

### Task 4: Work list and staleness detection

**Files:**
- Create: `runner/worklist.js`
- Test: `test/worklist.test.js`

**Interfaces:**
- Consumes: `recordPath`, `readRecord`, `isCurrent` from `runner/record.js`.
- Produces:
  - `buildWorklist({ guides, passages, template, runsPerCell, resultsDir, filters, force }) -> Promise<WorkItem[]>`
    where `WorkItem = { guide, passage, template, runIndex, path }` and
    `filters = { guideIds?: string[], passageIds?: string[] }`.
  - `applyFilters(items, ids, label) -> item[]` is internal; not exported.
  - Throws `Error` when a filter names an id that does not exist.
  - Order is guide order, then passage order, then run index ascending.

- [ ] **Step 1: Write the failing worklist test**

Create `test/worklist.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildWorklist } from '../runner/worklist.js';
import { buildRecord, recordPath, writeRecord } from '../runner/record.js';

const guides = [
  { id: 'g1', order: 1, sourceHash: 'sha256:g1' },
  { id: 'g2', order: 2, sourceHash: 'sha256:g2' }
];
const passages = [
  { id: 'p1', order: 1, sourceHash: 'sha256:p1' },
  { id: 'p2', order: 2, sourceHash: 'sha256:p2' }
];
const template = { id: 't', sourceHash: 'sha256:t' };

async function tmp() {
  return join(await mkdtemp(join(tmpdir(), 'sgz-')), 'runs');
}

function base(resultsDir, extra = {}) {
  return { guides, passages, template, runsPerCell: 2, resultsDir, ...extra };
}

async function seed(resultsDir, guide, passage, runIndex, overrides = {}) {
  const path = recordPath(resultsDir, guide.id, passage.id, runIndex);
  await writeRecord(path, buildRecord({
    guide, passage, template, runIndex,
    generatedAt: '2026-08-26T00:00:00.000Z',
    request: { backend: 'fake' },
    response: { ok: true, text: 'x' },
    ...overrides
  }));
  return path;
}

test('enumerates every guide x passage x run in deterministic order', async () => {
  const items = await buildWorklist(base(await tmp()));
  assert.equal(items.length, 8);
  assert.deepEqual(
    items.slice(0, 3).map((i) => `${i.guide.id}/${i.passage.id}/${i.runIndex}`),
    ['g1/p1/1', 'g1/p1/2', 'g1/p2/1']
  );
});

test('run indices start at 1', async () => {
  const items = await buildWorklist(base(await tmp()));
  assert.equal(Math.min(...items.map((i) => i.runIndex)), 1);
});

test('skips a cell run whose record is current', async () => {
  const dir = await tmp();
  await seed(dir, guides[0], passages[0], 1);
  const items = await buildWorklist(base(dir));
  assert.equal(items.length, 7);
  assert.ok(!items.some((i) => i.guide.id === 'g1' && i.passage.id === 'p1' && i.runIndex === 1));
});

test('does not skip a stale record', async () => {
  const dir = await tmp();
  await seed(dir, { ...guides[0], sourceHash: 'sha256:old' }, passages[0], 1);
  const items = await buildWorklist(base(dir));
  assert.equal(items.length, 8);
});

test('does not skip a failed record', async () => {
  const dir = await tmp();
  await seed(dir, guides[0], passages[0], 1, {
    response: { ok: false, error: { message: 'boom' } }
  });
  const items = await buildWorklist(base(dir));
  assert.equal(items.length, 8);
});

test('force includes cells that already have current records', async () => {
  const dir = await tmp();
  await seed(dir, guides[0], passages[0], 1);
  const items = await buildWorklist(base(dir, { force: true }));
  assert.equal(items.length, 8);
});

test('filters by guide id', async () => {
  const items = await buildWorklist(base(await tmp(), { filters: { guideIds: ['g2'] } }));
  assert.equal(items.length, 4);
  assert.ok(items.every((i) => i.guide.id === 'g2'));
});

test('filters by passage id', async () => {
  const items = await buildWorklist(base(await tmp(), { filters: { passageIds: ['p1'] } }));
  assert.equal(items.length, 4);
  assert.ok(items.every((i) => i.passage.id === 'p1'));
});

test('rejects an unknown filter id', async () => {
  await assert.rejects(
    () => buildWorklist(base('x', { filters: { guideIds: ['nope'] } })),
    /unknown guide/i
  );
});

test('each item carries the path its record will be written to', async () => {
  const dir = await tmp();
  const [first] = await buildWorklist(base(dir));
  assert.equal(first.path, recordPath(dir, 'g1', 'p1', 1));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/worklist.test.js`
Expected: FAIL — cannot find module `../runner/worklist.js`.

- [ ] **Step 3: Implement `runner/worklist.js`**

```js
import { isCurrent, readRecord, recordPath } from './record.js';

function applyFilter(items, ids, label) {
  if (!ids || ids.length === 0) return items;
  const known = new Set(items.map((i) => i.id));
  for (const id of ids) {
    if (!known.has(id)) throw new Error(`Unknown ${label} id: ${id}`);
  }
  const wanted = new Set(ids);
  return items.filter((i) => wanted.has(i.id));
}

/**
 * Enumerate every generation that still needs to happen.
 * A run is skipped when a record exists that was produced from exactly the
 * current guide, passage, and template content, and succeeded.
 */
export async function buildWorklist({
  guides, passages, template, runsPerCell, resultsDir, filters = {}, force = false
}) {
  const selectedGuides = applyFilter(guides, filters.guideIds, 'guide');
  const selectedPassages = applyFilter(passages, filters.passageIds, 'passage');

  const items = [];
  for (const guide of selectedGuides) {
    for (const passage of selectedPassages) {
      for (let runIndex = 1; runIndex <= runsPerCell; runIndex += 1) {
        const path = recordPath(resultsDir, guide.id, passage.id, runIndex);
        if (!force && isCurrent(await readRecord(path), { guide, passage, template })) {
          continue;
        }
        items.push({ guide, passage, template, runIndex, path });
      }
    }
  }
  return items;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/worklist.test.js`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add runner/worklist.js test/worklist.test.js
git commit -m "$(cat <<'EOF'
feat: enumerate generation work with content-hash staleness detection

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016UxqbfmvGAwozK28X3jzgA
EOF
)"
```

---

### Task 5: The fake backend and the runner orchestrator

**Files:**
- Create: `runner/backends/fake.js`
- Create: `runner/pool.js`
- Create: `runner/run.js`
- Test: `test/pool.test.js`
- Test: `test/run.test.js`

**Interfaces:**
- Consumes: everything from Tasks 2-4.
- Produces:
  - **Backend contract** — every backend is an object
    `{ name: string, version: string, generate({ systemPrompt, userPrompt, model, runIndex, runId }) -> Promise<GenerateResult> }`
    where `GenerateResult = { ok, text, model_reported, usage, total_cost_usd, duration_ms, session_id, num_turns, argv, error }`.
    `error` is `{ message, stage }` and is present only when `ok` is false.
  - `createFakeBackend({ failFor } = {}) -> Backend` — deterministic; `failFor`
    is an optional `Set` of `run_id`-shaped strings that should fail.
  - `mapPool(items, limit, worker) -> Promise<results[]>` — results in input order.
  - `parseArgs(argv: string[]) -> Options` and `main(argv) -> Promise<number>` from `runner/run.js`, where the number is the process exit code.

- [ ] **Step 1: Write the failing pool test**

Create `test/pool.test.js`:

```js
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/pool.test.js`
Expected: FAIL — cannot find module `../runner/pool.js`.

- [ ] **Step 3: Implement `runner/pool.js`**

```js
/** Run `worker` over `items` with at most `limit` in flight. Order preserved. */
export async function mapPool(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;

  async function drain() {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await worker(items[index], index);
    }
  }

  const width = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: width }, drain));
  return results;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/pool.test.js`
Expected: PASS, 4 tests.

- [ ] **Step 5: Implement `runner/backends/fake.js`**

No separate test file; it is exercised end to end by `test/run.test.js`.

```js
/**
 * A deterministic stand-in for the Claude Code CLI.
 * Produces text that varies by guide, passage, and run index so that tests
 * can tell records apart, without any network call or process spawn.
 */
export function createFakeBackend({ failFor = new Set() } = {}) {
  return {
    name: 'fake',
    version: 'fake-1',
    async generate({ systemPrompt, userPrompt, model, runIndex, runId }) {
      if (failFor.has(runId)) {
        return {
          ok: false,
          error: { message: 'fake backend was told to fail', stage: 'spawn' },
          argv: ['fake']
        };
      }
      const words = userPrompt.split(/\s+/).filter(Boolean).length;
      return {
        ok: true,
        text: `[fake run ${runIndex}] system=${systemPrompt.length} words=${words}`,
        model_reported: `${model}-fake`,
        usage: { input_tokens: words, output_tokens: 8 },
        total_cost_usd: 0,
        duration_ms: 1,
        session_id: `fake-${runId}`,
        num_turns: 1,
        argv: ['fake', '--model', model]
      };
    }
  };
}
```

- [ ] **Step 6: Write the failing runner test**

Create `test/run.test.js`:

```js
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
```

- [ ] **Step 7: Run the test to verify it fails**

Run: `node --test test/run.test.js`
Expected: FAIL — cannot find module `../runner/run.js`.

- [ ] **Step 8: Implement `runner/run.js`**

```js
import { loadConfig, loadGuides, loadPassages, loadTemplate } from './content.js';
import { buildRecord, writeRecord } from './record.js';
import { buildUserPrompt } from './prompt.js';
import { buildWorklist } from './worklist.js';
import { mapPool } from './pool.js';
import { createFakeBackend } from './backends/fake.js';
import { createCliBackend } from './backends/cli.js';

const FLAGS = new Set(['--force', '--dry-run', '--quiet', '--help']);
const VALUES = new Set([
  '--guide', '--passage', '--runs', '--concurrency', '--backend', '--model',
  '--guides-dir', '--corpus-dir', '--template', '--results-dir', '--config'
]);

export function parseArgs(argv) {
  const options = {
    guideIds: [], passageIds: [], runs: null, concurrency: null,
    backend: 'cli', model: null, force: false, dryRun: false, quiet: false, help: false,
    guidesDir: 'guides', corpusDir: 'corpus', templatePath: null,
    resultsDir: 'results/runs', configPath: 'config/experiment.json'
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (FLAGS.has(arg)) {
      if (arg === '--force') options.force = true;
      if (arg === '--dry-run') options.dryRun = true;
      if (arg === '--quiet') options.quiet = true;
      if (arg === '--help') options.help = true;
      continue;
    }
    if (!VALUES.has(arg)) throw new Error(`Unknown option: ${arg}`);
    const value = argv[i + 1];
    if (value === undefined) throw new Error(`Option ${arg} requires a value`);
    i += 1;
    if (arg === '--guide') options.guideIds = value.split(',').filter(Boolean);
    if (arg === '--passage') options.passageIds = value.split(',').filter(Boolean);
    if (arg === '--runs') options.runs = Number(value);
    if (arg === '--concurrency') options.concurrency = Number(value);
    if (arg === '--backend') options.backend = value;
    if (arg === '--model') options.model = value;
    if (arg === '--guides-dir') options.guidesDir = value;
    if (arg === '--corpus-dir') options.corpusDir = value;
    if (arg === '--template') options.templatePath = value;
    if (arg === '--results-dir') options.resultsDir = value;
    if (arg === '--config') options.configPath = value;
  }
  return options;
}

const USAGE = `Usage: node runner/run.js [options]

  --guide <ids>          comma-separated guide ids to restrict to
  --passage <ids>        comma-separated passage ids to restrict to
  --runs <n>             runs per cell (default: config runs_per_cell)
  --concurrency <n>      parallel generations (default: config concurrency)
  --backend <cli|fake>   generation backend (default: cli)
  --model <id>           override the configured model
  --force                regenerate cells that already have current records
  --dry-run              print the work list and exit without generating
  --quiet                suppress per-item progress output
  --help                 show this message
`;

export async function main(argv) {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write(USAGE);
    return 0;
  }

  const config = await loadConfig(options.configPath);
  const model = options.model ?? config.model;
  const runsPerCell = options.runs ?? config.runs_per_cell;
  const concurrency = options.concurrency ?? config.concurrency;

  const [guides, passages, template] = await Promise.all([
    loadGuides(options.guidesDir),
    loadPassages(options.corpusDir),
    loadTemplate(options.templatePath ?? config.prompt_template)
  ]);

  const worklist = await buildWorklist({
    guides, passages, template, runsPerCell,
    resultsDir: options.resultsDir,
    filters: { guideIds: options.guideIds, passageIds: options.passageIds },
    force: options.force
  });

  const log = options.quiet ? () => {} : (line) => process.stdout.write(`${line}\n`);
  log(`${worklist.length} generation(s) to run at concurrency ${concurrency} on ${model}.`);

  if (options.dryRun) {
    for (const item of worklist) {
      log(`  ${item.guide.id} / ${item.passage.id} / run ${item.runIndex}`);
    }
    return 0;
  }
  if (worklist.length === 0) return 0;

  const backend = options.backend === 'fake'
    ? createFakeBackend()
    : await createCliBackend({ maxBudgetUsd: config.max_budget_usd, extraFlags: config.cli_flags });

  let failures = 0;
  await mapPool(worklist, concurrency, async (item) => {
    const runId = `${item.guide.id}__${item.passage.id}__r${item.runIndex}`;
    const systemPrompt = item.guide.systemPrompt;
    const userPrompt = buildUserPrompt(item.template, item.passage);

    let result;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      result = await backend.generate({
        systemPrompt, userPrompt, model, runIndex: item.runIndex, runId
      });
      if (result.ok) break;
      if (attempt < 3) await new Promise((r) => setTimeout(r, 1000 * attempt));
    }

    const { argv: usedArgv = [], ...response } = result;
    await writeRecord(item.path, buildRecord({
      guide: item.guide,
      passage: item.passage,
      template: item.template,
      runIndex: item.runIndex,
      generatedAt: new Date().toISOString(),
      request: {
        backend: backend.name,
        cli_version: backend.version,
        model_requested: model,
        argv: usedArgv,
        system_prompt: systemPrompt,
        user_prompt: userPrompt
      },
      response
    }));

    if (!result.ok) failures += 1;
    log(`  ${result.ok ? 'ok  ' : 'FAIL'} ${runId}`);
  });

  log(`Done. ${worklist.length - failures} succeeded, ${failures} failed.`);
  return failures > 0 ? 1 : 0;
}

const invokedDirectly = process.argv[1]?.endsWith('run.js');
if (invokedDirectly) {
  main(process.argv.slice(2))
    .then((code) => { process.exitCode = code; })
    .catch((error) => {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    });
}
```

- [ ] **Step 9: Create a placeholder-free stub so the import resolves**

`runner/run.js` imports `createCliBackend`, which Task 6 implements. Create
`runner/backends/cli.js` now with the real signature and a body that throws,
so this task's tests (which always pass `--backend fake`) can run:

```js
export async function createCliBackend() {
  throw new Error('The cli backend is implemented in Task 6');
}
```

- [ ] **Step 10: Run the tests to verify they pass**

Run: `node --test test/`
Expected: PASS, all suites green.

- [ ] **Step 11: Commit**

```bash
git add runner/pool.js runner/run.js runner/backends/ test/pool.test.js test/run.test.js
git commit -m "$(cat <<'EOF'
feat: add the generation runner with a concurrency pool and fake backend

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016UxqbfmvGAwozK28X3jzgA
EOF
)"
```

---

### Task 6: The Claude Code CLI backend

**Files:**
- Modify: `runner/backends/cli.js` (replace the Task 5 stub entirely)
- Test: `test/backend-cli.test.js`

**Interfaces:**
- Consumes: the backend contract from Task 5.
- Produces:
  - `buildArgv({ model, systemPrompt, extraFlags, maxBudgetUsd }) -> string[]`
  - `parseEnvelope(stdout: string) -> GenerateResult` — throws on unparseable input.
  - `detectCliVersion({ claudePath }) -> Promise<string>`
  - `createCliBackend({ claudePath, extraFlags, maxBudgetUsd }) -> Promise<Backend>` — rejects with an install hint when `claude` is not on PATH.

- [ ] **Step 1: Write the failing CLI backend test**

Create `test/backend-cli.test.js`. These tests exercise argv construction and
envelope parsing only; nothing here spawns `claude`.

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildArgv, parseEnvelope } from '../runner/backends/cli.js';

const argvOptions = {
  model: 'claude-sonnet-5',
  systemPrompt: 'Be brief.',
  extraFlags: ['--safe-mode', '--no-session-persistence'],
  maxBudgetUsd: 25
};

test('argv requests print mode with a JSON envelope', () => {
  const argv = buildArgv(argvOptions);
  assert.ok(argv.includes('-p'));
  assert.deepEqual(
    argv.slice(argv.indexOf('--output-format'), argv.indexOf('--output-format') + 2),
    ['--output-format', 'json']
  );
});

test('argv disables all tools and pins the model', () => {
  const argv = buildArgv(argvOptions);
  assert.deepEqual(argv.slice(argv.indexOf('--tools'), argv.indexOf('--tools') + 2),
    ['--tools', '']);
  assert.deepEqual(argv.slice(argv.indexOf('--model'), argv.indexOf('--model') + 2),
    ['--model', 'claude-sonnet-5']);
});

test('argv carries the system prompt as a single argument', () => {
  const argv = buildArgv({ ...argvOptions, systemPrompt: 'Line one\nLine "two" $&' });
  assert.equal(argv[argv.indexOf('--system-prompt') + 1], 'Line one\nLine "two" $&');
});

test('argv includes the configured isolation flags', () => {
  const argv = buildArgv(argvOptions);
  assert.ok(argv.includes('--safe-mode'));
  assert.ok(argv.includes('--no-session-persistence'));
});

test('argv includes the budget cap when one is configured', () => {
  const argv = buildArgv(argvOptions);
  assert.deepEqual(
    argv.slice(argv.indexOf('--max-budget-usd'), argv.indexOf('--max-budget-usd') + 2),
    ['--max-budget-usd', '25']
  );
});

test('argv omits the budget cap when none is configured', () => {
  const argv = buildArgv({ ...argvOptions, maxBudgetUsd: undefined });
  assert.ok(!argv.includes('--max-budget-usd'));
});

test('argv does not contain the passage; it goes over stdin', () => {
  const argv = buildArgv(argvOptions);
  assert.ok(!argv.some((a) => a.includes('{{PASSAGE}}')));
});

const ENVELOPE = JSON.stringify({
  type: 'result',
  subtype: 'success',
  is_error: false,
  result: 'The rewritten text.',
  session_id: 'abc-123',
  duration_ms: 4200,
  num_turns: 1,
  total_cost_usd: 0.0123,
  modelUsage: { 'claude-sonnet-5-20260101': { inputTokens: 120, outputTokens: 80 } },
  usage: { input_tokens: 120, output_tokens: 80 }
});

test('parseEnvelope extracts the result text and metadata', () => {
  const parsed = parseEnvelope(ENVELOPE);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.text, 'The rewritten text.');
  assert.equal(parsed.session_id, 'abc-123');
  assert.equal(parsed.duration_ms, 4200);
  assert.equal(parsed.total_cost_usd, 0.0123);
  assert.equal(parsed.num_turns, 1);
  assert.deepEqual(parsed.usage, { input_tokens: 120, output_tokens: 80 });
});

test('parseEnvelope reports the model actually served', () => {
  assert.equal(parseEnvelope(ENVELOPE).model_reported, 'claude-sonnet-5-20260101');
});

test('parseEnvelope surfaces an error envelope as a failure', () => {
  const parsed = parseEnvelope(JSON.stringify({
    type: 'result', subtype: 'error_during_execution', is_error: true,
    result: 'something went wrong', session_id: 'x'
  }));
  assert.equal(parsed.ok, false);
  assert.equal(parsed.error.stage, 'cli');
  assert.match(parsed.error.message, /something went wrong/);
});

test('parseEnvelope tolerates leading and trailing whitespace', () => {
  assert.equal(parseEnvelope(`\n  ${ENVELOPE}\n`).ok, true);
});

test('parseEnvelope throws on unparseable output', () => {
  assert.throws(() => parseEnvelope('not json at all'), /parse/i);
});

test('parseEnvelope throws when the result field is missing', () => {
  assert.throws(() => parseEnvelope(JSON.stringify({ type: 'result' })), /result/i);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/backend-cli.test.js`
Expected: FAIL — `buildArgv` is not exported.

- [ ] **Step 3: Implement `runner/backends/cli.js`**

Replace the stub entirely.

```js
import { spawn } from 'node:child_process';

const CLAUDE = process.platform === 'win32' ? 'claude.cmd' : 'claude';

/**
 * Build the exact argument vector for one generation.
 * The passage never appears here: it is written to stdin, so no shell
 * quoting or command-line length limit is ever involved.
 */
export function buildArgv({ model, systemPrompt, extraFlags = [], maxBudgetUsd }) {
  const argv = [
    '-p',
    ...extraFlags,
    '--tools', '',
    '--model', model,
    '--system-prompt', systemPrompt,
    '--output-format', 'json'
  ];
  if (maxBudgetUsd !== undefined && maxBudgetUsd !== null) {
    argv.push('--max-budget-usd', String(maxBudgetUsd));
  }
  return argv;
}

function reportedModel(envelope) {
  const names = Object.keys(envelope.modelUsage ?? {});
  return names[0] ?? envelope.model ?? '';
}

/** Turn the `--output-format json` envelope into a GenerateResult. */
export function parseEnvelope(stdout) {
  let envelope;
  try {
    envelope = JSON.parse(stdout.trim());
  } catch {
    throw new Error(`Could not parse the CLI JSON envelope: ${stdout.slice(0, 200)}`);
  }
  if (typeof envelope.result !== 'string') {
    throw new Error('CLI envelope has no string `result` field');
  }
  const common = {
    model_reported: reportedModel(envelope),
    usage: envelope.usage ?? {},
    total_cost_usd: envelope.total_cost_usd ?? 0,
    duration_ms: envelope.duration_ms ?? 0,
    session_id: envelope.session_id ?? '',
    num_turns: envelope.num_turns ?? 0
  };
  if (envelope.is_error) {
    return {
      ok: false,
      ...common,
      error: { message: envelope.result, stage: 'cli' }
    };
  }
  return { ok: true, text: envelope.result, ...common };
}

function run(command, argv, stdin) {
  return new Promise((resolve) => {
    const child = spawn(command, argv, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => resolve({ code: -1, stdout, stderr: error.message }));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(stdin ?? '');
  });
}

export async function detectCliVersion({ claudePath = CLAUDE } = {}) {
  const { code, stdout, stderr } = await run(claudePath, ['--version'], '');
  if (code !== 0) {
    throw new Error(
      `Could not run \`${claudePath} --version\` (${stderr.trim()}). ` +
      'Install Claude Code and make sure it is on your PATH.'
    );
  }
  return stdout.trim();
}

export async function createCliBackend({ claudePath = CLAUDE, extraFlags = [], maxBudgetUsd } = {}) {
  const version = await detectCliVersion({ claudePath });
  return {
    name: 'claude-code-cli',
    version,
    async generate({ systemPrompt, userPrompt, model }) {
      const argv = buildArgv({ model, systemPrompt, extraFlags, maxBudgetUsd });
      const { code, stdout, stderr } = await run(claudePath, argv, userPrompt);
      if (code !== 0) {
        return {
          ok: false, argv,
          error: { message: `claude exited with code ${code}: ${stderr.trim()}`, stage: 'spawn' }
        };
      }
      try {
        return { ...parseEnvelope(stdout), argv };
      } catch (error) {
        return { ok: false, argv, error: { message: error.message, stage: 'parse' } };
      }
    }
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/backend-cli.test.js`
Expected: PASS, 14 tests.

- [ ] **Step 5: Verify the real CLI end to end with a single call**

This is the one manual check in the plan. It spends a few cents.

Run: `node runner/run.js --guides-dir test/fixtures/guides --corpus-dir test/fixtures/corpus --template test/fixtures/prompts/rewrite-test.md --results-dir results/smoke --guide alpha --passage one --runs 1`

Expected: one `ok` line, and `results/smoke/alpha/one/r1.json` containing a
real rewrite in `response.text`, a non-empty `response.model_reported`, and a
non-zero `response.duration_ms`.

If the envelope field names differ from those assumed in `parseEnvelope`,
correct `parseEnvelope` and its test to match the observed output — the real
envelope is the authority, not this plan.

- [ ] **Step 6: Delete the smoke output**

```bash
rm -rf results/smoke
```

- [ ] **Step 7: Run the full test suite**

Run: `node --test test/`
Expected: PASS, all suites green.

- [ ] **Step 8: Commit**

```bash
git add runner/backends/cli.js test/backend-cli.test.js
git commit -m "$(cat <<'EOF'
feat: generate through the Claude Code CLI with full argv provenance

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016UxqbfmvGAwozK28X3jzgA
EOF
)"
```

---

### Task 7: Author the prompt template, the guides, and the corpus

**Files:**
- Create: `prompts/rewrite-v1.md`
- Create: `guides/control.md`, `caveman.md`, `asd-ste100.md`, `economist.md`, `plain-language.md`, `strunk-white.md`, `google-devdocs.md`, `microsoft-style.md`, `chicago.md`, `hemingway.md`, `corporate-buzzword.md`, `pirate.md`, `haiku.md`
- Create: `corpus/gettysburg.md`, `moby-dick.md`, `declaration.md`, `origin-species.md`, `terms-of-service.md`, `news-lede.md`, `safety-notice.md`, `runbook.md`
- Create: `CORPUS-LICENSES.md`
- Test: `test/repo-content.test.js`

**Interfaces:**
- Consumes: `loadGuides`, `loadPassages`, `loadTemplate` from `runner/content.js`.
- Produces: the real content set. No new code interfaces.

This task is authoring rather than TDD, so the test is a validation gate over
the real content directories rather than a red-green cycle over new logic.

- [ ] **Step 1: Write the failing content validation test**

Create `test/repo-content.test.js`:

```js
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/repo-content.test.js`
Expected: FAIL — `guides` directory does not exist.

- [ ] **Step 3: Create `prompts/rewrite-v1.md`**

The template is deliberately thin: the style instruction lives in the system
prompt, and the user turn supplies only the passage and the output contract.

```markdown
---
id: rewrite-v1
---

Rewrite the passage below according to your style instructions.

Output only the rewritten passage. Do not add a preamble, a title, an
explanation, or any commentary about the changes you made.

<passage>
{{PASSAGE}}
</passage>
```

- [ ] **Step 4: Create the six core guides**

`guides/control.md` — the baseline column. Its body is a real instruction, so
the file passes the non-empty-body check and the control output is a
faithful reproduction rather than an accident.

```markdown
---
id: control
name: No style guide (control)
description: A baseline with no style instruction, for comparison against every other column.
source_url: ""
license_note: Original text.
order: 0
---

Reproduce the passage exactly as given, preserving its wording, punctuation,
and paragraph breaks. Make no stylistic changes of any kind.
```

`guides/caveman.md`:

```markdown
---
id: caveman
name: Caveman
description: Short, blunt, present tense, minimal grammar. The loudest possible demonstration of what a style constraint does.
source_url: ""
license_note: Original text.
order: 10
---

Rewrite the text as a caveman would speak it.

Use very short sentences. Use the present tense only. Drop articles ("the",
"a", "an") and most auxiliary verbs. Prefer concrete nouns and physical verbs.
Replace abstract concepts with the nearest physical thing a person could point
at. Keep every fact from the original, however plainly stated.

Do not use modern jargon. Do not add sound effects, grunts, or stage
directions.
```

`guides/asd-ste100.md`:

```markdown
---
id: asd-ste100
name: ASD-STE100 Simplified Technical English
description: The aerospace controlled-language standard, aimed at unambiguous procedural text for non-native readers.
source_url: https://www.asd-ste100.org/
license_note: Original paraphrase of the standard's principles. No text is reproduced from the specification.
order: 20
---

Rewrite the text following the principles of Simplified Technical English.

Use one topic per sentence. Keep procedural sentences to twenty words or
fewer and descriptive sentences to twenty-five words or fewer. Keep paragraphs
to six sentences or fewer.

Use the active voice. Address the reader directly with the imperative for
instructions. Use only the simple present, simple past, and simple future
tense.

Use one word for one meaning throughout, and one meaning for one word: never
vary a term for elegance. Prefer short, common words over long or technical
ones. Do not use noun clusters of more than three words. Write out what a
pronoun refers to whenever there is any doubt.

Do not use slang, idioms, or metaphors.
```

`guides/economist.md`:

```markdown
---
id: economist
name: The Economist house style
description: Terse, confident, plain Anglo-Saxon words; wit tolerated, jargon not.
source_url: https://www.economist.com/johnsons-style-guide
license_note: Original paraphrase of the publication's stated principles.
order: 30
---

Rewrite the text in the house style of The Economist.

Be brief. Be clear. Prefer the short word to the long one, the Anglo-Saxon to
the Latinate, the concrete to the abstract, and the active voice to the
passive. Cut every word that does the work of no word.

Never use a metaphor, simile, or figure of speech you have seen in print
before. Do not use jargon when plain English will do, and never use a foreign
phrase where an everyday English equivalent exists.

State conclusions plainly and with confidence. Dry wit is welcome; whimsy is
not. Do not hedge with "arguably", "it could be said that", or similar
padding.
```

`guides/plain-language.md`:

```markdown
---
id: plain-language
name: Plain language (government)
description: The plain-language standard used for public-facing government writing.
source_url: https://www.plainlanguage.gov/guidelines/
license_note: Original paraphrase of published plain-language guidelines.
order: 40
---

Rewrite the text in plain language, for a reader who has no background in the
subject and is reading in a hurry.

Address the reader as "you". Use the active voice and everyday words. Keep the
average sentence short. Put the most important information first, and put each
distinct idea in its own paragraph.

Replace jargon, legalese, and abbreviations with common words, or define them
on first use. Turn hidden verbs back into verbs: write "apply", not "submit an
application".

Where the original lists conditions or steps, use a bulleted or numbered list.
Keep every fact and every obligation from the original intact.
```

`guides/strunk-white.md`:

```markdown
---
id: strunk-white
name: Strunk & White
description: The Elements of Style: omit needless words, prefer the definite and concrete.
source_url: https://en.wikipedia.org/wiki/The_Elements_of_Style
license_note: Original paraphrase of the book's rules. No text is reproduced from the book.
order: 50
---

Rewrite the text following the rules of The Elements of Style.

Omit needless words. Every word must tell. Use the active voice. Put
statements in positive form: say what something is, not what it is not.

Use definite, specific, concrete language in preference to the vague and
abstract. Keep related words together. Express coordinate ideas in parallel
form. Place the emphatic words of a sentence at the end.

Make the paragraph the unit of composition, each with a clear topic sentence.
Write with nouns and verbs rather than adjectives and adverbs. Avoid
qualifiers such as "rather", "very", and "little".
```

- [ ] **Step 5: Create the three engineering-documentation guides**

`guides/google-devdocs.md`:

```markdown
---
id: google-devdocs
name: Google developer documentation style
description: Google's style guide for technical documentation: conversational but precise, second person, present tense.
source_url: https://developers.google.com/style
license_note: Original paraphrase of the publicly documented style rules.
order: 60
---

Rewrite the text following Google's developer documentation style.

Write in the second person and the present tense. Use the active voice and
standard American spelling. Be conversational without being chatty, and
friendly without being cute.

Prefer short sentences and short paragraphs. Use a numbered list for a
sequence of steps and a bulleted list for an unordered set. Begin each list
item with a capital letter.

Avoid the words "simply", "easily", "just", "obviously", and "of course": what
is obvious to the writer is rarely obvious to the reader. Do not use
placeholder words like "please" in instructions. Avoid metaphors and cultural
references that will not translate.

Use inclusive, unambiguous language and spell out an abbreviation on first
use.
```

`guides/microsoft-style.md`:

```markdown
---
id: microsoft-style
name: Microsoft Writing Style Guide
description: Warm and relaxed, crisp and clear, ready to lend a hand.
source_url: https://learn.microsoft.com/en-us/style-guide/welcome/
license_note: Original paraphrase of the publicly documented voice principles.
order: 70
---

Rewrite the text following the Microsoft writing style.

The voice is warm and relaxed, crisp and clear, and ready to lend a hand.
Write as one person talking to another: use contractions, use "you", and use
everyday words.

Get to the point fast. Lead with what matters most to the reader, then fill in
the detail. Use short sentences and scannable structure.

Use sentence case for any heading. Use the active voice and the present tense.
Be specific about what the reader should do and what will happen when they do
it.

Avoid jargon, hedging, and words that talk down to the reader.
```

`guides/chicago.md`:

```markdown
---
id: chicago
name: Chicago Manual of Style
description: Formal American publishing conventions: measured, precise, and fully punctuated.
source_url: https://www.chicagomanualofstyle.org/
license_note: Original paraphrase of widely known conventions. No text is reproduced from the manual.
order: 80
---

Rewrite the text in formal American prose following Chicago Manual of Style
conventions.

Use the serial comma. Spell out whole numbers from one through one hundred and
any round number, and use numerals above that. Use double quotation marks for
quoted material, with commas and periods inside the closing quotation mark.
Use an em dash without surrounding spaces for a parenthetical break.

Maintain a measured, formal register. Prefer complete sentences and full
subordination to fragments. Use standard American spelling. Do not use
contractions.

Preserve the argument and every fact of the original; change only the prose.
```

- [ ] **Step 6: Create the four wildcard guides**

`guides/hemingway.md`:

```markdown
---
id: hemingway
name: Hemingway
description: Short declarative sentences, concrete nouns, almost no subordination.
source_url: ""
license_note: Original text describing a prose manner, not reproducing any work.
order: 90
---

Rewrite the text in the manner of Ernest Hemingway's prose.

Use short declarative sentences. Join them with "and" more often than with
subordinating conjunctions. Use concrete nouns and plain verbs. Name things
rather than describing them.

Cut adjectives and adverbs to almost nothing. State actions and facts without
interpreting them. Let the emotion sit under the surface of the sentence
rather than on top of it. Repeat a plain word rather than reaching for a
synonym.

Do not imitate any specific published passage.
```

`guides/corporate-buzzword.md`:

```markdown
---
id: corporate-buzzword
name: Corporate buzzword
description: The anti-pattern column: maximum abstraction, minimum content.
source_url: ""
license_note: Original text.
order: 100
---

Rewrite the text in dense corporate business jargon.

Replace concrete nouns with abstractions. Turn verbs into nominalisations:
prefer "the utilisation of" to "using". Use the passive voice so that no
sentence names who acts. Reach for "leverage", "synergy", "stakeholder",
"alignment", "operationalise", "value-add", and "at scale".

Hedge every claim. Add qualifying clauses that commit to nothing.

Keep the underlying facts of the original technically present, however deeply
buried. This column exists as a demonstration of what these habits cost.
```

`guides/pirate.md`:

```markdown
---
id: pirate
name: Pirate
description: Stage pirate dialect, for an unmistakable register shift.
source_url: ""
license_note: Original text.
order: 110
---

Rewrite the text as a stage pirate would tell it.

Use "ye" for "you", "be" for "is" and "are", and "aye" for "yes". Use nautical
vocabulary: crew, deck, helm, cargo, port, tide, chart. Address the reader as
a shipmate. Add "arr" sparingly, at most once per paragraph.

Keep every fact of the original. Do not add a plot, a ship, or characters that
were not in the source.
```

`guides/haiku.md`:

```markdown
---
id: haiku
name: Haiku sequence
description: A hard structural constraint, to show what happens when a style guide is a form rather than a manner.
source_url: ""
license_note: Original text.
order: 120
---

Rewrite the text as a sequence of haiku.

Each haiku has three lines of five, seven, and five syllables. Separate
consecutive haiku with a blank line. Use as many haiku as the content needs.

Work through the original in order, so the sequence carries the passage's
argument from beginning to end. Prefer concrete images to abstractions. Do not
add a title, a number, or any commentary.
```

- [ ] **Step 7: Create the four public-domain corpus passages**

Verify each text against Project Gutenberg or another authoritative source
before committing; transcribe exactly.

`corpus/gettysburg.md` — frontmatter, then the full text of Lincoln's
Gettysburg Address (1863), Bliss copy, beginning "Four score and seven years
ago our fathers brought forth on this continent, a new nation, conceived in
Liberty".

```markdown
---
id: gettysburg
title: The Gettysburg Address
genre: oratory
source: Abraham Lincoln, 1863. Bliss copy.
license: public-domain
order: 10
---

<the full address, transcribed exactly>
```

`corpus/moby-dick.md` — the first paragraph of *Moby-Dick* (Melville, 1851),
beginning "Call me Ishmael", continuing to the end of that paragraph
("...and bringing up the rear of every funeral I meet; and especially whenever
my hypos get such an upper hand of me..."). Include enough of the paragraph to
exceed sixty words.

```markdown
---
id: moby-dick
title: Moby-Dick, opening paragraph
genre: narrative fiction
source: Herman Melville, 1851.
license: public-domain
order: 20
---

<the opening paragraph, transcribed exactly>
```

`corpus/declaration.md` — the second paragraph of the United States
Declaration of Independence (1776), beginning "We hold these truths to be
self-evident", through "...and to institute new Government".

```markdown
---
id: declaration
title: Declaration of Independence, second paragraph
genre: political rhetoric
source: United States, 1776.
license: public-domain
order: 30
---

<the paragraph, transcribed exactly>
```

`corpus/origin-species.md` — the closing paragraph of *On the Origin of
Species* (Darwin, 1859, first edition), beginning "It is interesting to
contemplate an entangled bank" and ending "...endless forms most beautiful and
most wonderful have been, and are being, evolved."

```markdown
---
id: origin-species
title: On the Origin of Species, closing paragraph
genre: scientific prose
source: Charles Darwin, 1859, first edition.
license: public-domain
order: 40
---

<the closing paragraph, transcribed exactly>
```

- [ ] **Step 8: Write the four original CC0 corpus passages**

These are authored for this repository, which is why they carry the
`cc0-original` licence. They cover the registers the public-domain texts do
not, and the last two are the seed of the more technically relevant corpus.

Write each one yourself to the described brief, at 90-160 words. They must be
genuinely awful in the specific way each brief names — that is what makes the
style guides' effect visible.

`corpus/terms-of-service.md` — genre `legal boilerplate`, order 50. A clause
from a fictional service's terms: one 70-word sentence, four levels of
subordination, defined terms in capitals ("the Service", "the Subscriber"),
and at least three instances of the passive voice with no named actor.

`corpus/news-lede.md` — genre `news`, order 60. The opening of a report on a
fictional municipal budget vote: a buried lede, an attribution stack three
sources deep, two numbers presented without a baseline for comparison, and a
closing quotation that says nothing.

`corpus/safety-notice.md` — genre `safety instructions`, order 70. A warning
notice for a fictional piece of workshop equipment: procedural steps written
as prose rather than a list, conditions stated after the action they govern,
and a mix of "must", "should", and "may" used inconsistently.

`corpus/runbook.md` — genre `technical procedure`, order 80. An on-call
runbook step for a fictional service: five-word noun clusters, three
undefined internal acronyms, an ambiguous pronoun, and a step whose
precondition is only implied.

- [ ] **Step 9: Create `CORPUS-LICENSES.md`**

```markdown
# Corpus provenance

Every passage in `corpus/` is either public domain or original text written
for this repository and released under CC0. No copyrighted text is
redistributed here.

| Passage | Genre | Source | Licence |
|---|---|---|---|
| `gettysburg` | oratory | Abraham Lincoln, 1863 (Bliss copy) | Public domain |
| `moby-dick` | narrative fiction | Herman Melville, *Moby-Dick*, 1851 | Public domain |
| `declaration` | political rhetoric | United States, 1776 | Public domain |
| `origin-species` | scientific prose | Charles Darwin, *On the Origin of Species*, 1859 | Public domain |
| `terms-of-service` | legal boilerplate | Written for this repository | CC0 |
| `news-lede` | news | Written for this repository | CC0 |
| `safety-notice` | safety instructions | Written for this repository | CC0 |
| `runbook` | technical procedure | Written for this repository | CC0 |

The organisations and services named in the CC0 passages are fictional.

## Style guides

The prompts in `guides/` are original prose written for this repository and
released under the MIT licence with the rest of the code. They describe the
principles of the named style guides; they do not reproduce text from any of
them. Where a guide corresponds to a published standard or manual, the file's
`source_url` points at the authoritative document.
```

- [ ] **Step 10: Run the validation test to verify it passes**

Run: `node --test test/repo-content.test.js`
Expected: PASS, 7 tests.

- [ ] **Step 11: Verify the full matrix enumerates correctly**

Run: `node runner/run.js --dry-run`
Expected: `520 generation(s) to run at concurrency 4 on claude-sonnet-5.`
(13 guides x 8 passages x 5 runs). Nothing is written.

- [ ] **Step 12: Commit**

```bash
git add prompts/ guides/ corpus/ CORPUS-LICENSES.md test/repo-content.test.js
git commit -m "$(cat <<'EOF'
feat: add the prompt template, thirteen style guides, and the corpus

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016UxqbfmvGAwozK28X3jzgA
EOF
)"
```

---

### Task 8: Readability metrics

**Files:**
- Create: `build/metrics.js`
- Test: `test/metrics.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `computeMetrics(text: string) -> { words, sentences, syllables, mean_sentence_length, flesch_reading_ease }`.
  `mean_sentence_length` and `flesch_reading_ease` are rounded to one decimal
  place; an empty input yields zeros.

- [ ] **Step 1: Write the failing metrics test**

Create `test/metrics.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { computeMetrics } from '../build/metrics.js';

test('counts words and sentences', () => {
  const m = computeMetrics('The cat sat. The dog ran!');
  assert.equal(m.words, 6);
  assert.equal(m.sentences, 2);
});

test('counts a final sentence with no terminating punctuation', () => {
  assert.equal(computeMetrics('One two three').sentences, 1);
});

test('does not split on an abbreviation-free decimal', () => {
  assert.equal(computeMetrics('It cost 3.50 dollars today.').sentences, 1);
});

test('treats consecutive terminators as one sentence break', () => {
  assert.equal(computeMetrics('Really?! Yes.').sentences, 2);
});

test('computes mean sentence length to one decimal', () => {
  assert.equal(computeMetrics('a b c. d e.').mean_sentence_length, 2.5);
});

test('counts syllables by vowel groups, ignoring a silent final e', () => {
  assert.equal(computeMetrics('cake').syllables, 1);
  assert.equal(computeMetrics('running').syllables, 2);
  assert.equal(computeMetrics('a').syllables, 1);
});

test('scores simple prose higher than complex prose', () => {
  const simple = computeMetrics('The cat sat on the mat. The dog ran.');
  const complex = computeMetrics(
    'Notwithstanding the aforementioned considerations, the utilisation of ' +
    'supplementary infrastructure necessitates comprehensive reevaluation.'
  );
  assert.ok(simple.flesch_reading_ease > complex.flesch_reading_ease);
});

test('returns zeros for empty input', () => {
  assert.deepEqual(computeMetrics('   '), {
    words: 0, sentences: 0, syllables: 0,
    mean_sentence_length: 0, flesch_reading_ease: 0
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/metrics.test.js`
Expected: FAIL — cannot find module `../build/metrics.js`.

- [ ] **Step 3: Implement `build/metrics.js`**

```js
/** Approximate syllable count: vowel groups, minus a silent trailing `e`. */
function countSyllables(word) {
  const clean = word.toLowerCase().replace(/[^a-z]/g, '');
  if (clean === '') return 0;
  const groups = clean.match(/[aeiouy]+/g) ?? [];
  let count = groups.length;
  if (clean.endsWith('e') && !clean.endsWith('le') && count > 1) count -= 1;
  return Math.max(1, count);
}

const round1 = (n) => Math.round(n * 10) / 10;

/**
 * Descriptive statistics for one piece of prose. These are not scores:
 * they describe the text, they do not judge it.
 */
export function computeMetrics(text) {
  const words = text.split(/\s+/).filter((w) => /[a-z0-9]/i.test(w));
  const sentences = text
    .split(/[.!?]+(?=\s|$)/)
    .map((s) => s.trim())
    .filter((s) => s !== '');

  if (words.length === 0) {
    return {
      words: 0, sentences: 0, syllables: 0,
      mean_sentence_length: 0, flesch_reading_ease: 0
    };
  }

  const syllables = words.reduce((sum, word) => sum + countSyllables(word), 0);
  const sentenceCount = Math.max(1, sentences.length);
  const wordsPerSentence = words.length / sentenceCount;
  const syllablesPerWord = syllables / words.length;

  return {
    words: words.length,
    sentences: sentenceCount,
    syllables,
    mean_sentence_length: round1(wordsPerSentence),
    flesch_reading_ease: round1(206.835 - 1.015 * wordsPerSentence - 84.6 * syllablesPerWord)
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/metrics.test.js`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add build/metrics.js test/metrics.test.js
git commit -m "$(cat <<'EOF'
feat: add descriptive readability metrics for generated outputs

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016UxqbfmvGAwozK28X3jzgA
EOF
)"
```

---

### Task 9: The site data build

**Files:**
- Create: `build/build-site.js`
- Test: `test/build-site.test.js`

**Interfaces:**
- Consumes: `loadGuides`, `loadPassages` (Task 2), `readRecord`, `cellKey`
  (Task 3), `computeMetrics` (Task 8).
- Produces:
  - `buildSite({ guidesDir, corpusDir, resultsDir, outDir, runsPerCell }) -> Promise<{ index, warnings: string[] }>`
  - Writes `<outDir>/index.json` and `<outDir>/cells/<cellKey>.json`.

`index.json` shape:

```json
{
  "schema_version": 1,
  "guides": [{ "id": "", "name": "", "description": "", "source_url": "", "license_note": "", "order": 0 }],
  "passages": [{ "id": "", "title": "", "genre": "", "source": "", "license": "", "order": 0, "text": "", "metrics": {} }],
  "cells": {
    "caveman__gettysburg": {
      "guide_id": "caveman",
      "passage_id": "gettysburg",
      "runs": 5,
      "failures": 0,
      "file": "cells/caveman__gettysburg.json"
    }
  }
}
```

Cell file shape:

```json
{
  "guide_id": "caveman",
  "passage_id": "gettysburg",
  "runs": [{
    "run_index": 1,
    "ok": true,
    "text": "",
    "metrics": {},
    "generated_at": "",
    "request": { "backend": "", "cli_version": "", "model_requested": "", "argv": [], "system_prompt": "", "user_prompt": "" },
    "response": { "model_reported": "", "usage": {}, "total_cost_usd": 0, "duration_ms": 0, "session_id": "", "num_turns": 0 },
    "error": null
  }]
}
```

- [ ] **Step 1: Write the failing build test**

Create `test/build-site.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildSite } from '../build/build-site.js';
import { buildRecord, recordPath, writeRecord } from '../runner/record.js';

const GUIDES = 'test/fixtures/guides';
const CORPUS = 'test/fixtures/corpus';
const template = { id: 't', sourceHash: 'sha256:t' };

async function seeded() {
  const root = await mkdtemp(join(tmpdir(), 'sgz-'));
  const resultsDir = join(root, 'runs');
  const outDir = join(root, 'data');

  const cells = [
    ['alpha', 'one', 1, true], ['alpha', 'one', 2, true],
    ['alpha', 'two', 1, true], ['beta', 'one', 1, false]
  ];
  for (const [guideId, passageId, runIndex, ok] of cells) {
    await writeRecord(recordPath(resultsDir, guideId, passageId, runIndex), buildRecord({
      guide: { id: guideId, sourceHash: 'sha256:g' },
      passage: { id: passageId, sourceHash: 'sha256:p' },
      template,
      runIndex,
      generatedAt: '2026-08-26T00:00:00.000Z',
      request: {
        backend: 'fake', cli_version: 'fake-1', model_requested: 'm',
        argv: ['-p'], system_prompt: 'SYS', user_prompt: 'USR'
      },
      response: ok
        ? { ok: true, text: 'The cat sat on the mat. The dog ran.', duration_ms: 5 }
        : { ok: false, error: { message: 'boom', stage: 'spawn' } }
    }));
  }
  return { resultsDir, outDir };
}

function build({ resultsDir, outDir }) {
  return buildSite({
    guidesDir: GUIDES, corpusDir: CORPUS, resultsDir, outDir, runsPerCell: 2
  });
}

test('index lists every guide and passage, including cells with no runs', async () => {
  const { index } = await build(await seeded());
  assert.deepEqual(index.guides.map((g) => g.id), ['beta', 'alpha']);
  assert.deepEqual(index.passages.map((p) => p.id), ['one', 'two']);
  assert.equal(Object.keys(index.cells).length, 4);
});

test('index records run and failure counts per cell', async () => {
  const { index } = await build(await seeded());
  assert.equal(index.cells['alpha__one'].runs, 2);
  assert.equal(index.cells['alpha__one'].failures, 0);
  assert.equal(index.cells['beta__one'].runs, 1);
  assert.equal(index.cells['beta__one'].failures, 1);
  assert.equal(index.cells['beta__two'].runs, 0);
});

test('passages carry their own metrics for comparison', async () => {
  const { index } = await build(await seeded());
  assert.ok(index.passages[0].metrics.words > 0);
});

test('warns about a cell with no records', async () => {
  const { warnings } = await build(await seeded());
  assert.ok(warnings.some((w) => w.includes('beta__two')));
});

test('writes index.json and one file per cell', async () => {
  const seed = await seeded();
  await build(seed);
  const index = JSON.parse(await readFile(join(seed.outDir, 'index.json'), 'utf8'));
  assert.equal(index.schema_version, 1);
  const cell = JSON.parse(
    await readFile(join(seed.outDir, 'cells', 'alpha__one.json'), 'utf8')
  );
  assert.equal(cell.runs.length, 2);
  assert.deepEqual(cell.runs.map((r) => r.run_index), [1, 2]);
});

test('a cell run carries text, metrics, and full provenance', async () => {
  const seed = await seeded();
  await build(seed);
  const cell = JSON.parse(
    await readFile(join(seed.outDir, 'cells', 'alpha__one.json'), 'utf8')
  );
  const [run] = cell.runs;
  assert.equal(run.ok, true);
  assert.equal(run.text, 'The cat sat on the mat. The dog ran.');
  assert.equal(run.metrics.sentences, 2);
  assert.equal(run.request.system_prompt, 'SYS');
  assert.deepEqual(run.request.argv, ['-p']);
});

test('a failed run carries its error and no text', async () => {
  const seed = await seeded();
  await build(seed);
  const cell = JSON.parse(
    await readFile(join(seed.outDir, 'cells', 'beta__one.json'), 'utf8')
  );
  const [run] = cell.runs;
  assert.equal(run.ok, false);
  assert.equal(run.text, '');
  assert.equal(run.error.message, 'boom');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/build-site.test.js`
Expected: FAIL — cannot find module `../build/build-site.js`.

- [ ] **Step 3: Implement `build/build-site.js`**

```js
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadGuides, loadPassages } from '../runner/content.js';
import { cellKey, readRecord, recordPath } from '../runner/record.js';
import { computeMetrics } from './metrics.js';

export const SITE_SCHEMA_VERSION = 1;

function toRun(record) {
  const ok = record.response?.ok === true;
  const text = ok ? record.response.text : '';
  return {
    run_index: record.run_index,
    ok,
    text,
    metrics: ok ? computeMetrics(text) : null,
    generated_at: record.generated_at,
    request: record.request,
    response: {
      model_reported: record.response?.model_reported ?? '',
      usage: record.response?.usage ?? {},
      total_cost_usd: record.response?.total_cost_usd ?? 0,
      duration_ms: record.response?.duration_ms ?? 0,
      session_id: record.response?.session_id ?? '',
      num_turns: record.response?.num_turns ?? 0
    },
    error: ok ? null : (record.response?.error ?? { message: 'unknown', stage: 'unknown' })
  };
}

export async function buildSite({
  guidesDir = 'guides',
  corpusDir = 'corpus',
  resultsDir = 'results/runs',
  outDir = 'site/data',
  runsPerCell = 5
} = {}) {
  const [guides, passages] = await Promise.all([
    loadGuides(guidesDir), loadPassages(corpusDir)
  ]);

  const warnings = [];
  const cells = {};
  const cellFiles = [];

  for (const guide of guides) {
    for (const passage of passages) {
      const key = cellKey(guide.id, passage.id);
      const runs = [];
      for (let runIndex = 1; runIndex <= runsPerCell; runIndex += 1) {
        const record = await readRecord(
          recordPath(resultsDir, guide.id, passage.id, runIndex)
        );
        if (record) runs.push(toRun(record));
      }
      if (runs.length === 0) warnings.push(`No records for cell ${key}`);

      cells[key] = {
        guide_id: guide.id,
        passage_id: passage.id,
        runs: runs.length,
        failures: runs.filter((r) => !r.ok).length,
        file: `cells/${key}.json`
      };
      cellFiles.push([key, { guide_id: guide.id, passage_id: passage.id, runs }]);
    }
  }

  const index = {
    schema_version: SITE_SCHEMA_VERSION,
    guides: guides.map(({ id, name, description, source_url, license_note, order }) => ({
      id, name, description, source_url, license_note, order
    })),
    passages: passages.map(({ id, title, genre, source, license, order, text }) => ({
      id, title, genre, source, license, order, text, metrics: computeMetrics(text)
    })),
    cells
  };

  await rm(outDir, { recursive: true, force: true });
  await mkdir(join(outDir, 'cells'), { recursive: true });
  await writeFile(join(outDir, 'index.json'), `${JSON.stringify(index, null, 2)}\n`, 'utf8');
  for (const [key, payload] of cellFiles) {
    await writeFile(
      join(outDir, 'cells', `${key}.json`),
      `${JSON.stringify(payload, null, 2)}\n`,
      'utf8'
    );
  }

  return { index, warnings };
}

const invokedDirectly = process.argv[1]?.endsWith('build-site.js');
if (invokedDirectly) {
  const { index, warnings } = await buildSite();
  for (const warning of warnings) process.stderr.write(`warning: ${warning}\n`);
  const cellCount = Object.keys(index.cells).length;
  process.stdout.write(
    `Built site data: ${index.guides.length} guides, ` +
    `${index.passages.length} passages, ${cellCount} cells, ` +
    `${warnings.length} warning(s).\n`
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/build-site.test.js`
Expected: PASS, 7 tests.

- [ ] **Step 5: Run the whole suite**

Run: `node --test test/`
Expected: PASS, all suites green.

- [ ] **Step 6: Commit**

```bash
git add build/build-site.js test/build-site.test.js
git commit -m "$(cat <<'EOF'
feat: fold generation records into static site data

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016UxqbfmvGAwozK28X3jzgA
EOF
)"
```

---

### Task 10: The static site

**Files:**
- Create: `site/index.html`
- Create: `site/style.css`
- Create: `site/app.js`

**Interfaces:**
- Consumes: `site/data/index.json` and `site/data/cells/<cellKey>.json` from Task 9.
- Produces: no JavaScript API. The page is the deliverable.

No unit tests: the logic is DOM rendering over data whose shape Task 9
already tests. Verification is the manual check in Step 5.

- [ ] **Step 1: Create `site/index.html`**

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Style Guide Zoo</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <header>
    <h1>Style Guide Zoo</h1>
    <p class="tagline">
      One passage, thirteen style guides, five runs each. Every output below was
      generated locally with the Claude Code CLI; expand any output to see the
      exact prompt, model, and token usage that produced it.
    </p>
  </header>

  <nav id="passage-nav" aria-label="Choose a passage"></nav>

  <main>
    <section id="original" aria-labelledby="original-heading">
      <h2 id="original-heading">Original</h2>
      <div id="original-body"></div>
    </section>
    <section id="columns" aria-label="Style guide outputs"></section>
  </main>

  <footer>
    <p>
      Outputs are generated by Claude and are not human-written. Runs are not
      bit-reproducible: the CLI does not expose a temperature or sampling seed,
      which is why five runs of each cell are published.
    </p>
    <p><a href="https://github.com/mpdatx/style-guide-zoo">Source on GitHub</a></p>
  </footer>

  <script type="module" src="app.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create `site/style.css`**

```css
:root {
  --bg: #fbfaf7;
  --surface: #ffffff;
  --ink: #1b1a17;
  --muted: #6b6862;
  --line: #e2ded5;
  --accent: #7a4b28;
  --fail: #9b2c2c;
  --measure: 34rem;
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg: #161513;
    --surface: #1f1e1b;
    --ink: #ece8e1;
    --muted: #a29d94;
    --line: #333029;
    --accent: #d3a06a;
    --fail: #e08a8a;
  }
}

* { box-sizing: border-box; }

body {
  margin: 0;
  padding: 2rem 1.5rem 4rem;
  background: var(--bg);
  color: var(--ink);
  font: 16px/1.6 Georgia, 'Iowan Old Style', 'Times New Roman', serif;
}

header, nav, main, footer { max-width: 92rem; margin: 0 auto; }

h1 { font-size: 1.75rem; margin: 0 0 .5rem; letter-spacing: -.01em; }
.tagline { color: var(--muted); max-width: var(--measure); margin: 0 0 2rem; }

#passage-nav {
  display: flex;
  flex-wrap: wrap;
  gap: .5rem;
  padding-bottom: 1.5rem;
  border-bottom: 1px solid var(--line);
  margin-bottom: 2rem;
}

.passage-button {
  font: inherit;
  font-size: .875rem;
  padding: .4rem .8rem;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: var(--surface);
  color: var(--ink);
  cursor: pointer;
}
.passage-button[aria-current="true"] {
  border-color: var(--accent);
  color: var(--accent);
  font-weight: 700;
}

#original {
  background: var(--surface);
  border: 1px solid var(--line);
  border-left: 3px solid var(--accent);
  padding: 1.25rem 1.5rem;
  margin-bottom: 2rem;
}
#original h2 { margin: 0 0 .75rem; font-size: .8rem; text-transform: uppercase;
  letter-spacing: .08em; color: var(--muted); }

#columns {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(22rem, 1fr));
  gap: 1.25rem;
  align-items: start;
}

.column {
  background: var(--surface);
  border: 1px solid var(--line);
  padding: 1.25rem;
}
.column h3 { margin: 0 0 .25rem; font-size: 1.05rem; }
.column .description { margin: 0 0 1rem; font-size: .85rem; color: var(--muted); }

.runs { display: flex; gap: .35rem; margin-bottom: 1rem; }
.run-button {
  font: inherit; font-size: .75rem; width: 1.9rem; height: 1.9rem;
  border: 1px solid var(--line); background: transparent; color: var(--muted);
  cursor: pointer; border-radius: 3px;
}
.run-button[aria-pressed="true"] {
  border-color: var(--accent); color: var(--accent); font-weight: 700;
}

.output { white-space: pre-wrap; }
.output.failed { color: var(--fail); font-style: italic; }

.metrics {
  margin-top: 1rem; padding-top: .75rem; border-top: 1px solid var(--line);
  font-size: .75rem; color: var(--muted);
  display: flex; flex-wrap: wrap; gap: .9rem;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}

details.provenance { margin-top: .75rem; font-size: .8rem; }
details.provenance summary { cursor: pointer; color: var(--muted); }
details.provenance pre {
  white-space: pre-wrap; word-break: break-word;
  background: var(--bg); border: 1px solid var(--line);
  padding: .75rem; font-size: .72rem; line-height: 1.5;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  max-height: 22rem; overflow: auto;
}
details.provenance dt { font-weight: 700; margin-top: .6rem; font-size: .72rem;
  text-transform: uppercase; letter-spacing: .05em; color: var(--muted); }
details.provenance dd { margin: .2rem 0 0; }

footer {
  margin-top: 3rem; padding-top: 1.5rem; border-top: 1px solid var(--line);
  font-size: .8rem; color: var(--muted); max-width: var(--measure);
}
footer a { color: var(--accent); }
```

- [ ] **Step 3: Create `site/app.js`**

```js
const cellCache = new Map();
let index = null;
let currentPassageId = null;

async function loadJson(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Failed to load ${path}: ${response.status}`);
  return response.json();
}

function loadCell(key) {
  if (!cellCache.has(key)) cellCache.set(key, loadJson(`data/cells/${key}.json`));
  return cellCache.get(key);
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function metricsRow(metrics) {
  const row = element('div', 'metrics');
  row.append(
    element('span', null, `${metrics.words} words`),
    element('span', null, `${metrics.mean_sentence_length} words/sentence`),
    element('span', null, `Flesch ${metrics.flesch_reading_ease}`)
  );
  return row;
}

function provenance(run) {
  const details = element('details', 'provenance');
  details.append(element('summary', null, 'Prompt, model, and usage for this run'));

  const list = document.createElement('dl');
  const add = (term, value) => {
    list.append(element('dt', null, term), element('dd', null, value));
  };
  add('Generated', run.generated_at);
  add('Backend', `${run.request.backend} ${run.request.cli_version}`);
  add('Model requested', run.request.model_requested);
  add('Model reported', run.response.model_reported || '(not reported)');
  add('Tokens', `${run.response.usage.input_tokens ?? '?'} in / ${run.response.usage.output_tokens ?? '?'} out`);
  add('Cost', `$${run.response.total_cost_usd}`);
  add('Duration', `${run.response.duration_ms} ms`);
  details.append(list);

  const block = (label, body) => {
    details.append(element('dt', null, label));
    const pre = element('pre', null, body);
    details.append(pre);
  };
  block('argv', run.request.argv.join(' '));
  block('System prompt', run.request.system_prompt);
  block('User prompt', run.request.user_prompt);
  return details;
}

function renderRun(container, cell, runIndex) {
  container.replaceChildren();
  const run = cell.runs.find((r) => r.run_index === runIndex);

  if (!run) {
    container.append(element('p', 'output failed', 'No run recorded for this cell.'));
    return;
  }
  if (!run.ok) {
    container.append(
      element('p', 'output failed', `Generation failed (${run.error.stage}): ${run.error.message}`)
    );
    return;
  }
  container.append(element('div', 'output', run.text));
  container.append(metricsRow(run.metrics));
  container.append(provenance(run));
}

function renderColumn(guide, cellSummary) {
  const column = element('article', 'column');
  column.append(element('h3', null, guide.name));
  column.append(element('p', 'description', guide.description));

  const body = element('div');
  const runs = element('div', 'runs');
  column.append(runs, body);

  if (cellSummary.runs === 0) {
    body.append(element('p', 'output failed', 'Not generated yet.'));
    return column;
  }

  loadCell(`${guide.id}__${currentPassageId}`).then((cell) => {
    const indices = cell.runs.map((r) => r.run_index).sort((a, b) => a - b);
    for (const runIndex of indices) {
      const button = element('button', 'run-button', String(runIndex));
      button.type = 'button';
      button.setAttribute('aria-pressed', String(runIndex === indices[0]));
      button.addEventListener('click', () => {
        for (const other of runs.children) other.setAttribute('aria-pressed', 'false');
        button.setAttribute('aria-pressed', 'true');
        renderRun(body, cell, runIndex);
      });
      runs.append(button);
    }
    renderRun(body, cell, indices[0]);
  }).catch((error) => {
    body.append(element('p', 'output failed', error.message));
  });

  return column;
}

function selectPassage(passageId) {
  currentPassageId = passageId;
  const passage = index.passages.find((p) => p.id === passageId);

  for (const button of document.querySelectorAll('.passage-button')) {
    button.setAttribute('aria-current', String(button.dataset.id === passageId));
  }

  const original = document.getElementById('original-body');
  original.replaceChildren();
  original.append(element('div', 'output', passage.text));
  original.append(element('p', 'description', `${passage.genre} — ${passage.source}`));
  original.append(metricsRow(passage.metrics));

  const columns = document.getElementById('columns');
  columns.replaceChildren(
    ...index.guides.map((guide) =>
      renderColumn(guide, index.cells[`${guide.id}__${passageId}`]))
  );

  history.replaceState(null, '', `#${passageId}`);
}

async function start() {
  index = await loadJson('data/index.json');

  const nav = document.getElementById('passage-nav');
  for (const passage of index.passages) {
    const button = element('button', 'passage-button', passage.title);
    button.type = 'button';
    button.dataset.id = passage.id;
    button.addEventListener('click', () => selectPassage(passage.id));
    nav.append(button);
  }

  const requested = decodeURIComponent(location.hash.slice(1));
  const initial = index.passages.some((p) => p.id === requested)
    ? requested
    : index.passages[0].id;
  selectPassage(initial);
}

start().catch((error) => {
  document.querySelector('main').replaceChildren(
    element('p', 'output failed', `Could not load site data: ${error.message}`)
  );
});
```

- [ ] **Step 4: Generate a small real slice to look at**

Run: `node runner/run.js --guide control,caveman,asd-ste100 --passage gettysburg,runbook --runs 2`

Expected: twelve `ok` lines. This costs real subscription usage; it is the
smallest slice that shows the site working with genuine output.

- [ ] **Step 5: Build and inspect the site**

Run: `node build/build-site.js`

The page uses `fetch`, so it must be served over HTTP rather than opened as a
`file://` URL. Serve it with whichever of these is available, from the `site`
directory:

```bash
python -m http.server 8080     # Python 3.x, present on this machine
npx --yes serve site -l 8080   # or, if you prefer Node
```

Open `http://localhost:8080`. Verify: passage buttons switch the original and
all thirteen columns; the three generated columns show real text with a 1-2
run switcher; the other ten read "Not generated yet."; the provenance
disclosure shows the full system prompt, user prompt and argv; the layout
holds at a narrow window width; the page is legible in both light and dark
system themes.

- [ ] **Step 6: Commit**

```bash
git add site/index.html site/style.css site/app.js site/data/
git commit -m "$(cat <<'EOF'
feat: add the static comparison site with per-run provenance

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016UxqbfmvGAwozK28X3jzgA
EOF
)"
```

---

### Task 11: Documentation, licence, CI, and the full generation run

**Files:**
- Create: `README.md`
- Create: `LICENSE`
- Create: `.github/workflows/pages.yml`
- Create: `.github/workflows/test.yml`
- Modify: `results/` and `site/data/` (generated content, committed)

**Interfaces:**
- Consumes: everything.
- Produces: the published repository.

- [ ] **Step 1: Create `LICENSE`**

Write the standard MIT licence text, `Copyright (c) 2026 mpdatx`.

- [ ] **Step 2: Create `README.md`**

```markdown
# Style Guide Zoo

Thirteen prose style guides, one shared corpus, five runs of each
combination, and the complete provenance of every generation.

**[Browse the outputs →](https://mpdatx.github.io/style-guide-zoo/)**

## What this is

Each style guide in `guides/` is a system prompt. Each passage in `corpus/` is
a piece of prose. The runner applies every guide to every passage five times
through the local Claude Code CLI and writes one JSON record per generation
into `results/runs/`. The site folds those records into a side-by-side
comparison.

Nothing is generated in CI, in the browser, or on demand. Everything you see
was generated locally and committed.

## What is and is not reproducible

Every record contains the exact system prompt, the exact user prompt, the full
argument vector, the CLI version, the model requested, the model actually
served, token usage, cost, and duration. The sha256 of the guide, passage, and
template files is recorded too, so you can tell exactly which version of a
prompt produced a given output.

The Claude Code CLI does not expose a temperature or a sampling seed. Identical
inputs therefore do **not** produce identical outputs, and this repository does
not claim otherwise. Five runs per cell are published precisely so that the
run-to-run variation is visible rather than hidden behind a single sample.

Generation uses `--safe-mode`, which disables the maintainer's CLAUDE.md,
skills, plugins, hooks, and MCP servers, so an output does not depend on one
machine's personal configuration.

## Reproducing a run

Requires Node 22 and an authenticated Claude Code CLI on your PATH.

```bash
node runner/run.js --dry-run                    # see what would be generated
node runner/run.js --guide caveman --runs 1     # one guide, one run each
node runner/run.js                              # the full matrix
node build/build-site.js                        # rebuild site/data/
```

The runner is incremental: a cell is skipped when a successful record already
exists whose content hashes match the current guide, passage, and template.
Edit a guide and only that guide's cells regenerate. Add a passage and only the
new column regenerates. Use `--force` to regenerate regardless.

| Option | Effect |
|---|---|
| `--guide <ids>` | comma-separated guide ids to restrict to |
| `--passage <ids>` | comma-separated passage ids to restrict to |
| `--runs <n>` | runs per cell |
| `--concurrency <n>` | parallel generations |
| `--backend fake` | deterministic offline backend, for testing |
| `--dry-run` | print the work list and exit |
| `--force` | regenerate current cells |

The full matrix is 13 x 8 x 5 = 520 CLI invocations. Expect roughly half an
hour at the default concurrency, and real subscription usage.

## Adding a style guide

Create `guides/<id>.md` with the frontmatter fields `id`, `name`,
`description`, `order`, and optionally `source_url` and `license_note`. The
body is the system prompt, sent verbatim. Then:

```bash
node runner/run.js --guide <id>
node build/build-site.js
```

Guide prompts must be original prose describing a style guide's principles.
Do not transcribe text from a copyrighted manual.

## Adding a passage

Create `corpus/<id>.md` with `id`, `title`, `genre`, `source`, `license`, and
`order`. The licence must be `public-domain` or `cc0-original`; see
[CORPUS-LICENSES.md](CORPUS-LICENSES.md).

## Configuration

`config/experiment.json` holds the model, runs per cell, concurrency, budget
cap, and the CLI isolation flags. Changing the model does not invalidate
existing records — the model is provenance, not a content hash — so change it
and use `--force` if you want a clean re-run.

## Tests

```bash
node --test test/
```

Tests never spawn the CLI; they use the `fake` backend.

## Licence

Code, guide prompts, and site: MIT. Corpus: public domain or CC0, per
[CORPUS-LICENSES.md](CORPUS-LICENSES.md). Model outputs in `results/` are
Claude generations, published as produced with no claim of authorship.
```

- [ ] **Step 3: Create `.github/workflows/test.yml`**

```yaml
name: test

on:
  push:
    branches: [main]
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
      - run: node --test test/
```

- [ ] **Step 4: Create `.github/workflows/pages.yml`**

This deploys the committed `site/` directory. It runs no build and no
generation, so what is published is byte-identical to what is in the repo.

```yaml
name: pages

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: false

jobs:
  deploy:
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with:
          path: site
      - id: deployment
        uses: actions/deploy-pages@v4
```

- [ ] **Step 5: Commit the documentation and workflows**

```bash
git add README.md LICENSE .github/
git commit -m "$(cat <<'EOF'
docs: add README, MIT licence, and Pages and test workflows

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016UxqbfmvGAwozK28X3jzgA
EOF
)"
```

- [ ] **Step 6: Review a sample of real output before the full run**

Run: `node runner/run.js --passage gettysburg --runs 1`

That is thirteen calls, one per guide, on one passage. Read every output.
Confirm each guide's effect is visible and distinct, that `control` reproduces
the passage faithfully, and that no output contains a preamble such as "Here is
the rewritten passage". If a guide's prompt is not producing its intended
effect, fix the prompt file and rerun that guide before continuing — this is
much cheaper now than after 520 calls.

- [ ] **Step 7: Run the full matrix**

Run: `node runner/run.js`

Expected: roughly 500 remaining generations — 13 x 8 x 5 minus whatever
Task 10 Step 4 and Task 11 Step 6 already generated — finishing with
`Done. N succeeded, 0 failed.` If any failed, rerun the command — the runner
retries only failures, because failed records are not "current".

- [ ] **Step 8: Build the site data**

Run: `node build/build-site.js`
Expected: `Built site data: 13 guides, 8 passages, 104 cells, 0 warning(s).`

- [ ] **Step 9: Run the full test suite**

Run: `node --test test/`
Expected: PASS, all suites green.

- [ ] **Step 10: Commit the generated corpus of outputs**

```bash
git add results/ site/data/
git commit -m "$(cat <<'EOF'
data: generate the full 13x8x5 output matrix

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016UxqbfmvGAwozK28X3jzgA
EOF
)"
```

- [ ] **Step 11: Publish**

```bash
gh repo create style-guide-zoo --public --source . --remote origin --push
```

Then in the repository's Settings → Pages, set Source to "GitHub Actions".
Confirm the `pages` workflow succeeds and the published site loads with all
thirteen columns populated.

---

## Notes for the executor

- **The plan's CLI envelope field names are an assumption.** Task 6 Step 5 is
  the point where reality wins. If `--output-format json` returns different
  keys than `result`, `is_error`, `session_id`, `duration_ms`,
  `total_cost_usd`, `usage` and `modelUsage`, fix `parseEnvelope` and its test
  to match what the CLI actually emits, and say so in the task report.
- **Cost discipline.** Only four steps in this plan spend money: Task 6 Step 5
  (one call), Task 10 Step 4 (twelve), Task 11 Step 6 (thirteen), and Task 11
  Step 7 (the rest). Everything else runs on the `fake` backend.
- **Do not add dependencies.** If something seems to need a package, it does
  not; write the small function.
