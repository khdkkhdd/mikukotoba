# 번역 공통 기능 기술 명세

> 모든 사이트 핸들러(YouTube, Twitter, Webpage)가 공유하는 번역 파이프라인의 기술적 설계.
> 현재 구현 분석을 기반으로 하되, 개선된 아키텍처를 목표로 한다.

---

## 1. 전체 아키텍처

### 1.1 번역 파이프라인 플로우

```
원문 텍스트
  │
  ├─ [1] 캐시 조회 ──→ hit → TranslationResult 반환
  │
  ├─ [2] 형태소 분석 (Kuromoji) ──→ MorphemeToken[]
  │
  ├─ [3] 복잡도 평가 ──→ score + 엔진 추천 (papago | llm)
  │
  ├─ [4] 엔진 라우팅
  │     ├─ score ≤ threshold → Papago
  │     └─ score > threshold → LLM (Claude/OpenAI/Gemini)
  │
  ├─ [5] 번역 실행
  │     ├─ Papago: 직접 API 호출
  │     └─ LLM: 컨텍스트 + 용어집 + 프롬프트 빌딩 → API 호출
  │
  ├─ [6] 결과 조립
  │     └─ TranslationResult { korean, tokens, engine, complexity, fromCache }
  │
  └─ [7] 캐시 저장 + 반환
```

### 1.2 모듈 구조

```
src/core/
├── translator/
│   ├── index.ts              # TranslatorService (오케스트레이터)
│   ├── complexity.ts          # 복잡도 평가기
│   ├── context-manager.ts     # 번역 컨텍스트 관리
│   ├── prompt-builder.ts      # LLM 프롬프트 생성
│   ├── llm-registry.ts        # LLM 클라이언트 레지스트리
│   ├── llm-client.ts          # LLM 클라이언트 인터페이스
│   ├── claude.ts              # Claude API 클라이언트
│   ├── openai.ts              # OpenAI API 클라이언트
│   ├── gemini.ts              # Gemini API 클라이언트
│   ├── papago.ts              # Papago API 클라이언트
│   └── api-fetch.ts           # fetch 추상화 (CORS 프록시)
├── analyzer/
│   ├── morphological.ts       # 형태소 분석기 (Kuromoji)
│   └── reading-converter.ts   # 후리가나 HTML 변환
├── cache.ts                   # 이중 레이어 캐시
├── glossary.ts                # 용어집 관리
└── logger.ts                  # 구조적 로거
```

### 1.3 핵심 데이터 타입

```typescript
interface TranslationResult {
  korean: string;           // 한국어 번역
  original: string;         // 원문
  tokens: MorphemeToken[];  // 형태소 분석 결과
  engine: string;           // 사용된 엔진 (papago, claude, gpt-4o 등)
  complexityScore: number;  // 복잡도 점수 (0~10)
  fromCache: boolean;       // 캐시 히트 여부
}

interface MorphemeToken {
  surface: string;    // 표층형 (원래 텍스트)
  reading: string;    // 히라가나 읽기
  romaji: string;     // 로마자
  pos: string;        // 품사
  baseForm: string;   // 기본형
  isKanji: boolean;   // 한자 포함 여부
}
```

---

## 2. 형태소 분석 시스템

### 2.1 현재 구현

- **엔진**: Kuromoji (IPA 사전) — 브라우저에서 동작하는 유일한 실용적 선택지
- **읽기 변환**: Kuroshiro — 카타카나→히라가나 변환, 로마자 생성
- **초기화**: 사전 파일 비동기 로드 (~2-3초), 싱글턴 패턴

### 2.2 분석 플로우

```
텍스트 입력
  → Kuromoji tokenize
  → 각 토큰에 대해:
     ├─ reading: 카타카나 → 히라가나 변환
     ├─ romaji: Kuroshiro romanize
     ├─ isKanji: 한자 포함 여부 판정
     └─ baseForm: 기본형 추출
  → MorphemeToken[] 반환
```

### 2.3 현재 구현의 한계와 개선 방향

**한자 판정 로직**: 현재는 `surface`에 CJK 통합 한자 범위(`\u4E00-\u9FFF`)가 포함되면 `isKanji: true`로 판정한다. 이 범위는 대부분의 상용 한자를 커버하지만, CJK 확장 영역(Extension A~G)의 희귀 한자는 누락된다.

