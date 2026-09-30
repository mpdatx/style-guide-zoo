const cellCache = new Map();
let index = null;

// The baseline column is the corpus passage itself, not a generated one. This
// id stands in for it wherever a voice is selected.
const ORIGINAL = 'original';

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

function anchor(className, text, hash) {
  const node = element('a', className, text);
  node.href = `#${hash}`;
  return node;
}

function guideById(id) {
  return index.guides.find((guide) => guide.id === id) ?? null;
}

function passageById(id) {
  return index.passages.find((passage) => passage.id === id) ?? null;
}

function isVoice(id) {
  return id === ORIGINAL || guideById(id) !== null;
}

function voiceName(voiceId) {
  return voiceId === ORIGINAL ? 'the original' : (guideById(voiceId)?.name ?? voiceId);
}

function voiceOptions() {
  return [
    { value: ORIGINAL, label: 'Original source (unedited)' },
    ...index.guides.map((guide) => ({ value: guide.id, label: guide.name }))
  ];
}

function passageOptions() {
  return index.passages.map((passage) => ({ value: passage.id, label: passage.title }));
}

// ---------------------------------------------------------------- routing

/**
 * Routes are `#/`, `#/style/<guideId>`, `#/source/<passageId>`, and a
 * `/compare` suffix on either for the two-column view. Without the suffix a
 * view is a gallery: every output on one long page.
 */
export function parseRoute() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, query] = raw.split('?');
  const segments = path.split('/').filter(Boolean).map(decodeURIComponent);
  const params = new URLSearchParams(query ?? '');
  if ((segments[0] === 'style' || segments[0] === 'source') && segments[1]) {
    const mode = segments[2] === 'compare' ? 'compare' : 'gallery';
    return { view: segments[0], id: segments[1], mode, params };
  }
  return { view: 'home', id: null, mode: null, params };
}

function go(path, params = {}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') query.set(key, String(value));
  }
  const suffix = query.toString();
  location.hash = suffix ? `${path}?${suffix}` : path;
}

// ---------------------------------------------------------------- controls

/**
 * A labelled select. Returns the wrapper and the select, because a view builds
 * its controls once and thereafter only sets `.value` on them — rebuilding a
 * select on every navigation is what made changing a voice feel like a page
 * load.
 */
function field(labelText, options, onChange) {
  const wrap = element('label', 'field');
  wrap.append(element('span', 'field-label', labelText));
  const select = element('select');
  for (const option of options) {
    const node = element('option', null, option.label);
    node.value = option.value;
    select.append(node);
  }
  select.addEventListener('change', () => onChange(select.value));
  wrap.append(select);
  return { wrap, select };
}

/**
 * Reconcile the run buttons against the runs this cell actually has. The
 * buttons are reused when the set is unchanged — which is the common case, so
 * pressing a run number does not rebuild the control under the cursor.
 */
function syncRuns(group, indices, current, onChange) {
  const labels = indices.map(String);
  // `children` is a live HTMLCollection, not an array. Copy it before mapping.
  const buttons = [...group.children];
  const differs = buttons.length !== labels.length
    || labels.some((label, i) => buttons[i].textContent !== label);

  if (differs) {
    group.replaceChildren(...indices.map((runIndex) => {
      const button = element('button', 'run-button', String(runIndex));
      button.type = 'button';
      button.setAttribute('aria-label', `Run ${runIndex}`);
      button.addEventListener('click', () => onChange(runIndex));
      return button;
    }));
  }
  for (const node of group.children) {
    node.setAttribute('aria-pressed', String(node.textContent === String(current)));
  }
}

function runsField() {
  const wrap = element('div', 'field runs');
  const group = element('div', 'run-buttons');
  wrap.append(element('span', 'field-label', 'Run'), group);
  return { wrap, group };
}

