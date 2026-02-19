import type { SQLiteDatabase } from 'expo-sqlite';
import type { VocabEntry, DrivePartitionContent, DriveSyncMeta, SyncResult } from '@jp-helper/shared';
import {
  DriveAPI,
  mergeEntries,
  cleanTombstones,
  drivePartitionName,
  DRIVE_META_FILE,
} from '@jp-helper/shared';
import * as db from '../db';
import { getAccessToken } from './drive-auth';

async function getLocalSyncMeta(database: SQLiteDatabase) {
  const raw = await db.getSyncMeta(database, 'sync_metadata');
  if (!raw) {
    return {
      partitionVersions: {} as Record<string, number>,
      driveFileIds: {} as Record<string, string>,
    };
  }
  return JSON.parse(raw) as {
    partitionVersions: Record<string, number>;
    driveFileIds: Record<string, string>;
  };
}

async function saveLocalSyncMeta(
  database: SQLiteDatabase,
  meta: { partitionVersions: Record<string, number>; driveFileIds: Record<string, string> }
) {
  await db.setSyncMeta(database, 'sync_metadata', JSON.stringify(meta));
}

async function ensureDriveFileId(
  token: string,
  meta: { driveFileIds: Record<string, string> },
  fileName: string
): Promise<string | null> {
  if (meta.driveFileIds[fileName]) return meta.driveFileIds[fileName];
  const fileId = await DriveAPI.findFileByName(token, fileName);
  if (fileId) {
    meta.driveFileIds[fileName] = fileId;
  }
  return fileId;
}

export async function pullFromDrive(database: SQLiteDatabase): Promise<SyncResult> {
  const token = await getAccessToken();
  if (!token) return { changed: false, pulled: 0, pushed: 0 };

  const meta = await getLocalSyncMeta(database);
  const tombstones = await db.getTombstones(database);
  let pulled = 0;
  let changed = false;

  // Get remote metadata
  let remoteMeta: DriveSyncMeta = { partitionVersions: {}, deletedEntries: {} };
  const remoteMetaFileId = await ensureDriveFileId(token, meta, DRIVE_META_FILE);

  if (remoteMetaFileId) {
    try {
      remoteMeta = await DriveAPI.getFile<DriveSyncMeta>(token, remoteMetaFileId);
    } catch {
      // First sync
    }
  }

  // Apply remote deletions locally
  for (const [entryId, remoteTs] of Object.entries(remoteMeta.deletedEntries || {})) {
    const localTs = tombstones[entryId];
    if (!localTs || remoteTs > localTs) {
      await db.addTombstone(database, entryId);
      await db.deleteEntry(database, entryId);
    }
  }

  // Merge all remote partitions that are newer
  const allDates = Object.keys(remoteMeta.partitionVersions);

  for (const date of allDates) {
    const localVersion = meta.partitionVersions[date] || 0;
    const remoteVersion = remoteMeta.partitionVersions[date] || 0;

    if (remoteVersion > localVersion) {
      const fileName = drivePartitionName(date);
      const fileId = await ensureDriveFileId(token, meta, fileName);
      if (fileId) {
        try {
          const remote = await DriveAPI.getFile<DrivePartitionContent>(token, fileId);
          const localEntries = await db.getEntriesByDate(database, date);
          const currentTombstones = await db.getTombstones(database);

          const merged = mergeEntries(localEntries, remote.entries, currentTombstones);
          await db.upsertEntries(database, merged);
          meta.partitionVersions[date] = remoteVersion;
          pulled++;
          changed = true;
        } catch {
          // Skip on error
        }
      }
    }
  }

  // Clean old tombstones (30 days)
  await db.cleanOldTombstones(database, 30 * 24 * 60 * 60 * 1000);

  await saveLocalSyncMeta(database, meta);
  await db.setSyncMeta(database, 'last_sync', String(Date.now()));

  return { changed, pulled, pushed: 0 };
}

export async function pushToDrive(database: SQLiteDatabase, dates: string[]): Promise<number> {
  const token = await getAccessToken();
  if (!token) return 0;

  const meta = await getLocalSyncMeta(database);
  let pushed = 0;

  for (const date of dates) {
    const entries = await db.getEntriesByDate(database, date);
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
    pushed++;
  }

  // Update remote metadata
  const tombstones = await db.getTombstones(database);
  const remoteSyncMeta: DriveSyncMeta = {
    partitionVersions: { ...meta.partitionVersions },
    deletedEntries: cleanTombstones(tombstones),
  };

  const metaFileId = await ensureDriveFileId(token, meta, DRIVE_META_FILE);
  if (metaFileId) {
    await DriveAPI.updateFile(token, metaFileId, remoteSyncMeta);
  } else {
    const newId = await DriveAPI.createFile(token, DRIVE_META_FILE, remoteSyncMeta);
    meta.driveFileIds[DRIVE_META_FILE] = newId;
  }

  await saveLocalSyncMeta(database, meta);
  return pushed;
}
