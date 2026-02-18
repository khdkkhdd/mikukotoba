import type { UserSettings, TranslationResult } from '@/types';
import type { StatusIndicator } from '@/content/shared/status-indicator';
import { translator } from '@/core/translator';
import { ProcessedTracker } from '@/content/shared/processed-tracker';
import { createInlineBlock } from '@/content/shared/renderers/inline-block';
import { createRubyClone } from '@/content/shared/renderers/ruby-injector';
import {
  TRANSLATION_ATTR,
  PROCESSED_ATTR,
  isJapaneseText,
  isJapaneseShortText,
  getDisplayName,
  markProcessed,
} from './utils';
import { createLogger } from '@/core/logger';

const log = createLogger('Twitter:User');

/**
 * Handles translation of user-related elements:
 * - Display names (User-Name, UserName) → Mode B (hover tooltip)
 * - Bio (UserDescription) → Mode A (inline block)
 * - Location (UserLocation) → Mode B (hover tooltip)
 * - UserCell bio preview → Mode A (inline block)
 * - Social context names → Mode B (hover tooltip)
 *
 * Hover targets are registered into a shared WeakSet owned by TwitterHandler,
 * which also owns the shared HoverTooltip instance.
 */
export class UserHandler {
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

  updateSettings(settings: UserSettings): void {
    this.settings = settings;
  }

  setStatusIndicator(indicator: StatusIndicator): void {
    this.status = indicator;
  }

  /**
   * Process a User-Name element (timeline display name).
   * Registers it for hover tooltip (Mode B).
   */
  processUserName(element: HTMLElement): void {
    const nameText = getDisplayName(element);
    if (!nameText) return;
    if (!isJapaneseShortText(nameText)) return;
    if (this.tracker.isProcessed(element)) return;

    this.tracker.markProcessed(element);

    // Find the actual display name span for hover targeting
    const firstLink = element.querySelector('a');
    const nameSpan = firstLink?.querySelector('span');
    if (nameSpan) {
      this.hoverTargets.add(nameSpan as HTMLElement);
      (nameSpan as HTMLElement).setAttribute('data-jp-hover', 'name');
    }
  }

  /**
   * Process a UserDescription (bio) element.
   * Respects webpageMode: hover → register as hover target, off → skip,
   * otherwise → inline block (Mode A).
   */
  async processUserDescription(element: HTMLElement): Promise<void> {
    const text = element.innerText?.trim();
    if (!text) return;
    if (!isJapaneseText(element)) return;
    if (this.tracker.isProcessed(element)) return;

    const mode = this.settings.webpageMode;
    if (mode === 'off') return;

    if (mode === 'hover') {
      if (this.settings.showFurigana) {
        await this.processHoverWithFurigana(element, text);
      } else {
        this.tracker.markProcessed(element);
        this.hoverTargets.add(element);
        element.classList.add('jp-twitter-hover-target');
      }
      return;
    }

    this.tracker.markProcessed(element);
    markProcessed(element);
    this.status?.translating();

    try {
      const result = await translator.translate(text);
      if (!element.isConnected) return;

      this.insertBioTranslation(element, result, false, text);
      this.status?.translated();
      log.debug('Bio translated:', text.slice(0, 30));
    } catch (e) {
      log.warn('Bio translation failed:', e);
      this.status?.failed();
      this.tracker.unmarkProcessed(element);
    }
  }

  /**
   * Process a UserLocation element (Mode B: hover tooltip).
   */
  processUserLocation(element: HTMLElement): void {
    const text = element.innerText?.trim();
    if (!text) return;
    if (!isJapaneseShortText(text)) return;
    if (this.tracker.isProcessed(element)) return;

    this.tracker.markProcessed(element);
    this.hoverTargets.add(element);
    element.setAttribute('data-jp-hover', 'location');
  }