**개선안:**
- CJK 확장 A(`\u3400-\u4DBF`)와 호환 한자(`\uF900-\uFAFF`)를 판정 범위에 추가
- `reading === surface`인 경우 후리가나 불필요로 처리 (현재 구현과 동일, 유지)

**초기화 최적화**: Kuromoji 사전 로드가 콘텐츠 스크립트 시작을 지연시킨다.

**개선안:**
- 사전 파일을 Service Worker에서 IndexedDB에 캐싱하여 재방문 시 로드 시간 단축
- 형태소 분석이 실제로 필요한 시점까지 초기화를 지연 (lazy init) — 현재 구현에서 이미 일부 적용

**로마자 변환 정확도**: Kuroshiro의 로마자 변환은 Hepburn 방식을 기본으로 하지만, 장음 표기(`ō`, `ū`)와 `ん` 앞의 `m/n` 구분에서 불일치가 발생할 수 있다.

**개선안:**
- 로마자 표기 방식을 사용자 설정으로 제공 (Hepburn / Kunrei-shiki)
- 또는 현행 Hepburn 유지하되 알려진 예외를 후처리로 보정

### 2.4 후리가나 HTML 변환

형태소 분석 결과를 DOM에 삽입 가능한 형태로 변환하는 두 가지 방식:

| 방식 | 용도 | 출력 |
|------|------|------|
| `tokensToFuriganaHTML` | 인라인 블록, 오버레이 | `<ruby>漢字<rt>かんじ</rt></ruby>` |
| `createRubyClone` | 트윗, 댓글 등 리치 콘텐츠 | 원본 DOM 복제 + 텍스트 노드에 ruby 주입 |

**`createRubyClone`의 핵심 설계:**
- 원본 요소를 `cloneNode(true)`로 복제하여 링크, 멘션, 해시태그 등 인터랙티브 요소 보존
- 토큰 커서를 사용한 순차적 텍스트 노드 매칭
- 인라인 읽기(接続せつぞく 같은 패턴) 자동 감지 및 중복 제거
- 텍스트 노드 경계를 넘는 읽기 처리 (`readingToSkip` 메커니즘)
- `data-testid` 제거로 MutationObserver 재감지 방지

---

## 3. 복잡도 평가 시스템

### 3.1 목적

텍스트의 번역 난이도를 평가하여 Papago(단순)와 LLM(복잡) 사이에서 엔진을 자동 라우팅한다. 비용과 품질의 균형점을 찾는 것이 핵심.

### 3.2 평가 요소

현재 구현은 6가지 요소를 가중 합산하여 0~10 점수를 산출한다:

| 요소 | 가중치 | 감지 방법 | 근거 |
|------|--------|-----------|------|
| 길이 | 0.15 | 문자 수 기반 정규화 | 긴 문장은 문맥 파악이 중요 |
| 경어(敬語) | 0.25 | `ございます`, `いらっしゃる` 등 패턴 매칭 | Papago가 경어 뉘앙스를 자주 놓침 |
| 의성어/의태어 | 0.20 | カタカナ 반복 패턴, 알려진 목록 | 직역 시 의미 손실 큼 |
| 관용구 | 0.20 | `〜ても`, `〜わけ`, `〜ところ` 등 패턴 | 직역하면 의미 왜곡 |
| 주어 생략 | 0.10 | 문장 시작이 조사/동사인 경우 | 문맥 추론 필요 |
| 희귀 한자 | 0.10 | 상용한자 2136자 외 한자 감지 | Papago 사전 미등재 가능성 |

### 3.3 라우팅 결정

```
complexityScore ≤ userThreshold → Papago
complexityScore > userThreshold → LLM (선택된 플랫폼)
```

- `userThreshold`는 설정에서 0~10 슬라이더로 조절
- 기본값: 5
- 수동 모드: Papago 전용 / LLM 전용 선택 가능

### 3.4 피드백 기반 복잡도 학습

재번역 요청 패턴으로 복잡도 임계값을 세션 내 자동 조정한다:

- `retranslateScores` 배열에 재번역 시점의 complexityScore 기록 (최대 20개)
- 5개 이상 축적 시, 60% 이상이 현재 임계값 미만이면 평균값으로 임계값 하향
- 세션 내 학습만 적용 (영구 저장 미적용 — 설정 변경은 사용자 의사 존중)

