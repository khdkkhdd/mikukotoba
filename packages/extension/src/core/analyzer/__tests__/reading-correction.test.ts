import { describe, test, expect } from 'vitest';
import type { MorphemeToken } from '@/types';
import { applyReadingOverrides, hiraganaToRomaji } from '../reading-overrides';
import { applyContextRules } from '../reading-context-rules';

// 헬퍼: 테스트용 MorphemeToken 생성
function token(surface: string, reading: string, opts?: Partial<MorphemeToken>): MorphemeToken {
  return {
    surface,
    reading,
    romaji: hiraganaToRomaji(reading),
    pos: opts?.pos ?? '名詞',
    baseForm: opts?.baseForm ?? surface,
    isKanji: opts?.isKanji ?? /[\u4E00-\u9FFF\u3400-\u4DBF]/.test(surface),
  };
}

// ─── P2: applyReadingOverrides ───

describe('P2: applyReadingOverrides', () => {
  test('오버라이드 대상이면 읽기가 교정된다', () => {
    const tokens = [token('この間', 'このかん')];
    const result = applyReadingOverrides(tokens);
    expect(result[0].reading).toBe('このあいだ');
    expect(result[0].romaji).toBe('konoaida');
  });

  test('kuromoji가 이미 올바른 읽기를 반환하면 변경하지 않는다', () => {
    // kuromoji가 このあいだ를 반환한 경우 → 오버라이드 조건(kuromojiReading: このかん)과 불일치 → 패스
    const tokens = [token('この間', 'このあいだ')];
    const result = applyReadingOverrides(tokens);
    expect(result[0].reading).toBe('このあいだ');
  });

  test('한자가 아닌 토큰은 영향받지 않는다', () => {
    const tokens = [token('おはよう', 'おはよう', { isKanji: false })];
    const result = applyReadingOverrides(tokens);
    expect(result[0].reading).toBe('おはよう');
  });

  test('오버라이드 목록에 없는 한자는 영향받지 않는다', () => {
    const tokens = [token('東京', 'とうきょう')];
    const result = applyReadingOverrides(tokens);
    expect(result[0].reading).toBe('とうきょう');
  });

  test('大人気: おとなき → だいにんき', () => {
    const tokens = [token('大人気', 'おとなき')];
    const result = applyReadingOverrides(tokens);
    expect(result[0].reading).toBe('だいにんき');
  });

  test('素人: そじん → しろうと', () => {
    const tokens = [token('素人', 'そじん')];
    const result = applyReadingOverrides(tokens);
    expect(result[0].reading).toBe('しろうと');
  });

  test('원본 토큰은 변경되지 않는다 (immutability)', () => {
    const original = token('この間', 'このかん');
    const tokens = [original];
    applyReadingOverrides(tokens);
    expect(original.reading).toBe('このかん');
  });
});

// ─── P3: applyContextRules ───

describe('P3: applyContextRules', () => {
  test('一 + 人 → ひと + り (ひとり)', () => {
    const tokens = [
      token('一', 'いち'),
      token('人', 'にん'),
      token('で', 'で', { pos: '助詞', isKanji: false }),
    ];
    const result = applyContextRules(tokens);
    expect(result[0].reading).toBe('ひと');
    expect(result[1].reading).toBe('り');
  });

  test('二 + 人 → ふた + り (ふたり)', () => {
    const tokens = [
      token('二', 'に'),
      token('人', 'にん'),
      token('で', 'で', { pos: '助詞', isKanji: false }),
    ];
    const result = applyContextRules(tokens);
    expect(result[0].reading).toBe('ふた');
    expect(result[1].reading).toBe('り');
  });

  test('下手 + な → へた', () => {
    const tokens = [
      token('下手', 'しもて'),
      token('な', 'な', { pos: '助動詞', isKanji: false }),
    ];
    const result = applyContextRules(tokens);
    expect(result[0].reading).toBe('へた');
  });

  test('上手 + に → じょうず', () => {
    const tokens = [
      token('上手', 'かみて'),
      token('に', 'に', { pos: '助詞', isKanji: false }),
    ];
    const result = applyContextRules(tokens);
    expect(result[0].reading).toBe('じょうず');
  });

  test('今日が既にきょうの場合は変更しない', () => {
    const tokens = [
      token('今日', 'きょう'),
      token('は', 'は', { pos: '助詞', isKanji: false }),
    ];
    const result = applyContextRules(tokens);
    expect(result[0].reading).toBe('きょう');
  });

  test('今日 + 助詞 → きょう (kuromoji가 다른 읽기를 반환한 경우)', () => {
    const tokens = [
      token('今日', 'こんにち'),
      token('は', 'は', { pos: '助詞', isKanji: false }),
    ];
    const result = applyContextRules(tokens);
    expect(result[0].reading).toBe('きょう');
  });

  test('규칙에 없는 토큰은 영향받지 않는다', () => {
    const tokens = [
      token('東京', 'とうきょう'),
      token('に', 'に', { pos: '助詞', isKanji: false }),
    ];
    const result = applyContextRules(tokens);
    expect(result[0].reading).toBe('とうきょう');
  });

  test('원본 토큰은 변경되지 않는다 (immutability)', () => {
    const original = token('下手', 'しもて');
    const tokens = [original, token('な', 'な', { pos: '助動詞', isKanji: false })];
    applyContextRules(tokens);
    expect(original.reading).toBe('しもて');
  });
});

// ─── hiraganaToRomaji ───

describe('hiraganaToRomaji', () => {
  test('기본 히라가나 변환', () => {
    expect(hiraganaToRomaji('きょう')).toBe('kyou');
  });

  test('っ (촉음) 처리', () => {
    expect(hiraganaToRomaji('きって')).toBe('kitte');
  });

  test('조합문자 처리', () => {
    expect(hiraganaToRomaji('しゃしん')).toBe('shashin');
  });

  test('ー (장음) 처리', () => {
    // ー는 '-'로 변환, 카타카나는 그대로 통과
    expect(hiraganaToRomaji('ラーメン')).toBe('ラ-メン');
  });
});
