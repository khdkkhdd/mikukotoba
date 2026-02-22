import type { MorphemeToken } from '@/types';
import type { LLMClient } from '@/core/translator/llm-client';
import { hiraganaToRomaji } from './reading-overrides';
import { createLogger } from '@/core/logger';

const log = createLogger('ReadingLLM');

/**
 * 선별적 LLM 읽기 보정: P1~P3으로 해결되지 않은 다독음 한자만 LLM에 검증 요청.
 * - 다독음 한자가 없으면 LLM 호출 0
 * - 캐시 히트시 LLM 호출 0
 * - 호출 시 입출력 ~70토큰 (매우 저렴)
 */

// 다독음 한자 목록: 문맥에 따라 읽기가 크게 달라지는 한자
const AMBIGUOUS_KANJI = new Set([
  '生', '行', '上', '下', '中', '間', '日', '月',
  '風', '方', '物', '気', '前', '後', '人', '何',
  '分', '切', '重', '開', '明', '正', '通', '手',
]);

function hasAmbiguousKanji(surface: string): boolean {
  for (const ch of surface) {
    if (AMBIGUOUS_KANJI.has(ch)) return true;
  }
  return false;
}

// 캐시 키: surface + 주변 2토큰 해시
function buildCacheKey(tokens: MorphemeToken[], indices: number[]): string {
  const parts = indices.map(i => {
    const prev = i > 0 ? tokens[i - 1].surface : '^';
    const next = i < tokens.length - 1 ? tokens[i + 1].surface : '$';
    return `${prev}|${tokens[i].surface}|${next}`;
  });
  return parts.join('_');
}

async function getReadingCache(key: string): Promise<Record<number, string> | null> {
  try {
    const storageKey = `jp_reading_${simpleHash(key)}`;
    const data = await chrome.storage.local.get(storageKey);
    if (!data[storageKey]) return null;
    const cached = data[storageKey] as { corrections: Record<number, string>; ts: number };
    // 90일 만료
    if (Date.now() - cached.ts > 90 * 24 * 60 * 60 * 1000) return null;
    return cached.corrections;
  } catch {
    return null;
  }
}

async function setReadingCache(key: string, corrections: Record<number, string>): Promise<void> {
  try {
    const storageKey = `jp_reading_${simpleHash(key)}`;
    await chrome.storage.local.set({
      [storageKey]: { corrections, ts: Date.now() },
    });
  } catch {
    // storage error — 무시
  }
}

function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    hash = ((hash << 5) - hash + ch) | 0;
  }
  return (hash >>> 0).toString(36);
}

function applyCorrections(tokens: MorphemeToken[], corrections: Record<number, string>): MorphemeToken[] {
  return tokens.map((token, i) => {
    const corrected = corrections[i];
    if (!corrected || corrected === token.reading) return token;
    return {
      ...token,
      reading: corrected,
      romaji: hiraganaToRomaji(corrected),
    };
  });
}

async function requestReadingCorrection(
  tokens: MorphemeToken[],
  fullText: string,
  ambiguousIndices: number[],
  llmClient: LLMClient,
): Promise<Record<number, string>> {
  // 프롬프트 구성 (토큰 절약형)
  const items = ambiguousIndices.map((idx, i) =>
    `${i + 1}. ${tokens[idx].surface}(${tokens[idx].reading})`
  ).join(' ');

  const prompt = `以下の文の漢字の読みを確認してください。
文:「${fullText}」
確認対象: ${items}
正しい読みをひらがなで番号順に出力: 1.読み 2.読み ...`;

  try {
    const response = await llmClient.translate(prompt, { previousSentences: [] });
    return parseReadingResponse(response, ambiguousIndices);
  } catch (err) {
    log.warn('LLM reading correction failed:', err);
    return {};
  }
}

function parseReadingResponse(response: string, indices: number[]): Record<number, string> {
  const corrections: Record<number, string> = {};
  // "1.きょう 2.おとな" 또는 "1. きょう 2. おとな" 형식 파싱
  const pattern = /(\d+)\.\s*([ぁ-ん]+)/g;
  let match;
  while ((match = pattern.exec(response)) !== null) {
    const num = parseInt(match[1], 10);
    const reading = match[2];
    if (num >= 1 && num <= indices.length) {
      corrections[indices[num - 1]] = reading;
    }
  }
  return corrections;
}

export async function correctReadingsIfNeeded(
  tokens: MorphemeToken[],
  fullText: string,
  llmClient: LLMClient,
): Promise<MorphemeToken[]> {
  const ambiguousIndices = tokens
    .map((t, i) => i)
    .filter(i => tokens[i].isKanji && hasAmbiguousKanji(tokens[i].surface));

  if (ambiguousIndices.length === 0) return tokens;

  // 캐시 확인
  const cacheKey = buildCacheKey(tokens, ambiguousIndices);
  const cached = await getReadingCache(cacheKey);
  if (cached) {
    log.debug('Reading cache HIT:', cacheKey.slice(0, 30));
    return applyCorrections(tokens, cached);
  }

  // LLM 요청
  log.debug('LLM reading request:', ambiguousIndices.length, 'targets');
  const corrections = await requestReadingCorrection(tokens, fullText, ambiguousIndices, llmClient);
  if (Object.keys(corrections).length > 0) {
    await setReadingCache(cacheKey, corrections);
  }
  return applyCorrections(tokens, corrections);
}