### 3.5 개선 방향

**현재 한계:**
- 패턴 매칭 기반이라 false positive/negative가 존재
- 실제 번역 품질과의 상관관계가 검증되지 않음

**개선안:**

1. **가중치 사용자 조정**: 옵션 페이지에서 각 요소의 가중치를 슬라이더로 조절 가능하게 (현재 구현에 이미 UI는 있으나 `advancedWeights`로 부분 구현). 이를 완전히 활성화.

2. **문장 구조 분석 추가**: 형태소 분석 결과를 활용하여 중문/복문 구조(접속조사 `が`, `けど`, `ので` 등 연쇄)를 복잡도 요소에 추가.

---

## 4. 번역 엔진 시스템

### 4.1 엔진 인터페이스

모든 LLM 클라이언트는 공통 인터페이스를 구현한다:

```typescript
interface LLMClient {
  configure(apiKey: string): void;
  setModel(model: string): void;
  isConfigured(): boolean;
  translate(text: string, context: TranslationContext, level?: LearningLevel): Promise<string>;
  testConnection(apiKey: string): Promise<boolean>;
}
```

### 4.2 지원 엔진

| 엔진 | 용도 | API 특성 |
|------|------|----------|
| **Papago** | 기본 번역 (단순 텍스트) | REST, 무료 한도 후 유료, 일→한 특화 |
| **Claude** | 고품질 번역 (복잡 텍스트) | Messages API, 시스템 프롬프트 지원 |
| **OpenAI** | 고품질 번역 대안 | Chat Completions API |
| **Gemini** | 고품질 번역 대안 | Generate Content API, thinking 파트 분리 필요 |

### 4.3 LLM 레지스트리

```typescript
// 싱글턴 레지스트리가 모든 클라이언트를 관리
LLMRegistry {
  clients: Map<string, LLMClient>     // claude, openai, gemini
  activeClient: LLMClient | null       // 현재 선택된 클라이언트

  configure(platform, apiKey, model)   // API 키 + 모델 설정
  getActive(): LLMClient              // 현재 활성 클라이언트 반환
  getAvailableModels(platform): Model[] // 플랫폼별 모델 목록
}
```

### 4.4 Papago 클라이언트 상세

- **엔드포인트**: `https://papago.apigw.ntruss.com/nmt/v1/translation`
- **인증**: X-NCP-APIGW-API-KEY-ID + X-NCP-APIGW-API-KEY (헤더)
- **재시도**: 최대 3회 시도 (2회 재시도), 지수 백오프 (1초, 2초)
- **제한**: NCP 유료 API (무료 체험 제공)

### 4.5 LLM 클라이언트 공통 패턴

모든 LLM 클라이언트가 공유하는 패턴:

- **재시도 전략**: 최대 2회, 429(rate limit) 시 `Retry-After` 헤더 존중
- **타임아웃**: 30초 (긴 텍스트의 경우 조정 필요)
- **에러 분류**: 인증 오류(401/403) vs 일시적 오류(429/500/503) 구분
- **토큰 사용량 추적**: 응답 헤더/바디에서 토큰 수 추출, 누적 통계 기록

### 4.6 CORS 프록시

Chrome Extension의 Content Script는 직접 외부 API를 호출할 수 없다 (CORS). Background Service Worker를 프록시로 사용:

```
Content Script                    Service Worker
     │                                │
     ├─ chrome.runtime.sendMessage ──→│
     │   { type: 'FETCH_PROXY',      │
     │     url, method, headers,      │
     │     body }                     │
     │                                ├─ fetch(url, options)
     │                                │
     │←── sendResponse ──────────────│
     │   { status, data }             │
```

**개선안:**
- 현재 `api-fetch.ts`에서 `fetchFn`을 교체 가능한 구조이나, Content Script에서의 프록시 설정이 `content/index.ts`의 초기화 시점에 묻혀 있음
- `TranslatorService` 생성 시 fetch 전략을 명시적으로 주입하는 방식으로 개선

---

## 5. 프롬프트 시스템

### 5.1 프롬프트 구조

LLM 번역 시 시스템 프롬프트와 사용자 프롬프트를 조합한다:

