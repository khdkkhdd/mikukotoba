# YouTube 번역 기능 기술 명세

> YouTube 자막 번역(SubtitleHandler)과 페이지 텍스트 번역(PageHandler)의 기술적 설계.
> 현재 구현 분석을 기반으로 하되, 개선된 아키텍처를 목표로 한다.

---

## 1. 전체 아키텍처

### 1.1 두 핸들러 구조

YouTube에는 독립된 두 개의 SiteHandler가 등록된다:

| 핸들러 | id | priority | 활성화 조건 | 역할 |
|--------|-----|----------|------------|------|
| `YouTubeSubtitleHandler` | `youtube-subtitle` | `10` | `settings.youtubeMode === true` | 비디오 자막 인터셉트 + 오버레이 |
| `YouTubePageHandler` | `youtube-page` | `5` | `settings.webpageMode !== 'off'` | 페이지 텍스트(제목, 댓글, 설명 등) 번역 |

두 핸들러는 `matches(url)`이 모두 `youtube.com`을 반환하므로 동시에 활성화된다. 서로 독립적으로 동작하며 상태를 공유하지 않는다.

### 1.2 모듈 구조

```
src/content/youtube/
├── subtitle-handler.ts    # YouTubeSubtitleHandler (SiteHandler)
├── subtitle-extractor.ts  # 자막 추출 엔진 (3가지 전략)
├── subtitle-overlay.ts    # Shadow DOM 오버레이 UI
├── video-observer.ts      # 비디오 변경 감지 (URL 폴링 + MutationObserver)
├── caption-bridge.ts      # MAIN world 브릿지 (YouTube Player API 접근)
├── page-handler.ts        # YouTubePageHandler (SiteHandler)
├── utils.ts               # 셀렉터 정의, 속성 상수, 타입
└── youtube-page.css       # 페이지 번역 스타일
```

### 1.3 WebpageSiteHandler와의 역할 분리

YouTube 도메인에서 `WebpageSiteHandler.matches()`는 `false`를 반환한다. YouTube의 모든 텍스트 번역은 `YouTubePageHandler`가 전담하며, YouTube에 최적화된 셀렉터 기반 라우팅을 사용한다.

---

## 2. 자막 번역 (YouTubeSubtitleHandler)

### 2.1 컴포지션 구조

SubtitleHandler는 세 개의 전문 모듈을 조합한다:

```
YouTubeSubtitleHandler
  ├── VideoObserver       → 비디오 변경 감지
  ├── SubtitleExtractor   → 자막 데이터 추출
  └── SubtitleOverlay     → 번역 결과 오버레이 표시
```

### 2.2 생명주기

```
start()
  → VideoObserver.start()
  → [비디오 감지 대기]

VideoObserver.onVideoChange(meta)
  → translator.clearContext()
  → translator.setMetadata({ title, channel })
  → SubtitleOverlay.hide()
  → SubtitleExtractor 생성 + start(videoId)
  → SubtitleOverlay.mount()
  → startPrefetch()

SubtitleExtractor.onSubtitle(entry)
  → translator.translate(entry.text)
  → SubtitleOverlay.show(result)

stop()
  → VideoObserver.stop()
  → SubtitleExtractor.stop()
  → SubtitleOverlay.unmount()
  → prefetchInterval 해제
```

### 2.3 설정 변경 대응

`updateSettings()`는 `SubtitleOverlay`에만 설정을 전파한다. 모드 변경이 아닌 색상/크기 변경은 오버레이 스타일만 갱신하면 되므로 재시작 불필요.

---

## 3. 비디오 변경 감지 (VideoObserver)

### 3.1 감지 메커니즘

세 가지 방법을 병행하여 비디오 전환을 감지한다:

| 방법 | 메커니즘 | 역할 |
|------|---------|------|
| `yt-navigate-finish` 이벤트 | YouTube SPA 네비게이션 완료 시 발화 | 주요 감지 수단, 즉시 `checkUrlChange()` 호출 |
| URL 폴링 | `setInterval(5000ms)` | 이벤트 미발화 대비 보조 (자동재생, 플레이리스트 등) |
| MutationObserver | `document.body` childList + subtree | DOM 변경 시 `checkUrlChange()` 호출 (추가 보조) |

### 3.2 메타데이터 추출

비디오 ID 변경 감지 후 500ms 지연 뒤 메타데이터를 추출한다 (YouTube가 DOM을 갱신할 시간 확보):

```
extractMetadata(videoId)
  → 제목: 'h1.ytd-watch-metadata yt-formatted-string' 또는 document.title
  → 채널: '#channel-name yt-formatted-string a'
  → { videoId, title, channel } 반환
```

메타데이터는 `translator.setMetadata()`에 전달되어 LLM 번역 시 영상 맥락 참조에 사용된다.

### 3.3 남은 개선 방향

