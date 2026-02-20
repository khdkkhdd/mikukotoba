import type { SQLiteDatabase } from 'expo-sqlite';
import { AppState, type NativeEventSubscription } from 'react-native';
import { pullFromDrive, pushToDrive, pullFsrsState, pushFsrsState, pushReviewLogs, pullReviewLogs } from './sync';
import { getAccessToken } from './drive-auth';
import { useVocabStore } from '../stores/vocab-store';

const DEBOUNCE_MS = 30_000; // 30초

// 모듈 상태
let database: SQLiteDatabase | null = null;
let dirtyFsrs = false;
let dirtyReviewLog = false;
let dirtyVocabDates = new Set<string>();
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let isFlushing = false;
let appStateSubscription: NativeEventSubscription | null = null;

function startDebounce() {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    flush();
  }, DEBOUNCE_MS);
}

export function markFsrsDirty() {
  dirtyFsrs = true;
  startDebounce();
}

export function markReviewLogDirty() {
  dirtyReviewLog = true;
  startDebounce();
}

export function markVocabDirty(date: string) {
  dirtyVocabDates.add(date);
  startDebounce();
}

export async function flush(): Promise<void> {
  if (!database || isFlushing) return;

  const token = await getAccessToken();
  if (!token) return;

  isFlushing = true;
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }

  try {
    if (dirtyFsrs) {
      await pushFsrsState(database);
      dirtyFsrs = false;
    }

    if (dirtyReviewLog) {
      await pushReviewLogs(database);
      dirtyReviewLog = false;
    }

    if (dirtyVocabDates.size > 0) {
      const dates = [...dirtyVocabDates];
      await pushToDrive(database, dates);
      dirtyVocabDates.clear();
    }
  } catch (e) {
    console.error('[SYNC] flush failed:', e);
    // dirty 상태 유지 — 다음 기회에 재시도
  } finally {
    isFlushing = false;
  }
}

export async function fullSync(db: SQLiteDatabase): Promise<{ vocabPulled: number; vocabPushed: number; fsrsPulled: boolean }> {
  // flush pending changes first
  database = db;
  await flush();

  // pull
  const vocabResult = await pullFromDrive(db);
  const fsrsPulled = await pullFsrsState(db);
  await pullReviewLogs(db);

  // push all local dates (merge-before-push로 Drive 데이터 보존)
  const allDates = await getAllVocabDates(db);
  const vocabPushed = await pushToDrive(db, allDates);
  await pushFsrsState(db);
  await pushReviewLogs(db);

  return { vocabPulled: vocabResult.pulled, vocabPushed, fsrsPulled };
}

async function getAllVocabDates(db: SQLiteDatabase): Promise<string[]> {
  const rows = await db.getAllAsync<{ date: string }>(
    'SELECT DISTINCT date_added as date FROM vocab'
  );
  return rows.map((r) => r.date);
}

async function handleAppStateChange(nextState: string) {
  if (!database) return;

  if (nextState === 'background' || nextState === 'inactive') {
    await flush();
  } else if (nextState === 'active') {
    const token = await getAccessToken();
    if (!token) return;

    try {
      const vocabResult = await pullFromDrive(database);
      await pullFsrsState(database);
      await pullReviewLogs(database);

      if (vocabResult.changed) {
        await useVocabStore.getState().refresh(database);
      }
    } catch {
      // 포그라운드 pull 실패 — 무시
    }
  }
}

export function initSyncManager(db: SQLiteDatabase) {
  database = db;
  appStateSubscription = AppState.addEventListener('change', handleAppStateChange);
}

export function destroySyncManager() {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  appStateSubscription?.remove();
  appStateSubscription = null;
  database = null;
  dirtyFsrs = false;
  dirtyReviewLog = false;
  dirtyVocabDates.clear();
  isFlushing = false;
}