**시스템 프롬프트 구성:**
```
[역할 정의] 일본어→한국어 전문 번역가
[학습 레벨] beginner | intermediate | advanced
[번역 규칙] 자연스러운 한국어, 의역 허용, 경어 보존 등
[용어집] 용어 목록 (있는 경우)
[이전 문맥] 최근 번역된 문장들 (있는 경우)
```

**사용자 프롬프트 구성:**
```
[메타데이터] 출처(YouTube 자막, 트윗 등), 화자 정보
[원문] 번역할 텍스트
[지시] "한국어 번역만 출력하세요"
```

### 5.2 학습 레벨별 프롬프트 템플릿

`LEVEL_TEMPLATES` 맵으로 4단계 학습 레벨별 시스템 프롬프트를 정의한다:

| 레벨 | 프롬프트 특성 |
|------|-------------|
| beginner | 쉬운 한국어, 원문 병기 적극, 문화 배경 설명 |
| elementary | 기본 번역에 어려운 표현 병기, 경어→존댓말 |
| intermediate | 자연스러운 번역, 관용표현 유지 |
| advanced | 최소 병기, 자연스러운 의역, 경어 세분화 |

`buildSystemPrompt(context, level?)` 시그니처로, 학습 레벨이 프롬프트에 반영된다. 각 LLM 클라이언트의 `translate(text, context, level?)` 호출 시 레벨을 전달.

### 5.3 개선 방향

**개선안:**

1. **사이트 핸들러가 메타데이터 주입**: 프롬프트 빌더가 사이트별 세부사항을 알 필요 없이, 핸들러가 `TranslationContext`에 메타데이터를 채워주는 구조.

2. **응답 형식 강제**: LLM이 번역 외의 부가 설명을 출력하는 경우가 있음. 응답에서 번역 텍스트만 추출하는 후처리 로직 강화.

---

## 6. 컨텍스트 관리

### 6.1 목적

연속된 문장(자막, 대화 등)을 번역할 때, 이전 번역 결과를 참고하여 일관성을 유지한다.

### 6.2 현재 구현

```typescript
ContextManager {
  previousSentences: string[]   // 최근 N개 원문+번역 쌍
  metadata: Record<string, string>
  glossaryEntries: GlossaryEntry[]

  addSentence(original, translated)
  getContext(): TranslationContext
  clear()
}
```

- 윈도우 크기: 사용자 설정 (기본 3문장)
- 새 비디오/페이지 전환 시 `clear()` 호출

### 6.3 개선 방향

**현재 한계:**
- 단순 배열 기반으로 "가장 최근 N개"만 유지 — 토큰 수 고려 없음
- 자막처럼 빠르게 흐르는 콘텐츠에서 컨텍스트가 너무 빠르게 밀려남

**개선안:**

1. **토큰 기반 윈도우**: 문장 수가 아닌 토큰 수로 컨텍스트 크기를 제한. LLM의 컨텍스트 윈도우를 효율적으로 사용.

2. **중요도 가중 유지**: 직전 문장은 항상 포함, 이전 문장 중 핵심 명사/고유명사가 포함된 문장을 우선 유지.

3. **사이트별 컨텍스트 전략**:
   - YouTube 자막: 시간 기반 윈도우 (최근 30초 이내 자막)
   - Twitter: 트윗 스레드 단위로 컨텍스트 그룹핑
   - Webpage: 같은 블록 부모 내 인접 텍스트

---

## 7. 캐시 시스템

### 7.1 이중 레이어 구조

```
요청 → [L1: 메모리 캐시] → hit → 반환
         miss ↓
       [L2: Chrome Storage] → hit → L1에 승격 + 반환
         miss ↓
       번역 실행 → L1 + L2에 저장
```

### 7.2 현재 구현 상세

| 속성 | L1 (메모리) | L2 (Chrome Storage) |
|------|------------|-------------------|
| 저장소 | `Map<string, CacheEntry>` | `chrome.storage.local` |
| 수명 | 탭 세션 동안 | 30일 만료 |
| 용량 | LRU (최대 200개) | 인덱스 기반 관리 |
| 키 | `hash(text)` | `jp_cache_{hash}` |
| 퇴거 | 탭 종료 시 소멸 | LRU (최대 5000개) |

**캐시 키 생성**: 텍스트를 SHA-like 해시(현재는 간단한 문자열 해시)로 변환.

### 7.3 컨텍스트-인식 캐시 키

`hashKey(text, source?)` 형태로, 출처(hostname)를 캐시 키에 선택적으로 포함한다:

