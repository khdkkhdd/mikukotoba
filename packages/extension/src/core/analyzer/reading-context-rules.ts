import type { MorphemeToken } from '@/types';
import { hiraganaToRomaji } from './reading-overrides';
import sequencePatterns from './context-rules.json';

/**
 * 문맥 규칙 기반 읽기 보정: 앞뒤 토큰의 POS/surface를 보고 다독음 한자의 읽기를 결정.
 * P2(정적 오버라이드) 이후에 적용.
 *
 * Type A (단순 연속 토큰 매칭): context-rules.json에서 데이터 로드
 * Type B (문법 조건 필요): 아래 CONTEXT_RULES에 유지
 */

// ── Type A: JSON 기반 연속 토큰 패턴 엔진 ──

interface SequencePattern {
  pattern: string[];
  readings: string[];
  whenReadings?: string[];
  note?: string;
}

function applySequencePatterns(tokens: MorphemeToken[]): MorphemeToken[] {
  const result = tokens.map(t => ({ ...t }));

  for (const rule of sequencePatterns as SequencePattern[]) {
    const len = rule.pattern.length;
    for (let i = 0; i <= result.length - len; i++) {
      // surface 매칭
      let match = true;
      for (let j = 0; j < len; j++) {
        if (result[i + j].surface !== rule.pattern[j]) {
          match = false;
          break;
        }
      }
      if (!match) continue;

      // whenReadings 조건 체크
      if (rule.whenReadings) {
        for (let j = 0; j < len; j++) {
          if (result[i + j].reading !== rule.whenReadings[j]) {
            match = false;
            break;
          }
        }
        if (!match) continue;
      }

      // 매칭 성공 → 읽기 교정
      for (let j = 0; j < len; j++) {
        result[i + j].reading = rule.readings[j];
        result[i + j].romaji = hiraganaToRomaji(rule.readings[j]);
      }
    }
  }

  return result;
}

// ── Type B: 문법 조건이 필요한 규칙 (TS 유지) ──

interface ContextRule {
  surface: string;
  condition: (prev: MorphemeToken | null, next: MorphemeToken | null, token: MorphemeToken) => boolean;
  correctReading: string;
}

function isParticle(token: MorphemeToken): boolean {
  return token.pos === '助詞';
}

function isAuxVerb(token: MorphemeToken): boolean {
  return token.pos === '助動詞';
}

function surfaceIs(token: MorphemeToken | null, ...values: string[]): boolean {
  return token != null && values.includes(token.surface);
}

// ── 문맥 규칙 목록 (Type B만) ──
const CONTEXT_RULES: ContextRule[] = [
  // 一 + 日 → ついたち (매월 1일) vs いちにち (하루 종일)
  // 一日中 패턴: 一+日+中 → いちにちじゅう (기본 kuromoji 읽기가 맞음)
  // 一日 + 助詞/文末 → ついたち가 더 일반적
  {
    surface: '日',
    condition: (prev, next, token) =>
      prev != null && prev.surface === '一' &&
      token.reading === 'にち' &&
      (next == null || isParticle(next)) &&
      !surfaceIs(next, '中'),
    correctReading: 'たち',  // 一→つい + 日→たち = ついたち
  },

  // 下手 + な/だ/です → へた (na-adjective 용법 확인)
  {
    surface: '下手',
    condition: (_, next, token) =>
      token.reading !== 'へた' && surfaceIs(next, 'な', 'だ', 'です', 'に', 'で'),
    correctReading: 'へた',
  },

  // 上手 + な/だ/です/に → じょうず
  {
    surface: '上手',
    condition: (_, next, token) =>
      token.reading !== 'じょうず' && surfaceIs(next, 'な', 'だ', 'です', 'に', 'で', 'く'),
    correctReading: 'じょうず',
  },

  // 今日 + 助詞 → きょう (기본적으로 kuromoji가 맞게 반환하지만 안전장치)
  {
    surface: '今日',
    condition: (_, next, token) =>
      token.reading !== 'きょう' && (next == null || isParticle(next) || isAuxVerb(next)),
    correctReading: 'きょう',
  },

  // 明日 + 助詞 → あした
  {
    surface: '明日',
    condition: (_, next, token) =>
      token.reading !== 'あした' && (next == null || isParticle(next) || isAuxVerb(next)),
    correctReading: 'あした',
  },

  // 昨日 + 助詞 → きのう
  {
    surface: '昨日',
    condition: (_, next, token) =>
      token.reading !== 'きのう' && (next == null || isParticle(next) || isAuxVerb(next)),
    correctReading: 'きのう',
  },
];

// surface → ContextRule[] 매핑 (O(1) lookup)
const rulesForSurface = new Map<string, ContextRule[]>();
for (const rule of CONTEXT_RULES) {
  const list = rulesForSurface.get(rule.surface) ?? [];
  list.push(rule);
  rulesForSurface.set(rule.surface, list);
}

function applyTypeBRules(tokens: MorphemeToken[]): MorphemeToken[] {
  return tokens.map((token, i) => {
    const rules = rulesForSurface.get(token.surface);
    if (!rules) return token;
    const prev = i > 0 ? tokens[i - 1] : null;
    const next = i < tokens.length - 1 ? tokens[i + 1] : null;
    for (const rule of rules) {
      if (rule.condition(prev, next, token)) {
        return {
          ...token,
          reading: rule.correctReading,
          romaji: hiraganaToRomaji(rule.correctReading),
        };
      }
    }
    return token;
  });
}

export function applyContextRules(tokens: MorphemeToken[]): MorphemeToken[] {
  // Type A: JSON 기반 연속 패턴 먼저 적용
  const afterSequence = applySequencePatterns(tokens);
  // Type B: 문법 조건 규칙 적용
  return applyTypeBRules(afterSequence);
}
