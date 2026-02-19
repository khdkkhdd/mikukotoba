# 일반 웹페이지 번역 기능 기술 명세

> YouTube·Twitter(X) 이외의 모든 웹사이트에서 일본어 텍스트를 감지·번역하는 범용 핸들러의 기술적 설계.
> 현재 구현 분석을 기반으로 하되, 개선된 아키텍처를 목표로 한다.

---

## 1. 전체 아키텍처

### 1.1 모듈 구조

```
src/content/webpage/
├── index.ts              # WebpageSiteHandler (SiteHandler 구현체)
├── text-detector.ts      # 일본어 텍스트 감지 엔진
├── hover-popup.ts        # 호버 모드 (HoverTooltip 래퍼)
├── inline-translator.ts  # 인라인 모드 (번역 블록 삽입)
└── furigana-injector.ts  # 후리가나 전용 모드 (ruby 주입)
```

### 1.2 핸들러 특성

| 속성 | 값 | 설명 |
|------|-----|------|
| `id` | `'webpage'` | 핸들러 식별자 |
| `priority` | `0` | 최저 우선순위 — 전용 핸들러(Twitter=10, YouTube=5~10)가 우선 |
| `requiresJapaneseContent` | `true` | 일본어 감지 후 지연 활성화 |

### 1.3 활성화 플로우

```
페이지 로드
  → HandlerRegistry.getMatchingHandlers()
  → WebpageSiteHandler.matches() → true (YouTube, Twitter 도메인 제외)
  → requiresJapaneseContent = true → lazy 핸들러로 분류
  │
  ├─ TextDetector.hasJapaneseContent() → true
  │   → initTranslator() → startLazyHandlers()
  │   → handler.start() 즉시 실행
  │
  └─ TextDetector.hasJapaneseContent() → false
      → startLazyWatcher() → MutationObserver로 대기
      → 일본어 텍스트 동적 추가 감지 시
      → initTranslator() → startLazyHandlers()
```

**지연 활성화 판정**: `TextDetector.hasJapaneseContent()`는 `document.body.innerText`의 앞부분 5,000자에서 `japaneseRatio()` > 0.1을 확인한다. 히라가나·카타카나가 최소 1개 이상 포함되어야 일본어로 인정 (한자만 있으면 중국어 가능성).

### 1.4 모드별 실행 전략

```
WebpageSiteHandler.start()
  ├─ 'hover'         → HoverPopup 생성 + mount
  ├─ 'inline'        → InlineTranslator + TextDetector 생성 + start
  └─ 'furigana-only' → FuriganaInjector.init() + TextDetector 생성 + start
```

- **호버 모드**: TextDetector를 사용하지 않음. HoverTooltip이 `mousemove` 이벤트에서 직접 블록 요소를 탐색.
- **인라인/후리가나 모드**: TextDetector가 블록을 감지하면 콜백으로 전달.

---

## 2. 텍스트 감지 시스템 (TextDetector)

### 2.1 세 가지 감지 전략

TextDetector는 세 가지 상호보완적 전략으로 일본어 텍스트를 감지한다:

| 전략 | 감지 대상 | 메커니즘 |
|------|----------|----------|
| A. MutationObserver (childList) | 새 DOM 노드 추가 | `addedNodes` 중 HTMLElement와 Text 노드를 큐에 축적 |
| B. MutationObserver (characterData) | 기존 노드의 텍스트 변경 | Text 노드의 블록 부모를 찾아 재스캔 |
| C. IntersectionObserver | 뷰포트 진입 | `rootMargin: '200px'`로 사전 감지 |

### 2.2 배치 처리 플로우

```
Mutation 발생
  → pendingNodes / pendingCharDataNodes Set에 축적
  → scheduleFlush() — requestIdleCallback으로 예약 (중복 방지)
  → flush()
     ├─ pendingNodes: 각 노드에 대해 scan(node) 호출
     └─ pendingCharDataNodes: rescanIfChanged(parent) 호출
```

**`requestIdleCallback` 사용 이유**: 브라우저의 유휴 시간에 처리하여 스크롤, 클릭 등 사용자 인터랙션을 방해하지 않음.

### 2.3 블록 요소 탐색 (`findBlockParent`)

