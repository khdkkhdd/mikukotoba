import type { VocabEntry } from './types';

const TOMBSTONE_TTL = 30 * 24 * 60 * 60 * 1000; // 30 days

export function drivePartitionName(date: string): string {
  return `vocab_${date}.json`;
}

export const DRIVE_META_FILE = 'sync_metadata.json';
export const DRIVE_INDEX_FILE = 'vocab_index.json';

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
