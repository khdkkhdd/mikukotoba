import type { TranslationResult, UserSettings } from '@/types';
import { debounce, escapeHtml, escapeHtmlWithBreaks } from '@/content/shared/dom-utils';
import { formatEngineBadge } from './engine-badge';

export interface HoverTooltipOptions {
  /** Unique popup element ID (e.g. 'jp-twitter-hover-popup') */
  popupId: string;
  /** Debounce delay for mousemove (Twitter: 300ms, Webpage: 1000ms) */
  debounceMs?: number;
  /** Allow Escape key to dismiss */
  escapeToClose?: boolean;
  /**
   * Callback to find the target text element at the given screen coordinates.
   * Each handler provides its own strategy:
   * - Twitter: walk up to find element in hoverTargets WeakSet
   * - Webpage: walk up to find block parent with Japanese text
   * - YouTube: selector-based search
   */
  getTargetAtPoint: (x: number, y: number) => { text: string; element: HTMLElement } | null;
}

/**
 * Shared hover tooltip with Shadow DOM isolation.
 *
 * Shows translation popup on hover. Furigana is handled at the
 * handler level (e.g. YouTube injects it during element processing),
 * NOT by this tooltip.
 */
export class HoverTooltip {
  private popup: HTMLDivElement | null = null;
  private shadowRoot: ShadowRoot | null = null;
  private settings: UserSettings;
  private options: HoverTooltipOptions;
  private onTranslate: (text: string) => Promise<TranslationResult>;
  private onRetranslate?: (text: string) => Promise<TranslationResult>;
  private hoverHandler: ((e: MouseEvent) => void) | null = null;
  private keyHandler: ((e: KeyboardEvent) => void) | null = null;
  private currentHoverEl: HTMLElement | null = null;
  private hideCheckHandler: ((e: MouseEvent) => void) | null = null;
  private hideTimeout: ReturnType<typeof setTimeout> | null = null;
  private isMouseOverPopup = false;
  private isSelecting = false;
  private lastMouseX = 0;
  private lastMouseY = 0;

  constructor(
    settings: UserSettings,
    options: HoverTooltipOptions,
    onTranslate: (text: string) => Promise<TranslationResult>,
    onRetranslate?: (text: string) => Promise<TranslationResult>,
  ) {
    this.settings = settings;
    this.options = options;
    this.onTranslate = onTranslate;
    this.onRetranslate = onRetranslate;
  }

