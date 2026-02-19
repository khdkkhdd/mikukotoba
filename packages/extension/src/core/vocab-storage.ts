import type { VocabEntry, VocabStorageIndex } from '@/types';

const INDEX_KEY = 'jp_vocab_index';
const DATE_PREFIX = 'jp_vocab_';
const SEARCH_INDEX_KEY = 'jp_vocab_search_flat';

interface SearchEntry {
  id: string;
  date: string;
  word: string;
  reading: string;
  romaji: string;
  meaning: string;
  note: string;
}

function dateKey(date: string): string {
  return `${DATE_PREFIX}${date}`;
}

async function getIndex(): Promise<VocabStorageIndex> {
  const data = await chrome.storage.local.get(INDEX_KEY);
  return data[INDEX_KEY] || { dates: [], totalCount: 0 };
}

async function saveIndex(index: VocabStorageIndex): Promise<void> {
  await chrome.storage.local.set({ [INDEX_KEY]: index });
}

async function getEntriesForDate(date: string): Promise<VocabEntry[]> {
  const key = dateKey(date);
  const data = await chrome.storage.local.get(key);
  return data[key] || [];
}

async function saveEntriesForDate(date: string, entries: VocabEntry[]): Promise<void> {
  const key = dateKey(date);
  if (entries.length === 0) {
    await chrome.storage.local.remove(key);
  } else {
    await chrome.storage.local.set({ [key]: entries });
  }
}

// ──────────────── Search Index Helpers ────────────────

async function getSearchIndex(): Promise<SearchEntry[]> {
  const data = await chrome.storage.local.get(SEARCH_INDEX_KEY);
  return data[SEARCH_INDEX_KEY] || [];
}

async function saveSearchIndex(entries: SearchEntry[]): Promise<void> {
  await chrome.storage.local.set({ [SEARCH_INDEX_KEY]: entries });
}

function toSearchEntry(e: VocabEntry): SearchEntry {
  return {
    id: e.id,
    date: e.dateAdded,
    word: e.word,
    reading: e.reading,
    romaji: e.romaji,
    meaning: e.meaning,
    note: e.note,
  };
}

