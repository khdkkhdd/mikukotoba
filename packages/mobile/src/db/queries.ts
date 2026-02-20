import type { SQLiteDatabase } from 'expo-sqlite';
import type { VocabEntry, DriveCardState, DriveReviewLogEntry } from '@mikukotoba/shared';
import { createEmptyCard, type Card, State } from 'ts-fsrs';

// VocabEntry ↔ DB row 변환

function parseTags(raw: unknown): string[] {
  if (typeof raw !== 'string' || !raw) return [];
  try { return JSON.parse(raw); } catch { return []; }
}

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
    $tags: JSON.stringify(e.tags ?? []),
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
    tags: parseTags(row.tags),
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
    `INSERT INTO vocab (id, word, reading, romaji, meaning, pos, example_sentence, example_source, note, tags, date_added, timestamp, updated_at)
     VALUES ($id, $word, $reading, $romaji, $meaning, $pos, $example_sentence, $example_source, $note, $tags, $date_added, $timestamp, $updated_at)
     ON CONFLICT(id) DO UPDATE SET
       word = excluded.word,
       reading = excluded.reading,
       romaji = excluded.romaji,
       meaning = excluded.meaning,
       pos = excluded.pos,
       example_sentence = excluded.example_sentence,
       example_source = excluded.example_source,
       note = excluded.note,
       tags = excluded.tags,
       date_added = excluded.date_added,
       timestamp = excluded.timestamp,
       updated_at = excluded.updated_at`,
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
    `SELECT * FROM vocab WHERE word LIKE ? OR reading LIKE ? OR meaning LIKE ? OR note LIKE ? OR tags LIKE ?
     ORDER BY timestamp DESC LIMIT 100`,
    [pattern, pattern, pattern, pattern, pattern]
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

