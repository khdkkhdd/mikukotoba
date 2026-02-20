import type { DriveSyncMeta } from './types';
import { DriveAPI } from './drive-api';
import { buildFileIdMap, cleanTombstones, DRIVE_META_FILE } from './sync-core';

export interface SyncContext {
  token: string;
  fileIdMap: Map<string, string>;
  localDriveFileIds: Record<string, string>;
  remoteMeta: DriveSyncMeta;
  /** push 함수들이 version patch를 누적하는 공간 */
  versionPatches: {
    partitionVersions: Record<string, number>;
    fsrsPartitionVersions: Record<string, number>;
    reviewPartitionVersions: Record<string, number>;
  };
}

/**
 * listFiles 1회 + meta 읽기 1회로 SyncContext 생성.
 * 이후 pull/push 함수들이 이 ctx를 공유.
 */
export async function createSyncContext(
  token: string,
  localDriveFileIds: Record<string, string>
): Promise<SyncContext> {
  // listFiles 1회 → 전체 파일 목록
  const files = await DriveAPI.listFiles(token);
  const fileIdMap = buildFileIdMap(files);

  // fileIdMap에서 발견된 ID를 localDriveFileIds 캐시에도 반영
  for (const [name, id] of fileIdMap) {
    localDriveFileIds[name] = id;
  }

  // meta 읽기 1회
  let remoteMeta: DriveSyncMeta = { partitionVersions: {}, deletedEntries: {} };
  const metaFileId = fileIdMap.get(DRIVE_META_FILE) ?? localDriveFileIds[DRIVE_META_FILE];
  if (metaFileId) {
    try {
      remoteMeta = await DriveAPI.getFile<DriveSyncMeta>(token, metaFileId);
    } catch {
      // 첫 동기화 또는 손상 → 기본값
    }
  }

  return {
    token,
    fileIdMap,
    localDriveFileIds,
    remoteMeta,
    versionPatches: {
      partitionVersions: {},
      fsrsPartitionVersions: {},
      reviewPartitionVersions: {},
    },
  };
}

/**
 * push 완료 후 remote meta를 재읽기 + Math.max 머지 + 1회 쓰기.
 * stale version overwrite 방지.
 */
export async function commitSyncMeta(ctx: SyncContext): Promise<void> {
  const { token, fileIdMap, localDriveFileIds, versionPatches } = ctx;
  const metaFileId = fileIdMap.get(DRIVE_META_FILE) ?? localDriveFileIds[DRIVE_META_FILE];

  // 1. 재읽기 (push 중 다른 클라이언트가 업데이트했을 수 있음)
  let freshMeta: DriveSyncMeta = { partitionVersions: {}, deletedEntries: {} };
  if (metaFileId) {
    try {
      freshMeta = await DriveAPI.getFile<DriveSyncMeta>(token, metaFileId);
    } catch {
      // 읽기 실패 → 기본값
    }
  }

  // 2. Math.max 머지 — partitionVersions
  const mergedPartitions = { ...(freshMeta.partitionVersions || {}) };
  for (const [key, version] of Object.entries(versionPatches.partitionVersions)) {
    mergedPartitions[key] = Math.max(version, mergedPartitions[key] || 0);
  }

  // 3. Math.max 머지 — fsrsPartitionVersions
  const mergedFsrs = { ...(freshMeta.fsrsPartitionVersions || {}) };
  for (const [key, version] of Object.entries(versionPatches.fsrsPartitionVersions)) {
    mergedFsrs[key] = Math.max(version, mergedFsrs[key] || 0);
  }

  // 4. Math.max 머지 — reviewPartitionVersions
  const mergedReviews = { ...(freshMeta.reviewPartitionVersions || {}) };
  for (const [key, version] of Object.entries(versionPatches.reviewPartitionVersions)) {
    mergedReviews[key] = Math.max(version, mergedReviews[key] || 0);
  }

  // 5. deletedEntries는 ctx.remoteMeta에서 pull 시 머지된 것 + fresh 결합
  const mergedDeleted = cleanTombstones({
    ...(freshMeta.deletedEntries || {}),
    ...(ctx.remoteMeta.deletedEntries || {}),
  });

  const finalMeta: DriveSyncMeta = {
    partitionVersions: mergedPartitions,
    deletedEntries: mergedDeleted,
    fsrsPartitionVersions: Object.keys(mergedFsrs).length > 0 ? mergedFsrs : freshMeta.fsrsPartitionVersions,
    reviewPartitionVersions: Object.keys(mergedReviews).length > 0 ? mergedReviews : freshMeta.reviewPartitionVersions,
  };

  // 6. 1회 쓰기
  if (metaFileId) {
    await DriveAPI.updateFile(token, metaFileId, finalMeta);
  } else {
    const newId = await DriveAPI.createFile(token, DRIVE_META_FILE, finalMeta);
    localDriveFileIds[DRIVE_META_FILE] = newId;
  }
}
