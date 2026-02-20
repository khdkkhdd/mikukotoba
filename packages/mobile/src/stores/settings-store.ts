import { create } from 'zustand';
import type { SQLiteDatabase } from 'expo-sqlite';
import { getAppSetting, setAppSetting } from '../db/queries';

const DAILY_NEW_CARDS_KEY = 'dailyNewCards';
const DEFAULT_DAILY_NEW_CARDS = 20;

interface SettingsState {
  // 학습 설정
  dailyNewCards: number;
  notificationsEnabled: boolean;
  notificationTime: string; // HH:mm

  // Google 계정
  googleEmail: string | null;
  isGoogleConnected: boolean;

  // 동기화
  lastSyncTime: number;
  isSyncing: boolean;

  // Actions
  setDailyNewCards: (n: number, db?: SQLiteDatabase) => void;
  loadDailyNewCards: (db: SQLiteDatabase) => Promise<void>;
  setNotifications: (enabled: boolean, time?: string) => void;
  setGoogleAccount: (email: string | null) => void;
  setSyncState: (syncing: boolean, lastSync?: number) => void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  dailyNewCards: DEFAULT_DAILY_NEW_CARDS,
  notificationsEnabled: false,
  notificationTime: '09:00',
  googleEmail: null,
  isGoogleConnected: false,
  lastSyncTime: 0,
  isSyncing: false,

  setDailyNewCards: (n, db) => {
    set({ dailyNewCards: n });
    if (db) {
      setAppSetting(db, DAILY_NEW_CARDS_KEY, String(n)).catch(() => {});
    }
  },
  loadDailyNewCards: async (db) => {
    const saved = await getAppSetting(db, DAILY_NEW_CARDS_KEY);
    if (saved !== null) {
      const n = parseInt(saved, 10);
      if (!isNaN(n) && n >= 1) {
        set({ dailyNewCards: n });
      }
    }
  },
  setNotifications: (enabled, time) =>
    set((s) => ({
      notificationsEnabled: enabled,
      notificationTime: time ?? s.notificationTime,
    })),
  setGoogleAccount: (email) =>
    set({ googleEmail: email, isGoogleConnected: !!email }),
  setSyncState: (syncing, lastSync) =>
    set((s) => ({
      isSyncing: syncing,
      lastSyncTime: lastSync ?? s.lastSyncTime,
    })),
}));
