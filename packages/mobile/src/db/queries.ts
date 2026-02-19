import type { SQLiteDatabase } from 'expo-sqlite';
import type { VocabEntry } from '@jp-helper/shared';

// VocabEntry ↔ DB row 변환
function entryToRow(e: VocabEntry) {
  return {
    $id: e.id,
    $word: e.word,
    $reading: e.reading,
    $romaji: e.romaji,
    $meaning: e.meaning,
    $pos: e.pos,
    $example_sentence: e.exampleSentence,
    $example_source: e.exampleSource,
    $note: e.note,
    $date_added: e.dateAdded,
    $timestamp: e.timestamp,
    $updated_at: e.timestamp,
  };
}

function rowToEntry(row: Record<string, unknown>): VocabEntry {
  return {
    id: row.id as string,
    word: row.word as string,
    reading: (row.reading as string) ?? '',
    romaji: (row.romaji as string) ?? '',
    meaning: (row.meaning as string) ?? '',
    pos: (row.pos as string) ?? '',
    exampleSentence: (row.example_sentence as string) ?? '',
    exampleSource: (row.example_source as string) ?? '',
    note: (row.note as string) ?? '',
    dateAdded: row.date_added as string,
    timestamp: row.timestamp as number,
  };
}

export async function getAllEntries(db: SQLiteDatabase): Promise<VocabEntry[]> {
  const rows = await db.getAllAsync<Record<string, unknown>>(
    'SELECT * FROM vocab ORDER BY timestamp DESC'
  );
  return rows.map(rowToEntry);
}

export async function getEntriesByDate(db: SQLiteDatabase, date: string): Promise<VocabEntry[]> {
  const rows = await db.getAllAsync<Record<string, unknown>>(
    'SELECT * FROM vocab WHERE date_added = ? ORDER BY timestamp DESC',
    [date]
  );
  return rows.map(rowToEntry);
}

export async function getEntryById(db: SQLiteDatabase, id: string): Promise<VocabEntry | null> {
  const row = await db.getFirstAsync<Record<string, unknown>>(
    'SELECT * FROM vocab WHERE id = ?',
    [id]
  );
  return row ? rowToEntry(row) : null;
}

export async function upsertEntry(db: SQLiteDatabase, entry: VocabEntry): Promise<void> {
  const params = entryToRow(entry);
  await db.runAsync(
    `INSERT OR REPLACE INTO vocab (id, word, reading, romaji, meaning, pos, example_sentence, example_source, note, date_added, timestamp, updated_at)
     VALUES ($id, $word, $reading, $romaji, $meaning, $pos, $example_sentence, $example_source, $note, $date_added, $timestamp, $updated_at)`,
    params
  );
}

export async function upsertEntries(db: SQLiteDatabase, entries: VocabEntry[]): Promise<void> {
  await db.withTransactionAsync(async () => {
    for (const entry of entries) {
      await upsertEntry(db, entry);
    }
  });
}

export async function deleteEntry(db: SQLiteDatabase, id: string): Promise<void> {
  await db.runAsync('DELETE FROM vocab WHERE id = ?', [id]);
}

export async function searchEntries(db: SQLiteDatabase, query: string): Promise<VocabEntry[]> {
  const pattern = `%${query}%`;
  const rows = await db.getAllAsync<Record<string, unknown>>(
    `SELECT * FROM vocab WHERE word LIKE ? OR reading LIKE ? OR meaning LIKE ? OR note LIKE ?
     ORDER BY timestamp DESC LIMIT 100`,
    [pattern, pattern, pattern, pattern]
  );
  return rows.map(rowToEntry);
}

export async function getDateGroups(db: SQLiteDatabase): Promise<{ date: string; count: number }[]> {
  return db.getAllAsync<{ date: string; count: number }>(
    'SELECT date_added as date, COUNT(*) as count FROM vocab GROUP BY date_added ORDER BY date_added DESC'
  );
}

export async function getTotalCount(db: SQLiteDatabase): Promise<number> {
  const result = await db.getFirstAsync<{ count: number }>('SELECT COUNT(*) as count FROM vocab');
  return result?.count ?? 0;
}

// Tombstone 관련
export async function addTombstone(db: SQLiteDatabase, entryId: string): Promise<void> {
  await db.runAsync(
    'INSERT OR REPLACE INTO tombstones (entry_id, deleted_at) VALUES (?, ?)',
    [entryId, Date.now()]
  );
}

export async function getTombstones(db: SQLiteDatabase): Promise<Record<string, number>> {
  const rows = await db.getAllAsync<{ entry_id: string; deleted_at: number }>(
    'SELECT entry_id, deleted_at FROM tombstones'
  );
  const result: Record<string, number> = {};
  for (const row of rows) {
    result[row.entry_id] = row.deleted_at;
  }
  return result;
}

export async function cleanOldTombstones(db: SQLiteDatabase, maxAgeMs: number): Promise<void> {
  const cutoff = Date.now() - maxAgeMs;
  await db.runAsync('DELETE FROM tombstones WHERE deleted_at < ?', [cutoff]);
}

// Sync meta
export async function getSyncMeta(db: SQLiteDatabase, key: string): Promise<string | null> {
  const row = await db.getFirstAsync<{ value: string }>('SELECT value FROM sync_meta WHERE key = ?', [key]);
  return row?.value ?? null;
}

export async function setSyncMeta(db: SQLiteDatabase, key: string, value: string): Promise<void> {
  await db.runAsync(
    'INSERT OR REPLACE INTO sync_meta (key, value) VALUES (?, ?)',
    [key, value]
  );
}
