import type { UserSettings, TranslationResult } from '@/types';
import type { StatusIndicator } from '@/content/shared/status-indicator';
import { translator } from '@/core/translator';
import { escapeHtmlWithBreaks } from '@/content/shared/dom-utils';
import { ProcessedTracker } from '@/content/shared/processed-tracker';
import { createInlineBlock } from '@/content/shared/renderers/inline-block';
import { createRubyClone } from '@/content/shared/renderers/ruby-injector';
import { onWordClick } from '@/content/vocab/word-click-callback';
import { createInlineBracket } from '@/content/shared/renderers/inline-bracket';
import { addSpoilerBehavior } from '@/content/shared/renderers/spoiler';
import {
  TRANSLATION_ATTR,
  PROCESSED_ATTR,
  isJapaneseText,
  markProcessed,
} from './utils';
import { createLogger } from '@/core/logger';

const log = createLogger('Twitter:Tweet');

/**
 * Handles translation of tweet text, link preview cards, and poll options.
 *
 * - tweetText → Mode A (inline block below original)
 * - card.wrapper → Mode D (small translation inside card)
 * - poll options → Mode C (inline brackets)
 *
 * Never modifies original DOM nodes (React will revert).
 * Inserts translations as sibling elements.
 */
export class TweetHandler {
  private settings: UserSettings;
  private status: StatusIndicator | null = null;
  private tracker: ProcessedTracker;

  // Shared with TwitterHandler — elements registered here are picked up by the shared HoverTooltip
  private hoverTargets: WeakSet<HTMLElement>;

  constructor(settings: UserSettings, hoverTargets: WeakSet<HTMLElement>) {
    this.settings = settings;
    this.hoverTargets = hoverTargets;
    this.tracker = new ProcessedTracker(PROCESSED_ATTR, TRANSLATION_ATTR);
  }

  setStatusIndicator(indicator: StatusIndicator): void {
    this.status = indicator;
  }

  updateSettings(settings: UserSettings): void {
    this.settings = settings;
  }

  /**
   * Process a tweetText element.
   * Called by observer when [data-testid="tweetText"] is detected.
   *
   * Respects webpageMode setting:
   * - 'hover' → register as hover target (translation via shared HoverTooltip)
   * - 'off' → skip entirely
   * - other → inline block below original (Mode A)
   */
  async processTweetText(element: HTMLElement): Promise<void> {
    const text = element.innerText?.trim();
    const lang = element.getAttribute('lang');
    log.debug('processTweetText:', { len: text?.length, lang, preview: text?.slice(0, 40) });
    if (!text) return;

    // Check if this is Japanese
    if (!isJapaneseText(element)) {
      log.debug('Not Japanese, skipping:', text?.slice(0, 30));
      return;
    }

    const mode = this.settings.webpageMode;

    // Off mode — skip entirely
    if (mode === 'off') return;

    // Hover mode — register for shared HoverTooltip
    if (mode === 'hover') {
      if (this.settings.showFurigana) {
        await this.processHoverWithFurigana(element, text);
      } else {
        this.registerHoverTarget(element);
      }
      return;
    }

    // Inline / furigana-only — existing behavior
    // Skip if already processed with same text
    if (this.tracker.isProcessedWithSameText(element, text)) return;

    // Text changed (e.g. "Show more" expanded) — remove old translation
    if (this.tracker.isProcessed(element)) {
      this.tracker.removeExistingTranslation(element);
    }

    this.tracker.markProcessed(element, text);
    markProcessed(element);
    this.status?.translating();

    try {
      log.info('Translating tweet:', text.slice(0, 50));
      const result = await translator.translate(text);
      log.info('Translation done:', { korean: result.korean?.slice(0, 30), engine: result.engine, fromCache: result.fromCache });

      // Verify element is still in DOM and text hasn't changed again
      if (!element.isConnected) { log.debug('Element disconnected, skipping insert'); return; }
      if (element.innerText?.trim() !== text) { log.debug('Text changed, skipping insert'); return; }

      this.insertInlineBlock(element, result, text);
      this.status?.translated();
      log.info('Translation block inserted');
    } catch (e) {
      log.error('Tweet translation FAILED:', e);
      this.status?.failed();
      this.tracker.unmarkProcessed(element);
    }
  }

  /**
   * Register an element as a hover target for the shared HoverTooltip.
   * If originalText is provided, it's stored as a data attribute
   * (needed when the element's innerText differs from the source text,
   * e.g. furigana blocks where innerText includes readings).
   */
  private registerHoverTarget(element: HTMLElement, originalText?: string): void {
    if (this.hoverTargets.has(element)) return;
    this.hoverTargets.add(element);
    element.classList.add('jp-twitter-hover-target');
    if (originalText) {
      element.setAttribute('data-jp-hover-text', originalText);
    }
  }

  /**
   * Hover mode + furigana: clone element with ruby annotations, hide original.
   *
   * The clone preserves all interactive elements (links, @mentions, #hashtags)
   * while adding ruby furigana above kanji. The clone is registered as hover
   * target for translation on mouseover.
   */
  private async processHoverWithFurigana(element: HTMLElement, text: string): Promise<void> {
    if (this.tracker.isProcessedWithSameText(element, text)) return;

    if (this.tracker.isProcessed(element)) {
      this.tracker.removeExistingTranslation(element);
    }

    this.tracker.markProcessed(element, text);
    markProcessed(element);
    this.status?.translating();

    try {
      const result = await translator.translate(text);
      if (!element.isConnected) return;
      if (element.innerText?.trim() !== text) return;

      element.classList.remove('jp-furigana-hidden');
      const clone = createRubyClone(element, result.tokens, {
        translationAttr: TRANSLATION_ATTR,
        onWordClick,
      });
      element.insertAdjacentElement('afterend', clone);
      this.tracker.trackInjected(clone);
      element.classList.add('jp-furigana-hidden');

      // Register clone as hover target with original text
      this.registerHoverTarget(clone, text);
      this.status?.translated();
    } catch (e) {
      log.error('Hover+furigana failed:', e);
      this.status?.failed();
      this.tracker.unmarkProcessed(element);
    }
  }

