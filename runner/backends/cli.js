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
  const byOutputTokens = names.reduce((best, name) => {
    if (best === undefined) return name;
    return (modelUsage[name]?.outputTokens ?? 0) > (modelUsage[best]?.outputTokens ?? 0) ? name : best;
  }, undefined);
  const maxOutputTokens = modelUsage[byOutputTokens]?.outputTokens ?? 0;
  const tiedForBest = names.filter((name) => (modelUsage[name]?.outputTokens ?? 0) === maxOutputTokens);
  if (tiedForBest.length > 1 && requestedModel !== undefined && requestedModel !== null) {
    if (tiedForBest.includes(requestedModel)) {
      return requestedModel;
    }
    const byCanonical = tiedForBest.find((name) => modelUsage[name]?.canonicalModel === requestedModel);
    if (byCanonical !== undefined) {
      return byCanonical;
    }
  }
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
  if (envelope.result === null) {
    const stopReason = envelope.stop_reason ?? null;
    return {
      ok: false,
      model_reported: reportedModel(envelope, requestedModel),
      model_usage: envelope.modelUsage ?? {},
      usage: envelope.usage ?? {},
      total_cost_usd: envelope.total_cost_usd ?? 0,
      duration_ms: envelope.duration_ms ?? 0,
      session_id: envelope.session_id ?? '',
      num_turns: envelope.num_turns ?? 0,
      stop_reason: stopReason,
      error: {
        message: stopReason
          ? `CLI reported an error (stop_reason: ${stopReason})`
          : 'CLI returned a null result (refusal or budget stop)',
        stage: 'cli'
      }
    };
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
    num_turns: envelope.num_turns ?? 0,
    stop_reason: envelope.stop_reason ?? null
  };
  if (envelope.is_error) {
    const message = (typeof envelope.result === 'string' && envelope.result.length > 0)
      ? envelope.result
      : (common.stop_reason
        ? `CLI reported an error (stop_reason: ${common.stop_reason})`
        : 'CLI reported an error with no result text');
    return {
      ok: false,
      ...common,
      error: { message, stage: 'cli' }
    };
  }
  return { ok: true, text: envelope.result, ...common };
}

export const DEFAULT_TIMEOUT_MS = 300000;

// If a child ignores SIGTERM (sent when the generation timeout fires), give it
// this long to exit cleanly before escalating to SIGKILL. Without this, a
// child that never closes would leave the run's promise unsettled forever --
// exactly the hang the timeout was added to prevent.
export const SIGKILL_ESCALATION_MS = 5000;

function run(command, argv, stdin, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, argv, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;
    let killTimer = null;
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });

    const settle = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(killTimer);
      resolve(result);
    };

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
      killTimer = setTimeout(() => {
        child.kill('SIGKILL');
      }, SIGKILL_ESCALATION_MS);
    }, timeoutMs);

    child.on('error', (error) => {
      settle({ code: -1, stdout, stderr: error.message, timedOut: false });
    });
    child.on('close', (code) => {
      settle({ code, stdout, stderr, timedOut });
    });
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

export async function createCliBackend({
  claudePath = CLAUDE, extraFlags = [], maxBudgetUsd, timeoutMs = DEFAULT_TIMEOUT_MS
} = {}) {
  const version = await detectCliVersion({ claudePath });
  return {
    name: 'claude-code-cli',
    version,
    async generate({ systemPrompt, userPrompt, model }) {
      const argv = buildArgv({ model, systemPrompt, extraFlags, maxBudgetUsd });
      const { code, stdout, stderr, timedOut } = await run(claudePath, argv, userPrompt, { timeoutMs });
      if (timedOut) {
        return {
          ok: false, argv,
          error: { message: `claude timed out after ${timeoutMs}ms and was killed`, stage: 'timeout' }
        };
      }
      if (code !== 0) {
        try {
          return { ...parseEnvelope(stdout, model), argv };
        } catch {
          return {
            ok: false, argv,
            error: { message: `claude exited with code ${code}: ${stderr.trim()}`, stage: 'spawn' }
          };
        }
      }
      try {
        return { ...parseEnvelope(stdout, model), argv };
      } catch (error) {
        return { ok: false, argv, error: { message: error.message, stage: 'parse' } };
      }
    }
  };
}