// 오늘 처음 학습한 새 카드 수 (일일 한도 추적용)
export async function getTodayNewCardCount(db: SQLiteDatabase): Promise<number> {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const result = await db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) as count FROM (
       SELECT vocab_id
       FROM review_log
       GROUP BY vocab_id
       HAVING MIN(reviewed_at) >= ?
     )`,
    [todayStart.toISOString()]
  );
  return result?.count ?? 0;
}

// 월별 FSRS card_state 조회 (vocab.date_added 기준)
export async function getCardStatesByMonth(
  db: SQLiteDatabase,
  month: string
): Promise<Record<string, DriveCardState>> {
  const rows = await db.getAllAsync<Record<string, unknown>>(
    `SELECT cs.* FROM card_state cs
     JOIN vocab v ON v.id = cs.vocab_id
     WHERE substr(v.date_added, 1, 7) = ?`,
    [month]
  );
  const result: Record<string, DriveCardState> = {};
  for (const row of rows) {
    result[row.vocab_id as string] = {
      state: row.state as number,
      due: row.due as string,
      stability: row.stability as number,
      difficulty: row.difficulty as number,
      elapsed_days: row.elapsed_days as number,
      scheduled_days: row.scheduled_days as number,
      reps: row.reps as number,
      lapses: row.lapses as number,
      last_review: (row.last_review as string) ?? null,
      learning_steps: (row.learning_steps as number) ?? 0,
    };
  }
  return result;
}

// 월별 리뷰 로그 조회
export async function getReviewLogsByMonth(
  db: SQLiteDatabase,
  month: string
): Promise<DriveReviewLogEntry[]> {
  const startDate = `${month}-01T00:00:00.000Z`;
  // 다음 월 계산
  const [y, m] = month.split('-').map(Number);
  const nextMonth = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
  const endDate = `${nextMonth}-01T00:00:00.000Z`;

  return db.getAllAsync<DriveReviewLogEntry>(
    `SELECT vocab_id, rating, reviewed_at FROM review_log
     WHERE reviewed_at >= ? AND reviewed_at < ?
     ORDER BY reviewed_at ASC`,
    [startDate, endDate]
  );
}

// 월별 리뷰 로그 교체 (해당 월만 DELETE 후 INSERT)
export async function replaceReviewLogsByMonth(
  db: SQLiteDatabase,
  month: string,
  logs: DriveReviewLogEntry[]
): Promise<void> {
  const startDate = `${month}-01T00:00:00.000Z`;
  const [y, m] = month.split('-').map(Number);
  const nextMonth = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
  const endDate = `${nextMonth}-01T00:00:00.000Z`;

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      'DELETE FROM review_log WHERE reviewed_at >= ? AND reviewed_at < ?',
      [startDate, endDate]
    );
    for (const log of logs) {
      await db.runAsync(
        `INSERT INTO review_log (vocab_id, rating, reviewed_at)
         SELECT ?, ?, ? WHERE EXISTS (SELECT 1 FROM vocab WHERE id = ?)`,
        [log.vocab_id, log.rating, log.reviewed_at, log.vocab_id]
      );
    }
  });
}

// dirty vocabIds → dateAdded 월(YYYY-MM) Set 반환
export async function getVocabMonthsByIds(
  db: SQLiteDatabase,
  ids: string[]
): Promise<Set<string>> {
  const months = new Set<string>();
  // 배치 처리 (SQLite 파라미터 한도 대응)
  const batchSize = 500;
  for (let i = 0; i < ids.length; i += batchSize) {
    const batch = ids.slice(i, i + batchSize);
    const placeholders = batch.map(() => '?').join(',');
    const rows = await db.getAllAsync<{ month: string }>(
      `SELECT DISTINCT substr(date_added, 1, 7) as month FROM vocab WHERE id IN (${placeholders})`,
      batch
    );
    for (const row of rows) {
      months.add(row.month);
    }
  }
  return months;
}

// Review log 동기화
export async function getAllReviewLogs(db: SQLiteDatabase): Promise<DriveReviewLogEntry[]> {
  return db.getAllAsync<DriveReviewLogEntry>(
    'SELECT vocab_id, rating, reviewed_at FROM review_log ORDER BY reviewed_at ASC'
  );
}

export async function replaceAllReviewLogs(
  db: SQLiteDatabase,
  logs: DriveReviewLogEntry[]
): Promise<void> {
  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM review_log');
    for (const log of logs) {
      await db.runAsync(
        `INSERT INTO review_log (vocab_id, rating, reviewed_at)
         SELECT ?, ?, ? WHERE EXISTS (SELECT 1 FROM vocab WHERE id = ?)`,
        [log.vocab_id, log.rating, log.reviewed_at, log.vocab_id]
      );
    }
  });
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

// FSRS card_state 전체 조회
export async function getAllCardStates(db: SQLiteDatabase): Promise<Record<string, DriveCardState>> {
  const rows = await db.getAllAsync<Record<string, unknown>>(
    'SELECT * FROM card_state'
  );
  const result: Record<string, DriveCardState> = {};
  for (const row of rows) {
    result[row.vocab_id as string] = {
      state: row.state as number,
      due: row.due as string,
      stability: row.stability as number,
      difficulty: row.difficulty as number,
      elapsed_days: row.elapsed_days as number,
      scheduled_days: row.scheduled_days as number,
      reps: row.reps as number,
      lapses: row.lapses as number,
      last_review: (row.last_review as string) ?? null,
      learning_steps: (row.learning_steps as number) ?? 0,
    };
  }
  return result;
}

// FSRS card_state 배치 upsert
export async function upsertCardStates(
  db: SQLiteDatabase,
  states: Record<string, DriveCardState>
): Promise<void> {
  await db.withTransactionAsync(async () => {
    for (const [vocabId, card] of Object.entries(states)) {
      await db.runAsync(
        `INSERT OR REPLACE INTO card_state (vocab_id, state, due, stability, difficulty, elapsed_days, scheduled_days, reps, lapses, last_review, learning_steps)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          vocabId,
          card.state,
          card.due,
          card.stability,
          card.difficulty,
          card.elapsed_days,
          card.scheduled_days,
          card.reps,
          card.lapses,
          card.last_review,
          card.learning_steps ?? 0,
        ]
      );
    }
  });
}

// SRS 초기화용: due 카드 + VocabEntry + Card 한 번에 로드
export interface CardWithEntry {
  entry: VocabEntry;
  card: Card;
}