- **MutationObserver 범위 축소**: 비디오 플레이어 컨테이너만 감시하도록 대상 축소 (현재 body 전체).

---

## 4. 자막 추출 (SubtitleExtractor)

### 4.1 세 가지 추출 전략

SubtitleExtractor는 우선순위 순서대로 시도하여, 성공하는 첫 번째 방법을 채택한다:

```
start(videoId)
  → [1] tryTextTrack()      → 성공 시 'texttrack' 채택
  → [2] enableCaptions('ja') + tryTextTrack()  → 성공 시 'texttrack' 채택
  → [3] tryTimedText(videoId) → 성공 시 'timedtext' 채택
  → [4] tryDomCapture()      → 항상 'dom' 채택 (최후 수단)
```

### 4.2 전략 1: HTML5 TextTrack API

**원리**: `<video>` 요소의 `textTracks` 속성에서 일본어 트랙을 찾아 `cuechange` 이벤트를 리스닝.

**플로우:**
```
document.querySelector('video').textTracks
  → language === 'ja' || 'ja-JP' 트랙 탐색
  → cues가 로드되어 있는지 확인 (null이면 실패)
  → track.mode = 'hidden' (YouTube 기본 자막 숨김, 데이터는 수신)
  → 'cuechange' 이벤트 리스너 등록
  → activeCues[0].text → HTML 태그 제거 → onSubtitle() 콜백
```

**자동 캡션 활성화**: 사용자가 자막을 켜지 않은 경우, MAIN world 브릿지를 통해 프로그래밍적으로 캡션을 활성화한다:

```
enableCaptions('ja')
  → CustomEvent 'mikukotoba-enable-captions' 디스패치
  → caption-bridge.ts: player.loadModule('captions')
  → player.setOption('captions', 'track', jaTrack)
  → 1500ms 대기 (YouTube가 TextTrack 데이터 로드)
  → tryTextTrack() 재시도
```

### 4.3 전략 2: YouTube TimedText API

**원리**: YouTube의 캡션 트랙 메타데이터에서 baseUrl을 추출하여 JSON3 형식으로 전체 자막 데이터를 다운로드.

**캡션 트랙 추출 경로:**
```
[1] MAIN world 브릿지 → player.getPlayerResponse().captions.captionTracks
[2] 브릿지 타임아웃(500ms) → HTML 파싱: ytInitialPlayerResponse에서 captionTracks 추출
```

**자막 선택 우선순위**: 수동 일본어 > ASR 일본어

**데이터 가져오기:**
```
bridgeFetch(url)
  → MAIN world 브릿지에 'mikukotoba-fetch-url' 이벤트 전송
  → 브릿지: 동일 출처 fetch → 'mikukotoba-fetch-response'로 응답
  → 타임아웃(3000ms) → 직접 fetch 시도 (CORS 제한 가능)
```

**데이터 재생:**
```
TimedText JSON → timedTextEntries[] 파싱
  { start: tStartMs/1000, duration: dDurationMs/1000, text }
→ video 'timeupdate' 이벤트 리스닝
→ currentTime에 해당하는 entry 찾기
→ text가 변경되면 onSubtitle() 콜백
→ entry 없으면 onClear() 콜백
```

**직접 API 폴백**: 캡션 트랙 메타데이터 추출 실패 시, 공개 API URL로 직접 시도:
- `https://www.youtube.com/api/timedtext?v={id}&lang=ja&fmt=json3`
- `https://www.youtube.com/api/timedtext?v={id}&lang=ja&kind=asr&fmt=json3`

### 4.4 전략 3: DOM 기반 캡처 (폴백)

**원리**: YouTube의 캡션 렌더링 DOM(`.ytp-caption-segment`)을 MutationObserver로 감시.

```
MutationObserver (childList + subtree + characterData)
  → target: '.ytp-caption-window-container' 또는 '.html5-video-player'
  → querySelectorAll('.ytp-caption-segment')
  → segments 텍스트 결합 → containsJapaneseLike() 확인
  → 이전 텍스트와 다르면 onSubtitle() 콜백
```

**한계**: 타이밍 정보(start, duration) 없이 `video.currentTime`으로 추정. 프리페치 불가.

### 4.5 프리페치 메커니즘

TimedText 방식에서만 동작. 2초 간격으로 현재 시간 이후의 자막 3개를 미리 번역 요청:

```
setInterval(2000ms)
  → subtitleExtractor.getPrefetchEntries(video.currentTime, 3)
  → 각 entry: translator.translate(entry.text).catch(() => {})
```

`.catch(() => {})`: 프리페치 실패는 무시. 실제 자막 표시 시 캐시 미스이면 그때 번역.

### 4.6 개선 방향

**현재 한계:**
- TextTrack 방식에서 cues가 null인 경우(로드 지연) 바로 실패 판정. 재시도 없음.
- DOM 캡처 방식은 타이밍 정보가 부정확하고 프리페치 불가.
- enableCaptions의 1500ms 고정 대기는 네트워크 상태에 따라 부족할 수 있음.
- 프리페치가 TextTrack 방식에서는 동작하지 않음 (cuechange 이벤트 기반이라 미래 자막 목록에 접근 불가).

