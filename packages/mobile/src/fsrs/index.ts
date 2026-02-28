import { fsrs, generatorParameters, createEmptyCard, type Card, type Grade, Rating, State } from 'ts-fsrs';
import type { SQLiteDatabase } from 'expo-sqlite';

const params = generatorParameters();
const scheduler = fsrs(params);

export { Rating, State, scheduler };
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
    learning_steps: (row.learning_steps as number) ?? 0,
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

  const card = createEmptyCard();

  await db.runAsync(
    `INSERT INTO card_state (vocab_id, state, due, stability, difficulty, elapsed_days, scheduled_days, reps, lapses, last_review, learning_steps)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [vocabId, card.state, card.due.toISOString(), card.stability, card.difficulty, card.elapsed_days, card.scheduled_days, card.reps, card.lapses, null, card.learning_steps]
  );

  return card;
}

// 순수 계산 — DB 접근 없음
export function computeReview(card: Card, grade: Grade, now?: Date) {
  const reviewTime = now ?? new Date();
  const allOptions = scheduler.repeat(card, reviewTime);
  return { nextCard: allOptions[grade].card, allOptions };
}

// 4개 grade별 간격 미리보기
export function getSchedulingPreview(card: Card, now?: Date): { grade: Grade; interval: string }[] {
  const reviewTime = now ?? new Date();
  const allOptions = scheduler.repeat(card, reviewTime);
  const grades: Grade[] = [Rating.Again, Rating.Hard, Rating.Good, Rating.Easy];

  return grades.map((grade) => {
    const next = allOptions[grade].card;
    return {
      grade,
      interval: formatInterval(next.due, reviewTime),
    };
  });
}

// 사람이 읽기 좋은 간격 포맷
export function formatInterval(due: Date, now: Date): string {
  const diffMs = due.getTime() - now.getTime();
  if (diffMs < 0) return '<1m';

  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return '<1m';
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.round(diffMs / 3_600_000);
  if (hours < 24) return `${hours}h`;

  const days = Math.round(diffMs / 86_400_000);
  if (days < 30) return `${days}d`;

  const months = Math.round(days / 30);
  if (months < 12) return `${months}mo`;

  const years = Math.round(days / 365);
  return `${years}y`;
}

export async function reviewCard(
  db: SQLiteDatabase,
  vocabId: string,
  grade: Grade
): Promise<Card> {
  const card = await getOrCreateCard(db, vocabId);
  const now = new Date();
  const { nextCard: next } = computeReview(card, grade, now);

  await db.runAsync(
    `UPDATE card_state SET
      state = ?, due = ?, stability = ?, difficulty = ?,
      elapsed_days = ?, scheduled_days = ?, reps = ?, lapses = ?, last_review = ?, learning_steps = ?
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
      next.learning_steps,
      vocabId,
    ]
  );

  await db.runAsync(
    'INSERT INTO review_log (vocab_id, rating, reviewed_at) VALUES (?, ?, ?)',
    [vocabId, grade, now.toISOString()]
  );

  return next;
}

// 카드 상태 저장 + review log 기록 — 세션 엔진에서 사용
// INSERT OR REPLACE: 새 카드(card_state 미존재)도 처리
export async function saveCardState(
  db: SQLiteDatabase,
  vocabId: string,
  card: Card,
  reviewedAt: Date,
  grade: Grade
): Promise<void> {
  await db.runAsync(
    `INSERT OR REPLACE INTO card_state
      (vocab_id, state, due, stability, difficulty, elapsed_days, scheduled_days, reps, lapses, last_review, learning_steps)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      vocabId,
      card.state,
      card.due.toISOString(),
      card.stability,
      card.difficulty,
      card.elapsed_days,
      card.scheduled_days,
      card.reps,
      card.lapses,
      reviewedAt.toISOString(),
      card.learning_steps,
    ]
  );

  await db.runAsync(
    'INSERT INTO review_log (vocab_id, rating, reviewed_at) VALUES (?, ?, ?)',
    [vocabId, grade, reviewedAt.toISOString()]
  );
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
  const result = await db.getFirstAsync<{ count: number }>(
    "SELECT COUNT(*) as count FROM review_log WHERE DATE(reviewed_at, '+9 hours') = DATE('now', '+9 hours')"
  );
  return result?.count ?? 0;
}
