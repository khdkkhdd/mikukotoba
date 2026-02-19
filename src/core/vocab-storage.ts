import type { VocabEntry, VocabStorageIndex } from '@/types';

const INDEX_KEY = 'jp_vocab_index';
const DATE_PREFIX = 'jp_vocab_';

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
  },

  async search(query: string): Promise<VocabEntry[]> {
    const q = query.toLowerCase();
    const index = await getIndex();
    const results: VocabEntry[] = [];

    const keys = index.dates.map(dateKey);
    const data = await chrome.storage.local.get(keys);

    for (const date of index.dates) {
      const entries: VocabEntry[] = data[dateKey(date)] || [];
      for (const e of entries) {
        if (
          e.word.toLowerCase().includes(q) ||
          e.meaning.toLowerCase().includes(q) ||
          e.reading.includes(q) ||
          e.romaji.toLowerCase().includes(q) ||
          e.exampleSentence.toLowerCase().includes(q) ||
          e.note.toLowerCase().includes(q)
        ) {
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
};
