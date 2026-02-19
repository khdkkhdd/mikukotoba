import { fsrs, generatorParameters, createEmptyCard, type Card, type Grade, Rating, State } from 'ts-fsrs';
import type { SQLiteDatabase } from 'expo-sqlite';

const params = generatorParameters();
const scheduler = fsrs(params);

export { Rating, State };
export type { Card, Grade };

function rowToCard(row: Record<string, unknown>): Card {
  return {
    due: new Date(row.due as string),
    stability: row.stability as number,
    difficulty: row.difficulty as number,
    elapsed_days: row.elapsed_days as number,
    scheduled_days: row.scheduled_days as number,
    reps: row.reps as number,
    lapses: row.lapses as number,
    learning_steps: 0,
    state: row.state as State,
    last_review: row.last_review ? new Date(row.last_review as string) : undefined,
  };
}

export async function getOrCreateCard(db: SQLiteDatabase, vocabId: string): Promise<Card> {
  const row = await db.getFirstAsync<Record<string, unknown>>(
    'SELECT * FROM card_state WHERE vocab_id = ?',
    [vocabId]
  );

  if (row) {
    return rowToCard(row);
  }

  // 새 카드 생성
  const card = createEmptyCard();

  await db.runAsync(
    `INSERT INTO card_state (vocab_id, state, due, stability, difficulty, elapsed_days, scheduled_days, reps, lapses, last_review)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [vocabId, card.state, card.due.toISOString(), 0, 0, 0, 0, 0, 0, null]
  );

  return card;
}

export async function reviewCard(
  db: SQLiteDatabase,
  vocabId: string,
  grade: Grade
): Promise<Card> {
  const card = await getOrCreateCard(db, vocabId);
  const now = new Date();
  const result = scheduler.repeat(card, now);
  const next = result[grade].card;

  await db.runAsync(
    `UPDATE card_state SET
      state = ?, due = ?, stability = ?, difficulty = ?,
      elapsed_days = ?, scheduled_days = ?, reps = ?, lapses = ?, last_review = ?
     WHERE vocab_id = ?`,
    [
      next.state,
      next.due.toISOString(),
      next.stability,
      next.difficulty,
      next.elapsed_days,
      next.scheduled_days,
      next.reps,
      next.lapses,
      now.toISOString(),
      vocabId,
    ]
  );

  // 학습 기록 저장
  await db.runAsync(
    'INSERT INTO review_log (vocab_id, rating, reviewed_at) VALUES (?, ?, ?)',
    [vocabId, grade, now.toISOString()]
  );

  return next;
}

export async function getDueCards(db: SQLiteDatabase, limit?: number): Promise<string[]> {
  const now = new Date().toISOString();
  const sql = limit
    ? 'SELECT vocab_id FROM card_state WHERE due <= ? ORDER BY due ASC LIMIT ?'
    : 'SELECT vocab_id FROM card_state WHERE due <= ? ORDER BY due ASC';
  const params = limit ? [now, limit] : [now];
  const rows = await db.getAllAsync<{ vocab_id: string }>(sql, params);
  return rows.map((r) => r.vocab_id);
}

export async function getNewCards(db: SQLiteDatabase, limit: number): Promise<string[]> {
  const rows = await db.getAllAsync<{ id: string }>(
    `SELECT v.id FROM vocab v
     LEFT JOIN card_state cs ON v.id = cs.vocab_id
     WHERE cs.vocab_id IS NULL
     ORDER BY v.timestamp ASC LIMIT ?`,
    [limit]
  );
  return rows.map((r) => r.id);
}

export async function getDueCount(db: SQLiteDatabase): Promise<number> {
  const now = new Date().toISOString();
  const result = await db.getFirstAsync<{ count: number }>(
    'SELECT COUNT(*) as count FROM card_state WHERE due <= ?',
    [now]
  );
  return result?.count ?? 0;
}

export async function getNewCount(db: SQLiteDatabase): Promise<number> {
  const result = await db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) as count FROM vocab v
     LEFT JOIN card_state cs ON v.id = cs.vocab_id
     WHERE cs.vocab_id IS NULL`
  );
  return result?.count ?? 0;
}

export async function getTodayReviewCount(db: SQLiteDatabase): Promise<number> {
  const today = new Date().toISOString().slice(0, 10);
  const result = await db.getFirstAsync<{ count: number }>(
    "SELECT COUNT(*) as count FROM review_log WHERE reviewed_at LIKE ?",
    [`${today}%`]
  );
  return result?.count ?? 0;
}
