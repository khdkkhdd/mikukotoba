import type { TranslationResult, MorphemeToken, UserSettings, UserCorrection, LLMPlatform } from '@/types';
import { MorphologicalAnalyzer } from '@/core/analyzer/morphological';
import { PapagoClient } from './papago';
import { LLMRegistry } from './llm-registry';
import { ContextManager } from './context-manager';
import { assessComplexity } from './complexity';
import { TranslationCache } from '@/core/cache';
import { GlossaryManager } from '@/core/glossary';
import { createLogger } from '@/core/logger';

const log = createLogger('Translator');

export class Translator {
  private analyzer: MorphologicalAnalyzer;
  private papago: PapagoClient;
  private llmRegistry: LLMRegistry;
  private activePlatform: LLMPlatform = 'claude';
  private contextManager: ContextManager;
  private cache: TranslationCache;
  private glossary: GlossaryManager;
  private settings: UserSettings | null = null;
  private userCorrections: UserCorrection[] = [];

  // Complexity feedback: scores of retranslated texts (used to adjust threshold)
  private retranslateScores: number[] = [];
  private readonly RETRANSLATE_HISTORY_SIZE = 20;

  // Concurrency control
  private pendingRequests = 0;
  private readonly maxConcurrent = 3;
  private readonly maxQueueSize = 100;
  private queue: Array<{
    text: string;
    options?: { skipCache?: boolean; forceLLM?: boolean };
    resolve: (result: TranslationResult) => void;
    reject: (error: Error) => void;
  }> = [];

  // In-flight dedup: map of normalized text → pending promise
  private inflight = new Map<string, Promise<TranslationResult>>();

  constructor() {
    this.analyzer = new MorphologicalAnalyzer();
    this.papago = new PapagoClient();
    this.llmRegistry = new LLMRegistry();
    this.contextManager = new ContextManager();
    this.cache = new TranslationCache();
    this.glossary = new GlossaryManager();
  }

  async init(): Promise<void> {
    await Promise.all([
      this.analyzer.init(),
      this.glossary.load(),
    ]);
  }

  configure(settings: UserSettings): void {
    this.settings = settings;
    this.papago.configure(settings.papagoClientId, settings.papagoClientSecret);
    this.llmRegistry.configureAll({
      claudeApiKey: settings.claudeApiKey,
      openaiApiKey: settings.openaiApiKey,
      geminiApiKey: settings.geminiApiKey,
    });
    this.activePlatform = settings.llmPlatform;
    this.llmRegistry.setModel(settings.llmPlatform, settings.llmModel);
    this.contextManager.setMaxSize(settings.contextWindowSize);
  }

  setMetadata(meta: { title?: string; channel?: string }): void {
    this.contextManager.setMetadata(meta);
  }

  setUserCorrections(corrections: UserCorrection[]): void {
    this.userCorrections = corrections;
    this.contextManager.setUserCorrections(corrections);
  }

  clearContext(): void {
    this.contextManager.clear();
  }

  async translate(text: string): Promise<TranslationResult> {
    return this.enqueue(text);
  }

  async retranslate(text: string): Promise<TranslationResult> {
    const normalized = normalizeSpacedJapanese(text);
    const source = this.getCacheSource();

    // Record complexity score for feedback learning
    const cached = await this.cache.get(normalized, source);
    if (cached && cached.complexityScore !== undefined) {
      this.recordRetranslateScore(cached.complexityScore);
    }

    await this.cache.delete(normalized, source);
    return this.enqueue(text, { skipCache: true, forceLLM: true });
  }

  /**
   * Record the complexity score of a retranslated text.
   * If enough retranslates happen at scores below the threshold,
   * it suggests the threshold should be lowered.
   */
  private recordRetranslateScore(score: number): void {
    this.retranslateScores.push(score);
    if (this.retranslateScores.length > this.RETRANSLATE_HISTORY_SIZE) {
      this.retranslateScores.shift();
    }

    // Adjust threshold if we have enough data
    if (this.retranslateScores.length >= 5 && this.settings) {
      const threshold = this.settings.complexityThreshold;
      const belowThreshold = this.retranslateScores.filter(s => s < threshold);
      // If >60% of retranslates were below threshold, nudge threshold down
      if (belowThreshold.length / this.retranslateScores.length > 0.6) {
        const avgScore = belowThreshold.reduce((a, b) => a + b, 0) / belowThreshold.length;
        const newThreshold = Math.max(1, Math.round(avgScore));
        if (newThreshold < threshold) {
          log.info('Complexity threshold adjusted:', threshold, '→', newThreshold,
            `(${belowThreshold.length}/${this.retranslateScores.length} retranslates below threshold)`);
          this.settings.complexityThreshold = newThreshold;
        }
      }
    }
  }