  /**
   * Process a UserCell element (follower/following list).
   * Handles both the display name (hover) and bio preview (inline).
   */
  async processUserCell(element: HTMLElement): Promise<void> {
    if (this.tracker.isProcessed(element)) return;
    this.tracker.markProcessed(element);

    // Find display name within the cell
    const nameArea = element.querySelector<HTMLElement>('a[role="link"] span');
    if (nameArea) {
      const nameText = nameArea.innerText?.trim();
      if (nameText && isJapaneseShortText(nameText)) {
        this.hoverTargets.add(nameArea);
        nameArea.setAttribute('data-jp-hover', 'name');
      }
    }

    // Find bio text within the cell (usually the last text-heavy div)
    const mode = this.settings.webpageMode;
    if (mode === 'off') return;

    const allDivs = element.querySelectorAll<HTMLElement>(':scope > div > div');
    for (const div of allDivs) {
      const text = div.innerText?.trim();
      if (!text || text.length < 5) continue;
      if (div.querySelector('a[role="link"]')) continue;
      if (div.querySelector('button')) continue;

      if (isJapaneseText(div)) {
        if (mode === 'hover') {
          this.hoverTargets.add(div);
          div.classList.add('jp-twitter-hover-target');
        } else {
          markProcessed(div);
          try {
            const result = await translator.translate(text);
            if (!div.isConnected) continue;
            this.insertBioTranslation(div, result, true, text);
          } catch {
            // ignore
          }
        }
        break;
      }
    }
  }

  /**
   * Process socialContext (repost indicator) — extract name for hover.
   */
  processSocialContext(element: HTMLElement): void {
    if (this.tracker.isProcessed(element)) return;
    this.tracker.markProcessed(element);

    const link = element.querySelector('a');
    if (!link) return;

    const nameText = link.innerText?.trim();
    if (!nameText || !isJapaneseShortText(nameText)) return;

    this.hoverTargets.add(link as HTMLElement);
    (link as HTMLElement).setAttribute('data-jp-hover', 'name');
  }

  /**
   * Process profile header name (UserName without hyphen).
   */
  processProfileName(element: HTMLElement): void {
    const text = element.innerText?.trim();
    if (!text) return;
    if (!isJapaneseShortText(text)) return;
    if (this.tracker.isProcessed(element)) return;

    this.tracker.markProcessed(element);

    const nameSpan = element.querySelector('span');
    if (nameSpan) {
      this.hoverTargets.add(nameSpan as HTMLElement);
      (nameSpan as HTMLElement).setAttribute('data-jp-hover', 'name');
    }
  }

  // ──────────────── Hover + Furigana ────────────────

  /**
   * Hover mode + furigana: clone element with ruby annotations, hide original.
   * Registers the clone as a hover target for translation on mouseover.
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
      });
      element.insertAdjacentElement('afterend', clone);
      this.tracker.trackInjected(clone);
      element.classList.add('jp-furigana-hidden');

      // Register clone as hover target with original text
      this.hoverTargets.add(clone);
      clone.classList.add('jp-twitter-hover-target');
      clone.setAttribute('data-jp-hover-text', text);
      this.status?.translated();
    } catch (e) {
      log.error('Hover+furigana failed:', e);
      this.status?.failed();
      this.tracker.unmarkProcessed(element);
    }
  }

  // ──────────────── Mode A: Inline Bio Translation ────────────────

  private insertBioTranslation(
    target: HTMLElement,
    result: TranslationResult,
    compact = false,
    text?: string,
  ): void {
    this.tracker.removeExistingTranslation(target);
    target.classList.remove('jp-furigana-hidden');

    let insertAfter: HTMLElement = target;

    if (this.settings.showFurigana) {
      const clone = createRubyClone(target, result.tokens, {
        translationAttr: TRANSLATION_ATTR,
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
      compact,
      spoiler: true,
      skipFurigana: this.settings.showFurigana,
      onRetranslate: text ? () => translator.retranslate(text) : undefined,
    });

    insertAfter.insertAdjacentElement('afterend', div);
    this.tracker.trackInjected(div);
  }

  // ──────────────── Cleanup ────────────────

  cleanup(): void {
    this.tracker.cleanup();

    // Remove hover markers
    document.querySelectorAll('[data-jp-hover]').forEach(el => {
      el.removeAttribute('data-jp-hover');
    });
  }
}
