import type { TranslationResult, UserSettings } from '@/types';
import { tokensToFuriganaHTML } from '@/core/analyzer/reading-converter';
import { escapeHtml, escapeHtmlWithBreaks } from '@/content/shared/dom-utils';
import { addSpoilerBehavior } from './spoiler';
import { formatEngineBadge, formatEngineBadgeWithRetry } from './engine-badge';
import type { WordClickCallback } from './ruby-injector';

export interface InlineBlockOptions {
  /** Container CSS class (e.g. 'jp-twitter-translation') */
  className?: string;
  /** Data attribute for identifying injected elements */
  translationAttr?: string;
  /** Use compact padding (e.g. for user cells) */
  compact?: boolean;
  /** Blur the Korean translation until clicked */
  spoiler?: boolean;
  /** Class prefix for child elements (e.g. 'jp-twitter' → jp-twitter-furigana) */
  classPrefix?: string;
  /** Skip furigana row (rendered separately as a styled block) */
  skipFurigana?: boolean;
  /** Callback for retry translation via LLM */
  onRetranslate?: () => Promise<TranslationResult>;
  /** Callback for word click → vocab modal */
  onWordClick?: WordClickCallback;
}

/**
 * Create an inline translation block with furigana, romaji, and Korean translation.
 *
 * Returns a detached div — the caller is responsible for inserting it into the DOM.
 * Extracted from tweet-handler, user-handler, and inline-translator.
 */
export function createInlineBlock(
  result: TranslationResult,
  settings: UserSettings,
  opts?: InlineBlockOptions,
): HTMLDivElement {
  const prefix = opts?.classPrefix ?? 'jp-twitter';
  const className = opts?.className ?? `${prefix}-translation`;

  const div = document.createElement('div');
  div.className = opts?.compact ? `${className} ${prefix}-compact` : className;
  if (opts?.translationAttr) {
    div.setAttribute(opts.translationAttr, 'true');
  }
  div.innerHTML = generateInlineHTML(result, settings, prefix, opts);
  attachInlineBehaviors(div, settings, prefix, opts);

  return div;
}

function generateInlineHTML(
  result: TranslationResult,
  settings: UserSettings,
  prefix: string,
  opts?: InlineBlockOptions,
): string {
  let html = '';

  // Furigana-annotated original text
  if (settings.showFurigana && !opts?.skipFurigana) {
    html += `<div class="${prefix}-furigana">${tokensToFuriganaHTML(result.tokens)}</div>`;
  }

  // Romaji
  if (settings.showRomaji) {
    const romaji = result.tokens.map(t => t.romaji).join(' ');
    html += `<div class="${prefix}-romaji">${escapeHtml(romaji)}</div>`;
  }

  // Korean translation
  if (settings.showTranslation) {
    const spoilerClass = opts?.spoiler !== false ? ' jp-spoiler' : '';
    html += `<div class="${prefix}-korean${spoilerClass}">${escapeHtmlWithBreaks(result.korean)}</div>`;
    const badge = opts?.onRetranslate
      ? formatEngineBadgeWithRetry(result, prefix)
      : formatEngineBadge(result);
    html += `<div class="${prefix}-engine-badge">${badge}</div>`;
  }

  return html;
}

function attachInlineBehaviors(
  div: HTMLDivElement,
  settings: UserSettings,
  prefix: string,
  opts?: InlineBlockOptions,
): void {
  // Click-to-reveal on spoiler elements
  const spoiler = div.querySelector<HTMLElement>('.jp-spoiler');
  if (spoiler) {
    addSpoilerBehavior(spoiler);
  }

  // Word click → vocab modal on ruby elements
  if (opts?.onWordClick) {
    const furiganaDiv = div.querySelector<HTMLElement>(`.${prefix}-furigana`);
    if (furiganaDiv) {
      const rubies = furiganaDiv.querySelectorAll('ruby');
      for (const ruby of rubies) {
        ruby.style.cursor = 'pointer';
        ruby.classList.add('jp-vocab-clickable');
        ruby.addEventListener('click', (e) => {
          e.stopPropagation();
          const surface = ruby.firstChild?.textContent || '';
          const rt = ruby.querySelector('rt');
          const reading = rt?.textContent || '';
          const sentence = furiganaDiv.textContent?.trim() || '';
          opts.onWordClick!(surface, reading, sentence);
        });
      }
    }
  }

  // Retry button handler
  if (opts?.onRetranslate) {
    const retryBtn = div.querySelector<HTMLElement>(`.${prefix}-retry-btn`);
    if (retryBtn) {
      retryBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        retryBtn.classList.add(`${prefix}-retry-spinning`);

        try {
          const newResult = await opts.onRetranslate!();
          div.innerHTML = generateInlineHTML(newResult, settings, prefix, opts);
          attachInlineBehaviors(div, settings, prefix, opts);
        } catch {
          retryBtn.classList.remove(`${prefix}-retry-spinning`);
        }
      });
    }
  }
}
