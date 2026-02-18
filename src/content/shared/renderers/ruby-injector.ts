import type { MorphemeToken } from '@/types';

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
  opts?: { translationAttr?: string; className?: string },
): HTMLElement {
  const clone = element.cloneNode(true) as HTMLElement;

  if (opts?.translationAttr) {
    clone.setAttribute(opts.translationAttr, 'true');
  }
  if (opts?.className) {
    clone.classList.add(opts.className);
  }
  clone.classList.add('jp-ruby-annotated');

  // Remove id from clone to avoid duplicate IDs in the DOM
  clone.removeAttribute('id');

  // Remove data-testid from clone and descendants so MutationObservers
  // (e.g. TwitterObserver.queryAndRoute) don't re-detect the clone as
  // a content element and reprocess it — which would cause double ruby.
  clone.removeAttribute('data-testid');
  clone.querySelectorAll('[data-testid]').forEach(el => el.removeAttribute('data-testid'));

  // Copy computed font-size from the original element.
  // The clone may be inserted outside its original CSS scope (e.g. YouTube
  // Polymer removes #content-text matching after id removal), causing it to
  // inherit a wrong base font-size. Inline style ensures visual fidelity.
  const computedFontSize = window.getComputedStyle(element).fontSize;
  if (computedFontSize) {
    clone.style.fontSize = computedFontSize;
  }

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
          frag.appendChild(ruby);
        }
      }
      textNode.parentNode?.replaceChild(frag, textNode);
    }
  }

  return clone;
}
