# JP Helper 리팩토링 가이드

> 이 문서는 새 세션이 사전 맥락 없이 리팩토링을 수행할 수 있도록 작성되었다.
> 문서화 단계(기능 명세 5개, 기술 명세 5개, 통합 아키텍처 1개)는 이미 완료되었다.

---

## 1. 프로젝트 이해를 위한 필수 읽기

리팩토링 시작 전 반드시 읽어야 할 문서 (우선순위 순):

1. **`docs/tech/integration_architecture.md`** — 교차 관심사 분석 + 5-Phase 리팩토링 계획. **가장 중요한 문서.**
2. **`context.md`** — 현재 진행 상태와 남은 작업
3. **`CLAUDE.md`** — 빌드, 커뮤니케이션 규칙

코드 변경 시 해당 영역의 기술 명세를 참조:
- `docs/tech/translation_common_tech.md` — 번역 파이프라인, 공유 렌더러, 메시지 통신
- `docs/tech/twitter_tech.md` — Twitter 핸들러 상세
- `docs/tech/youtube_tech.md` — YouTube 핸들러 상세
- `docs/tech/webpage_tech.md` — Webpage 핸들러 상세
- `docs/tech/vocab_tech.md` — 단어장 시스템

---

## 2. 아키텍처 요약

```
┌─ Handler Layer ──────────────────────────────────────┐
│  twitter/        youtube/subtitle  youtube/page  webpage/ │
├─ Shared Layer ───────────────────────────────────────┤
│  batched-observer  processed-tracker  dom-utils       │
│  renderers/ (hover-tooltip, ruby-injector,            │
│    inline-block, spoiler, engine-badge, ...)          │
├─ Core Layer ─────────────────────────────────────────┤
│  translator/  analyzer/  cache  glossary  logger      │
└──────────────────────────────────────────────────────┘
의존성: Handler → Shared → Core (역방향 없음)
```

**핸들러 4개**:
| ID | 클래스 | 파일 | 활성 조건 |
|---|---|---|---|
| `twitter` | TwitterHandler | `src/content/twitter/index.ts` | x.com / twitter.com |
| `youtube-subtitle` | YouTubeSubtitleHandler | `src/content/youtube/subtitle-handler.ts` | youtube.com + youtubeMode |
| `youtube-page` | YouTubePageHandler | `src/content/youtube/page-handler.ts` | youtube.com + webpageMode≠off |
| `webpage` | WebpageSiteHandler | `src/content/webpage/index.ts` | 기타 사이트 + 일본어 감지 |

**렌더링 3모드**: `hover` | `inline` | `furigana-only` (설정의 `webpageMode`로 제어)

---

## 3. 해결할 문제 5건

| # | 문제 | 위치 | 상세 |
|---|---|---|---|
| P1 | DOM 감지 3중 구현 | TwitterObserver, BatchedObserver, TextDetector | 동일 배치 패턴(pendingNodes Set → requestIdleCallback flush)을 3곳에서 독립 구현 |
| P2 | ProcessedTracker 미적용 | Webpage 핸들러 | Twitter·YouTube Page는 ProcessedTracker 사용, Webpage는 자체 WeakSet |
| P3 | 재시작 조건 복사 | Twitter·YouTube Page·Webpage의 updateSettings() | 동일한 needsRestart 판별 코드 3중 복사 |
| P4 | 렌더링 비일관성 | Webpage 핸들러 | 스포일러 미적용, createInlineBlock 미사용(수동 div 조립), 파괴적 후리가나(injectFurigana) |
| P5 | HoverPopup 불필요 래퍼 | `webpage/hover-popup.ts` | Twitter·YouTube는 HoverTooltip 직접 사용, Webpage만 래퍼 경유 |

---

## 4. Phase 1: 공유 인프라 정비

### 4.1 TwitterObserver → BatchedObserver 전환

**현재**: `twitter/observer.ts`(248줄)가 BatchedObserver와 동일한 배치 로직을 하드코딩 셀렉터로 독자 구현.

**목표**: TwitterHandler가 BatchedObserver를 직접 사용하도록 전환. `twitter/observer.ts` 파일 제거.

**방법**:

1. `twitter/index.ts`에서 TwitterObserver 대신 BatchedObserver를 임포트
2. TwitterObserver의 9개 콜백 라우팅을 BatchedObserver의 SelectorRoute[]로 변환:
   ```typescript
   // 현재 twitter/index.ts의 observer 생성 (TwitterObserver)
   this.observer = new TwitterObserver({
     onTweetText: (el) => this.tweetHandler.processTweetText(el),
     onCardWrapper: (el) => this.tweetHandler.processCard(el),
     // ... 9개 콜백
   });

   // 목표: BatchedObserver로 전환
   this.observer = new BatchedObserver(
     [
       { selector: '[data-testid="tweetText"]', callback: (el) => this.tweetHandler.processTweetText(el) },
       { selector: '[data-testid="card.wrapper"]', callback: (el) => this.tweetHandler.processCard(el) },
       { selector: '[data-testid="User-Name"]', callback: (el) => this.userHandler.processUserName(el) },
       { selector: '[data-testid="UserName"]', callback: (el) => this.userHandler.processProfileName(el) },
       { selector: '[data-testid="UserDescription"]', callback: (el) => this.userHandler.processUserDescription(el) },
       { selector: '[data-testid="UserLocation"]', callback: (el) => this.userHandler.processUserLocation(el) },
       { selector: '[data-testid="UserCell"]', callback: (el) => this.userHandler.processUserCell(el) },
       { selector: '[data-testid="socialContext"]', callback: (el) => this.userHandler.processSocialContext(el) },
       { selector: '[data-testid="trend"]', callback: (el) => this.trendHandler.processTrend(el) },
     ],
     {
       logNamespace: 'Twitter:Observer',
       characterData: true,
       characterDataAncestorResolver: (node) =>
         node.parentElement?.closest('[data-testid="tweetText"], [data-testid="UserDescription"]') ?? null,
       shouldSkip: (el) => isEditableArea(el) || el.hasAttribute('data-jp-twitter-translation') || el.hasAttribute(PROCESSED_ATTR),
     },
   );
   ```
3. 셀렉터 상수는 `twitter/utils.ts`의 SELECTORS에서 가져온다
4. `twitter/observer.ts` 파일 삭제
5. `twitter/index.ts`에서 `TwitterObserver` 임포트를 `BatchedObserver` 임포트로 교체

**검증**:
- `npm run build` 통과
- Twitter 페이지에서 트윗 번역, 유저 이름 번역, 트렌딩 번역이 정상 동작하는지 확인 (수동 테스트 항목)

### 4.2 TextDetector 배치 인프라 공유

**현재**: `webpage/text-detector.ts`(226줄)가 자체 pendingNodes + scheduleFlush + requestIdleCallback 구현을 갖고 있다.

**목표**: 배치 큐잉·플러시 로직을 공유 유틸리티로 추출. TextDetector는 텍스트 노드 워킹과 블록 판별 로직만 보유.

**주의**: TextDetector는 셀렉터 기반이 아닌 `walkTextNodes → findBlockParent` 방식이므로 BatchedObserver를 직접 사용할 수 없다. 배치 인프라만 추출한다.

**방법**:

1. `shared/batched-observer.ts`에서 배치 큐잉 로직을 별도 클래스나 함수로 추출하거나, TextDetector가 MutationObserver 콜백 내에서 BatchedObserver의 패턴을 활용하도록 리팩토링
2. 또는 더 실용적 접근: TextDetector의 현재 구조를 유지하되, pendingNodes/scheduleFlush/flush 패턴을 공유 유틸리티 `MutationBatcher`로 추출하여 TextDetector와 BatchedObserver 모두 사용

**핵심**: 이 항목은 코드 중복 정도가 ~30줄 수준이므로, 4.1(TwitterObserver 통합)보다 우선순위가 낮다. 자연스러운 추출이 어려우면 후순위로 미뤄도 된다.

### 4.3 Webpage에 ProcessedTracker 적용

**현재**: `webpage/inline-translator.ts`와 `webpage/text-detector.ts`가 각각 자체 `processedBlocks: WeakSet`, `processedElements: WeakSet`, `processedTexts: WeakMap`을 관리.

**목표**: ProcessedTracker를 사용하여 일관된 처리 상태 관리.

**방법**:

1. `webpage/index.ts`에서 ProcessedTracker 인스턴스 생성 (attr: `'data-jp-processed'`, `'data-jp-translation'`)
2. InlineTranslator에 ProcessedTracker를 주입하여 자체 WeakSet 대체
3. FuriganaInjector에도 동일하게 적용
4. TextDetector의 processedElements/processedTexts는 "감지 중복 방지" 역할이므로 ProcessedTracker의 `isProcessedWithSameText()`로 대체 가능

**주의**: TextDetector의 IntersectionObserver가 `processedElements.has(el)` 체크를 하고 있으므로, ProcessedTracker의 `isProcessed()`로 교체할 때 동일 동작을 보장해야 한다.

### 4.4 재시작 조건 추출

**현재**: 3개 핸들러에서 동일 코드:
```typescript
const needsRestart =
  settings.webpageMode !== prev.webpageMode ||
  settings.showFurigana !== prev.showFurigana ||
  settings.showTranslation !== prev.showTranslation ||
  settings.showRomaji !== prev.showRomaji;
```

**방법**:

1. `shared/` 또는 `handlers/`에 유틸리티 함수 추가:
   ```typescript
   export function needsRenderRestart(prev: UserSettings, next: UserSettings): boolean {
     return prev.webpageMode !== next.webpageMode ||
       prev.showFurigana !== next.showFurigana ||
       prev.showTranslation !== next.showTranslation ||
       prev.showRomaji !== next.showRomaji;
   }
   ```
2. 3개 핸들러의 updateSettings()에서 이 함수 사용

### 4.5 isJapaneseShortText 이동

**현재**: `twitter/utils.ts`에만 존재.

**방법**: `shared/dom-utils.ts`로 이동. `twitter/utils.ts`에서는 re-export 또는 직접 임포트 변경.

---

