import type { UserSettings } from '@/types';
import { isJapanese } from '@/content/shared/dom-utils';
import { translator } from '@/core/translator';
import { HoverTooltip } from '@/content/shared/renderers/hover-tooltip';

/**
 * Hover popup mode: shows sentence-level furigana and translation
 * when hovering over Japanese text blocks.
 *
 * Now a thin wrapper around the shared HoverTooltip,
 * providing a webpage-specific getTargetAtPoint callback.
 */
export class HoverPopup {
  private tooltip: HoverTooltip;

  constructor(settings: UserSettings) {
    this.tooltip = new HoverTooltip(
      settings,
      {
        popupId: 'jp-helper-hover-popup',
        debounceMs: 1000,
        escapeToClose: true,
        getTargetAtPoint: (x, y) => this.getTextBlockAtPoint(x, y),
      },
      (text) => translator.translate(text),
      (text) => translator.retranslate(text),
    );
  }

  start(): void {
    this.tooltip.mount();
  }

  stop(): void {
    this.tooltip.unmount();
  }

  updateSettings(settings: UserSettings): void {
    this.tooltip.updateSettings(settings);
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
