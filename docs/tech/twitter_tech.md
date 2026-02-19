# Twitter(X) 번역 기능 기술 명세

> Twitter(X)에서 트윗, 유저 정보, 트렌딩 토픽을 번역하는 핸들러의 기술적 설계.
> 현재 구현 분석을 기반으로 하되, 개선된 아키텍처를 목표로 한다.

---

## 1. 전체 아키텍처

### 1.1 모듈 구조

```
src/content/twitter/
├── index.ts           # TwitterHandler (SiteHandler 구현체, 코디네이터)
├── tweet-handler.ts   # TweetHandler (트윗 본문, 카드, 투표)
├── user-handler.ts    # UserHandler (표시이름, 바이오, 위치, 셀)
├── trend-handler.ts   # TrendHandler (트렌딩 토픽)
├── utils.ts           # 셀렉터, 유틸리티 함수, 상수
└── twitter.css        # 트위터 전용 스타일
```

DOM 감지는 공유 `BatchedObserver`(`src/content/shared/batched-observer.ts`)를 사용.

### 1.2 핸들러 특성

| 속성 | 값 | 설명 |
|------|-----|------|
| `id` | `'twitter'` | 핸들러 식별자 |
| `priority` | `10` | 전용 핸들러 우선순위 |
| `matches` | `x.com` 또는 `twitter.com` | 도메인 매칭 |
| `isEnabled` | 항상 `true` | 트위터 접속 시 무조건 활성화 |

### 1.3 코디네이터 패턴

`TwitterHandler`는 직접 DOM을 처리하지 않고, 세 개의 전문 핸들러를 조율하는 코디네이터 역할:

```
TwitterHandler (SiteHandler)
  ├── 공유 자원
  │   ├── hoverTargets: WeakSet<HTMLElement>  — 호버 대상 등록부
  │   └── HoverTooltip (debounceMs=300)       — 공유 팝업
  │
  ├── TweetHandler   — hoverTargets 참조
  ├── UserHandler    — hoverTargets 참조
  ├── TrendHandler   — 독립 (호버 미사용)
  │
  └── BatchedObserver — DOM 변경을 감지하여 각 핸들러에 라우팅
```

### 1.4 공유 호버 인프라

트윗 본문(호버 모드)과 유저 이름/위치는 동일한 `HoverTooltip` 인스턴스와 `hoverTargets` WeakSet을 공유한다:

- `TweetHandler`가 호버 모드일 때 트윗 본문을 `hoverTargets`에 등록
- `UserHandler`가 유저 이름, 위치, 소셜 컨텍스트를 `hoverTargets`에 등록
- `TwitterHandler.getHoverTargetAtPoint()`에서 `elementFromPoint` → 부모 체인 탐색 → `hoverTargets.has()` 확인

**텍스트 복원**: 후리가나 클론의 `innerText`는 읽기가 포함되어 원문과 다르다. `data-jp-hover-text` 속성에 원문을 저장하여 호버 시 올바른 텍스트로 번역.

---

## 2. DOM 감지 (BatchedObserver)

공유 `BatchedObserver`(`src/content/shared/batched-observer.ts`)를 사용하여 트위터의 모든 번역 대상을 하나의 MutationObserver로 감지. YouTube Page 핸들러와 동일한 패턴.

### 2.1 SelectorRoute 기반 라우팅

`TwitterHandler.start()`에서 9개의 `SelectorRoute`를 정의하여 BatchedObserver에 전달:

```
routes = [
  { selector: SELECTORS.TWEET_TEXT, callback: → tweetHandler.processTweetText },
  { selector: SELECTORS.CARD_WRAPPER, callback: → tweetHandler.processCard },
  { selector: SELECTORS.USER_NAME, callback: → userHandler.processUserName },
  ... (총 9개)
]
```

### 2.2 옵저버 옵션