// ---------------------------------------------------------------- panels

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
  if (run.response.stop_reason != null) {
    add('Stop reason', run.response.stop_reason);
  }
  const attempts = run.response.attempts;
  add('Attempts', attempts > 1 ? `${attempts} (retried)` : String(attempts ?? '?'));

  const block = (label, body) => {
    const pre = element('pre', null, body);
    const dd = element('dd');
    dd.append(pre);
    list.append(element('dt', null, label), dd);
  };
  const modelUsage = run.response.model_usage ?? {};
  const modelUsageNames = Object.keys(modelUsage);
  block(
    'Model usage',
    modelUsageNames.length === 0
      ? '(no model usage recorded)'
      : modelUsageNames
        .map((name) => `${name}: ${modelUsage[name]?.outputTokens ?? '?'} output tokens`)
        .join('\n')
  );
  add('Tokens', `${run.response.usage.input_tokens ?? '?'} in / ${run.response.usage.output_tokens ?? '?'} out`);
  add('Cost', `$${run.response.total_cost_usd}`);
  add('Duration', `${run.response.duration_ms} ms`);
  if (run.error?.message) {
    block(`Error reported by the CLI (${run.error.stage})`, run.error.message);
  }
  block('argv', run.request.argv.join(' '));
  block('System prompt', run.request.system_prompt);
  block('User prompt', run.request.user_prompt);
  details.append(list);
  return details;
}

// A failed run is shown, never hidden — but the raw CLI error is written for a
// terminal user, not a reader (it says things like "start a new session" and
// carries request ids). State the outcome plainly here; the verbatim message
// stays in the provenance disclosure below.
function failureSummary(run) {
  if (run.response.stop_reason === 'refusal') {
    return 'The model declined to rewrite this passage in this style. '
      + 'The refusal is recorded rather than hidden; see the details below.';
  }
  const stage = run.error?.stage ?? 'unknown';
  if (stage === 'timeout') return 'This generation timed out and was stopped.';
  if (stage === 'spawn') return 'The generator could not be started for this run.';
  return `This generation did not complete (${stage}). See the details below.`;
}

// What this guide is, where it comes from, and the exact prompt behind the
// column — so a reader never has to open the repository to answer "what is this
// guide actually asking for?".
function guideInfo(guide, systemPrompt) {
  const details = element('details', 'guide-info');
  details.append(element('summary', null, 'Style guide details'));

  const list = document.createElement('dl');
  const add = (term, value) => {
    list.append(element('dt', null, term), element('dd', null, value));
  };
  add('What it is', guide.description);
  if (guide.license_note) add('Licensing', guide.license_note);
  if (guide.source_url) {
    const link = element('a', null, guide.source_url);
    link.href = guide.source_url;
    link.rel = 'noopener noreferrer';
    link.target = '_blank';
    const dd = element('dd');
    dd.append(link);
    list.append(element('dt', null, 'Authoritative source'), dd);
  }
  if (systemPrompt) {
    const dd = element('dd');
    dd.append(element('pre', null, systemPrompt));
    list.append(element('dt', null, 'System prompt sent to the model'), dd);
  }
  details.append(list);
  return details;
}

/**
 * Undo hard wrapping for display. A passage excerpted from Markdown source
 * keeps its 80-column line breaks, and `.output` preserves newlines, so it
 * rendered as a narrow ragged column however wide its panel was. Join each line
 * to the one before it unless either is blank or the line starts a list item
 * or is indented. The committed text, and what the model saw, are unchanged.
 */
export function reflow(text) {
  const lines = text.split('\n');
  const out = [];
  for (const line of lines) {
    const previous = out.length > 0 ? out[out.length - 1] : '';
    const continues = previous.trim() !== '' && line.trim() !== ''
      && !/^(\s|[-*+] |\d+[.)] )/.test(line);
    if (continues) out[out.length - 1] = `${previous} ${line}`;
    else out.push(line);
  }
  return out.join('\n');
}