**개선안:**

1. **TextTrack cue 로딩 대기**: cues가 null일 때 즉시 실패 대신, `oncuechange` 또는 폴링으로 cue 로딩 완료를 대기(최대 3초).

2. **적응형 캡션 활성화 대기**: 1500ms 고정 대신, TextTrack의 cues 프로퍼티를 100ms 간격으로 폴링하여 로드 완료 즉시 진행.

3. **TextTrack 프리페치 지원**: TextTrack의 `cues` 배열에 전체 자막이 포함되어 있으므로, `video.currentTime` 이후의 cue를 직접 조회하여 프리페치 가능.

---

## 5. MAIN World 브릿지 (caption-bridge.ts)

### 5.1 필요성

Chrome Extension의 content script는 isolated world에서 실행되어 페이지의 JavaScript 변수에 접근 불가. YouTube Player API(`movie_player.getPlayerResponse()` 등)는 MAIN world에서만 접근 가능.

### 5.2 통신 프로토콜

Content script ↔ MAIN world 간 `CustomEvent`로 통신:

| 이벤트 | 방향 | 용도 |
|--------|------|------|
| `mikukotoba-get-tracks` | Content → MAIN | 캡션 트랙 목록 요청 |
| `mikukotoba-tracks-response` | MAIN → Content | 캡션 트랙 목록 응답 (JSON) |
| `mikukotoba-enable-captions` | Content → MAIN | 캡션 활성화 요청 (lang 전달) |
| `mikukotoba-captions-enabled` | MAIN → Content | 활성화 결과 ({success, info}) |
| `mikukotoba-fetch-url` | Content → MAIN | URL 가져오기 요청 ({url, id}) |
| `mikukotoba-fetch-response` | MAIN → Content | 가져오기 결과 ({id, status, text}) |

### 5.3 캡션 트랙 추출 로직

```
mikukotoba-get-tracks 수신
  → [1] player.getPlayerResponse().captions.captionTracks
  → [2] 실패 시: window.ytInitialPlayerResponse.captions.captionTracks
  → tracks 배열 JSON 직렬화하여 응답
```

### 5.4 캡션 활성화 로직

```
mikukotoba-enable-captions 수신 (lang='ja')
  → player.loadModule('captions')           // 캡션 모듈 로드
  → player.getOption('captions', 'tracklist') // 사용 가능 트랙 조회
  → manual ja 트랙 우선, 없으면 asr ja 트랙
  → player.setOption('captions', 'track', track) // 캡션 활성화
```

### 5.5 동일 출처 fetch 프록시

TimedText API URL에는 서명(sig) 파라미터가 포함되어 있어, Content script에서의 CORS 요청이 차단될 수 있다. MAIN world에서는 YouTube와 동일 출처이므로 fetch가 가능하다.

```
mikukotoba-fetch-url 수신 ({url, id})
  → fetch(url)
  → 결과를 mikukotoba-fetch-response로 응답 ({id, status, text})
```

`id` 필드로 요청-응답을 매칭하여, 여러 동시 요청이 섞이지 않도록 한다.

### 5.6 개선 방향

1. **구조화된 메시지 프로토콜**: 현재 이벤트명이 기능별로 개별 정의. 단일 채널(`mikukotoba-bridge`)에 `{ type, payload }` 형식으로 통합하면 확장성 향상.

2. **에러 전파 개선**: 현재 브릿지 에러는 빈 응답 또는 타임아웃으로만 처리. 명시적 에러 메시지를 content script에 전달하면 디버깅이 용이.

---

## 6. 자막 오버레이 (SubtitleOverlay)

### 6.1 구조

```
.html5-video-player
  └── #mikukotoba-overlay-container
        └── #shadow-root (open)
              ├── <style> (동적 생성, 설정 반영)
              └── .jp-overlay
                    ├── .line-original (후리가나 또는 클릭 가능 토큰)
                    ├── .line-romaji
                    ├── .line-translation
                    └── .engine-badge
```

### 6.2 Shadow DOM 사용 이유

- YouTube의 CSS가 오버레이를 간섭하지 않도록 격리
- `:host` 선택자로 오버레이 위치 제어 (`position: absolute; bottom: 60px`)
- YouTube 테마 변경에도 오버레이 스타일 일관성 유지

### 6.3 YouTube 기본 자막 숨김

```css
.ytp-caption-window-container { display: none !important; }
.caption-window { display: none !important; }
```

`<style id="mikukotoba-hide-yt-captions">`를 `document.head`에 삽입. `unmount()` 시 제거하여 기본 자막 복원.

### 6.4 표시 구성