```typescript
{
  logNamespace: 'Twitter:Observer',
  characterData: true,
  characterDataAncestorResolver: (node) =>
    node.parentElement?.closest(TWEET_TEXT, USER_DESCRIPTION),
  shouldSkip: (el) =>
    el.hasAttribute(TRANSLATION_ATTR) ||
    el.hasAttribute(PROCESSED_ATTR) ||
    isEditableArea(el),
  scanExisting: true,
}
```

### 2.3 배치 처리

BatchedObserver가 내부적으로 처리:
- `pendingNodes` Set에 축적 → `requestIdleCallback`으로 배치 플러시
- `characterData` mutation → `characterDataAncestorResolver`로 부모 요소 해결
- 초기 스캔: `scanExisting: true`로 기존 DOM 요소 자동 처리

### 2.4 편집 영역 제외

`shouldSkip` 콜백에서 `isEditableArea(el)` 확인. 트윗 작성 창, 답글 입력 등에서는 번역하지 않는다.

---

## 3. 셀렉터 체계

### 3.1 data-testid 기반

트위터는 CSS 클래스를 빌드마다 난독화하므로, `data-testid` 속성을 주 셀렉터로 사용:

| 셀렉터 | data-testid | 라우팅 대상 |
|--------|-------------|-----------|
| `TWEET_TEXT` | `tweetText` | TweetHandler.processTweetText |
| `CARD_WRAPPER` | `card.wrapper` | TweetHandler.processCard |
| `USER_NAME` | `User-Name` | UserHandler.processUserName |
| `USER_NAME_PROFILE` | `UserName` | UserHandler.processProfileName |
| `USER_DESCRIPTION` | `UserDescription` | UserHandler.processUserDescription |
| `USER_LOCATION` | `UserLocation` | UserHandler.processUserLocation |
| `USER_CELL` | `UserCell` | UserHandler.processUserCell |
| `SOCIAL_CONTEXT` | `socialContext` | UserHandler.processSocialContext |
| `TREND` | `trend` | TrendHandler.processTrend |

### 3.2 주의사항

- `User-Name` (하이픈 있음): 타임라인의 트윗 상단 표시이름
- `UserName` (하이픈 없음): 프로필 페이지 헤더의 표시이름
- 두 셀렉터의 DOM 구조가 다르므로 별도 처리 필요

### 3.3 마킹 속성

```typescript
TRANSLATION_ATTR = 'data-jp-twitter-translation'  // 삽입된 번역 요소 표시
PROCESSED_ATTR = 'data-jp-twitter-processed'       // 처리된 원본 요소 표시
```

---

## 4. 트윗 번역 (TweetHandler)

### 4.1 요소별 처리 모드

| 요소 | 모드 | 렌더링 |
|------|------|--------|
| 트윗 본문 | inline | 아래에 번역 블록 삽입 (Mode A) |
| 트윗 본문 | furigana-only | 후리가나 클론만 삽입, 번역 블록 미삽입 (Mode E) |
| 트윗 본문 | hover | 호버 타겟 등록 |
| 링크 카드 | 공통 | 카드 내부에 소형 번역 삽입 (Mode D) |
| 투표 선택지 | 공통 | 인라인 괄호 (Mode C) |

### 4.2 트윗 본문 처리 (processTweetText)

**일본어 판별:**
```
isJapaneseText(element)
  → element.getAttribute('lang') === 'ja' → true (빠른 경로)
  → element.closest('[lang="ja"]') → true
  → isJapanese(text) → 히라가나/카타카나 존재 여부
```

트위터가 트윗에 `lang` 속성을 제공하므로, 문자 감지 전에 이를 우선 활용. YouTube의 `containsJapaneseLike`보다 정확.

**인라인 모드 플로우:**
```
processTweetText(element)
  → isJapaneseText(element) 확인
  → tracker.isProcessedWithSameText(el, text) 중복 확인
  → 텍스트 변경 시 기존 번역 제거
  → markProcessed(element) — PROCESSED_ATTR 설정
  → translator.translate(text)
  → [연결 확인] el.isConnected && 텍스트 미변경
  → insertInlineBlock(element, result, text)
```

**후리가나 전용 모드 플로우:**

