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

function voiceName(voiceId) {
  return voiceId === ORIGINAL ? 'Original source' : (guideById(voiceId)?.name ?? voiceId);
}

function voiceOptions() {
  return [
    { value: ORIGINAL, label: 'Original source (unedited)' },
    ...index.guides.map((guide) => ({ value: guide.id, label: guide.name }))
  ];
}

// ---------------------------------------------------------------- routing

/** Routes are `#/`, `#/style/<guideId>?…`, `#/source/<passageId>?…`. */
export function parseRoute() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, query] = raw.split('?');
  const segments = path.split('/').filter(Boolean).map(decodeURIComponent);
  const params = new URLSearchParams(query ?? '');
  if ((segments[0] === 'style' || segments[0] === 'source') && segments[1]) {
    return { view: segments[0], id: segments[1], params };
  }
  return { view: 'home', id: null, params };
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

function field(labelText, options, selectedValue, onChange) {
  const wrap = element('label', 'field');
  wrap.append(element('span', 'field-label', labelText));
  const select = element('select');
  for (const option of options) {
    const node = element('option', null, option.label);
    node.value = option.value;
    if (option.value === selectedValue) node.selected = true;
    select.append(node);
  }
  select.addEventListener('change', () => onChange(select.value));
  wrap.append(select);
  return wrap;
}

// Several runs of the same combination exist so that run-to-run variation is
// visible. One selector drives every generated column on the page.
function runSelector(indices, current, onChange) {
  const wrap = element('div', 'field runs');
  wrap.append(element('span', 'field-label', 'Run'));
  const group = element('div', 'run-buttons');
  for (const runIndex of indices) {
    const button = element('button', 'run-button', String(runIndex));
    button.type = 'button';
    button.setAttribute('aria-label', `Run ${runIndex}`);
    button.setAttribute('aria-pressed', String(runIndex === current));
    button.addEventListener('click', () => onChange(runIndex));
    group.append(button);
  }
  wrap.append(group);
  return wrap;
}

