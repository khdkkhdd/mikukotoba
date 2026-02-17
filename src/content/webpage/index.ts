import type { UserSettings } from '@/types';
import type { StatusIndicator } from '@/content/shared/status-indicator';
import type { SiteHandler } from '@/content/handlers/types';
import { TextDetector } from './text-detector';
import { HoverPopup } from './hover-popup';
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

  private textDetector: TextDetector | null = null;
  private hoverPopup: HoverPopup | null = null;
  private inlineTranslator: InlineTranslator | null = null;
  private furiganaInjector: FuriganaInjector | null = null;

  constructor(settings: UserSettings) {
    this.settings = settings;
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
    this.hoverPopup?.stop();
    this.inlineTranslator?.cleanup();
    this.furiganaInjector?.cleanup();

    this.textDetector = null;
    this.hoverPopup = null;
    this.inlineTranslator = null;
    this.furiganaInjector = null;
  }

  updateSettings(settings: UserSettings): void {
    const oldMode = this.settings.webpageMode;
    this.settings = settings;

    // If mode changed, restart
    if (settings.webpageMode !== oldMode) {
      this.stop();
      if (settings.webpageMode !== 'off') {
        this.start();
      }
      return;
    }

    this.hoverPopup?.updateSettings(settings);
    this.inlineTranslator?.updateSettings(settings);
    this.furiganaInjector?.updateSettings(settings);
  }

  private startHoverMode(): void {
    this.hoverPopup = new HoverPopup(this.settings);
    this.hoverPopup.start();
  }

  private startInlineMode(): void {
    this.inlineTranslator = new InlineTranslator(this.settings);
    this.inlineTranslator.setStatusIndicator(this.status!);

    this.textDetector = new TextDetector((blocks) => {
      this.status?.detected(blocks.length);
      this.inlineTranslator?.processBlocks(blocks);
    });
    this.textDetector.start();
  }

  private async startFuriganaMode(): Promise<void> {
    this.furiganaInjector = new FuriganaInjector(this.settings);
    this.textDetector = new TextDetector((blocks) => {
      this.status?.detected(blocks.length);
      this.furiganaInjector?.processBlocks(blocks);
    });
    await this.furiganaInjector.init();
    this.textDetector.start();
  }
}