현재 구현에서는 `furigana-only`와 `inline`이 동일 코드 경로를 사용한다. 기능 명세에 따르면 후리가나 전용 모드에서는 번역 블록을 삽입하지 않고, 호버 팝업으로 번역을 확인해야 한다. 이 차이는 향후 다음과 같이 수정 예정:

```
processTweetText(element)
  → mode === 'furigana-only'
  → translator.translate(text) — 형태소 분석 결과 포함
  → createRubyClone(element, result.tokens)
  → 원문 숨기고 클론 표시
  → 클론을 hoverTargets에 등록 (data-jp-hover-text로 원문 저장)
  → 번역 블록은 삽입하지 않음
```

**호버 모드 플로우:**
```
processTweetText(element)
  → mode === 'hover'
  ├─ showFurigana → processHoverWithFurigana(element, text)
  │   → translator.translate(text) — 형태소 분석 결과 포함
  │   → createRubyClone(element, result.tokens)
  │   → 원문 숨기고 클론 표시
  │   → 클론을 hoverTargets에 등록 (data-jp-hover-text로 원문 저장)
  │
  └─ !showFurigana → registerHoverTarget(element)
```

### 4.3 인라인 블록 삽입 (insertInlineBlock)

```
insertInlineBlock(target, result, text)
  → tracker.removeExistingTranslation(target) — 기존 번역 제거
  → target.classList.remove('jp-furigana-hidden') — 원문 복원
  │
  ├─ showFurigana
  │   → createRubyClone(target, result.tokens) — 인터랙티브 보존 클론
  │   → target 뒤에 클론 삽입
  │   → target.classList.add('jp-furigana-hidden')
  │   → insertAfter = clone
  │
  └─ createInlineBlock(result, settings, {
       spoiler: true,
       skipFurigana: settings.showFurigana,
       onRetranslate: () => translator.retranslate(text),
     })
     → insertAfter 뒤에 번역 블록 삽입
```

**`createRubyClone` 사용 이유**: 트윗 본문에는 @멘션, #해시태그, URL 링크 등 인터랙티브 요소가 포함. DOM을 deep clone하여 텍스트 노드만 ruby 태그로 교체하므로, 클릭 가능한 요소가 모두 보존된다.

**React DOM 수정 금지**: 트위터의 React가 관리하는 원본 DOM 노드를 직접 수정하면 React가 되돌린다. 따라서 원본은 건드리지 않고, sibling으로 번역 요소를 삽입한다.

### 4.4 링크 카드 처리 (processCard)

```
processCard(element)
  → findCardTextSpans(card) — 카드 내 텍스트 span 탐색
  │   → card.querySelectorAll('span, div')
  │   → 필터: 링크가 아닌, 번역이 아닌, 2-300자, 하위 블록 요소 없는 span
  │
  → 텍스트 결합 ('—'로 연결) → isJapaneseText 확인
  → translator.translate(combinedText)
  → insertCardTranslation(card, textSpans, result)
      → 마지막 span 뒤에 소형 번역 블록 삽입
      → jp-spoiler 클래스 + addSpoilerBehavior
```

### 4.5 투표 선택지 처리 (processPollOption)

```
processPollOption(element)
  → isJapaneseText(element) 확인
  → translator.translate(text)
  → createInlineBracket(result, settings, { spoiler: true })
  → element 뒤에 ` (번역)` 형태로 삽입
```

### 4.6 개선 방향

**현재 한계:**
- `processCard`의 `findCardTextSpans` 휴리스틱이 카드 구조 변경에 취약.
- 투표 선택지(`processPollOption`)가 observer에서 직접 라우팅되지 않음. `processTweetText` 내부에서 인접 투표 요소를 탐색하여 호출하거나, observer에 전용 셀렉터를 추가해야 한다.
- 인용 트윗의 번역이 원본 트윗과 겹칠 수 있음.

**개선안:**

1. **카드 구조 안정화**: `data-testid`를 활용한 카드 내부 요소 탐색. 현재 `span, div` 탐색은 너무 범용적.

