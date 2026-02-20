// 단어장 항목
export interface VocabEntry {
  id: string;              // `${Date.now()}_${random}`
  word: string;            // 선택한 일본어 텍스트 (기본형)
  reading: string;         // 히라가나 읽기
  romaji: string;          // 로마자
  meaning: string;         // 한국어 뜻
  pos: string;             // 품사
  exampleSentence: string; // 주변 문장
  exampleSource: string;   // 출처 URL
  note: string;            // 사용자 메모
  tags: string[];          // 사용자 지정 태그
  dateAdded: string;       // YYYY-MM-DD
  timestamp: number;       // unix ms
}

export interface VocabStorageIndex {
  dates: string[];         // 내림차순 정렬된 날짜 목록
  totalCount: number;
}

// Google Drive 동기화
export interface SyncMetadata {
  lastSyncTimestamp: number;
  partitionVersions: Record<string, number>;  // date → timestamp
  driveFileIds: Record<string, string>;       // filename → Drive file ID
  deletedEntries: Record<string, number>;     // entryId → deletion timestamp
}

export interface DriveStatus {
  loggedIn: boolean;
  email?: string;
}

export interface SyncResult {
  changed: boolean;
  pulled: number;
  pushed: number;
}

// Drive 파티션 구조
export interface DrivePartitionContent {
  date: string;
  entries: VocabEntry[];
  version: number;
}

export interface DriveSyncMeta {
  partitionVersions: Record<string, number>;
  deletedEntries: Record<string, number>;
  fsrsPartitionVersions?: Record<string, number>;
  reviewPartitionVersions?: Record<string, number>;
}

// FSRS 카드 상태 동기화
export interface DriveCardState {
  state: number;
  due: string;                    // ISO 8601
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  reps: number;
  lapses: number;
  last_review: string | null;     // ISO 8601, 머지 기준
  learning_steps?: number;
}

export interface DriveFsrsState {
  cardStates: Record<string, DriveCardState>;  // vocabId → state
  version: number;                              // unix ms
}

// Review log 동기화
export interface DriveReviewLogEntry {
  vocab_id: string;
  rating: number;
  reviewed_at: string;    // ISO 8601
}

export interface DriveReviewLogState {
  logs: DriveReviewLogEntry[];
  version: number;        // unix ms
}
