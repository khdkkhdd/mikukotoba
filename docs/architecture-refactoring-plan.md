# JP Helper — 확장 가능한 사이트 핸들러 아키텍처 리팩토링

## Context

현재 jp-helper는 Twitter, YouTube(자막), 일반 웹페이지 세 가지 사이트 핸들러를 갖고 있으나, 공통 인터페이스 없이 각각 독립적으로 구현되어 있다. `content/index.ts`가 `if/else` 체인으로 사이트를 분기하고, 핸들러 간에 ~500줄 이상의 중복 코드가 존재한다. YouTube 페이지 텍스트 번역 등 새 핸들러를 추가하려면 매번 같은 보일러플레이트를 복제해야 하는 구조다.

이 리팩토링의 목표:
1. **공통 인터페이스** 정의로 핸들러 추가 비용 최소화
2. **중복 코드 제거** — 공유 컴포넌트 추출
3. **YouTube 페이지 번역**을 새 아키텍처의 첫 번째 활용 사례로 구현

---

## 현재 아키텍처 문제점

### 핸들러 간 인터페이스 불일치

| 핸들러 | 구조 | 라이프사이클 |
|---|---|---|
| **Twitter** | `TwitterHandler` 클래스 (sub-handler 3개 조합) | `start()` / `stop()` / `updateSettings()` — **가장 잘 설계됨** |
| **YouTube** | 느슨한 컴포넌트 3개 (VideoObserver, SubtitleExtractor, SubtitleOverlay) | `content/index.ts`에서 절차적으로 조합 |
| **Webpage** | 대안적 모드 3개 (HoverPopup, InlineTranslator, FuriganaInjector) | `content/index.ts`에서 `switch`로 분기 |

### 중복 코드 맵 (~500줄+)

| 중복 | 규모 | 위치 |
|---|---|---|
| **호버 팝업** | ~250줄 | `twitter/user-handler.ts` (59-456) ↔ `webpage/hover-popup.ts` (1-275) |
| **인라인 번역 블록** | ~80줄 x3 | `tweet-handler.ts`, `user-handler.ts`, `inline-translator.ts` |
| **배치 MutationObserver** | ~70줄 x2 | `twitter/observer.ts` ↔ `webpage/text-detector.ts` |
| **처리 상태 추적** | ~30줄 x6 | 6개 핸들러 모두 `WeakSet + WeakMap + injectedElements[]` |
| **escapeHtml** | 3곳 | `dom-utils.ts`, `subtitle-overlay.ts:esc()`, `reading-converter.ts` |
| **isJapanese** | 2곳 | `dom-utils.ts` (kana만), `subtitle-extractor.ts:490` (kana+CJK) |
| **스포일러 패턴** | 3곳 | `tweet-handler`, `user-handler`, `trend-handler` |

### 기타 문제

- `content/index.ts`가 하드코딩된 `if/else` 체인
- `overlay-styles.css`에 공유 + Twitter 전용 CSS 혼합
- `text-detector.ts`, `hover-popup.ts`에 Twitter 전용 셀렉터 오염 (`data-testid="tweetText"`)
- `UserSettings`가 flat 구조 — 사이트별 설정 네임스페이스 없음

---

## Phase 1: 공유 유틸리티 추출 (동작 변경 없음)

기존 핸들러를 수정하지 않고, 새 공유 모듈만 생성한다.

### 1-1. SiteHandler 인터페이스 + HandlerRegistry

**파일**: `src/content/handlers/types.ts`, `src/content/handlers/registry.ts`

```typescript
// src/content/handlers/types.ts
export interface SiteHandler {
  readonly id: string;           // 'twitter', 'youtube-subtitle', 'youtube-page', 'webpage'
  readonly name: string;         // 로그용 이름
  readonly priority?: number;    // 높을수록 먼저 초기화 (기본 0)
  readonly requiresJapaneseContent?: boolean;  // true면 일본어 감지 후 시작

  matches(url: URL): boolean;
  setStatusIndicator(indicator: StatusIndicator): void;
  start(): void | Promise<void>;
  stop(): void;
  updateSettings(settings: UserSettings): void;
}
```

