import type { SQLiteDatabase } from 'expo-sqlite';
import type { VocabEntry, DrivePartitionContent, DriveSyncMeta, SyncResult, DriveFsrsState, DriveReviewLogState, SyncContext } from '@mikukotoba/shared';
import {
  DriveAPI,
  mergeEntries,
  countChangedEntries,
  cleanTombstones,
  mergeFsrsStates,
  mergeReviewLogs,
  drivePartitionName,
  driveFsrsPartitionName,
  driveReviewPartitionName,
  resolveFileId,
  parallelMap,
  createSyncContext,
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

/** SyncContext 생성 헬퍼 (token 획득 + localDriveFileIds 로드 포함) */
export async function createSyncContextFromDb(database: SQLiteDatabase): Promise<{ ctx: SyncContext; meta: ReturnType<typeof getLocalSyncMeta> extends Promise<infer T> ? T : never } | null> {
  const token = await getAccessToken();
  if (!token) return null;

  const meta = await getLocalSyncMeta(database);
  const ctx = await createSyncContext(token, meta.driveFileIds);
  return { ctx, meta };
}

export async function pullFromDrive(database: SQLiteDatabase, ctx?: SyncContext, remoteMeta?: DriveSyncMeta): Promise<SyncResult> {
  const token = ctx?.token ?? await getAccessToken();
  if (!token) {
    console.warn('[SYNC] pullFromDrive: no token, skipping');
    return { changed: false, pulled: 0, pushed: 0 };
  }

  const meta = await getLocalSyncMeta(database);
  const tombstones = await db.getTombstones(database);
  let pulled = 0;
  let changed = false;

  // remoteMeta 결정: ctx > 인자 > 직접 읽기
  if (!remoteMeta && ctx) {
    remoteMeta = ctx.remoteMeta;
  }
  if (!remoteMeta) {
    const remoteMetaFileId = await ensureDriveFileId(token, meta, DRIVE_META_FILE);
    remoteMeta = { partitionVersions: {}, deletedEntries: {} };
    if (remoteMetaFileId) {
      try {
        remoteMeta = await DriveAPI.getFile<DriveSyncMeta>(token, remoteMetaFileId);
      } catch (e) {
        console.error('[SYNC] failed to read remote metadata:', e);
      }
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

  // dirty 날짜만 필터
  const dirtyDates = allDates.filter(date => {
    const localVersion = meta.partitionVersions[date] || 0;
    const remoteVersion = remoteMeta!.partitionVersions[date] || 0;
    return remoteVersion > localVersion;
  });

  // 파티션 fetch 병렬화
  const fetchResults = await parallelMap(dirtyDates, async (date) => {
    const fileName = drivePartitionName(date);
    const fileId = ctx
      ? resolveFileId(ctx.fileIdMap, ctx.localDriveFileIds, fileName)
      : await ensureDriveFileId(token, meta, fileName);
    if (!fileId) return null;

    const remote = await DriveAPI.getFile<DrivePartitionContent>(token, fileId);
    return { date, remote, remoteVersion: remoteMeta!.partitionVersions[date] || 0 };
  });

  // DB 쓰기는 순차
  for (const result of fetchResults) {
    if (result.status !== 'fulfilled' || !result.value) continue;
    const { date, remote, remoteVersion } = result.value;

    try {
      const localEntries = await db.getEntriesByDate(database, date);
      const currentTombstones = await db.getTombstones(database);
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

  // Clean old tombstones (30 days)
  await db.cleanOldTombstones(database, 30 * 24 * 60 * 60 * 1000);

  await saveLocalSyncMeta(database, meta);
  await db.setSyncMeta(database, 'last_sync', String(Date.now()));

  return { changed, pulled, pushed: 0 };
}

export async function pushToDrive(database: SQLiteDatabase, dates: string[], ctx?: SyncContext): Promise<number> {
  const token = ctx?.token ?? await getAccessToken();
  if (!token) {
    console.warn('[SYNC] pushToDrive: no token, skipping');
    return 0;
  }

  const meta = await getLocalSyncMeta(database);
  const tombstones = await db.getTombstones(database);
  let pushed = 0;

  // merge-before-push를 병렬로 실행 (파일 읽기 병렬화)
  const pushResults = await parallelMap(dates, async (date) => {
    let entries = await db.getEntriesByDate(database, date);
    const fileName = drivePartitionName(date);
    const fileId = ctx
      ? resolveFileId(ctx.fileIdMap, ctx.localDriveFileIds, fileName)
      : await ensureDriveFileId(token, meta, fileName);

    // Merge-before-push
    let remoteEntries: VocabEntry[] = [];
    if (fileId) {
      try {
        const remote = await DriveAPI.getFile<DrivePartitionContent>(token, fileId);
        remoteEntries = remote.entries;
        entries = mergeEntries(entries, remoteEntries, tombstones);
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
      if (ctx) ctx.localDriveFileIds[fileName] = newId;
    }

    return { date, version, entries, remoteEntries };
  });

  // 결과 수집: DB 쓰기 + version patch 누적
  for (const result of pushResults) {
    if (result.status !== 'fulfilled') continue;
    const { date, version, entries, remoteEntries } = result.value;

    await db.upsertEntries(database, entries);
    meta.partitionVersions[date] = version;
    pushed += countChangedEntries(remoteEntries, entries);

    if (ctx) {
      ctx.versionPatches.partitionVersions[date] = version;
    }
  }

  if (ctx) {
    // ctx 사용 시 → commitSyncMeta에서 일괄 처리
    await saveLocalSyncMeta(database, meta);
    return pushed;
  }

  // ctx 미사용 (레거시 경로) → 기존 방식으로 meta 업데이트
  const metaFileId = await ensureDriveFileId(token, meta, DRIVE_META_FILE);
  let remoteVersions: Record<string, number> = {};
  let remoteDeleted: Record<string, number> = {};
  let remoteFsrsPartitionVersions: Record<string, number> | undefined;
  let remoteReviewPartitionVersions: Record<string, number> | undefined;

  if (metaFileId) {
    try {
      const remoteMeta = await DriveAPI.getFile<DriveSyncMeta>(token, metaFileId);
      remoteVersions = remoteMeta.partitionVersions || {};
      remoteDeleted = remoteMeta.deletedEntries || {};
      remoteFsrsPartitionVersions = remoteMeta.fsrsPartitionVersions;
      remoteReviewPartitionVersions = remoteMeta.reviewPartitionVersions;
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
    fsrsPartitionVersions: remoteFsrsPartitionVersions,
    reviewPartitionVersions: remoteReviewPartitionVersions,
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

// --- FSRS 파티션 동기화 ---

async function getLocalFsrsPartitionVersions(database: SQLiteDatabase): Promise<Record<string, number>> {
  const raw = await db.getSyncMeta(database, 'fsrs_partition_versions');
  return raw ? JSON.parse(raw) : {};
}

async function saveLocalFsrsPartitionVersions(database: SQLiteDatabase, versions: Record<string, number>): Promise<void> {
  await db.setSyncMeta(database, 'fsrs_partition_versions', JSON.stringify(versions));
}

async function getLocalReviewPartitionVersions(database: SQLiteDatabase): Promise<Record<string, number>> {
  const raw = await db.getSyncMeta(database, 'review_partition_versions');
  return raw ? JSON.parse(raw) : {};
}

async function saveLocalReviewPartitionVersions(database: SQLiteDatabase, versions: Record<string, number>): Promise<void> {
  await db.setSyncMeta(database, 'review_partition_versions', JSON.stringify(versions));
}

/**
 * 기존 모놀리식 fsrs_state.json → 월별 파티션으로 마이그레이션.
 * remoteMeta에 fsrsPartitionVersions가 비어있고 모놀리식 파일이 존재하면 실행.
 */
async function migrateLegacyFsrs(
  database: SQLiteDatabase,
  token: string,
  meta: { driveFileIds: Record<string, string> },
  ctx?: SyncContext
): Promise<Record<string, number> | null> {
  const fileId = ctx
    ? resolveFileId(ctx.fileIdMap, ctx.localDriveFileIds, DRIVE_FSRS_FILE)
    : await ensureDriveFileId(token, meta, DRIVE_FSRS_FILE);
  if (!fileId) return null;

  let legacy: DriveFsrsState;
  try {
    legacy = await DriveAPI.getFile<DriveFsrsState>(token, fileId);
  } catch {
    return null;
  }

  if (Object.keys(legacy.cardStates).length === 0) return null;

  // 로컬 DB에 머지
  const localStates = await db.getAllCardStates(database);
  const localFsrs: DriveFsrsState = { cardStates: localStates, version: 0 };
  const merged = mergeFsrsStates(localFsrs, legacy);
  await db.upsertCardStates(database, merged.cardStates);

  // vocabId → 월 매핑
  const allVocabIds = Object.keys(merged.cardStates);
  const months = await db.getVocabMonthsByIds(database, allVocabIds);

  // 모든 월에 대해 dirty 버전 생성
  const versions: Record<string, number> = {};
  for (const month of months) {
    versions[month] = 0; // pull 후 push에서 업데이트됨
  }

  console.log('[SYNC] Migrated legacy FSRS to partitions:', [...months]);
  return versions;
}

/**
 * 기존 모놀리식 review_logs.json → 월별 파티션으로 마이그레이션.
 */
async function migrateLegacyReviewLogs(
  database: SQLiteDatabase,
  token: string,
  meta: { driveFileIds: Record<string, string> },
  ctx?: SyncContext
): Promise<Record<string, number> | null> {
  const fileId = ctx
    ? resolveFileId(ctx.fileIdMap, ctx.localDriveFileIds, DRIVE_REVIEW_LOG_FILE)
    : await ensureDriveFileId(token, meta, DRIVE_REVIEW_LOG_FILE);
  if (!fileId) return null;

  let legacy: DriveReviewLogState;
  try {
    legacy = await DriveAPI.getFile<DriveReviewLogState>(token, fileId);
  } catch {
    return null;
  }

  if (legacy.logs.length === 0) return null;

  // 로컬 DB에 머지
  const localLogs = await db.getAllReviewLogs(database);
  const localState: DriveReviewLogState = { logs: localLogs, version: 0 };
  const merged = mergeReviewLogs(localState, legacy);
  await db.replaceAllReviewLogs(database, merged.logs);

  // 월별 그룹핑
  const months = new Set<string>();
  for (const log of merged.logs) {
    months.add(log.reviewed_at.slice(0, 7));
  }

  const versions: Record<string, number> = {};
  for (const month of months) {
    versions[month] = 0;
  }

  console.log('[SYNC] Migrated legacy review logs to partitions:', [...months]);
  return versions;
}

export async function pullFsrsPartitions(database: SQLiteDatabase, ctx?: SyncContext, remoteMeta?: DriveSyncMeta): Promise<boolean> {
  const token = ctx?.token ?? await getAccessToken();
  if (!token) return false;

  const meta = await getLocalSyncMeta(database);

  // remoteMeta 결정
  if (!remoteMeta && ctx) remoteMeta = ctx.remoteMeta;
  if (!remoteMeta) {
    const remoteMetaFileId = await ensureDriveFileId(token, meta, DRIVE_META_FILE);
    remoteMeta = { partitionVersions: {}, deletedEntries: {} };
    if (remoteMetaFileId) {
      try {
        remoteMeta = await DriveAPI.getFile<DriveSyncMeta>(token, remoteMetaFileId);
      } catch {
        // 리모트 읽기 실패
      }
    }
  }

  const remoteVersions = remoteMeta.fsrsPartitionVersions || {};
  let localVersions = await getLocalFsrsPartitionVersions(database);
  let changed = false;

  // 마이그레이션: 파티션 버전이 비어있고 레거시 파일이 존재하면
  if (Object.keys(remoteVersions).length === 0 && Object.keys(localVersions).length === 0) {
    const migrated = await migrateLegacyFsrs(database, token, meta, ctx);
    if (migrated) {
      localVersions = migrated;
      changed = true;

      // 마이그레이션 데이터를 파티션 파일로 Drive에 push
      for (const month of Object.keys(localVersions)) {
        const states = await db.getCardStatesByMonth(database, month);
        if (Object.keys(states).length === 0) continue;
        const version = Date.now();
        let content: DriveFsrsState = { cardStates: states, version };
        const fileName = driveFsrsPartitionName(month);
        const fileId = ctx
          ? resolveFileId(ctx.fileIdMap, ctx.localDriveFileIds, fileName)
          : await ensureDriveFileId(token, meta, fileName);
        if (fileId) {
          try {
            const remote = await DriveAPI.getFile<DriveFsrsState>(token, fileId);
            const merged = mergeFsrsStates(content, remote);
            merged.version = version;
            content = merged;
            await db.upsertCardStates(database, merged.cardStates);
          } catch { /* remote 읽기 실패 → 로컬만 push */ }
          await DriveAPI.updateFile(token, fileId, content);
        } else {
          const newId = await DriveAPI.createFile(token, fileName, content);
          meta.driveFileIds[fileName] = newId;
          if (ctx) ctx.localDriveFileIds[fileName] = newId;
        }
        localVersions[month] = version;
        if (ctx) ctx.versionPatches.fsrsPartitionVersions[month] = version;
      }

      if (!ctx) {
        await updateRemoteMeta(token, meta, { fsrsPartitionVersions: localVersions });
      }
    }
  }

  // 각 월별 파티션 pull — dirty만 필터 후 병렬 fetch
  const allMonths = [...new Set([...Object.keys(remoteVersions), ...Object.keys(localVersions)])];
  const dirtyMonths = allMonths.filter(month => {
    const remoteVersion = remoteVersions[month] || 0;
    const localVersion = localVersions[month] || 0;
    return remoteVersion > localVersion;
  });

  const fetchResults = await parallelMap(dirtyMonths, async (month) => {
    const fileName = driveFsrsPartitionName(month);
    const fileId = ctx
      ? resolveFileId(ctx.fileIdMap, ctx.localDriveFileIds, fileName)
      : await ensureDriveFileId(token, meta, fileName);
    if (!fileId) return null;

    const remote = await DriveAPI.getFile<DriveFsrsState>(token, fileId);
    return { month, remote, remoteVersion: remoteVersions[month] || 0 };
  });

  // DB 쓰기는 순차
  for (const result of fetchResults) {
    if (result.status !== 'fulfilled' || !result.value) continue;
    const { month, remote, remoteVersion } = result.value;

    try {
      const localStates = await db.getCardStatesByMonth(database, month);
      const localFsrs: DriveFsrsState = { cardStates: localStates, version: localVersions[month] || 0 };
      const merged = mergeFsrsStates(localFsrs, remote);

      await db.upsertCardStates(database, merged.cardStates);
      localVersions[month] = remoteVersion;
      changed = true;
    } catch (e) {
      console.error('[SYNC] Failed to pull FSRS partition', month, e);
    }
  }

  await saveLocalFsrsPartitionVersions(database, localVersions);
  await saveLocalSyncMeta(database, meta);
  return changed;
}

export async function pushFsrsPartitions(database: SQLiteDatabase, dirtyVocabIds: string[], ctx?: SyncContext): Promise<void> {
  const token = ctx?.token ?? await getAccessToken();
  if (!token) return;

  const meta = await getLocalSyncMeta(database);
  const months = await db.getVocabMonthsByIds(database, dirtyVocabIds);
  let localVersions = await getLocalFsrsPartitionVersions(database);

  // 월별 push를 병렬화
  const pushResults = await parallelMap([...months], async (month) => {
    const localStates = await db.getCardStatesByMonth(database, month);
    const version = Date.now();
    const content: DriveFsrsState = { cardStates: localStates, version };

    const fileName = driveFsrsPartitionName(month);
    const fileId = ctx
      ? resolveFileId(ctx.fileIdMap, ctx.localDriveFileIds, fileName)
      : await ensureDriveFileId(token, meta, fileName);

    // merge-before-push
    if (fileId) {
      try {
        const remote = await DriveAPI.getFile<DriveFsrsState>(token, fileId);
        const merged = mergeFsrsStates(content, remote);
        merged.version = version;
        await db.upsertCardStates(database, merged.cardStates);
        await DriveAPI.updateFile(token, fileId, merged);
      } catch {
        await DriveAPI.updateFile(token, fileId, content);
      }
    } else {
      const newId = await DriveAPI.createFile(token, fileName, content);
      meta.driveFileIds[fileName] = newId;
      if (ctx) ctx.localDriveFileIds[fileName] = newId;
    }

    return { month, version };
  });

  // 결과 수집
  for (const result of pushResults) {
    if (result.status !== 'fulfilled') continue;
    const { month, version } = result.value;
    localVersions[month] = version;
    if (ctx) {
      ctx.versionPatches.fsrsPartitionVersions[month] = version;
    }
  }

  if (!ctx) {
    // 레거시 경로: 개별 meta 업데이트
    await updateRemoteMeta(token, meta, { fsrsPartitionVersions: localVersions });
  }

  await saveLocalFsrsPartitionVersions(database, localVersions);
  await saveLocalSyncMeta(database, meta);
}

// --- 리뷰 로그 파티션 동기화 ---

export async function pullReviewLogPartitions(database: SQLiteDatabase, ctx?: SyncContext, remoteMeta?: DriveSyncMeta): Promise<boolean> {
  const token = ctx?.token ?? await getAccessToken();
  if (!token) return false;

  const meta = await getLocalSyncMeta(database);

  // remoteMeta 결정
  if (!remoteMeta && ctx) remoteMeta = ctx.remoteMeta;
  if (!remoteMeta) {
    const remoteMetaFileId = await ensureDriveFileId(token, meta, DRIVE_META_FILE);
    remoteMeta = { partitionVersions: {}, deletedEntries: {} };
    if (remoteMetaFileId) {
      try {
        remoteMeta = await DriveAPI.getFile<DriveSyncMeta>(token, remoteMetaFileId);
      } catch {
        // 리모트 읽기 실패
      }
    }
  }

  const remoteVersions = remoteMeta.reviewPartitionVersions || {};
  let localVersions = await getLocalReviewPartitionVersions(database);
  let changed = false;

  // 마이그레이션: 파티션 버전이 비어있고 레거시 파일이 존재하면
  if (Object.keys(remoteVersions).length === 0 && Object.keys(localVersions).length === 0) {
    const migrated = await migrateLegacyReviewLogs(database, token, meta, ctx);
    if (migrated) {
      localVersions = migrated;
      changed = true;

      // 마이그레이션 데이터를 파티션 파일로 Drive에 push
      for (const month of Object.keys(localVersions)) {
        const logs = await db.getReviewLogsByMonth(database, month);
        if (logs.length === 0) continue;
        const version = Date.now();
        let content: DriveReviewLogState = { logs, version };
        const fileName = driveReviewPartitionName(month);
        const fileId = ctx
          ? resolveFileId(ctx.fileIdMap, ctx.localDriveFileIds, fileName)
          : await ensureDriveFileId(token, meta, fileName);
        if (fileId) {
          try {
            const remote = await DriveAPI.getFile<DriveReviewLogState>(token, fileId);
            const merged = mergeReviewLogs({ logs, version: 0 }, remote);
            merged.version = version;
            content = merged;
            await db.replaceReviewLogsByMonth(database, month, merged.logs);
          } catch { /* remote 읽기 실패 → 로컬만 push */ }
          await DriveAPI.updateFile(token, fileId, content);
        } else {
          const newId = await DriveAPI.createFile(token, fileName, content);
          meta.driveFileIds[fileName] = newId;
          if (ctx) ctx.localDriveFileIds[fileName] = newId;
        }
        localVersions[month] = version;
        if (ctx) ctx.versionPatches.reviewPartitionVersions[month] = version;
      }

      if (!ctx) {
        await updateRemoteMeta(token, meta, { reviewPartitionVersions: localVersions });
      }
    }
  }

  // 각 월별 파티션 pull — dirty만 필터 후 병렬 fetch
  const allMonths = [...new Set([...Object.keys(remoteVersions), ...Object.keys(localVersions)])];
  const dirtyMonths = allMonths.filter(month => {
    const remoteVersion = remoteVersions[month] || 0;
    const localVersion = localVersions[month] || 0;
    return remoteVersion > localVersion;
  });

  const fetchResults = await parallelMap(dirtyMonths, async (month) => {
    const fileName = driveReviewPartitionName(month);
    const fileId = ctx
      ? resolveFileId(ctx.fileIdMap, ctx.localDriveFileIds, fileName)
      : await ensureDriveFileId(token, meta, fileName);
    if (!fileId) return null;

    const remote = await DriveAPI.getFile<DriveReviewLogState>(token, fileId);
    return { month, remote, remoteVersion: remoteVersions[month] || 0 };
  });

  // DB 쓰기는 순차
  for (const result of fetchResults) {
    if (result.status !== 'fulfilled' || !result.value) continue;
    const { month, remote, remoteVersion } = result.value;

    try {
      const localLogs = await db.getReviewLogsByMonth(database, month);
      const localState: DriveReviewLogState = { logs: localLogs, version: localVersions[month] || 0 };
      const merged = mergeReviewLogs(localState, remote);

      await db.replaceReviewLogsByMonth(database, month, merged.logs);
      localVersions[month] = remoteVersion;
      changed = true;
    } catch (e) {
      console.error('[SYNC] Failed to pull review log partition', month, e);
    }
  }

  await saveLocalReviewPartitionVersions(database, localVersions);
  await saveLocalSyncMeta(database, meta);
  return changed;
}

export async function pushReviewLogPartitions(database: SQLiteDatabase, dirtyMonths: string[], ctx?: SyncContext): Promise<void> {
  const token = ctx?.token ?? await getAccessToken();
  if (!token) return;

  const meta = await getLocalSyncMeta(database);
  let localVersions = await getLocalReviewPartitionVersions(database);

  // 월별 push를 병렬화
  const pushResults = await parallelMap(dirtyMonths, async (month) => {
    const localLogs = await db.getReviewLogsByMonth(database, month);
    const version = Date.now();
    const content: DriveReviewLogState = { logs: localLogs, version };

    const fileName = driveReviewPartitionName(month);
    const fileId = ctx
      ? resolveFileId(ctx.fileIdMap, ctx.localDriveFileIds, fileName)
      : await ensureDriveFileId(token, meta, fileName);

    // merge-before-push
    if (fileId) {
      try {
        const remote = await DriveAPI.getFile<DriveReviewLogState>(token, fileId);
        const localState: DriveReviewLogState = { logs: localLogs, version: 0 };
        const merged = mergeReviewLogs(localState, remote);
        merged.version = version;
        await db.replaceReviewLogsByMonth(database, month, merged.logs);
        await DriveAPI.updateFile(token, fileId, merged);
      } catch {
        await DriveAPI.updateFile(token, fileId, content);
      }
    } else {
      const newId = await DriveAPI.createFile(token, fileName, content);
      meta.driveFileIds[fileName] = newId;
      if (ctx) ctx.localDriveFileIds[fileName] = newId;
    }

    return { month, version };
  });

  // 결과 수집
  for (const result of pushResults) {
    if (result.status !== 'fulfilled') continue;
    const { month, version } = result.value;
    localVersions[month] = version;
    if (ctx) {
      ctx.versionPatches.reviewPartitionVersions[month] = version;
    }
  }

  if (!ctx) {
    // 레거시 경로: 개별 meta 업데이트
    await updateRemoteMeta(token, meta, { reviewPartitionVersions: localVersions });
  }

  await saveLocalReviewPartitionVersions(database, localVersions);
  await saveLocalSyncMeta(database, meta);
}

// --- 공용 헬퍼: DriveSyncMeta 업데이트 (레거시 경로용) ---

async function updateRemoteMeta(
  token: string,
  meta: { driveFileIds: Record<string, string> },
  patch: Partial<Pick<DriveSyncMeta, 'fsrsPartitionVersions' | 'reviewPartitionVersions'>>
): Promise<void> {
  const metaFileId = await ensureDriveFileId(token, meta, DRIVE_META_FILE);
  let remoteMeta: DriveSyncMeta = { partitionVersions: {}, deletedEntries: {} };

  if (metaFileId) {
    try {
      remoteMeta = await DriveAPI.getFile<DriveSyncMeta>(token, metaFileId);
    } catch {
      // 리모트 읽기 실패 → 기본값 사용
    }
  }

  // 파티션 버전 머지 (max version per month)
  if (patch.fsrsPartitionVersions) {
    const existing = remoteMeta.fsrsPartitionVersions || {};
    for (const [month, version] of Object.entries(patch.fsrsPartitionVersions)) {
      existing[month] = Math.max(version, existing[month] || 0);
    }
    remoteMeta.fsrsPartitionVersions = existing;
  }

  if (patch.reviewPartitionVersions) {
    const existing = remoteMeta.reviewPartitionVersions || {};
    for (const [month, version] of Object.entries(patch.reviewPartitionVersions)) {
      existing[month] = Math.max(version, existing[month] || 0);
    }
    remoteMeta.reviewPartitionVersions = existing;
  }

  if (metaFileId) {
    await DriveAPI.updateFile(token, metaFileId, remoteMeta);
  } else {
    const newId = await DriveAPI.createFile(token, DRIVE_META_FILE, remoteMeta);
    meta.driveFileIds[DRIVE_META_FILE] = newId;
  }
}