| 줄 | 조건 | 내용 |
|----|------|------|
| 원문 | `showFurigana` | `<ruby>漢字<rt>かんじ</rt></ruby>` 형태, 각 토큰 클릭 가능 |
| 원문 | `!showFurigana` | 클릭 가능 토큰 (후리가나 없음) |
| 로마자 | `showRomaji` | `tokensToRomaji(tokens)` |
| 번역 | `showTranslation` | `result.korean` |
| 엔진 | 항상 | `formatEngineBadge(result)` (우하단, 10px 회색) |

### 6.5 단어 클릭 → 단어장

각 토큰이 `.word` span으로 감싸져 `data-token-idx` 속성을 가진다. 클릭 시 공유 단어장 콜백이 호출된다:

```
.word click → stopPropagation()
  → tokens[idx]에서 surface, reading 추출
  → .line-original의 textContent를 sentence로 전달
  → onWordClick(surface, reading, sentence)
  → word-click-callback.ts → vocab-click-handler.ts (dynamic import)
  → showVocabModal() → 단어장 추가
```

`subtitle-handler.ts`에서 `subtitleOverlay.setOnWordClick(onWordClick)`으로 공유 콜백을 연결한다. 다른 핸들러(Twitter, YouTube Page, Webpage)와 동일한 `WordClickCallback` 타입을 사용. 결정 기록: `decisions/0015-vocab-click-via-renderer-callback.md`.

### 6.6 페이드 전환

```
show(result)
  → overlay.style.opacity = '0'
  → innerHTML 구성
  → requestAnimationFrame → opacity = '1'

hide()
  → overlay.style.opacity = '0'
  → setTimeout(200ms) → innerHTML = ''
```

`transition: opacity 200ms ease`로 부드러운 전환.

### 6.7 설정 반영

`updateSettings()`에서 `<style>` 요소의 `textContent`를 재생성. `getStyles()`가 현재 설정값으로 CSS 문자열을 생성하므로, 색상·크기·투명도 변경이 즉시 반영.

### 6.8 개선 방향

**현재 한계:**
- 자막이 길 때 `max-width: 80%`로 잘리지만, 줄바꿈 처리가 명시적이지 않음.

**개선안:**

1. **전체화면 대응**: `document.fullscreenElement` 감지하여 모달 위치 재계산.

---

## 7. 페이지 텍스트 번역 (YouTubePageHandler)

### 7.1 핸들러 특성

| 속성 | 값 | 설명 |
|------|-----|------|
| `id` | `'youtube-page'` | 핸들러 식별자 |
| `priority` | `5` | SubtitleHandler(10)보다 낮음 |
| `requiresJapaneseContent` | 미설정 (false) | 즉시 활성화 |

### 7.2 요소 카테고리

YouTube 페이지의 요소는 세 가지 카테고리로 분류되며, 카테고리에 따라 렌더링 방식이 결정된다:

| 카테고리 | 설명 | 예시 | 렌더링 특성 |
|---------|------|------|-----------|
| `main` | 짧은 비인터랙티브 텍스트 | 영상 제목, 검색 결과 제목 | 원문을 후리가나 블록으로 교체 가능 |
| `rich` | 장문 또는 인터랙티브 요소 포함 | 댓글, 설명, 커뮤니티 게시글 | 링크·@멘션·타임스탬프 보존 필수 |
| `label` | 짧은 라벨 | 채널명, 해시태그, 사이드바 제목 | 컴팩트 한 줄 번역 |

### 7.3 셀렉터 정의 (YT_SELECTOR_DEFS)

`utils.ts`에 30개 이상의 셀렉터가 정의되어 있으며, 각각 `key`, `selector`, `category`, `deferToViewport` 속성을 가진다:

**시청 페이지:**
- `videoTitle` (main, 즉시) — `ytd-watch-metadata h1 yt-formatted-string`
- `commentText` / `commentTextNew` (rich, 뷰포트) — 댓글 본문
- `channelName` (label, 즉시) — `#channel-name yt-formatted-string`
- `hashtag` (label, 즉시) — `ytd-watch-metadata #super-title a`
- `compactVideoTitle` (label, 뷰포트) — 사이드바 추천 영상

**피드/홈:**
- `feedVideoTitle` / `feedChannelName` (label, 뷰포트) — 홈 피드 요소
- `shortsTitle` / `lockupTitle` / `lockupChannel` (label, 뷰포트) — 2025+ 리디자인 대응

**검색/채널/재생목록/Shorts:** 각 페이지별 요소 정의 (대부분 뷰포트 지연)

**특수 처리:**
- `descExpander` — `DESCRIPTION_EXPANDER` 셀렉터로 감지, 일반 번역 대신 `attachDescriptionWatcher()` 연결

### 7.4 셀렉터 라우팅 (BatchedObserver)

PageHandler는 공유 `BatchedObserver`를 사용하여 DOM 변경을 셀렉터별로 라우팅한다:

