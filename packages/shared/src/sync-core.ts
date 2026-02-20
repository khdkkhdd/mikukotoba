import type { VocabEntry, DriveCardState, DriveFsrsState, DriveReviewLogEntry, DriveReviewLogState } from './types';

const TOMBSTONE_TTL = 30 * 24 * 60 * 60 * 1000; // 30 days

export function drivePartitionName(date: string): string {
  return `vocab_${date}.json`;
}

export const DRIVE_META_FILE = 'sync_metadata.json';
export const DRIVE_INDEX_FILE = 'vocab_index.json';
export const DRIVE_FSRS_FILE = 'fsrs_state.json';
export const DRIVE_REVIEW_LOG_FILE = 'review_logs.json';

export function driveFsrsPartitionName(month: string): string {
  return `fsrs_${month}.json`;
}

export function driveReviewPartitionName(month: string): string {
  return `reviews_${month}.json`;
}

/**
 * Merge local and remote entry lists.
 * Uses entry-level timestamp comparison, respects tombstones.
 */
export function mergeEntries(
  local: VocabEntry[],
  remote: VocabEntry[],
  deletedEntries: Record<string, number>
): VocabEntry[] {
  const map = new Map<string, VocabEntry>();

  for (const entry of local) {
    if (!deletedEntries[entry.id]) {
      map.set(entry.id, entry);
    }
  }

  for (const entry of remote) {
    if (deletedEntries[entry.id]) continue;

    const existing = map.get(entry.id);
    if (!existing || entry.timestamp > existing.timestamp) {
      map.set(entry.id, entry);
    }
  }

  return [...map.values()];
}

/**
 * Merge local and remote FSRS card states.
 * Per-card last_review 기준으로 더 최근 것을 채택.
 */
export function mergeFsrsStates(
  local: DriveFsrsState,
  remote: DriveFsrsState
): DriveFsrsState {
  const merged: Record<string, DriveCardState> = { ...local.cardStates };

  for (const [vocabId, remoteCard] of Object.entries(remote.cardStates)) {
    const localCard = merged[vocabId];

    if (!localCard) {
      // 리모트에만 있는 카드 → 채택
      merged[vocabId] = remoteCard;
      continue;
    }

    const localReview = localCard.last_review;
    const remoteReview = remoteCard.last_review;

    if (!localReview && remoteReview) {
      // 로컬 미학습 / 리모트 학습됨 → 리모트 채택
      merged[vocabId] = remoteCard;
    } else if (localReview && remoteReview && remoteReview > localReview) {
      // 리모트가 더 최근 → 리모트 채택
      merged[vocabId] = remoteCard;
    }
    // 그 외 → 로컬 유지
  }

  return {
    cardStates: merged,
    version: Math.max(local.version, remote.version),
  };
}

/**
 * Merge local and remote review logs.
 * Set 기반 `vocab_id|reviewed_at` 중복 제거, 시간순 정렬.
 */
export function mergeReviewLogs(
  local: DriveReviewLogState,
  remote: DriveReviewLogState
): DriveReviewLogState {
  const seen = new Set<string>();
  const merged: DriveReviewLogEntry[] = [];

  for (const log of [...local.logs, ...remote.logs]) {
    const key = `${log.vocab_id}|${log.reviewed_at}`;
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(log);
    }
  }

  merged.sort((a, b) => a.reviewed_at.localeCompare(b.reviewed_at));

  return {
    logs: merged,
    version: Math.max(local.version, remote.version),
  };
}

/**
 * Count entries that differ between `before` and `after`.
 * Includes additions, updates (timestamp change), and deletions.
 */
export function countChangedEntries(
  before: VocabEntry[],
  after: VocabEntry[]
): number {
  const beforeMap = new Map<string, number>();
  for (const entry of before) {
    beforeMap.set(entry.id, entry.timestamp);
  }
  const afterIds = new Set<string>();
  let changed = 0;
  for (const entry of after) {
    afterIds.add(entry.id);
    const prevTs = beforeMap.get(entry.id);
    if (prevTs === undefined || prevTs !== entry.timestamp) {
      changed++;
    }
  }
  for (const id of beforeMap.keys()) {
    if (!afterIds.has(id)) changed++;
  }
  return changed;
}

/**
 * Build a fileName → fileId map from a listFiles result.
 */
export function buildFileIdMap(files: { id: string; name: string }[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const f of files) {
    map.set(f.name, f.id);
  }
  return map;
}

/**
 * Resolve a Drive file ID using the fileIdMap (from listFiles) first,
 * falling back to localDriveFileIds cache. Returns null if not found.
 */
export function resolveFileId(
  fileIdMap: Map<string, string>,
  localDriveFileIds: Record<string, string>,
  fileName: string
): string | null {
  return fileIdMap.get(fileName) ?? localDriveFileIds[fileName] ?? null;
}

/**
 * Run async functions in parallel with concurrency limit.
 * Returns PromiseSettledResult for each item.
 */
export async function parallelMap<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  concurrency = 5
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let next = 0;

  async function worker() {
    while (next < items.length) {
      const idx = next++;
      try {
        const value = await fn(items[idx]);
        results[idx] = { status: 'fulfilled', value };
      } catch (reason) {
        results[idx] = { status: 'rejected', reason };
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

/**
 * Clean tombstones older than 30 days.
 */
export function cleanTombstones(deleted: Record<string, number>): Record<string, number> {
  const now = Date.now();
  const cleaned: Record<string, number> = {};
  for (const [id, ts] of Object.entries(deleted)) {
    if (now - ts < TOMBSTONE_TTL) {
      cleaned[id] = ts;
    }
  }
  return cleaned;
}
