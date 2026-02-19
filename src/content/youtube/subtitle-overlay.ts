import type { TranslationResult, UserSettings, MorphemeToken } from '@/types';
import type { WordClickCallback } from '@/content/shared/renderers/ruby-injector';
import { tokensToDetailedFuriganaHTML, tokensToRomaji } from '@/core/analyzer/reading-converter';
import { formatEngineBadge } from '@/content/shared/renderers/engine-badge';

/**
 * Custom subtitle overlay that replaces YouTube's built-in captions.
 * Uses Shadow DOM for CSS isolation.
 */
export class SubtitleOverlay {
  private container: HTMLDivElement | null = null;
  private shadowRoot: ShadowRoot | null = null;
  private overlay: HTMLDivElement | null = null;
  private settings: UserSettings;
  private onWordClick: WordClickCallback | null = null;
  private fadeTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(settings: UserSettings) {
    this.settings = settings;
  }

  mount(): void {
    if (this.container) return;

    const player = document.querySelector('.html5-video-player');
    if (!player) return;

    // Create container with Shadow DOM
    this.container = document.createElement('div');
    this.container.id = 'jp-helper-overlay-container';
    this.shadowRoot = this.container.attachShadow({ mode: 'open' });

    // Add styles
    const style = document.createElement('style');
    style.textContent = this.getStyles();
    this.shadowRoot.appendChild(style);

    // Create overlay element
    this.overlay = document.createElement('div');
    this.overlay.className = 'jp-overlay';
    this.overlay.setAttribute('role', 'region');
    this.overlay.setAttribute('aria-label', 'JP Helper subtitles');
    this.shadowRoot.appendChild(this.overlay);

    player.appendChild(this.container);

    // Hide YouTube's built-in captions
    this.hideYouTubeCaptions();
  }

  unmount(): void {
    if (this.fadeTimeout) {
      clearTimeout(this.fadeTimeout);
      this.fadeTimeout = null;
    }
    if (this.container) {
      this.container.remove();
      this.container = null;
      this.shadowRoot = null;
      this.overlay = null;
    }
    this.showYouTubeCaptions();
  }

  setOnWordClick(handler: WordClickCallback): void {
    this.onWordClick = handler;
  }

  updateSettings(settings: UserSettings): void {
    this.settings = settings;
    if (this.shadowRoot) {
      const style = this.shadowRoot.querySelector('style');
      if (style) {
        style.textContent = this.getStyles();
      }
    }
  }

  show(result: TranslationResult): void {
    if (!this.overlay) return;

    // Clear any pending fade
    if (this.fadeTimeout) {
      clearTimeout(this.fadeTimeout);
    }

    // Build overlay content
    this.overlay.innerHTML = '';
    this.overlay.style.opacity = '0';

    // Line 1: Original with furigana
    if (this.settings.showFurigana) {
      const originalLine = document.createElement('div');
      originalLine.className = 'line-original';
      originalLine.innerHTML = this.buildFuriganaLine(result.tokens);
      this.overlay.appendChild(originalLine);
    } else {
      const originalLine = document.createElement('div');
      originalLine.className = 'line-original';
      originalLine.innerHTML = this.buildClickableTokens(result.tokens);
      this.overlay.appendChild(originalLine);
    }

    // Line 2: Romaji (optional)
    if (this.settings.showRomaji) {
      const romajiLine = document.createElement('div');
      romajiLine.className = 'line-romaji';
      romajiLine.textContent = tokensToRomaji(result.tokens);
      this.overlay.appendChild(romajiLine);
    }

    // Line 3: Korean translation
    if (this.settings.showTranslation) {
      const translationLine = document.createElement('div');
      translationLine.className = 'line-translation';
      translationLine.textContent = result.korean;
      this.overlay.appendChild(translationLine);
    }

    // Engine indicator
    const engineBadge = document.createElement('div');
    engineBadge.className = 'engine-badge';
    engineBadge.textContent = formatEngineBadge(result);
    this.overlay.appendChild(engineBadge);

    // Wire up word click handlers
    this.setupWordClickHandlers(result.tokens);

    // Fade in
    requestAnimationFrame(() => {
      if (this.overlay) {
        this.overlay.style.opacity = '1';
      }
    });
  }

  hide(): void {
    if (!this.overlay) return;
    this.overlay.style.opacity = '0';
    this.fadeTimeout = setTimeout(() => {
      if (this.overlay) {
        this.overlay.innerHTML = '';
      }
    }, 200);
  }

  private buildFuriganaLine(tokens: MorphemeToken[]): string {
    return tokens
      .map((token, i) => {
        const wrapper = `<span class="word" data-token-idx="${i}">`;
        if (token.isKanji && token.reading !== token.surface) {
          return `${wrapper}<ruby>${this.esc(token.surface)}<rt>${this.esc(token.reading)}</rt></ruby></span>`;
        }
        return `${wrapper}${this.esc(token.surface)}</span>`;
      })
      .join('');
  }

  private buildClickableTokens(tokens: MorphemeToken[]): string {
    return tokens
      .map((token, i) =>
        `<span class="word" data-token-idx="${i}">${this.esc(token.surface)}</span>`
      )
      .join('');
  }