- `source`가 있으면 `${source}:${text}`를 해시
- `source`가 없으면 기존 동작과 동일 (하위 호환)
- Content script에서 `location.hostname`을 source로 전달
- 메모리 캐시 키도 동일 패턴: `memoryCacheKey(text, source?)`

같은 텍스트라도 YouTube/Twitter/일반 웹에서 번역 톤이 다를 수 있으므로 출처별로 캐시를 분리.

### 7.4 개선 방향

**현재 한계:**
- L2 캐시의 LRU 퇴거가 인덱스 전체를 읽어와 정렬하는 방식이라 1000개 이상 시 느림
- "재번역" 결과가 캐시를 덮어쓰는데, 이전 번역으로 돌아갈 수 없음

**개선안:**

1. **분할 인덱스**: 날짜별/사이트별로 인덱스를 분할하여 퇴거 연산 범위를 제한.

2. **재번역 이력**: 최대 2개의 번역 결과를 저장하여 "이전 번역 / 현재 번역" 토글 가능.

---

## 8. 용어집 시스템

### 8.1 구조

```typescript
GlossaryManager {
  builtInEntries: GlossaryEntry[]   // 내장 용어 (~50개)
  customEntries: GlossaryEntry[]    // 사용자 추가 용어

  lookup(text): GlossaryEntry[]     // 텍스트에서 매칭되는 용어 검색
  addCustom(entry): void
  removeCustom(id): void
  importCSV(csv): void
  exportCSV(): string
}

interface GlossaryEntry {
  japanese: string;   // 일본어 원문
  korean: string;     // 한국어 번역
  note?: string;      // 메모
}
```

### 8.2 내장 용어 카테고리

- **인사말**: おはようございます → 안녕하세요 (맥락: 아침 인사)
- **문화 표현**: お疲れ様 → 수고하셨습니다
- **흔한 오역 방지**: 大丈夫 → 괜찮아 (Papago가 "대장부"로 번역하는 경우 방지)

### 8.3 용어집이 번역에 적용되는 방식

1. **Papago**: 용어집 적용 불가 (API가 용어집을 지원하지 않음). 번역 후 후처리로 치환하는 방식은 문맥 파괴 위험이 있어 미적용.

2. **LLM**: 시스템 프롬프트에 용어집을 포함하여 번역 시 참조하도록 지시.

```
다음 용어집을 참고하여 번역하세요:
- お疲れ様 → 수고하셨습니다
- 推し → 최애
- ...
```

### 8.4 개선 방향

1. **빈도 기반 정렬**: 프롬프트에 모든 용어를 포함하면 토큰 낭비. 원문에 실제 등장하는 용어만 필터링하여 포함 (현재 `lookup()`이 이 역할을 하나 매칭 정확도 개선 필요).

2. **카테고리 관리**: 용어를 카테고리(인사말, 문화, 인터넷 용어 등)로 분류하여 사용자가 카테고리 단위로 활성화/비활성화.

3. **단어장 연동**: 단어장에 추가된 단어는 Service Worker의 `addVocabToGlossary()`를 통해 용어집에 자동 반영된다. `note: '단어장에서 자동 추가'`로 출처를 표시하며, 동일 japanese 키가 이미 존재하면 스킵한다.

---

## 9. 재번역 (Retranslate) 메커니즘

### 9.1 목적

Papago 번역이 부자연스러운 경우, 사용자가 한 클릭으로 LLM 재번역을 요청한다.

### 9.2 플로우

```
사용자가 ↻ 버튼 클릭
  → translator.retranslate(text)
  → 캐시 무시, 강제 LLM 번역
  → 결과로 기존 번역 교체
  → 새 결과를 캐시에 저장 (기존 캐시 덮어쓰기)
```

### 9.3 UI 통합

모든 렌더러(인라인 블록, 호버 툴팁, 자막 오버레이)에 ↻ 버튼이 포함되며:
- 클릭 시 스피닝 애니메이션
- 성공 시 번역 텍스트 + 엔진 배지 교체
- 실패 시 스피닝 해제 (조용한 실패)

---

## 10. API 통신 계층

### 10.1 fetch 추상화

