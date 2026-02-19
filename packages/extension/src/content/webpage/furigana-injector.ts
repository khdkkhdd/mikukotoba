import type { UserSettings } from '@/types';
import type { DetectedBlock } from './text-detector';
import { ProcessedTracker } from '@/content/shared/processed-tracker';
import { MorphologicalAnalyzer } from '@/core/analyzer/morphological';
import { createRubyClone } from '@/content/shared/renderers/ruby-injector';

const PROCESSED_ATTR = 'data-jp-processed';
const TRANSLATION_ATTR = 'data-jp-translation';

/**
 * Full furigana mode: injects furigana (ruby annotations) into all
 * Japanese text on the page. No translation — just reading aids.
 *
 * Uses createRubyClone for non-destructive injection: the original
 * element is hidden and a ruby-annotated clone is inserted after it.
 * Cleanup restores originals by removing clones and unhiding.
 */
export class FuriganaInjector {
  private settings: UserSettings;
  private analyzer: MorphologicalAnalyzer;
  private tracker: ProcessedTracker;

  constructor(settings: UserSettings) {
    this.settings = settings;
    this.analyzer = new MorphologicalAnalyzer();
    this.tracker = new ProcessedTracker(PROCESSED_ATTR, TRANSLATION_ATTR);
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

    // Process in chunks to avoid blocking
    const CHUNK_SIZE = 10;
    for (let i = 0; i < blocks.length; i += CHUNK_SIZE) {
      const chunk = blocks.slice(i, i + CHUNK_SIZE);
      await Promise.all(chunk.map((block) => this.processBlock(block)));

      // Yield to main thread
      if (i + CHUNK_SIZE < blocks.length) {
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

  private async processBlock(block: DetectedBlock): Promise<void> {
    const el = block.element;
    if (this.tracker.isProcessed(el)) return;
    this.tracker.markProcessed(el, block.text);

    try {
      const tokens = await this.analyzer.analyze(block.text);
      const hasKanjiTokens = tokens.some((t) => t.isKanji && t.reading !== t.surface);
      if (!hasKanjiTokens) return;

      if (!el.isConnected) return;

      // Create a ruby-annotated clone and insert after the original
      const clone = createRubyClone(el, tokens, {
        translationAttr: TRANSLATION_ATTR,
      });
      el.insertAdjacentElement('afterend', clone);
      this.tracker.trackInjected(clone);
      el.classList.add('jp-furigana-hidden');
    } catch {
      // Allow retry on next detection cycle
      this.tracker.unmarkProcessed(el);
    }
  }

  cleanup(): void {
    this.tracker.cleanup();
  }
}
