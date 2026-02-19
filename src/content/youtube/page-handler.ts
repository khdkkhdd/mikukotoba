import type { UserSettings, TranslationResult, WebpageMode } from '@/types';
import type { StatusIndicator } from '@/content/shared/status-indicator';
import { needsRenderRestart } from '@/content/handlers/types';
import type { SiteHandler } from '@/content/handlers/types';
import type { SelectorRoute } from '@/content/shared/batched-observer';
import type { YTElementCategory } from './utils';
import { containsJapaneseLike, throttle } from '@/content/shared/dom-utils';
import { translator } from '@/core/translator';
import { ProcessedTracker } from '@/content/shared/processed-tracker';
import { BatchedObserver } from '@/content/shared/batched-observer';
import { createInlineBlock } from '@/content/shared/renderers/inline-block';
import { createStyledFuriganaBlock } from '@/content/shared/renderers/furigana-block';
import { createRubyClone } from '@/content/shared/renderers/ruby-injector';
import { HoverTooltip } from '@/content/shared/renderers/hover-tooltip';
import { MorphologicalAnalyzer } from '@/core/analyzer/morphological';
import {
  YT_SELECTORS,
  YT_SELECTOR_DEFS,
  YT_TRANSLATION_ATTR,
  YT_PROCESSED_ATTR,
} from './utils';

import { createLogger } from '@/core/logger';
import './youtube-page.css';

const log = createLogger('YouTube:Page');

/** data attribute to store category on viewport-deferred elements */
const DATA_CATEGORY = 'jpCategory';

/**
 * YouTube page text translation handler.
 *
 * Translates titles, descriptions, comments, hashtags, and other
 * text elements on YouTube pages. Supports all webpageMode settings:
 * - hover: show translation on mouse hover
 * - inline: show inline translation blocks/brackets
 * - furigana-only: show reading annotations only
 * - off: disabled
 */
export class YouTubePageHandler implements SiteHandler {
  readonly id = 'youtube-page';
  readonly name = 'YouTube Page Translation';
  readonly priority = 5; // Lower than subtitle handler (10)

  private settings: UserSettings;
  private status: StatusIndicator | null = null;
  private observer: BatchedObserver | null = null;
  private tracker: ProcessedTracker;
  private viewportObserver: IntersectionObserver | null = null;
  private descriptionObserver: MutationObserver | null = null;
  private navigateHandler: (() => void) | null = null;
  private rescanTimers: ReturnType<typeof setTimeout>[] = [];
  private hoverTooltip: HoverTooltip | null = null;
  private hoverTargets = new WeakSet<HTMLElement>();
  private scrollHandler: (() => void) | null = null;
  private analyzer: MorphologicalAnalyzer | null = null;
  private analyzerReady: Promise<void> | null = null;

  constructor(settings: UserSettings) {
    this.settings = settings;
    this.tracker = new ProcessedTracker(YT_PROCESSED_ATTR, YT_TRANSLATION_ATTR);
  }

  matches(url: URL): boolean {
    return url.hostname.includes('youtube.com');
  }

  isEnabled(settings: UserSettings): boolean {
    return settings.webpageMode !== 'off';
  }

  setStatusIndicator(indicator: StatusIndicator): void {
    this.status = indicator;
  }

