import type { SQLiteDatabase } from 'expo-sqlite';
import type { VocabEntry, DrivePartitionContent, DriveSyncMeta, SyncResult, DriveFsrsState, DriveReviewLogState } from '@mikukotoba/shared';
import {
  DriveAPI,
  mergeEntries,
  countChangedEntries,
  cleanTombstones,
  mergeFsrsStates,
  mergeReviewLogs,
  drivePartitionName,
  DRIVE_META_FILE,
  DRIVE_FSRS_FILE,
  DRIVE_REVIEW_LOG_FILE,
} from '@mikukotoba/shared';
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
  if (!token) {
    console.warn('[SYNC] pullFromDrive: no token, skipping');
    return { changed: false, pulled: 0, pushed: 0 };
  }

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
    } catch (e) {
      console.error('[SYNC] failed to read remote metadata:', e);
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

  // Merge all remote partitions that are newer (skip invalid date keys)
  const isValidDate = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d);
  const allDates = Object.keys(remoteMeta.partitionVersions).filter(isValidDate);

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

          // Pull: remote 우선 (인자 순서 반전 → equal timestamp에서 remote 승리)
          const merged = mergeEntries(remote.entries, localEntries, currentTombstones);
          const partitionChanges = countChangedEntries(localEntries, merged);
          await db.upsertEntries(database, merged);
          meta.partitionVersions[date] = remoteVersion;
          pulled += partitionChanges;
          if (partitionChanges > 0) changed = true;
        } catch (e) {
          console.error('[SYNC] failed to pull partition', date, e);
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
  if (!token) {
    console.warn('[SYNC] pushToDrive: no token, skipping');
    return 0;
  }

  const meta = await getLocalSyncMeta(database);
  const tombstones = await db.getTombstones(database);
  let pushed = 0;

  for (const date of dates) {
    let entries = await db.getEntriesByDate(database, date);
    const fileName = drivePartitionName(date);
    const fileId = await ensureDriveFileId(token, meta, fileName);

    // Merge-before-push: Drive 데이터와 머지하여 덮어쓰기 방지
    let remoteEntries: VocabEntry[] = [];
    if (fileId) {
      try {
        const remote = await DriveAPI.getFile<DrivePartitionContent>(token, fileId);
        remoteEntries = remote.entries;
        entries = mergeEntries(entries, remoteEntries, tombstones);
        await db.upsertEntries(database, entries);
      } catch {
        // Drive 읽기 실패 → 로컬만 push
      }
    }

    const version = Date.now();
    const content: DrivePartitionContent = { date, entries, version };

    if (fileId) {
      await DriveAPI.updateFile(token, fileId, content);
    } else {
      const newId = await DriveAPI.createFile(token, fileName, content);
      meta.driveFileIds[fileName] = newId;
    }

    meta.partitionVersions[date] = version;
    pushed += countChangedEntries(remoteEntries, entries);
  }

  // Merge metadata with remote (max version per date → 버전 역행 방지)
  const metaFileId = await ensureDriveFileId(token, meta, DRIVE_META_FILE);
  let remoteVersions: Record<string, number> = {};
  let remoteDeleted: Record<string, number> = {};

  if (metaFileId) {
    try {
      const remoteMeta = await DriveAPI.getFile<DriveSyncMeta>(token, metaFileId);
      remoteVersions = remoteMeta.partitionVersions || {};
      remoteDeleted = remoteMeta.deletedEntries || {};
    } catch {
      // 리모트 읽기 실패 → 로컬만 사용
    }
  }

  const mergedVersions = { ...remoteVersions };
  for (const [date, version] of Object.entries(meta.partitionVersions)) {
    mergedVersions[date] = Math.max(version, mergedVersions[date] || 0);
  }
  meta.partitionVersions = mergedVersions;

  const remoteSyncMeta: DriveSyncMeta = {
    partitionVersions: mergedVersions,
    deletedEntries: cleanTombstones({ ...remoteDeleted, ...tombstones }),
  };

  if (metaFileId) {
    await DriveAPI.updateFile(token, metaFileId, remoteSyncMeta);
  } else {
    const newId = await DriveAPI.createFile(token, DRIVE_META_FILE, remoteSyncMeta);
    meta.driveFileIds[DRIVE_META_FILE] = newId;
  }

  await saveLocalSyncMeta(database, meta);
  return pushed;
}

