import type { VocabEntry, DriveCardState, DriveFsrsState, DriveReviewLogEntry, DriveReviewLogState } from './types';

const TOMBSTONE_TTL = 30 * 24 * 60 * 60 * 1000; // 30 days

export function drivePartitionName(date: string): string {
  return `vocab_${date}.json`;
}

export const DRIVE_META_FILE = 'sync_metadata.json';
export const DRIVE_INDEX_FILE = 'vocab_index.json';
export const DRIVE_FSRS_FILE = 'fsrs_state.json';
export const DRIVE_REVIEW_LOG_FILE = 'review_logs.json';

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
