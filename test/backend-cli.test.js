import test from 'node:test';
import assert from 'node:assert/strict';
import { buildArgv, parseEnvelope, CLAUDE } from '../runner/backends/cli.js';

test('the default CLI command is plain "claude" on every platform', () => {
  assert.equal(CLAUDE, 'claude');
});

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

const MULTI_MODEL_ENVELOPE = JSON.stringify({
  type: 'result',
  subtype: 'success',
  is_error: false,
  result: 'The rewritten text.',
  session_id: 'abc-123',
  duration_ms: 4200,
  num_turns: 1,
  total_cost_usd: 0.0123,
  modelUsage: {
    'claude-haiku-4-5-20251001': {
      inputTokens: 903, outputTokens: 10,
      canonicalModel: 'claude-haiku-4-5', provider: 'firstParty'
    },
    'claude-sonnet-5': {
      inputTokens: 339, outputTokens: 26,
      canonicalModel: 'claude-sonnet-5', provider: 'firstParty'
    }
  },
  usage: { input_tokens: 1242, output_tokens: 36 }
});

test('parseEnvelope picks the requested model even when it is not the first modelUsage key', () => {
  const parsed = parseEnvelope(MULTI_MODEL_ENVELOPE, 'claude-sonnet-5');
  assert.equal(parsed.model_reported, 'claude-sonnet-5');
});

test('parseEnvelope falls back to the highest-outputTokens entry when the requested model matches no key', () => {
  const parsed = parseEnvelope(MULTI_MODEL_ENVELOPE, 'claude-opus-4-6');
  assert.equal(parsed.model_reported, 'claude-sonnet-5');
});

test('parseEnvelope matches the requested model via canonicalModel when the key differs', () => {
  const parsed = parseEnvelope(MULTI_MODEL_ENVELOPE, 'claude-haiku-4-5');
  assert.equal(parsed.model_reported, 'claude-haiku-4-5-20251001');
});

test('parseEnvelope still returns the single entry when modelUsage has only one key', () => {
  assert.equal(parseEnvelope(ENVELOPE, 'claude-sonnet-5').model_reported, 'claude-sonnet-5-20260101');
});

test('parseEnvelope preserves the full modelUsage map as model_usage', () => {
  const parsed = parseEnvelope(MULTI_MODEL_ENVELOPE, 'claude-sonnet-5');
  assert.deepEqual(parsed.model_usage, {
    'claude-haiku-4-5-20251001': {
      inputTokens: 903, outputTokens: 10,
      canonicalModel: 'claude-haiku-4-5', provider: 'firstParty'
    },
    'claude-sonnet-5': {
      inputTokens: 339, outputTokens: 26,
      canonicalModel: 'claude-sonnet-5', provider: 'firstParty'
    }
  });
});