```typescript
// api-fetch.ts
let fetchFn: typeof fetch = fetch;

export function setFetchBackend(fn: typeof fetch): void {
  fetchFn = fn;
}

export function apiFetch(url: string, options: RequestInit): Promise<Response> {
  return fetchFn(url, options);
}
```

Content Script에서는 Service Worker 프록시를 `fetchFn`으로 주입:

```typescript
setFetchBackend((url, options) => {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { type: 'FETCH_PROXY', url, method: options.method, headers: options.headers, body: options.body },
      (response) => resolve(new Response(JSON.stringify(response.data), { status: response.status }))
    );
  });
});
```

### 10.2 동시 요청 제어 및 중복 제거

Translator에서 요청 동시성과 중복을 관리한다:

- **동시 요청 제한**: `maxConcurrent = 3`, FIFO 큐로 초과 요청 대기
- **In-flight dedup**: `inflight` Map<normalizedText, Promise>으로 동일 텍스트의 중복 요청 병합. skipCache(재번역) 요청은 dedup 대상에서 제외. 완료 시 Map에서 자동 제거.

### 10.3 개선 방향

1. **요청 병합(Batching)**: 짧은 시간 내 들어온 짧은 텍스트를 묶어서 하나의 LLM 요청으로 처리. 예: 트위터의 여러 짧은 트윗을 배치로 번역.

2. **스트리밍 응답**: LLM의 스트리밍 API를 활용하여 긴 텍스트의 번역 결과를 점진적으로 표시. Service Worker 프록시를 통한 스트리밍은 기술적 한계가 있어, `chrome.runtime.connect()` 포트 기반 통신으로 전환 필요.

---

## 11. 에러 처리 전략

### 11.1 에러 분류

| 에러 유형 | HTTP 코드 | 대응 |
|----------|----------|------|
| 인증 실패 | 401, 403 | 재시도 안 함, 사용자에게 API 키 확인 요청 |
| Rate limit | 429 | `Retry-After` 존중, 지수 백오프 |
| 서버 오류 | 500, 502, 503 | 최대 2회 재시도, 지수 백오프 |
| 네트워크 오류 | - | 최대 1회 재시도 |
| 타임아웃 | - | 재시도 안 함, 사용자에게 표시 |

### 11.2 Fallback 전략

```
LLM 번역 실패
  → Papago로 자동 fallback
  → Papago도 실패 시 에러 상태 표시 (↻ 재시도 버튼)
```

### 11.3 개선 방향

1. **세분화된 에러 타입**: 현재는 catch-all 방식. 에러 타입별 전용 클래스를 정의하여 핸들러에서 적절히 대응.

```typescript
class TranslationError extends Error {
  constructor(
    message: string,
    public readonly code: 'AUTH' | 'RATE_LIMIT' | 'SERVER' | 'NETWORK' | 'TIMEOUT',
    public readonly retryable: boolean,
  ) { super(message); }
}
```

2. **에러 통계**: 엔진별 에러 빈도를 추적하여, 특정 엔진이 반복 실패 시 자동으로 대체 엔진으로 전환 제안.

---

## 12. 성능 고려사항

### 12.1 형태소 분석 비용

- Kuromoji 초기화: ~2-3초 (사전 로드)
- 분석 자체: ~1-5ms/문장 (충분히 빠름)
- **병목**: 초기화만 문제. 이후 분석은 무시 가능 수준

### 12.2 번역 API 지연

| 엔진 | 평균 지연 | 비고 |
|------|----------|------|
| Papago | 200-500ms | 가장 빠름 |
| Claude | 1-3초 | 모델에 따라 차이 |
| OpenAI | 1-3초 | GPT-4o가 4보다 빠름 |
| Gemini | 1-3초 | Flash가 Pro보다 빠름 |

### 12.3 최적화 전략

1. **형태소 분석과 번역 병렬 실행**: 현재 `translator.translate()`에서 형태소 분석 후 번역을 순차 실행. 독립적이므로 `Promise.all`로 병렬화 가능. (현재 구현에서 이미 일부 적용)

2. **프리페치**: YouTube 자막의 경우, 현재 자막 번역 중 다음 자막을 미리 번역 시작.

3. **디바운싱/스로틀링**: 호버 모드에서 마우스 이동마다 번역을 요청하지 않도록 debounce 적용 (현재 구현 유지).

---

## 13. 설정과 번역 시스템의 연결

### 13.1 번역에 영향을 미치는 설정 항목