```typescript
// src/content/handlers/registry.ts
export class HandlerRegistry {
  private handlers: SiteHandler[] = [];
  register(handler: SiteHandler): void;
  getMatchingHandlers(url: URL): SiteHandler[];  // priority 내림차순 정렬
  getById(id: string): SiteHandler | undefined;
}
export const handlerRegistry = new HandlerRegistry();
```

**설계 결정**:
- `matches(url)` — `URL` 객체를 받아 hostname, pathname, search 등으로 매칭
- `priority` — 같은 사이트에 여러 핸들러 허용 (YouTube: subtitle + page)
- `requiresJapaneseContent` — 일반 웹페이지 핸들러의 lazy 초기화 지원
- 명시적 등록 방식 (자동 등록 대신) — 트리 셰이킹에 유리, 디버깅 용이

### 1-2. ProcessedTracker

**파일**: `src/content/shared/processed-tracker.ts`

6개 핸들러에서 반복되는 `WeakSet + WeakMap + injectedElements[]` 패턴 통합.

```typescript
export class ProcessedTracker {
  constructor(processedAttr?: string, translationAttr?: string);

  isProcessed(el: HTMLElement): boolean;
  isProcessedWithSameText(el: HTMLElement, text: string): boolean;
  markProcessed(el: HTMLElement, text?: string): void;
  unmarkProcessed(el: HTMLElement): void;  // 에러 시 재시도 허용
  trackInjected(el: HTMLElement): void;
  removeExistingTranslation(el: HTMLElement): void;
  cleanup(): void;  // 모든 injected 제거 + WeakSet/WeakMap 리셋
}
```

**추출 원본**:
- `twitter/tweet-handler.ts` (lines 30-31, 273-288)
- `twitter/user-handler.ts` (line 32)
- `twitter/trend-handler.ts` (line 23)
- `webpage/text-detector.ts` (lines 29-33)
- `webpage/inline-translator.ts` (line 14)

**핸들러별 네임스페이스**: 각 핸들러가 고유 data attribute 사용 (`data-jp-twitter-processed`, `data-jp-yt-processed`, `data-jp-wp-processed`) → 같은 페이지에서 핸들러 간 간섭 방지.

### 1-3. BatchedObserver

**파일**: `src/content/shared/batched-observer.ts`

TwitterObserver와 TextDetector에서 반복되는 배치 MutationObserver 패턴 통합.

```typescript
export interface SelectorRoute {
  selector: string;
  callback: (element: HTMLElement) => void;
}

export class BatchedObserver {
  constructor(routes: SelectorRoute[], options: {
    logNamespace: string;
    characterData?: boolean;
    characterDataSelectors?: string[];
    shouldSkip?: (el: HTMLElement) => boolean;
    scanExisting?: boolean;
  });

  start(): void;   // document.body에 MutationObserver 연결
  stop(): void;
  addRoute(route: SelectorRoute): void;  // 동적 라우트 추가
}
```

내부 구현:
- `pendingNodes: Set<HTMLElement>` + `pendingCharDataParents: Set<HTMLElement>`
- `requestIdleCallback` 배치 플러시
- 셀렉터 매칭 → 콜백 라우팅

**추출 원본**: `twitter/observer.ts` (lines 30-195), `webpage/text-detector.ts` (lines 35-162)

**설계 결정**: 상속이 아닌 합성(composition) — 핸들러가 `BatchedObserver` 인스턴스를 생성하고 라우트를 전달. 핸들러에 따라 옵저버가 필요 없을 수도 있고 (YouTube subtitle은 전용 옵저버 사용), 여러 개가 필요할 수도 있음.

### 1-4. 공유 렌더러

#### createInlineBlock()

**파일**: `src/content/shared/renderers/inline-block.ts`

```typescript
export interface InlineBlockOptions {
  className?: string;         // 컨테이너 CSS 클래스
  translationAttr?: string;   // 식별용 data attribute
  compact?: boolean;          // 소형 패딩
  spoiler?: boolean;          // 한국어 블러 처리
  classPrefix?: string;       // 자식 요소 클래스 프리픽스
}

export function createInlineBlock(
  result: TranslationResult,
  settings: UserSettings,
  opts?: InlineBlockOptions
): HTMLDivElement;
```

furigana + romaji + korean div를 생성해 반환. 호출자가 DOM 삽입 담당.

