import type { SQLiteDatabase } from 'expo-sqlite';

export async function initDatabase(db: SQLiteDatabase): Promise<void> {
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS vocab (
      id TEXT PRIMARY KEY,
      word TEXT NOT NULL,
      reading TEXT,
      romaji TEXT,
      meaning TEXT,
      pos TEXT,
      example_sentence TEXT,
      example_source TEXT,
      note TEXT,
      date_added TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      updated_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS card_state (
      vocab_id TEXT PRIMARY KEY REFERENCES vocab(id) ON DELETE CASCADE,
      state INTEGER DEFAULT 0,
      due TEXT,
      stability REAL DEFAULT 0,
      difficulty REAL DEFAULT 0,
      elapsed_days INTEGER DEFAULT 0,
      scheduled_days INTEGER DEFAULT 0,
      reps INTEGER DEFAULT 0,
      lapses INTEGER DEFAULT 0,
      last_review TEXT,
      learning_steps INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS review_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      vocab_id TEXT REFERENCES vocab(id) ON DELETE CASCADE,
      rating INTEGER,
      reviewed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS sync_meta (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS tombstones (
      entry_id TEXT PRIMARY KEY,
      deleted_at INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_vocab_date ON vocab(date_added);
    CREATE INDEX IF NOT EXISTS idx_card_due ON card_state(due);
    CREATE INDEX IF NOT EXISTS idx_review_vocab ON review_log(vocab_id);
  `);

  await migrateCardStateLearningSteps(db);
  await migrateVocabTags(db);
}

async function migrateVocabTags(db: SQLiteDatabase): Promise<void> {
  const cols = await db.getAllAsync<{ name: string }>('PRAGMA table_info(vocab)');
  if (!cols.some((c) => c.name === 'tags')) {
    await db.execAsync("ALTER TABLE vocab ADD COLUMN tags TEXT DEFAULT '[]'");
  }
}

async function migrateCardStateLearningSteps(db: SQLiteDatabase): Promise<void> {
  const cols = await db.getAllAsync<{ name: string }>('PRAGMA table_info(card_state)');
  if (!cols.some((c) => c.name === 'learning_steps')) {
    await db.execAsync('ALTER TABLE card_state ADD COLUMN learning_steps INTEGER DEFAULT 0');
  }
}
