# JP Helper 리팩토링 가이드: Phase 4~5

> 이 문서는 새 세션이 사전 맥락 없이 Phase 4~5 리팩토링을 수행할 수 있도록 작성되었다.
> Phase 1~3은 완료되었다. 결정 기록: `decisions/0011-*`, `decisions/0012-*`.

---

## 1. 필수 읽기

작업 시작 전 반드시 읽어야 할 문서 (우선순위 순):

1. **`context.md`** — 현재 진행 상태, 남은 작업 목록
2. **`CLAUDE.md`** — 빌드 명령, 커뮤니케이션 규칙 (한국어 사용)
3. **이 문서** — Phase 4~5 상세 가이드

코드 변경 시 해당 영역의 기술 명세를 참조:
- `docs/tech/vocab_tech.md` — 단어장 시스템 (Phase 4)
- `docs/tech/translation_common_tech.md` — 번역 파이프라인 (Phase 5)

---

## 2. Phase 1~3 완료 후 현재 상태

### 2.1 아키텍처

```
┌─ Handler Layer ──────────────────────────────────────────┐
│  twitter/        youtube/subtitle  youtube/page  webpage/ │
│  (BatchedObserver  (VideoObserver+   (BatchedObserver+    │
│   + 3 sub)        Extractor+Overlay)  ProcessedTracker)   │
│                                     (TextDetector+        │
│                                      Inline/Furigana/     │
│                                      HoverTooltip 직접)   │
├─ Shared Layer ───────────────────────────────────────────┤
│  batched-observer  processed-tracker  status-indicator    │
│  dom-utils         handlers/registry  handlers/types      │
│  renderers/ (hover-tooltip, ruby-injector, inline-block,  │
│    inline-bracket, furigana-block, spoiler, engine-badge) │
├─ Core Layer ─────────────────────────────────────────────┤
│  translator/ (index, papago, claude, openai, gemini,      │
│    llm-registry, context-manager, complexity,             │
│    prompt-builder, api-fetch)                             │
│  analyzer/ (morphological, reading-converter)             │
│  cache  glossary  logger  vocab-storage                   │
└──────────────────────────────────────────────────────────┘
의존성: Handler → Shared → Core (역방향 없음)
```

### 2.2 확립된 패턴 (따라야 할 것)

**렌더링 패턴**: 모든 핸들러가 동일한 공유 렌더러를 사용.
- inline 번역 → `createInlineBlock(result, settings, opts)`
- 후리가나 → `createRubyClone(element, tokens, opts)` (비파괴적: 원본 숨기고 클론 삽입)
- 호버 → `HoverTooltip` 직접 생성 (`getTargetAtPoint` 콜백 제공)

**상태 관리 패턴**: `ProcessedTracker`로 통합.
- `markProcessed(el, text)` → `isProcessedWithSameText(el, text)` → `unmarkProcessed(el)`
- `trackInjected(el)` → `cleanup()`

**설정 변경 패턴**: `needsRenderRestart(prev, next)` → true면 `stop() → start()` 재시작.

### 2.3 단어장 시스템 현재 구조

```
사용자 컨텍스트 메뉴 선택
  → background/service-worker.ts (VOCAB_ADD_START 메시지)
  → content/vocab/selection-capture.ts (선택 텍스트 캡처)
  → content/vocab/vocab-add-handler.ts (형태소 분석 + 번역으로 자동 채움)
  → content/vocab/vocab-modal.ts (Shadow DOM 모달 UI)
  → core/vocab-storage.ts (날짜 파티션 Chrome storage)
```

**데이터 모델** (`VocabEntry`):
```
id, word, reading, romaji, meaning, pos,
exampleSentence, exampleSource, note,
dateAdded (YYYY-MM-DD), timestamp
```

### 2.4 번역 파이프라인 현재 구조

```
text → normalize → cache check → morphology → complexity →
  engine selection (LLM/Papago) → glossary post-process →
  build result → cache store → context window push
```

---

## 3. Phase 4: 단어장 연동·기능 확장

### 의존성

4.2(단어 클릭)가 핵심. 나머지(4.3, 4.4, 4.5)는 독립 가능.

### 4.2 단어 클릭 → 단어장 연동

**현재**: 컨텍스트 메뉴(우클릭)를 통한 수동 추가만 가능.

**목표**: 인라인/후리가나 모드에서 단어 클릭 시 단어장 모달 표시.

**방법**:
1. `createRubyClone`이 생성하는 `<ruby>` 요소에 클릭 이벤트 추가
2. `createInlineBlock`의 번역 블록 내 토큰에 클릭 이벤트 추가
3. 클릭 시 해당 토큰의 정보로 `showVocabModal()` 호출
4. `vocab-add-handler.ts`의 `autoFillVocab()` 활용