  mount(): void {
    if (this.popup) return;

    this.popup = document.createElement('div');
    this.popup.id = this.options.popupId;
    this.popup.style.cssText = 'position: fixed; z-index: 2147483647; display: none; pointer-events: auto;';
    this.shadowRoot = this.popup.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = this.getStyles();
    this.shadowRoot.appendChild(style);

    document.body.appendChild(this.popup);

    // Debounced mousemove listener
    this.hoverHandler = debounce((e: MouseEvent) => {
      this.handleHover(e);
    }, this.options.debounceMs ?? 300) as (e: MouseEvent) => void;

    document.addEventListener('mousemove', this.hoverHandler);

    // Non-debounced mousemove for instant hide detection
    this.hideCheckHandler = (e: MouseEvent) => {
      if (!this.currentHoverEl || !this.popup || this.popup.style.display === 'none') return;
      if (this.isMouseOverPopup || this.isSelecting) return;

      const el = document.elementFromPoint(e.clientX, e.clientY);
      if (el && (
        this.currentHoverEl.contains(el) ||
        el === this.popup || this.popup.contains(el)
      )) {
        this.cancelHideTimeout();
        return;
      }

      this.scheduleHide();
    };
    document.addEventListener('mousemove', this.hideCheckHandler);

    // Track mouse entering/leaving popup to keep it alive
    this.popup.addEventListener('mouseenter', () => {
      this.isMouseOverPopup = true;
      this.cancelHideTimeout();
    });
    this.popup.addEventListener('mouseleave', () => {
      this.isMouseOverPopup = false;
      if (!this.isSelecting) this.scheduleHide();
    });

    // Prevent wheel events from reaching the page
    this.popup.addEventListener('wheel', (e) => {
      e.stopPropagation();
      const content = this.shadowRoot?.querySelector('.ht-content') as HTMLElement | null;
      if (!content) return;
      const { scrollTop, scrollHeight, clientHeight } = content;
      const atTop = scrollTop === 0 && e.deltaY < 0;
      const atBottom = scrollTop + clientHeight >= scrollHeight && e.deltaY > 0;
      if (atTop || atBottom) e.preventDefault();
    });

    // Track text selection to prevent hiding during drag-select
    this.popup.addEventListener('mousedown', () => {
      this.isSelecting = true;
    });
    document.addEventListener('mouseup', () => {
      if (this.isSelecting) {
        this.isSelecting = false;
        if (!this.isMouseOverPopup) this.scheduleHide();
      }
    });

    // Escape key handler
    if (this.options.escapeToClose) {
      this.keyHandler = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          this.hidePopup();
          this.currentHoverEl = null;
        }
      };
      document.addEventListener('keydown', this.keyHandler);
    }
  }

  unmount(): void {
    if (this.hoverHandler) {
      document.removeEventListener('mousemove', this.hoverHandler);
      this.hoverHandler = null;
    }
    if (this.hideCheckHandler) {
      document.removeEventListener('mousemove', this.hideCheckHandler);
      this.hideCheckHandler = null;
    }
    if (this.keyHandler) {
      document.removeEventListener('keydown', this.keyHandler);
      this.keyHandler = null;
    }
    this.cancelHideTimeout();
    this.hidePopup();
    this.popup?.remove();
    this.popup = null;
    this.shadowRoot = null;
    this.currentHoverEl = null;
    this.isMouseOverPopup = false;
    this.isSelecting = false;
  }

  updateSettings(settings: UserSettings): void {
    this.settings = settings;
    // Re-apply styles since colors may have changed
    if (this.shadowRoot) {
      const oldStyle = this.shadowRoot.querySelector('style');
      if (oldStyle) {
        oldStyle.textContent = this.getStyles();
      }
    }
  }

  private scheduleHide(): void {
    if (this.hideTimeout) return;
    this.hideTimeout = setTimeout(() => {
      this.hideTimeout = null;
      if (!this.isMouseOverPopup) {
        this.hidePopup();
        this.currentHoverEl = null;
      }
    }, 100);
  }

  private cancelHideTimeout(): void {
    if (this.hideTimeout) {
      clearTimeout(this.hideTimeout);
      this.hideTimeout = null;
    }
  }

  private async handleHover(e: MouseEvent): Promise<void> {
    if (this.isSelecting) return;

    const target = document.elementFromPoint(e.clientX, e.clientY);
    if (!target) {
      this.hidePopup();
      return;
    }

    // Skip if hovering over our own popup
    if ((target as HTMLElement).id === this.options.popupId ||
        target.closest?.(`#${this.options.popupId}`)) {
      return;
    }

    this.lastMouseX = e.clientX;
    this.lastMouseY = e.clientY;

    const result = this.options.getTargetAtPoint(e.clientX, e.clientY);
    if (!result) {
      this.hidePopup();
      this.currentHoverEl = null;
      return;
    }

    // Same element — don't re-translate
    if (result.element === this.currentHoverEl) return;
    this.currentHoverEl = result.element;
    this.cancelHideTimeout();

    // Show loading state
    this.showLoading(result.element, result.text);

    try {
      const translationResult = await this.onTranslate(result.text);
      // Verify still hovering the same element
      if (this.currentHoverEl !== result.element) return;
      this.showResult(result.element, translationResult, result.text);
    } catch {
      if (this.currentHoverEl === result.element) {
        this.hidePopup();
        this.currentHoverEl = null;
      }
    }
  }

  private showLoading(anchor: HTMLElement, text: string): void {
    this.setPopupContent(`
      <div class="ht-text">${escapeHtml(text)}</div>
      <hr class="ht-divider">
      <div class="ht-loading"><span class="ht-spinner"></span> 번역 중...</div>
    `);
    this.positionPopup();
  }

  private showResult(anchor: HTMLElement, result: TranslationResult, originalText?: string): void {
    let html = '';

    if (this.settings.showRomaji) {
      const romaji = result.tokens.map(t => t.romaji).join(' ');
      html += `<div class="ht-romaji">${escapeHtml(romaji)}</div>`;
    }

    html += `<div class="ht-korean">${escapeHtmlWithBreaks(result.korean)}</div>`;

    const retryBtn = this.onRetranslate
      ? ' <span class="ht-retry-btn" title="LLM으로 재번역">↻</span>'
      : '';
    html += `<div class="ht-engine-badge">${formatEngineBadge(result)}${retryBtn}</div>`;

    this.setPopupContent(html);
    this.positionPopup();

    // Attach retry handler
    if (this.onRetranslate) {
      const btn = this.shadowRoot?.querySelector<HTMLElement>('.ht-retry-btn');
      if (btn) {
        const text = originalText || result.original;
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          btn.classList.add('ht-retry-spinning');
          try {
            const newResult = await this.onRetranslate!(text);
            if (this.currentHoverEl === anchor) {
              this.showResult(anchor, newResult, text);
            }
          } catch {
            btn.classList.remove('ht-retry-spinning');
          }
        });
      }
    }
  }

  private setPopupContent(html: string): void {
    if (!this.shadowRoot) return;
    const content = document.createElement('div');
    content.className = 'ht-content';
    content.innerHTML = html;
    const existing = this.shadowRoot.querySelector('.ht-content');
    if (existing) existing.remove();
    this.shadowRoot.appendChild(content);
  }

  private positionPopup(): void {
    if (!this.popup) return;

    let left = this.lastMouseX + 12;
    let top = this.lastMouseY + 16;

    this.popup.style.display = 'block';
    this.popup.style.left = '0px';
    this.popup.style.top = '0px';
    const popupRect = this.popup.getBoundingClientRect();

    if (left + popupRect.width > window.innerWidth) {
      left = this.lastMouseX - popupRect.width - 8;
    }
    if (top + popupRect.height > window.innerHeight) {
      top = this.lastMouseY - popupRect.height - 8;
    }

    this.popup.style.left = `${Math.max(0, left)}px`;
    this.popup.style.top = `${Math.max(0, top)}px`;
  }

  private hidePopup(): void {
    if (this.popup) {
      this.popup.style.display = 'none';
    }
  }

  private getStyles(): string {
    return `
      .ht-content {
        background: rgba(25, 30, 32, 0.92);
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-radius: 8px;
        padding: 10px 14px;
        min-width: 120px;
        max-width: 420px;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
        font-family: 'Noto Sans JP', 'Yu Gothic', sans-serif;
        color: #ebf0f2;
        user-select: text;
        cursor: auto;
        max-height: 60vh;
        overflow-y: auto;
        overscroll-behavior: contain;
      }

      .ht-text {
        font-size: 14px;
        line-height: 2em;
        color: rgba(255, 255, 255, 0.95);
      }

      .ht-romaji {
        font-size: 12px;
        color: ${this.settings.colorRomaji};
        margin-top: 2px;
      }

      .ht-divider {
        border: none;
        border-top: 1px solid rgba(255, 255, 255, 0.1);
        margin: 6px 0;
      }

      .ht-korean {
        font-size: 13px;
        color: ${this.settings.colorTranslation};
        line-height: 1.5;
      }

      .ht-engine-badge {
        text-align: right;
        font-size: 10px;
        color: rgba(255, 255, 255, 0.35);
        margin-top: 4px;
      }

      .ht-loading {
        font-size: 12px;
        color: rgba(255, 255, 255, 0.5);
        display: flex;
        align-items: center;
        gap: 6px;
      }

      .ht-spinner {
        width: 10px;
        height: 10px;
        border: 2px solid rgba(255, 255, 255, 0.15);
        border-top-color: #39C5BB;
        border-radius: 50%;
        animation: ht-spin 0.6s linear infinite;
      }

      @keyframes ht-spin {
        to { transform: rotate(360deg); }
      }

      .ht-retry-btn {
        cursor: pointer;
        opacity: 0.5;
        display: inline-block;
        transition: opacity 0.15s;
        margin-left: 4px;
        font-size: 12px;
      }

      .ht-retry-btn:hover {
        opacity: 1;
      }

      .ht-retry-spinning {
        animation: ht-spin 0.6s linear infinite;
        pointer-events: none;
      }
    `;
  }
}
