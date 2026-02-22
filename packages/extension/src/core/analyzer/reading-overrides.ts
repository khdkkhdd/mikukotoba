import type { MorphemeToken } from '@/types';
import overridesData from './reading-overrides.json';

/**
 * 정적 읽기 오버라이드: kuromoji가 특정 잘못된 읽기를 반환할 때만 교정.
 * 안전장치: kuromojiReading이 일치할 때만 교정 → 이미 맞는 결과를 건드리지 않음.
 *
 * 교정 데이터는 reading-overrides.json에서 관리.
 * 추가: node tools/add-reading-override.mjs --surface ... --wrong ... --correct ...
 */

interface ReadingOverride {
  surface: string;
  kuromojiReading: string;
  correctReading: string;
}

const READING_OVERRIDES: ReadingOverride[] = overridesData;

// surface → ReadingOverride 매핑 (O(1) lookup)
const overrideMap = new Map<string, ReadingOverride[]>();
for (const override of READING_OVERRIDES) {
  const list = overrideMap.get(override.surface) ?? [];
  list.push(override);
  overrideMap.set(override.surface, list);
}

/**
 * 히라가나 → 로마자 변환 (morphological.ts와 동일 로직).
 * morphological.ts에서 export하지 않으므로 여기서 재정의.
 */
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
  'っ': '',
  'ー': '-',
};

export function hiraganaToRomaji(hiragana: string): string {
  let result = '';
  let i = 0;
  while (i < hiragana.length) {
    if (hiragana[i] === 'っ' && i + 1 < hiragana.length) {
      const nextTwo = hiragana.substring(i + 1, i + 3);
      const nextOne = hiragana[i + 1];
      const nextRomaji = HIRAGANA_TO_ROMAJI[nextTwo] || HIRAGANA_TO_ROMAJI[nextOne];
      if (nextRomaji) {
        result += nextRomaji[0];
      }
      i++;
      continue;
    }
    if (i + 1 < hiragana.length) {
      const pair = hiragana.substring(i, i + 2);
      if (HIRAGANA_TO_ROMAJI[pair]) {
        result += HIRAGANA_TO_ROMAJI[pair];
        i += 2;
        continue;
      }
    }
    const ch = hiragana[i];
    if (HIRAGANA_TO_ROMAJI[ch] !== undefined) {
      result += HIRAGANA_TO_ROMAJI[ch];
    } else {
      result += ch;
    }
    i++;
  }
  return result;
}

export function applyReadingOverrides(tokens: MorphemeToken[]): MorphemeToken[] {
  return tokens.map(token => {
    if (!token.isKanji) return token;
    const overrides = overrideMap.get(token.surface);
    if (!overrides) return token;
    for (const override of overrides) {
      if (token.reading === override.kuromojiReading) {
        return {
          ...token,
          reading: override.correctReading,
          romaji: hiraganaToRomaji(override.correctReading),
        };
      }
    }
    return token;
  });
}