2. **투표 전용 셀렉터**: `SELECTORS`에 투표 선택지 전용 셀렉터 추가. observer에서 직접 라우팅.

---

## 5. 유저 정보 번역 (UserHandler)

### 5.1 요소별 처리

| 메서드 | 대상 | 처리 방식 | 일본어 판별 |
|--------|------|----------|-----------|
| `processUserName` | 타임라인 표시이름 | 호버 등록 | `isJapaneseShortText` |
| `processProfileName` | 프로필 헤더 이름 | 호버 등록 | `isJapaneseShortText` |
| `processUserDescription` | 자기소개 (Bio) | 모드별 분기 | `isJapaneseText` |
| `processUserLocation` | 위치 | 호버 등록 | `isJapaneseShortText` |
| `processUserCell` | 팔로워/팔로잉 셀 | 이름=호버, 바이오=모드별 | 각각 |
| `processSocialContext` | 리포스트 표시 | 호버 등록 | `isJapaneseShortText` |

### 5.2 표시이름 처리 (processUserName)

```
processUserName(element)
  → getDisplayName(element) — 첫 번째 <a> 내 <span>의 innerText
  → isJapaneseShortText(nameText) — CJK 비율 50% 이상
  → hoverTargets.add(nameSpan)
  → nameSpan.setAttribute('data-jp-hover', 'name')
```

**`isJapaneseShortText` 사용 이유**: 짧은 이름에는 히라가나/카타카나가 없는 순수 한자(예: 田中太郎)도 있다. `isJapanese()`는 히라가나/카타카나를 요구하므로, CJK 비율 기반 판별을 추가:

```typescript
function isJapaneseShortText(text: string): boolean {
  if (isJapanese(text)) return true;
  const cjkChars = (text.match(/[\u4E00-\u9FFF\u3400-\u4DBF]/g) || []).length;
  const totalChars = text.replace(/\s/g, '').length;
  return totalChars > 0 && cjkChars / totalChars >= 0.5;
}
```

### 5.3 자기소개 처리 (processUserDescription)

모드별 분기:

```
processUserDescription(element)
  ├─ mode === 'off' → skip
  ├─ mode === 'hover'
  │   ├─ showFurigana → processHoverWithFurigana(element, text)
  │   └─ else → hoverTargets.add(element) + 'jp-twitter-hover-target' 클래스
  │
  └─ mode === 'inline' / 'furigana-only'
      → translator.translate(text)
      → insertBioTranslation(element, result, false, text)
```

`insertBioTranslation`은 `TweetHandler.insertInlineBlock`과 동일 패턴 (furigana clone → 번역 블록).

### 5.4 UserCell 처리 (processUserCell)

팔로워/팔로잉 목록의 각 셀에는 이름과 바이오 미리보기가 있다:

```
processUserCell(element)
  → [이름] element.querySelector('a[role="link"] span')
  │   → isJapaneseShortText(nameText) → hoverTargets.add(nameArea)
  │
  → [바이오] element.querySelectorAll(':scope > div > div')
      → 각 div: 5자 이상, 링크/버튼 없음, isJapaneseText
      ├─ hover 모드: hoverTargets.add(div)
      └─ inline 모드: translator.translate(text) → insertBioTranslation(div, result, true)
      → 첫 매칭만 처리 (break)
```

**compact 플래그**: UserCell의 바이오는 `insertBioTranslation(div, result, true, text)`로 호출. `compact=true`가 `createInlineBlock`에 전달되어 축소된 스타일 적용.

### 5.5 소셜 컨텍스트 처리

"○○さんがリポスト" 표시에서 유저 이름 링크를 추출하여 호버 등록:

```
processSocialContext(element)
  → element.querySelector('a')
  → link.innerText → isJapaneseShortText 확인
  → hoverTargets.add(link)
```

### 5.6 개선 방향

