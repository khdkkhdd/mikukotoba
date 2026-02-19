# JP Helper 리팩토링 가이드: Phase 3~5

> 이 문서는 새 세션이 사전 맥락 없이 Phase 3~5 리팩토링을 수행할 수 있도록 작성되었다.
> Phase 1~2는 커밋 `192d71f`로 완료되었다. 결정 기록: `decisions/0011-refactoring-phase1-2-completed.md`.

---

## 1. 필수 읽기

리팩토링 시작 전 반드시 읽어야 할 문서 (우선순위 순):

1. **`context.md`** — 현재 진행 상태, 완료된 작업, 남은 작업
2. **`CLAUDE.md`** — 빌드 명령, 커뮤니케이션 규칙 (한국어 사용)
3. **이 문서** — Phase 3~5 상세 가이드
4. **`docs/tech/integration_architecture.md`** 7절 — Phase 계획 원본

코드 변경 시 해당 영역의 기술 명세를 참조:
- `docs/tech/webpage_tech.md` — Webpage 핸들러 (Phase 3 주요 대상)
- `docs/tech/youtube_tech.md` — YouTube SPA 패턴 참고
- `docs/tech/vocab_tech.md` — 단어장 시스템 (Phase 4)
- `docs/tech/translation_common_tech.md` — 번역 파이프라인 (Phase 5)

---

## 2. Phase 1~2 완료 후 현재 상태

### 2.1 해결된 문제

| 문제 | 해결 방법 |
|---|---|
| DOM 감지 3중 구현 | TwitterObserver 삭제, BatchedObserver로 통합 |
| ProcessedTracker 미적용 | Webpage의 InlineTranslator·TextDetector·FuriganaInjector에 적용 |
| 재시작 조건 3중 복사 | `needsRenderRestart()` 공유 함수 추출 (`handlers/types.ts`) |
| Webpage 렌더링 비일관성 | createInlineBlock, createRubyClone, spoiler 적용 |
| HoverPopup 불필요 래퍼 | 제거, WebpageSiteHandler에서 HoverTooltip 직접 사용 |

### 2.2 삭제된 파일

- `src/content/twitter/observer.ts` — BatchedObserver 전환으로 제거
- `src/content/webpage/hover-popup.ts` — HoverTooltip 직접 사용으로 제거

### 2.3 스킵된 항목

- **TextDetector 배치 인프라 공유** (원래 Phase 1 4.2): 중복 ~30줄로 비용 대비 이득 낮아 스킵. TextDetector의 `walkTextNodes→findBlockParent` 방식이 셀렉터 기반과 근본적으로 달라 추상화 비용이 높음.

### 2.4 현재 아키텍처

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

### 2.5 핸들러별 Shared 모듈 사용 (Phase 1~2 이후)

| Shared 모듈 | Twitter | YouTube Page | Webpage |
|---|:---:|:---:|:---:|
| BatchedObserver | O | O | - (TextDetector 사용) |
| ProcessedTracker | O | O | O |
| HoverTooltip | O (직접) | O (직접) | O (직접) |
| createInlineBlock | O | O | O |
| createRubyClone | O | O | O |
| spoiler | O | O | O |
| needsRenderRestart | O | O | O |

### 2.6 확립된 패턴 (Phase 3~5에서 따라야 할 것)

**렌더링 패턴**: 모든 핸들러가 동일한 공유 렌더러를 사용한다.
- inline 번역 → `createInlineBlock(result, settings, opts)`
- 후리가나 → `createRubyClone(element, tokens, opts)` (비파괴적: 원본 숨기고 클론 삽입)
- 호버 → `HoverTooltip` 직접 생성 (`getTargetAtPoint` 콜백 제공)

**상태 관리 패턴**: `ProcessedTracker`로 통합.
- `markProcessed(el, text)` → `isProcessedWithSameText(el, text)` → `unmarkProcessed(el)` (재시도)
- `trackInjected(el)` → `cleanup()` (정리)

**설정 변경 패턴**: `needsRenderRestart(prev, next)` → true면 `stop() → start()` 재시작.

---

## 3. Phase 3: 판별·성능 최적화

### 3.1 Webpage IntersectionObserver 활성화

**파일**: `src/content/webpage/text-detector.ts`

**현재 상태**: TextDetector는 IntersectionObserver를 생성하고 `rootMargin: '200px'`로 요소를 관찰하지만, 보조 역할로만 사용된다. MutationObserver가 주 감지를 담당하며 감지 즉시 콜백을 호출한다.

**목표**: 초기 스캔 시 뷰포트 밖 요소는 defer하여 체감 성능 향상.

