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

  // Actions
  init: (database: SQLiteDatabase) => Promise<void>;
  addEntry: (database: SQLiteDatabase, entry: VocabEntry) => Promise<void>;
  updateEntry: (database: SQLiteDatabase, entry: VocabEntry) => Promise<void>;
  removeEntry: (database: SQLiteDatabase, id: string) => Promise<void>;
  search: (database: SQLiteDatabase, query: string) => Promise<void>;
  refresh: (database: SQLiteDatabase) => Promise<void>;
}

export const useVocabStore = create<VocabState>((set) => ({
  entries: [],
  dateGroups: [],
  totalCount: 0,
  isLoading: false,
  searchQuery: '',

  init: async (database) => {
    set({ isLoading: true });
    const [entries, dateGroups, totalCount] = await Promise.all([
      db.getAllEntries(database),
      db.getDateGroups(database),
      db.getTotalCount(database),
    ]);
    set({ entries, dateGroups, totalCount, isLoading: false });
  },

  addEntry: async (database, entry) => {
    await db.upsertEntry(database, entry);
    const [entries, dateGroups, totalCount] = await Promise.all([
      db.getAllEntries(database),
      db.getDateGroups(database),
      db.getTotalCount(database),
    ]);
    set({ entries, dateGroups, totalCount });
  },

  updateEntry: async (database, entry) => {
    await db.upsertEntry(database, entry);
    set((state) => ({
      entries: state.entries.map((e) => (e.id === entry.id ? entry : e)),
    }));
  },

  removeEntry: async (database, id) => {
    await db.addTombstone(database, id);
    await db.deleteEntry(database, id);
    const [entries, dateGroups, totalCount] = await Promise.all([
      db.getAllEntries(database),
      db.getDateGroups(database),
      db.getTotalCount(database),
    ]);
    set({ entries, dateGroups, totalCount });
  },

  search: async (database, query) => {
    set({ searchQuery: query });
    if (!query.trim()) {
      const entries = await db.getAllEntries(database);
      set({ entries });
      return;
    }
    const entries = await db.searchEntries(database, query);
    set({ entries });
  },

  refresh: async (database) => {
    const [entries, dateGroups, totalCount] = await Promise.all([
      db.getAllEntries(database),
      db.getDateGroups(database),
      db.getTotalCount(database),
    ]);
    set({ entries, dateGroups, totalCount });
  },
}));