**추출 원본**:
- `twitter/tweet-handler.ts` `insertInlineBlock()` (lines 169-210)
- `twitter/user-handler.ts` `insertBioTranslation()` (lines 348-388)
- `webpage/inline-translator.ts` `processBlock()` (lines 44-92)

#### createInlineBracket()

**파일**: `src/content/shared/renderers/inline-bracket.ts`

```typescript
export function createInlineBracket(
  result: TranslationResult,
  settings: UserSettings,
  opts?: { translationAttr?, className?, spoiler? }
): HTMLSpanElement;
```

`(한국어번역)` 형태의 span 반환.

**추출 원본**: `twitter/trend-handler.ts` (lines 56-76), `twitter/tweet-handler.ts` `processPollOption()` (lines 144-164)

#### HoverTooltip 클래스

**파일**: `src/content/shared/renderers/hover-tooltip.ts`

```typescript
export interface HoverTooltipOptions {
  popupId: string;
  debounceMs?: number;        // Twitter: 300ms, Webpage: 1000ms
  escapeToClose?: boolean;
  targetStrategy: 'registered' | 'auto-detect';
}

export class HoverTooltip {
  constructor(
    settings: UserSettings,
    options: HoverTooltipOptions,
    onTranslate: (text: string) => Promise<TranslationResult>
  );

  mount(): void;
  unmount(): void;
  updateSettings(settings: UserSettings): void;
  registerTarget(el: HTMLElement): void;  // 'registered' 전략 시 사용
}
```

Shadow DOM 팝업 + 디바운스 mousemove + 포지셔닝 로직 통합.

**추출 원본**: `twitter/user-handler.ts` (lines 59-456), `webpage/hover-popup.ts` (lines 1-275)

**차이점 흡수**:
- `debounceMs`: Twitter 300ms ↔ Webpage 1000ms → 파라미터화
- `targetStrategy`: Twitter는 등록된 타겟만 ↔ Webpage는 자동 감지 → 전략 패턴
- `escapeToClose`: Webpage에만 있음 → 옵션

### 1-5. 중복 함수 통합

| 대상 | 현재 | 변경 |
|---|---|---|
| `escapeHtml` | `dom-utils.ts`, `subtitle-overlay.ts:esc()`, `reading-converter.ts` | `dom-utils.ts`만 유지, 나머지 import |
| `isJapanese` | `dom-utils.ts` (kana만), `subtitle-extractor.ts:490` (kana+CJK) | `dom-utils.ts`에 CJK 범위 추가, 로컬 버전 삭제 |

---

## Phase 2: 기존 핸들러를 SiteHandler로 래핑

내부 로직 변경 없이 인터페이스만 맞춘다.

### 2-1. TwitterSiteHandler

**파일**: `src/content/twitter/index.ts` 수정

기존 `TwitterHandler`가 이미 `start()/stop()/updateSettings()/setStatusIndicator()` 보유.
`SiteHandler` 인터페이스 구현만 추가:

```typescript
export class TwitterHandler implements SiteHandler {
  readonly id = 'twitter';
  readonly name = 'Twitter/X';
  readonly priority = 10;

  matches(url: URL): boolean {
    return url.hostname === 'x.com' || url.hostname === 'twitter.com';
  }
  // 나머지 메서드는 기존 그대로
}
```

### 2-2. YouTubeSubtitleHandler

**파일**: `src/content/youtube/subtitle-handler.ts` (신규)

`content/index.ts`의 `initYouTubeMode()`, `handleSubtitle()`, `startPrefetch()` 로직을 이 클래스로 이동.

```typescript
export class YouTubeSubtitleHandler implements SiteHandler {
  readonly id = 'youtube-subtitle';
  readonly name = 'YouTube Subtitle';
  readonly priority = 10;

  matches(url: URL): boolean {
    return url.hostname.includes('youtube.com');
  }
  // VideoObserver, SubtitleExtractor, SubtitleOverlay 조합
}
```

### 2-3. WebpageSiteHandler

**파일**: `src/content/webpage/index.ts` (신규)

`content/index.ts`의 `initWebpageMode()`, `initHoverMode()` 등 로직을 이 클래스로 이동.

