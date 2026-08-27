/**
 * A deterministic stand-in for the Claude Code CLI.
 * Produces text that varies by guide, passage, and run index so that tests
 * can tell records apart, without any network call or process spawn.
 *
 * `failFor` entries name a runId to fail for, optionally suffixed with
 * `:<stage>` (e.g. `"alpha__one__r1:parse"`) to control which error stage is
 * reported; the stage defaults to `spawn` when omitted. This lets tests
 * exercise the retry policy in `runner/run.js`, which only retries `spawn`
 * and `timeout` stage failures -- a `parse` or `cli` stage failure should
 * return after a single attempt.
 */
export function createFakeBackend({ failFor = new Set() } = {}) {
  const failStages = new Map();
  for (const entry of failFor) {
    const sep = entry.indexOf(':');
    if (sep === -1) failStages.set(entry, 'spawn');
    else failStages.set(entry.slice(0, sep), entry.slice(sep + 1));
  }
  return {
    name: 'fake',
    version: 'fake-1',
    async generate({ systemPrompt, userPrompt, model, runIndex, runId }) {
      if (failStages.has(runId)) {
        const stage = failStages.get(runId);
        return {
          ok: false,
          error: { message: `fake backend was told to fail (stage: ${stage})`, stage },
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
