/**
 * Tracks processing state for DOM elements across a handler.
 *
 * Consolidates the WeakSet + WeakMap + injectedElements[] pattern
 * that was duplicated in every handler (~30 lines x 6 handlers).
 *
 * Each handler should create its own ProcessedTracker with unique
 * attribute names to avoid cross-handler interference on the same page.
 */
export class ProcessedTracker {
  private processedElements = new WeakSet<HTMLElement>();
  private processedTexts = new WeakMap<HTMLElement, string>();
  private injectedElements: HTMLElement[] = [];

  constructor(
    private processedAttr = 'data-jp-processed',
    private translationAttr = 'data-jp-translation',
  ) {}

  /** Check if element was already processed */
  isProcessed(el: HTMLElement): boolean {
    return this.processedElements.has(el);
  }

  /** Check if element was processed with the exact same text */
  isProcessedWithSameText(el: HTMLElement, text: string): boolean {
    if (!this.processedElements.has(el)) return false;
    return this.processedTexts.get(el) === text;
  }

  /** Mark element as processed, optionally recording its text for change detection */
  markProcessed(el: HTMLElement, text?: string): void {
    this.processedElements.add(el);
    el.setAttribute(this.processedAttr, 'true');
    if (text !== undefined) {
      this.processedTexts.set(el, text);
    }
  }

  /** Unmark element to allow re-processing (e.g. after translation error) */
  unmarkProcessed(el: HTMLElement): void {
    this.processedElements.delete(el);
    this.processedTexts.delete(el);
    el.removeAttribute(this.processedAttr);
  }

  /** Track an injected DOM element for later cleanup */
  trackInjected(el: HTMLElement): void {
    this.injectedElements.push(el);
  }

  /** Remove all consecutive translation sibling elements next to target */
  removeExistingTranslation(el: HTMLElement): void {
    let next = el.nextElementSibling;
    while (next?.hasAttribute(this.translationAttr)) {
      const following = next.nextElementSibling;
      next.remove();
      next = following;
    }
  }

  /** Remove all injected elements and reset tracking state */
  cleanup(): void {
    for (const el of this.injectedElements) {
      el.remove();
    }
    this.injectedElements = [];
    this.processedElements = new WeakSet();
    this.processedTexts = new WeakMap();

    // Restore hidden originals
    document.querySelectorAll('.jp-furigana-hidden').forEach(el => {
      el.classList.remove('jp-furigana-hidden');
    });

    // Remove attribute markers from DOM
    document.querySelectorAll(`[${this.processedAttr}]`).forEach(el => {
      el.removeAttribute(this.processedAttr);
    });
    document.querySelectorAll(`[${this.translationAttr}]`).forEach(el => {
      el.remove();
    });
  }
}