Text 노드에서 상위로 올라가며 CSS `display`가 블록 레벨인 요소를 찾는다:

```typescript
// 블록 레벨 판정 기준
display === 'block' || 'flex' || 'grid' || 'list-item' || 'table-cell'
```

**제외 대상:**
- `data-jp-translation` 속성이 있는 요소 (JP Helper 삽입 요소)
- `contenteditable`, `role="textbox"`, `role="combobox"` (편집 영역)

### 2.4 중복 방지

```typescript
processedElements: WeakSet<HTMLElement>  // 이미 처리된 블록
processedTexts: WeakMap<HTMLElement, string>  // 블록별 마지막 처리 텍스트
```

- 같은 블록의 텍스트가 변경되면 `processedTexts`의 값과 비교하여 재처리
- WeakSet/WeakMap 사용으로 DOM에서 제거된 요소는 자동 GC

### 2.5 일본어 판정

```
텍스트에 히라가나/카타카나 포함 여부 (isJapanese)
  → 있으면 japaneseRatio 계산
  → 비율 > 0.1 (10%) → 번역 대상
```

### 2.6 출력 형식

```typescript
interface DetectedBlock {
  element: HTMLElement;   // 블록 요소
  textNodes: Text[];      // 하위 텍스트 노드들
  text: string;           // 텍스트 노드들의 연결 문자열
}
```

### 2.7 개선 방향

**현재 한계:**
- `getComputedStyle(current).display` 호출이 빈번하여 layout thrashing 발생 가능
- `walkTextNodes`가 `data-jp-processed`를 `closest()`로 확인하여, 대규모 DOM에서 성능 저하

**개선안:**

1. **display 값 캐싱**: 동일 요소에 대한 `getComputedStyle` 호출을 WeakMap으로 캐싱. flush 단위로 캐시 무효화.

2. **데이터 속성 기반 빠른 필터링**: `walkTextNodes`에서 `closest()` 대신 부모 체인을 직접 탐색하면서 `hasAttribute()`로 확인. `closest()`는 CSS 셀렉터 파싱 오버헤드가 있음.

3. **뷰포트 기반 우선순위**: ~~현재 IntersectionObserver는 활용도가 낮음~~ → **해결됨** (Phase 3). `scan()`에서 `isNearViewport()` 체크 후 화면 밖 블록은 IntersectionObserver에 등록, 화면 내 블록만 즉시 처리.

---

## 3. 호버 모드 (HoverPopup)

### 3.1 구조

HoverPopup은 공유 `HoverTooltip` 위의 얇은 래퍼로, 웹페이지 전용 `getTargetAtPoint` 콜백을 제공한다.

```
HoverPopup
  └── HoverTooltip (Shadow DOM 격리)
        ├── mousemove → debounce(1000ms) → handleHover()
        ├── getTargetAtPoint(x, y) → 블록 부모 탐색
        └── translate(text) → 팝업 표시
```

### 3.2 타겟 탐색 (`getTextBlockAtPoint`)

```
elementFromPoint(x, y)
  → 상위로 탐색 (current.parentElement)
  → data-jp-translation, data-jp-processed → skip (JP Helper 요소)
  → display가 block/flex/grid/list-item/table-cell?
    → text = innerText.trim()
    → text.length <= 500 && isJapanese(text)
    → { text, element } 반환
```

**500자 제한**: 너무 큰 컨테이너(예: `<body>`, `<main>`)를 잡는 것을 방지. 호버 모드에서는 문장~문단 단위가 적합.

**일본어 비율 확인 차이**: 인라인/후리가나 모드의 TextDetector는 `japaneseRatio > 0.1` (10%)을 확인하지만, 호버 모드는 `isJapanese(text)` (히라가나·카타카나 존재 여부)만 확인한다. 비율 체크가 없으므로 한두 글자의 일본어가 포함된 비일본어 블록에서도 팝업이 나타날 수 있다.

### 3.3 팝업 동작

