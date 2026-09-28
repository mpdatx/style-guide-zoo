import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

// site/app.js is browser code with no build step, so nothing was type-checking
// it or even parsing it in CI. This harness is a deliberately tiny DOM shim --
// only the handful of APIs app.js actually touches -- driven against the real
// committed site/data. It catches the class of bug that matters here: a typo, a
// renamed field, or a shape assumption that no longer holds after a rebuild.

class StubNode {
  constructor(tagName) {
    this.tagName = tagName;
    this.className = '';
    this.childNodes = [];
    this.attributes = {};
    this.listeners = new Map();
    this.ownText = '';
  }

  set textContent(value) {
    this.ownText = String(value);
    this.childNodes = [];
  }

  get textContent() {
    return this.ownText + this.childNodes.map((child) => child.textContent).join('');
  }

  append(...nodes) {
    this.childNodes.push(...nodes);
  }

  replaceChildren(...nodes) {
    this.ownText = '';
    this.childNodes = nodes;
  }

  addEventListener(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(handler);
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  getAttribute(name) {
    return this.attributes[name];
  }

  /** Every node in this subtree, self included. */
  walk() {
    return [this, ...this.childNodes.flatMap((child) => child.walk())];
  }

  find(predicate) {
    return this.walk().filter(predicate);
  }

  withClass(className) {
    return this.walk().filter((node) => node.className.split(' ').includes(className));
  }

  ofTag(tagName) {
    return this.walk().filter((node) => node.tagName === tagName);
  }
}

/**
 * Install the globals app.js expects and import it fresh. `window` is a plain
 * object rather than the global, which is what keeps app.js from auto-starting:
 * in a real browser `window === globalThis`.
 */
async function mountApp({ hash = '#/', dataDir = 'site/data', missing = [] } = {}) {
  const view = new StubNode('main');
  const body = new StubNode('body');
  const fetched = [];
  const scrolls = [];

  globalThis.document = {
    body,
    createElement: (tagName) => new StubNode(tagName),
    getElementById: (id) => (id === 'view' ? view : null)
  };
  globalThis.location = { hash };
  globalThis.window = { addEventListener() {}, scrollTo: (...args) => scrolls.push(args) };
  globalThis.fetch = async (path) => {
    fetched.push(path);
    if (missing.includes(path)) return { ok: false, status: 404, json: async () => ({}) };
    try {
      const body = await readFile(join(dataDir, path.replace(/^data\//, '')), 'utf8');
      return { ok: true, status: 200, json: async () => JSON.parse(body) };
    } catch {
      return { ok: false, status: 404, json: async () => ({}) };
    }
  };

  // Cache-bust so each test gets a module with an empty cell cache.
  const app = await import(`../site/app.js?t=${Math.random()}`);
  const setHash = (value) => { globalThis.location.hash = value; };
  return {
    app, view, body, fetched, scrolls, setHash,
    // Navigate the way the router does: set the hash, then let render read it.
    goto: async (value) => { setHash(value); await app.render(); }
  };
}

async function siteIndex() {
  return JSON.parse(await readFile('site/data/index.json', 'utf8'));
}

test('the home view lists every style and every source as links', async () => {
  const { app, view } = await mountApp({ hash: '#/' });
  await app.start();

  const index = await siteIndex();
  const hrefs = view.ofTag('a').map((node) => node.href);
  for (const guide of index.guides) {
    assert.ok(hrefs.includes(`#/style/${guide.id}`), `missing style link for ${guide.id}`);
  }
  for (const passage of index.passages) {
    assert.ok(hrefs.includes(`#/source/${passage.id}`), `missing source link for ${passage.id}`);
  }
  assert.equal(view.withClass('card').length, index.guides.length + index.passages.length);
});

test('the style view renders the original beside the guide output', async () => {
  const { app, view } = await mountApp({ hash: '#/style/caveman?source=gettysburg' });
  await app.start();

  const panels = view.withClass('panel');
  assert.equal(panels.length, 2, 'expected exactly two columns');

  const index = await siteIndex();
  const gettysburg = index.passages.find((passage) => passage.id === 'gettysburg');
  assert.ok(panels[0].textContent.includes('Original source'));
  assert.ok(panels[0].textContent.includes(gettysburg.text.slice(0, 40)),
    'the left column must carry the unedited source text');

  const cell = JSON.parse(await readFile('site/data/cells/caveman__gettysburg.json', 'utf8'));
  const firstRun = cell.runs.find((run) => run.run_index === 1);
  assert.ok(panels[1].textContent.includes(firstRun.text.slice(0, 40)),
    'the right column must carry the generated text');
  assert.ok(panels[1].textContent.includes('About this guide'));
  assert.ok(panels[1].textContent.includes('Prompt, model, and usage for this run'));
});

test('the style view honours the run parameter and offers every run', async () => {
  const { app, view } = await mountApp({ hash: '#/style/caveman?source=gettysburg&run=3' });
  await app.start();

  const cell = JSON.parse(await readFile('site/data/cells/caveman__gettysburg.json', 'utf8'));
  const wanted = cell.runs.find((run) => run.run_index === 3);
  const panels = view.withClass('panel');
  assert.ok(panels[1].textContent.includes(wanted.text.slice(0, 40)), 'run=3 was not rendered');

  const buttons = view.withClass('run-button');
  assert.equal(buttons.length, cell.runs.length);
  const pressed = buttons.filter((b) => b.getAttribute('aria-pressed') === 'true');
  assert.equal(pressed.length, 1);
  assert.equal(pressed[0].textContent, '3');
});

test('an out-of-range run falls back to the first rather than rendering nothing', async () => {
  const { app, view } = await mountApp({ hash: '#/style/caveman?source=gettysburg&run=99' });
  await app.start();

  const cell = JSON.parse(await readFile('site/data/cells/caveman__gettysburg.json', 'utf8'));
  const first = cell.runs.find((run) => run.run_index === 1);
  assert.ok(view.withClass('panel')[1].textContent.includes(first.text.slice(0, 40)));
});

test('the source view puts an arbitrary pair of voices side by side', async () => {
  const { app, view } = await mountApp({
    hash: '#/source/terms-of-service?left=strunk-white&right=chicago'
  });
  await app.start();

  const panels = view.withClass('panel');
  assert.equal(panels.length, 2);
  const left = JSON.parse(await readFile('site/data/cells/strunk-white__terms-of-service.json', 'utf8'));
  const right = JSON.parse(await readFile('site/data/cells/chicago__terms-of-service.json', 'utf8'));
  assert.ok(panels[0].textContent.includes(left.runs[0].text.slice(0, 40)));
  assert.ok(panels[1].textContent.includes(right.runs[0].text.slice(0, 40)));
  // Neither column is the source, so the source text must not be on the page.
  assert.ok(!panels[0].textContent.includes('Original source'));
});

test('the source view defaults to the original on the left', async () => {
  const { app, view } = await mountApp({ hash: '#/source/gettysburg' });
  await app.start();

  const panels = view.withClass('panel');
  assert.ok(panels[0].textContent.includes('Original source'));
  const index = await siteIndex();
  assert.ok(panels[1].textContent.includes(index.guides[0].name));
});

test('the source view only fetches the cells it is showing', async () => {
  const { app, fetched } = await mountApp({ hash: '#/source/gettysburg?left=original&right=caveman' });
  await app.start();

  const cellFetches = fetched.filter((path) => path.startsWith('data/cells/'));
  assert.deepEqual(cellFetches, ['data/cells/caveman__gettysburg.json']);
});

test('swapping columns exchanges the two voices', async () => {
  const { app, view, setHash } = await mountApp({
    hash: '#/source/gettysburg?left=original&right=caveman'
  });
  await app.start();

  const swap = view.withClass('swap')[0];
  assert.ok(swap, 'the swap control must exist');
  swap.listeners.get('click')[0]();
  // The run index is deliberately carried across a swap: the same run of the
  // same combination should still be on screen after the columns trade places.
  assert.equal(globalThis.location.hash,
    '/source/gettysburg?left=caveman&right=original&run=1');

  // The router reads the hash on render, so re-rendering must honour the swap.
  setHash(`#${globalThis.location.hash}`);
  await app.render();
  const panels = view.withClass('panel');
  assert.ok(panels[1].textContent.includes('Original source'));
});

test('changing a select navigates rather than silently doing nothing', async () => {
  const { app, view } = await mountApp({ hash: '#/style/caveman?source=gettysburg' });
  await app.start();

  const select = view.ofTag('select')[0];
  select.value = 'runbook';
  select.listeners.get('change')[0]();
  assert.equal(globalThis.location.hash, '/style/caveman?source=runbook');
});

test('an unknown route falls back to the home view', async () => {
  const { app, view } = await mountApp({ hash: '#/nonsense/xyz' });
  await app.start();
  assert.ok(view.withClass('card').length > 0, 'expected the home cards');
});

test('an unknown guide or passage id reports it instead of throwing', async () => {
  for (const hash of ['#/style/no-such-guide', '#/source/no-such-passage']) {
    const { app, view } = await mountApp({ hash });
    await app.start();
    const failures = view.withClass('failed');
    assert.equal(failures.length, 1, `${hash} should render one failure notice`);
    assert.match(failures[0].textContent, /no-such-(guide|passage)/);
  }
});

test('parseRoute reads the view, the id, and the query', async () => {
  const { app } = await mountApp();
  globalThis.location.hash = '#/source/gettysburg?left=original&right=caveman&run=2';
  const route = app.parseRoute();
  assert.equal(route.view, 'source');
  assert.equal(route.id, 'gettysburg');
  assert.equal(route.params.get('right'), 'caveman');
  assert.equal(route.params.get('run'), '2');

  globalThis.location.hash = '';
  assert.equal(app.parseRoute().view, 'home');
});

test('a missing cell file reports the failure instead of rendering blank', async () => {
  const { app, view } = await mountApp({
    hash: '#/style/caveman?source=gettysburg',
    missing: ['data/cells/caveman__gettysburg.json']
  });
  await app.start();
  const failures = view.withClass('failed');
  assert.equal(failures.length, 1);
  assert.match(failures[0].textContent, /caveman__gettysburg\.json: 404/);
});

// --------------------------------------------------------------- in-place update
//
// Changing a voice or a run used to tear the whole view down and rebuild it,
// which read as a page reload and threw the reader back to the top of the page.
// These tests pin the fix: same view, same chrome, only the columns change.

test('changing a source updates the columns without rebuilding the chrome', async () => {
  const { app, view, goto } = await mountApp({ hash: '#/style/caveman?source=gettysburg' });
  await app.start();

  const selectBefore = view.ofTag('select')[0];
  const runsBefore = view.withClass('run-button');

  await goto('#/style/caveman?source=runbook');

  assert.equal(view.ofTag('select')[0], selectBefore,
    'the source select must be the same node, not a replacement');
  assert.deepEqual(view.withClass('run-button'), runsBefore,
    'the run buttons must be reused when the run set is unchanged');
  assert.equal(selectBefore.value, 'runbook', 'the select must reflect the new route');

  const cell = JSON.parse(await readFile('site/data/cells/caveman__runbook.json', 'utf8'));
  assert.ok(view.withClass('panel')[1].textContent.includes(cell.runs[0].text.slice(0, 40)));
});

test('an in-place update does not scroll the reader back to the top', async () => {
  const { app, scrolls, goto } = await mountApp({ hash: '#/style/caveman?source=gettysburg' });
  await app.start();
  assert.equal(scrolls.length, 1, 'the initial mount scrolls to the top');

  await goto('#/style/caveman?source=runbook');
  await goto('#/style/caveman?source=runbook&run=4');
  assert.equal(scrolls.length, 1, 'parameter changes must not scroll');

  // Switching to a different view is a real navigation and may scroll.
  await goto('#/source/runbook');
  assert.equal(scrolls.length, 2);
});

test('changing a voice updates in place and reuses the selects', async () => {
  const { app, view, goto } = await mountApp({
    hash: '#/source/gettysburg?left=original&right=caveman'
  });
  await app.start();
  const selects = view.ofTag('select');

  await goto('#/source/gettysburg?left=chicago&right=hemingway');
  assert.deepEqual(view.ofTag('select'), selects, 'selects must be reused');
  assert.equal(selects[1].value, 'chicago');
  assert.equal(selects[2].value, 'hemingway');

  const left = JSON.parse(await readFile('site/data/cells/chicago__gettysburg.json', 'utf8'));
  assert.ok(view.withClass('panel')[0].textContent.includes(left.runs[0].text.slice(0, 40)));
});

test('the run buttons track the selected run without being rebuilt', async () => {
  const { app, view, goto } = await mountApp({ hash: '#/style/caveman?source=gettysburg' });
  await app.start();
  const buttons = view.withClass('run-button');

  await goto('#/style/caveman?source=gettysburg&run=4');
  assert.deepEqual(view.withClass('run-button'), buttons);
  const pressed = buttons.filter((b) => b.getAttribute('aria-pressed') === 'true');
  assert.equal(pressed.length, 1);
  assert.equal(pressed[0].textContent, '4');
});

test('the body carries a view class so the chrome can shrink on detail pages', async () => {
  const { app, body, goto } = await mountApp({ hash: '#/' });
  await app.start();
  assert.equal(body.className, 'on-home');

  await goto('#/style/caveman');
  assert.equal(body.className, 'on-detail');

  await goto('#/source/gettysburg');
  assert.equal(body.className, 'on-detail');

  await goto('#/');
  assert.equal(body.className, 'on-home');
});

test('leaving a broken route remounts cleanly rather than staying wedged', async () => {
  const { app, view, goto } = await mountApp({ hash: '#/style/caveman?source=gettysburg' });
  await app.start();
  assert.equal(view.withClass('panel').length, 2);

  await goto('#/style/no-such-guide');
  assert.equal(view.withClass('panel').length, 0);
  assert.equal(view.withClass('failed').length, 1);

  await goto('#/style/caveman?source=gettysburg');
  assert.equal(view.withClass('panel').length, 2, 'the view must rebuild after a dead end');
  assert.equal(view.withClass('failed').length, 0);
});

test('the detail view does not repeat the title in a heading and a lede', async () => {
  const { app, view } = await mountApp({ hash: '#/style/caveman?source=gettysburg' });
  await app.start();

  const guide = (await siteIndex()).guides.find((g) => g.id === 'caveman');
  const titles = view.walk().filter((node) => node.ownText === guide.name);
  assert.equal(titles.length, 2,
    'the guide name belongs in the view title and the panel heading, nowhere else');
  const ledes = view.withClass('lede');
  assert.equal(ledes.length, 0, 'the lede duplicated the panel description');
});

test('two original columns hide the axis-switch link instead of linking nowhere', async () => {
  const { app, view } = await mountApp({
    hash: '#/source/gettysburg?left=original&right=original'
  });
  await app.start();

  const axis = view.withClass('axis-switch')[0];
  assert.ok(axis, 'the link must still be in the DOM');
  assert.equal(axis.hidden, true, 'there is no style to switch to');
  // No generated column, so there are no runs to choose between either.
  assert.equal(view.withClass('field')
    .find((node) => node.className.includes('runs')).hidden, true);
  assert.equal(view.withClass('panel').length, 2);
});
