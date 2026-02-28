import type { SyncMetadata, SyncResult, VocabEntry, VocabStorageIndex } from '@/types';
import type { DrivePartitionContent, DriveSyncMeta, SyncContext } from '@mikukotoba/shared';
import { DriveAuth } from './drive-auth';
import { DriveAPI } from '@mikukotoba/shared';
import {
  mergeEntries,
  countChangedEntries,
  cleanTombstones,
  drivePartitionName,
  resolveFileId,
  parallelMap,
  createSyncContext,
  commitSyncMeta,
  DRIVE_META_FILE,
  DRIVE_INDEX_FILE,
} from '@mikukotoba/shared';

const SYNC_META_KEY = 'jp_drive_sync_meta';
const VOCAB_INDEX_KEY = 'jp_vocab_index';
const VOCAB_PREFIX = 'jp_vocab_';
const SEARCH_INDEX_KEY = 'jp_vocab_search_flat';

// Debounce map: date → timer
const pushTimers = new Map<string, ReturnType<typeof setTimeout>>();
const DEBOUNCE_MS = 500;

function vocabDateKey(date: string): string {
  return `${VOCAB_PREFIX}${date}`;
}

async function getLocalMeta(): Promise<SyncMetadata> {
  const data = await chrome.storage.local.get(SYNC_META_KEY);
  return data[SYNC_META_KEY] || {
    lastSyncTimestamp: 0,
    partitionVersions: {},
    driveFileIds: {},
    deletedEntries: {},
  };
}

async function saveLocalMeta(meta: SyncMetadata): Promise<void> {
  await chrome.storage.local.set({ [SYNC_META_KEY]: meta });
}

async function getLocalIndex(): Promise<VocabStorageIndex> {
  const data = await chrome.storage.local.get(VOCAB_INDEX_KEY);
  return data[VOCAB_INDEX_KEY] || { dates: [], totalCount: 0 };
}

async function getLocalEntries(date: string): Promise<VocabEntry[]> {
  const key = vocabDateKey(date);
  const data = await chrome.storage.local.get(key);
  return data[key] || [];
}

async function saveLocalEntries(date: string, entries: VocabEntry[]): Promise<void> {
  const key = vocabDateKey(date);
  if (entries.length === 0) {
    await chrome.storage.local.remove(key);
  } else {
    await chrome.storage.local.set({ [key]: entries });
  }
}

async function saveLocalIndex(index: VocabStorageIndex): Promise<void> {
  await chrome.storage.local.set({ [VOCAB_INDEX_KEY]: index });
}

async function rebuildSearchIndex(): Promise<void> {
  const index = await getLocalIndex();
  const keys = index.dates.map(vocabDateKey);
  const data = await chrome.storage.local.get(keys);
  const searchEntries: Array<{
    id: string; date: string; word: string;
    reading: string; romaji: string; meaning: string; note: string;
    tags: string[];
  }> = [];

  for (const date of index.dates) {
    const entries: VocabEntry[] = data[vocabDateKey(date)] || [];
    for (const e of entries) {
      searchEntries.push({
        id: e.id, date: e.dateAdded, word: e.word,
        reading: e.reading, romaji: e.romaji,
        meaning: e.meaning, note: e.note,
        tags: e.tags ?? [],
      });
    }
  }

  await chrome.storage.local.set({ [SEARCH_INDEX_KEY]: searchEntries });
}

async function ensureDriveFileId(
  token: string,
  meta: SyncMetadata,
  fileName: string
): Promise<string | null> {
  if (meta.driveFileIds[fileName]) return meta.driveFileIds[fileName];
  const fileId = await DriveAPI.findFileByName(token, fileName);
  if (fileId) {
    meta.driveFileIds[fileName] = fileId;
  }
  return fileId;
}

