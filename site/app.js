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
  block('argv', run.request.argv.join(' '));
  block('System prompt', run.request.system_prompt);
  block('User prompt', run.request.user_prompt);
  details.append(list);
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
    container.append(provenance(run));
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
      button.setAttribute('aria-label', `Run ${runIndex}`);
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

  history.replaceState(null, '', `#${encodeURIComponent(passageId)}`);
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
