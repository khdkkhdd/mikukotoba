import type { SyncMetadata, SyncResult, VocabEntry, VocabStorageIndex } from '@/types';
import type { DrivePartitionContent, DriveSyncMeta } from '@mikukotoba/shared';
import { DriveAuth } from './drive-auth';
import { DriveAPI } from '@mikukotoba/shared';
import {
  mergeEntries,
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
  }> = [];

  for (const date of index.dates) {
    const entries: VocabEntry[] = data[vocabDateKey(date)] || [];
    for (const e of entries) {
      searchEntries.push({
        id: e.id, date: e.dateAdded, word: e.word,
        reading: e.reading, romaji: e.romaji,
        meaning: e.meaning, note: e.note,
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

    const meta = await getLocalMeta();
    let pulled = 0;
    let pushed = 0;
    let changed = false;

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
    const allDates = new Set([
      ...localIndex.dates,
      ...Object.keys(remoteMeta.partitionVersions),
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

            const merged = mergeEntries(
              localEntries,
              remote.entries,
              meta.deletedEntries
            );

            await saveLocalEntries(date, merged);
            meta.partitionVersions[date] = remoteVersion;
            pulled++;
            changed = true;
          } catch {
            // Skip this partition on error
          }
        }
      } else if (localVersion > remoteVersion) {
        await pushPartitionImmediate(date);
        pushed++;
      } else if (localVersion === 0 && remoteVersion === 0) {
        // Never synced — push if local entries exist
        const localEntries = await getLocalEntries(date);
        if (localEntries.length > 0) {
          await pushPartitionImmediate(date);
          pushed++;
        }
      }
    }

    meta.deletedEntries = cleanTombstones(meta.deletedEntries);
    meta.lastSyncTimestamp = Date.now();
    await saveLocalMeta(meta);

    if (changed) {
      await rebuildLocalIndex();
      await rebuildSearchIndex();
    }

    return { changed, pulled, pushed };
  },
};

async function pushPartitionImmediate(date: string): Promise<void> {
  const token = await DriveAuth.getValidToken();
  if (!token) return;

  const meta = await getLocalMeta();
  const entries = await getLocalEntries(date);
  const version = Date.now();

  const content: DrivePartitionContent = { date, entries, version };

  const fileName = drivePartitionName(date);
  const fileId = await ensureDriveFileId(token, meta, fileName);

  if (fileId) {
    await DriveAPI.updateFile(token, fileId, content);
  } else {
    const newId = await DriveAPI.createFile(token, fileName, content);
    meta.driveFileIds[fileName] = newId;
  }

  meta.partitionVersions[date] = version;
  meta.lastSyncTimestamp = Date.now();

  const remoteSyncMeta: DriveSyncMeta = {
    partitionVersions: { ...meta.partitionVersions },
    deletedEntries: cleanTombstones(meta.deletedEntries),
  };

  const metaFileId = await ensureDriveFileId(token, meta, DRIVE_META_FILE);
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
}

async function rebuildLocalIndex(): Promise<void> {
  const allData = await chrome.storage.local.get(null);
  const dates: string[] = [];
  let totalCount = 0;

  for (const [key, value] of Object.entries(allData)) {
    if (key.startsWith(VOCAB_PREFIX) && key !== VOCAB_INDEX_KEY) {
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