export const VocabStorage = {
  getIndex,

  async addEntry(entry: VocabEntry): Promise<void> {
    const index = await getIndex();
    const entries = await getEntriesForDate(entry.dateAdded);

    entries.push(entry);
    await saveEntriesForDate(entry.dateAdded, entries);

    if (!index.dates.includes(entry.dateAdded)) {
      index.dates.push(entry.dateAdded);
      index.dates.sort((a, b) => b.localeCompare(a)); // descending
    }
    index.totalCount++;
    await saveIndex(index);

    // Update search index
    const searchIndex = await getSearchIndex();
    searchIndex.push(toSearchEntry(entry));
    await saveSearchIndex(searchIndex);
  },

  async getEntriesByDates(dates: string[]): Promise<Record<string, VocabEntry[]>> {
    const keys = dates.map(dateKey);
    const data = await chrome.storage.local.get(keys);
    const result: Record<string, VocabEntry[]> = {};
    for (const date of dates) {
      result[date] = data[dateKey(date)] || [];
    }
    return result;
  },

  async updateEntry(entry: VocabEntry): Promise<void> {
    const entries = await getEntriesForDate(entry.dateAdded);
    const idx = entries.findIndex(e => e.id === entry.id);
    if (idx !== -1) {
      entries[idx] = entry;
      await saveEntriesForDate(entry.dateAdded, entries);

      // Update search index
      const searchIndex = await getSearchIndex();
      const sIdx = searchIndex.findIndex(s => s.id === entry.id);
      if (sIdx !== -1) {
        searchIndex[sIdx] = toSearchEntry(entry);
        await saveSearchIndex(searchIndex);
      }
    }
  },

  async deleteEntry(id: string, date: string): Promise<void> {
    const entries = await getEntriesForDate(date);
    const filtered = entries.filter(e => e.id !== id);

    if (filtered.length === entries.length) return; // not found

    await saveEntriesForDate(date, filtered);

    const index = await getIndex();
    index.totalCount--;
    if (filtered.length === 0) {
      index.dates = index.dates.filter(d => d !== date);
    }
    await saveIndex(index);

    // Update search index
    const searchIndex = await getSearchIndex();
    const newSearch = searchIndex.filter(s => s.id !== id);
    await saveSearchIndex(newSearch);
  },

  async search(query: string): Promise<VocabEntry[]> {
    const q = query.toLowerCase();
    const searchIndex = await getSearchIndex();

    // Find matching IDs from the flat search index
    const matchingByDate = new Map<string, string[]>();
    for (const s of searchIndex) {
      if (
        s.word.toLowerCase().includes(q) ||
        s.meaning.toLowerCase().includes(q) ||
        s.reading.includes(q) ||
        s.romaji.toLowerCase().includes(q) ||
        s.note.toLowerCase().includes(q)
      ) {
        const ids = matchingByDate.get(s.date) || [];
        ids.push(s.id);
        matchingByDate.set(s.date, ids);
      }
    }

    if (matchingByDate.size === 0) return [];

    // Load only the date partitions that have matches
    const dates = [...matchingByDate.keys()];
    const keys = dates.map(dateKey);
    const data = await chrome.storage.local.get(keys);

    const results: VocabEntry[] = [];
    for (const date of dates) {
      const entries: VocabEntry[] = data[dateKey(date)] || [];
      const matchIds = new Set(matchingByDate.get(date)!);
      for (const e of entries) {
        if (matchIds.has(e.id)) {
          results.push(e);
        }
      }
    }
    return results;
  },

  async exportAll(): Promise<VocabEntry[]> {
    const index = await getIndex();
    const keys = index.dates.map(dateKey);
    const data = await chrome.storage.local.get(keys);
    const all: VocabEntry[] = [];
    for (const date of index.dates) {
      const entries: VocabEntry[] = data[dateKey(date)] || [];
      all.push(...entries);
    }
    return all;
  },

  /**
   * Import entries from JSON, optionally merging with existing data.
   * Returns the number of newly added entries (skips duplicates by id).
   */
  async importEntries(entries: VocabEntry[]): Promise<number> {
    const index = await getIndex();
    const searchIndex = await getSearchIndex();
    const existingIds = new Set(searchIndex.map(s => s.id));

    // Group new entries by date
    const byDate = new Map<string, VocabEntry[]>();
    let added = 0;

    for (const entry of entries) {
      if (existingIds.has(entry.id)) continue; // skip duplicates
      const group = byDate.get(entry.dateAdded) || [];
      group.push(entry);
      byDate.set(entry.dateAdded, group);
      searchIndex.push(toSearchEntry(entry));
      added++;
    }

    if (added === 0) return 0;

    // Merge into existing date partitions
    for (const [date, newEntries] of byDate) {
      const existing = await getEntriesForDate(date);
      existing.push(...newEntries);
      await saveEntriesForDate(date, existing);

      if (!index.dates.includes(date)) {
        index.dates.push(date);
      }
    }

    index.dates.sort((a, b) => b.localeCompare(a));
    index.totalCount += added;
    await saveIndex(index);
    await saveSearchIndex(searchIndex);

    return added;
  },

  /**
   * Rebuild search index from all date partitions.
   * Call this once to migrate existing data.
   */
  async rebuildSearchIndex(): Promise<void> {
    const index = await getIndex();
    const keys = index.dates.map(dateKey);
    const data = await chrome.storage.local.get(keys);
    const searchEntries: SearchEntry[] = [];

    for (const date of index.dates) {
      const entries: VocabEntry[] = data[dateKey(date)] || [];
      for (const e of entries) {
        searchEntries.push(toSearchEntry(e));
      }
    }

    await saveSearchIndex(searchEntries);
  },
};
