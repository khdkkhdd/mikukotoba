import type { UserSettings } from '@/types';
import type { StatusIndicator } from '@/content/shared/status-indicator';
import { needsRenderRestart } from '@/content/handlers/types';
import type { SiteHandler } from '@/content/handlers/types';
import { ProcessedTracker } from '@/content/shared/processed-tracker';
import { HoverTooltip } from '@/content/shared/renderers/hover-tooltip';
import { isJapanese } from '@/content/shared/dom-utils';
import { translator } from '@/core/translator';
import { TextDetector } from './text-detector';
import { InlineTranslator } from './inline-translator';
import { FuriganaInjector } from './furigana-injector';
import { createLogger } from '@/core/logger';

const log = createLogger('Webpage');

/**
 * Generic webpage translation handler.
 *
 * Supports three modes (hover, inline, furigana-only) controlled by settings.
 * Activates on any site with Japanese content.
 */
export class WebpageSiteHandler implements SiteHandler {
  readonly id = 'webpage';
  readonly name = 'Generic Webpage';
  readonly priority = 0; // Lowest priority — other handlers take precedence
  readonly requiresJapaneseContent = true;

  private settings: UserSettings;
  private status: StatusIndicator | null = null;
  private tracker: ProcessedTracker;

  private textDetector: TextDetector | null = null;
  private hoverTooltip: HoverTooltip | null = null;
  private inlineTranslator: InlineTranslator | null = null;
  private furiganaInjector: FuriganaInjector | null = null;

  constructor(settings: UserSettings) {
    this.settings = settings;
    this.tracker = new ProcessedTracker('data-jp-processed', 'data-jp-translation');
  }

  matches(url: URL): boolean {
    // Skip sites with dedicated handlers
    const host = url.hostname;
    if (host.includes('youtube.com') || host.includes('twitter.com') || host.includes('x.com')) {
      return false;
    }
    return true;
  }

  isEnabled(settings: UserSettings): boolean {
    return settings.webpageMode !== 'off';
  }

  setStatusIndicator(indicator: StatusIndicator): void {
    this.status = indicator;
  }

  async start(): Promise<void> {
    log.info('Webpage handler starting, mode:', this.settings.webpageMode);
    this.status?.reset();
    this.status?.mount();

    switch (this.settings.webpageMode) {
      case 'hover':
        this.startHoverMode();
        break;
      case 'inline':
        this.startInlineMode();
        break;
      case 'furigana-only':
        await this.startFuriganaMode();
        break;
    }
  }

  stop(): void {
    log.info('Webpage handler stopping');
    this.textDetector?.stop();
    this.hoverTooltip?.unmount();
    this.inlineTranslator?.cleanup();
    this.furiganaInjector?.cleanup();

    this.textDetector = null;
    this.hoverTooltip = null;
    this.inlineTranslator = null;
    this.furiganaInjector = null;

    this.tracker.cleanup();
    this.tracker = new ProcessedTracker('data-jp-processed', 'data-jp-translation');
  }

  updateSettings(settings: UserSettings): void {
    const prev = this.settings;
    this.settings = settings;

    if (needsRenderRestart(prev, settings)) {
      this.stop();
      if (settings.webpageMode !== 'off') {
        this.start();
      }
      return;
    }

    this.hoverTooltip?.updateSettings(settings);
    this.inlineTranslator?.updateSettings(settings);
    this.furiganaInjector?.updateSettings(settings);
  }

  private startHoverMode(): void {
    this.hoverTooltip = new HoverTooltip(
      this.settings,
      {
        popupId: 'jp-helper-hover-popup',
        debounceMs: 1000,
        escapeToClose: true,
        getTargetAtPoint: (x, y) => this.getTextBlockAtPoint(x, y),
      },
      (text) => translator.translate(text),
      (text) => translator.retranslate(text),
    );
    this.hoverTooltip.mount();
  }

  private startInlineMode(): void {
    this.inlineTranslator = new InlineTranslator(this.settings, this.tracker);
    this.inlineTranslator.setStatusIndicator(this.status!);

    this.textDetector = new TextDetector((blocks) => {
      this.status?.detected(blocks.length);
      this.inlineTranslator?.processBlocks(blocks);
    }, this.tracker);
    this.textDetector.start();
  }

  private async startFuriganaMode(): Promise<void> {
    this.furiganaInjector = new FuriganaInjector(this.settings);
    this.textDetector = new TextDetector((blocks) => {
      this.status?.detected(blocks.length);
      this.furiganaInjector?.processBlocks(blocks);
    }, this.tracker);
    await this.furiganaInjector.init();
    this.textDetector.start();
  }

  /**
   * Find the nearest Japanese text block at the given screen coordinates.
   * Uses elementFromPoint + ancestor walk — works regardless of
   * pointer-events, user-select, or text node boundaries.
   */
  private getTextBlockAtPoint(x: number, y: number): { text: string; element: HTMLElement } | null {
    const el = document.elementFromPoint(x, y);
    if (!el) return null;

    let current = el instanceof HTMLElement ? el : el.parentElement;
    while (current && current !== document.body) {
      // Skip our own injected elements
      if (current.hasAttribute('data-jp-translation') ||
          current.hasAttribute('data-jp-processed')) {
        current = current.parentElement;
        continue;
      }

      // Block-level elements
      const display = getComputedStyle(current).display;
      if (display === 'block' || display === 'flex' || display === 'grid' ||
          display === 'list-item' || display === 'table-cell') {
        const text = current.innerText?.trim();
        // Cap at 500 chars to avoid matching huge containers
        if (text && text.length <= 500 && isJapanese(text)) {
          return { text, element: current };
        }
      }

      current = current.parentElement;
    }

    return null;
  }
}
