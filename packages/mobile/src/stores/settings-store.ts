import { create } from 'zustand';

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
  setDailyNewCards: (n: number) => void;
  setNotifications: (enabled: boolean, time?: string) => void;
  setGoogleAccount: (email: string | null) => void;
  setSyncState: (syncing: boolean, lastSync?: number) => void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  dailyNewCards: 20,
  notificationsEnabled: false,
  notificationTime: '09:00',
  googleEmail: null,
  isGoogleConnected: false,
  lastSyncTime: 0,
  isSyncing: false,

  setDailyNewCards: (n) => set({ dailyNewCards: n }),
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