  private enqueue(text: string, options?: { skipCache?: boolean; forceLLM?: boolean }): Promise<TranslationResult> {
    const shortText = text.length > 30 ? text.slice(0, 30) + '…' : text;
    const normalized = normalizeSpacedJapanese(text);

    // In-flight dedup: if same text is already being translated, reuse the promise
    if (!options?.skipCache) {
      const existing = this.inflight.get(normalized);
      if (existing) {
        log.debug('Dedup HIT:', shortText);
        return existing.then(r => ({ ...r, original: text }));
      }
    }

    // Concurrency control
    if (this.pendingRequests >= this.maxConcurrent) {
      // Reject oldest requests when queue is full
      while (this.queue.length >= this.maxQueueSize) {
        const oldest = this.queue.shift()!;
        oldest.reject(new Error('Translation queue full — request dropped'));
      }
      log.debug('Queued:', shortText, `pending=${this.pendingRequests}, queued=${this.queue.length}`);
      return new Promise((resolve, reject) => {
        this.queue.push({ text, options, resolve, reject });
      });
    }

    log.debug('Immediate:', shortText, `pending=${this.pendingRequests}`);
    this.pendingRequests++;
    const promise = this.doTranslate(text, options)
      .finally(() => {
        this.pendingRequests--;
        this.inflight.delete(normalized);
        this.processQueue();
      });

    if (!options?.skipCache) {
      this.inflight.set(normalized, promise);
    }
    return promise;
  }

  private processQueue(): void {
    if (this.queue.length === 0 || this.pendingRequests >= this.maxConcurrent) return;

    const next = this.queue.shift()!;
    this.pendingRequests++;
    this.doTranslate(next.text, next.options)
      .then(next.resolve)
      .catch(next.reject)
      .finally(() => {
        this.pendingRequests--;
        this.processQueue();
      });
  }

  /** Get current source identifier for context-aware caching */
  private getCacheSource(): string | undefined {
    try {
      return typeof location !== 'undefined' ? location.hostname : undefined;
    } catch {
      return undefined;
    }
  }

