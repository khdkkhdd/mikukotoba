import type { TranslationContext } from '@/types';
import type { LLMClient } from './llm-client';
import { buildPrompt, buildSystemPrompt } from './prompt-builder';
import { createLogger } from '@/core/logger';
import { apiFetch } from './api-fetch';

const log = createLogger('Gemini');
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

interface GeminiPart {
  text?: string;
  thought?: boolean;
  thoughtSignature?: string;
}

interface GeminiResponse {
  candidates: Array<{
    content: { parts: GeminiPart[]; role: string };
    finishReason: string;
  }>;
  usageMetadata: { promptTokenCount: number; candidatesTokenCount: number; totalTokenCount: number };
}

/**
 * Extract the actual response text from Gemini parts.
 * Gemini 3+ models include thinking parts (thought: true) in the response.
 * We need to find the non-thought text part.
 */
function extractResponseText(parts: GeminiPart[]): string | undefined {
  // Find the last non-thought text part
  for (let i = parts.length - 1; i >= 0; i--) {
    const part = parts[i];
    if (part.text && !part.thought && !part.thoughtSignature) {
      return part.text.trim();
    }
  }
  // Fallback: return any text part
  for (const part of parts) {
    if (part.text) {
      return part.text.trim();
    }
  }
  return undefined;
}

export class GeminiClient implements LLMClient {
  private apiKey: string = '';
  private model: string = 'gemini-2.5-flash';

  configure(apiKey: string): void {
    this.apiKey = apiKey;
  }

  setModel(model: string): void {
    this.model = model;
  }

  isConfigured(): boolean {
    return !!this.apiKey;
  }

  private getEndpoint(): string {
    return `${GEMINI_API_BASE}/${this.model}:generateContent`;
  }

  async translate(text: string, context: TranslationContext): Promise<string> {
    if (!this.isConfigured()) {
      throw new Error('Gemini API key not configured');
    }

    const systemPrompt = buildSystemPrompt(context);
    const userMessage = buildPrompt(text, context);

    let lastError: Error | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        log.debug(`Attempt ${attempt + 1}/3, model=${this.model}`);
        const t0 = Date.now();
        const response = await apiFetch(this.getEndpoint(), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': this.apiKey,
          },
          body: JSON.stringify({
            systemInstruction: {
              parts: [{ text: systemPrompt }],
            },
            contents: [
              {
                role: 'user',
                parts: [{ text: userMessage }],
              },
            ],
            generationConfig: {
              maxOutputTokens: 4096,
              // Minimize thinking for Gemini 3+ (which uses thinking by default)
              ...(this.model.startsWith('gemini-3') && {
                thinkingConfig: { thinkingLevel: 'minimal' },
              }),
            },
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
          throw new Error(`Gemini API error: ${response.status} ${errorText}`);
        }

        const data: GeminiResponse = await response.json();
        const parts = data.candidates[0]?.content?.parts || [];
        const translatedText = extractResponseText(parts);
        if (!translatedText) {
          throw new Error('Empty response from Gemini');
        }

        if (data.candidates[0]?.finishReason === 'MAX_TOKENS') {
          log.warn(`Translation truncated (hit maxOutputTokens), in=${data.usageMetadata.promptTokenCount} out=${data.usageMetadata.candidatesTokenCount}`);
        }
        log.debug(`Success: ${Date.now() - t0}ms, tokens: in=${data.usageMetadata.promptTokenCount} out=${data.usageMetadata.candidatesTokenCount}`);
        return translatedText;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < 2) {
          const delay = Math.pow(2, attempt) * 1000;
          await new Promise((r) => setTimeout(r, delay));
        }
      }
    }

    throw lastError || new Error('Gemini translation failed');
  }

  async testConnection(apiKey: string): Promise<boolean> {
    const prevKey = this.apiKey;
    this.configure(apiKey);
    try {
      const response = await fetch(this.getEndpoint(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [{ text: '「テスト」を韓国語に翻訳してください。翻訳のみ出力。' }],
            },
          ],
          generationConfig: {
            maxOutputTokens: 64,
            ...(this.model.startsWith('gemini-3') && {
              thinkingConfig: { thinkingLevel: 'minimal' },
            }),
          },
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

export const geminiClient = new GeminiClient();