| 동작 | 구현 |
|------|------|
| 마우스 지연 | `debounceMs: 1000` (웹페이지 전용, Twitter는 300ms) |
| 팝업 유지 | 원래 텍스트 또는 팝업 위에 마우스가 있는 동안 |
| 팝업 닫기 | 마우스 이탈 후 100ms, ESC 키 |
| 텍스트 선택 | `mousedown` → `isSelecting` 플래그로 팝업 유지 |
| 스크롤 격리 | `wheel` 이벤트 `stopPropagation()` + 경계 `preventDefault()` |
| 로딩 상태 | "번역 중..." 스피너 → 결과로 교체 |
| 재번역 | ↻ 버튼 → `translator.retranslate(text)` |

### 3.4 개선 방향

1. **후리가나 표시**: 현재 호버 팝업에는 로마자+번역만 표시. 팝업 내에 후리가나가 붙은 원문도 함께 표시하여 한자 읽기 학습 지원.

2. **긴 텍스트 부분 번역**: 500자 제한을 완화하되, 마우스 커서 위치 근처의 문장만 추출하여 번역. `getSentenceAtPosition()` 활용.

---

## 4. 인라인 모드 (InlineTranslator)

### 4.1 처리 플로우

```
TextDetector.onDetected(blocks)
  → InlineTranslator.processBlocks(blocks)
  → 5개 단위 청크로 분할
  → 각 청크: Promise.all로 병렬 번역
  → 청크 사이: requestIdleCallback으로 양보
```

### 4.2 단일 블록 처리

```
processBlock(block)
  → processedBlocks WeakSet 중복 확인
  → translator.translate(block.text)
  → showFurigana? → injectFurigana(block, tokens)
  → showTranslation? → 번역 블록 생성 + 삽입
```

### 4.3 후리가나 주입 (`injectFurigana`)

토큰을 순차적으로 텍스트 노드에 매칭하여 `<ruby>` 태그로 변환:

```typescript
// 각 텍스트 노드에 대해
while (pos < trimmed.length && tokenIndex < tokens.length) {
  if (trimmed.startsWith(token.surface, pos)) {
    if (token.isKanji && token.reading !== token.surface) {
      html += `<ruby>${surface}<rt>${reading}</rt></ruby>`;
    } else {
      html += token.surface;
    }
    pos += token.surface.length;
    tokenIndex++;
  } else {
    html += trimmed[pos]; pos++;
  }
}
```

**텍스트 노드 → span 교체**: 원본 텍스트 노드를 `<span data-jp-processed style="line-height:2.3em">` 으로 교체. 줄 높이 2.3em은 후리가나가 겹치지 않도록 하는 최소 값.

### 4.4 번역 블록 구성

```html
<div class="jp-inline-translation" data-jp-translation data-jp-processed>
  <div class="jp-inline-romaji">romaji text</div>  <!-- showRomaji일 때 -->
  korean translation                                  <!-- showTranslation일 때 -->
  <div class="jp-inline-engine-badge">papago ↻</div>
</div>
```

### 4.5 재번역 처리

```
↻ 클릭 → btn.classList.add('spinning')
  → translator.retranslate(text)
  → 성공 → innerHTML 교체 + 이벤트 리스너 재부착
  → 실패 → spinning 해제
```

### 4.6 정리 (`cleanup`)

- `translationElements` 배열의 모든 요소 제거
- `data-jp-processed` 속성 제거 (후리가나 span은 원복하지 않음 — 원본 텍스트 노드를 저장하지 않기 때문)

### 4.7 개선 방향

**현재 한계:**
- `injectFurigana`에서 원본 텍스트 노드를 span으로 교체하면, cleanup 시 원본 복원이 불가능. `data-jp-processed` 속성만 제거하고 span 자체는 남음.
- 번역 실패 시 `processedBlocks`에서 삭제하지만, 이미 주입된 후리가나는 남아있음.
- 동시 번역 수 제한 없음 — 인라인 모드에서 대량 블록 감지 시 API 호출 폭주 가능. 번역 공통 기술 명세의 API 통신 계층에서 `maxConcurrent = 3`으로 동시 요청을 제한하나, 핸들러 수준의 세마포어는 미적용.

**개선안:**

1. **원본 텍스트 노드 보존**: 후리가나 span 교체 시 원본 텍스트를 `data-jp-original` 속성에 저장하거나, 별도 WeakMap에 원본 노드를 보관하여 cleanup 시 완전 복원.

