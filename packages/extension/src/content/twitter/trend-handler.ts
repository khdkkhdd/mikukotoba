import type { UserSettings } from '@/types';
import type { StatusIndicator } from '@/content/shared/status-indicator';
import { translator } from '@/core/translator';
import { ProcessedTracker } from '@/content/shared/processed-tracker';
import { createInlineBracket } from '@/content/shared/renderers/inline-bracket';
import {
  TRANSLATION_ATTR,
  PROCESSED_ATTR,
  isJapaneseText,
  isJapaneseShortText,
} from './utils';
import { createLogger } from '@/core/logger';

const log = createLogger('Twitter:Trend');

/**
 * Handles translation of trending topics (Mode C: inline brackets).
 */
export class TrendHandler {
  private settings: UserSettings;
  private status: StatusIndicator | null = null;
  private tracker: ProcessedTracker;

  constructor(settings: UserSettings) {
    this.settings = settings;
    this.tracker = new ProcessedTracker(PROCESSED_ATTR, TRANSLATION_ATTR);
  }

  updateSettings(settings: UserSettings): void {
    this.settings = settings;
  }

  setStatusIndicator(indicator: StatusIndicator): void {
    this.status = indicator;
  }

  /**
   * Process a trend element. Finds the topic name and adds inline bracket translation.
   */
  async processTrend(element: HTMLElement): Promise<void> {
    if (this.tracker.isProcessed(element)) return;
    this.tracker.markProcessed(element);

    // Find the topic name — it's typically the second text-bearing span
    // Structure: category (small text) > topic name (larger) > post count (small)
    const topicSpan = this.findTopicSpan(element);
    if (!topicSpan) return;

    const text = topicSpan.innerText?.trim();
    if (!text) return;

    // Skip hashtags that start with # (already in original form)
    // But still translate Japanese hashtags
    if (!isJapaneseShortText(text) && !isJapaneseText(topicSpan)) return;

    topicSpan.setAttribute(PROCESSED_ATTR, 'true');
    this.status?.translating();

    try {
      const result = await translator.translate(text);
      if (!topicSpan.isConnected) { this.status?.translated(); return; }

      const hint = createInlineBracket(result, this.settings, {
        className: 'jp-twitter-inline-hint',
        translationAttr: TRANSLATION_ATTR,
        spoiler: true,
      });

      topicSpan.insertAdjacentElement('afterend', hint);
      this.tracker.trackInjected(hint);
      this.status?.translated();

      log.debug('Trend translated:', text.slice(0, 20));
    } catch (e) {
      if (e instanceof Error && e.name === 'ContextInvalidated') return;
      log.warn('Trend translation failed:', text.slice(0, 20), e);
      this.status?.failed();
      this.tracker.unmarkProcessed(element);
      topicSpan.removeAttribute(PROCESSED_ATTR);
    }
  }

  /**
   * Find the topic name span within a trend element.
   * Heuristic: the span with the most prominent text that isn't a category or count.
   */
  private findTopicSpan(trend: HTMLElement): HTMLElement | null {
    // Get all direct text containers
    const spans = trend.querySelectorAll<HTMLElement>('span');
    let candidates: { el: HTMLElement; text: string }[] = [];

    for (const span of spans) {
      // Skip if it contains child spans (parent container)
      if (span.querySelector('span')) continue;
      // Skip if already translated
      if (span.hasAttribute(TRANSLATION_ATTR)) continue;

      const text = span.textContent?.trim();
      if (!text) continue;

      // Skip post count patterns (digits + 件/posts/K/M)
      if (/^\d[\d,.]*(件|posts?|K|M)/.test(text)) continue;
      // Skip "Trending" / "トレンド" category prefix patterns
      if (/^(Trending|トレンド)$/i.test(text)) continue;
      // Skip category labels with "·" separator
      if (text.includes('·') && text.length < 30) continue;

      candidates.push({ el: span, text });
    }

    if (candidates.length === 0) return null;

    // The topic name is typically the longest candidate
    candidates.sort((a, b) => b.text.length - a.text.length);
    return candidates[0].el;
  }

  cleanup(): void {
    this.tracker.cleanup();
  }
}
