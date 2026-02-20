export type {
  VocabEntry,
  VocabStorageIndex,
  SyncMetadata,
  DriveStatus,
  SyncResult,
  DrivePartitionContent,
  DriveSyncMeta,
  DriveCardState,
  DriveFsrsState,
  DriveReviewLogEntry,
  DriveReviewLogState,
} from './types';

export { DriveAPI } from './drive-api';

export {
  mergeEntries,
  countChangedEntries,
  cleanTombstones,
  mergeFsrsStates,
  mergeReviewLogs,
  drivePartitionName,
  driveFsrsPartitionName,
  driveReviewPartitionName,
  buildFileIdMap,
  resolveFileId,
  parallelMap,
  DRIVE_META_FILE,
  DRIVE_INDEX_FILE,
  DRIVE_FSRS_FILE,
  DRIVE_REVIEW_LOG_FILE,
} from './sync-core';

export type { SyncContext } from './sync-context';
export { createSyncContext, commitSyncMeta } from './sync-context';