  private async doTranslate(
    text: string,
    opts?: { skipCache?: boolean; forceLLM?: boolean },
  ): Promise<TranslationResult> {
    // Normalize spaced Japanese (manga/anime emphasis: だ か ら → だから)
    const normalized = normalizeSpacedJapanese(text);
    if (normalized !== text) {
      log.debug('Normalized spaced JP:', text.slice(0, 30), '→', normalized.slice(0, 30));
    }
    const workText = normalized;
    const shortText = workText.length > 30 ? workText.slice(0, 30) + '…' : workText;
    const t0 = Date.now();
    const cacheSource = this.getCacheSource();

    // 1. Cache check
    if (!opts?.skipCache) {
      const cached = await this.cache.get(workText, cacheSource);
      if (cached) {
        log.debug('Cache HIT:', shortText);
        return { ...cached, original: text, fromCache: true };
      }
    }
    log.debug(opts?.skipCache ? 'Cache SKIP (retranslate):' : 'Cache MISS:', shortText);

    // 2. Morphological analysis
    let tokens: MorphemeToken[];
    try {
      tokens = await this.analyzer.analyze(workText);
      log.debug('Morpho done:', tokens.length, 'tokens');
    } catch {
      log.warn('Morpho failed, using fallback token');
      tokens = [{
        surface: workText,
        reading: workText,
        romaji: workText,
        pos: '不明',
        baseForm: workText,
        isKanji: false,
      }];
    }

    // 3. Complexity assessment
    const threshold = this.settings?.complexityThreshold ?? 5;
    const weights = {
      keigo: this.settings?.keigoWeight ?? 3,
      length: this.settings?.lengthWeight ?? 1,
      idiom: this.settings?.idiomWeight ?? 2,
    };
    const complexity = assessComplexity(tokens, workText, threshold, weights);
    log.debug('Complexity:', `score=${complexity.score}`, `rec=${complexity.recommendation}`);

    // 4. Get relevant glossary entries
    const relevantGlossary = this.glossary.getRelevantEntries(workText);
    this.contextManager.setGlossary(relevantGlossary);

    // Get relevant user corrections
    const relevantCorrections = this.userCorrections.filter(
      (c) => workText.includes(c.original) || c.original.includes(workText)
    );
    if (relevantCorrections.length > 0) {
      this.contextManager.setUserCorrections(relevantCorrections);
    }

    // 5. Engine selection and translation
    let korean: string;
    let engine: 'papago' | LLMPlatform;

    const llmClient = this.llmRegistry.getClient(this.activePlatform);
    const preferLLM = opts?.forceLLM || complexity.recommendation === 'llm';
    log.debug('Engine selection:', `platform=${this.activePlatform}`, `llmConfigured=${llmClient.isConfigured()}`, `papagoConfigured=${this.papago.isConfigured()}`, opts?.forceLLM ? 'forceLLM' : '');

    if (preferLLM && llmClient.isConfigured()) {
      try {
        const context = this.contextManager.getContext();
        korean = await llmClient.translate(workText, context, this.settings?.learningLevel);
        engine = this.activePlatform;
      } catch (err) {
        log.warn(`FAIL [${this.activePlatform}]:`, shortText, err);
        // Fallback to Papago
        if (this.papago.isConfigured()) {
          log.info('Fallback:', this.activePlatform, '→ papago');
          korean = await this.papago.translate(workText);
          engine = 'papago';
        } else {
          log.error('NO FALLBACK:', shortText, '— no Papago configured');
          throw new Error('Translation failed: no available engine');
        }
      }
    } else if (this.papago.isConfigured()) {
      try {
        korean = await this.papago.translate(workText);
        engine = 'papago';
      } catch (err) {
        log.warn('FAIL [papago]:', shortText, err);
        // Fallback to LLM if available
        if (llmClient.isConfigured()) {
          log.info('Fallback: papago →', this.activePlatform);
          const context = this.contextManager.getContext();
          korean = await llmClient.translate(workText, context, this.settings?.learningLevel);
          engine = this.activePlatform;
        } else {
          log.error('NO FALLBACK:', shortText, '— no LLM configured');
          throw new Error('Translation failed: no available engine');
        }
      }
    } else if (llmClient.isConfigured()) {
      const context = this.contextManager.getContext();
      korean = await llmClient.translate(workText, context, this.settings?.learningLevel);
      engine = this.activePlatform;
    } else {
      log.error('No translation API configured');
      throw new Error('No translation API configured');
    }

    log.debug('Translated:', shortText, `engine=${engine}`, `${Date.now() - t0}ms`);

    // 6. Apply glossary post-processing
    korean = this.glossary.apply(korean, workText);

    // 7. Build result (original keeps the raw input text)
    const result: TranslationResult = {
      original: text,
      tokens,
      korean,
      engine,
      complexityScore: complexity.score,
      fromCache: false,
    };

    // 8. Cache result (keyed by normalized text)
    await this.cache.set(workText, result, cacheSource);
    log.debug('Cached:', shortText);

    // 9. Update context window
    this.contextManager.push(workText);

    return result;
  }

  // Expose sub-components for testing/direct access
  getPapagoClient(): PapagoClient { return this.papago; }
  getLLMClient(): LLMRegistry { return this.llmRegistry; }
  getCache(): TranslationCache { return this.cache; }
  getGlossary(): GlossaryManager { return this.glossary; }
  getAnalyzer(): MorphologicalAnalyzer { return this.analyzer; }
}

export const translator = new Translator();

/**
 * Collapse spaces between individual Japanese characters.
 * Handles manga/anime emphasis style: だ か ら → だから
 * Only collapses when BOTH sides are Japanese (hiragana, katakana, kanji).
 */
function normalizeSpacedJapanese(text: string): string {
  // Match: JP char + horizontal whitespace + JP char (lookahead), globally
  // Use [ \t]+ instead of \s+ to preserve line breaks (\n)
  return text.replace(
    /([ぁ-んァ-ヶー\u4E00-\u9FFF])[ \t]+(?=[ぁ-んァ-ヶー\u4E00-\u9FFF])/g,
    '$1',
  );
}