2. **동시 번역 제한**: `Semaphore` 패턴으로 최대 동시 번역 수를 3건으로 제한. 번역 공통 기술 명세의 요청 큐잉과 연동.

3. **레이아웃 안정화**: 번역 블록 삽입이 그리드/카드 레이아웃을 깨뜨리는 문제. 삽입 전 부모 요소의 `display` 속성을 확인하여, grid/flex 컨테이너의 직접 자식인 경우 번역 블록을 해당 블록 요소 내부에 삽입하는 방식으로 변경.

---

## 5. 후리가나 전용 모드 (FuriganaInjector)

### 5.1 처리 플로우

```
TextDetector.onDetected(blocks)
  → FuriganaInjector.processBlocks(blocks)
  → 모든 블록의 텍스트 노드를 플랫 배열로 합침
  → 100개 단위 청크로 분할
  → 각 청크: processChunk(textNodes)
  → 청크 사이: requestIdleCallback으로 양보
```

### 5.2 단일 텍스트 노드 처리

```
processChunk(textNodes)
  → processedNodes WeakSet 중복 확인
  → analyzer.analyze(text) → MorphemeToken[]
  → hasKanjiTokens? (isKanji && reading !== surface)
    → 없으면 스킵 (히라가나·카타카나만 있는 텍스트)
  → ruby HTML 생성
  → <span data-jp-processed style="line-height:2.3em"> 으로 텍스트 노드 교체
```

### 5.3 번역 API 미사용

후리가나 전용 모드는 형태소 분석기(Kuromoji)만 사용한다. `translator.translate()`를 호출하지 않으므로:
- API 비용 없음
- Kuromoji 사전 로드 후 로컬에서 즉시 처리 (~1-5ms/문장)
- 오프라인 환경에서도 동작 가능 (사전 파일이 캐싱된 경우)

### 5.4 정리 (`cleanup`)

```typescript
// 원본 텍스트 노드로 복원
for (const span of this.injectedSpans) {
  const text = document.createTextNode(span.textContent || '');
  span.parentNode?.replaceChild(text, span);
}
```

InlineTranslator와 달리, `injectedSpans` 배열을 통해 모든 span의 textContent로 원본 텍스트 노드를 재생성하여 완전 복원.

### 5.5 개선 방향

1. **MorphologicalAnalyzer 공유**: 현재 FuriganaInjector는 자체 `MorphologicalAnalyzer` 인스턴스를 생성. `translator.getAnalyzer()`로 공유 인스턴스를 사용하면 Kuromoji 사전 이중 로드 방지.

2. **증분 처리**: 현재는 블록의 모든 텍스트 노드를 한꺼번에 처리. 대규모 페이지에서 화면에 보이는 노드부터 우선 처리하도록 IntersectionObserver 연동.

---

## 6. 상태 표시기 (StatusIndicator)

### 6.1 구조

```
<jp-helper-status>
  #shadow-root (closed)
    <style>...</style>
    <div class="pill">
      <span class="dot idle"></span>
      <span class="label">JP Helper</span>
      <span class="counts"></span>
    </div>
</jp-helper-status>
```

Custom Element + Shadow DOM (closed)으로 호스트 페이지 CSS와 완전 격리.

### 6.2 상태 전이

```
idle → detecting (블록 감지)
  → translating (번역 시작)
  → done (모든 번역 완료, 4초 후 자동 숨김)
  → error (실패 발생)
```

### 6.3 카운트 추적

```typescript
interface StatusCounts {
  detected: number;     // 감지된 블록 수
  translating: number;  // 현재 번역 중 (증가+감소)
  done: number;         // 번역 완료
  failed: number;       // 번역 실패
}
```

- `translating`이 0이 되면 → `done` 또는 `error` 상태로 전환
- 클릭으로 즉시 숨김

---

## 7. 설정 변경 대응

### 7.1 `updateSettings` 동작

```typescript
updateSettings(settings) {
  // 모드, 표시 옵션 변경 → 전체 재시작
  if (webpageMode || showFurigana || showTranslation || showRomaji 변경) {
    stop();  // 기존 모든 요소 정리
    start(); // 새 모드로 처음부터 시작
    return;
  }
  // 그 외 (색상 등) → 자식 모듈에 전파
  hoverPopup?.updateSettings(settings);
  inlineTranslator?.updateSettings(settings);
  furiganaInjector?.updateSettings(settings);
}
```