**현재 한계:**
- `getDisplayName`이 첫 번째 `<a>` → `<span>` 순서로 탐색. 트위터 DOM 변경에 취약.
- UserCell 내 바이오 탐색이 `:scope > div > div` 휴리스틱 기반.
- 프로필 페이지의 팔로워 수, 팔로잉 수 텍스트가 오탐될 수 있음 (숫자 + 한자 조합).

**개선안:**

1. **DOM 탐색 안정화**: `data-testid` 기반 탐색으로 전환. 현재 트위터가 제공하지 않는 경우, ARIA 속성(`role`, `aria-label`) 활용.

2. **숫자 혼합 텍스트 필터링**: "1,234フォロー中" 같은 UI 텍스트를 isJapaneseShortText에서 제외하도록 패턴 추가.

---

## 6. 트렌딩 토픽 번역 (TrendHandler)

### 6.1 처리 플로우

```
processTrend(element)
  → findTopicSpan(element) — 토픽명 span 탐색
  → isJapaneseShortText(text) || isJapaneseText(topicSpan)
  → translator.translate(text)
  → createInlineBracket(result, settings, { spoiler: true })
  → topicSpan 뒤에 ' (번역)' 삽입
```

### 6.2 토픽명 span 탐색 (findTopicSpan)

트렌드 요소 내부에는 카테고리, 토픽명, 게시물 수 등 여러 span이 있다. 휴리스틱으로 토픽명을 식별:

```
findTopicSpan(trend)
  → trend.querySelectorAll('span')
  → 필터:
      ├─ 하위 span이 있는 요소 제외 (부모 컨테이너)
      ├─ TRANSLATION_ATTR가 있는 요소 제외
      ├─ 게시물 수 패턴 제외: /^\d[\d,.]*(件|posts?|K|M)/
      ├─ 카테고리 라벨 제외: /^(Trending|トレンド)$/i
      └─ 구분자 포함 제외: '·' 포함 && 30자 미만
  → 남은 후보 중 가장 긴 텍스트 선택
```

### 6.3 개선 방향

**현재 한계:**
- `findTopicSpan`의 휴리스틱이 트렌드 UI 변경에 취약.
- "1,234件のポスト" 패턴이 모든 언어를 커버하지 못할 수 있음.
- 해시태그(`#`)로 시작하는 일본어 토픽은 `isJapaneseShortText`가 `#` 문자를 포함하여 CJK 비율 계산이 왜곡될 수 있음.

**개선안:**

1. **해시태그 전처리**: `isJapaneseShortText` 호출 전에 선행 `#` 제거.
2. **게시물 수 패턴 확장**: 다국어 패턴 추가 (`posts`, `ポスト`, `게시물` 등).

---

## 7. 스포일러 시스템

### 7.1 구현

```css
.jp-spoiler {
  filter: blur(4px);
  cursor: pointer;
  transition: filter 0.2s;
}
.jp-spoiler.jp-revealed {
  filter: none;
}
```

```typescript
addSpoilerBehavior(el: HTMLElement): void {
  el.addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();
    el.classList.toggle('jp-revealed');
  });
}
```

### 7.2 적용 위치

| 요소 | 스포일러 적용 |
|------|------------|
| 트윗 번역 블록 | O (createInlineBlock에 spoiler: true) |
| 카드 번역 | O (jp-spoiler 클래스 직접 추가) |
| 투표 괄호 | O (createInlineBracket에 spoiler: true) |
| 트렌드 괄호 | O |
| 유저 바이오 | O |

**학습 의도**: 먼저 일본어 원문을 읽고 해석을 시도한 뒤, 클릭으로 번역을 확인하는 능동적 학습 흐름.

---

## 8. 일본어 판별 체계

### 8.1 두 가지 판별 함수

| 함수 | 대상 | 기준 |
|------|------|------|
| `isJapaneseText(element)` | 긴 텍스트 (트윗, 바이오) | `lang="ja"` 우선 → `isJapanese()` (히라가나/카타카나) |
| `isJapaneseShortText(text)` | 짧은 텍스트 (이름, 위치, 토픽) | `isJapanese()` → CJK 비율 ≥ 50% |

