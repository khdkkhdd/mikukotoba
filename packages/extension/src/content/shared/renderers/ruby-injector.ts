import type { MorphemeToken } from '@/types';
import { getTextWithoutRuby } from '@/content/shared/dom-utils';

export type WordClickCallback = (surface: string, reading: string, sentence: string) => void;

/**
 * Clone an element and inject ruby (furigana) annotations into its text nodes.
 *
 * This preserves the original DOM structure — links, @mentions, timestamps,
 * hashtags, and other interactive elements remain intact and clickable.
 * Only text nodes are modified: kanji tokens get wrapped in <ruby>/<rt> tags.
 *
 * The original element should be hidden (jp-furigana-hidden) while the clone
 * is displayed in its place.
 */
export function createRubyClone(
  element: HTMLElement,
  tokens: MorphemeToken[],
  opts?: { translationAttr?: string; className?: string; onWordClick?: WordClickCallback },
): HTMLElement {
  // Use a plain <div> instead of cloning the element directly.
  // Custom elements (YouTube's yt-formatted-string, etc.) may not render
  // their light DOM children in a clone because Polymer/Lit lifecycle hooks
  // don't run for cloned nodes. A <div> reliably renders all children.
  const clone = document.createElement('div');
  clone.innerHTML = element.innerHTML;

  if (opts?.translationAttr) {
    clone.setAttribute(opts.translationAttr, 'true');
  }
  if (opts?.className) {
    clone.classList.add(opts.className);
  }
  clone.classList.add('jp-ruby-annotated');

  // Remove data-testid from descendants so MutationObservers
  // (e.g. TwitterObserver.queryAndRoute) don't re-detect the clone as
  // a content element and reprocess it — which would cause double ruby.
  clone.querySelectorAll('[data-testid]').forEach(el => el.removeAttribute('data-testid'));

  // Copy computed styles from the original element.
  // The clone lives outside its original CSS scope, so inline styles
  // ensure visual fidelity.
  const cs = window.getComputedStyle(element);
  clone.style.fontSize = cs.fontSize;
  clone.style.lineHeight = cs.lineHeight;
  clone.style.color = cs.color;
  clone.style.whiteSpace = cs.whiteSpace;
  clone.style.letterSpacing = cs.letterSpacing;
  clone.style.wordBreak = cs.wordBreak;

  const hasKanji = tokens.some(t => t.isKanji && t.reading !== t.surface);
  if (!hasKanji) return clone;

  // Collect text nodes from clone, skipping those inside existing <rt>/<rp> elements
  const textNodes: Text[] = [];
  const walker = document.createTreeWalker(clone, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      let parent = node.parentElement;
      while (parent && parent !== clone) {
        if (parent.tagName === 'RT' || parent.tagName === 'RP') {
          return NodeFilter.FILTER_REJECT;
        }
        parent = parent.parentElement;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  let n: Text | null;
  while ((n = walker.nextNode() as Text | null)) {
    textNodes.push(n);
  }

  // Process text nodes sequentially using a token cursor.
  // Tokens are ordered and their surfaces appear sequentially in the text.
  let tIdx = 0;
  // Track inline reading that spans across text node boundaries.
  // When a kanji token is at the end of a text node, its inline reading
  // (e.g. 様さま where さま is in the next <span>) needs to be consumed
  // from subsequent text nodes to avoid duplicate display.
  let readingToSkip = '';

  for (const textNode of textNodes) {
    const text = textNode.textContent || '';
    if (!text) continue;
    if (tIdx >= tokens.length && !readingToSkip) continue;

    const parts: Array<string | { surface: string; reading: string }> = [];
    let pos = 0;
    let modified = false;

    // Consume pending inline reading from a previous text node
    if (readingToSkip) {
      if (text.startsWith(readingToSkip)) {
        // Full remaining reading found at start of this text node — skip it
        pos = readingToSkip.length;
        modified = true;
        // Advance token cursor past tokens covered by skipped text
        while (tIdx < tokens.length) {
          const surfIdx = text.indexOf(tokens[tIdx].surface);
          if (surfIdx !== -1 && surfIdx + tokens[tIdx].surface.length <= pos) {
            tIdx++;
          } else {
            break;
          }
        }
        readingToSkip = '';
      } else if (readingToSkip.startsWith(text)) {
        // Entire text node is part of the reading — remove it
        readingToSkip = readingToSkip.slice(text.length);
        // Advance token cursor past tokens within this text node
        while (tIdx < tokens.length) {
          const surfIdx = text.indexOf(tokens[tIdx].surface);
          if (surfIdx !== -1 && surfIdx + tokens[tIdx].surface.length <= text.length) {
            tIdx++;
          } else {
            break;
          }
        }
        textNode.textContent = '';
        continue;
      } else {
        // Mismatch — not an inline reading duplicate, abandon skip
        readingToSkip = '';
      }
    }

    while (pos < text.length && tIdx < tokens.length) {
      const token = tokens[tIdx];

      // Try to find the token surface starting at or after current position.
      // This handles whitespace/newlines between tokens naturally.
      const idx = text.indexOf(token.surface, pos);

      if (idx === -1) {
        // Token not found in remaining text.
        // Fast path: skip whitespace, newline, and invisible formatting
        // tokens. innerText produces \n for <br> and block boundaries,
        // and Twitter may insert zero-width chars — none appear in text nodes.
        if (/^[\s\u200B-\u200F\u2028-\u202F\u2060-\u206F\uFEFF]+$/.test(token.surface)) {
          tIdx++;
          continue;
        }
        // Look-ahead resync: if a later token IS found in this text node,
        // the intervening tokens are "phantom" — they exist in innerText
        // but not in DOM text nodes (e.g. emoji rendered as <img alt="📺">,
        // content from block boundaries, etc.). Skip them to resync.
        let skipCount = 0;
        for (let ahead = 1; ahead <= 5 && tIdx + ahead < tokens.length; ahead++) {
          if (text.indexOf(tokens[tIdx + ahead].surface, pos) !== -1) {
            skipCount = ahead;
            break;
          }
        }
        if (skipCount > 0) {
          tIdx += skipCount;
          continue;
        }
        // No match found ahead — token is likely in a later text node.
        break;
      }

      // Text before the matched token
      if (idx > pos) {
        parts.push(text.slice(pos, idx));
      }

      // The token itself
      if (token.isKanji && token.reading && token.reading !== token.surface) {
        parts.push({ surface: token.surface, reading: token.reading });
        modified = true;
        pos = idx + token.surface.length;
        tIdx++;

        // Skip inline reading that duplicates the ruby annotation.
        // Common in Japanese social media for accessibility (e.g. 更新こうしん).
        if (pos < text.length && text.startsWith(token.reading, pos)) {
          const readingEnd = pos + token.reading.length;
          // Advance token cursor past tokens covered by the inline reading
          while (tIdx < tokens.length) {
            const nextIdx = text.indexOf(tokens[tIdx].surface, pos);
            if (nextIdx !== -1 && nextIdx + tokens[tIdx].surface.length <= readingEnd) {
              pos = nextIdx + tokens[tIdx].surface.length;
              tIdx++;
            } else {
              break;
            }
          }
          pos = readingEnd;
        } else if (pos >= text.length) {
          // Kanji at end of text node — reading may be in the next text node(s)
          readingToSkip = token.reading;
        }
      } else {
        parts.push(token.surface);
        pos = idx + token.surface.length;
        tIdx++;
      }
    }

    // Remaining text after last matched token
    if (pos < text.length) {
      parts.push(text.slice(pos));
    }

    // Replace text node only if we injected ruby
    if (modified) {
      const frag = document.createDocumentFragment();
      for (const part of parts) {
        if (typeof part === 'string') {
          frag.appendChild(document.createTextNode(part));
        } else {
          const ruby = document.createElement('ruby');
          ruby.appendChild(document.createTextNode(part.surface));
          const rt = document.createElement('rt');
          rt.textContent = part.reading;
          ruby.appendChild(rt);
          if (opts?.onWordClick) {
            ruby.style.cursor = 'pointer';
            ruby.classList.add('jp-vocab-clickable');
            const s = part.surface;
            const r = part.reading;
            ruby.addEventListener('click', (e) => {
              // Don't trigger on link/mention clicks
              if ((e.target as Element)?.closest?.('a')) return;
              e.stopPropagation();
              const sentence = getTextWithoutRuby(clone);
              opts.onWordClick!(s, r, sentence);
            });
          }
          frag.appendChild(ruby);
        }
      }
      textNode.parentNode?.replaceChild(frag, textNode);
    }
  }

  return clone;
}