```
BatchedObserver (MutationObserver + querySelectorAll)
  → addedNodes 감시 + characterData 감시
  → shouldSkip 필터: 광고, 이미 처리됨, 편집 영역 제외
  → 각 route.selector에 매칭되는 요소 → route.callback 호출
```

**characterData 처리**: YouTube 댓글은 React/Polymer가 빈 요소를 삽입 후 텍스트를 채우는 패턴. `characterDataAncestorResolver`로 텍스트 노드의 댓글/게시글 부모를 찾아 라우팅.

**광고 제외**:
```typescript
el.closest('ytd-ad-slot-renderer, ytd-promoted-sparkles-web-renderer, ytd-promoted-video-renderer')
```

### 7.5 뷰포트 지연 처리

`deferToViewport: true`인 요소는 즉시 처리하지 않고 IntersectionObserver에 등록:

```
deferToViewport(el)
  → el.dataset.jpCategory = category
  → viewportObserver.observe(el)

IntersectionObserver (rootMargin: '200px')
  → isIntersecting === true
  → el.dataset.jpCategory에서 카테고리 복원
  → processElement(el, category)
  → unobserve(el)
```

화면에 보이기 200px 전부터 미리 처리 시작.

### 7.6 스크롤 기반 재스캔

YouTube는 Polymer 데이터 바인딩으로 콘텐츠를 동적 렌더링하여 `childList` mutation이 발생하지 않는 경우가 있다. 이를 보완하기 위해 스크롤 이벤트에서 재스캔:

```
window 'scroll' 이벤트 → throttle(3000ms) → observer.scan()
```

---

## 8. 모드별 렌더링

### 8.1 processElement 통합 플로우

```
processElement(el, category)
  ├─ category === 'rich'
  │   ├─ mode === 'hover' → registerRichHoverTarget(el)
  │   └─ else → processRichContent(el)
  │
  ├─ mode === 'hover' → registerHoverTarget(el)
  │
  └─ mode === 'inline' / 'furigana-only'
      → containsJapaneseLike(text) 확인
      → tracker.isProcessedWithSameText(el, text) 중복 확인
      → translator.translate(text)
      → renderForMode(mode, category, result, text)
```

### 8.2 main 카테고리 렌더링

**인라인 모드 (showFurigana=true):**
```
원문 요소
  → [hidden] 원문 (jp-furigana-hidden 클래스)
  → createStyledFuriganaBlock(result, el) — 원문 스타일 복제한 후리가나 블록
  → createInlineBlock(result, ..., skipFurigana: true) — 번역 블록 (스포일러)
```

`createStyledFuriganaBlock`은 원문 요소의 `getComputedStyle`에서 `fontSize`, `fontWeight`, `color`, `fontFamily`, `letterSpacing`를 복사하여, 후리가나 블록이 시각적으로 원문과 동일하게 보이도록 한다. 중요: 원문을 숨기기 전에 호출해야 한다.

**인라인 모드 (showFurigana=false):**
```
createInlineBlock(result, ...) — 전체 번역 블록 (후리가나 포함)
```

**후리가나 전용 모드:**
```
createStyledFuriganaBlock(result, el) — 후리가나 블록만
```

### 8.3 rich 카테고리 렌더링 (processRichContent)

장문/인터랙티브 콘텐츠는 문단 분할 후 개별 번역:

```
processRichContent(el)
  → splitRichText(fullText) — 문단 분할
  │   ├─ \n\n 으로 분할
  │   ├─ 단일 문단이 500자 초과 시 \n 으로 재분할
  │   └─ URL 전용 문단, 비일본어 문단 필터링
  │
  → 각 문단 순차 번역 (rate limit 존중)
  │
  ├─ showFurigana
  │   → 모든 토큰 합산 → createRubyClone(el, allTokens)
  │   → 원문 숨기고 루비 클론 표시
  │
  └─ mode === 'inline'
      → 번역 블록 컨테이너 (.jp-yt-desc-translations)
      → 각 문단별 createInlineBlock 추가
```

**`createRubyClone` 사용 이유**: 댓글, 설명 등에는 링크, @멘션, 타임스탬프 등 인터랙티브 요소가 포함. `createRubyClone`은 원본 DOM을 deep clone하여 텍스트 노드만 ruby 태그로 교체하므로, 모든 인터랙티브 요소가 보존된다.

### 8.4 label 카테고리 렌더링

```
inline 모드:   createLabelBlock(result.korean, 'translation') — 한 줄 번역
furigana 모드: createLabelBlock(reading, 'furigana') — 한 줄 읽기
```

`createLabelBlock`은 `<div class="jp-yt-label-block jp-yt-label-block--{variant}">` 형태의 간결한 블록.

### 8.5 호버 모드