### 7.2 CSS 변수 실시간 반영

`content/index.ts`의 `applyCSSVariables()`가 색상·크기 설정을 CSS 변수로 주입:

```css
--jp-inline-color-furigana
--jp-inline-color-romaji
--jp-inline-color-translation
--jp-inline-font-scale
--jp-inline-furigana-scale
```

이 변수들은 `overlay-styles.css`에서 참조되어, 기존 번역 요소에도 즉시 반영.

---

## 8. 다른 핸들러와의 차이점

### 8.1 YouTube/Twitter와의 비교

| 특성 | Webpage | YouTube Page | Twitter |
|------|---------|-------------|---------|
| DOM 감지 | TextDetector (범용) | BatchedObserver (셀렉터 라우팅) | TwitterObserver (data-testid) |
| 요소 선택 | `getComputedStyle` 블록 판정 | `YT_SELECTOR_DEFS` 정의 | `SELECTORS` 상수 |
| 카테고리 | 없음 (단일) | main/rich/label | tweet/user/trend |
| 뷰포트 최적화 | IntersectionObserver (TextDetector) | IntersectionObserver (deferToViewport) | 없음 (가상 스크롤 의존) |
| 후리가나 방식 | 텍스트 노드 직접 교체 | `createStyledFuriganaBlock` / `createRubyClone` | `createRubyClone` |
| 일본어 판별 | `japaneseRatio > 0.1` | `containsJapaneseLike` | `lang="ja"` 우선, 문자 감지 보조 |
| 스포일러 | 없음 | 있음 | 있음 |
| SPA 대응 | popstate + hashchange + URL 폴링 | `yt-navigate-finish` 이벤트 | MutationObserver (React 호환) |

### 8.2 Webpage 핸들러의 설계 철학

- **범용성 우선**: 사이트별 셀렉터 없이 CSS display 기반 블록 탐색
- **보수적 감지**: `japaneseRatio > 0.1` 조건으로 일본어 단어가 한두 개 섞인 비일본어 페이지 제외
- **지연 활성화**: 일본어 없는 페이지에서 불필요한 리소스 소모 방지

---

## 9. 성능 고려사항

### 9.1 텍스트 감지 비용

| 연산 | 비용 | 빈도 |
|------|------|------|
| `getComputedStyle().display` | ~0.1ms (reflow 유발 가능) | 텍스트 노드당 부모 체인 탐색 |
| `isJapanese()` (정규식) | ~0.01ms | 텍스트 노드당 |
| `japaneseRatio()` (정규식) | ~0.05ms | 블록당 |
| `requestIdleCallback` 예약 | ~0ms | 변동당 1회 |

### 9.2 번역 비용

| 모드 | API 호출 | 형태소 분석 |
|------|---------|------------|
| 호버 | 호버 시 1회/블록 | 번역 응답에 포함 |
| 인라인 | 블록당 1회 (자동) | 번역 응답에 포함 |
| 후리가나 | 없음 | 노드당 1회 (Kuromoji) |

### 9.3 최적화 적용 현황

- **배치 처리**: 인라인 5개, 후리가나 100노드 단위
- **유휴 시간 활용**: `requestIdleCallback`으로 메인 스레드 양보
- **중복 방지**: WeakSet/WeakMap으로 처리 추적
- **뷰포트 인식**: `scan()`에서 `isNearViewport()` 체크 후 뷰포트 내 블록은 즉시 처리, 뷰포트 밖 블록은 IntersectionObserver(`rootMargin: '200px'`)에 등록하여 스크롤 시 처리. 초기 로딩 시 화면에 보이는 요소만 우선 번역.

---

## 10. 현재 구현의 edge case와 workaround

### 10.1 SPA 대응

WebpageSiteHandler는 세 가지 방법으로 SPA 네비게이션을 감지한다:
- `popstate` 이벤트 (뒤로가기/앞으로가기)
- `hashchange` 이벤트 (해시 기반 라우팅)
- URL 폴링 `setInterval(1000ms)` (pushState/replaceState 대응 — ISOLATED world에서 래핑 불가하므로 폴링 사용)