export async function pullFsrsState(database: SQLiteDatabase): Promise<boolean> {
  const token = await getAccessToken();
  if (!token) return false;

  const meta = await getLocalSyncMeta(database);

  const fileId = await ensureDriveFileId(token, meta, DRIVE_FSRS_FILE);
  if (!fileId) {
    await saveLocalSyncMeta(database, meta);
    return false;
  }

  let remote: DriveFsrsState;
  try {
    remote = await DriveAPI.getFile<DriveFsrsState>(token, fileId);
  } catch {
    return false;
  }

  // 로컬 버전 비교
  const localVersionStr = await db.getSyncMeta(database, 'fsrs_version');
  const localVersion = localVersionStr ? Number(localVersionStr) : 0;

  if (remote.version <= localVersion) {
    return false;
  }

  // 머지
  const localStates = await db.getAllCardStates(database);
  const localFsrs: DriveFsrsState = { cardStates: localStates, version: localVersion };
  const merged = mergeFsrsStates(localFsrs, remote);

  await db.upsertCardStates(database, merged.cardStates);
  await db.setSyncMeta(database, 'fsrs_version', String(merged.version));
  await saveLocalSyncMeta(database, meta);

  return true;
}

export async function pushFsrsState(database: SQLiteDatabase): Promise<void> {
  const token = await getAccessToken();
  if (!token) return;

  const meta = await getLocalSyncMeta(database);
  const cardStates = await db.getAllCardStates(database);

  const version = Date.now();
  const content: DriveFsrsState = { cardStates, version };

  const fileId = await ensureDriveFileId(token, meta, DRIVE_FSRS_FILE);
  if (fileId) {
    await DriveAPI.updateFile(token, fileId, content);
  } else {
    const newId = await DriveAPI.createFile(token, DRIVE_FSRS_FILE, content);
    meta.driveFileIds[DRIVE_FSRS_FILE] = newId;
  }

  await db.setSyncMeta(database, 'fsrs_version', String(version));
  await saveLocalSyncMeta(database, meta);
}

export async function pushReviewLogs(database: SQLiteDatabase): Promise<void> {
  const token = await getAccessToken();
  if (!token) return;

  const meta = await getLocalSyncMeta(database);
  const localLogs = await db.getAllReviewLogs(database);

  const localVersionStr = await db.getSyncMeta(database, 'review_log_version');
  const localVersion = localVersionStr ? Number(localVersionStr) : 0;
  let localState: DriveReviewLogState = { logs: localLogs, version: localVersion };

  // merge-before-push: 리모트 파일이 있으면 머지
  const fileId = await ensureDriveFileId(token, meta, DRIVE_REVIEW_LOG_FILE);
  if (fileId) {
    try {
      const remote = await DriveAPI.getFile<DriveReviewLogState>(token, fileId);
      const merged = mergeReviewLogs(localState, remote);
      localState = merged;
      // 머지된 결과를 로컬 DB에도 반영
      await db.replaceAllReviewLogs(database, merged.logs);
    } catch {
      // 리모트 읽기 실패 → 로컬만 push
    }
  }

  const version = Date.now();
  const content: DriveReviewLogState = { logs: localState.logs, version };

  if (fileId) {
    await DriveAPI.updateFile(token, fileId, content);
  } else {
    const newId = await DriveAPI.createFile(token, DRIVE_REVIEW_LOG_FILE, content);
    meta.driveFileIds[DRIVE_REVIEW_LOG_FILE] = newId;
  }

  await db.setSyncMeta(database, 'review_log_version', String(version));
  await saveLocalSyncMeta(database, meta);
}

export async function pullReviewLogs(database: SQLiteDatabase): Promise<boolean> {
  const token = await getAccessToken();
  if (!token) return false;

  const meta = await getLocalSyncMeta(database);

  const fileId = await ensureDriveFileId(token, meta, DRIVE_REVIEW_LOG_FILE);
  if (!fileId) {
    await saveLocalSyncMeta(database, meta);
    return false;
  }

  let remote: DriveReviewLogState;
  try {
    remote = await DriveAPI.getFile<DriveReviewLogState>(token, fileId);
  } catch {
    return false;
  }

  const localVersionStr = await db.getSyncMeta(database, 'review_log_version');
  const localVersion = localVersionStr ? Number(localVersionStr) : 0;

  if (remote.version <= localVersion) {
    return false;
  }

  const localLogs = await db.getAllReviewLogs(database);
  const localState: DriveReviewLogState = { logs: localLogs, version: localVersion };
  const merged = mergeReviewLogs(localState, remote);

  await db.replaceAllReviewLogs(database, merged.logs);
  await db.setSyncMeta(database, 'review_log_version', String(merged.version));
  await saveLocalSyncMeta(database, meta);

  return true;
}