```typescript
export class WebpageSiteHandler implements SiteHandler {
  readonly id = 'webpage';
  readonly name = 'Generic Webpage';
  readonly priority = 0;  // 최저 우선순위
  readonly requiresJapaneseContent = true;  // 일본어 감지 후 시작

  matches(url: URL): boolean {
    return true;  // 모든 사이트에 매칭 (다른 핸들러와 공존 가능)
  }
}
```

### 2-4. content/index.ts 리팩토링

if/else 체인 제거, 레지스트리 기반으로 변경:

```typescript
import { handlerRegistry } from './handlers/registry';
import { TwitterHandler } from './twitter';
import { YouTubeSubtitleHandler } from './youtube/subtitle-handler';
import { WebpageSiteHandler } from './webpage';

// 핸들러 등록 — 한 곳에서 관리
handlerRegistry.register(new TwitterHandler());
handlerRegistry.register(new YouTubeSubtitleHandler());
handlerRegistry.register(new WebpageSiteHandler());
// 향후: handlerRegistry.register(new YouTubePageHandler());

async function init() {
  const url = new URL(location.href);
  const matching = handlerRegistry.getMatchingHandlers(url);
  const eager = matching.filter(h => !h.requiresJapaneseContent);
  const lazy = matching.filter(h => h.requiresJapaneseContent);

  if (eager.length > 0) {
    await initTranslator();
    for (const h of eager) {
      h.setStatusIndicator(statusIndicator);
      h.updateSettings(settings);
      await h.start();
      activeHandlers.push(h);
    }
  }

  // lazy 핸들러는 일본어 감지 후 시작 (기존 startLazyWatcher 패턴)
  if (lazy.length > 0 && !TextDetector.hasJapaneseContent()) {
    startLazyWatcher(lazy);
  } else if (lazy.length > 0) {
    // 이미 일본어 콘텐츠 존재
    for (const h of lazy) { /* 초기화 */ }
  }
}

// 설정 변경: 모든 활성 핸들러에 일괄 전파
activeHandlers.forEach(h => h.updateSettings(settings));

// 정리: 모든 활성 핸들러 중지
function cleanupAll() {
  activeHandlers.forEach(h => h.stop());
  activeHandlers = [];
  statusIndicator.unmount();
}
```

---

## Phase 3: 핸들러 내부를 공유 컴포넌트로 마이그레이션

위험도 낮은 순서대로 하나씩 진행. **각 단계마다 해당 핸들러 동작 검증**.

| 순서 | 대상 | 변경 내용 |
|---|---|---|
| 1 | `TrendHandler` | `WeakSet` → `ProcessedTracker`, 인라인 괄호 → `createInlineBracket()` |
| 2 | `TweetHandler` | `insertInlineBlock()` → `createInlineBlock()`, `processedElements` → `ProcessedTracker` |
| 3 | `UserHandler` | `insertBioTranslation()` → `createInlineBlock()`, hover popup → `HoverTooltip` |
| 4 | `InlineTranslator` | 번역 블록 → `createInlineBlock()`, processed → `ProcessedTracker` |
| 5 | `TextDetector` | 배치 로직 → `BatchedObserver`, Twitter 셀렉터 제거 |
| 6 | `HoverPopup` | `HoverTooltip` 래퍼로 교체 |
| 7 | `SubtitleOverlay` | `esc()` → `escapeHtml()` import |
| 8 | `TwitterObserver` | `BatchedObserver` 활용 (위임 또는 상속) |

---

## Phase 4: YouTube 페이지 번역 핸들러 추가

새 아키텍처의 첫 활용 사례. 공유 컴포넌트를 조합해 ~120줄로 핸들러 구현.

### 4-1. YouTubePageHandler

**파일**: `src/content/youtube/page-handler.ts` (신규)

```typescript
export class YouTubePageHandler implements SiteHandler {
  readonly id = 'youtube-page';
  readonly name = 'YouTube Page Translation';
  readonly priority = 5;  // subtitle(10)보다 낮음

  matches(url: URL): boolean {
    return url.hostname.includes('youtube.com');
  }
  // BatchedObserver + ProcessedTracker + createInlineBlock / HoverTooltip 조합
}
```

### YouTube 셀렉터

**파일**: `src/content/youtube/utils.ts` (신규)

