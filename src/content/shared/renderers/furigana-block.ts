import type { TranslationResult, UserSettings } from '@/types';
import { tokensToFuriganaHTML } from '@/core/analyzer/reading-converter';

export interface FuriganaBlockOptions {
  /** Container CSS class */
  className?: string;
  /** Data attribute for identifying injected elements */
  translationAttr?: string;
  /** Class prefix for child elements */
  classPrefix?: string;
}

/**
 * Create a standalone furigana block that inherits visual style from the source element.
 *
 * Copies font-size, font-weight, color, font-family, and letter-spacing from
 * `sourceElement` via getComputedStyle so that the furigana visually matches
 * the original text it replaces.
 *
 * IMPORTANT: Call this BEFORE hiding the source element (jp-furigana-hidden).
 */
export function createStyledFuriganaBlock(
  result: TranslationResult,
  sourceElement: HTMLElement,
  opts?: FuriganaBlockOptions,
): HTMLDivElement {
  const prefix = opts?.classPrefix ?? 'jp-yt';
  const div = document.createElement('div');
  div.className = `${prefix}-furigana`;
  if (opts?.translationAttr) {
    div.setAttribute(opts.translationAttr, 'true');
  }
  // Copy visual style from the original element
  const cs = window.getComputedStyle(sourceElement);
  div.style.fontSize = cs.fontSize;
  div.style.fontWeight = cs.fontWeight;
  div.style.color = cs.color;
  div.style.fontFamily = cs.fontFamily;
  div.style.letterSpacing = cs.letterSpacing;

  div.innerHTML = tokensToFuriganaHTML(result.tokens);
  return div;
}

/**
 * Create a furigana-only block (no translation, no romaji).
 * Used for MAIN elements in `furigana-only` mode.
 *
 * Returns a detached div — the caller inserts it into the DOM.
 */
export function createFuriganaBlock(
  result: TranslationResult,
  _settings: UserSettings,
  opts?: FuriganaBlockOptions,
): HTMLDivElement {
  const prefix = opts?.classPrefix ?? 'jp-yt';
  const div = document.createElement('div');
  div.className = opts?.className ?? `${prefix}-furigana-block`;
  if (opts?.translationAttr) {
    div.setAttribute(opts.translationAttr, 'true');
  }
  const furiganaDiv = document.createElement('div');
  furiganaDiv.className = `${prefix}-furigana`;
  furiganaDiv.innerHTML = tokensToFuriganaHTML(result.tokens);
  div.appendChild(furiganaDiv);

  return div;
}

/**
 * Create a furigana-only bracket hint like ` (よみ)`.
 * Used for LABEL elements in `furigana-only` mode.
 *
 * Returns a detached span — the caller inserts it into the DOM.
 */
export function createFuriganaBracket(
  result: TranslationResult,
  _settings: UserSettings,
  opts?: FuriganaBlockOptions,
): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = opts?.className ?? 'jp-yt-inline-hint';
  if (opts?.translationAttr) {
    span.setAttribute(opts.translationAttr, 'true');
  }

  // Build reading from tokens
  const reading = result.tokens.map(t => t.reading || t.surface).join('');
  span.textContent = ` (${reading})`;

  return span;
}
