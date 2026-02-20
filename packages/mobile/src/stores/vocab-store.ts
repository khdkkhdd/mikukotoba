import { create } from 'zustand';
import type { VocabEntry } from '@mikukotoba/shared';
import type { SQLiteDatabase } from 'expo-sqlite';
import * as db from '../db';

interface VocabState {
  entries: VocabEntry[];
  dateGroups: { date: string; count: number }[];
  totalCount: number;
  isLoading: boolean;
  searchQuery: string;

  // 태그
  allTagCounts: Record<string, number>;
  selectedTag: string | null;

  // Actions
  init: (database: SQLiteDatabase) => Promise<void>;
  addEntry: (database: SQLiteDatabase, entry: VocabEntry) => Promise<void>;
  updateEntry: (database: SQLiteDatabase, entry: VocabEntry) => Promise<void>;
  removeEntry: (database: SQLiteDatabase, id: string) => Promise<void>;
  search: (database: SQLiteDatabase, query: string) => Promise<void>;
  refresh: (database: SQLiteDatabase) => Promise<void>;
  refreshTags: (database: SQLiteDatabase) => Promise<void>;
  setTagFilter: (database: SQLiteDatabase, tag: string | null) => Promise<void>;
}

export const useVocabStore = create<VocabState>((set, get) => ({
  entries: [],
  dateGroups: [],
  totalCount: 0,
  isLoading: false,
  searchQuery: '',
  allTagCounts: {},
  selectedTag: null,

  init: async (database) => {
    set({ isLoading: true });
    const [entries, dateGroups, totalCount, allTagCounts] = await Promise.all([
      db.getAllEntries(database),
      db.getDateGroups(database),
      db.getTotalCount(database),
      db.getAllTagCounts(database),
    ]);
    set({ entries, dateGroups, totalCount, allTagCounts, isLoading: false });
  },

  addEntry: async (database, entry) => {
    await db.upsertEntry(database, entry);
    const [entries, dateGroups, totalCount, allTagCounts] = await Promise.all([
      db.getAllEntries(database),
      db.getDateGroups(database),
      db.getTotalCount(database),
      db.getAllTagCounts(database),
    ]);
    set({ entries, dateGroups, totalCount, allTagCounts });
  },

  updateEntry: async (database, entry) => {
    await db.upsertEntry(database, entry);
    const allTagCounts = await db.getAllTagCounts(database);
    set((state) => ({
      entries: state.entries.map((e) => (e.id === entry.id ? entry : e)),
      allTagCounts,
    }));
  },

  removeEntry: async (database, id) => {
    await db.addTombstone(database, id);
    await db.deleteEntry(database, id);
    const [entries, dateGroups, totalCount, allTagCounts] = await Promise.all([
      db.getAllEntries(database),
      db.getDateGroups(database),
      db.getTotalCount(database),
      db.getAllTagCounts(database),
    ]);
    set({ entries, dateGroups, totalCount, allTagCounts });
  },

  search: async (database, query) => {
    set({ searchQuery: query });
    if (!query.trim()) {
      const { selectedTag } = get();
      if (selectedTag) {
        const entries = await db.getEntriesByTag(database, selectedTag);
        set({ entries });
      } else {
        const entries = await db.getAllEntries(database);
        set({ entries });
      }
      return;
    }
    const entries = await db.searchEntries(database, query);
    const { selectedTag } = get();
    if (selectedTag) {
      set({ entries: entries.filter((e) => e.tags.includes(selectedTag)) });
    } else {
      set({ entries });
    }
  },

  refresh: async (database) => {
    const [entries, dateGroups, totalCount, allTagCounts] = await Promise.all([
      db.getAllEntries(database),
      db.getDateGroups(database),
      db.getTotalCount(database),
      db.getAllTagCounts(database),
    ]);
    set({ entries, dateGroups, totalCount, allTagCounts, selectedTag: null });
  },

  refreshTags: async (database) => {
    const allTagCounts = await db.getAllTagCounts(database);
    set({ allTagCounts });
  },

  setTagFilter: async (database, tag) => {
    set({ selectedTag: tag, searchQuery: '' });
    if (tag) {
      const entries = await db.getEntriesByTag(database, tag);
      set({ entries });
    } else {
      const entries = await db.getAllEntries(database);
      set({ entries });
    }
  },
}));