  start(): void {
    // Guard against double start (init calls updateSettings then start)
    if (this.observer) {
      log.info('YouTube page handler already running, skipping start');
      return;
    }

    log.info('YouTube page handler starting, mode:', this.settings.webpageMode);
    const mode = this.settings.webpageMode;

    // Hover mode: mount HoverTooltip
    if (mode === 'hover') {
      this.hoverTooltip = new HoverTooltip(this.settings, {
        popupId: 'jp-yt-hover-popup',
        debounceMs: 500,
        escapeToClose: true,
        getTargetAtPoint: (x, y) => this.getHoverTargetAtPoint(x, y),
      }, (text) => translator.translate(text),
      (text) => translator.retranslate(text));
      this.hoverTooltip.mount();
    }

    // Viewport optimization: process elements when they enter viewport
    this.viewportObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const el = entry.target as HTMLElement;
            const category = (el.dataset[DATA_CATEGORY] as YTElementCategory) || 'main';
            this.processElement(el, category);
            this.viewportObserver?.unobserve(entry.target);
          }
        }
      },
      { rootMargin: '200px' },
    );

    // Build routes from selector definitions
    const routes = this.buildRoutes();

    // DOM change detection with selector routing
    this.observer = new BatchedObserver(
      routes,
      {
        logNamespace: 'YouTube:PageObserver',
        characterData: true,
        characterDataAncestorResolver: (node: Node) => {
          return node.parentElement?.closest<HTMLElement>(
            `${YT_SELECTORS.COMMENT_TEXT}, ${YT_SELECTORS.COMMENT_TEXT_NEW}, ${YT_SELECTORS.COMMUNITY_POST}`
          ) ?? null;
        },
        shouldSkip: (el) => {
          if (el.closest('ytd-ad-slot-renderer, ytd-promoted-sparkles-web-renderer, ytd-promoted-video-renderer')) return true;
          if (el.hasAttribute(YT_TRANSLATION_ATTR) || el.hasAttribute(YT_PROCESSED_ATTR)) return true;
          if (el.closest('[contenteditable="true"], #creation-box, #contenteditable-root')) return true;
          return false;
        },
        scanExisting: true,
      },
    );

    this.observer.start();

    // Scroll-triggered rescan: YouTube lazy-loads comments and sidebar
    // content via Polymer data binding which doesn't trigger childList
    // mutations. Rescan on scroll to catch newly rendered elements.
    this.scrollHandler = throttle(() => {
      this.observer?.scan();
    }, 3000);
    window.addEventListener('scroll', this.scrollHandler, { passive: true });

    // SPA navigation handling
    this.navigateHandler = () => this.handleNavigate();
    document.addEventListener('yt-navigate-finish', this.navigateHandler);
  }

  stop(): void {
    log.info('YouTube page handler stopping');
    this.observer?.stop();
    this.observer = null;

    this.viewportObserver?.disconnect();
    this.viewportObserver = null;

    this.descriptionObserver?.disconnect();
    this.descriptionObserver = null;

    for (const t of this.rescanTimers) clearTimeout(t);
    this.rescanTimers = [];

    if (this.scrollHandler) {
      window.removeEventListener('scroll', this.scrollHandler);
      this.scrollHandler = null;
    }

    if (this.navigateHandler) {
      document.removeEventListener('yt-navigate-finish', this.navigateHandler);
      this.navigateHandler = null;
    }

    this.hoverTooltip?.unmount();
    this.hoverTooltip = null;

    this.tracker.cleanup();

    // Remove hover target classes
    document.querySelectorAll('.jp-yt-hover-target').forEach(el => {
      el.classList.remove('jp-yt-hover-target');
    });
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

    // Otherwise propagate to child modules
    this.hoverTooltip?.updateSettings(settings);
  }

  // ──────────────── Route Building ────────────────

  /**
   * Build BatchedObserver routes from YT_SELECTOR_DEFS.
   * Each selector def is mapped to a callback that either processes
   * immediately or defers to viewport, passing the correct category.
   */
  private buildRoutes(): SelectorRoute[] {
    const routes: SelectorRoute[] = YT_SELECTOR_DEFS
      .filter(def => def.key !== 'descExpander')
      .map(def => ({
        selector: def.selector,
        callback: (el: HTMLElement) => {
          if (def.deferToViewport) {
            el.dataset[DATA_CATEGORY] = def.category;
            this.deferToViewport(el);
          } else {
            this.processElement(el, def.category);
          }
        },
      }));

    // Description expander — special watcher (not a standard translate target)
    routes.push({
      selector: YT_SELECTORS.DESCRIPTION_EXPANDER,
      callback: (el) => this.attachDescriptionWatcher(el),
    });

    return routes;
  }

  // ──────────────── Unified Element Processing ────────────────

  /**
   * Process a single element according to the current webpageMode and category.
   * This replaces the old translateElement/translateBracket split.
   */
  private async processElement(el: HTMLElement, category: YTElementCategory): Promise<void> {
    const mode = this.settings.webpageMode;
    if (mode === 'off') return;

    // Rich content (comments, posts, descriptions, etc.): use ruby clone
    // to preserve links, @mentions, timestamps, and other interactive elements.
    if (category === 'rich') {
      if (mode === 'hover') {
        await this.registerRichHoverTarget(el);
      } else {
        await this.processRichContent(el);
      }
      return;
    }

    // Hover mode: register as hover target, don't translate
    if (mode === 'hover') {
      this.registerHoverTarget(el);
      return;
    }

    // inline / furigana-only: translate and insert
    const text = el.innerText?.trim();
    if (!text || !containsJapaneseLike(text)) return;
    if (this.tracker.isProcessedWithSameText(el, text)) return;

    const anchor = this.getInsertionAnchor(el);

    // Remove existing translation if text changed (re-render)
    if (this.tracker.isProcessed(el)) {
      this.removeAdjacentTranslation(anchor);
    }

    this.tracker.markProcessed(el, text);
    this.status?.translating();

    try {
      const result = await translator.translate(text);
      if (!el.isConnected) return;
      if (el.innerText?.trim() !== text) return; // text changed during translation

      // Split furigana into a separate styled block for main elements
      const shouldSplitFurigana = category === 'main' &&
        (mode === 'furigana-only' || (mode === 'inline' && this.settings.showFurigana));

      if (shouldSplitFurigana) {
        this.removeAdjacentTranslation(anchor);
        el.classList.remove('jp-furigana-hidden');

        const furigana = createStyledFuriganaBlock(result, el, {
          classPrefix: 'jp-yt',
          translationAttr: YT_TRANSLATION_ATTR,
        });
        anchor.insertAdjacentElement('afterend', furigana);
        this.tracker.trackInjected(furigana);
        el.classList.add('jp-furigana-hidden');

        // inline mode: add translation block after furigana
        if (mode === 'inline') {
          const translationBlock = createInlineBlock(result, this.settings, {
            className: 'jp-yt-translation',
            translationAttr: YT_TRANSLATION_ATTR,
            classPrefix: 'jp-yt',
            spoiler: true,
            skipFurigana: true,
            onRetranslate: () => translator.retranslate(text),
          });
          furigana.insertAdjacentElement('afterend', translationBlock);
          this.tracker.trackInjected(translationBlock);
        }
      } else {
        const rendered = this.renderForMode(mode, category, result, text);
        if (rendered) {
          this.removeAdjacentTranslation(anchor);
          el.classList.remove('jp-furigana-hidden');
          anchor.insertAdjacentElement('afterend', rendered);
          this.tracker.trackInjected(rendered);
        }
      }
      this.status?.translated();
    } catch (e) {
      log.warn('Translation failed:', text.slice(0, 30), e);
      this.status?.failed();
      this.tracker.unmarkProcessed(el);
    }
  }

  /**
   * Render translation result based on mode and category.
   */
  private renderForMode(
    mode: WebpageMode,
    category: YTElementCategory,
    result: TranslationResult,
    text?: string,
  ): HTMLElement | null {
    switch (mode) {
      case 'inline':
        if (category === 'main') {
          return createInlineBlock(result, this.settings, {
            className: 'jp-yt-translation',
            translationAttr: YT_TRANSLATION_ATTR,
            classPrefix: 'jp-yt',
            spoiler: true,
            onRetranslate: text ? () => translator.retranslate(text) : undefined,
          });
        }
        // label: compact single-line block below with korean translation
        return this.createLabelBlock(result.korean, 'translation');

      case 'furigana-only': {
        if (category === 'main') {
          return null; // main handled by shouldSplitFurigana in processElement
        }
        // label: compact single-line block below with reading
        const reading = result.tokens.map(t => t.reading || t.surface).join('');
        return this.createLabelBlock(reading, 'furigana');
      }

      default:
        return null;
    }
  }

  /**
   * Create a compact single-line label block for tight UI areas.
   * Used for channel names, sidebar video titles, feed titles, etc.
   */
  private createLabelBlock(text: string, variant: 'translation' | 'furigana'): HTMLDivElement {
    const div = document.createElement('div');
    div.className = `jp-yt-label-block jp-yt-label-block--${variant}`;
    div.setAttribute(YT_TRANSLATION_ATTR, 'true');
    div.textContent = text;
    return div;
  }

  // ──────────────── Hover Mode ────────────────

  /**
   * Register an element as a hover target.
   * If showFurigana is enabled, also injects furigana (using local
   * morphological analysis — no translation API call needed).
   */
  private async registerHoverTarget(el: HTMLElement): Promise<void> {
    const text = el.innerText?.trim();
    if (!text || !containsJapaneseLike(text)) return;
    if (this.tracker.isProcessed(el)) return;
    this.tracker.markProcessed(el, text);

    if (this.settings.showFurigana) {
      // Lazy-init morphological analyzer (promise-based to prevent race)
      if (!this.analyzerReady) {
        this.analyzer = new MorphologicalAnalyzer();
        this.analyzerReady = this.analyzer.init();
      }
      await this.analyzerReady;

      try {
        const tokens = await this.analyzer!.analyze(text);
        // After await, the element may have been detached by YouTube re-renders
        if (!el.isConnected) return;
        const hasKanji = tokens.some((t: { isKanji: boolean; reading: string; surface: string }) => t.isKanji && t.reading !== t.surface);
        if (hasKanji) {
          const anchor = this.getInsertionAnchor(el);
          this.removeAdjacentTranslation(anchor);
          el.classList.remove('jp-furigana-hidden');
          const furiganaBlock = createStyledFuriganaBlock(
            { tokens } as TranslationResult,
            el,
            { classPrefix: 'jp-yt', translationAttr: YT_TRANSLATION_ATTR },
          );
          anchor.insertAdjacentElement('afterend', furiganaBlock);
          this.tracker.trackInjected(furiganaBlock);
          el.classList.add('jp-furigana-hidden');

          // Register the furigana block as hover target with original text
          furiganaBlock.dataset.jpOriginalText = text;
          this.hoverTargets.add(furiganaBlock);
          furiganaBlock.classList.add('jp-yt-hover-target');
          return;
        }
      } catch {
        // Fall through to basic registration
      }
    }

    this.hoverTargets.add(el);
    el.classList.add('jp-yt-hover-target');
  }

  /**
   * Register a rich content element as a hover target using ruby clone.
   * Uses ruby clone so furigana appears above kanji while links stay clickable.
   * Falls back to simple registration if no kanji tokens are found.
   */
  private async registerRichHoverTarget(el: HTMLElement): Promise<void> {
    const text = el.innerText?.trim();
    if (!text || !containsJapaneseLike(text)) return;
    if (this.tracker.isProcessed(el)) return;
    this.tracker.markProcessed(el, text);

    if (this.settings.showFurigana) {
      if (!this.analyzerReady) {
        this.analyzer = new MorphologicalAnalyzer();
        this.analyzerReady = this.analyzer.init();
      }
      await this.analyzerReady;

      try {
        const tokens = await this.analyzer!.analyze(text);
        if (!el.isConnected) return;
        const hasKanji = tokens.some((t: { isKanji: boolean; reading: string; surface: string }) => t.isKanji && t.reading !== t.surface);
        if (hasKanji) {
          const anchor = this.getInsertionAnchor(el);
          this.removeAdjacentTranslation(anchor);
          el.classList.remove('jp-furigana-hidden');

          const clone = createRubyClone(el, tokens, {
            translationAttr: YT_TRANSLATION_ATTR,
          });
          anchor.insertAdjacentElement('afterend', clone);
          this.tracker.trackInjected(clone);
          el.classList.add('jp-furigana-hidden');

          clone.dataset.jpOriginalText = text;
          this.hoverTargets.add(clone);
          clone.classList.add('jp-yt-hover-target');
          return;
        }
      } catch {
        // Fall through to basic registration
      }
    }

    this.hoverTargets.add(el);
    el.classList.add('jp-yt-hover-target');
  }

  /**
   * Find hover target element at screen coordinates.
   * Used by HoverTooltip's getTargetAtPoint callback.
   */
  private getHoverTargetAtPoint(x: number, y: number): { text: string; element: HTMLElement } | null {
    const el = document.elementFromPoint(x, y);
    if (!el) return null;

    // Walk up to find a registered hover target
    let current: HTMLElement | null = el as HTMLElement;
    while (current) {
      if (this.hoverTargets.has(current)) {
        // Use stored original text (for furigana blocks) or innerText
        const text = current.dataset.jpOriginalText || current.innerText?.trim();
        if (text && containsJapaneseLike(text)) {
          return { text, element: current };
        }
      }
      current = current.parentElement;
    }

    return null;
  }

  // ──────────────── Viewport Deferral ────────────────

  /** Defer processing until element enters viewport */
  private deferToViewport(el: HTMLElement): void {
    const text = el.innerText?.trim();
    if (this.tracker.isProcessedWithSameText(el, text ?? '')) return;
    this.viewportObserver?.observe(el);
  }

  // ──────────────── Insertion Anchor ────────────────

  /**
   * Determine the correct insertion anchor for a translation block.
   * Some YouTube elements (e.g. yt-formatted-string inside h1 or <a>)
   * need the translation inserted after the parent container, not after
   * the matched element itself.
   */
  private getInsertionAnchor(el: HTMLElement): HTMLElement {
    // Video title: yt-formatted-string → insert after the h1
    const h1 = el.closest('ytd-watch-metadata h1');
    if (h1) return h1 as HTMLElement;

    // Search/playlist title: yt-formatted-string → insert after <a#video-title>
    const videoTitleLink = el.closest('a#video-title');
    if (videoTitleLink) return videoTitleLink as HTMLElement;

    // Comment text: #content-text is inside ytd-expander > #content div
    // which has overflow:hidden + -webkit-line-clamp when collapsed.
    // Insert after the expander so translation is always visible.
    const expander = el.closest('ytd-expander');
    if (expander) return expander as HTMLElement;

    // Default: insert after the matched element itself
    return el;
  }

  /**
   * Remove all translation sibling elements after an anchor.
   *
   * Walks ALL following siblings (not just consecutive ones) because
   * YouTube's Polymer may insert non-translation elements (badges, etc.)
   * between the anchor and our translation blocks, which would cause
   * the old adjacent-only loop to miss stale translations.
   */
  private removeAdjacentTranslation(anchor: HTMLElement): void {
    let sibling = anchor.nextElementSibling;
    while (sibling) {
      const next = sibling.nextElementSibling;
      if (sibling.hasAttribute(YT_TRANSLATION_ATTR)) {
        sibling.remove();
      }
      sibling = next;
    }
  }

  // ──────────────── SPA Navigation ────────────────

  private handleNavigate(): void {
    log.info('yt-navigate-finish: cleaning up and rescanning');

    for (const t of this.rescanTimers) clearTimeout(t);
    this.rescanTimers = [];

    this.tracker.cleanup();

    // Restart observer to scan new page (may find empty elements)
    this.observer?.stop();
    this.observer?.start();

    // Description watcher will be re-attached by BatchedObserver scan
    this.descriptionObserver?.disconnect();

    // YouTube renders content asynchronously in multiple stages.
    // Progressive rescan catches elements as they populate.
    // recheckStaleTranslations handles elements that were processed
    // with stale text before YouTube finished updating the DOM.
    for (const delay of [500, 1500, 3000]) {
      this.rescanTimers.push(
        setTimeout(() => {
          log.debug(`Delayed rescan after ${delay}ms`);
          this.recheckStaleTranslations();
          this.observer?.scan();
        }, delay),
      );
    }
  }

  /**
   * Re-check non-deferred elements for stale translations.
   *
   * After SPA navigation, YouTube may update text content without
   * replacing elements. The initial scan may process an element with
   * old text, and shouldSkip prevents later scans from re-processing it.
   * This unmarks elements whose text has changed so the next scan
   * re-processes them.
   *
   * Uses textContent instead of innerText because elements with
   * jp-furigana-hidden (display:none) return "" from innerText,
   * which would false-positive as stale on every rescan cycle.
   */
  private recheckStaleTranslations(): void {
    for (const def of YT_SELECTOR_DEFS) {
      if (def.deferToViewport) continue;
      for (const el of document.querySelectorAll<HTMLElement>(def.selector)) {
        const text = el.textContent?.trim() ?? '';
        if (this.tracker.isProcessed(el) && !this.tracker.isProcessedWithSameText(el, text)) {
          log.debug('Stale translation detected, re-processing:', def.key, text.slice(0, 30));
          const anchor = this.getInsertionAnchor(el);
          this.removeAdjacentTranslation(anchor);
          el.classList.remove('jp-furigana-hidden');
          this.tracker.unmarkProcessed(el);
        }
      }
    }
  }

  // ──────────────── Description Handling ────────────────

  private attachDescriptionWatcher(expander: HTMLElement): void {
    this.descriptionObserver?.disconnect();
    this.descriptionObserver = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.attributeName === 'is-expanded' && expander.hasAttribute('is-expanded')) {
          const desc = expander.querySelector<HTMLElement>(
            'yt-attributed-string, #structured-description'
          );
          if (desc) {
            log.debug('Description expanded, processing');
            // Route through processElement's mode logic (rich category)
            if (this.settings.webpageMode === 'hover') {
              this.registerRichHoverTarget(desc);
            } else {
              this.processRichContent(desc);
            }
          }
        }
      }
    });

    this.descriptionObserver.observe(expander, {
      attributes: true,
      attributeFilter: ['is-expanded'],
    });
  }

  /**
   * Process rich content (comments, descriptions, community posts, etc.)
   * with paragraph-level splitting.
   *
   * When furigana is enabled, the original element is replaced with a
   * ruby-annotated clone that preserves all interactive elements (links,
   * @mentions, timestamps). Translation blocks are appended after.
   */
  private async processRichContent(el: HTMLElement): Promise<void> {
    const mode = this.settings.webpageMode;
    if (mode === 'off') return;

    const fullText = el.innerText?.trim();
    if (!fullText || !containsJapaneseLike(fullText)) return;
    if (this.tracker.isProcessedWithSameText(el, fullText)) return;

    const anchor = this.getInsertionAnchor(el);

    // Remove existing translation if text changed (re-render)
    if (this.tracker.isProcessed(el)) {
      this.removeAdjacentTranslation(anchor);
      el.classList.remove('jp-furigana-hidden');
    }

    this.tracker.markProcessed(el, fullText);
    this.status?.translating();

    try {
      const paragraphs = this.splitRichText(fullText);

      if (paragraphs.length === 0) {
        this.status?.translated();
        return;
      }

      // Translate paragraphs sequentially to respect rate limits
      const results: { text: string; result: TranslationResult }[] = [];
      for (const para of paragraphs) {
        if (!el.isConnected) return;
        const result = await translator.translate(para);
        results.push({ text: para, result });
      }

      if (!el.isConnected) return;
      if (el.innerText?.trim() !== fullText) return; // text changed during translation

      this.removeAdjacentTranslation(anchor);

      // Furigana: replace original with ruby-annotated clone
      const showFurigana = mode === 'furigana-only' ||
        (mode === 'inline' && this.settings.showFurigana);
      let insertAfter: HTMLElement = anchor;

      if (showFurigana) {
        // Merge all tokens for the ruby clone
        const allTokens = results.flatMap(r => r.result.tokens);
        el.classList.remove('jp-furigana-hidden');
        const clone = createRubyClone(el, allTokens, {
          translationAttr: YT_TRANSLATION_ATTR,
        });
        anchor.insertAdjacentElement('afterend', clone);
        this.tracker.trackInjected(clone);
        el.classList.add('jp-furigana-hidden');
        insertAfter = clone;
      }

      // furigana-only: no translation block needed
      if (mode === 'furigana-only') {
        this.status?.translated();
        return;
      }

      // inline: add translation container after clone/anchor
      const container = document.createElement('div');
      container.className = 'jp-yt-desc-translations';
      container.setAttribute(YT_TRANSLATION_ATTR, 'true');

      for (const { text: paraText, result } of results) {
        const block = createInlineBlock(result, this.settings, {
          className: 'jp-yt-translation',
          classPrefix: 'jp-yt',
          spoiler: true,
          skipFurigana: showFurigana,
          onRetranslate: () => translator.retranslate(paraText),
        });
        container.appendChild(block);
      }

      insertAfter.insertAdjacentElement('afterend', container);
      this.tracker.trackInjected(container);
      this.status?.translated();
    } catch (e) {
      log.warn('Rich content translation failed:', e);
      this.status?.failed();
      this.tracker.unmarkProcessed(el);
    }
  }

  /**
   * Split rich text into translatable paragraphs.
   * Filters out URL-only lines and non-Japanese segments.
   */
  private splitRichText(text: string): string[] {
    // Split by double newlines first
    let paragraphs = text.split(/\n\n+/).map(p => p.trim()).filter(Boolean);

    // If single long paragraph, split by single newlines
    if (paragraphs.length === 1 && paragraphs[0].length > 500) {
      paragraphs = paragraphs[0].split(/\n/).map(p => p.trim()).filter(Boolean);
    }

    return paragraphs.filter(p => {
      if (!containsJapaneseLike(p)) return false;
      // Skip paragraphs that are mainly URLs
      const withoutUrls = p.replace(/https?:\/\/\S+/g, '').trim();
      return withoutUrls.length > 0 && containsJapaneseLike(withoutUrls);
    });
  }
}