export const DriveSync = {
  getMetadata: getLocalMeta,

  async markDirty(date: string): Promise<void> {
    const meta = await getLocalMeta();
    meta.partitionVersions[date] = Date.now();
    await saveLocalMeta(meta);
  },

  async pushAll(): Promise<number> {
    const token = await DriveAuth.getValidToken();
    if (!token) return 0;

    const meta = await getLocalMeta();
    const ctx = await createSyncContext(token, meta.driveFileIds);
    const remoteMeta = ctx.remoteMeta;
    await saveLocalMeta(meta); // driveFileIds 캐시 업데이트

    const index = await getLocalIndex();
    const datesToPush = index.dates.filter(date => {
      const localV = meta.partitionVersions[date] || 0;
      const remoteV = remoteMeta.partitionVersions[date] || 0;
      return localV > remoteV || (localV === 0 && remoteV === 0);
    });

    let pushed = 0;
    // 병렬 push
    const results = await parallelMap(datesToPush, async (date) => {
      return pushPartitionCore(token, date, meta, ctx);
    });

    for (const result of results) {
      if (result.status === 'fulfilled') {
        pushed += result.value;
      }
    }

    // commitSyncMeta 1회
    await commitSyncMeta(ctx);
    await saveLocalMeta(meta);
    return pushed;
  },

  pushPartition(date: string): Promise<void> {
    return new Promise((resolve) => {
      const existing = pushTimers.get(date);
      if (existing) clearTimeout(existing);

      pushTimers.set(date, setTimeout(async () => {
        pushTimers.delete(date);
        try {
          await pushPartitionImmediate(date);
        } catch {
          // Best effort
        }
        resolve();
      }, DEBOUNCE_MS));
    });
  },

  async pushPartitionWithDeletion(entryId: string, date: string): Promise<void> {
    const meta = await getLocalMeta();
    meta.deletedEntries[entryId] = Date.now();
    await saveLocalMeta(meta);
    return this.pushPartition(date);
  },

  async pull(): Promise<SyncResult> {
    const token = await DriveAuth.getValidToken();
    if (!token) return { changed: false, pulled: 0, pushed: 0 };

    let meta = await getLocalMeta();
    let pulled = 0;
    let pushed = 0;
    let changed = false;

    // SyncContext: listFiles 1회 + meta 1회
    const ctx = await createSyncContext(token, meta.driveFileIds);
    const remoteMeta = ctx.remoteMeta;
    await saveLocalMeta(meta); // driveFileIds 캐시 업데이트

    for (const [entryId, remoteTs] of Object.entries(remoteMeta.deletedEntries || {})) {
      const localTs = meta.deletedEntries[entryId];
      if (!localTs || remoteTs > localTs) {
        meta.deletedEntries[entryId] = remoteTs;
      }
    }

    const localIndex = await getLocalIndex();
    const isValidDate = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d);
    const vocabDatePattern = /^vocab_(\d{4}-\d{2}-\d{2})\.json$/;
    const allDates = new Set([
      ...localIndex.dates.filter(isValidDate),
      ...Object.keys(remoteMeta.partitionVersions).filter(isValidDate),
      // Drive fileIdMap에서 vocab 파일 날짜 발견 (메타데이터 누락 복구)
      ...[...ctx.fileIdMap.keys()]
        .map(name => name.match(vocabDatePattern)?.[1])
        .filter((d): d is string => d != null && isValidDate(d)),
    ]);

    // 날짜를 카테고리별로 분류
    const pullDates: string[] = [];
    const pushDates: string[] = [];
    const initDates: string[] = [];

    for (const date of allDates) {
      const localVersion = meta.partitionVersions[date] || 0;
      const remoteVersion = remoteMeta.partitionVersions[date] || 0;

      if (remoteVersion > localVersion) {
        pullDates.push(date);
      } else if (localVersion > remoteVersion) {
        pushDates.push(date);
      } else if (localVersion === 0 && remoteVersion === 0) {
        initDates.push(date);
      }
    }

    // pull 파티션 병렬 fetch
    const pullResults = await parallelMap(pullDates, async (date) => {
      const fileName = drivePartitionName(date);
      const fileId = resolveFileId(ctx.fileIdMap, ctx.localDriveFileIds, fileName);
      if (!fileId) return null;

      const remote = await DriveAPI.getFile<DrivePartitionContent>(token, fileId);
      return { date, remote, fileId };
    });

    // pull 결과 순차 처리
    for (const result of pullResults) {
      if (result.status !== 'fulfilled' || !result.value) continue;
      const { date, remote, fileId } = result.value;
      const remoteVersion = remoteMeta.partitionVersions[date] || 0;

      try {
        const localEntries = await getLocalEntries(date);
        const merged = mergeEntries(remote.entries, localEntries, meta.deletedEntries);

        const pullChanges = countChangedEntries(localEntries, merged);
        await saveLocalEntries(date, merged);
        pulled += pullChanges;
        if (pullChanges > 0) changed = true;

        // Push-back
        if (localEntries.length > 0) {
          const pushChanges = countChangedEntries(remote.entries, merged);
          const version = Date.now();
          await DriveAPI.updateFile(token, fileId, { date, entries: merged, version });
          meta.partitionVersions[date] = version;
          ctx.versionPatches.partitionVersions[date] = version;
          pushed += pushChanges;
        } else {
          meta.partitionVersions[date] = remoteVersion || remote.version || Date.now();
        }
      } catch {
        // Skip this partition on error
      }
    }

    // push 파티션 병렬
    const pushResults = await parallelMap(pushDates, async (date) => {
      return pushPartitionCore(token, date, meta, ctx);
    });
    for (const result of pushResults) {
      if (result.status === 'fulfilled') {
        pushed += result.value;
        meta = await getLocalMeta(); // meta 갱신
      }
    }

    // init (0/0) 파티션 — 로컬에 있으면 push, Drive에만 있으면 pull
    const initResults = await parallelMap(initDates, async (date) => {
      const localEntries = await getLocalEntries(date);
      if (localEntries.length > 0) {
        return { pushed: await pushPartitionCore(token, date, meta, ctx), pulled: 0 };
      }
      // 로컬 데이터 없음 — Drive에 파일이 있으면 pull
      const fileName = drivePartitionName(date);
      const fileId = resolveFileId(ctx.fileIdMap, ctx.localDriveFileIds, fileName);
      if (fileId) {
        const remote = await DriveAPI.getFile<DrivePartitionContent>(token, fileId);
        const merged = mergeEntries(remote.entries, [], meta.deletedEntries);
        if (merged.length > 0) {
          await saveLocalEntries(date, merged);
          const version = remote.version || Date.now();
          meta.partitionVersions[date] = version;
          ctx.versionPatches.partitionVersions[date] = version;
          return { pushed: 0, pulled: merged.length };
        }
      }
      return { pushed: 0, pulled: 0 };
    });
    for (const result of initResults) {
      if (result.status === 'fulfilled') {
        pushed += result.value.pushed;
        const initPulled = result.value.pulled;
        pulled += initPulled;
        if (initPulled > 0) changed = true;
        meta = await getLocalMeta();
      }
    }

    // commitSyncMeta: 재읽기 + 머지 + 1회 쓰기
    const hasVersionPatches = Object.keys(ctx.versionPatches.partitionVersions).length > 0;
    if (pushed > 0 || hasVersionPatches) {
      await commitSyncMeta(ctx);
    }

    meta.deletedEntries = cleanTombstones(meta.deletedEntries);
    meta.lastSyncTimestamp = Date.now();
    await saveLocalMeta(meta);

    const currentIndex = await getLocalIndex();
    const hasInvalidDates = currentIndex.dates.some(d => !isValidDate(d));
    if (changed || hasInvalidDates) {
      await rebuildLocalIndex();
      await rebuildSearchIndex();
    }

    return { changed: changed || pulled > 0 || pushed > 0, pulled, pushed };
  },

  async diagnose(): Promise<{
    local: { total: number; withTags: number; sample: Array<{ word: string; tags: string[]; timestamp: number }> };
    drive: { total: number; withTags: number; sample: Array<{ word: string; tags: string[]; timestamp: number }> };
    versions: { local: Record<string, number>; remote: Record<string, number> };
  }> {
    const token = await DriveAuth.getValidToken();
    const meta = await getLocalMeta();
    const localIndex = await getLocalIndex();

    // Local 진단
    const localAll: VocabEntry[] = [];
    for (const date of localIndex.dates) {
      const entries = await getLocalEntries(date);
      localAll.push(...entries);
    }

    // Drive 진단
    const driveAll: VocabEntry[] = [];
    let remoteMeta: DriveSyncMeta = { partitionVersions: {}, deletedEntries: {} };

    if (token) {
      const metaFileId = await ensureDriveFileId(token, meta, DRIVE_META_FILE);
      if (metaFileId) {
        try {
          remoteMeta = await DriveAPI.getFile<DriveSyncMeta>(token, metaFileId);
        } catch { /* ignore */ }
      }

      const allDates = new Set([
        ...localIndex.dates,
        ...Object.keys(remoteMeta.partitionVersions),
      ]);

      for (const date of allDates) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
        const fileName = drivePartitionName(date);
        const fileId = await ensureDriveFileId(token, meta, fileName);
        if (fileId) {
          try {
            const content = await DriveAPI.getFile<DrivePartitionContent>(token, fileId);
            driveAll.push(...content.entries);
          } catch { /* ignore */ }
        }
      }
    }

    const sample = (arr: VocabEntry[]) => arr.slice(0, 3).map(e => ({
      word: e.word, tags: e.tags ?? [], timestamp: e.timestamp,
    }));

    return {
      local: {
        total: localAll.length,
        withTags: localAll.filter(e => (e.tags ?? []).length > 0).length,
        sample: sample(localAll),
      },
      drive: {
        total: driveAll.length,
        withTags: driveAll.filter(e => (e.tags ?? []).length > 0).length,
        sample: sample(driveAll),
      },
      versions: {
        local: meta.partitionVersions,
        remote: remoteMeta.partitionVersions,
      },
    };
  },
};

