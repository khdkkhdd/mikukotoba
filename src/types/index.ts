// 형태소 분석 결과
export interface MorphemeToken {
  surface: string;       // 원문 표기 (食べる)
  reading: string;       // 히라가나 읽기 (たべる)
  romaji: string;        // 로마자 (taberu)
  pos: string;           // 품사 (動詞)
  baseForm: string;      // 기본형 (食べる)
  isKanji: boolean;      // 한자 포함 여부
}

// LLM 플랫폼 타입
export type LLMPlatform = 'claude' | 'openai' | 'gemini';

// 모델 옵션
export interface ModelOption {
  id: string;
  name: string;
  platform: LLMPlatform;
}

// 번역 결과
export interface TranslationResult {
  original: string;
  tokens: MorphemeToken[];
  korean: string;
  engine: 'papago' | LLMPlatform;
  complexityScore: number;
  fromCache: boolean;
}

// 자막 엔트리
export interface SubtitleEntry {
  start: number;
  duration: number;
  text: string;
  translation?: TranslationResult;
}

// 복잡도 판정 결과
export interface ComplexityAssessment {
  score: number;
  factors: ComplexityFactors;
  recommendation: 'papago' | 'llm';
}

export interface ComplexityFactors {
  length: number;
  hasKeigo: boolean;
  hasOnomatopoeia: boolean;
  hasIdiom: boolean;
  subjectOmitted: boolean;
  rareKanji: boolean;
}

// 사용자 설정
export interface UserSettings {
  // API 키
  papagoClientId: string;
  papagoClientSecret: string;
  claudeApiKey: string;
  openaiApiKey: string;
  geminiApiKey: string;

  // LLM 플랫폼 선택
  llmPlatform: LLMPlatform;
  llmModel: string;

  // 표시 설정
  learningLevel: LearningLevel;
  showFurigana: boolean;
  showRomaji: boolean;
  showTranslation: boolean;
  fontSize: number;
  backgroundOpacity: number;

  // 색상 커스텀 (YouTube 오버레이 / 호버 팝업)
  colorOriginal: string;
  colorFurigana: string;
  colorRomaji: string;
  colorTranslation: string;

  // 색상 커스텀 (인라인 / 후리가나 모드 — 웹페이지 배경용)
  inlineColorFurigana: string;
  inlineColorRomaji: string;
  inlineColorTranslation: string;

  // 인라인 폰트 크기 비율
  inlineFontScale: number;       // 번역 블록 전체 (기본 0.88)
  inlineFuriganaScale: number;   // 후리가나 rt (기본 0.55)

  // 번역 설정
  complexityThreshold: number;
  contextWindowSize: number;

  // 복잡도 가중치
  keigoWeight: number;
  lengthWeight: number;
  idiomWeight: number;

  // 모드 설정
  youtubeMode: boolean;
  webpageMode: WebpageMode;

  // 사이트별 설정 (확장 가능 구조)
  siteSettings?: {
    twitter?: { enabled: boolean };
    youtube?: {
      subtitleMode: boolean;
      pageTranslation: boolean;
    };
    webpage?: { mode: WebpageMode };
  };

  // 확장 프로그램 활성화
  enabled: boolean;
}

export type LearningLevel = 'beginner' | 'elementary' | 'intermediate' | 'advanced';
export type WebpageMode = 'hover' | 'inline' | 'furigana-only' | 'off';

// 번역 문맥
export interface TranslationContext {
  previousSentences: string[];
  title?: string;
  channel?: string;
  glossaryEntries?: GlossaryEntry[];
  userCorrections?: UserCorrection[];
}

// 용어집 항목
export interface GlossaryEntry {
  japanese: string;
  korean: string;
  note?: string;
}

// 사용자 번역 수정
export interface UserCorrection {
  original: string;
  oldTranslation: string;
  newTranslation: string;
  timestamp: number;
}

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

