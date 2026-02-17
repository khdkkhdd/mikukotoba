import type { UserSettings } from '@/types';
import type { StatusIndicator } from '@/content/shared/status-indicator';
import type { SiteHandler } from '@/content/handlers/types';
import { translator } from '@/core/translator';
import { HoverTooltip } from '@/content/shared/renderers/hover-tooltip';
import { TwitterObserver } from './observer';
import { TweetHandler } from './tweet-handler';
import { UserHandler } from './user-handler';
import { TrendHandler } from './trend-handler';
import { createLogger } from '@/core/logger';
import './twitter.css';

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
  private observer: TwitterObserver | null = null;
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

  isEnabled(_settings: UserSettings): boolean {
    return true; // Always active on Twitter pages
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

    // Create observer with routing callbacks
    this.observer = new TwitterObserver({
      onTweetText: (el) => this.tweetHandler.processTweetText(el),
      onCardWrapper: (el) => this.tweetHandler.processCard(el),
      onUserName: (el) => this.userHandler.processUserName(el),
      onUserNameProfile: (el) => this.userHandler.processProfileName(el),
      onUserDescription: (el) => this.userHandler.processUserDescription(el),
      onUserLocation: (el) => this.userHandler.processUserLocation(el),
      onUserCell: (el) => this.userHandler.processUserCell(el),
      onSocialContext: (el) => this.userHandler.processSocialContext(el),
      onTrend: (el) => this.trendHandler.processTrend(el),
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
    const modeChanged = this.settings.webpageMode !== settings.webpageMode;
    this.settings = settings;

    if (modeChanged) {
      log.info('webpageMode changed, restarting');
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
