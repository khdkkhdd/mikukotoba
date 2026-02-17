import type { TranslationResult, CacheEntry } from '@/types';

const CACHE_KEY_PREFIX = 'jp_cache_';
const CACHE_INDEX_KEY = 'jp_cache_index';
const MAX_CACHE_ENTRIES = 5000;
const CACHE_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

interface CacheIndex {
  keys: string[];
  timestamps: Record<string, number>;
}

// In-memory cache for fast access within session
const memoryCache = new Map<string, TranslationResult>();
const MAX_MEMORY_CACHE = 200;

function hashKey(text: string): string {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
  }
  return CACHE_KEY_PREFIX + Math.abs(hash).toString(36);
}

export class TranslationCache {
  async get(text: string): Promise<TranslationResult | null> {
    // Check memory cache first
    const memResult = memoryCache.get(text);
    if (memResult) return memResult;

    // Check storage cache
    const key = hashKey(text);
    try {
      const data = await chrome.storage.local.get(key);
      const entry: CacheEntry | undefined = data[key];

      if (!entry) return null;

      // Check expiry
      if (Date.now() - entry.timestamp > CACHE_EXPIRY_MS) {
        await chrome.storage.local.remove(key);
        return null;
      }

      // Promote to memory cache
      setMemoryCache(text, entry.result);

      return entry.result;
    } catch {
      return null;
    }
  }

  async set(text: string, result: TranslationResult): Promise<void> {
    // Update memory cache
    setMemoryCache(text, result);

    const key = hashKey(text);
    const entry: CacheEntry = {
      result,
      timestamp: Date.now(),
    };

    try {
      await chrome.storage.local.set({ [key]: entry });
      await this.updateIndex(key);
    } catch {
      // Storage might be full — evict old entries
      await this.evict();
      try {
        await chrome.storage.local.set({ [key]: entry });
        await this.updateIndex(key);
      } catch {
        // Give up silently
      }
    }
  }

  async delete(text: string): Promise<void> {
    memoryCache.delete(text);

    const key = hashKey(text);
    try {
      await chrome.storage.local.remove(key);

      // Remove from index
      const indexData = await chrome.storage.local.get(CACHE_INDEX_KEY);
      const index: CacheIndex = indexData[CACHE_INDEX_KEY] || { keys: [], timestamps: {} };
      const idx = index.keys.indexOf(key);
      if (idx !== -1) {
        index.keys.splice(idx, 1);
        delete index.timestamps[key];
        await chrome.storage.local.set({ [CACHE_INDEX_KEY]: index });
      }
    } catch {
      // Best effort
    }
  }

  async clear(): Promise<void> {
    memoryCache.clear();

    try {
      const indexData = await chrome.storage.local.get(CACHE_INDEX_KEY);
      const index: CacheIndex = indexData[CACHE_INDEX_KEY] || { keys: [], timestamps: {} };

      if (index.keys.length > 0) {
        await chrome.storage.local.remove(index.keys);
      }
      await chrome.storage.local.remove(CACHE_INDEX_KEY);
    } catch {
      // Best effort
    }
  }

  async getStats(): Promise<{ count: number; estimatedSizeKB: number }> {
    try {
      const indexData = await chrome.storage.local.get(CACHE_INDEX_KEY);
      const index: CacheIndex = indexData[CACHE_INDEX_KEY] || { keys: [], timestamps: {} };
      return {
        count: index.keys.length,
        estimatedSizeKB: Math.round(index.keys.length * 0.5), // rough estimate
      };
    } catch {
      return { count: 0, estimatedSizeKB: 0 };
    }
  }

  private async updateIndex(key: string): Promise<void> {
    const indexData = await chrome.storage.local.get(CACHE_INDEX_KEY);
    const index: CacheIndex = indexData[CACHE_INDEX_KEY] || { keys: [], timestamps: {} };

    if (!index.keys.includes(key)) {
      index.keys.push(key);
    }
    index.timestamps[key] = Date.now();

    // Evict if over limit
    if (index.keys.length > MAX_CACHE_ENTRIES) {
      // Remove oldest entries
      const sorted = [...index.keys].sort(
        (a, b) => (index.timestamps[a] || 0) - (index.timestamps[b] || 0)
      );
      const toRemove = sorted.slice(0, index.keys.length - MAX_CACHE_ENTRIES);
      await chrome.storage.local.remove(toRemove);
      for (const k of toRemove) {
        delete index.timestamps[k];
      }
      index.keys = index.keys.filter((k) => !toRemove.includes(k));
    }

    await chrome.storage.local.set({ [CACHE_INDEX_KEY]: index });
  }

  private async evict(): Promise<void> {
    const indexData = await chrome.storage.local.get(CACHE_INDEX_KEY);
    const index: CacheIndex = indexData[CACHE_INDEX_KEY] || { keys: [], timestamps: {} };

    if (index.keys.length === 0) return;

    // Remove oldest 20%
    const sorted = [...index.keys].sort(
      (a, b) => (index.timestamps[a] || 0) - (index.timestamps[b] || 0)
    );
    const removeCount = Math.max(1, Math.floor(sorted.length * 0.2));
    const toRemove = sorted.slice(0, removeCount);

    await chrome.storage.local.remove(toRemove);
    for (const k of toRemove) {
      delete index.timestamps[k];
    }
    index.keys = index.keys.filter((k) => !toRemove.includes(k));
    await chrome.storage.local.set({ [CACHE_INDEX_KEY]: index });
  }
}

function setMemoryCache(text: string, result: TranslationResult): void {
  if (memoryCache.size >= MAX_MEMORY_CACHE) {
    // Remove oldest entry
    const firstKey = memoryCache.keys().next().value;
    if (firstKey !== undefined) memoryCache.delete(firstKey);
  }
  memoryCache.set(text, result);
}

export const translationCache = new TranslationCache();