/** One column: a single voice applied to a single passage. */
function panel(voiceId, passage, cell, runIndex) {
  const article = element('article', 'panel');

  if (voiceId === ORIGINAL) {
    article.append(element('h3', null, 'Original source'));
    article.append(element('p', 'description', `${passage.genre} — ${passage.source}`));
    article.append(element('div', 'output', reflow(passage.text)));
    article.append(metricsRow(passage.metrics));
    return article;
  }

  const guide = guideById(voiceId);
  if (!guide) {
    article.append(element('p', 'output failed', `No style guide with id "${voiceId}".`));
    return article;
  }
  article.append(element('h3', null, guide.name));
  article.append(element('p', 'description', guide.description));
  article.append(...runBody(cell, runIndex, guideInfo(guide, systemPromptOf(cell))));
  return article;
}

// Take the prompt from a real run, so it is the text that actually produced
// the output rather than a copy that could drift from it.
function systemPromptOf(cell) {
  return cell?.runs?.[0]?.request?.system_prompt ?? null;
}

/**
 * The reference disclosures under an output, side by side while closed. The
 * guide details come after the output rather than above it, so the text starts
 * right under the heading.
 */
function disclosures(...items) {
  const row = element('div', 'disclosures');
  row.append(...items.filter(Boolean));
  return row;
}

/**
 * The generated text of one run, with its metrics, its provenance, and — when
 * given — the guide details. The details node is reused across run switches,
 * so it stays open if the reader opened it.
 */
function runBody(cell, runIndex, info = null) {
  if (!cell || cell.runs.length === 0) {
    return [element('p', 'output failed', 'Not generated yet.'), disclosures(info)];
  }
  const run = cell.runs.find((candidate) => candidate.run_index === runIndex) ?? cell.runs[0];
  if (!run.ok) {
    return [element('p', 'output failed', failureSummary(run)), disclosures(provenance(run), info)];
  }
  return [
    element('div', 'output', run.text),
    metricsRow(run.metrics),
    disclosures(provenance(run), info)
  ];
}

/**
 * One full-width output in a gallery, with its own run buttons. The run is
 * block-local state, not a route parameter: a gallery has one block per cell,
 * and pressing a run swaps that block's text without navigating or moving the
 * rest of the page.
 */
function galleryBlock({ title, titleHash, description, links = [], info = null, cell, error }) {
  const article = element('article', 'panel block');
  const head = element('div', 'block-head');
  const heading = element('h3');
  heading.append(titleHash ? anchor('block-title', title, titleHash) : element('span', null, title));
  const group = element('div', 'run-buttons');
  head.append(heading, group);
  article.append(head);

  const meta = element('p', 'description', description);
  for (const link of links) {
    meta.append(element('span', 'sep', ' · '), anchor('block-link', link.text, link.hash));
  }
  article.append(meta);

  const body = element('div', 'block-body');
  article.append(body);

  if (error) {
    body.append(element('p', 'output failed', error.message), disclosures(info));
    group.hidden = true;
    return article;
  }

  const indices = runIndicesOf([cell]);
  group.hidden = indices.length < 2;
  const show = (runIndex) => {
    syncRuns(group, indices, runIndex, show);
    body.replaceChildren(...runBody(cell, runIndex, info));
  };
  show(indices[0] ?? 1);
  return article;
}

function runIndicesOf(cells) {
  const seen = new Set();
  for (const cell of cells) {
    for (const run of cell?.runs ?? []) seen.add(run.run_index);
  }
  return [...seen].sort((a, b) => a - b);
}

function resolveRun(indices, requested) {
  const asNumber = Number(requested);
  return indices.includes(asNumber) ? asNumber : (indices[0] ?? 1);
}

// ---------------------------------------------------------------- views
//
// A view builds its chrome — title bar, selects, run buttons, the pair
// container — exactly once, then returns an `update(route)` that rewrites only
// what the new route changed. The router calls `update` for any navigation
// within the same view, so changing a voice replaces two panels rather than
// tearing down and rebuilding the page.

