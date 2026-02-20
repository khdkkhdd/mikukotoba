import type { SyncMetadata, SyncResult, VocabEntry, VocabStorageIndex } from '@/types';
import type { DrivePartitionContent, DriveSyncMeta } from '@mikukotoba/shared';
import { DriveAuth } from './drive-auth';
import { DriveAPI } from '@mikukotoba/shared';
import {
  mergeEntries,
  countChangedEntries,
  cleanTombstones,
  drivePartitionName,
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

  async pushAll(): Promise<number> {
    const index = await getLocalIndex();
    let pushed = 0;
    for (const date of index.dates) {
      try {
        pushed += await pushPartitionImmediate(date);
      } catch {
        // Best effort per partition
      }
    }
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
    let needMetaPush = false;

    let remoteMeta: DriveSyncMeta = { partitionVersions: {}, deletedEntries: {} };
    const remoteMetaFileId = await ensureDriveFileId(token, meta, DRIVE_META_FILE);

    if (remoteMetaFileId) {
      try {
        remoteMeta = await DriveAPI.getFile<DriveSyncMeta>(token, remoteMetaFileId);
      } catch {
        // First sync or corrupted — start fresh
      }
    }

    for (const [entryId, remoteTs] of Object.entries(remoteMeta.deletedEntries || {})) {
      const localTs = meta.deletedEntries[entryId];
      if (!localTs || remoteTs > localTs) {
        meta.deletedEntries[entryId] = remoteTs;
      }
    }

    const localIndex = await getLocalIndex();
    const isValidDate = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d);
    const allDates = new Set([
      ...localIndex.dates.filter(isValidDate),
      ...Object.keys(remoteMeta.partitionVersions).filter(isValidDate),
    ]);

    for (const date of allDates) {
      const localVersion = meta.partitionVersions[date] || 0;
      const remoteVersion = remoteMeta.partitionVersions[date] || 0;

      if (remoteVersion > localVersion) {
        const fileName = drivePartitionName(date);
        const fileId = await ensureDriveFileId(token, meta, fileName);
        if (fileId) {
          try {
            const remote = await DriveAPI.getFile<DrivePartitionContent>(token, fileId);
            const localEntries = await getLocalEntries(date);

            // Pull: remote 우선 (인자 순서 반전 → equal timestamp에서 remote 승리)
            const merged = mergeEntries(
              remote.entries,
              localEntries,
              meta.deletedEntries
            );

            const pullChanges = countChangedEntries(localEntries, merged);
            await saveLocalEntries(date, merged);
            pulled += pullChanges;
            if (pullChanges > 0) changed = true;

            // Push-back: 로컬 엔트리가 merge에 반영됐으면 Drive에도 반영
            if (localEntries.length > 0) {
              const pushChanges = countChangedEntries(remote.entries, merged);
              const version = Date.now();
              await DriveAPI.updateFile(token, fileId, { date, entries: merged, version });
              meta.partitionVersions[date] = version;
              pushed += pushChanges;
              needMetaPush = true;
            } else {
              meta.partitionVersions[date] = remoteVersion;
            }
          } catch {
            // Skip this partition on error
          }
        }
      } else if (localVersion > remoteVersion) {
        pushed += await pushPartitionImmediate(date);
        // pushPartitionImmediate가 meta를 별도로 저장하므로 최신 상태 반영
        meta = await getLocalMeta();
      } else if (localVersion === 0 && remoteVersion === 0) {
        // Never synced — push if local entries exist
        const localEntries = await getLocalEntries(date);
        if (localEntries.length > 0) {
          pushed += await pushPartitionImmediate(date);
          meta = await getLocalMeta();
        }
      }
    }

    // Pull-merge push-back 후 Drive 메타 업데이트
    if (needMetaPush) {
      const metaFileId = await ensureDriveFileId(token, meta, DRIVE_META_FILE);

      // Remote와 머지 (max version per date)
      let remoteVersions: Record<string, number> = {};
      let remoteDeleted: Record<string, number> = {};
      if (metaFileId) {
        try {
          const existing = await DriveAPI.getFile<DriveSyncMeta>(token, metaFileId);
          remoteVersions = existing.partitionVersions || {};
          remoteDeleted = existing.deletedEntries || {};
        } catch { /* ignore */ }
      }

      const mergedVersions = { ...remoteVersions };
      for (const [d, v] of Object.entries(meta.partitionVersions)) {
        mergedVersions[d] = Math.max(v, mergedVersions[d] || 0);
      }
      meta.partitionVersions = mergedVersions;

      const syncMeta: DriveSyncMeta = {
        partitionVersions: mergedVersions,
        deletedEntries: cleanTombstones({ ...remoteDeleted, ...meta.deletedEntries }),
      };

      if (metaFileId) {
        await DriveAPI.updateFile(token, metaFileId, syncMeta);
      } else {
        const newId = await DriveAPI.createFile(token, DRIVE_META_FILE, syncMeta);
        meta.driveFileIds[DRIVE_META_FILE] = newId;
      }
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

  if (metaFileId) {
    try {
      const existing = await DriveAPI.getFile<DriveSyncMeta>(token, metaFileId);
      remoteVersions = existing.partitionVersions || {};
      remoteDeleted = existing.deletedEntries || {};
    } catch {
      // 리모트 읽기 실패
    }
  }

  const mergedVersions = { ...remoteVersions };
  for (const [d, v] of Object.entries(meta.partitionVersions)) {
    mergedVersions[d] = Math.max(v, mergedVersions[d] || 0);
  }
  meta.partitionVersions = mergedVersions;

  const remoteSyncMeta: DriveSyncMeta = {
    partitionVersions: mergedVersions,
    deletedEntries: cleanTombstones({ ...remoteDeleted, ...meta.deletedEntries }),
  };

  if (metaFileId) {
    await DriveAPI.updateFile(token, metaFileId, remoteSyncMeta);
  } else {
    const newId = await DriveAPI.createFile(token, DRIVE_META_FILE, remoteSyncMeta);
    meta.driveFileIds[DRIVE_META_FILE] = newId;
  }

  const localIndex = await getLocalIndex();
  const indexFileId = await ensureDriveFileId(token, meta, DRIVE_INDEX_FILE);
  if (indexFileId) {
    await DriveAPI.updateFile(token, indexFileId, localIndex);
  } else {
    const newId = await DriveAPI.createFile(token, DRIVE_INDEX_FILE, localIndex);
    meta.driveFileIds[DRIVE_INDEX_FILE] = newId;
  }

  await saveLocalMeta(meta);
  return changedCount;
}

async function rebuildLocalIndex(): Promise<void> {
  const allData = await chrome.storage.local.get(null);
  const dates: string[] = [];
  let totalCount = 0;

  for (const [key, value] of Object.entries(allData)) {
    if (key.startsWith(VOCAB_PREFIX) && key !== VOCAB_INDEX_KEY && key !== SEARCH_INDEX_KEY) {
      const date = key.slice(VOCAB_PREFIX.length);
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