export async function getDueCardsWithEntries(db: SQLiteDatabase): Promise<CardWithEntry[]> {
  const now = new Date().toISOString();
  const rows = await db.getAllAsync<Record<string, unknown>>(
    `SELECT v.*, cs.state as cs_state, cs.due as cs_due, cs.stability, cs.difficulty,
            cs.elapsed_days, cs.scheduled_days, cs.reps, cs.lapses, cs.last_review, cs.learning_steps
     FROM card_state cs
     JOIN vocab v ON v.id = cs.vocab_id
     WHERE cs.due <= ?
     ORDER BY cs.due ASC`,
    [now]
  );
  return rows.map(rowToCardWithEntry);
}

// SRS 초기화용: 새 카드 + VocabEntry 한 번에 로드
export async function getNewCardsWithEntries(db: SQLiteDatabase, limit: number): Promise<CardWithEntry[]> {
  const rows = await db.getAllAsync<Record<string, unknown>>(
    `SELECT v.*, NULL as cs_state, NULL as cs_due, NULL as stability, NULL as difficulty,
            NULL as elapsed_days, NULL as scheduled_days, NULL as reps, NULL as lapses,
            NULL as last_review, NULL as learning_steps
     FROM vocab v
     LEFT JOIN card_state cs ON v.id = cs.vocab_id
     WHERE cs.vocab_id IS NULL
     ORDER BY v.timestamp ASC LIMIT ?`,
    [limit]
  );
  return rows.map((row) => ({
    entry: rowToEntry(row),
    card: newEmptyCard(),
  }));
}

// 릴레이용: 날짜 범위 랜덤 조회
export async function getRandomEntriesByDateRange(
  db: SQLiteDatabase,
  startDate: string,
  endDate: string,
  limit: number
): Promise<VocabEntry[]> {
  const rows = await db.getAllAsync<Record<string, unknown>>(
    `SELECT * FROM vocab WHERE date_added BETWEEN ? AND ? ORDER BY RANDOM() LIMIT ?`,
    [startDate, endDate, limit]
  );
  return rows.map(rowToEntry);
}

// 릴레이용: 전체 날짜 범위
export async function getDateRange(db: SQLiteDatabase): Promise<{ min: string; max: string } | null> {
  const result = await db.getFirstAsync<{ min_date: string | null; max_date: string | null }>(
    'SELECT MIN(date_added) as min_date, MAX(date_added) as max_date FROM vocab'
  );
  if (!result?.min_date || !result?.max_date) return null;
  return { min: result.min_date, max: result.max_date };
}

// 릴레이용: 날짜 범위 내 단어 수
export async function getCountByDateRange(
  db: SQLiteDatabase,
  startDate: string,
  endDate: string
): Promise<number> {
  const result = await db.getFirstAsync<{ count: number }>(
    'SELECT COUNT(*) as count FROM vocab WHERE date_added BETWEEN ? AND ?',
    [startDate, endDate]
  );
  return result?.count ?? 0;
}

// --- 태그 쿼리 ---

export async function getAllTagCounts(db: SQLiteDatabase): Promise<Record<string, number>> {
  const rows = await db.getAllAsync<{ tags: string }>('SELECT tags FROM vocab');
  const counts: Record<string, number> = {};
  for (const row of rows) {
    for (const tag of parseTags(row.tags)) {
      counts[tag] = (counts[tag] ?? 0) + 1;
    }
  }
  return counts;
}

export async function getEntriesByTag(db: SQLiteDatabase, tag: string): Promise<VocabEntry[]> {
  const pattern = `%${tag}%`;
  const rows = await db.getAllAsync<Record<string, unknown>>(
    'SELECT * FROM vocab WHERE tags LIKE ? ORDER BY timestamp DESC',
    [pattern]
  );
  return rows.map(rowToEntry).filter((e) => e.tags.includes(tag));
}