function breadcrumb(label, hash) {
  const nav = element('nav', 'breadcrumb');
  nav.setAttribute('aria-label', 'Breadcrumb');
  nav.append(anchor(null, 'Home', '/'), element('span', null, ' / '),
    element('span', null, label));
  if (hash) nav.append(element('span', null, ' · '), anchor(null, 'Switch axis', hash));
  return nav;
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
  details.append(element('summary', null, 'About this guide'));

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

/** One column: a single voice applied to a single passage. */
function panel(voiceId, passage, cell, runIndex) {
  const article = element('article', 'panel');

  if (voiceId === ORIGINAL) {
    article.append(element('h3', null, 'Original source'));
    article.append(element('p', 'description', `${passage.genre} — ${passage.source}`));
    article.append(element('div', 'output', passage.text));
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
  // Take the prompt from a real run, so it is the text that actually produced
  // this column rather than a copy that could drift from it.
  article.append(guideInfo(guide, cell?.runs?.[0]?.request?.system_prompt ?? null));

  if (!cell || cell.runs.length === 0) {
    article.append(element('p', 'output failed', 'Not generated yet.'));
    return article;
  }
  const run = cell.runs.find((candidate) => candidate.run_index === runIndex) ?? cell.runs[0];
  if (!run.ok) {
    article.append(element('p', 'output failed', failureSummary(run)));
    article.append(provenance(run));
    return article;
  }
  article.append(element('div', 'output', run.text));
  article.append(metricsRow(run.metrics));
  article.append(provenance(run));
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

function homeView(root) {
  root.append(element('h2', null, 'Browse by style'));
  root.append(element('p', 'lede',
    'One style guide at a time, against the unedited source. Switch sources '
    + 'without leaving the page to see how the same instructions land on '
    + 'oratory, legal boilerplate, and a technical procedure.'));

  const styles = element('ul', 'cards');
  for (const guide of index.guides) {
    const item = element('li', 'card');
    item.append(anchor('card-title', guide.name, `/style/${guide.id}`));
    item.append(element('p', 'description', guide.description));
    styles.append(item);
  }
  root.append(styles);

  root.append(element('h2', null, 'Browse by source'));
  root.append(element('p', 'lede',
    'One passage at a time, with a voice in each column. Put any two voices '
    + 'side by side — or leave the original on the left and change only the '
    + 'right.'));

  const sources = element('ul', 'cards');
  for (const passage of index.passages) {
    const item = element('li', 'card');
    item.append(anchor('card-title', passage.title, `/source/${passage.id}`));
    item.append(element('p', 'description',
      `${passage.genre} — ${passage.source} · ${passage.metrics.words} words`));
    sources.append(item);
  }
  root.append(sources);
}

async function styleView(root, guideId, params) {
  const guide = guideById(guideId);
  if (!guide) {
    root.append(breadcrumb('Unknown style'));
    root.append(element('p', 'output failed', `No style guide with id "${guideId}".`));
    return;
  }
  const passage = passageById(params.get('source')) ?? index.passages[0];
  const cell = await loadCell(`${guide.id}__${passage.id}`);
  const indices = runIndicesOf([cell]);
  const runIndex = resolveRun(indices, params.get('run'));

  root.append(breadcrumb(guide.name, `/source/${passage.id}?right=${guide.id}`));
  root.append(element('h2', null, guide.name));
  root.append(element('p', 'lede', guide.description));

  const controls = element('div', 'controls');
  controls.append(field(
    'Source',
    index.passages.map((candidate) => ({ value: candidate.id, label: candidate.title })),
    passage.id,
    // Run indices are per-cell, so a source change starts from the first run
    // rather than carrying over an index the new cell may not have.
    (value) => go(`/style/${guide.id}`, { source: value })
  ));
  if (indices.length > 1) {
    controls.append(runSelector(indices, runIndex,
      (value) => go(`/style/${guide.id}`, { source: passage.id, run: value })));
  }
  root.append(controls);

  const pair = element('div', 'pair');
  pair.append(panel(ORIGINAL, passage, null, runIndex));
  pair.append(panel(guide.id, passage, cell, runIndex));
  root.append(pair);
}

async function sourceView(root, passageId, params) {
  const passage = passageById(passageId);
  if (!passage) {
    root.append(breadcrumb('Unknown source'));
    root.append(element('p', 'output failed', `No passage with id "${passageId}".`));
    return;
  }
  const valid = new Set([ORIGINAL, ...index.guides.map((guide) => guide.id)]);
  const left = valid.has(params.get('left')) ? params.get('left') : ORIGINAL;
  const right = valid.has(params.get('right')) ? params.get('right') : index.guides[0].id;

  const generated = [...new Set([left, right])].filter((voice) => voice !== ORIGINAL);
  const loaded = await Promise.all(generated.map((voice) => loadCell(`${voice}__${passage.id}`)));
  const cells = new Map(generated.map((voice, i) => [voice, loaded[i]]));
  const indices = runIndicesOf(loaded);
  const runIndex = resolveRun(indices, params.get('run'));

  const otherAxis = right === ORIGINAL ? `/style/${left}` : `/style/${right}`;
  root.append(breadcrumb(passage.title, valid.has(right) && right !== ORIGINAL ? otherAxis : null));
  root.append(element('h2', null, passage.title));
  root.append(element('p', 'lede', `${passage.genre} — ${passage.source}`));

  const here = (overrides) => go(`/source/${passage.id}`,
    { left, right, run: indices.length > 1 ? runIndex : undefined, ...overrides });

  const controls = element('div', 'controls');
  controls.append(field(
    'Source',
    index.passages.map((candidate) => ({ value: candidate.id, label: candidate.title })),
    passage.id,
    (value) => go(`/source/${value}`, { left, right })
  ));
  controls.append(field('Left column', voiceOptions(), left,
    (value) => here({ left: value, run: undefined })));

  const swap = element('button', 'swap', 'Swap ⇄');
  swap.type = 'button';
  swap.setAttribute('aria-label', `Swap ${voiceName(left)} and ${voiceName(right)}`);
  swap.addEventListener('click', () => here({ left: right, right: left }));
  controls.append(swap);

  controls.append(field('Right column', voiceOptions(), right,
    (value) => here({ right: value, run: undefined })));

  if (indices.length > 1) {
    controls.append(runSelector(indices, runIndex, (value) => here({ run: value })));
  }
  root.append(controls);

  const pair = element('div', 'pair');
  pair.append(panel(left, passage, cells.get(left) ?? null, runIndex));
  pair.append(panel(right, passage, cells.get(right) ?? null, runIndex));
  root.append(pair);
}

// ---------------------------------------------------------------- bootstrap

export async function render() {
  const root = document.getElementById('view');
  const route = parseRoute();
  root.replaceChildren();
  try {
    if (route.view === 'style') await styleView(root, route.id, route.params);
    else if (route.view === 'source') await sourceView(root, route.id, route.params);
    else homeView(root);
  } catch (error) {
    root.replaceChildren(element('p', 'output failed', error.message));
  }
  window.scrollTo(0, 0);
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
