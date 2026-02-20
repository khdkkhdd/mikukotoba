import type { SQLiteDatabase } from 'expo-sqlite';
import { AppState, type NativeEventSubscription } from 'react-native';
import { createSyncContextFromDb, pullFromDrive, pushToDrive, pullFsrsPartitions, pushFsrsPartitions, pushReviewLogPartitions, pullReviewLogPartitions } from './sync';
import { commitSyncMeta } from '@mikukotoba/shared';
import { getAccessToken } from './drive-auth';
import { useVocabStore } from '../stores/vocab-store';
import { useSettingsStore } from '../stores/settings-store';
import { setSyncMeta } from '../db/queries';

const DEBOUNCE_MS = 30_000; // 30초

// 모듈 상태
let database: SQLiteDatabase | null = null;
let dirtyFsrsVocabIds = new Set<string>();
let dirtyReviewMonths = new Set<string>();
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

export function markFsrsDirty(vocabId: string) {
  dirtyFsrsVocabIds.add(vocabId);
  startDebounce();
}

export function markReviewLogDirty(month: string) {
  dirtyReviewMonths.add(month);
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
    // flush는 경량 경로 — listFiles 호출하지 않음, ctx 미사용
    if (dirtyFsrsVocabIds.size > 0) {
      const ids = [...dirtyFsrsVocabIds];
      await pushFsrsPartitions(database, ids);
      dirtyFsrsVocabIds.clear();
    }

    if (dirtyReviewMonths.size > 0) {
      const months = [...dirtyReviewMonths];
      await pushReviewLogPartitions(database, months);
      dirtyReviewMonths.clear();
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

  // SyncContext 생성: listFiles 1회 + meta 1회
  const result = await createSyncContextFromDb(db);
  if (!result) {
    return { vocabPulled: 0, vocabPushed: 0, fsrsPulled: false };
  }
  const { ctx } = result;

  // 3종 pull 병렬
  const [vocabResult, fsrsPulled] = await Promise.all([
    pullFromDrive(db, ctx),
    pullFsrsPartitions(db, ctx),
    pullReviewLogPartitions(db, ctx),
  ]);

  // push dirty partitions (ctx 공유)
  let vocabPushed = 0;
  if (dirtyVocabDates.size > 0) {
    const dates = [...dirtyVocabDates];
    vocabPushed = await pushToDrive(db, dates, ctx);
    dirtyVocabDates.clear();
  }
  if (dirtyFsrsVocabIds.size > 0) {
    const ids = [...dirtyFsrsVocabIds];
    await pushFsrsPartitions(db, ids, ctx);
    dirtyFsrsVocabIds.clear();
  }
  if (dirtyReviewMonths.size > 0) {
    const months = [...dirtyReviewMonths];
    await pushReviewLogPartitions(db, months, ctx);
    dirtyReviewMonths.clear();
  }

  // 재읽기 + 머지 + 1회 쓰기
  await commitSyncMeta(ctx);

  return { vocabPulled: vocabResult.pulled, vocabPushed, fsrsPulled };
}

async function handleAppStateChange(nextState: string) {
  if (!database) return;

  if (nextState === 'background' || nextState === 'inactive') {
    await flush();
  } else if (nextState === 'active') {
    try {
      // SyncContext 생성 → 3종 pull 병렬
      const result = await createSyncContextFromDb(database);
      if (!result) return;
      const { ctx } = result;

      const [vocabResult] = await Promise.all([
        pullFromDrive(database, ctx),
        pullFsrsPartitions(database, ctx),
        pullReviewLogPartitions(database, ctx),
      ]);

      if (vocabResult.changed) {
        await useVocabStore.getState().refresh(database);
      }

      const now = Date.now();
      useSettingsStore.getState().setSyncState(false, now);
      await setSyncMeta(database, 'lastSyncTime', String(now));
    } catch {
      // 포그라운드 pull 실패 — 무시
    }
  }
}

export function initSyncManager(db: SQLiteDatabase) {
  database = db;
  appStateSubscription = AppState.addEventListener('change', handleAppStateChange);

  // cold start 시 자동 pull
  (async () => {
    try {
      const result = await createSyncContextFromDb(db);
      if (!result) return;
      const { ctx } = result;

      const [vocabResult] = await Promise.all([
        pullFromDrive(db, ctx),
        pullFsrsPartitions(db, ctx),
        pullReviewLogPartitions(db, ctx),
      ]);

      if (vocabResult.changed) {
        await useVocabStore.getState().refresh(db);
      }

      const now = Date.now();
      useSettingsStore.getState().setSyncState(false, now);
      await setSyncMeta(db, 'lastSyncTime', String(now));
    } catch {
      // cold start pull 실패 — 무시
    }
  })();
}

export function destroySyncManager() {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  appStateSubscription?.remove();
  appStateSubscription = null;
  database = null;
  dirtyFsrsVocabIds.clear();
  dirtyReviewMonths.clear();
  dirtyVocabDates.clear();
  isFlushing = false;
}
