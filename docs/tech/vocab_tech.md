# 단어장 기능 기술 명세

> 웹 브라우징 중 일본어 단어를 수집·분석·관리·학습하는 단어장 기능의 기술적 설계.
> 현재 구현 분석을 기반으로 하되, 개선된 아키텍처를 목표로 한다.

---

## 1. 전체 아키텍처

### 1.1 시스템 구성

단어장 기능은 3개의 실행 컨텍스트에 걸쳐 동작한다:

```
┌─────────────────────────────────────────────────────────┐
│  Content Script (웹 페이지)                               │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │ selection-   │  │ vocab-add-   │  │ vocab-modal   │  │
│  │ capture      │  │ handler      │  │ (Shadow DOM)  │  │
│  └──────┬───────┘  └──────┬───────┘  └───────────────┘  │
│         │ contextmenu      │ autoFill                     │
│         └─────────→ ┌──────┴───────┐                      │
│                     │ handleVocab  │                      │
│                     │ Add()        │                      │
│                     └──────┬───────┘                      │
└────────────────────────────┼────────────────────────────┘
                             │ chrome.runtime.sendMessage
┌────────────────────────────┼────────────────────────────┐
│  Service Worker (백그라운드)  │                            │
│                     ┌──────┴───────┐                      │
│                     │ Message      │                      │
│                     │ Router       │                      │
│                     └──────┬───────┘                      │
│                     ┌──────┴───────┐                      │
│                     │ VocabStorage │                      │
│                     └──────┬───────┘                      │
│                            │ chrome.storage.local          │
└────────────────────────────┼────────────────────────────┘
                             │
┌────────────────────────────┼────────────────────────────┐
│  Vocabulary Page (Extension Tab)                          │
│  ┌─────────────────────────┴──────────────────────────┐  │
│  │ vocabulary.ts — 목록, 검색, 퀴즈, 편집, 내보내기       │  │
│  └────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

### 1.2 단어 추가 플로우

```
[1] 사용자가 일본어 텍스트 드래그 선택
[2] 우클릭 → 컨텍스트 메뉴 "JP 단어장에 추가"
    │
    ├─ selection-capture.ts: contextmenu 이벤트에서 선택 텍스트 + 주변 문장 캡처
    │  (컨텍스트 메뉴가 열리면 브라우저가 selection을 해제하므로, 미리 캡처 필수)
    │
    ├─ service-worker: contextMenus.onClicked → 해당 탭에 VOCAB_ADD_START 메시지
    │
    ├─ content/index.ts: handleVocabAdd()
    │   ├─ [3] 로딩 모달 즉시 표시 (분석 중... 스피너)
    │   ├─ [4] translator 초기화 확인 (Kuromoji 사전 로드)
    │   ├─ [5] autoFillVocab() 호출
    │   │   ├─ 형태소 분석 (MorphemeToken[])     ┐
    │   │   └─ 번역 (TranslationResult)          ┘ Promise.allSettled 병렬
    │   │
    │   │   결과 조립:
    │   │   ├─ word: 기본형 (단일 토큰 시) 또는 원문
    │   │   ├─ reading: 전체 토큰의 히라가나 연결
    │   │   ├─ romaji: 전체 토큰의 로마자 연결 (공백 구분)
    │   │   ├─ pos: 주요 토큰의 품사 (記号, 助詞 제외)
    │   │   ├─ meaning: 한국어 번역
    │   │   └─ exampleSentence: 캡처된 주변 문장
    │   │
    │   └─ [6] updateVocabModal(autoFill, onSave)
    │       ├─ 로딩 → 폼 전환 (자동 채움된 값 표시)
    │       ├─ 사용자 편집 가능 (모든 필드)
    │       └─ 저장 클릭 → buildVocabEntry() → VOCAB_SAVE 메시지
    │
    └─ [7] VocabStorage.addEntry() → chrome.storage.local에 저장