**main/label 요소:**
```
registerHoverTarget(el)
  → containsJapaneseLike(text) 확인
  → showFurigana? → MorphologicalAnalyzer로 로컬 형태소 분석
  │   → hasKanji? → createStyledFuriganaBlock() + 원문 숨김
  │   → 후리가나 블록에 data-jpOriginalText 저장
  │   → 후리가나 블록을 hoverTargets에 등록
  └─ hoverTargets에 등록 + 'jp-yt-hover-target' 클래스
```

**rich 요소:**
```
registerRichHoverTarget(el)
  → showFurigana? → createRubyClone(el, tokens) (인터랙티브 보존)
  │   → 클론에 data-jpOriginalText 저장
  │   → 클론을 hoverTargets에 등록
  └─ hoverTargets에 등록
```

**호버 타겟 탐색:**
```
getHoverTargetAtPoint(x, y)
  → document.elementFromPoint(x, y)
  → 부모 체인을 올라가며 hoverTargets WeakSet 확인
  → data-jpOriginalText 또는 innerText 반환
```

호버 모드에서 후리가나가 켜져 있으면 `MorphologicalAnalyzer`를 lazy 초기화한다. 번역 API가 아닌 로컬 형태소 분석만 사용하므로 API 비용 없음.

### 8.6 공유 렌더러 인터페이스

PageHandler가 사용하는 공유 렌더러(`src/content/shared/renderers/`)의 호출 패턴:

| 렌더러 | 사용 위치 | 주요 옵션 |
|--------|----------|----------|
| `createInlineBlock` | main/rich 카테고리 인라인 모드 | `spoiler: true`, `skipFurigana`, `onRetranslate`, `className: 'jp-yt-inline-block'` |
| `createStyledFuriganaBlock` | main 카테고리 후리가나 표시 | 원문 요소의 computed style 복제 |
| `createRubyClone` | rich 카테고리 후리가나 표시 | 링크·멘션·타임스탬프 보존, `data-testid` 제거 |
| `HoverTooltip` | 호버 모드 전체 | `debounceMs: 500`, Shadow DOM 격리 |
| `createLabelBlock` | label 카테고리 | variant: `'translation'` 또는 `'furigana'` |

공유 렌더러의 상세 인터페이스는 번역 공통 기술 명세의 "공유 렌더러 계층" 섹션을 참조.

---

## 9. SPA 네비게이션 대응

### 9.1 yt-navigate-finish 이벤트

YouTube SPA 네비게이션 감지에 `yt-navigate-finish` 커스텀 이벤트를 사용:

```
document.addEventListener('yt-navigate-finish', handleNavigate)
```

### 9.2 네비게이션 처리 플로우

```
handleNavigate()
  → rescanTimers 모두 클리어
  → tracker.cleanup() — 모든 처리 상태 초기화
  → observer.stop() + observer.start() — 새 페이지 스캔
  → descriptionObserver 해제
  → 점진적 재스캔: 500ms, 1500ms, 3000ms 후
      각각: recheckStaleTranslations() + observer.scan()
```

### 9.3 지연 재스캔이 필요한 이유

YouTube는 SPA 네비게이션 후 콘텐츠를 비동기적으로 여러 단계에 걸쳐 렌더링한다:
1. 즉시: 기본 레이아웃 + 제목 플레이스홀더
2. ~500ms: 제목, 채널명 등 주요 텍스트
3. ~1500ms: 댓글 섹션 시작
4. ~3000ms: 추천 영상 사이드바 완성

### 9.4 Stale 번역 감지 (recheckStaleTranslations)

SPA 네비게이션 시 YouTube가 요소를 재사용하면서 텍스트만 변경하는 경우가 있다. 이미 `processed` 마크가 된 요소의 텍스트가 변경되었으면 재처리:

```
recheckStaleTranslations()
  → deferToViewport가 아닌 모든 셀렉터 순회
  → 각 매칭 요소의 textContent와 tracker 저장 텍스트 비교
  → 다르면: 기존 번역 제거, 원문 복원, processed 마크 해제
```

**`textContent` 사용 이유**: `innerText`는 `display:none`(jp-furigana-hidden) 요소에서 빈 문자열을 반환. `textContent`는 visibility와 무관하게 실제 텍스트를 반환하므로 stale 판정에 적합.

---

## 10. 삽입 앵커 결정 (getInsertionAnchor)

YouTube의 컴포넌트 구조상, 번역 블록을 매칭된 요소 바로 뒤에 삽입하면 레이아웃이 깨지는 경우가 있다. `getInsertionAnchor`로 올바른 삽입 위치를 결정:

