import type { MorphemeToken } from '@/types';
import kuromoji from 'kuromoji';

const KANJI_REGEX = /[\u4E00-\u9FFF\u3400-\u4DBF]/;

function katakanaToHiragana(str: string): string {
  return str.replace(/[\u30A1-\u30F6]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) - 0x60)
  );
}

// Simple romaji conversion table
const HIRAGANA_TO_ROMAJI: Record<string, string> = {
  'あ': 'a', 'い': 'i', 'う': 'u', 'え': 'e', 'お': 'o',
  'か': 'ka', 'き': 'ki', 'く': 'ku', 'け': 'ke', 'こ': 'ko',
  'さ': 'sa', 'し': 'shi', 'す': 'su', 'せ': 'se', 'そ': 'so',
  'た': 'ta', 'ち': 'chi', 'つ': 'tsu', 'て': 'te', 'と': 'to',
  'な': 'na', 'に': 'ni', 'ぬ': 'nu', 'ね': 'ne', 'の': 'no',
  'は': 'ha', 'ひ': 'hi', 'ふ': 'fu', 'へ': 'he', 'ほ': 'ho',
  'ま': 'ma', 'み': 'mi', 'む': 'mu', 'め': 'me', 'も': 'mo',
  'や': 'ya', 'ゆ': 'yu', 'よ': 'yo',
  'ら': 'ra', 'り': 'ri', 'る': 'ru', 'れ': 're', 'ろ': 'ro',
  'わ': 'wa', 'ゐ': 'wi', 'ゑ': 'we', 'を': 'wo',
  'ん': 'n',
  'が': 'ga', 'ぎ': 'gi', 'ぐ': 'gu', 'げ': 'ge', 'ご': 'go',
  'ざ': 'za', 'じ': 'ji', 'ず': 'zu', 'ぜ': 'ze', 'ぞ': 'zo',
  'だ': 'da', 'ぢ': 'di', 'づ': 'du', 'で': 'de', 'ど': 'do',
  'ば': 'ba', 'び': 'bi', 'ぶ': 'bu', 'べ': 'be', 'ぼ': 'bo',
  'ぱ': 'pa', 'ぴ': 'pi', 'ぷ': 'pu', 'ぺ': 'pe', 'ぽ': 'po',
  'きゃ': 'kya', 'きゅ': 'kyu', 'きょ': 'kyo',
  'しゃ': 'sha', 'しゅ': 'shu', 'しょ': 'sho',
  'ちゃ': 'cha', 'ちゅ': 'chu', 'ちょ': 'cho',
  'にゃ': 'nya', 'にゅ': 'nyu', 'にょ': 'nyo',
  'ひゃ': 'hya', 'ひゅ': 'hyu', 'ひょ': 'hyo',
  'みゃ': 'mya', 'みゅ': 'myu', 'みょ': 'myo',
  'りゃ': 'rya', 'りゅ': 'ryu', 'りょ': 'ryo',
  'ぎゃ': 'gya', 'ぎゅ': 'gyu', 'ぎょ': 'gyo',
  'じゃ': 'ja', 'じゅ': 'ju', 'じょ': 'jo',
  'びゃ': 'bya', 'びゅ': 'byu', 'びょ': 'byo',
  'ぴゃ': 'pya', 'ぴゅ': 'pyu', 'ぴょ': 'pyo',
  'っ': '', // handled separately as double consonant
  'ー': '-',
};

function hiraganaToRomaji(hiragana: string): string {
  let result = '';
  let i = 0;
  while (i < hiragana.length) {
    // Check for っ (double consonant)
    if (hiragana[i] === 'っ' && i + 1 < hiragana.length) {
      const nextTwo = hiragana.substring(i + 1, i + 3);
      const nextOne = hiragana[i + 1];
      const nextRomaji = HIRAGANA_TO_ROMAJI[nextTwo] || HIRAGANA_TO_ROMAJI[nextOne];
      if (nextRomaji) {
        result += nextRomaji[0]; // double the consonant
      }
      i++;
      continue;
    }

    // Check for two-character combinations (きゃ, しゃ, etc.)
    if (i + 1 < hiragana.length) {
      const pair = hiragana.substring(i, i + 2);
      if (HIRAGANA_TO_ROMAJI[pair]) {
        result += HIRAGANA_TO_ROMAJI[pair];
        i += 2;
        continue;
      }
    }

    // Single character
    const ch = hiragana[i];
    if (HIRAGANA_TO_ROMAJI[ch] !== undefined) {
      result += HIRAGANA_TO_ROMAJI[ch];
    } else {
      result += ch; // pass through non-hiragana chars
    }
    i++;
  }
  return result;
}

export class MorphologicalAnalyzer {
  private tokenizer: kuromoji.Tokenizer | null = null;
  private initPromise: Promise<void> | null = null;

  async init(): Promise<void> {
    if (this.tokenizer) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = new Promise((resolve, reject) => {
      // In Chrome extension, dict files are in web_accessible_resources
      const dicPath = chrome.runtime?.getURL?.('dict/') || 'dict/';

      kuromoji.builder({ dicPath }).build((err, tokenizer) => {
        if (err) {
          reject(err);
          return;
        }
        this.tokenizer = tokenizer;
        resolve();
      });
    });

    return this.initPromise;
  }

  async analyze(text: string): Promise<MorphemeToken[]> {
    await this.init();
    if (!this.tokenizer) throw new Error('Tokenizer not initialized');

    const tokens = this.tokenizer.tokenize(text);
    return tokens.map((t) => {
      const reading = t.reading ? katakanaToHiragana(t.reading) : t.surface_form;
      return {
        surface: t.surface_form,
        reading,
        romaji: hiraganaToRomaji(reading),
        pos: t.pos,
        baseForm: t.basic_form || t.surface_form,
        isKanji: KANJI_REGEX.test(t.surface_form),
      };
    });
  }

  isReady(): boolean {
    return this.tokenizer !== null;
  }
}

export const analyzer = new MorphologicalAnalyzer();
