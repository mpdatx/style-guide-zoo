import test from 'node:test';
import assert from 'node:assert/strict';
import { computeMetrics } from '../build/metrics.js';

test('counts words and sentences', () => {
  const m = computeMetrics('The cat sat. The dog ran!');
  assert.equal(m.words, 6);
  assert.equal(m.sentences, 2);
});

test('counts a final sentence with no terminating punctuation', () => {
  assert.equal(computeMetrics('One two three').sentences, 1);
});

test('does not split on an abbreviation-free decimal', () => {
  assert.equal(computeMetrics('It cost 3.50 dollars today.').sentences, 1);
});

test('treats consecutive terminators as one sentence break', () => {
  assert.equal(computeMetrics('Really?! Yes.').sentences, 2);
});

test('computes mean sentence length to one decimal', () => {
  assert.equal(computeMetrics('a b c. d e.').mean_sentence_length, 2.5);
});

test('counts syllables by vowel groups, ignoring a silent final e', () => {
  assert.equal(computeMetrics('cake').syllables, 1);
  assert.equal(computeMetrics('running').syllables, 2);
  assert.equal(computeMetrics('a').syllables, 1);
});

test('scores simple prose higher than complex prose', () => {
  const simple = computeMetrics('The cat sat on the mat. The dog ran.');
  const complex = computeMetrics(
    'Notwithstanding the aforementioned considerations, the utilisation of ' +
    'supplementary infrastructure necessitates comprehensive reevaluation.'
  );
  assert.ok(simple.flesch_reading_ease > complex.flesch_reading_ease);
});

test('returns zeros for empty input', () => {
  assert.deepEqual(computeMetrics('   '), {
    words: 0, sentences: 0, syllables: 0,
    mean_sentence_length: 0, flesch_reading_ease: 0
  });
});