### 8.2 lang 속성 활용

트위터가 트윗에 `lang` 속성을 제공하므로 문자 분석 없이 언어 판별 가능:

```typescript
function isJapaneseText(element: HTMLElement): boolean {
  if (element.getAttribute('lang') === 'ja') return true;
  const langEl = element.closest('[lang="ja"]');
  if (langEl) return true;
  return isJapanese(element.innerText?.trim());
}
```

**YouTube/Webpage와의 차이**: 트위터는 `lang` 속성이 정확하므로 이를 최우선 경로로 사용. YouTube는 `containsJapaneseLike()`, Webpage는 `japaneseRatio > 0.1`을 사용.

### 8.3 CJK 비율 판별 (isJapaneseShortText)

순수 한자 이름(田中太郎)은 히라가나/카타카나가 없어 `isJapanese()`가 false를 반환한다. 그러나 트위터에서 CJK 비율이 높은 짧은 텍스트는 일본어일 가능성이 높으므로 추가 판별:

```
CJK 문자 비율 = CJK한자 수 / (전체 문자 - 공백)
비율 ≥ 0.5 (50%) → 일본어로 인정
```

**한계**: 중국어 이름도 CJK 비율이 높아 오탐 가능. 트위터의 `lang` 속성이 이름에는 제공되지 않으므로 불가피한 트레이드오프.

---

## 9. ProcessedTracker 활용

### 9.1 각 핸들러별 독립 인스턴스

```typescript
// TweetHandler
this.tracker = new ProcessedTracker(PROCESSED_ATTR, TRANSLATION_ATTR);
// UserHandler
this.tracker = new ProcessedTracker(PROCESSED_ATTR, TRANSLATION_ATTR);
// TrendHandler
this.tracker = new ProcessedTracker(PROCESSED_ATTR, TRANSLATION_ATTR);
```

세 핸들러가 같은 속성명을 사용하지만, 각각 독립된 WeakSet/WeakMap으로 추적.

### 9.2 핵심 동작

```
markProcessed(el, text?)     — WeakSet 등록 + 속성 설정 + 텍스트 기록
isProcessed(el)              — WeakSet 확인
isProcessedWithSameText(el, text)  — WeakMap의 텍스트와 비교
unmarkProcessed(el)          — WeakSet/WeakMap 제거 + 속성 제거
removeExistingTranslation(el) — 인접 번역 요소 제거
trackInjected(el)            — 삽입된 요소 배열에 추가
cleanup()                    — 모든 삽입 요소 제거 + 속성 정리
```

### 9.3 텍스트 변경 감지

트윗 "더 보기" 클릭, React 재렌더링 등으로 텍스트가 변경되는 경우:

```
processTweetText(element)
  → tracker.isProcessedWithSameText(el, text) → false (텍스트 변경됨)
  → tracker.removeExistingTranslation(element) — 이전 번역 제거
  → 새로 번역 시작
```

---

## 10. 설정 변경 대응

### 10.1 재시작 조건

```typescript
const needsRestart =
  settings.webpageMode !== prev.webpageMode ||
  settings.showFurigana !== prev.showFurigana ||
  settings.showTranslation !== prev.showTranslation ||
  settings.showRomaji !== prev.showRomaji;
```

### 10.2 재시작 플로우

```
updateSettings(settings)
  → needsRestart === true
  → stop() — 모든 번역 제거, 옵저버 해제, 호버 해제
  → new TweetHandler(settings, this.hoverTargets)  — 새 인스턴스
  → new UserHandler(settings, this.hoverTargets)
  → new TrendHandler(settings)
  → start() — 새 모드로 처음부터
```

**`hoverTargets` 초기화**: `stop()`에서 `this.hoverTargets = new WeakSet()`로 새 인스턴스 생성. 이전 WeakSet 참조는 GC 대상.

### 10.3 비재시작 변경

모드·표시 옵션 외의 변경(색상 등)은 각 핸들러와 호버 툴팁에 설정만 전파:

