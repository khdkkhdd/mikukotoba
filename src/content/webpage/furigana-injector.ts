import type { UserSettings } from '@/types';
import type { DetectedBlock } from './text-detector';
import { MorphologicalAnalyzer } from '@/core/analyzer/morphological';
import { escapeHtml } from '@/content/shared/dom-utils';

/**
 * Full furigana mode: injects furigana (ruby annotations) into all
 * Japanese text on the page. No translation — just reading aids.
 * Processes in chunks using requestIdleCallback to avoid blocking.
 */
export class FuriganaInjector {
  private settings: UserSettings;
  private analyzer: MorphologicalAnalyzer;
  private processedNodes = new WeakSet<Node>();
  private injectedSpans: HTMLSpanElement[] = [];

  constructor(settings: UserSettings) {
    this.settings = settings;
    this.analyzer = new MorphologicalAnalyzer();
  }

  async init(): Promise<void> {
    await this.analyzer.init();
  }

  updateSettings(settings: UserSettings): void {
    this.settings = settings;
  }

  async processBlocks(blocks: DetectedBlock[]): Promise<void> {
    if (!this.analyzer.isReady()) {
      await this.init();
    }

    // Process in chunks of 100 nodes
    const CHUNK_SIZE = 100;
    const allNodes = blocks.flatMap((b) => b.textNodes);

    for (let i = 0; i < allNodes.length; i += CHUNK_SIZE) {
      const chunk = allNodes.slice(i, i + CHUNK_SIZE);
      await this.processChunk(chunk);

      // Yield to main thread
      if (i + CHUNK_SIZE < allNodes.length) {
        await new Promise<void>((resolve) => {
          if ('requestIdleCallback' in window) {
            requestIdleCallback(() => resolve());
          } else {
            setTimeout(resolve, 16);
          }
        });
      }
    }
  }

  private async processChunk(textNodes: Text[]): Promise<void> {
    for (const textNode of textNodes) {
      if (this.processedNodes.has(textNode)) continue;
      this.processedNodes.add(textNode);

      const text = textNode.textContent?.trim();
      if (!text) continue;

      try {
        const tokens = await this.analyzer.analyze(text);
        const hasKanjiTokens = tokens.some((t) => t.isKanji && t.reading !== t.surface);
        if (!hasKanjiTokens) continue;

        const span = document.createElement('span');
        span.setAttribute('data-jp-processed', 'true');
        span.style.lineHeight = '2.3em';

        let html = '';
        for (const token of tokens) {
          if (token.isKanji && token.reading !== token.surface) {
            html += `<ruby>${escapeHtml(token.surface)}<rt>${escapeHtml(token.reading)}</rt></ruby>`;
          } else {
            html += escapeHtml(token.surface);
          }
        }

        span.innerHTML = html;
        textNode.parentNode?.replaceChild(span, textNode);
        this.injectedSpans.push(span);
      } catch {
        // Skip nodes that fail analysis
      }
    }
  }

  cleanup(): void {
    // Restore original text nodes
    for (const span of this.injectedSpans) {
      const text = document.createTextNode(span.textContent || '');
      span.parentNode?.replaceChild(text, span);
    }
    this.injectedSpans = [];
    this.processedNodes = new WeakSet();
  }
}