**참고 패턴 — YouTube Page의 viewport deferral** (`src/content/youtube/page-handler.ts`):
```
BatchedObserver 감지 → route에 deferToViewport: true →
IntersectionObserver 관찰 → 뷰포트 진입 시 처리 → unobserve
```

**방법**:
1. TextDetector의 `flush()`에서 감지된 블록을 뷰포트 내/외로 분류
2. 뷰포트 내 블록은 즉시 `onDetected()` 호출
3. 뷰포트 외 블록은 IntersectionObserver에 등록, 진입 시 `onDetected()` 호출
4. IntersectionObserver 콜백에서 처리 후 `unobserve()`

**주의**: 현재 IntersectionObserver는 MutationObserver가 놓친 요소를 잡는 보조 역할도 하고 있다. 기존 보조 감지 기능을 유지하면서 defer 기능을 추가해야 한다.

**검증**: 긴 웹페이지에서 초기 로딩 시 뷰포트 내 요소만 먼저 번역되는지 확인, 스크롤 시 나머지 요소가 번역되는지 확인.

### 3.2 Webpage SPA 대응

**파일**: `src/content/webpage/index.ts`, `src/content/webpage/text-detector.ts`

**현재 상태**: Webpage 핸들러는 SPA 네비게이션을 감지하지 못한다. 페이지 전환 시 새 콘텐츠가 나타나도 이미 처리된 것으로 간주될 수 있다.

**참고 패턴 — YouTube Page의 SPA 대응** (`src/content/youtube/page-handler.ts`):
```
yt-navigate-finish 이벤트 →
  1. tracker.cleanup() (인젝션 제거)
  2. observer 재시작 (새 페이지 스캔)
  3. 점진적 재스캔: [500, 1500, 3000]ms 지연
  4. recheckStaleTranslations(): 텍스트 변경된 요소 재처리
```

**방법**:
1. `WebpageSiteHandler`에 URL 변경 감지 추가:
   - `popstate` 이벤트 리스너 (뒤로가기/앞으로가기)
   - `History.pushState`/`replaceState` 래핑 (SPA 라우팅)
   - URL 폴링은 최후 수단 (YouTube의 `VideoObserver`처럼)
2. URL 변경 감지 시:
   - `tracker.cleanup()` → 기존 인젝션 제거
   - TextDetector 재시작 → 새 콘텐츠 스캔
   - 점진적 재스캔으로 비동기 렌더링 대응
3. `pushState`/`replaceState` 래핑 방법:
   ```typescript
   const originalPushState = history.pushState.bind(history);
   history.pushState = (...args) => {
     originalPushState(...args);
     window.dispatchEvent(new Event('jp-helper-navigate'));
   };
   // replaceState도 동일하게 래핑
   // popstate 리스너도 등록
   ```

**주의**:
- `History.pushState` 래핑은 MAIN world에서만 동작한다. Content Script의 ISOLATED world에서는 페이지의 `history` 객체에 접근할 수 없으므로, YouTube의 `caption-bridge.ts`처럼 MAIN world 스크립트를 주입하거나, MutationObserver의 지속적 감시에 의존해야 한다.
- TextDetector의 MutationObserver가 이미 새 DOM 노드를 감지하므로, 완전한 SPA 대응보다는 "새 콘텐츠 DOM이 추가되면 자동 감지" 방식이 현실적일 수 있다.
- `hashchange` 이벤트도 추가로 감지한다 (해시 기반 라우팅 대응).

**검증**: SPA 사이트(React/Next.js 기반 블로그 등)에서 페이지 전환 후 새 일본어 콘텐츠가 감지·번역되는지 확인.

### 3.3 YouTube VideoObserver 이벤트 통합

**파일**: `src/content/youtube/video-observer.ts`

**현재 상태**: VideoObserver가 `setInterval(1000ms)`로 URL을 폴링하여 동영상 변경을 감지한다 (97줄).

**목표**: `yt-navigate-finish` 이벤트 통합으로 폴링 제거 가능성 검토.

**참고**: YouTube Page 핸들러(`page-handler.ts`)는 이미 `yt-navigate-finish`를 사용하고 있다. 그러나 SubtitleHandler가 사용하는 VideoObserver는 별도로 URL 폴링을 한다.

**방법**:
1. VideoObserver에 `yt-navigate-finish` 이벤트 리스너 추가
2. 이벤트 수신 시 URL 체크 → 영상 변경 감지
3. `setInterval` 폴링을 보조 수단으로 유지하되 간격을 5000ms로 늘림 (이벤트 미발화 대비)
4. 또는 폴링을 완전히 제거하고 이벤트 + MutationObserver만 사용

**주의**: `yt-navigate-finish`가 모든 영상 전환에서 발화되는지 확인 필요 (자동재생, 플레이리스트 다음 영상 등). YouTube 기술 명세 3절 참조.