```
tweetHandler.updateSettings(settings)
userHandler.updateSettings(settings)
trendHandler.updateSettings(settings)
hoverTooltip?.updateSettings(settings)
```

---

## 11. 다른 핸들러와의 비교

| 특성 | Twitter | YouTube Page | Webpage |
|------|---------|-------------|---------|
| DOM 감지 | BatchedObserver (data-testid) | BatchedObserver (CSS 셀렉터) | TextDetector (범용 블록) |
| 셀렉터 안정성 | data-testid (높음) | Polymer 컴포넌트 (중간) | getComputedStyle (범용) |
| 일본어 판별 | `lang="ja"` 우선 + CJK 비율 | `containsJapaneseLike` | `japaneseRatio > 0.1` |
| 코디네이터 | TwitterHandler → 3개 핸들러 | 단일 핸들러 | 단일 핸들러 |
| 호버 인프라 | 공유 WeakSet + HoverTooltip | 자체 WeakSet + HoverTooltip | HoverPopup 래퍼 |
| 호버 debounce | 300ms | 500ms | 1000ms |
| 뷰포트 최적화 | 없음 (가상 스크롤 의존) | IntersectionObserver | IntersectionObserver |
| SPA 대응 | MutationObserver (React) | yt-navigate-finish + 재스캔 | MutationObserver만 |
| 후리가나 | createRubyClone | createStyledFuriganaBlock / createRubyClone | 텍스트 노드 직접 교체 |
| 스포일러 | 있음 (모든 번역) | 있음 (inline 모드) | 없음 |

---

## 12. 성능 고려사항

### 12.1 옵저버 비용

| 항목 | 비용 |
|------|------|
| MutationObserver 콜백 | DOM 변경 수에 비례, Set 축적만 |
| requestIdleCallback flush | 유휴 시간에 실행 |
| querySelectorAll × 9 | 노드 subtree 크기에 비례 |
| scanExisting | 초기 1회, 페이지 전체 탐색 |

### 12.2 번역 비용

| 요소 | 번역 빈도 | 크기 |
|------|----------|------|
| 트윗 본문 | 화면 진입 시 | 1-280자 |
| 유저 이름 | 호버 시 (on-demand) | 1-50자 |
| 바이오 | 프로필 진입 시 | 1-160자 |
| 트렌드 | 사이드바 렌더링 시 | 1-50자 |
| 카드 | 카드 렌더링 시 | 10-300자 |

### 12.3 최적화 적용 현황

- **배치 처리**: requestIdleCallback으로 메인 스레드 양보
- **중복 방지**: ProcessedTracker (WeakSet + WeakMap)
- **캐시 활용**: 번역 결과 캐시로 가상 스크롤 요소 재삽입 시 API 호출 방지
- **lang 속성 활용**: 문자 분석 없이 빠른 일본어 판별
- **호버 on-demand**: 이름/위치는 호버 시에만 번역 (API 호출 절약)

---

## 12.5 캐시 전략

### 캐시 키 체계

번역 결과의 캐시는 번역 공통 시스템(`src/core/cache.ts`)에서 텍스트 해시 기반으로 관리된다. `utils.ts`에 트위터 전용 캐시 키 함수가 정의되어 있으나, 현재 핸들러에서 사용하지 않는 상태:

```typescript
// utils.ts — 현재 미사용, 향후 통합 예정
getTweetCacheKey(element)   // 트윗 URL 기반
getCardCacheKey(card)       // 카드 URL 기반
textHash(text)              // 텍스트 해시
```

### 가상 스크롤 대응

트위터의 가상 스크롤은 화면 밖 요소를 DOM에서 제거하고 재생성한다. 재생성된 요소는 `PROCESSED_ATTR`이 없으므로 새 요소로 인식되어 `translator.translate(text)`가 호출되지만, 번역 공통 캐시에서 히트되어 API 호출 없이 즉시 반환된다.

### 개선 방향

