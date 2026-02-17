import type { TranslationResult } from '@/types';

export function formatEngineBadge(result: TranslationResult): string {
  return result.fromCache ? `${result.engine} cache` : result.engine;
}

export function formatEngineBadgeWithRetry(result: TranslationResult, prefix: string): string {
  return `${formatEngineBadge(result)} <span class="${prefix}-retry-btn" title="LLM으로 재번역">↻</span>`;
}