```

### 1.3 핵심 데이터 타입

```typescript
interface VocabEntry {
  id: string;              // `${Date.now()}_${random6chars}` — 유니크 ID
  word: string;            // 일본어 단어 (기본형 변환됨)
  reading: string;         // 히라가나 읽기
  romaji: string;          // 로마자
  meaning: string;         // 한국어 뜻
  pos: string;             // 품사
  exampleSentence: string; // 예문 (선택 당시 주변 문장)
  exampleSource: string;   // 출처 URL
  note: string;            // 사용자 메모
  dateAdded: string;       // YYYY-MM-DD
  timestamp: number;       // unix ms (정렬용)
}

interface VocabStorageIndex {
  dates: string[];         // 내림차순 정렬된 날짜 목록
  totalCount: number;      // 전체 항목 수
}
```

### 1.4 팝업에서 단어장 열기

팝업의 "단어장" 버튼 클릭 시 `chrome.tabs.create({ url: chrome.runtime.getURL('vocabulary.html') })`로 새 탭에서 단어장 페이지를 연다. 팝업과 단어장 페이지는 직접 통신하지 않으며, 각각 독립적으로 Service Worker와 메시지를 교환한다.

---

## 2. 스토리지 설계

### 2.1 현재 구현: 날짜 기반 파티셔닝

Chrome Storage Local에 날짜별로 항목을 분할 저장한다:

```
키                          값
──────────────────────      ──────────────────────
jp_vocab_index              { dates: ["2026-02-19", "2026-02-18", ...], totalCount: 42 }
jp_vocab_2026-02-19         [ VocabEntry, VocabEntry, ... ]
jp_vocab_2026-02-18         [ VocabEntry, VocabEntry, ... ]
```

**이 설계의 장점:**
- 날짜별 페이지네이션이 자연스러움 — 최근 7일 로드 시 7개 키만 조회
- 항목 추가 시 해당 날짜 파티션만 읽기/쓰기
- 삭제 시 빈 파티션은 키 자체를 제거하여 정리

**현재 구현의 연산 복잡도:**

| 연산 | 스토리지 접근 | 비고 |
|------|-------------|------|
| 추가 | read index + read date + write date + write index | 4회 |
| 삭제 | read date + write date + read index + write index | 4회 |
| 수정 | read date + write date | 2회 (인덱스 불변) |
| 검색 | read index + read all dates | N+1회 (전수 검색) |
| 내보내기 | read index + read all dates | N+1회 |
| 날짜별 로드 | read 1 date | 1회 |

### 2.15 동시 접근 고려사항

`addEntry`와 `deleteEntry`는 인덱스를 read → modify → write하는 패턴이다. 사용자가 빠르게 여러 단어를 연속 추가하면, `getIndex()` → `saveIndex()` 사이에 다른 `addEntry` 호출이 끼어들어 `totalCount`가 틀어질 수 있다.

**현재 완화 요소:** Chrome Extension의 Service Worker는 단일 스레드이며, `chrome.runtime.onMessage` 핸들러가 `async`여도 메시지 큐 처리는 순차적이다. 그러나 각 핸들러 내의 `await` 지점에서 다른 메시지가 처리될 수 있으므로 이론적 race condition 가능성은 존재한다.

**개선안:** 인덱스 갱신을 직렬화 큐로 감싸거나, `chrome.storage.local.get` + `set`을 단일 트랜잭션으로 묶는 헬퍼 함수를 사용.

### 2.2 개선 방향

**검색 성능:**
현재 검색은 모든 날짜 파티션을 로드하여 메모리에서 필터링한다. 단어 수가 수백 개를 넘으면 성능 저하가 우려된다.

**개선안 1 — 역인덱스 도입:**
```
jp_vocab_search_index: {
  "食べる": ["2026-02-19_abc123"],
  "たべる": ["2026-02-19_abc123"],
  "taberu": ["2026-02-19_abc123"],
  "먹다":   ["2026-02-19_abc123"],
  ...
}
```
- 단어, 읽기, 로마자, 뜻의 토큰을 역인덱스에 등록
- 검색 시 역인덱스에서 매칭 ID를 찾고, 해당 날짜 파티션만 로드
- 트레이드오프: 추가/삭제 시 인덱스 갱신 비용 증가

**개선안 2 — 검색 전용 경량 배열:**
```
jp_vocab_search_flat: [
  { id, date, word, reading, romaji, meaning },  // 검색 필드만 포함
  ...
]
```
- 전체 항목의 검색 가능 필드만 모은 플랫 배열
- 검색 시 이 배열 하나만 로드하여 필터링 후, 매칭 항목의 전체 데이터는 날짜 파티션에서 로드
- 트레이드오프: 항목 수 × 검색 필드 크기만큼 추가 저장 공간 소모

**권장: 개선안 2** — 구현 단순성과 검색 성능의 균형이 가장 좋다. 1000개 항목 기준으로 경량 배열은 ~100KB 이내로 단일 `chrome.storage.local.get` 호출로 충분히 처리 가능.

**중복 방지:**
현재 같은 단어를 여러 번 추가할 수 있다. 의도적 설계(같은 단어를 다른 문맥에서 만났을 때 별도 기록)일 수 있으나, 사용자에게 "이미 등록된 단어입니다" 알림은 제공하는 것이 좋다.

**개선안:**
- 추가 시 `word` 필드로 기존 항목 검색
- 매칭 발견 시 모달에 "이미 등록된 단어 (N회)" 표시 + 그래도 추가 / 기존 항목 보기 선택지 제공

### 2.3 스토리지 용량 관리

Chrome Storage Local의 용량 제한은 `chrome.storage.local.QUOTA_BYTES` = 10,485,760 (10MB).

**현재 대응:** 없음. 용량 초과 시 `chrome.storage.local.set`이 에러를 던진다. 또한 `VocabStorage`의 `addEntry`, `deleteEntry` 등 모든 메서드에 try-catch가 없어, 스토리지 오류 시 예외가 Service Worker의 메시지 핸들러까지 전파된다. 현재 Service Worker에서도 에러를 잡지 않으므로, 스토리지 실패 시 사용자에게 피드백이 제공되지 않는다.

**개선안:**
- `VocabStorage`에 용량 모니터링 추가: `chrome.storage.local.getBytesInUse()` 호출로 현재 사용량 추적
- 80% 도달 시 사용자에게 경고 (단어장 페이지 상단 배너)
- 내보내기 후 오래된 항목 정리를 제안

---

## 3. 단어 추가 자동 분석

### 3.1 분석 파이프라인

`autoFillVocab()`은 선택된 텍스트를 형태소 분석과 번역으로 동시에 처리한다:

```typescript
const [tokens, translation] = await Promise.allSettled([
  translator.getAnalyzer().analyze(text),
  translator.translate(text),
]);
```

**`Promise.allSettled` 사용 이유:** 분석 또는 번역 중 하나가 실패해도 성공한 결과는 활용. 예: API 키 미설정으로 번역 실패 시에도 읽기/로마자는 채워짐.

### 3.2 기본형 변환

단일 토큰 선택 시 활용형을 기본형으로 변환한다:

```
食べている → 食べる (기본형)
  - 원래 선택: "食べている" (진행형)
  - 기본형: "食べる"
  - 기본형에 대한 읽기/로마자 재분석 실행