1. **트윗 URL 기반 캐시 키**: `getTweetCacheKey`를 핸들러에 통합하여, 텍스트 해시 대신 트윗 URL을 캐시 키로 사용. 같은 트윗이 다른 위치(리트윗, 인용)에서 나타나도 캐시 히트.
2. **유저 정보 캐시**: 유저 핸들(@handle) 기반으로 표시이름, 바이오 번역을 캐싱하여 프로필 재방문 시 즉시 표시.

### 12.6 동시성 제어

현재 구현에는 핸들러 수준의 동시 번역 제한이 없다. 타임라인에 다수의 일본어 트윗이 동시에 로드되면, 여러 `processTweetText`가 동시에 `translator.translate(text)`를 호출한다.

**현재 완화 요소:**
- 번역 공통 시스템의 API 통신 계층에서 `maxConcurrent = 3`으로 동시 요청을 제한
- `requestIdleCallback` 배치 처리로 한 번에 처리되는 요소 수가 분산됨
- 캐시 히트로 API 호출이 줄어드는 효과

**개선 방향:**
- 뷰포트 내 요소 우선 처리 (IntersectionObserver 도입)
- 번역 큐에 우선순위 부여 (트윗 본문 > 유저 이름 > 트렌드)

---

## 13. 현재 구현의 edge case와 workaround

### 13.1 가상 스크롤 대응

트위터는 가상 스크롤로 화면 밖 요소를 DOM에서 제거하고 재생성한다. 재생성된 요소는 `PROCESSED_ATTR`이 없으므로 새 요소로 인식되어 다시 처리된다. 번역 캐시 히트 시 API 호출 없이 즉시 결과를 삽입.

### 13.2 React 하이드레이션

트위터의 React가 빈 DOM 노드를 삽입 후 텍스트를 채우는 패턴:
1. `childList` mutation: 빈 `[data-testid="tweetText"]` 감지
2. `characterData` mutation: 텍스트 채워짐 감지
3. `pendingCharDataParents`를 통해 재라우팅

### 13.3 트위터 자체 번역과의 공존

트위터의 "이 트윗 번역하기" 버튼 클릭 시 삽입되는 번역 블록과 JP Helper 번역이 동시에 표시될 수 있다. 현재 충돌 방지 로직은 없음.

### 13.4 인용 트윗 중첩

인용 트윗 내부의 `[data-testid="tweetText"]`도 동일하게 처리되므로, 원본 트윗과 인용 트윗 모두 번역된다. 특별한 중첩 처리 로직은 없으며, 각각 독립적으로 번역.

### 13.45 SPA 네비게이션 대응

트위터는 React 기반 SPA로, 페이지 전환 시 URL이 변경되지만 페이지 리로드는 발생하지 않는다.

**현재 대응**: MutationObserver가 DOM 변경을 감지하므로, 새 페이지의 콘텐츠가 렌더링되면 자동으로 라우팅된다. `pushState`/`popstate` 이벤트를 별도로 감지하지 않는다.

**이것이 충분한 이유**: 트위터의 React가 페이지 전환 시 기존 DOM을 제거하고 새 DOM을 삽입하므로, `childList` mutation이 발생한다. 또한 가상 스크롤로 인한 요소 재생성도 MutationObserver가 감지한다. YouTube처럼 Polymer 데이터 바인딩으로 텍스트만 교체하는 패턴이 없으므로, `characterData`는 하이드레이션 보조에만 사용된다.

### 13.5 cleanup 시 전역 셀렉터 사용

```typescript
// TweetHandler.cleanup()
document.querySelectorAll('.jp-twitter-hover-target').forEach(el => {
  el.classList.remove('jp-twitter-hover-target');
  el.removeAttribute('data-jp-hover-text');
});

// UserHandler.cleanup()
document.querySelectorAll('[data-jp-hover]').forEach(el => {
  el.removeAttribute('data-jp-hover');
});
```

전체 document에서 셀렉터로 검색하여 정리. 대규모 DOM에서 비용이 있지만, cleanup은 설정 변경 시에만 발생하므로 허용 범위.
