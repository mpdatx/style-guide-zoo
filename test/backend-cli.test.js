import test from 'node:test';
import assert from 'node:assert/strict';
import { buildArgv, parseEnvelope, CLAUDE, createCliBackend, SIGKILL_ESCALATION_MS } from '../runner/backends/cli.js';
import * as nodeChildProcess from 'node:child_process';

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

test('argv ignores a passage-shaped property even if one is passed in', () => {
  const argv = buildArgv({ ...argvOptions, userPrompt: 'The quick brown fox jumps.' });
  assert.ok(!argv.some((a) => typeof a === 'string' && a.includes('quick brown fox')));
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

test('parseEnvelope treats a null result as a normal cli-stage failure, not a throw', () => {
  const parsed = parseEnvelope(JSON.stringify({
    type: 'result', subtype: 'error_max_turns', is_error: false, result: null, session_id: 'x'
  }));
  assert.equal(parsed.ok, false);
  assert.equal(parsed.error.stage, 'cli');
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

test('parseEnvelope prefers the highest-outputTokens entry over the requested model, revealing substitution', () => {
  // Even though claude-haiku-4-5 was requested, sonnet did most of the work
  // (more outputTokens), so it should be reported -- this is a real signal
  // that the CLI substituted or delegated to a different model.
  const parsed = parseEnvelope(MULTI_MODEL_ENVELOPE, 'claude-haiku-4-5');
  assert.equal(parsed.model_reported, 'claude-sonnet-5');
});

const TIED_OUTPUT_ENVELOPE = JSON.stringify({
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
      inputTokens: 100, outputTokens: 20,
      canonicalModel: 'claude-haiku-4-5', provider: 'firstParty'
    },
    'claude-sonnet-5': {
      inputTokens: 100, outputTokens: 20,
      canonicalModel: 'claude-sonnet-5', provider: 'firstParty'
    }
  },
  usage: { input_tokens: 200, output_tokens: 40 }
});

test('parseEnvelope uses the requested model as a tiebreak when outputTokens are equal', () => {
  const parsed = parseEnvelope(TIED_OUTPUT_ENVELOPE, 'claude-sonnet-5');
  assert.equal(parsed.model_reported, 'claude-sonnet-5');
});

test('parseEnvelope uses canonicalModel as a tiebreak when outputTokens are equal and the key differs', () => {
  const parsed = parseEnvelope(TIED_OUTPUT_ENVELOPE, 'claude-haiku-4-5');
  assert.equal(parsed.model_reported, 'claude-haiku-4-5-20251001');
});

test('parseEnvelope still returns the single entry when modelUsage has only one key', () => {
  assert.equal(parseEnvelope(ENVELOPE, 'claude-sonnet-5').model_reported, 'claude-sonnet-5-20260101');
});

test('multi-byte UTF-8 text survives being split across stdout chunk boundaries', async () => {
  // Drives the *real* accumulation path in runner/backends/cli.js (setEncoding('utf8')
  // on child.stdout, then `stdout += chunk`). The spawned child is plain `node`, run
  // via the `-p <script> -- <args>` trick already used by the timeout test above:
  // node evaluates `script` as its `-p` argument, and everything after `--` is
  // available to that script as `process.argv`, while also satisfying buildArgv's
  // fixed `--tools '' --model ... --output-format json` tail (ignored by the script).
  //
  // The child writes a `--output-format json` envelope whose `result` contains
  // multi-byte characters (em-dash, curly quotes, an emoji, and a CJK character),
  // split via two separate `fs.writeSync` calls with a real (Atomics.wait-based)
  // pause in between so the two halves are delivered to the parent as separate
  // 'data' events rather than coalesced into one. If `setEncoding('utf8')` were
  // removed from cli.js, `stdout += chunk` would coerce each Buffer chunk to a
  // string independently (using Buffer's default utf8 decoding *per chunk*),
  // corrupting whichever multi-byte character straddles the split point into
  // U+FFFD replacement characters -- so this assertion would fail.
  const text = 'An em dash — and curly quotes: “like this” and emoji 😀 and CJK 漢字';
  const envelope = JSON.stringify({
    type: 'result', subtype: 'success', is_error: false, result: text,
    session_id: 'utf8-chunk-test', duration_ms: 1, num_turns: 1, total_cost_usd: 0,
    modelUsage: {}, usage: {}
  });
  const buf = Buffer.from(envelope, 'utf8');
  const emojiIndex = buf.indexOf(Buffer.from('😀', 'utf8'));
  const splitPoint = emojiIndex + 2; // splits the middle of the 4-byte emoji sequence
  const base64Envelope = buf.toString('base64');

  const childScript = [
    "const fs=require('fs');",
    "const buf=Buffer.from(process.argv[1],'base64');",
    'const mid=Number(process.argv[2]);',
    'fs.writeSync(1,buf.subarray(0,mid));',
    // Real (non-busy) synchronous pause so the two writes land as separate
    // pipe reads on the parent side instead of being coalesced into one.
    'Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,30);',
    'fs.writeSync(1,buf.subarray(mid));',
    'process.exit(0)'
  ].join('');

  const backend = await createCliBackend({
    claudePath: process.execPath,
    extraFlags: [childScript, '--', base64Envelope, String(splitPoint)]
  });
  const result = await backend.generate({
    systemPrompt: 'sys', userPrompt: 'usr', model: 'claude-sonnet-5'
  });

  assert.equal(result.ok, true);
  assert.equal(result.text, text);
});

test('generate returns a timeout-stage failure and kills the child when it hangs', { timeout: 10000 }, async () => {
  const backend = await createCliBackend({
    claudePath: process.execPath,
    // Runs under plain `node`: prints 1 via -p, then stays alive on the pending timer.
    // The `--` stops node from trying to parse the rest of the CLI-shaped argv
    // (--tools, --model, etc.) as its own flags.
    extraFlags: ['1;setTimeout(() => {}, 100000);', '--'],
    timeoutMs: 150
  });
  const result = await backend.generate({
    systemPrompt: 'sys', userPrompt: 'usr', model: 'claude-sonnet-5'
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.stage, 'timeout');
});

test('a child that ignores SIGTERM is escalated to SIGKILL instead of wedging the run', async (t) => {
  // On this platform (Windows), Node's child.kill() unconditionally terminates
  // the target process even when it has installed a 'SIGTERM' handler -- there
  // is no way to construct a genuinely SIGTERM-ignoring child that survives the
  // first kill() call (verified empirically: a child with process.on('SIGTERM',
  // ...) still closes immediately when the parent calls child.kill()). So this
  // test instead verifies the escalation *wiring* directly: it intercepts
  // ChildProcess.prototype.kill to simulate the first (SIGTERM) call being
  // ignored, uses the test runner's mock timers to fast-forward past both the
  // generation timeout and the SIGKILL_ESCALATION_MS window without any real
  // waiting, and asserts that a second kill call with 'SIGKILL' follows -- the
  // second call is allowed through to the real implementation so the actual
  // hung child process is cleaned up for real, not left running.
  t.mock.timers.enable({ apis: ['setTimeout'] });

  const originalKill = nodeChildProcess.ChildProcess.prototype.kill;
  const killSignals = [];
  nodeChildProcess.ChildProcess.prototype.kill = function mockedKill(signal) {
    killSignals.push(signal ?? 'SIGTERM');
    if (killSignals.length === 1) return true; // simulate the child ignoring SIGTERM
    return originalKill.call(this, signal);
  };
  t.after(() => { nodeChildProcess.ChildProcess.prototype.kill = originalKill; });

  const backend = await createCliBackend({
    claudePath: process.execPath,
    extraFlags: ['1;setTimeout(() => {}, 100000);', '--'],
    timeoutMs: 50
  });

  const resultPromise = backend.generate({
    systemPrompt: 'sys', userPrompt: 'usr', model: 'claude-sonnet-5'
  });

  t.mock.timers.tick(50);
  assert.deepEqual(killSignals, ['SIGTERM']);

  t.mock.timers.tick(SIGKILL_ESCALATION_MS);
  assert.deepEqual(killSignals, ['SIGTERM', 'SIGKILL']);

  const result = await resultPromise;
  assert.equal(result.ok, false);
  assert.equal(result.error.stage, 'timeout');
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
