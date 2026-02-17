import type { UserSettings } from '@/types';
import type { DetectedBlock } from './text-detector';
import type { StatusIndicator } from '@/content/shared/status-indicator';
import { translator } from '@/core/translator';
import { tokensToDetailedFuriganaHTML } from '@/core/analyzer/reading-converter';
import { escapeHtml, escapeHtmlWithBreaks } from '@/content/shared/dom-utils';
import { formatEngineBadgeWithRetry } from '@/content/shared/renderers/engine-badge';

/**
 * Inline translation mode: inserts furigana and translation
 * directly below Japanese text blocks.
 */
export class InlineTranslator {
  private settings: UserSettings;
  private processedBlocks = new WeakSet<HTMLElement>();
  private translationElements: HTMLElement[] = [];
  private status: StatusIndicator | null = null;

  constructor(settings: UserSettings) {
    this.settings = settings;
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
    if (this.processedBlocks.has(block.element)) return;
    this.processedBlocks.add(block.element);

    this.status?.translating();

    try {
      const result = await translator.translate(block.text);

      // Mark as processed only after successful translation
      block.element.setAttribute('data-jp-processed', 'true');

      // Insert furigana into the original text nodes
      if (this.settings.showFurigana) {
        this.injectFurigana(block, result.tokens);
      }

      // Insert translation below the block
      if (this.settings.showTranslation) {
        const translationEl = document.createElement('div');
        translationEl.className = 'jp-inline-translation';
        translationEl.setAttribute('data-jp-translation', 'true');
        translationEl.setAttribute('data-jp-processed', 'true');

        const buildContent = (r: typeof result) => {
          let c = '';
          if (this.settings.showRomaji) {
            const romaji = r.tokens.map((t) => t.romaji).join(' ');
            c += `<div class="jp-inline-romaji">${escapeHtml(romaji)}</div>`;
          }
          c += escapeHtmlWithBreaks(r.korean);
          c += `<div class="jp-inline-engine-badge">${formatEngineBadgeWithRetry(r, 'jp-inline')}</div>`;
          return c;
        };

        translationEl.innerHTML = buildContent(result);

        const attachRetry = (el: HTMLElement) => {
          const btn = el.querySelector<HTMLElement>('.jp-inline-retry-btn');
          if (btn) {
            btn.addEventListener('click', async (e) => {
              e.stopPropagation();
              btn.classList.add('jp-inline-retry-spinning');
              try {
                const newResult = await translator.retranslate(block.text);
                el.innerHTML = buildContent(newResult);
                attachRetry(el);
              } catch {
                btn.classList.remove('jp-inline-retry-spinning');
              }
            });
          }
        };
        attachRetry(translationEl);

        // Insert after the block element
        const target = block.element;

        // Remove orphaned translations at insertion point
        // (YouTube re-renders can replace elements, leaving old translations behind)
        let orphan = target.nextElementSibling;
        while (orphan?.hasAttribute('data-jp-translation')) {
          const next = orphan.nextElementSibling;
          orphan.remove();
          orphan = next;
        }

        target.insertAdjacentElement('afterend', translationEl);
        this.translationElements.push(translationEl);
      }

      this.status?.translated();
    } catch {
      // Allow retry: remove from processed set so it can be re-detected
      this.processedBlocks.delete(block.element);
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
    for (const el of this.translationElements) {
      el.remove();
    }
    this.translationElements = [];

    // Remove furigana spans
    document.querySelectorAll('[data-jp-processed]').forEach((el) => {
      el.removeAttribute('data-jp-processed');
    });

    this.processedBlocks = new WeakSet();
  }
}
