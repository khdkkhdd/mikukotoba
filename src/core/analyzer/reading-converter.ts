import type { MorphemeToken } from '@/types';
import { escapeHtml, escapeHtmlWithBreaks } from '@/content/shared/dom-utils';

const KANJI_REGEX = /[\u4E00-\u9FFF\u3400-\u4DBF]/;

/**
 * Generate furigana HTML using ruby tags from morpheme tokens.
 * Only adds ruby annotations for tokens containing kanji.
 *
 * Detects and skips inline readings that duplicate the ruby annotation
 * (e.g. 更新こうしん → tokens ["更新", "こうしん"] → only outputs ruby for 更新).
 */
export function tokensToFuriganaHTML(tokens: MorphemeToken[]): string {
  const parts: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.isKanji && token.reading !== token.surface) {
      parts.push(`<ruby>${escapeHtml(token.surface)}<rt>${escapeHtml(token.reading)}</rt></ruby>`);

      // Skip subsequent tokens that form an inline reading duplicate
      let consumed = 0;
      let j = i + 1;
      while (j < tokens.length && consumed < token.reading.length) {
        if (token.reading.startsWith(tokens[j].surface, consumed)) {
          consumed += tokens[j].surface.length;
          j++;
        } else {
          break;
        }
      }
      if (consumed === token.reading.length) {
        i = j - 1; // Skip consumed tokens (loop increments i)
      }
    } else {
      parts.push(escapeHtmlWithBreaks(token.surface));
    }
  }
  return parts.join('');
}

/**
 * Generate furigana HTML with finer granularity — only kanji characters
 * within a token get ruby annotations, kana portions pass through.
 */
export function tokensToDetailedFuriganaHTML(tokens: MorphemeToken[]): string {
  return tokens
    .map((token) => {
      if (!token.isKanji) {
        return escapeHtmlWithBreaks(token.surface);
      }
      // For tokens with kanji, try to align kanji with readings
      return buildRubyForToken(token.surface, token.reading);
    })
    .join('');
}

/**
 * Build ruby HTML for a single token by matching kanji portions with readings.
 * Uses a simple heuristic: split on kana boundaries.
 */
function buildRubyForToken(surface: string, reading: string): string {
  // If the entire surface is kanji, wrap it all
  if (/^[\u4E00-\u9FFF\u3400-\u4DBF]+$/.test(surface)) {
    return `<ruby>${escapeHtml(surface)}<rt>${escapeHtml(reading)}</rt></ruby>`;
  }

  // Try to align by splitting surface on kana boundaries
  const parts: { text: string; isKanji: boolean }[] = [];
  let current = '';
  let currentIsKanji = false;

  for (const ch of surface) {
    const charIsKanji = KANJI_REGEX.test(ch);
    if (current && charIsKanji !== currentIsKanji) {
      parts.push({ text: current, isKanji: currentIsKanji });
      current = '';
    }
    current += ch;
    currentIsKanji = charIsKanji;
  }
  if (current) parts.push({ text: current, isKanji: currentIsKanji });

  // If only one part, just do simple ruby
  if (parts.length === 1) {
    if (parts[0].isKanji) {
      return `<ruby>${escapeHtml(surface)}<rt>${escapeHtml(reading)}</rt></ruby>`;
    }
    return escapeHtml(surface);
  }

  // Try to match kana parts in reading to split the reading
  let remainingReading = reading;
  const result: string[] = [];

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (!part.isKanji) {
      // Find this kana sequence in the remaining reading
      const hiragana = part.text;
      const idx = remainingReading.indexOf(hiragana);
      if (idx > 0) {
        // Everything before this kana is the reading for the previous kanji
        // This is already handled, so we skip ahead
      }
      if (idx >= 0) {
        remainingReading = remainingReading.substring(idx + hiragana.length);
      }
      result.push(escapeHtml(part.text));
    } else {
      // Find the next kana part to determine where this kanji's reading ends
      const nextKanaPart = parts.slice(i + 1).find((p) => !p.isKanji);
      if (nextKanaPart) {
        const nextIdx = remainingReading.indexOf(nextKanaPart.text);
        if (nextIdx > 0) {
          const kanjiReading = remainingReading.substring(0, nextIdx);
          result.push(
            `<ruby>${escapeHtml(part.text)}<rt>${escapeHtml(kanjiReading)}</rt></ruby>`
          );
          remainingReading = remainingReading.substring(nextIdx);
          continue;
        }
      }
      // Fallback: use all remaining reading
      result.push(
        `<ruby>${escapeHtml(part.text)}<rt>${escapeHtml(remainingReading)}</rt></ruby>`
      );
      remainingReading = '';
    }
  }

  return result.join('');
}

/**
 * Convert tokens to romaji string
 */
export function tokensToRomaji(tokens: MorphemeToken[]): string {
  return tokens.map((t) => t.romaji).join(' ');
}

/**
 * Convert tokens to hiragana string
 */
export function tokensToHiragana(tokens: MorphemeToken[]): string {
  return tokens.map((t) => t.reading).join('');
}

