/**
 * Escape HTML entities
 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Escape HTML entities and preserve line breaks as <br>.
 * Use for multi-line content (translations, comments) rendered via innerHTML.
 */
export function escapeHtmlWithBreaks(text: string): string {
  return escapeHtml(text).replace(/\n/g, '<br>');
}
