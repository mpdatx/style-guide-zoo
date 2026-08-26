/**
 * Fill a prompt template with a passage. Uses a replacer function so that
 * `$&`, `$1` and friends inside the passage are treated literally.
 */
export function buildUserPrompt(template, passage) {
  return template.body.replaceAll('{{PASSAGE}}', () => passage.text);
}