// 캐시 항목
export interface CacheEntry {
  result: TranslationResult;
  timestamp: number;
  originalText?: string;
}

// 사용 통계
export interface UsageStats {
  totalTranslations: number;
  papagoCount: number;
  claudeCount: number;
  openaiCount: number;
  geminiCount: number;
  cacheHits: number;
  dailyStats: Record<string, DayStats>;
  wordFrequency: Record<string, number>;
}

export interface DayStats {
  translations: number;
  papago: number;
  claude: number;
  openai: number;
  gemini: number;
}

// 메시지 타입 (background ↔ content ↔ popup 통신)
export type MessageType =
  | { type: 'TRANSLATE'; payload: { text: string } }
  | { type: 'TRANSLATE_RESULT'; payload: TranslationResult }
  | { type: 'SETTINGS_CHANGED'; payload: Partial<UserSettings> }
  | { type: 'MODE_CHANGED'; payload: { mode: WebpageMode } }
  | { type: 'TOGGLE_ENABLED'; payload: { enabled: boolean } }
  | { type: 'GET_SETTINGS' }
  | { type: 'SETTINGS_RESPONSE'; payload: UserSettings }
  | { type: 'CLEAR_CACHE' }
  | { type: 'GET_STATS' }
  | { type: 'STATS_RESPONSE'; payload: UsageStats }
  | { type: 'TEST_PAPAGO'; payload: { clientId: string; clientSecret: string } }
  | { type: 'TEST_CLAUDE'; payload: { apiKey: string } }
  | { type: 'TEST_OPENAI'; payload: { apiKey: string } }
  | { type: 'TEST_GEMINI'; payload: { apiKey: string } }
  | { type: 'TEST_RESULT'; payload: { success: boolean; message: string } }
  | { type: 'FETCH_PROXY'; payload: { url: string; method: string; headers: Record<string, string>; body?: string } }
  | { type: 'VOCAB_ADD_START'; payload: { text: string } }
  | { type: 'VOCAB_SAVE'; payload: VocabEntry }
  | { type: 'VOCAB_GET_INDEX' }
  | { type: 'VOCAB_GET_ENTRIES'; payload: { dates: string[] } }
  | { type: 'VOCAB_UPDATE'; payload: VocabEntry }
  | { type: 'VOCAB_DELETE'; payload: { id: string; date: string } }
  | { type: 'VOCAB_SEARCH'; payload: { query: string } }
  | { type: 'VOCAB_EXPORT' }
  | { type: 'VOCAB_IMPORT'; payload: { entries: VocabEntry[] } }
  | { type: 'DRIVE_LOGIN' }
  | { type: 'DRIVE_LOGOUT' }
  | { type: 'DRIVE_GET_STATUS' }
  | { type: 'SYNC_PULL' }
  | { type: 'SYNC_GET_STATUS' };

// 기본 설정값
export const DEFAULT_SETTINGS: UserSettings = {
  papagoClientId: '',
  papagoClientSecret: '',
  claudeApiKey: '',
  openaiApiKey: '',
  geminiApiKey: '',

  llmPlatform: 'claude',
  llmModel: 'claude-sonnet-4-5-20250929',

  learningLevel: 'beginner',
  showFurigana: true,
  showRomaji: true,
  showTranslation: true,
  fontSize: 18,
  backgroundOpacity: 80,

  colorOriginal: '#FFFFFF',
  colorFurigana: '#B0B0B0',
  colorRomaji: '#7CB9E8',
  colorTranslation: '#F0E68C',

  inlineColorFurigana: '#888888',
  inlineColorRomaji: '#4A7DFF',
  inlineColorTranslation: '#555555',

  inlineFontScale: 0.88,
  inlineFuriganaScale: 0.55,

  complexityThreshold: 5,
  contextWindowSize: 3,

  keigoWeight: 3,
  lengthWeight: 1,
  idiomWeight: 2,

  youtubeMode: true,
  webpageMode: 'hover',

  enabled: true,
};
