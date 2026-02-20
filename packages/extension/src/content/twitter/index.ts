import type { UserSettings } from '@/types';
import type { StatusIndicator } from '@/content/shared/status-indicator';
import { needsRenderRestart } from '@/content/handlers/types';
import type { SiteHandler } from '@/content/handlers/types';
import { translator } from '@/core/translator';
import { HoverTooltip } from '@/content/shared/renderers/hover-tooltip';
import { BatchedObserver } from '@/content/shared/batched-observer';
import type { SelectorRoute } from '@/content/shared/batched-observer';
import { TweetHandler } from './tweet-handler';
import { UserHandler } from './user-handler';
import { TrendHandler } from './trend-handler';
import { SELECTORS, PROCESSED_ATTR, TRANSLATION_ATTR, isEditableArea } from './utils';
import { createLogger } from '@/core/logger';
import twitterStyles from './twitter.css?inline';

const TWITTER_STYLE_ID = 'mikukotoba-twitter-styles';
let twitterStyleEl = document.getElementById(TWITTER_STYLE_ID) as HTMLStyleElement | null;
if (!twitterStyleEl) {
  twitterStyleEl = document.createElement('style');
  twitterStyleEl.id = TWITTER_STYLE_ID;
  (document.head || document.documentElement).appendChild(twitterStyleEl);
}
twitterStyleEl.textContent = twitterStyles;

const log = createLogger('Twitter');

/**
 * Twitter/X Japanese Learning Handler
 *
 * Entry point for Twitter-specific translation features.
 * Coordinates the shared MutationObserver with individual handlers
 * for tweets, user elements, and trending topics.
 *
 * Owns the shared HoverTooltip and hoverTargets WeakSet used by
 * both TweetHandler (hover mode) and UserHandler (names/locations).
 */
export class TwitterHandler implements SiteHandler {
  readonly id = 'twitter';
  readonly name = 'Twitter/X';
  readonly priority = 10;

  private settings: UserSettings;
  private observer: BatchedObserver | null = null;
  private tweetHandler: TweetHandler;
  private userHandler: UserHandler;
  private trendHandler: TrendHandler;
  private status: StatusIndicator | null = null;

  // Shared hover infrastructure
  private hoverTargets = new WeakSet<HTMLElement>();
  private hoverTooltip: HoverTooltip | null = null;

  constructor(settings: UserSettings) {
    this.settings = settings;
    this.tweetHandler = new TweetHandler(settings, this.hoverTargets);
    this.userHandler = new UserHandler(settings, this.hoverTargets);
    this.trendHandler = new TrendHandler(settings);
  }

  matches(url: URL): boolean {
    return url.hostname === 'x.com' || url.hostname === 'twitter.com';
  }

  isEnabled(settings: UserSettings): boolean {
    return settings.handlerEnabled?.twitter ?? true;
  }

  setStatusIndicator(indicator: StatusIndicator): void {
    this.status = indicator;
    this.tweetHandler.setStatusIndicator(indicator);
    this.userHandler.setStatusIndicator(indicator);
    this.trendHandler.setStatusIndicator(indicator);
  }