```

**변환 조건:**
- `tokens.length === 1` — 단일 단어 선택 시만
- `mainToken.baseForm !== '*'` — Kuromoji가 기본형을 제공한 경우만
- `mainToken.baseForm !== text` — 이미 기본형이 아닌 경우만

**다중 토큰 선택 시:** 기본형 변환 없이 원문 그대로 유지. "食べている" 같은 복합 표현은 하나의 학습 항목으로 의미가 있을 수 있기 때문.

### 3.3 품사 추출

메인 토큰의 품사를 추출하되, 기능어(記号 = 기호, 助詞 = 조사)를 건너뛰고 첫 번째 내용어의 품사를 사용한다.

### 3.4 예문 캡처

`selection-capture.ts`가 `contextmenu` 이벤트 시점에 선택 텍스트와 주변 문장을 캡처한다:

```
document.addEventListener('contextmenu', () => {
  const sel = window.getSelection();
  const range = sel.getRangeAt(0);
  const fullText = range.startContainer.textContent;
  const sentence = getSentenceAtPosition(fullText, range.startOffset);
});
```

**문장 경계 판정:** `。`, `！`, `？`, `\n`을 문장 구분자로 사용. 선택 위치에서 앞뒤로 스캔하여 문장을 추출.

**이 모듈이 별도 파일인 이유:** `contextmenu` 리스너는 페이지 로드 시 즉시 등록해야 하지만, `vocab-add-handler`는 실제 단어 추가 시에만 필요하다. 분리하여 초기 번들 크기를 줄임.

### 3.5 개선 방향

1. **복합어 분해 안내:** 다중 토큰 선택 시 "이 표현은 N개의 단어로 구성됩니다" + 각 토큰의 기본형 목록 표시. 사용자가 원하는 단어만 골라 추가 가능.

2. **JLPT 레벨 표시:** 단어의 JLPT 레벨(N5~N1)을 표시. 오프라인 JLPT 단어 목록(~16,000어)을 번들에 포함하거나, 별도 JSON 에셋으로 로드.

3. **예문 번역:** 현재 예문은 원문만 저장. 예문의 한국어 번역도 함께 저장하여 복습 시 활용. (autoFill 단계에서 예문이 있으면 별도 번역 요청)

4. **발음 음성:** Web Speech API의 `SpeechSynthesis`를 활용하여 단어 발음 재생 기능. 모달과 단어장 페이지 모두에서 사용.

---

## 4. 단어 추가 모달

### 4.1 Shadow DOM 격리

모달은 Shadow DOM 내부에 렌더링되어 호스트 페이지의 CSS와 완전히 격리된다:

```typescript
const host = document.createElement('div');
host.style.cssText = 'position: fixed; inset: 0; z-index: 2147483647;';
const shadow = host.attachShadow({ mode: 'open' });
```

### 4.2 이벤트 격리

모달이 열려 있는 동안 호스트 페이지가 키 입력을 가로채지 않도록 이벤트를 차단한다:

```typescript
for (const evt of ['keydown', 'keyup', 'keypress']) {
  host.addEventListener(evt, (e) => {
    if (e.key !== 'Escape') e.stopPropagation();
  });
}
```

- `Escape`만 통과시켜 모달 닫기 기능과 호스트 페이지의 ESC 동작을 모두 유지
- 다른 키(특히 알파벳)는 차단 — YouTube 등에서 키보드 단축키 오작동 방지

### 4.3 포커스 트랩

Tab 키로 모달 내 입력 필드 간 이동 시, 마지막 요소에서 첫 요소로 순환:

```typescript
modal.addEventListener('keydown', (e) => {
  if (e.key === 'Tab') {
    if (e.shiftKey && activeElement === firstEl) { firstEl → lastEl }
    if (!e.shiftKey && activeElement === lastEl) { lastEl → firstEl }
  }
});
```

### 4.4 로딩 → 폼 전환

1단계(로딩): `showVocabModal(null, onSave)` — "분석 중..." 스피너 표시
2단계(완료): `updateVocabModal(autoFill, onSave)` — 내부적으로 `showVocabModal`을 autoFill 데이터와 함께 재호출

**현재 구현의 한계:** 모달을 완전히 재생성하므로 DOM 리마운트가 발생한다.

**개선안:** 로딩 영역과 폼 영역을 모두 포함한 모달을 한 번만 생성하고, CSS `display`로 전환. DOM 재생성 비용 제거 + 전환 애니메이션 적용 가능.

### 4.5 개선 방향

1. **폼 유효성 검사:** `word`와 `meaning` 필드가 비어있으면 저장 버튼 비활성화. 빈 단어 저장 방지.

2. **저장 확인 피드백:** 저장 성공 시 모달을 즉시 닫지 않고 "저장됨 ✓" 메시지를 0.5초 표시 후 닫기. 사용자에게 저장 완료 확인을 제공.

3. **키보드 단축키:** `Ctrl/Cmd + Enter`로 저장. `Enter`로 다음 필드 이동 (현재는 기본 Tab만).

4. **최근 추가 이력:** 모달 하단에 "최근 추가된 단어 3개" 표시. 중복 추가 실수 방지 + 빠른 확인.

---

## 5. 단어장 페이지

### 5.1 페이지 구조

`vocabulary.html`은 Extension Tab(`chrome-extension://...`)으로 열리는 독립 페이지다.

