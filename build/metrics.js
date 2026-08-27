/** Approximate syllable count: vowel groups, minus a silent trailing `e`. */
function countSyllables(word) {
  const clean = word.toLowerCase().replace(/[^a-z]/g, '');
  if (clean === '') return 0;
  const groups = clean.match(/[aeiouy]+/g) ?? [];
  let count = groups.length;
  if (clean.endsWith('e') && !clean.endsWith('le') && count > 1) count -= 1;
  return Math.max(1, count);
}

const round1 = (n) => Math.round(n * 10) / 10;

/**
 * Descriptive statistics for one piece of prose. These are not scores:
 * they describe the text, they do not judge it.
 */
export function computeMetrics(text) {
  const words = text.split(/\s+/).filter((w) => /[a-z0-9]/i.test(w));
  const sentences = text
    .split(/[.!?]+(?=\s|$)/)
    .map((s) => s.trim())
    .filter((s) => s !== '');

  if (words.length === 0) {
    return {
      words: 0, sentences: 0, syllables: 0,
      mean_sentence_length: 0, flesch_reading_ease: 0
    };
  }

  const syllables = words.reduce((sum, word) => sum + countSyllables(word), 0);
  const sentenceCount = Math.max(1, sentences.length);
  const wordsPerSentence = words.length / sentenceCount;
  const syllablesPerWord = syllables / words.length;

  return {
    words: words.length,
    sentences: sentenceCount,
    syllables,
    mean_sentence_length: round1(wordsPerSentence),
    flesch_reading_ease: round1(206.835 - 1.015 * wordsPerSentence - 84.6 * syllablesPerWord)
  };
}