```typescript
// UserSettings 중 번역 관련
interface TranslationSettings {
  // 엔진 선택
  papagoClientId: string;
  papagoClientSecret: string;
  llmPlatform: 'claude' | 'openai' | 'gemini';
  llmModel: string;
  llmApiKey: string;

  // 라우팅
  complexityThreshold: number;   // 0 ~ 10

  // 컨텍스트
  contextWindowSize: number;     // 이전 문장 수
  learningLevel: LearningLevel;

  // 표시
  showFurigana: boolean;
  showTranslation: boolean;
  showRomaji: boolean;

  // 스타일
  colorFurigana: string;
  colorTranslation: string;
  colorRomaji: string;
}
```

### 13.2 설정 변경 시 반응

설정 변경은 `chrome.storage.onChanged` 이벤트를 통해 실시간으로 모든 탭에 전파된다. 각 핸들러는 `updateSettings()`를 통해 변경을 수신하며, 번역 관련 설정 변경 시:

- 엔진 변경: 다음 번역부터 새 엔진 사용 (이미 완료된 번역은 유지)
- 표시 토글: 기존 번역 요소를 숨기거나 보이기 (재번역 불필요)
- 임계값 변경: 다음 번역부터 새 임계값 적용

---

## 14. 설정 저장 아키텍처

### 14.1 스토리지 분리 전략

설정은 보안 수준에 따라 두 스토리지에 분리 저장된다:

| 스토리지 | 저장 항목 | 특성 |
|---------|----------|------|
| `chrome.storage.sync` | 표시 설정, 학습 레벨, 색상, 모드 | Google 계정으로 기기 간 동기화 |
| `chrome.storage.local` | API 키 (Papago, Claude, OpenAI, Gemini) | 기기 전용, 동기화 안 됨 |

**API 키를 local에 저장하는 이유:** sync 스토리지는 Google 서버를 경유하므로, API 키 같은 민감 정보는 기기 내에만 보관한다.

### 14.2 설정 변경 전파

```
설정 변경 (팝업/옵션 페이지)
  → chrome.storage.sync.set() / chrome.storage.local.set()
  → chrome.storage.onChanged 이벤트 자동 발생
  → Service Worker: broadcastToAllTabs()
     → chrome.tabs.sendMessage({ type: 'SETTINGS_CHANGED', payload })
  → 각 탭의 Content Script: handler.updateSettings(newSettings)
```

### 14.3 메시지 프로토콜

Content Script ↔ Background 간 핵심 설정 관련 메시지:

| 메시지 타입 | 방향 | 용도 |
|------------|------|------|
| `SETTINGS_CHANGED` | Background → Content | 설정 변경 전파 |
| `MODE_CHANGED` | Background → Content | 번역 모드 변경 |
| `TOGGLE_ENABLED` | Background → Content | 확장 활성/비활성 토글 |
| `GET_SETTINGS` | Content/Popup → Background | 현재 설정 조회 |
| `SETTINGS_RESPONSE` | Background → Content/Popup | 설정 응답 |

---

## 15. 사용 통계 시스템

### 15.1 데이터 모델

```typescript
interface UsageStats {
  totalTranslations: number;    // 누적 번역 수
  papagoCount: number;          // Papago 사용 횟수
  claudeCount: number;          // Claude 사용 횟수
  openaiCount: number;          // OpenAI 사용 횟수
  geminiCount: number;          // Gemini 사용 횟수
  cacheHits: number;            // 캐시 히트 수
  dailyStats: Record<string, DayStats>;  // 일별 통계
  wordFrequency: Record<string, number>; // 단어 빈도
}

interface DayStats {
  translations: number;
  papago: number;
  claude: number;
  openai: number;
  gemini: number;
}
```

### 15.2 수집 시점

번역 완료 시 Service Worker에서 `updateStats()`를 호출하여 통계를 갱신한다:
- 번역 엔진에 따라 해당 카운터 증가
- 캐시 히트 시 `cacheHits` 증가
- 일별 통계(`YYYY-MM-DD` 키)에 누적

### 15.3 저장소

`chrome.storage.local`에 `jp_usage_stats` 키로 저장. 일별 통계는 90일 이상 된 항목을 자동 정리.

### 15.4 옵션 페이지 표시

옵션 페이지에서 엔진별 사용 비율 막대 그래프와 일별 번역 추이를 표시한다.