```
┌─────────────────────────────────────────────┐
│ 헤더                                         │
│ [일반] [뜻 맞추기] [단어 맞추기]  총 42개       │
│ [검색...]                      [내보내기]      │
├─────────────────────────────────────────────┤
│ 2026-02-19                          5개      │
│ ┌─────────────────────────────────────────┐ │
│ │ 食べる  たべる  taberu         동사       │ │
│ │ 먹다                                    │ │
│ │ 彼女は寿司を食べている。                   │ │
│ │                         [편집] [삭제]    │ │
│ └─────────────────────────────────────────┘ │
│ ...                                          │
│ 2026-02-18                          3개      │
│ ...                                          │
│                [더 보기]                      │
└─────────────────────────────────────────────┘
```

### 5.2 지연 로딩 (Lazy Loading)

초기 로드 시 모든 항목을 가져오지 않고, 날짜 단위로 점진적 로드한다:

- **초기 로드:** 최근 7일 (`INITIAL_LOAD_DAYS = 7`)
- **추가 로드:** "더 보기" 버튼 클릭 시 7일씩 (`LOAD_MORE_DAYS = 7`)
- **로드 플로우:**
  1. 인덱스에서 전체 날짜 목록 취득
  2. `loadedDateCount` 커서 위치부터 N일 분량 로드
  3. 모든 날짜 로드 완료 시 "더 보기" 버튼 숨김

