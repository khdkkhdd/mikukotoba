import type { TranslationResult, UserSettings } from '@/types';
import { addSpoilerBehavior } from './spoiler';

export interface InlineBracketOptions {
  /** Data attribute for identifying injected elements */
  translationAttr?: string;
  /** CSS class name */
  className?: string;
  /** Blur until clicked */
  spoiler?: boolean;
}

/**
 * Create an inline bracket hint like ` (한국어번역)`.
 *
 * Returns a detached span — the caller inserts it into the DOM.
 * Extracted from trend-handler and tweet-handler (poll options).
 */
export function createInlineBracket(
  result: TranslationResult,
  _settings: UserSettings,
  opts?: InlineBracketOptions,
): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = opts?.className ?? 'jp-twitter-inline-hint';
  if (opts?.spoiler !== false) {
    span.classList.add('jp-spoiler');
  }
  if (opts?.translationAttr) {
    span.setAttribute(opts.translationAttr, 'true');
  }
  span.textContent = ` (${result.korean})`;

  if (opts?.spoiler !== false) {
    addSpoilerBehavior(span);
  }

  return span;
}