  /**
   * Start the Twitter handler — initializes all sub-handlers
   * and starts observing the DOM.
   */
  start(): void {
    log.info('Twitter handler starting');

    // Initialize shared hover tooltip for user names/locations and tweet hover mode
    this.initHoverTooltip();

    // Create observer with selector-based routing
    const routes: SelectorRoute[] = [
      { selector: SELECTORS.TWEET_TEXT, callback: (el) => this.tweetHandler.processTweetText(el) },
      { selector: SELECTORS.CARD_WRAPPER, callback: (el) => this.tweetHandler.processCard(el) },
      { selector: SELECTORS.USER_NAME, callback: (el) => this.userHandler.processUserName(el) },
      { selector: SELECTORS.USER_NAME_PROFILE, callback: (el) => this.userHandler.processProfileName(el) },
      { selector: SELECTORS.USER_DESCRIPTION, callback: (el) => this.userHandler.processUserDescription(el) },
      { selector: SELECTORS.USER_LOCATION, callback: (el) => this.userHandler.processUserLocation(el) },
      { selector: SELECTORS.USER_CELL, callback: (el) => this.userHandler.processUserCell(el) },
      { selector: SELECTORS.SOCIAL_CONTEXT, callback: (el) => this.userHandler.processSocialContext(el) },
      { selector: SELECTORS.TREND, callback: (el) => this.trendHandler.processTrend(el) },
    ];

    this.observer = new BatchedObserver(routes, {
      logNamespace: 'Twitter:Observer',
      characterData: true,
      characterDataAncestorResolver: (node: Node) => {
        return node.parentElement?.closest<HTMLElement>(
          `${SELECTORS.TWEET_TEXT}, ${SELECTORS.USER_DESCRIPTION}`
        ) ?? null;
      },
      shouldSkip: (el) => {
        if (el.hasAttribute(TRANSLATION_ATTR) || el.hasAttribute(PROCESSED_ATTR)) return true;
        if (isEditableArea(el)) return true;
        return false;
      },
      scanExisting: true,
    });

    this.observer.start();
    log.info('Twitter handler started');
  }

  /**
   * Stop all handlers and clean up.
   */
  stop(): void {
    log.info('Twitter handler stopping');
    this.observer?.stop();
    this.observer = null;
    this.hoverTooltip?.unmount();
    this.hoverTooltip = null;
    this.hoverTargets = new WeakSet();
    this.tweetHandler.cleanup();
    this.userHandler.cleanup();
    this.trendHandler.cleanup();
  }

  /**
   * Update settings across all handlers.
   * If webpageMode changed, restart to re-initialize hover/inline state.
   */
  updateSettings(settings: UserSettings): void {
    const prev = this.settings;
    this.settings = settings;

    if (needsRenderRestart(prev, settings)) {
      log.info('Rendering settings changed, restarting');
      this.stop();
      // Recreate sub-handlers with fresh hoverTargets
      this.tweetHandler = new TweetHandler(settings, this.hoverTargets);
      this.userHandler = new UserHandler(settings, this.hoverTargets);
      this.trendHandler = new TrendHandler(settings);
      if (this.status) {
        this.tweetHandler.setStatusIndicator(this.status);
        this.userHandler.setStatusIndicator(this.status);
        this.trendHandler.setStatusIndicator(this.status);
      }
      this.start();
      return;
    }

    this.tweetHandler.updateSettings(settings);
    this.userHandler.updateSettings(settings);
    this.trendHandler.updateSettings(settings);
    this.hoverTooltip?.updateSettings(settings);
  }

  // ──────────────── Shared Hover Infrastructure ────────────────

  private initHoverTooltip(): void {
    if (this.hoverTooltip) return;

    this.hoverTooltip = new HoverTooltip(
      this.settings,
      {
        popupId: 'jp-twitter-hover-popup',
        debounceMs: 300,
        getTargetAtPoint: (x, y) => this.getHoverTargetAtPoint(x, y),
      },
      (text) => translator.translate(text),
      (text) => translator.retranslate(text),
    );
    this.hoverTooltip.mount();
  }

  /**
   * Find nearest hover-eligible element at given coordinates.
   * Walks up from elementFromPoint, checking against the shared hoverTargets WeakSet.
   */
  private getHoverTargetAtPoint(x: number, y: number): { text: string; element: HTMLElement } | null {
    const target = document.elementFromPoint(x, y);
    if (!target) return null;

    let hoverEl: HTMLElement | null = target instanceof HTMLElement ? target : target.parentElement;
    while (hoverEl && hoverEl !== document.body) {
      if (this.hoverTargets.has(hoverEl)) {
        // Prefer stored original text (e.g. furigana blocks where innerText includes readings)
        const text = hoverEl.getAttribute('data-jp-hover-text') || hoverEl.innerText?.trim();
        if (text) return { text, element: hoverEl };
        return null;
      }
      hoverEl = hoverEl.parentElement;
    }
    return null;
  }
}
