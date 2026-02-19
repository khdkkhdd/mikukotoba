import type { UserSettings } from '@/types';
import type { DetectedBlock } from './text-detector';
import type { StatusIndicator } from '@/content/shared/status-indicator';
import type { ProcessedTracker } from '@/content/shared/processed-tracker';
import { translator } from '@/core/translator';
import { createInlineBlock } from '@/content/shared/renderers/inline-block';
import { escapeHtml } from '@/content/shared/dom-utils';
import { onWordClick } from '@/content/vocab/word-click-callback';

/**
 * Inline translation mode: inserts furigana and translation
 * directly below Japanese text blocks.
 */
export class InlineTranslator {
  private settings: UserSettings;
  private tracker: ProcessedTracker;
  private status: StatusIndicator | null = null;

  constructor(settings: UserSettings, tracker: ProcessedTracker) {
    this.settings = settings;
    this.tracker = tracker;
  }

  setStatusIndicator(indicator: StatusIndicator): void {
    this.status = indicator;
  }

  updateSettings(settings: UserSettings): void {
    this.settings = settings;
  }

  async processBlocks(blocks: DetectedBlock[]): Promise<void> {
    // Process in chunks to avoid blocking
    const chunkSize = 5;
    for (let i = 0; i < blocks.length; i += chunkSize) {
      const chunk = blocks.slice(i, i + chunkSize);
      await Promise.all(chunk.map((block) => this.processBlock(block)));

      // Yield to main thread between chunks
      if (i + chunkSize < blocks.length) {
        await new Promise((r) => requestIdleCallback(r));
      }
    }
  }

  private async processBlock(block: DetectedBlock): Promise<void> {
    if (this.tracker.isProcessed(block.element)) return;
    this.tracker.markProcessed(block.element, block.text);

    this.status?.translating();

    try {
      const result = await translator.translate(block.text);

      // Insert furigana into the original text nodes
      if (this.settings.showFurigana) {
        this.injectFurigana(block, result.tokens);
      }

      // Insert translation below the block
      if (this.settings.showTranslation) {
        const target = block.element;

        // Remove orphaned translations at insertion point
        this.tracker.removeExistingTranslation(target);

        const translationEl = createInlineBlock(result, this.settings, {
          classPrefix: 'jp-inline',
          className: 'jp-inline-translation',
          translationAttr: 'data-jp-translation',
          spoiler: true,
          skipFurigana: true,
          onRetranslate: () => translator.retranslate(block.text),
          onWordClick,
        });

        target.insertAdjacentElement('afterend', translationEl);
        this.tracker.trackInjected(translationEl);
      }

      this.status?.translated();
    } catch {
      // Allow retry: remove from processed set so it can be re-detected
      this.tracker.unmarkProcessed(block.element);
      this.status?.failed();
    }
  }

  private injectFurigana(
    block: DetectedBlock,
    tokens: import('@/types').MorphemeToken[]
  ): void {
    // Consume tokens sequentially across text nodes, building HTML token-by-token
    let tokenIndex = 0;

    for (const textNode of block.textNodes) {
      const raw = textNode.textContent || '';
      const trimmed = raw.trim();
      if (!trimmed) continue;

      let html = '';
      let pos = 0;

      while (pos < trimmed.length && tokenIndex < tokens.length) {
        const token = tokens[tokenIndex];

        if (trimmed.startsWith(token.surface, pos)) {
          if (token.isKanji && token.reading !== token.surface) {
            html += `<ruby>${escapeHtml(token.surface)}<rt>${escapeHtml(token.reading)}</rt></ruby>`;
          } else {
            html += escapeHtml(token.surface);
          }
          pos += token.surface.length;
          tokenIndex++;
        } else {
          html += escapeHtml(trimmed[pos]);
          pos++;
        }
      }

      // Remaining text not covered by tokens
      if (pos < trimmed.length) {
        html += escapeHtml(trimmed.slice(pos));
      }

      const span = document.createElement('span');
      span.setAttribute('data-jp-processed', 'true');
      span.style.lineHeight = '2.3em';
      span.innerHTML = html;
      textNode.parentNode?.replaceChild(span, textNode);
    }
  }

  /**
   * Remove all injected translations and furigana
   */
  cleanup(): void {
    this.tracker.cleanup();
  }
}