네비게이션 감지 시: `tracker.cleanup()` → TextDetector 재시작 → 점진적 재스캔 [500, 1500, 3000]ms.
MutationObserver도 병행하여 새 DOM 노드를 자동 감지한다.

### 10.2 후리가나 줄 높이 간섭

`line-height: 2.3em` 인라인 스타일이 원래 페이지의 레이아웃을 변경한다. 특히:
- 카드/그리드 레이아웃에서 높이 불균형
- 고정 높이 컨테이너에서 텍스트 잘림

### 10.3 인라인 모드 cleanup 불완전

`InlineTranslator.cleanup()`은 번역 블록은 제거하지만, 후리가나 span은 제거하지 않는다. `data-jp-processed` 속성만 제거하여 "정리됨" 표시를 하지만, 원본 텍스트 노드로 복원되지 않음. `FuriganaInjector`는 `injectedSpans` 추적으로 완전 복원.

**모드별 cleanup 완전성:**

| 모드 | 번역 블록 제거 | 후리가나 원복 | 이벤트 리스너 정리 |
|------|-------------|-------------|-----------------|
| 호버 | N/A (팝업은 숨김) | N/A | HoverTooltip unmount |
| 인라인 | O | X (span 잔존) | O |
| 후리가나 전용 | N/A | O (완전 복원) | N/A |

### 10.4 대규모 페이지 성능

뉴스 사이트 등에서 수백 개의 일본어 블록이 한꺼번에 감지되면, 인라인 모드에서 수백 건의 API 호출이 순차 발생. 청크 사이즈(5)가 API 응답 지연(1-3초)과 곱해져 수 분의 처리 시간 소요.

---

## 11. 메시지 프로토콜

### 11.1 설정 변경 전파

Popup/옵션 페이지에서 설정이 변경되면 Background Service Worker를 거쳐 모든 탭의 Content Script에 전파된다:

```
Popup/Options → chrome.storage.set()
  → chrome.storage.onChanged 이벤트
  → Service Worker: broadcastToAllTabs()
     → chrome.tabs.sendMessage({ type: 'SETTINGS_CHANGED', payload })
  → Content Script (content/index.ts): onMessage 핸들러
     → handler.updateSettings(newSettings)
```

관련 메시지 타입:

| 메시지 | 방향 | 용도 |
|--------|------|------|
| `SETTINGS_CHANGED` | Background → Content | 설정 변경 전파 |
| `MODE_CHANGED` | Background → Content | 번역 모드 변경 |
| `TOGGLE_ENABLED` | Background → Content | 확장 활성/비활성 토글 |

### 11.2 TranslationResult 참조

번역 API의 입출력 타입은 `src/types/index.ts`에 정의되어 있다:

```typescript
interface TranslationResult {
  original: string;           // 원문
  tokens: MorphemeToken[];    // 형태소 분석 결과
  korean: string;             // 한국어 번역
  engine: 'papago' | LLMPlatform;  // 사용된 엔진
  complexityScore: number;    // 복잡도 점수 (0~10)
  fromCache: boolean;         // 캐시 히트 여부
}
```

`translator.translate(text)`는 `TranslationResult`를 반환하며, `translator.retranslate(text)`는 캐시를 무시하고 강제 LLM 번역 후 동일 타입을 반환한다.

### 11.3 CSS 스타일 참조

번역 요소의 시각적 스타일은 `src/content/overlay-styles.css`에 정의되어 있으며, CSS 변수로 커스터마이징된다:

| CSS 변수 | 대상 | 기본값 |
|----------|------|--------|
| `--jp-inline-color-furigana` | 후리가나 텍스트 | `#888888` |
| `--jp-inline-color-romaji` | 로마자 텍스트 | `#4A7DFF` |
| `--jp-inline-color-translation` | 번역 텍스트 | `#555555` |
| `--jp-inline-font-scale` | 번역 블록 폰트 비율 | `0.88` |
| `--jp-inline-furigana-scale` | 후리가나 rt 크기 비율 | `0.55` |

인라인 번역 블록은 원문과 얇은 상단 구분선(`border-top`)으로 구분되며, 번역문은 이탤릭체로 표시된다.