export async function getDueCardsWithEntriesByTag(
  db: SQLiteDatabase,
  tag: string | null
): Promise<CardWithEntry[]> {
  const now = new Date().toISOString();

  if (tag === null) {
    const rows = await db.getAllAsync<Record<string, unknown>>(
      `SELECT v.*, cs.state as cs_state, cs.due as cs_due, cs.stability, cs.difficulty,
              cs.elapsed_days, cs.scheduled_days, cs.reps, cs.lapses, cs.last_review, cs.learning_steps
       FROM card_state cs
       JOIN vocab v ON v.id = cs.vocab_id
       WHERE cs.due <= ? AND (v.tags IS NULL OR v.tags = '[]')
       ORDER BY cs.due ASC`,
      [now]
    );
    return rows.map(rowToCardWithEntry);
  }

  const pattern = `%${tag}%`;
  const rows = await db.getAllAsync<Record<string, unknown>>(
    `SELECT v.*, cs.state as cs_state, cs.due as cs_due, cs.stability, cs.difficulty,
            cs.elapsed_days, cs.scheduled_days, cs.reps, cs.lapses, cs.last_review, cs.learning_steps
     FROM card_state cs
     JOIN vocab v ON v.id = cs.vocab_id
     WHERE cs.due <= ? AND v.tags LIKE ?
     ORDER BY cs.due ASC`,
    [now, pattern]
  );
  return rows.map(rowToCardWithEntry).filter((r) => r.entry.tags.includes(tag));
}

export async function getNewCardsWithEntriesByTag(
  db: SQLiteDatabase,
  tag: string | null,
  limit: number
): Promise<CardWithEntry[]> {
  if (tag === null) {
    const rows = await db.getAllAsync<Record<string, unknown>>(
      `SELECT v.*, NULL as cs_state, NULL as cs_due, NULL as stability, NULL as difficulty,
              NULL as elapsed_days, NULL as scheduled_days, NULL as reps, NULL as lapses,
              NULL as last_review, NULL as learning_steps
       FROM vocab v
       LEFT JOIN card_state cs ON v.id = cs.vocab_id
       WHERE cs.vocab_id IS NULL AND (v.tags IS NULL OR v.tags = '[]')
       ORDER BY v.timestamp ASC LIMIT ?`,
      [limit]
    );
    return rows.map((row) => ({ entry: rowToEntry(row), card: newEmptyCard() }));
  }

  const pattern = `%${tag}%`;
  const rows = await db.getAllAsync<Record<string, unknown>>(
    `SELECT v.*, NULL as cs_state, NULL as cs_due, NULL as stability, NULL as difficulty,
            NULL as elapsed_days, NULL as scheduled_days, NULL as reps, NULL as lapses,
            NULL as last_review, NULL as learning_steps
     FROM vocab v
     LEFT JOIN card_state cs ON v.id = cs.vocab_id
     WHERE cs.vocab_id IS NULL AND v.tags LIKE ?
     ORDER BY v.timestamp ASC LIMIT ?`,
    [pattern, limit * 2]
  );
  return rows
    .map((row) => ({ entry: rowToEntry(row), card: newEmptyCard() }))
    .filter((r) => r.entry.tags.includes(tag))
    .slice(0, limit);
}

export interface TagStudyCounts { due: number; new: number }

export async function getStudyCountsByTag(db: SQLiteDatabase): Promise<Record<string, TagStudyCounts>> {
  const now = new Date().toISOString();
  const counts: Record<string, TagStudyCounts> = {};
  const ensure = (t: string) => counts[t] ??= { due: 0, new: 0 };

  // due cards
  const dueRows = await db.getAllAsync<{ tags: string }>(
    `SELECT v.tags FROM card_state cs JOIN vocab v ON v.id = cs.vocab_id WHERE cs.due <= ?`,
    [now]
  );
  for (const row of dueRows) {
    const tags = parseTags(row.tags);
    if (tags.length === 0) { ensure('').due++; continue; }
    for (const t of tags) ensure(t).due++;
  }

  // new cards (no card_state)
  const newRows = await db.getAllAsync<{ tags: string }>(
    `SELECT v.tags FROM vocab v LEFT JOIN card_state cs ON v.id = cs.vocab_id WHERE cs.vocab_id IS NULL`
  );
  for (const row of newRows) {
    const tags = parseTags(row.tags);
    if (tags.length === 0) { ensure('').new++; continue; }
    for (const t of tags) ensure(t).new++;
  }

  return counts;
}

// 릴레이용: 복합 필터 (태그+날짜) 랜덤 조회
export interface RelayFilters {
  tag?: string;         // undefined=전체, ''=태그없음, 'xxx'=특정 태그
  startDate?: string;
  endDate?: string;
}