**주의**:
- 렌더러(ruby-injector, inline-block)를 수정해야 하므로 모든 핸들러에 영향
- 클릭 이벤트가 기존 링크·멘션 클릭과 충돌하지 않아야 함 (이벤트 전파 제어)
- 모바일에서의 터치 이벤트 고려

### 4.3 용어집 ↔ 단어장 자동 연동

**현재**: 용어집(`core/glossary.ts`)과 단어장(`core/vocab-storage.ts`)이 독립 운영.

**목표**: 단어장에 추가된 단어가 용어집에 opt-in 반영.

**참고**: `docs/tech/vocab_tech.md` 7절, 용어집 현재 `getRelevantEntries(text)` + `apply(translation, original)` API.

### 4.4 검색 성능 개선

**현재**: `VocabStorage.search(query)`가 모든 날짜 파티션을 순회하며 전체 필드를 검색.

**목표**: 인덱스 기반 검색 또는 전문 검색 구조.

### 4.5 JSON 가져오기

**현재**: `exportAll()`로 내보내기만 지원.

**목표**: JSON/CSV 가져오기로 외부 단어장 이관 지원.

---

## 4. Phase 5: 번역 파이프라인 고도화

### 의존성

모두 독립 가능.

### 5.2 컨텍스트-인식 캐시 키

**현재**: `hashKey(normalizedText)` — 텍스트만으로 캐시 키 생성. 동일 텍스트가 다른 맥락(유머/진지)에서 다른 번역이 필요할 수 있음.

**목표**: 출처(source) 포함 캐시 키로 맥락별 번역 구분.

**참고**: `docs/tech/translation_common_tech.md` 7절.

### 5.3 프롬프트 템플릿화

**현재**: `prompt-builder.ts`에 규칙 7개가 하드코딩. 레벨별·엔진별 분기 없음.

**목표**: 레벨별(초급·중급·고급)·엔진별 프롬프트 템플릿 분리.

**참고**: `docs/tech/translation_common_tech.md` 5절.

### 5.4 요청 큐잉/병합

**현재**: `Translator`의 max 3 동시 제한 + FIFO 큐. 동일 텍스트 중복 요청은 캐시로만 방지.

**목표**: 동일 텍스트 중복 요청 병합 (in-flight dedup), 우선순위 큐 도입.

### 5.5 피드백 기반 복잡도 학습

**현재**: `assessComplexity()`가 고정 가중치 (keigo=3, length=1, idiom=2) 사용.

**목표**: 재번역 요청 패턴으로 복잡도 임계값 자동 조정.

**참고**: `docs/tech/translation_common_tech.md` 3절.

---

## 5. 작업 규칙

### 빌드 검증
매 단계 완료 후 반드시 `npm run build` 실행. tsc --noEmit 에러가 없어야 한다.

### 커밋 단위
한 번에 하나의 논리적 변경만 커밋.

### 문서 동기화
코드 변경이 기술 명세의 기술과 달라지면, 해당 기술 명세도 함께 수정한다.

### 진행 상태 관리
- 작업 진행 시 `context.md` 업데이트
- Phase 완료 시 `decisions/` 디렉토리에 decision 문서 작성

---

## 6. 주요 파일 참조 인덱스

### Phase 4 관련
| 파일 | 역할 | 줄수 |
|---|---|---|
| `src/core/vocab-storage.ts` | 날짜 파티션 CRUD + 검색 | 125 |
| `src/content/vocab/vocab-modal.ts` | Shadow DOM 모달 UI | 278 |
| `src/content/vocab/vocab-add-handler.ts` | 형태소 분석 자동 채움 | 83 |
| `src/content/vocab/selection-capture.ts` | 컨텍스트 메뉴 선택 캡처 | 35 |
| `src/core/glossary.ts` | 내장+사용자 용어집 (42항목) | 152 |
| `src/content/shared/renderers/ruby-injector.ts` | createRubyClone (단어 클릭 이벤트 추가 대상) | - |
| `src/content/shared/renderers/inline-block.ts` | createInlineBlock (단어 클릭 이벤트 추가 대상) | - |

### Phase 5 관련
| 파일 | 역할 | 줄수 |
|---|---|---|
| `src/core/translator/index.ts` | 번역 오케스트레이터 (큐잉, 엔진 선택) | 280 |
| `src/core/translator/complexity.ts` | 복잡도 평가 (경어·숙어·길이) | 177 |
| `src/core/translator/prompt-builder.ts` | LLM 프롬프트 조립 | 54 |
| `src/core/cache.ts` | 메모리+스토리지 2층 캐시 | 188 |
| `src/core/translator/context-manager.ts` | 대화 컨텍스트 윈도우 | - |
