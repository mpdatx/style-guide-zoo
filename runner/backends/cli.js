import { spawn } from 'node:child_process';

export const CLAUDE = 'claude';

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

function reportedModel(envelope, requestedModel) {
  const modelUsage = envelope.modelUsage ?? {};
  const names = Object.keys(modelUsage);
  if (names.length === 0) {
    return envelope.model ?? '';
  }
  if (requestedModel !== undefined && requestedModel !== null) {
    if (names.includes(requestedModel)) {
      return requestedModel;
    }
    const byCanonical = names.find((name) => modelUsage[name]?.canonicalModel === requestedModel);
    if (byCanonical !== undefined) {
      return byCanonical;
    }
  }
  const byOutputTokens = names.reduce((best, name) => {
    if (best === undefined) return name;
    return (modelUsage[name]?.outputTokens ?? 0) > (modelUsage[best]?.outputTokens ?? 0) ? name : best;
  }, undefined);
  return byOutputTokens ?? envelope.model ?? '';
}

/** Turn the `--output-format json` envelope into a GenerateResult. */
export function parseEnvelope(stdout, requestedModel) {
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
    model_reported: reportedModel(envelope, requestedModel),
    model_usage: envelope.modelUsage ?? {},
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
        return { ...parseEnvelope(stdout, model), argv };
      } catch (error) {
        return { ok: false, argv, error: { message: error.message, stage: 'parse' } };
      }
    }
  };
}