function viewBar() {
  const bar = element('div', 'viewbar');
  const title = element('h2', 'view-title');
  const links = element('div', 'view-links');
  // `mode` flips between the gallery and the two-column page; `axis` moves to
  // the other browse axis.
  const mode = anchor('mode-switch', '', '/');
  const axis = anchor('axis-switch', '', '/');
  links.append(mode, axis);
  bar.append(title, links);
  return { bar, title, mode, axis };
}

/**
 * Load a set of cells without letting one missing file blank the page: each
 * result is `{ cell }` or `{ error }`, and the block for a failed cell says so.
 */
async function loadCells(keys) {
  const settled = await Promise.allSettled(keys.map(loadCell));
  return settled.map((result) => (result.status === 'fulfilled'
    ? { cell: result.value, error: null }
    : { cell: null, error: result.reason }));
}

/** Bring a gallery block into view when the route names one. */
function reveal(block) {
  block?.scrollIntoView?.({ block: 'start' });
}

/** Every source in one style, full width, one after another. */
async function styleGallery(root) {
  const here = { guideId: null, blocks: new Map() };
  const { bar, title, mode, axis } = viewBar();
  axis.hidden = true;
  const description = element('p', 'description view-description');
  const info = element('div', 'view-info');
  const list = element('div', 'gallery');
  root.append(bar, description, info, list);

  return async function update(route) {
    const guide = guideById(route.id);
    if (here.guideId !== guide.id) {
      const results = await loadCells(index.passages.map((p) => `${guide.id}__${p.id}`));
      here.guideId = guide.id;

      title.textContent = guide.name;
      mode.textContent = 'Compare with the original, side by side →';
      mode.href = `#/style/${guide.id}/compare`;
      description.textContent = guide.description;
      const prompt = results.map((r) => systemPromptOf(r.cell)).find(Boolean) ?? null;
      info.replaceChildren(guideInfo(guide, prompt));

      here.blocks = new Map();
      list.replaceChildren(...index.passages.map((passage, i) => {
        const block = galleryBlock({
          title: passage.title,
          titleHash: `/source/${passage.id}`,
          description: `${passage.genre} — ${passage.source}`,
          links: [{
            text: 'Compare with the original',
            hash: `/style/${guide.id}/compare?source=${passage.id}`
          }],
          ...results[i]
        });
        here.blocks.set(passage.id, block);
        return block;
      }));
    }
    reveal(here.blocks.get(route.params.get('source')));
  };
}

/** One source, then every style's output of it, full width. */
async function sourceGallery(root) {
  const here = { passageId: null, blocks: new Map() };
  const { bar, title, mode, axis } = viewBar();
  axis.hidden = true;
  const list = element('div', 'gallery');
  root.append(bar, list);

  return async function update(route) {
    const passage = passageById(route.id);
    if (here.passageId !== passage.id) {
      const results = await loadCells(index.guides.map((g) => `${g.id}__${passage.id}`));
      here.passageId = passage.id;

      title.textContent = passage.title;
      mode.textContent = 'Compare two voices side by side →';
      mode.href = `#/source/${passage.id}/compare`;

      here.blocks = new Map();
      const blocks = index.guides.map((guide, i) => {
        const block = galleryBlock({
          title: guide.name,
          titleHash: `/style/${guide.id}`,
          description: guide.description,
          links: [{
            text: 'Compare with the original',
            hash: `/source/${passage.id}/compare?right=${guide.id}`
          }],
          info: guideInfo(guide, systemPromptOf(results[i].cell)),
          ...results[i]
        });
        here.blocks.set(guide.id, block);
        return block;
      });
      list.replaceChildren(panel(ORIGINAL, passage, null, null), ...blocks);
    }
    reveal(here.blocks.get(route.params.get('style')));
  };
}