```typescript
export const YT_SELECTORS = {
  VIDEO_TITLE: 'ytd-watch-metadata h1 yt-formatted-string',
  DESCRIPTION: 'ytd-text-inline-expander #structured-description',
  COMMENT_TEXT: '#content-text.ytd-comment-renderer',
  COMMENT_AUTHOR: '#author-text yt-formatted-string',
  CHANNEL_NAME: '#channel-name yt-formatted-string a',
  FEED_VIDEO_TITLE: 'ytd-rich-grid-media #video-title-link yt-formatted-string',
  SEARCH_VIDEO_TITLE: 'ytd-video-renderer #video-title yt-formatted-string',
  COMPACT_VIDEO_TITLE: 'ytd-compact-video-renderer #video-title',
  COMMUNITY_POST: 'ytd-backstage-post-thread-renderer #content-text',
  HASHTAG: 'ytd-watch-metadata #super-title a',
} as const;
```

### 번역 대상 요소별 표시 방식

| 요소 | 셀렉터 | 방식 | 서브 Phase |
|---|---|---|---|
| 시청 페이지 영상 제목 | `VIDEO_TITLE` | 인라인 블록 (A) | 4-1 |
| 영상 설명 (펼침 시) | `DESCRIPTION` | 인라인 블록 (A) | 4-1 |
| 댓글 본문 | `COMMENT_TEXT` | 인라인 블록 (A) | 4-1 |
| 답글 | `#replies` 내 `COMMENT_TEXT` | 인라인 블록 (A) | 4-1 |
| 해시태그 | `HASHTAG` | 인라인 괄호 (C) | 4-2 |
| 채널명 | `CHANNEL_NAME` | 호버 툴팁 (B) | 4-2 |
| 홈/구독 피드 제목 | `FEED_VIDEO_TITLE` | 호버 툴팁 (B) | 4-2 |
| 검색 결과 제목 | `SEARCH_VIDEO_TITLE` | 인라인 블록 (A) | 4-2 |
| 추천 영상 제목 | `COMPACT_VIDEO_TITLE` | 호버 툴팁 (B) | 4-2 |
| 커뮤니티 게시글 | `COMMUNITY_POST` | 인라인 블록 (A) | 4-2 |

### 4-2. YouTube 다크/라이트 모드 CSS

**파일**: `src/content/youtube/youtube-page.css`

```css
.jp-yt-translation { color: #555; border-top: 1px solid rgba(0,0,0,0.1); }
html[dark] .jp-yt-translation { color: #aaa; border-top-color: rgba(255,255,255,0.1); }
```

### 4-3. IntersectionObserver 뷰포트 최적화

피드 카드(홈, 검색, 구독)는 뷰포트 진입 시에만 번역 트리거.
`rootMargin: '200px'`으로 미리 로딩. API 비용 절약.

### 4-4. SPA 네비게이션 대응

- `yt-navigate-finish` 이벤트 리스닝 (YouTube 커스텀 이벤트)
- 기존 `VideoObserver` URL 폴링과 연동
- 페이지 전환 시 `ProcessedTracker.cleanup()` 후 재스캔

---

## Phase 5: 설정 구조 확장 + CSS 분리

### 5-1. Per-site 설정 추가

`src/types/index.ts`에 추가:

```typescript
export interface UserSettings {
  // ... 기존 필드 유지 (하위 호환) ...
  siteSettings: {
    twitter: { enabled: boolean };
    youtube: {
      subtitleMode: boolean;        // 기존 youtubeMode
      pageTranslation: boolean;     // 신규
    };
    webpage: { mode: WebpageMode }; // 기존 webpageMode 이동
  };
}
```

기존 `youtubeMode`, `webpageMode` 필드는 유지하되, `loadSettingsFromStorage()`에서 새 구조로 정규화하는 마이그레이션 함수 추가 → 하위 호환성 보장.

### 5-2. CSS 분리

| 현재 | 변경 후 |
|---|---|
| `overlay-styles.css` (공유+Twitter 혼합) | `overlay-styles.css` (공유만: spoiler, furigana line-height) |
| — | `twitter/twitter.css` (`.jp-twitter-*` 전체 이동) |
| — | `youtube/youtube-page.css` (YouTube 페이지 전용) |
| — | `webpage/webpage.css` (웹페이지 전용) |