### 5.3 검색

300ms 디바운스로 실시간 검색을 수행한다:

```
입력 → 300ms 대기 → VOCAB_SEARCH 메시지 → 결과 렌더링
```

**검색 대상 필드:** word, meaning, reading, romaji, exampleSentence, note — 대소문자 무시, 부분 일치

**검색 결과 표시:** 매칭 텍스트를 `<span class="search-match">`로 감싸 하이라이트

**검색 종료 시:** 입력 필드 비우면 기존 날짜별 로드 상태로 복원 (loadedDateCount 리셋 + 재로드)

### 5.4 퀴즈 모드

3가지 모드로 전환 가능하며, 전환 시 전체 카드를 재렌더링한다:

| 모드 | 숨김 대상 | 조작 |
|------|----------|------|
| `normal` | 없음 (편집/삭제 가능) | — |
| `hide-meaning` | 뜻, 읽기, 로마자 | 카드 클릭으로 공개 |
| `hide-word` | 단어, 읽기, 로마자 | 카드 클릭으로 공개 |

**퀴즈 공개 메커니즘:**
```css
.quiz-hidden .quiz-answer { display: none; }
.quiz-hidden .quiz-placeholder { display: inline; }
.quiz-card.revealed .quiz-answer { display: inline; }
.quiz-card.revealed .quiz-placeholder { display: none; }
```
카드 클릭 시 `.revealed` 클래스 토글.

**퀴즈에서 숨기는 추가 정보:**
- 예문: 힌트 방지를 위해 모든 퀴즈 모드에서 숨김
- 메모: `hide-meaning` 모드에서 숨김 (뜻에 대한 힌트가 될 수 있음)
- 편집/삭제 버튼: 퀴즈 모드에서 비표시

### 5.5 인라인 편집

편집 버튼 클릭 시 카드 내용을 입력 폼으로 교체한다:

```
[편집 클릭]
  → card.innerHTML 을 임시 저장
  → 7개 입력 필드 + 저장/취소 버튼으로 교체
  → [저장] VOCAB_UPDATE → 새 카드로 교체
  → [취소] 원래 innerHTML 복원 + 이벤트 리스너 재부착
```