export async function getRandomEntriesByFilters(
  db: SQLiteDatabase,
  filters: RelayFilters,
  limit: number
): Promise<VocabEntry[]> {
  const { tag, startDate, endDate } = filters;
  const hasDate = startDate && endDate;
  const hasTag = tag !== undefined;

  // 태그 없음: JSON array 비어있음
  if (hasTag && tag === '') {
    const rows = await db.getAllAsync<Record<string, unknown>>(
      `SELECT * FROM vocab WHERE (tags IS NULL OR tags = '[]')${
        hasDate ? ' AND date_added BETWEEN ? AND ?' : ''
      } ORDER BY RANDOM() LIMIT ?`,
      hasDate ? [startDate, endDate, limit] : [limit]
    );
    return rows.map(rowToEntry);
  }

  // 특정 태그
  if (hasTag) {
    const pattern = `%${tag}%`;
    const rows = await db.getAllAsync<Record<string, unknown>>(
      `SELECT * FROM vocab WHERE tags LIKE ?${
        hasDate ? ' AND date_added BETWEEN ? AND ?' : ''
      } ORDER BY RANDOM() LIMIT ?`,
      hasDate ? [pattern, startDate, endDate, limit * 2] : [pattern, limit * 2]
    );
    return rows.map(rowToEntry).filter((e) => e.tags.includes(tag)).slice(0, limit);
  }

  // 태그 필터 없음
  if (hasDate) {
    return getRandomEntriesByDateRange(db, startDate, endDate, limit);
  }

  // 전체
  const rows = await db.getAllAsync<Record<string, unknown>>(
    'SELECT * FROM vocab ORDER BY RANDOM() LIMIT ?',
    [limit]
  );
  return rows.map(rowToEntry);
}

export async function getCountByFilters(
  db: SQLiteDatabase,
  filters: RelayFilters
): Promise<number> {
  const { tag, startDate, endDate } = filters;
  const hasDate = startDate && endDate;
  const hasTag = tag !== undefined;

  if (hasTag && tag === '') {
    const result = await db.getFirstAsync<{ count: number }>(
      `SELECT COUNT(*) as count FROM vocab WHERE (tags IS NULL OR tags = '[]')${
        hasDate ? ' AND date_added BETWEEN ? AND ?' : ''
      }`,
      hasDate ? [startDate, endDate] : []
    );
    return result?.count ?? 0;
  }

  if (hasTag) {
    const pattern = `%${tag}%`;
    const rows = await db.getAllAsync<{ tags: string }>(
      `SELECT tags FROM vocab WHERE tags LIKE ?${
        hasDate ? ' AND date_added BETWEEN ? AND ?' : ''
      }`,
      hasDate ? [pattern, startDate, endDate] : [pattern]
    );
    return rows.filter((r) => parseTags(r.tags).includes(tag)).length;
  }

  if (hasDate) {
    return getCountByDateRange(db, startDate, endDate);
  }

  return getTotalCount(db);
}

// --- 로컬 날짜 유틸 ---

