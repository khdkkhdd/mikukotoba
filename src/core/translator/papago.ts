import { createLogger } from '@/core/logger';
import { apiFetch } from './api-fetch';

const log = createLogger('Papago');
const PAPAGO_API_URL = 'https://papago.apigw.ntruss.com/nmt/v1/translation';

interface PapagoResponse {
  message: {
    result: {
      translatedText: string;
      srcLangType: string;
      tarLangType: string;
    };
  };
}

export class PapagoClient {
  private clientId: string = '';
  private clientSecret: string = '';

  configure(clientId: string, clientSecret: string): void {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
  }

  isConfigured(): boolean {
    return !!(this.clientId && this.clientSecret);
  }

  async translate(text: string): Promise<string> {
    if (!this.isConfigured()) {
      throw new Error('Papago API keys not configured');
    }

    let lastError: Error | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        log.debug(`Attempt ${attempt + 1}/3`);
        const t0 = Date.now();
        const response = await apiFetch(PAPAGO_API_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'X-NCP-APIGW-API-KEY-ID': this.clientId,
            'X-NCP-APIGW-API-KEY': this.clientSecret,
          },
          body: new URLSearchParams({
            source: 'ja',
            target: 'ko',
            text,
          }).toString(),
        });

        if (response.status === 429) {
          const delay = Math.pow(2, attempt) * 1000;
          log.warn(`429 rate limited, attempt ${attempt + 1}/3, waiting ${delay}ms`);
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }

        if (!response.ok) {
          const errorBody = await response.text().catch(() => '');
          log.error(`HTTP ${response.status}, attempt ${attempt + 1}/3:`, errorBody || response.statusText);
          throw new Error(`Papago API error: ${response.status} ${errorBody || response.statusText}`);
        }

        const data: PapagoResponse = await response.json();
        log.debug(`Success: ${Date.now() - t0}ms`);
        return data.message.result.translatedText;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < 2) {
          const delay = Math.pow(2, attempt) * 1000;
          await new Promise((r) => setTimeout(r, delay));
        }
      }
    }

    throw lastError || new Error('Papago translation failed');
  }

  async testConnection(clientId: string, clientSecret: string): Promise<{ success: boolean; error?: string }> {
    const prevId = this.clientId;
    const prevSecret = this.clientSecret;
    this.configure(clientId, clientSecret);
    try {
      await this.translate('テスト');
      return { success: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error('Test connection failed:', msg);
      return { success: false, error: msg };
    } finally {
      this.clientId = prevId;
      this.clientSecret = prevSecret;
    }
  }
}

export const papagoClient = new PapagoClient();