**검증**: YouTube에서 영상 전환(수동 클릭, 자동재생, 플레이리스트) 시 자막이 정상적으로 전환되는지 확인.

### 3.4 Twitter 뷰포트 우선 처리 (선택적)

**파일**: `src/content/twitter/index.ts`

**현재 상태**: Twitter는 가상 스크롤(DOM 재활용)을 사용하므로, 화면에 보이는 요소만 DOM에 존재한다. 뷰포트 최적화 필요성이 낮다.

**검토 사항**: 대량 로딩 시(예: 검색 결과) 뷰포트 내 요소 우선순위 부여가 필요한지 평가. Twitter의 가상 스크롤 특성상 큰 효과는 없을 것으로 예상되므로, 실제 성능 문제가 관찰될 때만 진행.

---

## 4. Phase 4: 단어장 연동·기능 확장

### 4.1 현재 단어장 시스템 구조

```
사용자 컨텍스트 메뉴 선택
  → background/service-worker.ts (VOCAB_ADD_START 메시지)
  → content/vocab/selection-capture.ts (선택 텍스트 캡처)
  → content/vocab/vocab-add-handler.ts (형태소 분석 + 번역으로 자동 채움)
  → content/vocab/vocab-modal.ts (Shadow DOM 모달 UI)
  → core/vocab-storage.ts (날짜 파티션 Chrome storage)
```

**핵심 파일**:
- `src/core/vocab-storage.ts` (125줄) — 날짜별 파티션 CRUD, 검색, 내보내기
- `src/content/vocab/vocab-modal.ts` (278줄) — Shadow DOM 모달 (다크 테마)
- `src/content/vocab/vocab-add-handler.ts` (83줄) — 형태소 분석 + 자동 채움
- `src/content/vocab/selection-capture.ts` (35줄) — 컨텍스트 메뉴 시 선택 텍스트 캡처

**데이터 모델** (`VocabEntry`):
```
id, word, reading, romaji, meaning, pos,
exampleSentence, exampleSource, note,
dateAdded (YYYY-MM-DD), timestamp
```

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

## 5. Phase 5: 번역 파이프라인 고도화

### 5.1 현재 번역 파이프라인

```
text → normalize → cache check → morphology → complexity →
  engine selection (LLM/Papago) → glossary post-process →
  build result → cache store → context window push
```

**핵심 파일**:
- `src/core/translator/index.ts` (280줄) — 오케스트레이터, 큐잉 (max 3 동시)
- `src/core/translator/complexity.ts` (177줄) — 복잡도 평가 (경어·숙어·길이 등)
- `src/core/translator/prompt-builder.ts` (54줄) — LLM 프롬프트 조립
- `src/core/cache.ts` (188줄) — 메모리(200개) + Chrome storage(5000개) 2층 캐시
- `src/core/glossary.ts` (152줄) — 내장(42항목) + 사용자 용어집

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

## 6. 작업 규칙

### 빌드 검증
매 단계 완료 후 반드시 `npm run build` 실행. tsc --noEmit 에러가 없어야 한다.

### 커밋 단위
한 번에 하나의 논리적 변경만 커밋.

### 문서 동기화
코드 변경이 기술 명세의 기술과 달라지면, 해당 기술 명세도 함께 수정한다.

### 의존성 순서
- Phase 3 완료 후 Phase 4~5 진행 (Phase 4와 5는 독립 가능)
- Phase 3 내 항목: 3.1(IntersectionObserver)과 3.2(SPA 대응)은 독립, 3.3(VideoObserver)도 독립
- Phase 4 내 항목: 4.2(단어 클릭)가 핵심, 나머지는 독립
- Phase 5 내 항목: 모두 독립 가능

### 진행 상태 관리
- 작업 진행 시 `context.md` 업데이트
- Phase 완료 시 `decisions/` 디렉토리에 decision 문서 작성

---

## 7. 주요 파일 참조 인덱스

### Phase 3 관련
| 파일 | 역할 | 줄수 |
|---|---|---|
| `src/content/webpage/text-detector.ts` | 일본어 텍스트 감지 (3-레이어: Mutation+CharacterData+Intersection) | 222 |
| `src/content/webpage/index.ts` | Webpage 핸들러 코디네이터 | 180 |
| `src/content/youtube/page-handler.ts` | SPA 대응 패턴 참고 (yt-navigate-finish) | 767 |
| `src/content/youtube/video-observer.ts` | URL 폴링 패턴 참고 | 97 |
| `src/content/shared/batched-observer.ts` | 배치 MutationObserver (SelectorRoute[]) | 200 |

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