async function styleView(root) {
  const here = { guideId: null, passageId: null, run: null };
  const { bar, title, mode, axis } = viewBar();

  const source = field('Source', passageOptions(),
    // Run indices are per-cell, so a source change starts from the first run
    // rather than carrying over an index the new cell may not have.
    (value) => go(`/style/${here.guideId}/compare`, { source: value }));
  const runs = runsField();

  const controls = element('div', 'controls');
  controls.append(source.wrap, runs.wrap);

  const pair = element('div', 'pair');
  root.append(bar, controls, pair);

  return async function update(route) {
    const guide = guideById(route.id);
    const passage = passageById(route.params.get('source')) ?? index.passages[0];
    const cell = await loadCell(`${guide.id}__${passage.id}`);
    const indices = runIndicesOf([cell]);
    const runIndex = resolveRun(indices, route.params.get('run'));
    Object.assign(here, { guideId: guide.id, passageId: passage.id, run: runIndex });

    title.textContent = guide.name;
    mode.textContent = '← Every source in this style';
    mode.href = `#/style/${guide.id}?source=${passage.id}`;
    axis.textContent = 'Compare voices on this source →';
    axis.href = `#/source/${passage.id}/compare?right=${guide.id}`;
    source.select.value = passage.id;

    runs.wrap.hidden = indices.length < 2;
    syncRuns(runs.group, indices, runIndex,
      (value) => go(`/style/${guide.id}/compare`, { source: passage.id, run: value }));

    pair.replaceChildren(
      panel(ORIGINAL, passage, null, runIndex),
      panel(guide.id, passage, cell, runIndex)
    );
  };
}

async function sourceView(root) {
  const here = { passageId: null, left: ORIGINAL, right: null, run: null };
  const { bar, title, mode, axis } = viewBar();

  const navigate = (overrides) => go(`/source/${here.passageId}/compare`, {
    left: here.left, right: here.right, run: here.run, ...overrides
  });

  const source = field('Source', passageOptions(),
    (value) => go(`/source/${value}/compare`, { left: here.left, right: here.right }));
  // A voice change keeps the passage but may change which runs exist, so the
  // run index is dropped and re-resolved.
  const left = field('Left column', voiceOptions(),
    (value) => navigate({ left: value, run: undefined }));
  const right = field('Right column', voiceOptions(),
    (value) => navigate({ right: value, run: undefined }));
  const runs = runsField();

  const swap = element('button', 'swap', 'Swap ⇄');
  swap.type = 'button';
  swap.addEventListener('click', () => navigate({ left: here.right, right: here.left }));

  const controls = element('div', 'controls');
  controls.append(source.wrap, left.wrap, swap, right.wrap, runs.wrap);

  const pair = element('div', 'pair');
  root.append(bar, controls, pair);

  return async function update(route) {
    const passage = passageById(route.id);
    const leftVoice = isVoice(route.params.get('left')) ? route.params.get('left') : ORIGINAL;
    const rightVoice = isVoice(route.params.get('right'))
      ? route.params.get('right')
      : index.guides[0].id;

    const generated = [...new Set([leftVoice, rightVoice])].filter((v) => v !== ORIGINAL);
    const loaded = await Promise.all(generated.map((v) => loadCell(`${v}__${passage.id}`)));
    const cells = new Map(generated.map((voice, i) => [voice, loaded[i]]));
    const indices = runIndicesOf(loaded);
    const runIndex = resolveRun(indices, route.params.get('run'));
    Object.assign(here, {
      passageId: passage.id, left: leftVoice, right: rightVoice, run: runIndex
    });

    title.textContent = passage.title;
    const styled = rightVoice === ORIGINAL ? leftVoice : rightVoice;
    mode.textContent = '← Every style on this source';
    mode.href = styled === ORIGINAL
      ? `#/source/${passage.id}`
      : `#/source/${passage.id}?style=${styled}`;
    if (styled === ORIGINAL) {
      axis.hidden = true;
    } else {
      axis.hidden = false;
      axis.textContent = 'See this style across every source →';
      axis.href = `#/style/${styled}?source=${passage.id}`;
    }

    source.select.value = passage.id;
    left.select.value = leftVoice;
    right.select.value = rightVoice;
    swap.setAttribute('aria-label',
      `Swap ${voiceName(leftVoice)} and ${voiceName(rightVoice)}`);

    runs.wrap.hidden = indices.length < 2;
    syncRuns(runs.group, indices, runIndex, (value) => navigate({ run: value }));

    pair.replaceChildren(
      panel(leftVoice, passage, cells.get(leftVoice) ?? null, runIndex),
      panel(rightVoice, passage, cells.get(rightVoice) ?? null, runIndex)
    );
  };
}

