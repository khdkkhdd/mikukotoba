import type { LLMPlatform, ModelOption } from '@/types';
import type { LLMClient } from './llm-client';
import { ClaudeClient } from './claude';
import { OpenAIClient } from './openai';
import { GeminiClient } from './gemini';

// 플랫폼별 선택 가능한 모델 목록
export const MODEL_OPTIONS: ModelOption[] = [
  // Claude
  { id: 'claude-opus-4-6', name: 'Opus 4.6 ($5/$25) — 최고 성능', platform: 'claude' },
  { id: 'claude-sonnet-4-5-20250929', name: 'Sonnet 4.5 ($3/$15) — 균형형', platform: 'claude' },
  { id: 'claude-haiku-4-5-20251001', name: 'Haiku 4.5 ($1/$5) — 최고 속도', platform: 'claude' },

  // OpenAI
  { id: 'gpt-4.1-nano', name: 'GPT-4.1 Nano ($0.10/$0.40) — 최저가', platform: 'openai' },
  { id: 'gpt-4.1-mini', name: 'GPT-4.1 Mini ($0.40/$1.60) — 경량', platform: 'openai' },
  { id: 'gpt-4.1', name: 'GPT-4.1 ($2/$8) — 코딩 특화', platform: 'openai' },
  { id: 'gpt-4o', name: 'GPT-4o ($2.50/$10) — 범용', platform: 'openai' },
  { id: 'gpt-4o-mini', name: 'GPT-4o Mini ($0.15/$0.60) — 경량 범용', platform: 'openai' },
  { id: 'gpt-5-mini', name: 'GPT-5 Mini ($0.25/$2) — 차세대 경량', platform: 'openai' },
  { id: 'gpt-5', name: 'GPT-5 ($1.25/$10) — 차세대 플래그십', platform: 'openai' },

  // Gemini
  { id: 'gemini-2.5-flash', name: '2.5 Flash (Stable) — 1M 컨텍스트', platform: 'gemini' },
  { id: 'gemini-2.5-flash-lite', name: '2.5 Flash Lite (최저가) — 1M 컨텍스트', platform: 'gemini' },
  { id: 'gemini-2.5-pro', name: '2.5 Pro (Stable) — 1M 컨텍스트', platform: 'gemini' },
  { id: 'gemini-3-flash-preview', name: '3 Flash (Preview) — 1M 컨텍스트', platform: 'gemini' },
  { id: 'gemini-3-pro-preview', name: '3 Pro (Preview) — 1M 컨텍스트', platform: 'gemini' },
];

export function getModelsForPlatform(platform: LLMPlatform): ModelOption[] {
  return MODEL_OPTIONS.filter((m) => m.platform === platform);
}

export class LLMRegistry {
  private clients: Record<LLMPlatform, LLMClient> = {
    claude: new ClaudeClient(),
    openai: new OpenAIClient(),
    gemini: new GeminiClient(),
  };

  getClient(platform: LLMPlatform): LLMClient {
    return this.clients[platform];
  }

  configureAll(keys: { claudeApiKey: string; openaiApiKey: string; geminiApiKey: string }): void {
    this.clients.claude.configure(keys.claudeApiKey);
    this.clients.openai.configure(keys.openaiApiKey);
    this.clients.gemini.configure(keys.geminiApiKey);
  }

  setModel(platform: LLMPlatform, model: string): void {
    this.clients[platform].setModel(model);
  }
}
