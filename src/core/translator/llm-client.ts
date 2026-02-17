import type { TranslationContext } from '@/types';

export interface LLMClient {
  configure(apiKey: string): void;
  setModel(model: string): void;
  isConfigured(): boolean;
  translate(text: string, context: TranslationContext): Promise<string>;
  testConnection(apiKey: string): Promise<boolean>;
}
