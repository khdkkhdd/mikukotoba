export type {
  VocabEntry,
  VocabStorageIndex,
  SyncMetadata,
  DriveStatus,
  SyncResult,
  DrivePartitionContent,
  DriveSyncMeta,
} from './types';

export { DriveAPI } from './drive-api';

export {
  mergeEntries,
  cleanTombstones,
  drivePartitionName,
  DRIVE_META_FILE,
  DRIVE_INDEX_FILE,
} from './sync-core';
