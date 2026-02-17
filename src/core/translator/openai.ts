import type { TranslationContext } from '@/types';
import type { LLMClient } from './llm-client';
import { buildPrompt, buildSystemPrompt } from './prompt-builder';
import { createLogger } from '@/core/logger';
import { apiFetch } from './api-fetch';

const log = createLogger('OpenAI');
const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';

interface OpenAIResponse {
  choices: Array<{
    message: { role: string; content: string };
    finish_reason: string;
  }>;
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

export class OpenAIClient implements LLMClient {
  private apiKey: string = '';
  private model: string = 'gpt-4o';

  configure(apiKey: string): void {
    this.apiKey = apiKey;
  }

  setModel(model: string): void {
    this.model = model;
  }

  isConfigured(): boolean {
    return !!this.apiKey;
  }

  async translate(text: string, context: TranslationContext): Promise<string> {
    if (!this.isConfigured()) {
      throw new Error('OpenAI API key not configured');
    }

    const systemPrompt = buildSystemPrompt(context);
    const userMessage = buildPrompt(text, context);

    let lastError: Error | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        log.debug(`Attempt ${attempt + 1}/3, model=${this.model}`);
        const t0 = Date.now();
        const response = await apiFetch(OPENAI_API_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify({
            model: this.model,
            max_tokens: 4096,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userMessage },
            ],
          }),
        });

        if (response.status === 429) {
          const delay = Math.pow(2, attempt) * 1000;
          log.warn(`429 rate limited, attempt ${attempt + 1}/3, waiting ${delay}ms`);
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }

        if (!response.ok) {
          const errorText = await response.text();
          log.error(`HTTP ${response.status}, attempt ${attempt + 1}/3:`, errorText.slice(0, 200));
          throw new Error(`OpenAI API error: ${response.status} ${errorText}`);
        }

        const data: OpenAIResponse = await response.json();
        const translatedText = data.choices[0]?.message?.content?.trim();
        if (!translatedText) {
          throw new Error('Empty response from OpenAI');
        }

        if (data.choices[0]?.finish_reason === 'length') {
          log.warn(`Translation truncated (hit max_tokens), in=${data.usage.prompt_tokens} out=${data.usage.completion_tokens}`);
        }
        log.debug(`Success: ${Date.now() - t0}ms, tokens: in=${data.usage.prompt_tokens} out=${data.usage.completion_tokens}`);
        return translatedText;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < 2) {
          const delay = Math.pow(2, attempt) * 1000;
          await new Promise((r) => setTimeout(r, delay));
        }
      }
    }

    throw lastError || new Error('OpenAI translation failed');
  }

  async testConnection(apiKey: string): Promise<boolean> {
    const prevKey = this.apiKey;
    this.configure(apiKey);
    try {
      const response = await fetch(OPENAI_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: 64,
          messages: [
            { role: 'user', content: '「テスト」を韓国語に翻訳してください。翻訳のみ出力。' },
          ],
        }),
      });
      return response.ok;
    } catch {
      return false;
    } finally {
      this.apiKey = prevKey;
    }
  }
}

export const openaiClient = new OpenAIClient();