  /**
   * Process a card.wrapper element (Mode D: card insert).
   */
  async processCard(element: HTMLElement): Promise<void> {
    if (this.tracker.isProcessed(element)) return;

    // Find title and description spans inside the card
    const textSpans = this.findCardTextSpans(element);
    if (textSpans.length === 0) return;

    // Combine text to check if any is Japanese
    const combinedText = textSpans.map(s => s.innerText?.trim()).filter(Boolean).join('\n');
    if (!combinedText || !isJapaneseText(element)) {
      const hasJapanese = textSpans.some(s => {
        const t = s.innerText?.trim();
        return t && isJapaneseText(s);
      });
      if (!hasJapanese) return;
    }

    this.tracker.markProcessed(element);
    markProcessed(element);
    this.status?.translating();

    try {
      const textToTranslate = textSpans.map(s => s.innerText?.trim()).filter(Boolean).join(' — ');
      const result = await translator.translate(textToTranslate);

      if (!element.isConnected) return;

      this.insertCardTranslation(element, textSpans, result);
      this.status?.translated();
      log.debug('Card translated:', textToTranslate.slice(0, 30));
    } catch (e) {
      log.warn('Card translation failed:', e);
      this.status?.failed();
      this.tracker.unmarkProcessed(element);
    }
  }

  /**
   * Process poll options inside a card (Mode C: inline brackets).
   */
  async processPollOption(element: HTMLElement): Promise<void> {
    const text = element.innerText?.trim();
    if (!text || !isJapaneseText(element)) return;
    if (this.tracker.isProcessed(element)) return;

    this.tracker.markProcessed(element);
    markProcessed(element);
    this.status?.translating();

    try {
      const result = await translator.translate(text);
      if (!element.isConnected) return;

      const bracket = createInlineBracket(result, this.settings, {
        className: 'jp-twitter-inline-hint',
        translationAttr: TRANSLATION_ATTR,
        spoiler: true,
      });

      element.insertAdjacentElement('afterend', bracket);
      this.tracker.trackInjected(bracket);
      this.status?.translated();
    } catch {
      this.status?.failed();
      this.tracker.unmarkProcessed(element);
    }
  }

  /**
   * Mode A: Insert translation block below the original element.
   *
   * When furigana is enabled, the original is replaced with a ruby-annotated
   * clone that preserves all interactive elements (links, @mentions, #hashtags)
   * while showing furigana above kanji.
   */
  private insertInlineBlock(target: HTMLElement, result: TranslationResult, text: string): void {
    this.tracker.removeExistingTranslation(target);
    target.classList.remove('jp-furigana-hidden');

    let insertAfter: HTMLElement = target;

    if (this.settings.showFurigana) {
      const clone = createRubyClone(target, result.tokens, {
        translationAttr: TRANSLATION_ATTR,
        onWordClick,
      });
      target.insertAdjacentElement('afterend', clone);
      this.tracker.trackInjected(clone);
      target.classList.add('jp-furigana-hidden');
      insertAfter = clone;
    }

    const div = createInlineBlock(result, this.settings, {
      className: 'jp-twitter-translation',
      translationAttr: TRANSLATION_ATTR,
      classPrefix: 'jp-twitter',
      spoiler: true,
      skipFurigana: this.settings.showFurigana,
      onRetranslate: () => translator.retranslate(text),
      onWordClick,
    });

    insertAfter.insertAdjacentElement('afterend', div);
    this.tracker.trackInjected(div);
  }

  /**
   * Mode D: Insert small translation inside the card.
   */
  private insertCardTranslation(
    _card: HTMLElement,
    textSpans: HTMLElement[],
    result: TranslationResult,
  ): void {
    const lastSpan = textSpans[textSpans.length - 1];
    if (!lastSpan) return;

    const div = document.createElement('div');
    div.className = 'jp-twitter-card-translation jp-spoiler';
    div.setAttribute(TRANSLATION_ATTR, 'true');
    div.innerHTML = `<span>${escapeHtmlWithBreaks(result.korean)}</span>`;
    addSpoilerBehavior(div);

    lastSpan.insertAdjacentElement('afterend', div);
    this.tracker.trackInjected(div);
  }

  /**
   * Find text spans inside a card.wrapper that might contain translatable content.
   */
  private findCardTextSpans(card: HTMLElement): HTMLElement[] {
    const spans: HTMLElement[] = [];
    const allElements = card.querySelectorAll<HTMLElement>('span, div');
    for (const el of allElements) {
      if (el.closest('a[role="link"]') === el) continue;
      if (el.hasAttribute(TRANSLATION_ATTR)) continue;

      const text = el.innerText?.trim();
      if (!text || text.length < 2) continue;

      const hasBlockChild = el.querySelector('div, p, h1, h2, h3');
      if (!hasBlockChild && text.length >= 2 && text.length <= 300) {
        spans.push(el);
      }
    }
    return spans;
  }

  cleanup(): void {
    this.tracker.cleanup();

    // Remove hover target markers
    document.querySelectorAll('.jp-twitter-hover-target').forEach(el => {
      el.classList.remove('jp-twitter-hover-target');
      el.removeAttribute('data-jp-hover-text');
    });
  }
}
