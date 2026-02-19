/**
 * Debounce a function call
 */
export function debounce<T extends (...args: any[]) => void>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout>;
  return (...args: Parameters<T>) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

/**
 * Throttle a function call
 */
export function throttle<T extends (...args: unknown[]) => void>(
  fn: T,
  limit: number
): (...args: Parameters<T>) => void {
  let lastCall = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  return (...args: Parameters<T>) => {
    const now = Date.now();
    const remaining = limit - (now - lastCall);
    if (remaining <= 0) {
      lastCall = now;
      fn(...args);
    } else if (!timer) {
      timer = setTimeout(() => {
        lastCall = Date.now();
        timer = null;
        fn(...args);
      }, remaining);
    }
  };
}

/**
 * Check if text contains Japanese characters.
 * Requires at least one hiragana or katakana character to distinguish
 * Japanese from Chinese (which shares the CJK kanji range).
 */
export function isJapanese(text: string): boolean {
  // Must contain hiragana or katakana (unique to Japanese)
  return /[\u3040-\u309F\u30A0-\u30FF]/.test(text);
}

/**
 * Check if text contains Japanese characters (including CJK kanji).
 * Use this when the context already guarantees Japanese (e.g. YouTube subtitles)
 * and pure-kanji text without kana should still be detected.
 */
export function containsJapaneseLike(text: string): boolean {
  return /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]/.test(text);
}

/**
 * Check the proportion of Japanese characters in text.
 * Counts hiragana, katakana, and CJK kanji.
 */
export function japaneseRatio(text: string): number {
  if (!text) return 0;
  // Only count as Japanese if hiragana/katakana are present
  if (!/[\u3040-\u309F\u30A0-\u30FF]/.test(text)) return 0;
  const jpChars = (text.match(/[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]/g) || []).length;
  return jpChars / text.length;
}

/**
 * Check if short text (e.g. display names) is Japanese.
 * For short texts, also checks CJK ratio >= 50% even without kana.
 */
export function isJapaneseShortText(text: string): boolean {
  if (!text) return false;
  if (isJapanese(text)) return true;

  // For short text: CJK characters without kana (e.g. pure kanji names like 田中太郎)
  const cjkChars = (text.match(/[\u4E00-\u9FFF\u3400-\u4DBF]/g) || []).length;
  const totalChars = text.replace(/\s/g, '').length;
  return totalChars > 0 && cjkChars / totalChars >= 0.5;
}

/**
 * Walk text nodes in a DOM subtree
 */
export function walkTextNodes(
  root: Node,
  callback: (node: Text) => void
): void {
  const walker = document.createTreeWalker(
    root,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode: (node) => {
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        // Skip script, style, and already-processed elements
        const tag = parent.tagName;
        if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT' || tag === 'TEXTAREA' || tag === 'INPUT') {
          return NodeFilter.FILTER_REJECT;
        }
        if (parent.closest('[data-jp-processed]') || parent.closest('[data-jp-translation]')) {
          return NodeFilter.FILTER_REJECT;
        }
        // Skip user-editable areas (contenteditable, role=textbox, etc.)
        if (parent.closest('[contenteditable="true"], [contenteditable=""], [role="textbox"], [role="combobox"]')) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    }
  );

  let node: Text | null;
  while ((node = walker.nextNode() as Text | null)) {
    callback(node);
  }
}

/**
 * Create a Shadow DOM container for isolation
 */
export function createShadowContainer(id: string): {
  container: HTMLDivElement;
  shadowRoot: ShadowRoot;
} {
  const container = document.createElement('div');
  container.id = id;
  const shadowRoot = container.attachShadow({ mode: 'open' });
  return { container, shadowRoot };
}

/**
 * Escape HTML entities
 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Escape HTML entities and preserve line breaks as <br>.
 * Use for multi-line content (translations, comments) rendered via innerHTML.
 */
export function escapeHtmlWithBreaks(text: string): string {
  return escapeHtml(text).replace(/\n/g, '<br>');
}

/**
 * Get sentence containing a specific position in text
 */
export function getSentenceAtPosition(text: string, position: number): string {
  // Japanese sentence boundaries
  const sentenceEnders = /[。！？\n]/;
  let start = position;
  let end = position;

  // Find sentence start
  while (start > 0 && !sentenceEnders.test(text[start - 1])) {
    start--;
  }

  // Find sentence end
  while (end < text.length && !sentenceEnders.test(text[end])) {
    end++;
  }

  return text.substring(start, end + 1).trim();
}