/**
 * ctx 있으면 병렬 push에서 사용하는 코어 로직.
 * meta write + index write 제거, versionPatches에만 누적.
 */
async function pushPartitionCore(
  token: string,
  date: string,
  meta: SyncMetadata,
  ctx: SyncContext
): Promise<number> {
  let entries = await getLocalEntries(date);
  const version = Date.now();

  const fileName = drivePartitionName(date);
  const fileId = resolveFileId(ctx.fileIdMap, ctx.localDriveFileIds, fileName);

  // Merge-before-push
  let remoteEntries: VocabEntry[] = [];
  if (fileId) {
    try {
      const remote = await DriveAPI.getFile<DrivePartitionContent>(token, fileId);
      remoteEntries = remote.entries;
      entries = mergeEntries(entries, remoteEntries, meta.deletedEntries);
      await saveLocalEntries(date, entries);
    } catch {
      // Drive 읽기 실패 → 로컬만 push
    }
  }

  const changedCount = countChangedEntries(remoteEntries, entries);
  const content: DrivePartitionContent = { date, entries, version };

  if (fileId) {
    await DriveAPI.updateFile(token, fileId, content);
  } else {
    const newId = await DriveAPI.createFile(token, fileName, content);
    meta.driveFileIds[fileName] = newId;
    ctx.localDriveFileIds[fileName] = newId;
  }

  meta.partitionVersions[date] = version;
  ctx.versionPatches.partitionVersions[date] = version;

  return changedCount;
}