function homeView(root) {
  const section = (heading, blurb, items) => {
    root.append(element('h2', null, heading));
    root.append(element('p', 'lede', blurb));
    const list = element('ul', 'cards');
    for (const { hash, title, description } of items) {
      const item = element('li', 'card');
      item.append(anchor('card-title', title, hash));
      item.append(element('p', 'description', description));
      list.append(item);
    }
    root.append(list);
  };

  section(
    'Browse by style',
    'One style guide applied to every source, one after another, so you can '
    + 'see how the same instructions land on oratory, legal boilerplate, and a '
    + 'technical procedure. A side-by-side view against the original is one click away.',
    index.guides.map((guide) => ({
      hash: `/style/${guide.id}`, title: guide.name, description: guide.description
    }))
  );

  section(
    'Browse by source',
    'One passage, then every style\'s rewrite of it. To put any two voices '
    + 'side by side, switch to the comparison view.',
    index.passages.map((passage) => ({
      hash: `/source/${passage.id}`,
      title: passage.title,
      description: `${passage.genre} — ${passage.source} · ${passage.metrics.words} words`
    }))
  );
}

// ---------------------------------------------------------------- bootstrap

const mounted = { view: null, update: null };

function reset() {
  mounted.view = null;
  mounted.update = null;
}

export async function render() {
  const route = parseRoute();
  const root = document.getElementById('view');
  document.body.className = route.view === 'home' ? 'on-home' : 'on-detail';

  // An unknown id is a dead end rather than a view worth keeping mounted.
  const unknown = (route.view === 'style' && !guideById(route.id))
    || (route.view === 'source' && !passageById(route.id));
  if (unknown) {
    reset();
    const noun = route.view === 'style' ? 'style guide' : 'passage';
    root.replaceChildren(
      element('p', 'output failed', `No ${noun} with id "${route.id}".`),
      anchor(null, 'Back to the index', '/')
    );
    return;
  }

  // Same view, different parameters: update in place. No teardown, no scroll
  // jump, and the control the reader just used keeps its identity.
  const key = `${route.view}:${route.mode}`;
  if (mounted.view === key && mounted.update) {
    try {
      await mounted.update(route);
    } catch (error) {
      reset();
      root.replaceChildren(element('p', 'output failed', error.message));
    }
    return;
  }

  const views = {
    'style:gallery': styleGallery,
    'style:compare': styleView,
    'source:gallery': sourceGallery,
    'source:compare': sourceView
  };
  root.replaceChildren();
  // Before the update, not after: a gallery route may name a block to scroll
  // to, and that must win over the reset to the top.
  window.scrollTo(0, 0);
  try {
    mounted.update = views[key] ? await views[key](root) : null;
    mounted.view = key;

    if (mounted.update) await mounted.update(route);
    else homeView(root);
  } catch (error) {
    reset();
    root.replaceChildren(element('p', 'output failed', error.message));
  }
}

export async function start() {
  index = await loadJson('data/index.json');
  window.addEventListener('hashchange', render);
  await render();
}

// Auto-start in a browser only. In a browser `window` IS the global object; a
// test harness that supplies its own `window` object therefore does not trip
// this, and can drive `start()` and `render()` itself.
if (globalThis.window === globalThis) {
  start().catch((error) => {
    document.getElementById('view').replaceChildren(
      element('p', 'output failed', `Could not load site data: ${error.message}`)
    );
  });
}