| 패턴 | 매칭 요소 | 삽입 앵커 | 이유 |
|------|----------|----------|------|
| 영상 제목 | `yt-formatted-string` (h1 내부) | `h1` | h1 스타일 적용 범위 밖에 삽입 |
| 검색/재생목록 제목 | `yt-formatted-string` (a#video-title 내부) | `a#video-title` | 링크 스타일 범위 밖에 삽입 |
| 댓글 | `#content-text` (ytd-expander 내부) | `ytd-expander` | expander의 overflow:hidden 밖에 삽입 |
| 그 외 | 매칭 요소 자체 | 매칭 요소 자체 | 기본 동작 |

### 10.1 기존 번역 제거

```
removeAdjacentTranslation(anchor)
  → anchor의 모든 후속 sibling을 순회
  → YT_TRANSLATION_ATTR이 있는 요소 제거
```

**모든 sibling 순회 이유**: YouTube Polymer가 앵커와 번역 블록 사이에 배지 등 비번역 요소를 삽입할 수 있어, 인접 sibling만 확인하면 stale 번역을 놓칠 수 있음.

---

## 11. 영상 설명 처리

### 11.1 설명 펼침 감지

영상 설명은 `ytd-text-inline-expander`로 감싸져 있으며, 기본적으로 접혀 있다. "더보기" 클릭 시 `is-expanded` 속성이 추가된다:

```
attachDescriptionWatcher(expander)
  → MutationObserver (attributes: ['is-expanded'])
  → is-expanded 속성 추가 감지
  → expander 내부에서 'yt-attributed-string' 또는 '#structured-description' 찾기
  → processElement(desc, 'rich') 또는 registerRichHoverTarget(desc)
```

### 11.2 BatchedObserver 연동

`descExpander`는 `YT_SELECTOR_DEFS`에서 제외되어 `buildRoutes()`에서 별도 route로 등록:

```typescript
routes.push({
  selector: YT_SELECTORS.DESCRIPTION_EXPANDER,
  callback: (el) => this.attachDescriptionWatcher(el),
});
```

---

## 12. 설정 변경 대응

### 12.1 재시작 조건

```typescript
const needsRestart =
  settings.webpageMode !== prev.webpageMode ||
  settings.showFurigana !== prev.showFurigana ||
  settings.showTranslation !== prev.showTranslation ||
  settings.showRomaji !== prev.showRomaji;
```

재시작 시: `stop()` (모든 번역·옵저버·호버 정리) → `start()` (새 모드로 처음부터)

### 12.2 비재시작 변경

`webpageMode`와 표시 옵션 외의 변경(색상, 크기 등)은 `hoverTooltip?.updateSettings(settings)`만 호출.

**설정 전파 경로**: Popup/옵션 페이지 → `chrome.storage.set()` → `onChanged` 이벤트 → Service Worker가 `broadcastToAllTabs()` → Content Script의 `handler.updateSettings()` 호출. 상세 메시지 프로토콜은 번역 공통 기술 명세의 "설정 저장 아키텍처" 섹션을 참조.

---

## 12.5 다크/라이트 모드 대응

YouTube의 테마에 맞춰 번역 블록의 시각적 스타일이 자동 조정된다:

```css
/* youtube-page.css */
html[dark] .jp-yt-inline-block {
  border-color: rgba(255, 255, 255, 0.1);
  color: #ccc;
}
```

**감지 메커니즘**: YouTube는 `<html>` 요소에 `dark` 속성을 추가/제거하여 테마를 전환한다. CSS 셀렉터 `html[dark]`로 다크 모드 스타일을 정의하므로, JavaScript 감지 없이 CSS만으로 자동 대응된다.

**자막 오버레이**: SubtitleOverlay는 Shadow DOM 내부에서 자체 색상 설정(`settings.color*`)을 사용하므로, YouTube 테마와 무관하게 사용자 설정을 따른다.

---

## 12.6 캐시 전략

번역 결과의 캐시는 번역 공통 시스템(`src/core/cache.ts`)에서 관리되며, YouTube 핸들러는 별도 캐시를 구현하지 않는다.

### 캐시 동작

- **자막 번역**: `translator.translate(text)` 호출 시 캐시를 자동 조회. 프리페치로 미리 번역된 자막은 캐시 히트로 즉시 반환.
- **페이지 번역**: 동일 텍스트의 번역은 캐시에서 반환. SPA 네비게이션 후 같은 요소의 텍스트가 변경되지 않았으면 재번역하지 않음 (`tracker.isProcessedWithSameText`).
- **캐시 키**: `hashKey(text, source?)` — `location.hostname`을 source로 전달하여 YouTube와 다른 사이트의 번역 캐시를 분리한다.

### 한계

- 자막 프리페치 결과가 캐시되어 있어도, 비디오 전환 시 이전 영상의 캐시가 새 영상에서 히트될 수 있음 (텍스트가 우연히 같은 경우).

---

## 13. 다른 핸들러와의 비교

| 특성 | YouTube Subtitle | YouTube Page | Webpage | Twitter |
|------|-----------------|-------------|---------|---------|
| 감지 | VideoObserver (이벤트+폴링) | BatchedObserver (셀렉터) | TextDetector (범용) | TwitterObserver (data-testid) |
| 요소 카테고리 | 없음 (자막 한 종류) | main/rich/label | 없음 (단일) | tweet/user/trend |
| 후리가나 | SubtitleOverlay 내장 ruby | createStyledFuriganaBlock / createRubyClone | 텍스트 노드 직접 교체 | createRubyClone |
| 뷰포트 최적화 | 없음 (시간 기반) | IntersectionObserver (deferToViewport) | IntersectionObserver | 없음 (가상 스크롤 의존) |
| SPA 대응 | VideoObserver (이벤트+폴링) | yt-navigate-finish + 점진적 재스캔 | popstate + hashchange + URL 폴링 + MutationObserver | MutationObserver |
| 스포일러 | 없음 | 있음 (inline 모드) | 없음 | 있음 |
| 프리페치 | 있음 (2초 간격, 3개) | 없음 | 없음 | 없음 |
| Shadow DOM | 오버레이 | 없음 | 없음 | 없음 |

---

## 14. 성능 고려사항

### 14.1 자막 번역 지연

| 구간 | 지연 |
|------|------|
| 자막 감지 → translate() 호출 | ~0ms (이벤트 기반) |
| translate() → 응답 | Papago ~200ms, LLM ~500-2000ms |
| 프리페치 히트 (캐시) | ~0ms |

프리페치로 인해 대부분의 자막은 캐시에서 즉시 반환.

### 14.2 페이지 번역 비용

| 항목 | 비용 |
|------|------|
| BatchedObserver scan | 셀렉터 30개 × querySelectorAll |
| 뷰포트 지연 | IntersectionObserver 등록 ~0ms |
| registerHoverTarget (형태소 분석) | Kuromoji ~1-5ms/문장 |
| processRichContent (문단 분할) | 순차 번역 — 문단 수 × 번역 지연 |
| recheckStaleTranslations | 모든 즉시 처리 셀렉터 × querySelectorAll + textContent 비교 |
| 점진적 재스캔 (3회) | scan() × 3 (500ms, 1500ms, 3000ms) |

### 14.3 최적화 적용 현황

- **뷰포트 지연**: 댓글, 사이드바 등 화면 밖 요소는 보일 때까지 번역 지연
- **광고 제외**: shouldSkip에서 광고 컨테이너 조기 필터링
- **스크롤 throttle**: 3초 간격으로 재스캔 제한
- **프리페치**: 자막 전환 시 대기 시간 제거
- **캐시**: 번역 결과 캐시로 동일 텍스트 재번역 방지

---

## 15. 현재 구현의 edge case와 workaround

### 15.1 YouTube Polymer 데이터 바인딩

YouTube의 Polymer 프레임워크는 DOM 노드를 재사용하면서 데이터만 갱신하는 패턴을 사용한다. 이 경우 `childList` mutation이 발생하지 않아 BatchedObserver가 감지하지 못한다.

**Workaround:**
- `characterData` 감시로 텍스트 변경 감지
- 스크롤 기반 재스캔 (`throttle(3000ms)`)
- SPA 네비게이션 후 점진적 재스캔 (500ms, 1500ms, 3000ms)
- `recheckStaleTranslations`으로 텍스트 변경된 요소 재처리

### 15.2 YouTube 리디자인 대응

YouTube는 주기적으로 UI를 리디자인하며, 2025년부터 새로운 view-model 컴포넌트를 도입 중:
- `yt-lockup-metadata-view-model` (새 비디오 카드)
- `yt-content-metadata-view-model` (새 메타데이터)
- `ytm-shorts-lockup-view-model-v2` (새 Shorts 카드)

기존 셀렉터와 새 셀렉터가 `YT_SELECTOR_DEFS`에 공존하여, 리디자인 전환기에 두 버전 모두 지원.

### 15.3 이중 시작 방지

`content/index.ts`가 `updateSettings` → `start` 순서로 호출하여 이중 시작될 수 있다. `start()` 첫 줄에서 `this.observer` 존재 여부를 확인하여 방어:

```typescript
if (this.observer) {
  log.info('YouTube page handler already running, skipping start');
  return;
}
```

### 15.4 IntersectionObserver와 가상 스크롤

YouTube 댓글은 무한 스크롤이지만 가상 스크롤은 아니다 (DOM에서 요소를 제거하지 않음). 그러나 피드 페이지에서는 먼 요소가 `display:none`이 될 수 있어, IntersectionObserver가 다시 `isIntersecting`을 보고할 수 있다. `unobserve` 후에는 재관찰하지 않으므로 중복 처리 없음.

### 15.5 MorphologicalAnalyzer lazy 초기화

호버 모드에서 `showFurigana`가 켜져 있을 때만 Kuromoji 사전을 로드한다. Promise 기반 초기화로 동시 `registerHoverTarget` 호출에서 race condition 방지:

```typescript
if (!this.analyzerReady) {
  this.analyzer = new MorphologicalAnalyzer();
  this.analyzerReady = this.analyzer.init();
}
await this.analyzerReady;
```