/** 로컬 타임존 기준 YYYY-MM-DD */
function localDateStr(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

// SQLite에서 reviewed_at(UTC ISO) → KST 날짜 변환용
const KST = `'+9 hours'`;

// --- 통계 쿼리 ---

/** 일별 학습 집계 (날짜, 총 카드 수, 등급별 수) */
export interface DailyStats {
  date: string;
  total: number;
  again: number;
  hard: number;
  good: number;
  easy: number;
}

export async function getDailyReviewStats(
  db: SQLiteDatabase,
  startDate: string,
  endDate: string
): Promise<DailyStats[]> {
  return db.getAllAsync<DailyStats>(
    `SELECT
       DATE(reviewed_at, ${KST}) as date,
       COUNT(*) as total,
       SUM(CASE WHEN rating = 1 THEN 1 ELSE 0 END) as again,
       SUM(CASE WHEN rating = 2 THEN 1 ELSE 0 END) as hard,
       SUM(CASE WHEN rating = 3 THEN 1 ELSE 0 END) as good,
       SUM(CASE WHEN rating = 4 THEN 1 ELSE 0 END) as easy
     FROM review_log
     WHERE DATE(reviewed_at, ${KST}) BETWEEN ? AND ?
     GROUP BY DATE(reviewed_at, ${KST})
     ORDER BY date ASC`,
    [startDate, endDate]
  );
}

/** 전체 기간 요약 통계 */
export interface OverallStats {
  totalReviews: number;
  totalDays: number;
  totalVocab: number;
  again: number;
  hard: number;
  good: number;
  easy: number;
}

export async function getOverallStats(db: SQLiteDatabase): Promise<OverallStats> {
  const result = await db.getFirstAsync<{
    totalReviews: number;
    totalDays: number;
    again: number;
    hard: number;
    good: number;
    easy: number;
  }>(
    `SELECT
       COUNT(*) as totalReviews,
       COUNT(DISTINCT DATE(reviewed_at, ${KST})) as totalDays,
       SUM(CASE WHEN rating = 1 THEN 1 ELSE 0 END) as again,
       SUM(CASE WHEN rating = 2 THEN 1 ELSE 0 END) as hard,
       SUM(CASE WHEN rating = 3 THEN 1 ELSE 0 END) as good,
       SUM(CASE WHEN rating = 4 THEN 1 ELSE 0 END) as easy
     FROM review_log`
  );
  const vocabResult = await db.getFirstAsync<{ count: number }>(
    'SELECT COUNT(*) as count FROM vocab'
  );
  return {
    totalReviews: result?.totalReviews ?? 0,
    totalDays: result?.totalDays ?? 0,
    totalVocab: vocabResult?.count ?? 0,
    again: result?.again ?? 0,
    hard: result?.hard ?? 0,
    good: result?.good ?? 0,
    easy: result?.easy ?? 0,
  };
}

/** 연속 학습일(스트릭) 계산 */
export async function getStreak(db: SQLiteDatabase): Promise<{ current: number; longest: number }> {
  const rows = await db.getAllAsync<{ date: string }>(
    `SELECT DISTINCT DATE(reviewed_at, ${KST}) as date FROM review_log ORDER BY date DESC`
  );

  if (rows.length === 0) return { current: 0, longest: 0 };

  const today = localDateStr();
  const dates = rows.map((r) => r.date);

  // 현재 스트릭: 오늘 또는 어제부터 연속
  let current = 0;
  const firstDate = dates[0];
  if (firstDate === today || firstDate === yesterday()) {
    current = 1;
    for (let i = 1; i < dates.length; i++) {
      const expected = daysBeforeDate(firstDate, i);
      if (dates[i] === expected) {
        current++;
      } else {
        break;
      }
    }
  }

  // 최장 스트릭
  let longest = 0;
  let streak = 1;
  for (let i = 1; i < dates.length; i++) {
    const prev = new Date(dates[i - 1]);
    const curr = new Date(dates[i]);
    const diff = (prev.getTime() - curr.getTime()) / (1000 * 60 * 60 * 24);
    if (Math.round(diff) === 1) {
      streak++;
    } else {
      longest = Math.max(longest, streak);
      streak = 1;
    }
  }
  longest = Math.max(longest, streak, current);

  return { current, longest };
}

function yesterday(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return localDateStr(d);
}

function daysBeforeDate(dateStr: string, n: number): string {
  const [y, m, dd] = dateStr.split('-').map(Number);
  const d = new Date(y, m - 1, dd - n);
  return localDateStr(d);
}

/** 마스터한 단어 수 (Review 상태 + stability >= 30) */
export async function getMasteredCount(db: SQLiteDatabase): Promise<number> {
  const result = await db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) as count FROM card_state WHERE state = ? AND stability >= 30`,
    [State.Review]
  );
  return result?.count ?? 0;
}

function rowToCardWithEntry(row: Record<string, unknown>): CardWithEntry {
  return {
    entry: rowToEntry(row),
    card: {
      due: new Date(row.cs_due as string),
      stability: row.stability as number,
      difficulty: row.difficulty as number,
      elapsed_days: row.elapsed_days as number,
      scheduled_days: row.scheduled_days as number,
      reps: row.reps as number,
      lapses: row.lapses as number,
      learning_steps: (row.learning_steps as number) ?? 0,
      state: row.cs_state as State,
      last_review: row.last_review ? new Date(row.last_review as string) : undefined,
    },
  };
}

function newEmptyCard(): Card {
  return createEmptyCard();
}
