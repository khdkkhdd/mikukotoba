import type { MorphemeToken, ComplexityAssessment, ComplexityFactors } from '@/types';

// 상용한자 2136자 범위 외 판정을 위한 간이 체크
// 실제로는 상용한자 리스트와 비교해야 하지만, 여기서는 JIS 제1수준 범위를 기준으로 함
const COMMON_KANJI_RANGE = /[\u4E00-\u9FFF]/;
const RARE_KANJI_THRESHOLD = 0x9FFF; // Simplified: beyond CJK Unified range

// 경어 패턴
const KEIGO_PATTERNS = [
  /お.+になる/, /ご.+になる/,   // 尊敬語: お〜になる
  /いただ[きくけ]/,             // 謙譲語: いただく
  /くださ[いりる]/,             // 尊敬語: くださる
  /存じ/,                       // 謙譲語: 存じる
  /申[しす]/,                   // 謙譲語: 申す
  /参[りる]/,                   // 謙譲語: 参る
  /おっしゃ/,                   // 尊敬語: おっしゃる
  /いらっしゃ/,                 // 尊敬語: いらっしゃる
  /なさ[いりる]/,               // 尊敬語: なさる
  /ございま/,                   // 丁重語: ございます
  /させていただ/,               // 謙譲語: させていただく
  /お目にかか/,                 // 謙譲語: お目にかかる
  /拝[見聴読]/,                 // 謙譲語: 拝見etc
  /承[りる]/,                   // 謙譲語: 承る
];

// 의태어/의성어 패턴 (カタカナ 반복)
const ONOMATOPOEIA_REGEX = /([ァ-ヶー]{2,})\1|([ぁ-ん]{2,})\2/;
const COMMON_ONOMATOPOEIA = [
  'ドキドキ', 'ワクワク', 'キラキラ', 'ニコニコ', 'イライラ',
  'ぐるぐる', 'ふわふわ', 'ぴかぴか', 'ぶるぶる', 'がたがた',
  'そわそわ', 'ぼんやり', 'すっきり', 'しっかり', 'ゆっくり',
  'ばたばた', 'ぎりぎり', 'のろのろ', 'さらさら', 'ざわざわ',
  'ぺらぺら', 'ぼろぼろ', 'めちゃくちゃ', 'ごちゃごちゃ',
];

// 관용구 리스트
const IDIOMS = [
  '気になる', '気にする', '気がする', '気を付ける',
  '手に入れる', '手を出す', '手がかかる',
  '目に見える', '目を通す', '目が回る',
  '足を引っ張る', '足を運ぶ',
  '腹が立つ', '頭にくる', '頭が痛い',
  '顔を出す', '顔が広い',
  '口を出す', '口が堅い', '口が上手い',
  '首を突っ込む', '首を長くする',
  '肩を持つ', '肩の荷が下りる',
  '耳が痛い', '耳にする',
  '心がける', '心を込める',
  '力を入れる', '力になる',
  '間に合う', '間違いない',
  '仕方がない', 'しょうがない',
  '当たり前', '当然',
  'まさか', 'やっぱり', 'さすが',
  'なるほど', 'もったいない',
];

export function assessComplexity(
  tokens: MorphemeToken[],
  text: string,
  threshold: number,
  weights: { keigo: number; length: number; idiom: number } = { keigo: 3, length: 1, idiom: 2 }
): ComplexityAssessment {
  let score = 0;

  // (1) 문장 길이
  const lengthScore = computeLengthScore(text);
  score += lengthScore * weights.length;

  // (2) 경어 감지
  const hasKeigo = detectKeigo(tokens, text);
  if (hasKeigo) score += weights.keigo;

  // (3) 의태어/의성어 감지
  const hasOnomatopoeia = detectOnomatopoeia(tokens, text);
  if (hasOnomatopoeia) score += 1;

  // (4) 관용구 감지
  const hasIdiom = detectIdiom(text);
  if (hasIdiom) score += weights.idiom;

  // (5) 주어 생략 추정
  const subjectOmitted = detectSubjectOmission(tokens);
  if (subjectOmitted) score += 1;

  // (6) 희귀 한자
  const rareKanji = detectRareKanji(text);
  if (rareKanji) score += 1;

  score = Math.min(score, 10);

  const factors: ComplexityFactors = {
    length: lengthScore,
    hasKeigo,
    hasOnomatopoeia,
    hasIdiom,
    subjectOmitted,
    rareKanji,
  };

  return {
    score,
    factors,
    recommendation: score >= threshold ? 'llm' : 'papago',
  };
}

function computeLengthScore(text: string): number {
  const len = text.length;
  if (len >= 90) return 3;
  if (len >= 60) return 2;
  if (len >= 30) return 1;
  return 0;
}

function detectKeigo(tokens: MorphemeToken[], text: string): boolean {
  // Check reading/surface for keigo patterns
  const fullReading = tokens.map((t) => t.reading).join('');
  const fullSurface = tokens.map((t) => t.surface).join('');

  for (const pattern of KEIGO_PATTERNS) {
    if (pattern.test(fullReading) || pattern.test(fullSurface) || pattern.test(text)) {
      return true;
    }
  }

  return false;
}

function detectOnomatopoeia(tokens: MorphemeToken[], text: string): boolean {
  // Check for common onomatopoeia
  for (const ono of COMMON_ONOMATOPOEIA) {
    if (text.includes(ono)) return true;
  }
  // Check for repeating katakana patterns
  if (ONOMATOPOEIA_REGEX.test(text)) return true;

  // Check token POS for 副詞 (adverb) with katakana
  for (const token of tokens) {
    if (token.pos === '副詞' && /^[ァ-ヶー]+$/.test(token.surface)) {
      return true;
    }
  }

  return false;
}

function detectIdiom(text: string): boolean {
  for (const idiom of IDIOMS) {
    if (text.includes(idiom)) return true;
  }
  return false;
}

function detectSubjectOmission(tokens: MorphemeToken[]): boolean {
  // Check if there's a verb but no subject particle (が/は)
  const hasVerb = tokens.some((t) => t.pos === '動詞');
  const hasSubjectParticle = tokens.some(
    (t) => t.pos === '助詞' && (t.surface === 'が' || t.surface === 'は')
  );

  return hasVerb && !hasSubjectParticle;
}

function detectRareKanji(text: string): boolean {
  // Check for kanji outside the common JIS level 1 range
  // This is a simplified check — a full implementation would use the 常用漢字 list
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    if (code >= 0x4E00 && code <= 0x9FFF) {
      // Check against a simplified "rare" heuristic:
      // Characters above 0x9000 are less common
      if (code >= 0x9800) return true;
    }
  }
  return false;
}