**현재 구현의 한계:** 취소 시 `innerHTML`을 복원하고 이벤트 리스너를 수동으로 재부착한다. DOM을 직접 조작하는 imperative 패턴이라 유지보수가 어려움.

### 5.6 삭제 확인

삭제 버튼 클릭 시 오버레이 확인 다이얼로그를 표시한다:
- `"○○" 을(를) 삭제하시겠습니까?` (단어명 포함) + 취소/삭제 버튼
- 삭제 후: 카드 DOM 제거, 인덱스 재조회하여 총 개수 갱신, 전체 삭제 시 빈 상태 표시

### 5.7 내보내기

모든 항목을 JSON 파일로 다운로드한다:
- 파일명: `jp-vocab-YYYY-MM-DD.json`
- 형식: `VocabEntry[]` 배열 (pretty-print, 2-space indent)
- Blob → Object URL → `<a>` 클릭 → URL 해제

### 5.8 개선 방향

1. **가져오기(Import) 기능:** JSON 파일을 업로드하여 단어장을 복원/병합. 기기 간 이동 또는 백업 복원 시 필수.

   ```
   파일 선택 → JSON 파싱 → 중복 감지 (id 또는 word+dateAdded 기준)
     → 새 항목만 추가 / 전체 덮어쓰기 선택
   ```

2. **정렬 옵션:** 현재는 날짜 내림차순(최신 먼저) 고정. 추가 옵션:
   - 가나다순 (word)
   - 뜻 가나다순 (meaning)
   - 최근 추가순 (현재 기본값)

3. **태그/카테고리:** 항목에 사용자 태그를 부여하여 그룹핑. 예: "JLPT N3", "애니메이션", "비즈니스". 태그별 필터링 지원.

4. **간격 반복(Spaced Repetition):** 퀴즈를 단순 숨기기/공개에서 SRS(Spaced Repetition System)로 발전:
   - 각 항목에 `nextReview: Date`, `interval: number`, `easeFactor: number` 추가
   - SM-2 또는 유사 알고리즘으로 복습 간격 계산
   - "오늘 복습할 단어 N개" 대시보드

5. **단어장 페이지 리액티브 전환:** 현재 imperative DOM 조작을 경량 리액티브 패턴(예: 상태 객체 + 렌더 함수)으로 전환. 전체 프레임워크 도입 없이도 상태 관리 개선 가능.

   ```typescript
   // 상태 객체
   interface VocabPageState {
     entries: Map<string, VocabEntry[]>;
     quizMode: QuizMode;
     searchQuery: string;
     loadedDateCount: number;
     editingId: string | null;
   }

   // 상태 변경 → 자동 재렌더링
   function setState(partial: Partial<VocabPageState>) {
     Object.assign(state, partial);
     render(state);
   }
   ```

---

## 6. 메시지 프로토콜

### 6.1 Content Script ↔ Service Worker

단어 추가는 컨텍스트 메뉴 → Service Worker → Content Script 경로로 시작:

```
Service Worker                     Content Script
     │                                │
     ├─ contextMenus.onClicked       │
     │  selectionText 확인            │
     │                                │
     ├─ chrome.tabs.sendMessage ────→│
     │  { type: 'VOCAB_ADD_START',   │
     │    payload: { text } }         │
     │                                ├─ handleVocabAdd(text)
     │                                │  autoFillVocab()
     │                                │  showVocabModal()
     │                                │
     │←─ sendMessage ────────────────│
     │  { type: 'VOCAB_SAVE',        │
     │    payload: VocabEntry }       │
     │                                │
     ├─ VocabStorage.addEntry()      │
     └─ sendResponse({ success })     │
```

### 6.2 Vocabulary Page ↔ Service Worker

단어장 페이지는 `chrome.runtime.sendMessage`로 Service Worker의 VocabStorage를 호출한다:

| 메시지 타입 | 페이로드 | 응답 |
|------------|---------|------|
| `VOCAB_SAVE` | `VocabEntry` | `{ success: boolean }` |
| `VOCAB_GET_INDEX` | — | `{ payload: VocabStorageIndex }` |
| `VOCAB_GET_ENTRIES` | `{ dates: string[] }` | `{ payload: Record<string, VocabEntry[]> }` |
| `VOCAB_SEARCH` | `{ query: string }` | `{ payload: VocabEntry[] }` |
| `VOCAB_UPDATE` | `VocabEntry` | `{ success: boolean }` |
| `VOCAB_DELETE` | `{ id, date }` | `{ success: boolean }` |
| `VOCAB_EXPORT` | — | `{ payload: VocabEntry[] }` |

### 6.3 개선 방향

1. **에러 전파:** 현재 Service Worker에서 VocabStorage 에러 발생 시 적절한 에러 응답이 없다. `{ success: false, error: string }` 형태의 에러 응답을 정의하여 UI에서 사용자에게 안내.

2. **낙관적 UI 업데이트:** 삭제/수정 시 서버 응답을 기다리지 않고 즉시 UI를 업데이트하고, 실패 시 롤백. 사용자 체감 속도 향상.

---

## 7. 번역 시스템과의 연동

### 7.1 현재 연동 지점

단어장은 번역 공통 시스템의 두 기능을 사용한다:

1. **형태소 분석기** (`translator.getAnalyzer()`) — 읽기, 로마자, 품사, 기본형 추출
2. **번역기** (`translator.translate()`) — 한국어 뜻 자동 채움

### 7.2 Translator 초기화 의존성

`handleVocabAdd()`는 translator가 준비되지 않았으면 `initTranslator()`를 호출한다. 이는 다음을 포함:
- Kuromoji 사전 로드 (2-3초)
- 번역 엔진 설정 (API 키 등)

**초기화 실패 시:** 모달을 닫고 조용히 종료. 사용자에게 피드백이 부족함.

**개선안:** 초기화 실패 원인에 따라 분기 처리:
- Kuromoji 로드 실패: "형태소 분석기를 초기화할 수 없습니다" 토스트
- API 키 미설정: 읽기/로마자는 채우되, 뜻 필드를 빈 상태로 모달 표시 + "API 키를 설정하면 자동 번역됩니다" 안내

### 7.3 용어집 연동 (개선안)

번역 공통 기술 명세에서 언급한 "단어장 → 용어집 자동 반영":

```
단어장에 항목 추가
  → 용어집에 { japanese: entry.word, korean: entry.meaning } 자동 등록
  → 이후 번역 시 이 단어가 일관되게 번역됨
```

- opt-in 설정: "단어장 단어를 용어집에 자동 추가" 체크박스
- 용어집에서 자동 추가된 항목은 별도 표시 (출처: 단어장)
- 단어장에서 삭제해도 용어집에는 남음 (수동 삭제 필요)

---

## 8. 보안 및 데이터 무결성

### 8.1 XSS 방지

모든 사용자 입력 데이터는 렌더링 전 HTML 이스케이프 처리:
- `escapeHtml()`: `&`, `<`, `>`, `"` 변환
- `esc()` (모달 전용): 동일 로직
- 검색 하이라이트: 이스케이프 후 `<span>` 삽입 (안전)

### 8.2 ID 생성

`${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

- 밀리초 타임스탬프 + 6자리 랜덤 문자열로 실질적 유니크 보장
- 동일 밀리초에 중복 생성될 확률: 1 / 36^6 ≈ 1 / 2.18억

### 8.3 데이터 백업

Chrome Storage는 브라우저/프로필에 종속된다. 데이터 손실 방지를 위해:

**현재:** JSON 내보내기만 지원 (수동)

**개선안:**
- Chrome Storage Sync 활용: 항목 수가 적으면 (`QUOTA_BYTES_PER_ITEM = 8192`, `MAX_ITEMS = 512`) sync storage에 미러링 가능. 다만 단어 수가 많아지면 한계.
- 자동 백업: 주기적으로(매주) 내보내기 파일을 자동 생성하여 다운로드 폴더에 저장. 사용자 동의 하에.