---

## 최종 파일 구조

```
src/content/
  index.ts                              # 리팩토링: 레지스트리 기반 핸들러 오케스트레이션
  handlers/
    types.ts                            # SiteHandler 인터페이스
    registry.ts                         # HandlerRegistry
  shared/
    dom-utils.ts                        # 기존 (escapeHtml, isJapanese 통합)
    status-indicator.ts                 # 기존 유지
    batched-observer.ts                 # 신규: 배치 MutationObserver
    processed-tracker.ts                # 신규: 처리 상태 추적
    overlay-styles.css                  # 공유 스타일만 (spoiler, base)
    renderers/
      inline-block.ts                   # 신규: createInlineBlock()
      inline-bracket.ts                 # 신규: createInlineBracket()
      hover-tooltip.ts                  # 신규: HoverTooltip 클래스
  twitter/
    index.ts                            # SiteHandler 구현으로 수정
    observer.ts                         # BatchedObserver 활용으로 리팩토링
    tweet-handler.ts                    # 공유 렌더러 사용으로 리팩토링
    user-handler.ts                     # HoverTooltip + createInlineBlock 사용
    trend-handler.ts                    # createInlineBracket 사용
    utils.ts                            # 기존 유지
    twitter.css                         # 신규: overlay-styles.css에서 분리
  youtube/
    subtitle-handler.ts                 # 신규: 기존 자막 컴포넌트 SiteHandler 래핑
    page-handler.ts                     # 신규: 페이지 텍스트 번역
    video-observer.ts                   # 기존 유지
    subtitle-extractor.ts              # isJapanese import 수정만
    subtitle-overlay.ts                # escapeHtml import 수정만
    caption-bridge.ts                   # 기존 유지
    utils.ts                            # 신규: YouTube 셀렉터 상수
    youtube-page.css                    # 신규: 페이지 번역 스타일
  webpage/
    index.ts                            # 신규: WebpageSiteHandler
    text-detector.ts                    # Twitter 셀렉터 제거, BatchedObserver 활용
    hover-popup.ts                      # HoverTooltip 래퍼로 축소
    inline-translator.ts               # 공유 렌더러 사용
    furigana-injector.ts               # ProcessedTracker 사용
    webpage.css                         # 신규: 웹페이지 전용 스타일
```

---

## 새 사이트 핸들러 추가 절차 (이 아키텍처 적용 후)

예: Pixiv, NicoNico 등 추가 시

1. `src/content/pixiv/` 디렉토리 생성
2. `SiteHandler` 구현 클래스 작성 — `matches()`, `start()`, `stop()` 등
3. `BatchedObserver` + 사이트 전용 셀렉터로 DOM 감지
4. `ProcessedTracker` 로 상태 관리
5. `createInlineBlock()` / `HoverTooltip` / `createInlineBracket()` 조합으로 렌더링
6. `content/index.ts`에 한 줄 추가: `handlerRegistry.register(new PixivHandler())`
7. (선택) `siteSettings.pixiv` 추가

**예상 보일러플레이트**: ~50줄 (인터페이스 구현 + matches)
**사이트 고유 로직만 작성**: 셀렉터 정의 + 요소별 표시 방식 결정

---

## 검증 방법

각 Phase 완료 시:

1. **Twitter** (`x.com`): 트윗 번역(인라인), 유저명 호버 툴팁, 트렌드 인라인 괄호 동작 확인
2. **YouTube 자막** (`youtube.com/watch`): 자막 오버레이 표시, 후리가나/로마지/한국어 확인
3. **YouTube 페이지** (Phase 4 이후): 영상 제목, 설명, 댓글 번역 확인, 다크모드 대응
4. **일반 웹페이지**: 호버/인라인/후리가나 3가지 모드 동작 확인
5. **설정 변경**: 팝업에서 토글 시 모든 활성 핸들러에 전파되는지 확인
6. **Extension 빌드**: `npm run build` 성공, dist 출력 확인

---

## 관련 문서

- [Twitter 번역 상세 계획](./twitter-translation-plan.md)
- [YouTube 번역 상세 계획](./youtube-translation-plan.md)
- [YouTube 번역 요약](./youtube-translation-summary.md)
