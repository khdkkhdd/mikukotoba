import type { VocabEntry } from '@/types';
import type { Translator } from '@/core/translator';
import { getLastSelectionInfo } from './selection-capture';

export interface VocabAutoFillResult {
  word: string;
  reading: string;
  romaji: string;
  meaning: string;
  pos: string;
  exampleSentence: string;
  exampleSource: string;
}

/**
 * Auto-fill vocabulary entry using morphological analysis and translation.
 */
export async function autoFillVocab(
  text: string,
  translator: Translator,
): Promise<VocabAutoFillResult> {
  const selInfo = getLastSelectionInfo();
  const result: VocabAutoFillResult = {
    word: text,
    reading: '',
    romaji: '',
    meaning: '',
    pos: '',
    exampleSentence: selInfo?.sentence || '',
    exampleSource: location.href,
  };

  // Run analysis and translation in parallel
  const [tokens, translation] = await Promise.allSettled([
    translator.getAnalyzer().analyze(text),
    translator.translate(text),
  ]);

  if (tokens.status === 'fulfilled' && tokens.value.length > 0) {
    const mainToken = tokens.value.find(t => t.pos !== '記号' && t.pos !== '助詞') || tokens.value[0];
    result.reading = tokens.value.map(t => t.reading).join('');
    result.romaji = tokens.value.map(t => t.romaji).join(' ');
    result.pos = mainToken.pos;

    // Use base form if it's a single-word selection
    if (tokens.value.length === 1 && mainToken.baseForm && mainToken.baseForm !== '*') {
      result.word = mainToken.baseForm;
      if (mainToken.baseForm !== text) {
        try {
          const baseTokens = await translator.getAnalyzer().analyze(mainToken.baseForm);
          if (baseTokens.length > 0) {
            result.reading = baseTokens.map(t => t.reading).join('');
            result.romaji = baseTokens.map(t => t.romaji).join(' ');
          }
        } catch {
          // keep original reading
        }
      }
    }
  }

  if (translation.status === 'fulfilled') {
    result.meaning = translation.value.korean;
  }

  return result;
}

/**
 * Build a VocabEntry from the auto-fill result + user edits.
 */
export function buildVocabEntry(
  data: Omit<VocabEntry, 'id' | 'dateAdded' | 'timestamp'>,
): VocabEntry {
  const now = Date.now();
  return {
    ...data,
    id: `${now}_${Math.random().toString(36).slice(2, 8)}`,
    dateAdded: new Date().toISOString().split('T')[0],
    timestamp: now,
  };
}
