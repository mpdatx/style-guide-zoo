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
  '--guides-dir', '--corpus-dir', '--template', '--results-dir', '--config', '--fail-for'
]);
const BACKENDS = new Set(['cli', 'fake']);

function parsePositiveInteger(value, optionName) {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`Option ${optionName} requires a positive integer, got: ${value}`);
  }
  return n;
}

export function parseArgs(argv) {
  const options = {
    guideIds: [], passageIds: [], runs: null, concurrency: null,
    backend: 'cli', model: null, force: false, dryRun: false, quiet: false, help: false,
    guidesDir: 'guides', corpusDir: 'corpus', templatePath: null,
    resultsDir: 'results/runs', configPath: 'config/experiment.json', failFor: []
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
    if (arg === '--runs') options.runs = parsePositiveInteger(value, '--runs');
    if (arg === '--concurrency') options.concurrency = parsePositiveInteger(value, '--concurrency');
    if (arg === '--backend') {
      if (!BACKENDS.has(value)) throw new Error(`Unknown backend: ${value} (expected cli or fake)`);
      options.backend = value;
    }
    if (arg === '--model') options.model = value;
    if (arg === '--guides-dir') options.guidesDir = value;
    if (arg === '--corpus-dir') options.corpusDir = value;
    if (arg === '--template') options.templatePath = value;
    if (arg === '--results-dir') options.resultsDir = value;
    if (arg === '--config') options.configPath = value;
    if (arg === '--fail-for') options.failFor = value.split(',').filter(Boolean);
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

  const backendName = options.backend === 'fake' ? 'fake' : 'claude-code-cli';

  const worklist = await buildWorklist({
    guides, passages, template, runsPerCell,
    resultsDir: options.resultsDir,
    filters: { guideIds: options.guideIds, passageIds: options.passageIds },
    force: options.force,
    backend: backendName
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
    ? createFakeBackend({ failFor: new Set(options.failFor) })
    : await createCliBackend({ maxBudgetUsd: config.max_budget_usd, extraFlags: config.cli_flags });

  const RETRYABLE_STAGES = new Set(['spawn', 'timeout']);

  let failures = 0;
  await mapPool(worklist, concurrency, async (item) => {
    const runId = `${item.guide.id}__${item.passage.id}__r${item.runIndex}`;
    const systemPrompt = item.guide.systemPrompt;
    const userPrompt = buildUserPrompt(item.template, item.passage);

    try {
      let result;
      let attempts = 0;
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        attempts = attempt;
        result = await backend.generate({
          systemPrompt, userPrompt, model, runIndex: item.runIndex, runId
        });
        if (result.ok) break;
        if (!RETRYABLE_STAGES.has(result.error?.stage)) break;
        if (attempt < 3) await new Promise((r) => setTimeout(r, 1000 * attempt));
      }

      const { argv: usedArgv = [], ...response } = result;
      response.attempts = attempts;
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
    } catch (error) {
      failures += 1;
      log(`  FAIL ${runId} (unexpected error: ${error.message})`);
      try {
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
            argv: [],
            system_prompt: systemPrompt,
            user_prompt: userPrompt
          },
          response: {
            ok: false,
            attempts: 0,
            error: { message: error.message, stage: 'runner' }
          }
        }));
      } catch {
        // Best effort: if even the failure record cannot be written, the
        // failure count above still reflects that this item did not succeed.
      }
    }
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
