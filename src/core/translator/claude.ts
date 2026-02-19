import type { TranslationContext, LearningLevel } from '@/types';
import type { LLMClient } from './llm-client';
import { buildPrompt, buildSystemPrompt } from './prompt-builder';
import { createLogger } from '@/core/logger';
import { apiFetch } from './api-fetch';

const log = createLogger('Claude');
const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';

interface ClaudeMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface ClaudeResponse {
  content: Array<{ type: 'text'; text: string }>;
  usage: { input_tokens: number; output_tokens: number };
  stop_reason: string;
}

export class ClaudeClient implements LLMClient {
  private apiKey: string = '';
  private model: string = 'claude-sonnet-4-5-20250929';

  configure(apiKey: string): void {
    this.apiKey = apiKey;
  }

  setModel(model: string): void {
    this.model = model;
  }

  isConfigured(): boolean {
    return !!this.apiKey;
  }

  async translate(text: string, context: TranslationContext, level?: LearningLevel): Promise<string> {
    if (!this.isConfigured()) {
      throw new Error('Claude API key not configured');
    }

    const systemPrompt = buildSystemPrompt(context, level);
    const userMessage = buildPrompt(text, context);

    let lastError: Error | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        log.debug(`Attempt ${attempt + 1}/3, model=${this.model}`);
        const t0 = Date.now();
        const response = await apiFetch(CLAUDE_API_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': this.apiKey,
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true',
          },
          body: JSON.stringify({
            model: this.model,
            max_tokens: 4096,
            system: systemPrompt,
            messages: [{ role: 'user', content: userMessage }] as ClaudeMessage[],
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
          throw new Error(`Claude API error: ${response.status} ${errorText}`);
        }

        const data: ClaudeResponse = await response.json();
        const translatedText = data.content[0]?.text?.trim();
        if (!translatedText) {
          throw new Error('Empty response from Claude');
        }

        if (data.stop_reason === 'max_tokens') {
          log.warn(`Translation truncated (hit max_tokens), in=${data.usage.input_tokens} out=${data.usage.output_tokens}`);
        }
        log.debug(`Success: ${Date.now() - t0}ms, tokens: in=${data.usage.input_tokens} out=${data.usage.output_tokens}`);
        return translatedText;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < 2) {
          const delay = Math.pow(2, attempt) * 1000;
          await new Promise((r) => setTimeout(r, delay));
        }
      }
    }

    throw lastError || new Error('Claude translation failed');
  }

  async testConnection(apiKey: string): Promise<boolean> {
    const prevKey = this.apiKey;
    this.configure(apiKey);
    try {
      const response = await fetch(CLAUDE_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: 64,
          messages: [{ role: 'user', content: '「テスト」を韓国語に翻訳してください。翻訳のみ出力。' }],
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

export const claudeClient = new ClaudeClient();