## 5. Phase 2: 렌더링 통합

### 5.1 Webpage inline → createInlineBlock 전환

**현재**: `webpage/inline-translator.ts`가 수동으로 div를 조립하여 번역 블록을 만든다. engine-badge 포맷, retry 버튼 로직, innerHTML 조립이 모두 로컬 구현.

**목표**: `shared/renderers/inline-block.ts`의 `createInlineBlock()` 사용으로 Twitter·YouTube와 동일한 렌더링.

**효과**: spoiler 자동 적용, engine-badge 일관성, retry UI 통일.

**방법**:

1. InlineTranslator.processBlock()에서 수동 div 조립 코드를 `createInlineBlock(result, settings, opts)` 호출로 교체
2. `opts`에 `{ className: 'jp-inline-translation', translationAttr: 'data-jp-translation', spoiler: true, onRetranslate: () => translator.retranslate(text) }` 전달
3. 기존 `buildContent()`, `attachRetry()` 로컬 함수 삭제

### 5.2 Webpage 후리가나 → createRubyClone 전환

**현재**: `inline-translator.ts`의 `injectFurigana()`가 텍스트 노드를 직접 `<ruby><rt>` span으로 교체 (파괴적 수정). `lineHeight: '2.3em'` 하드코딩.

**목표**: `createRubyClone()` 방식으로 원본 보존. 원본 요소를 숨기고 클론에 후리가나 삽입.

**주의**: Webpage의 TextDetector는 `DetectedBlock { element, textNodes, text }`를 반환하는데, createRubyClone은 `(element, tokens)` 시그니처다. element를 직접 전달하면 된다.

**방법**:

1. InlineTranslator에서 `injectFurigana()` 메서드를 createRubyClone 호출로 교체
2. 원본 element에 `jp-furigana-hidden` 클래스 추가, 클론을 afterend에 삽입
3. cleanup()에서 클론 제거 + hidden 클래스 복원 (ProcessedTracker.cleanup()이 이미 이 패턴을 구현)

### 5.3 HoverPopup 래퍼 제거

**현재**: `webpage/hover-popup.ts`(76줄)가 HoverTooltip을 감싸며 `getTextBlockAtPoint()` 콜백만 제공.

**목표**: WebpageSiteHandler에서 HoverTooltip을 직접 생성 (Twitter·YouTube Page와 동일 패턴).

**방법**:

1. `webpage/index.ts`의 startHoverMode()에서 HoverPopup 대신 HoverTooltip 직접 생성
2. `getTextBlockAtPoint()` 로직을 WebpageSiteHandler의 private 메서드로 이동
3. `webpage/hover-popup.ts` 파일 삭제

---

## 6. 작업 규칙

### 빌드 검증
매 단계 완료 후 반드시 `npm run build` 실행. tsc --noEmit 에러가 없어야 한다.

### 커밋 단위
한 번에 하나의 논리적 변경만 커밋. 예:
- "TwitterObserver를 BatchedObserver로 전환"
- "Webpage에 ProcessedTracker 적용"
- "재시작 조건을 공유 함수로 추출"

### 문서 동기화
코드 변경이 기술 명세의 기술과 달라지면, 해당 기술 명세도 함께 수정한다. 예를 들어 TwitterObserver를 제거하면 `docs/tech/twitter_tech.md` 2절을 BatchedObserver 사용으로 갱신.

### 의존성 순서
Phase 1 완료 후 Phase 2 진행. Phase 내 항목은 번호 순서대로 하되, 독립적인 항목은 순서를 바꿔도 된다.
- 4.1(TwitterObserver 전환)과 4.3(ProcessedTracker 적용)은 독립
- 4.4(재시작 조건)와 4.5(isJapaneseShortText)는 독립
- 5.1(createInlineBlock 전환)은 5.2(createRubyClone 전환)보다 먼저 하는 것이 자연스럽다

### 삭제 파일 체크리스트
리팩토링 과정에서 삭제 예정인 파일:
- [ ] `src/content/twitter/observer.ts` (4.1 완료 후)
- [ ] `src/content/webpage/hover-popup.ts` (5.3 완료 후)

---

## 7. Phase 3~5 (참고)

Phase 1~2 완료 후 `docs/tech/integration_architecture.md` 7절을 참조하여 진행한다. 여기서는 개요만 제시한다.

- **Phase 3 (판별·성능)**: Webpage IntersectionObserver 활성화, SPA 대응 추가, YouTube VideoObserver 이벤트 통합
- **Phase 4 (단어장 연동)**: 단어 클릭→단어장, 용어집↔단어장 연동, JSON 가져오기
- **Phase 5 (번역 파이프라인)**: 컨텍스트-인식 캐시 키, 프롬프트 템플릿화, 요청 큐잉/병합

---

## 8. 진행 상태 관리

작업 진행 시 `context.md`를 업데이트하여 다음 세션에 인수인계한다. 완료된 Phase의 항목은 체크 표시하고, 발견한 이슈나 변경된 결정은 context.md에 기록한다.

Phase 완료 시 `decisions/` 디렉토리에 decision 문서를 작성하여 주요 판단을 기록한다.
