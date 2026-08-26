/**
 * A deterministic stand-in for the Claude Code CLI.
 * Produces text that varies by guide, passage, and run index so that tests
 * can tell records apart, without any network call or process spawn.
 */
export function createFakeBackend({ failFor = new Set() } = {}) {
  return {
    name: 'fake',
    version: 'fake-1',
    async generate({ systemPrompt, userPrompt, model, runIndex, runId }) {
      if (failFor.has(runId)) {
        return {
          ok: false,
          error: { message: 'fake backend was told to fail', stage: 'spawn' },
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