/**
 * 단건 push — pushPartition(debounce) 경로에서 사용.
 * ctx 미사용, 기존 ensureDriveFileId 캐시 활용.
 * 개선: meta write + index write를 Promise.all로 병렬화.
 */
async function pushPartitionImmediate(date: string): Promise<number> {
  const token = await DriveAuth.getValidToken();
  if (!token) return 0;

  const meta = await getLocalMeta();
  let entries = await getLocalEntries(date);
  const version = Date.now();

  const fileName = drivePartitionName(date);
  const fileId = await ensureDriveFileId(token, meta, fileName);

  // Merge-before-push: Drive 데이터와 머지하여 덮어쓰기 방지
  let remoteEntries: VocabEntry[] = [];
  if (fileId) {
    try {
      const remote = await DriveAPI.getFile<DrivePartitionContent>(token, fileId);
      remoteEntries = remote.entries;
      entries = mergeEntries(entries, remoteEntries, meta.deletedEntries);
      await saveLocalEntries(date, entries);
    } catch {
      // Drive 읽기 실패 → 로컬만 push
    }
  }

  const changedCount = countChangedEntries(remoteEntries, entries);
  const content: DrivePartitionContent = { date, entries, version };

  if (fileId) {
    await DriveAPI.updateFile(token, fileId, content);
  } else {
    const newId = await DriveAPI.createFile(token, fileName, content);
    meta.driveFileIds[fileName] = newId;
  }

  meta.partitionVersions[date] = version;
  meta.lastSyncTimestamp = Date.now();

  // Merge metadata with remote (max version per date → 버전 역행 방지)
  const metaFileId = await ensureDriveFileId(token, meta, DRIVE_META_FILE);
  let remoteVersions: Record<string, number> = {};
  let remoteDeleted: Record<string, number> = {};
  let remoteFsrsPartitionVersions: Record<string, number> | undefined;
  let remoteReviewPartitionVersions: Record<string, number> | undefined;

  if (metaFileId) {
    try {
      const existing = await DriveAPI.getFile<DriveSyncMeta>(token, metaFileId);
      remoteVersions = existing.partitionVersions || {};
      remoteDeleted = existing.deletedEntries || {};
      remoteFsrsPartitionVersions = existing.fsrsPartitionVersions;
      remoteReviewPartitionVersions = existing.reviewPartitionVersions;
    } catch {
      // 리모트 읽기 실패
    }
  }

  // 리모트 메타에 쓸 버전: 로컬 + 리모트를 Math.max 머지 (버전 역행 방지)
  // 주의: 로컬 meta.partitionVersions에는 반영하지 않음.
  // 로컬에 반영하면 아직 pull하지 않은 날짜의 버전까지 로컬에 기록되어
  // 이후 pull 시 "이미 최신"으로 판단하여 동기화가 누락됨.
  const mergedVersions = { ...remoteVersions };
  for (const [d, v] of Object.entries(meta.partitionVersions)) {
    mergedVersions[d] = Math.max(v, mergedVersions[d] || 0);
  }

  const remoteSyncMeta: DriveSyncMeta = {
    partitionVersions: mergedVersions,
    deletedEntries: cleanTombstones({ ...remoteDeleted, ...meta.deletedEntries }),
    fsrsPartitionVersions: remoteFsrsPartitionVersions,
    reviewPartitionVersions: remoteReviewPartitionVersions,
  };

  // 로컬 meta 먼저 저장 — Drive write 실패해도 다음 sync에서 localVersion > remoteVersion으로 재시도
  await saveLocalMeta(meta);

  // meta write + index write 병렬화 (~200ms 절약)
  const localIndex = await getLocalIndex();
  const indexFileId = await ensureDriveFileId(token, meta, DRIVE_INDEX_FILE);

  try {
    let newFileIds = false;
    const metaWritePromise = metaFileId
      ? DriveAPI.updateFile(token, metaFileId, remoteSyncMeta)
      : DriveAPI.createFile(token, DRIVE_META_FILE, remoteSyncMeta).then(newId => { meta.driveFileIds[DRIVE_META_FILE] = newId; newFileIds = true; });

    const indexWritePromise = indexFileId
      ? DriveAPI.updateFile(token, indexFileId, localIndex)
      : DriveAPI.createFile(token, DRIVE_INDEX_FILE, localIndex).then(newId => { meta.driveFileIds[DRIVE_INDEX_FILE] = newId; newFileIds = true; });

    await Promise.all([metaWritePromise, indexWritePromise]);

    // 새 driveFileIds 반영을 위해 재저장
    if (newFileIds) await saveLocalMeta(meta);
  } catch (e) {
    console.error('[SYNC] pushPartitionImmediate: Drive meta/index write failed, will retry next sync:', e);
  }

  return changedCount;
}

async function rebuildLocalIndex(): Promise<void> {
  const allData = await chrome.storage.local.get(null);
  const dates: string[] = [];
  let totalCount = 0;
  const isValidDate = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d);

  for (const [key, value] of Object.entries(allData)) {
    if (key.startsWith(VOCAB_PREFIX) && key !== VOCAB_INDEX_KEY && key !== SEARCH_INDEX_KEY) {
      const date = key.slice(VOCAB_PREFIX.length);
      if (!isValidDate(date)) continue;
      const entries = value as VocabEntry[];
      if (entries.length > 0) {
        dates.push(date);
        totalCount += entries.length;
      }
    }
  }

  dates.sort((a, b) => b.localeCompare(a));
  await saveLocalIndex({ dates, totalCount });
}