  private setupWordClickHandlers(tokens: MorphemeToken[]): void {
    if (!this.overlay || !this.onWordClick) return;

    const sentence = this.overlay.querySelector('.line-original')?.textContent?.trim() || '';
    const wordSpans = this.overlay.querySelectorAll('.word');
    wordSpans.forEach((span) => {
      span.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt((span as HTMLElement).dataset.tokenIdx || '0', 10);
        if (tokens[idx] && this.onWordClick) {
          this.onWordClick(tokens[idx].surface, tokens[idx].reading, sentence);
        }
      });
    });
  }

  private hideYouTubeCaptions(): void {
    const style = document.createElement('style');
    style.id = 'jp-helper-hide-yt-captions';
    style.textContent = `
      .ytp-caption-window-container { display: none !important; }
      .caption-window { display: none !important; }
    `;
    document.head.appendChild(style);
  }

  private showYouTubeCaptions(): void {
    const style = document.getElementById('jp-helper-hide-yt-captions');
    if (style) style.remove();
  }

  private esc(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  private getStyles(): string {
    const s = this.settings;
    return `
      :host {
        all: initial;
        display: block;
        position: absolute;
        bottom: 60px;
        left: 50%;
        transform: translateX(-50%);
        z-index: 9999;
        pointer-events: auto;
      }

      .jp-overlay {
        background: rgba(0, 0, 0, ${s.backgroundOpacity / 100});
        border-radius: 8px;
        padding: 12px 20px;
        text-align: center;
        max-width: 80%;
        min-width: 200px;
        transition: opacity 200ms ease;
        font-family: 'Noto Sans JP', 'Yu Gothic', 'Hiragino Kaku Gothic Pro', sans-serif;
        line-height: 1.6;
      }

      .line-original {
        color: ${s.colorOriginal};
        font-size: ${s.fontSize}px;
        margin-bottom: 4px;
      }

      .line-original ruby {
        ruby-position: over;
      }

      .line-original rt {
        color: ${s.colorFurigana};
        font-size: ${Math.round(s.fontSize * 0.5)}px;
      }

      .line-romaji {
        color: ${s.colorRomaji};
        font-size: ${Math.round(s.fontSize * 0.65)}px;
        margin-bottom: 4px;
        letter-spacing: 0.5px;
      }

      .line-translation {
        color: ${s.colorTranslation};
        font-size: ${Math.round(s.fontSize * 0.8)}px;
        margin-bottom: 2px;
      }

      .engine-badge {
        text-align: right;
        font-size: 10px;
        color: rgba(255, 255, 255, 0.4);
        margin-top: 2px;
      }

      .word {
        cursor: pointer;
        transition: background-color 150ms;
        border-radius: 2px;
        padding: 0 1px;
      }

      .word:hover {
        background-color: rgba(255, 255, 255, 0.15);
      }

      /* Word detail popup */
      .word-popup {
        position: absolute;
        background: rgba(30, 30, 30, 0.95);
        border: 1px solid rgba(255, 255, 255, 0.2);
        border-radius: 8px;
        padding: 12px 16px;
        min-width: 180px;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
        z-index: 10000;
        text-align: left;
      }

      .word-popup .wp-surface {
        font-size: 20px;
        color: #fff;
        margin-bottom: 4px;
      }

      .word-popup .wp-reading {
        font-size: 14px;
        color: ${s.colorFurigana};
      }

      .word-popup .wp-romaji {
        font-size: 13px;
        color: ${s.colorRomaji};
        margin-bottom: 4px;
      }

      .word-popup .wp-pos {
        font-size: 11px;
        color: rgba(255, 255, 255, 0.5);
        background: rgba(255, 255, 255, 0.1);
        padding: 2px 6px;
        border-radius: 4px;
        display: inline-block;
        margin-top: 4px;
      }

      .word-popup .wp-base {
        font-size: 12px;
        color: rgba(255, 255, 255, 0.7);
        margin-top: 4px;
      }
    `;
  }

  /**
   * Show a popup with word details when a word is clicked.
   */
  showWordPopup(token: MorphemeToken, anchorRect: DOMRect): void {
    if (!this.shadowRoot) return;

    // Remove existing popup
    this.hideWordPopup();

    const popup = document.createElement('div');
    popup.className = 'word-popup';
    popup.innerHTML = `
      <div class="wp-surface">${this.esc(token.surface)}</div>
      <div class="wp-reading">${this.esc(token.reading)}</div>
      <div class="wp-romaji">${this.esc(token.romaji)}</div>
      <div class="wp-base">基本形: ${this.esc(token.baseForm)}</div>
      <span class="wp-pos">${this.esc(token.pos)}</span>
    `;

    this.shadowRoot.appendChild(popup);

    // Position popup
    const containerRect = this.container?.getBoundingClientRect();
    if (containerRect) {
      popup.style.left = `${anchorRect.left - containerRect.left}px`;
      popup.style.top = `${anchorRect.top - containerRect.top - popup.offsetHeight - 8}px`;
    }

    // Close on click outside
    const closeHandler = (e: Event) => {
      if (!popup.contains(e.target as Node)) {
        this.hideWordPopup();
        document.removeEventListener('click', closeHandler);
      }
    };
    setTimeout(() => document.addEventListener('click', closeHandler), 0);
  }

  hideWordPopup(): void {
    if (!this.shadowRoot) return;
    const existing = this.shadowRoot.querySelector('.word-popup');
    if (existing) existing.remove();
  }
}