---

## 16. 공유 렌더러 계층

### 16.1 범위

`src/content/shared/renderers/` 디렉토리의 공유 렌더러는 모든 사이트 핸들러(YouTube, Twitter, Webpage)에서 사용된다. 각 렌더러의 구체적인 사용 방법은 사이트별 기술 명세에서 다루며, 여기서는 공통 인터페이스만 정의한다.

### 16.2 렌더러 목록

| 모듈 | 역할 |
|------|------|
| `inline-block.ts` | 번역 블록 생성 (`createInlineBlock`) |
| `furigana-block.ts` | 스타일 복제 후리가나 블록 (`createStyledFuriganaBlock`) |
| `ruby-injector.ts` | DOM 클론 + ruby 주입 (`createRubyClone`) |
| `hover-tooltip.ts` | 호버 팝업 (`HoverTooltip`) |
| `engine-badge.ts` | 엔진 표시 배지 (`formatEngineBadge`) |
| `spoiler.ts` | 블러 스포일러 (`addSpoilerBehavior`) |

### 16.3 핵심 인터페이스

**`createInlineBlock(result, settings, options?)`**: TranslationResult를 받아 번역 블록 DOM 요소를 생성한다.
- `options.spoiler: boolean` — 블러 스포일러 적용
- `options.skipFurigana: boolean` — 후리가나 생략 (별도 블록으로 표시할 때)
- `options.onRetranslate: () => Promise<TranslationResult>` — 재번역 콜백
- `options.className: string` — 추가 CSS 클래스
- `options.translationAttr: string` — 번역 요소 마킹 속성

**`createStyledFuriganaBlock(result, el, options?)`**: 원문 요소의 computed style을 복제하여 시각적으로 동일한 후리가나 블록을 생성한다.

**`createRubyClone(el, tokens, options?)`**: 원본 DOM을 deep clone하여 텍스트 노드에 ruby 태그를 주입한다. 링크, 멘션 등 인터랙티브 요소가 보존된다.

**`HoverTooltip(settings, config)`**: Shadow DOM 기반 호버 팝업. `config.debounceMs`로 사이트별 지연 시간 설정, `config.getTargetAtPoint(x, y)`로 타겟 탐색 위임.

---

## 17. 핸들러 레지스트리 시스템

### 17.1 SiteHandler 인터페이스

모든 사이트 핸들러가 구현하는 공통 인터페이스:

```typescript
interface SiteHandler {
  id: string;
  priority: number;
  requiresJapaneseContent?: boolean;

  matches(url: string): boolean;
  isEnabled(settings: UserSettings): boolean;
  start(): void;
  stop(): void;
  updateSettings(settings: UserSettings): void;
}
```

### 17.2 HandlerRegistry

`content/handlers/registry.ts`가 핸들러 등록과 매칭을 관리한다:

```
HandlerRegistry.register(handler)
  → handlers 배열에 추가 (priority 내림차순 정렬)

HandlerRegistry.getMatchingHandlers(url, settings)
  → handlers.filter(h => h.matches(url) && h.isEnabled(settings))
  → requiresJapaneseContent 핸들러는 lazy 그룹으로 분류
```

### 17.3 초기화 플로우 (content/index.ts)

```
페이지 로드
  → getSettings()
  → HandlerRegistry.getMatchingHandlers()
  → 즉시 핸들러: handler.start() 호출
  → lazy 핸들러: hasJapaneseContent() 확인 후 조건부 start()
  → chrome.runtime.onMessage: SETTINGS_CHANGED → handler.updateSettings()
```

---

## 18. 키보드 단축키

### 18.1 등록 방식

`manifest.json`의 `commands` 필드에 단축키를 정의하고, Service Worker의 `chrome.commands.onCommand`에서 처리한다.

### 18.2 단축키 목록

| 단축키 | 동작 |
|--------|------|
| `Alt+J` | 확장 프로그램 활성/비활성 토글 |
| `Alt+F` | 후리가나 표시 토글 |
| `Alt+T` | 번역 표시 토글 |
| `Alt+R` | 로마자 표시 토글 |

### 18.3 처리 플로우

```
chrome.commands.onCommand
  → 해당 설정값 토글
  → chrome.storage.sync.set()
  → onChanged 이벤트로 자동 전파 (14.2절 참조)
```
