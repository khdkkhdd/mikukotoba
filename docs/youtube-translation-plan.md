# YouTube 인라인 번역 상세 계획

> jp-helper 확장 프로그램의 YouTube 전용 번역 핸들러 설계 문서
> 기존 자막 번역(subtitle-overlay)은 유지하면서, 페이지 내 텍스트 요소에 대한 번역을 추가

## 목차

- [현재 상태](#현재-상태)
- [아키텍처 개요](#아키텍처-개요)
- [공통 사항](#공통-사항)
- [페이지별 상세 계획](#페이지별-상세-계획)
  - [1. 시청 페이지 (Watch)](#1-시청-페이지-watch)
  - [2. 홈 피드](#2-홈-피드)
  - [3. 검색 결과](#3-검색-결과)
  - [4. 채널 페이지](#4-채널-페이지)
  - [5. 재생목록 페이지](#5-재생목록-페이지)
  - [6. Shorts](#6-shorts)
  - [7. 구독 피드](#7-구독-피드)
  - [8. 인기 / Explore](#8-인기--explore)
  - [9. 라이브 채팅](#9-라이브-채팅)
  - [10. 알림](#10-알림)
- [번역 제외 대상](#번역-제외-대상)
- [구현 모듈 구조](#구현-모듈-구조)
- [캐시 전략](#캐시-전략)
- [구현 우선순위](#구현-우선순위)

---

## 현재 상태

현재 YouTube 핸들러는 **자막 번역만** 지원:

```
src/content/youtube/
  ├── video-observer.ts       ← SPA 네비게이션 + 비디오 변경 감지
  ├── subtitle-extractor.ts   ← 자막 추출 (TextTrack / TimedText API / DOM)
  ├── subtitle-overlay.ts     ← 자막 오버레이 (Shadow DOM, 비디오 플레이어 위)
  └── caption-bridge.ts       ← MAIN world 브릿지 (YouTube Player API 접근)
```

이 문서는 자막 이외의 **페이지 내 텍스트 요소**(제목, 설명, 댓글 등)에 대한 번역 기능을 설계한다.

---

## 아키텍처 개요

YouTube는 Polymer/Lit 기반 Web Components SPA로, 다음 특성을 가짐:

- **커스텀 엘리먼트**: `ytd-*`, `yt-formatted-string` 등 — 태그명이 안정적인 셀렉터
- **CSS 클래스**: 난독화되지 않음 — 비교적 안정적이나 마이너 업데이트로 변경 가능
- **`id` 속성**: `#title`, `#content`, `#description` 등 — 안정적
- **SPA 네비게이션**: 페이지 간 이동 시 부분 DOM 교체 (전체 리로드 아님)
- **지연 로딩**: 댓글, 추천 영상 등은 스크롤 시 동적 로드
- **가상 스크롤**: 댓글 섹션에서 제한적으로 사용 (Twitter보다 덜 공격적)
- **반응형 데이터 바인딩**: Polymer의 데이터 바인딩이 DOM을 관리하므로 원본 수정 시 되돌림 가능

### 핵심 원칙

1. **원본 DOM 내부를 수정하지 않는다** — `yt-formatted-string` 내부 텍스트를 변경하면 Polymer가 되돌림
2. **형제/자식 요소로 번역을 삽입한다** — 원본 요소 바로 아래에 새 div 삽입
3. **Web Component 태그명을 주 셀렉터로 사용** — `ytd-comment-renderer`, `ytd-video-renderer` 등
4. **`#id` 속성을 보조 셀렉터로 활용** — `#title`, `#description`, `#content-text` 등
5. **기존 자막 번역과 공존** — `VideoObserver`, `SubtitleExtractor`, `SubtitleOverlay`는 그대로 유지

### Twitter 핸들러와의 차이점

| 항목 | Twitter | YouTube |
|---|---|---|
| **프레임워크** | React Native for Web | Polymer/Lit Web Components |
| **안정 셀렉터** | `data-testid` 속성 | 커스텀 엘리먼트 태그명 + `#id` |
| **CSS 클래스** | 난독화 (사용 불가) | 안정적 (보조적 사용 가능) |
| **가상 스크롤** | 매우 공격적 (뷰포트 밖 제거) | 댓글에서만 제한적 사용 |
| **DOM 관리** | React reconciliation | Polymer data binding |
| **삽입 방식** | `insertAdjacentElement('afterend')` | 동일하나, Web Component 내부 구조 고려 필요 |

---

## 공통 사항

### 번역 표시 방식 (3가지)

Twitter의 4가지 방식 중 YouTube에 적합한 3가지를 사용.

#### 방식 A: 인라인 블록

문장 단위 콘텐츠(영상 제목, 설명, 댓글 본문 등)에 사용. 원본 요소 바로 아래에 번역 블록을 삽입.

```
┌─────────────────────────────────┐
│ 原文テキスト（元のまま維持）       │  ← 원본 (수정하지 않음)
├─────────────────────────────────┤
│ 原文(げんぶん)テキスト            │  ← 후리가나 처리된 원문 복제
│ genbun tekisuto                 │  ← 로마지 (설정 시)
│ 원문 텍스트                      │  ← 한국어 번역
└─────────────────────────────────┘
```

- 삽입 위치: 원본 요소 바로 뒤 형제 요소로 삽입
- 스타일: YouTube 테마(라이트/다크) 대응, 원본보다 약간 작은 폰트
- 클래스: `jp-youtube-translation`
- 다크 모드: `html[dark]` 셀렉터로 감지하여 색상 자동 전환

#### 방식 B: 호버 툴팁

짧은 텍스트(채널명, 해시태그 등)에 사용. 마우스 오버 시 작은 팝업 표시.

```
       ┌───────────────────┐
       │ たなかたろう        │  ← 읽기
       │ Tanaka Tarō       │  ← 로마지
       │ 타나카 타로         │  ← 한국어
       └───────────────────┘
            田中太郎          ← 원본 (호버 대상)
```

- Shadow DOM으로 CSS 격리
- Twitter 핸들러의 hover-tooltip 로직을 공통 모듈로 추출하여 재사용
- 디바운스: 300ms

#### 방식 C: 인라인 괄호

챕터 제목, 해시태그 등 한 줄 텍스트에 사용. 원본 옆에 괄호로 번역 추가.

```
選択肢テキスト (선택지 텍스트)
```

- 삽입: 원본 텍스트 뒤에 `<span class="jp-youtube-inline-hint">` 추가
- 스타일: 연한 색상, 약간 작은 폰트

### YouTube 테마 대응

YouTube는 라이트/다크 모드를 `html[dark]` 속성으로 관리:

```css
/* 라이트 모드 */
.jp-youtube-translation { color: #555; border-top-color: rgba(0,0,0,0.1); }

/* 다크 모드 */
html[dark] .jp-youtube-translation { color: #aaa; border-top-color: rgba(255,255,255,0.1); }
```

### 일본어 판별 기준

1. YouTube는 `lang` 속성을 대부분 제공하지 않음 → `isJapanese()` 로직 사용
2. 히라가나/카타카나 1자 이상 포함 시 일본어로 판별
3. 채널명 등 짧은 텍스트: 한자만 있는 경우 CJK 비율 50% 이상일 때만

### 텍스트 추출 방법

- `yt-formatted-string`: `element.textContent.trim()` 또는 `element.innerText.trim()`
- 해시태그/URL은 `<a>` 태그 내부에 있으므로 `innerText`에 자연스럽게 포함
- 이모지: YouTube는 이모지를 네이티브 Unicode로 렌더링 (Twitter의 이미지 이모지와 다름)

---

## 페이지별 상세 계획

---

### 1. 시청 페이지 (Watch)

**URL**: `/watch?v={video_id}`

가장 핵심적인 페이지. 번역 대상 요소가 가장 많다.

**컨테이너 구조**:
```
ytd-watch-flexy
  ├── #primary (메인 영역)
  │     ├── #player (비디오 플레이어) — 기존 자막 번역 유지
  │     ├── #below (비디오 아래)
  │     │     ├── ytd-watch-metadata
  │     │     │     ├── #title (영상 제목)
  │     │     │     ├── #owner (채널 정보)
  │     │     │     └── ytd-text-inline-expander (설명)
  │     │     ├── ytd-comments#comments (댓글 섹션)
  │     │     │     └── ytd-comment-thread-renderer (반복)
  │     │     └── ytd-merch-shelf-renderer (상품 선반, 있을 때)
  │     └── ...
  └── #secondary (사이드바)
        └── ytd-compact-video-renderer (추천 영상, 반복)
```

#### 번역 대상 요소

##### 1-1. 영상 제목

| 항목 | 내용 |
|---|---|
| 셀렉터 | `ytd-watch-metadata h1.ytd-watch-metadata yt-formatted-string` |
| 보조 셀렉터 | `ytd-watch-metadata #title yt-formatted-string` |
| 텍스트 특성 | 1~100자, 이모지·해시태그 포함 가능 |
| 텍스트 추출 | `element.textContent.trim()` |
| 번역 방식 | **방식 A (인라인 블록)** |
| 삽입 위치 | `h1.ytd-watch-metadata` 바로 아래에 번역 블록 삽입 |
| 캐시 키 | `videoId` (URL의 `v` 파라미터) |
| 주의 | SPA 네비게이션 시 제목이 교체됨 → `VideoObserver`의 비디오 변경 감지와 연동 |

##### 1-2. 채널명

| 항목 | 내용 |
|---|---|
| 셀렉터 | `ytd-watch-metadata #owner ytd-channel-name yt-formatted-string a` |
| 보조 셀렉터 | `#channel-name yt-formatted-string a` |
| 텍스트 특성 | 1~50자 |
| 번역 방식 | **방식 B (호버 툴팁)** |
| 캐시 키 | 채널명 텍스트 |

##### 1-3. 영상 설명

| 항목 | 내용 |
|---|---|
| 셀렉터 | `ytd-text-inline-expander #plain-snippet-text` (접힌 상태) |
| 전개 셀렉터 | `ytd-text-inline-expander #structured-description` (펼친 상태) |
| 텍스트 특성 | 0~5,000자, URL·해시태그·타임스탬프 포함 |
| 내부 구조 | 접힌 상태: 3줄 미리보기. 펼친 상태: 전체 텍스트 |
| 번역 방식 | **방식 A (인라인 블록)** |
| 삽입 위치 | 설명 텍스트 컨테이너 아래에 번역 블록 삽입 |
| 캐시 키 | `videoId + ':desc'` |
| 주의 | "...자세히 보기" 클릭 시 DOM 구조가 변경됨 → 접힘/펼침 상태 변화 감지 필요 |
| 주의 | URL, 타임스탬프(`0:00`), 해시태그(`#tag`)는 번역 텍스트에서 유지 |
| 트리거 | 설명 영역이 **펼쳐졌을 때만** 번역 실행 (접힌 상태는 텍스트가 잘려있으므로 번역하지 않음) |

##### 1-4. 해시태그 (제목 위)

| 항목 | 내용 |
|---|---|
| 셀렉터 | `ytd-watch-metadata #super-title a` (해시태그 링크) |
| 텍스트 특성 | `#タグ名`, 1~30자/태그, 보통 1~3개 |
| 번역 방식 | **방식 C (인라인 괄호)** |
| 삽입 위치 | 각 해시태그 `<a>` 뒤에 괄호 번역 추가 |
| 캐시 키 | 해시태그 텍스트 |

##### 1-5. 댓글

| 항목 | 내용 |
|---|---|
| 셀렉터 | `ytd-comment-thread-renderer` (스레드 단위) |
| 댓글 본문 | `#content-text` (`yt-formatted-string`) |
| 댓글 작성자 | `#author-text yt-formatted-string` 또는 `#author-text span` |
| 텍스트 특성 | 본문: 1~10,000자, 이모지·해시태그·타임스탬프 포함 |
| 번역 방식 | 본문 — **방식 A (인라인 블록)**, 작성자명 — **방식 B (호버 툴팁)** |
| 삽입 위치 | `#content-text` 바로 아래에 번역 블록 삽입 |
| 캐시 키 | 댓글 텍스트 해시 (댓글에는 고유 URL이 없음) |
| 지연 로딩 | 댓글은 스크롤 시 동적으로 로드됨 → MutationObserver로 새 댓글 감지 |
| 고정 댓글 | `#pinned-comment-badge` 포함 — 동일하게 처리 |
| 펼치기 | "자세히 보기" 클릭 시 텍스트 변경됨 → 기존 번역 제거 후 재번역 |

##### 1-6. 답글 댓글

| 항목 | 내용 |
|---|---|
| 셀렉터 | `ytd-comment-thread-renderer #replies ytd-comment-renderer` |
| 처리 | 1-5(댓글)와 **동일** |
| 주의 | "답글 N개" 버튼 클릭 시 답글이 로드됨 → MutationObserver로 감지 |

##### 1-7. 챕터 (타임라인)

| 항목 | 내용 |
|---|---|
| 셀렉터 | `ytd-macro-markers-list-renderer ytd-macro-markers-list-item-renderer` |
| 챕터 제목 | `#details h4` 또는 `#details .macro-markers` |
| 텍스트 특성 | 1~50자/챕터 |
| 번역 방식 | **방식 C (인라인 괄호)** |
| 캐시 키 | `videoId + ':ch:' + 챕터제목` |
| 위치 | 설명 펼쳤을 때 챕터 목록이 표시됨 |

##### 1-8. 추천 영상 (사이드바)

| 항목 | 내용 |
|---|---|
| 셀렉터 | `ytd-compact-video-renderer` |
| 제목 | `#video-title` (`yt-formatted-string` 또는 `span`) |
| 채널명 | `ytd-channel-name yt-formatted-string` |
| 텍스트 특성 | 제목 1~100자, 채널명 1~50자 |
| 번역 방식 | 제목 — **방식 B (호버 툴팁)**, 채널명 — 번역하지 않음 (공간 부족) |
| 캐시 키 | 제목 텍스트 |
| 주의 | 수십 개가 나열되므로 **뷰포트 내 요소만** 번역하여 API 비용 절약 |
| IntersectionObserver | 뷰포트 진입 시에만 번역 트리거 |

##### 1-9. 하트/작성자 반응 배지

| 항목 | 내용 |
|---|---|
| 셀렉터 | `#creator-heart` 영역 |
| 처리 | **번역하지 않음** — UI 요소 |

---

### 2. 홈 피드

**URL**: `/`, `/feed`

**컨테이너 구조**:
```
ytd-browse[page-subtype="home"]
  └── ytd-rich-grid-renderer
        └── ytd-rich-item-renderer (반복)
              └── ytd-rich-grid-media
                    └── ytd-video-renderer 또는 ytd-rich-grid-media
                          ├── #thumbnail (썸네일)
                          ├── #details
                          │     ├── #meta
                          │     │     ├── h3 > a#video-title-link (제목)
                          │     │     └── ytd-video-meta-block
                          │     │           ├── ytd-channel-name (채널명)
                          │     │           └── #metadata-line (조회수·날짜)
                          │     └── ...
                          └── ...
```

#### 번역 대상 요소

##### 2-1. 영상 제목

| 항목 | 내용 |
|---|---|
| 셀렉터 | `ytd-rich-grid-media #video-title-link yt-formatted-string` |
| 대체 셀렉터 | `ytd-video-renderer #video-title yt-formatted-string` |
| 텍스트 특성 | 1~100자 |
| 번역 방식 | **방식 B (호버 툴팁)** |
| 캐시 키 | 제목 텍스트 |
| 주의 | 그리드 레이아웃 — 인라인 블록은 카드 높이를 불균일하게 만들므로 호버 사용 |
| IntersectionObserver | 뷰포트 진입 시에만 번역 트리거 |

##### 2-2. 채널명

| 항목 | 내용 |
|---|---|
| 셀렉터 | `ytd-rich-grid-media ytd-channel-name yt-formatted-string` |
| 텍스트 특성 | 1~50자 |
| 번역 방식 | **방식 B (호버 툴팁)** |
| 캐시 키 | 채널명 텍스트 |

##### 2-3. Shorts 선반

| 항목 | 내용 |
|---|---|
| 셀렉터 | `ytd-rich-shelf-renderer[is-shorts] ytd-reel-item-renderer` |
| 제목 | `#shorts-title` 또는 `h3 span#video-title` |
| 번역 방식 | **방식 B (호버 툴팁)** |
| 캐시 키 | 제목 텍스트 |

---

### 3. 검색 결과

**URL**: `/results?search_query={query}`

**컨테이너 구조**:
```
ytd-search
  └── ytd-section-list-renderer
        └── ytd-item-section-renderer (반복)
              ├── ytd-video-renderer (영상 결과)
              ├── ytd-channel-renderer (채널 결과)
              ├── ytd-playlist-renderer (재생목록 결과)
              └── ytd-shelf-renderer (선반 그룹)
```

#### 번역 대상 요소

##### 3-1. 영상 검색 결과

| 항목 | 내용 |
|---|---|
| 셀렉터 | `ytd-video-renderer` |
| 제목 | `#video-title yt-formatted-string` |
| 설명 미리보기 | `ytd-video-renderer #description-text yt-formatted-string` |
| 채널명 | `ytd-channel-name yt-formatted-string` |
| 번역 방식 | 제목 — **방식 A (인라인 블록)**, 설명 — **방식 A (인라인 블록)**, 채널명 — **방식 B (호버 툴팁)** |
| 캐시 키 | 제목/설명 텍스트 해시 |
| 주의 | 검색 결과 리스트이므로 인라인 블록이 자연스러움 (그리드가 아닌 리스트 레이아웃) |

##### 3-2. 채널 검색 결과

| 항목 | 내용 |
|---|---|
| 셀렉터 | `ytd-channel-renderer` |
| 채널명 | `#info yt-formatted-string.ytd-channel-renderer` |
| 설명 | `#description yt-formatted-string` |
| 번역 방식 | 채널명 — **방식 B (호버 툴팁)**, 설명 — **방식 A (인라인 블록)** |
| 캐시 키 | 채널명/설명 텍스트 |

##### 3-3. 재생목록 검색 결과

| 항목 | 내용 |
|---|---|
| 셀렉터 | `ytd-playlist-renderer` |
| 제목 | `#video-title yt-formatted-string` |
| 번역 방식 | **방식 A (인라인 블록)** |
| 캐시 키 | 제목 텍스트 |

---

### 4. 채널 페이지

**URL**: `/@{channel}`, `/@{channel}/videos`, `/@{channel}/shorts`, `/@{channel}/live`, `/@{channel}/playlists`, `/@{channel}/community`, `/@{channel}/about`

**컨테이너 구조**:
```
ytd-browse[page-subtype="channels"]
  ├── #header (채널 헤더)
  │     ├── #channel-header
  │     │     ├── #channel-name (채널명)
  │     │     ├── #channel-tagline (태그라인/한 줄 설명)
  │     │     └── #channel-handle (@핸들)
  │     └── ...
  └── #tabsContent (탭별 콘텐츠)
        ├── 영상 탭: ytd-rich-grid-renderer
        ├── 커뮤니티 탭: ytd-backstage-post-thread-renderer
        └── 정보 탭: ytd-channel-about-metadata-renderer
```

#### 번역 대상 요소

##### 4-1. 채널명 (헤더)

| 항목 | 내용 |
|---|---|
| 셀렉터 | `#channel-header #channel-name yt-formatted-string` |
| 텍스트 특성 | 1~50자 |
| 번역 방식 | **방식 B (호버 툴팁)** |
| 캐시 키 | 채널명 텍스트 |

##### 4-2. 채널 태그라인

| 항목 | 내용 |
|---|---|
| 셀렉터 | `#channel-header #channel-tagline yt-formatted-string` |
| 텍스트 특성 | 0~160자 |
| 번역 방식 | **방식 A (인라인 블록)** |
| 캐시 키 | `@handle + ':tagline:' + 텍스트해시` |

##### 4-3. 채널 정보 (About 탭)

| 항목 | 내용 |
|---|---|
| 셀렉터 | `ytd-channel-about-metadata-renderer #description` |
| 텍스트 특성 | 0~5,000자 |
| 번역 방식 | **방식 A (인라인 블록)** |
| 캐시 키 | `@handle + ':about:' + 텍스트해시` |

##### 4-4. 영상 탭

| 항목 | 내용 |
|---|---|
| 처리 | 2번(홈 피드)와 **동일** — `ytd-rich-grid-media` 구조 |

##### 4-5. 커뮤니티 게시글

| 항목 | 내용 |
|---|---|
| 셀렉터 | `ytd-backstage-post-thread-renderer` |
| 게시글 본문 | `#content-text yt-formatted-string` |
| 투표 옵션 | `ytd-backstage-poll-renderer #vote-text` |
| 번역 방식 | 본문 — **방식 A (인라인 블록)**, 투표 — **방식 C (인라인 괄호)** |
| 캐시 키 | 게시글 텍스트 해시 |

##### 4-6. 재생목록 탭

| 항목 | 내용 |
|---|---|
| 셀렉터 | `ytd-grid-playlist-renderer` |
| 제목 | `#video-title yt-formatted-string` |
| 번역 방식 | **방식 B (호버 툴팁)** |
| 캐시 키 | 제목 텍스트 |

---

### 5. 재생목록 페이지

**URL**: `/playlist?list={playlist_id}`

**컨테이너 구조**:
```
ytd-browse[page-subtype="playlist"]
  ├── ytd-playlist-header-renderer (헤더)
  │     ├── #title (재생목록 제목)
  │     ├── #description (설명)
  │     └── ytd-channel-name (소유자 채널명)
  └── ytd-section-list-renderer
        └── ytd-playlist-video-list-renderer
              └── ytd-playlist-video-renderer (반복)
                    ├── #video-title (영상 제목)
                    └── ytd-channel-name (채널명)
```

#### 번역 대상 요소

##### 5-1. 재생목록 제목

| 항목 | 내용 |
|---|---|
| 셀렉터 | `ytd-playlist-header-renderer #title yt-formatted-string` |
| 번역 방식 | **방식 A (인라인 블록)** |
| 캐시 키 | `playlist:${list_id}:title` |

##### 5-2. 재생목록 설명

| 항목 | 내용 |
|---|---|
| 셀렉터 | `ytd-playlist-header-renderer #description yt-formatted-string` |
| 번역 방식 | **방식 A (인라인 블록)** |
| 캐시 키 | `playlist:${list_id}:desc` |

##### 5-3. 영상 목록 제목

| 항목 | 내용 |
|---|---|
| 셀렉터 | `ytd-playlist-video-renderer #video-title` |
| 번역 방식 | **방식 B (호버 툴팁)** |
| 캐시 키 | 제목 텍스트 |

---

### 6. Shorts

**URL**: `/shorts/{video_id}`

Shorts는 전체화면 수직 스크롤 UI로 일반 시청 페이지와 완전히 다른 구조.

**컨테이너 구조**:
```
ytd-shorts
  └── ytd-reel-video-renderer (현재 재생 중인 Short)
        ├── #overlay (오버레이 UI)
        │     ├── 제목/설명 (하단)
        │     ├── 채널명
        │     └── 좋아요/댓글 버튼
        └── #comments-button → 댓글 패널 (하단 시트)
```

#### 번역 대상 요소

##### 6-1. Shorts 제목/설명

| 항목 | 내용 |
|---|---|
| 셀렉터 | `ytd-reel-video-renderer yt-formatted-string.reel-video-in-sequence` 또는 `#reel-description-text` |
| 텍스트 특성 | 1~200자, 해시태그 포함 가능 |
| 번역 방식 | **방식 A (인라인 블록)** |
| 삽입 위치 | 설명 텍스트 아래에 번역 블록 (오버레이 위) |
| 캐시 키 | shorts 제목 텍스트 해시 |
| 주의 | 수직 스와이프로 다음 Short 이동 → 현재 보이는 Short만 번역 |
| 주의 | 오버레이 위에 표시되므로 반투명 배경 필요 |

##### 6-2. Shorts 채널명

| 항목 | 내용 |
|---|---|
| 셀렉터 | `ytd-reel-video-renderer ytd-channel-name yt-formatted-string` |
| 번역 방식 | **방식 B (호버 툴팁)** |

##### 6-3. Shorts 댓글

| 항목 | 내용 |
|---|---|
| 셀렉터 | Shorts 댓글 패널 내 `ytd-comment-renderer #content-text` |
| 번역 방식 | **방식 A (인라인 블록)** |
| 처리 | 1-5(댓글)와 **동일** |
| 주의 | 댓글 패널은 하단 시트로 열림 → DOM 추가 시점 감지 |

---

### 7. 구독 피드

**URL**: `/feed/subscriptions`

#### 번역 대상 요소

| 항목 | 내용 |
|---|---|
| 구조 | `ytd-rich-grid-renderer` 내 `ytd-rich-item-renderer` — 홈 피드와 동일 |
| 처리 | 2번(홈 피드)과 **완전 동일** |

---

### 8. 인기 / Explore

**URL**: `/feed/trending`, `/feed/explore`

#### 번역 대상 요소

| 항목 | 내용 |
|---|---|
| 구조 | `ytd-video-renderer` 리스트 또는 `ytd-expanded-shelf-contents-renderer` |
| 처리 | 3-1(영상 검색 결과)과 **유사** — `ytd-video-renderer` 동일 처리 |

---

### 9. 라이브 채팅

**URL**: `/watch?v={video_id}` (라이브 스트림 시)

라이브 채팅은 `<iframe>` 내부에서 렌더링됨 → content script가 별도로 주입되어야 함.

#### 번역 대상 요소

> **이 기능은 기본 OFF (옵션)** — 채팅 메시지가 매우 빠르게 흘러가고, 각 메시지마다 API 호출은 비실용적.

##### 9-1. 일반 채팅 메시지

| 항목 | 내용 |
|---|---|
| 셀렉터 | `yt-live-chat-text-message-renderer #message` |
| 텍스트 특성 | 1~200자 |
| 번역 방식 | **방식 A (인라인 블록, 소형)** — 메시지 아래에 작은 번역 |
| 주의 | 채팅 속도에 따라 큐 관리 필요 — 최대 동시 번역 수 제한 |
| 우선순위 | **낮음 (Phase 3)** |

##### 9-2. 슈퍼챗

| 항목 | 내용 |
|---|---|
| 셀렉터 | `yt-live-chat-paid-message-renderer #message` |
| 번역 방식 | **방식 A (인라인 블록)** |
| 우선순위 | **낮음 (Phase 3)** — 슈퍼챗만 선택적 번역하면 실용적 |

---

### 10. 알림

**위치**: 종 모양 아이콘 클릭 시 드롭다운

#### 번역 대상 요소

| 항목 | 내용 |
|---|---|
| 셀렉터 | `ytd-notification-renderer` |
| 텍스트 | 알림 메시지 (`#message yt-formatted-string`) |
| 번역 방식 | **방식 B (호버 툴팁)** |
| 우선순위 | **낮음 (Phase 3)** — 알림은 일시적 UI |

---

## 번역 제외 대상

다음 요소들은 번역하지 않음:

| 카테고리 | 예시 | 이유 |
|---|---|---|
| **UI 탭/버튼** | ホーム, 急上昇, 登録チャンネル, 後で見る | YouTube 자체 로컬라이제이션 |
| **액션 버튼** | 高く評価, 共有, 保存, 報告 | UI 텍스트 |
| **메타데이터** | 조회수 (`1,234回視聴`), 게시일 (`3日前`) | 숫자/UI 텍스트 |
| **구독자 수** | `チャンネル登録者数 10万人` | UI 텍스트 |
| **카테고리 라벨** | 음악, 게임, 뉴스 | 정적 UI 텍스트 |
| **플레이어 UI** | 자막 버튼, 설정, 화질 메뉴 | UI 텍스트 |
| **광고** | `ytd-ad-*` 요소 전체 | 광고 콘텐츠 |
| **로그인/설정** | `/account`, `/settings`, `/feed/history` | UI 텍스트 |
| **@handle** | `@channel_handle` | 번역 불가 |
| **URL** | `https://...` | 번역 불필요 |
| **타임스탬프** | `0:00`, `1:23:45` | 번역 불필요 |
| **숫자 전용** | 좋아요 수, 댓글 수 | 번역 불필요 |

### 제외 판별 로직

1. **허용 목록 방식**: 번역할 셀렉터를 명시적으로 지정하고, 목록에 없는 요소는 무시
2. `ytd-ad-*` 태그명으로 시작하는 요소 전체 제외
3. `contenteditable="true"` 또는 댓글 작성 영역 (`#creation-box`, `#contenteditable-root`) 제외
4. `#metadata-line` (조회수, 날짜) 내부 요소 제외

---

## 구현 모듈 구조

```
src/content/youtube/
  ├── video-observer.ts           ← [기존] SPA 네비게이션 + 비디오 변경 감지
  ├── subtitle-extractor.ts       ← [기존] 자막 추출
  ├── subtitle-overlay.ts         ← [기존] 자막 오버레이
  ├── caption-bridge.ts           ← [기존] MAIN world 브릿지
  │
  ├── page-observer.ts            ← [신규] 페이지 텍스트 요소 MutationObserver
  ├── title-handler.ts            ← [신규] 영상 제목 + 설명 + 해시태그
  ├── comment-handler.ts          ← [신규] 댓글 + 답글
  ├── feed-handler.ts             ← [신규] 홈/검색/구독 피드 카드
  ├── channel-handler.ts          ← [신규] 채널 헤더 + 커뮤니티 게시글
  └── utils.ts                    ← [신규] YouTube 전용 유틸 (셀렉터, 캐시 키 등)
```

### 감지 흐름

```
index.ts (YouTube 감지)
  │
  ├── 기존: VideoObserver + SubtitleExtractor + SubtitleOverlay (자막 번역)
  │
  └── 신규: PageObserver (페이지 텍스트 번역)
        │
        ├── MutationObserver on document.body (childList + subtree)
        │
        ├── 셀렉터 매칭 → 핸들러 라우팅
        │     ├── ytd-watch-metadata                → title-handler (제목+설명)
        │     ├── ytd-comment-thread-renderer        → comment-handler
        │     ├── ytd-comment-renderer               → comment-handler
        │     ├── ytd-rich-grid-media                → feed-handler
        │     ├── ytd-video-renderer                 → feed-handler
        │     ├── ytd-compact-video-renderer         → feed-handler (사이드바)
        │     ├── ytd-reel-item-renderer             → feed-handler (Shorts)
        │     ├── ytd-channel-renderer               → channel-handler
        │     ├── ytd-backstage-post-thread-renderer → channel-handler (커뮤니티)
        │     ├── ytd-playlist-header-renderer       → title-handler (재생목록)
        │     └── ytd-playlist-video-renderer        → feed-handler
        │
        └── IntersectionObserver (뷰포트 최적화)
              └── 피드 카드 등 대량 요소는 뷰포트 진입 시에만 번역
```

### index.ts 변경

기존 `initYouTubeMode()`에 `PageObserver` 초기화 추가:

```typescript
// 기존 코드
if (settings.youtubeMode) {
  initYouTubeMode();  // 자막 번역
}

// 추가
if (settings.youtubePageTranslation) {  // 새 설정 플래그
  initYouTubePageMode();  // 페이지 텍스트 번역
}
```

### 새 설정 플래그

`UserSettings`에 추가:

```typescript
youtubePageTranslation: boolean;  // 페이지 내 텍스트 번역 (기본: true)
```

자막 번역(`youtubeMode`)과 독립적으로 ON/OFF 가능.

---

## 캐시 전략

### 캐시 키 체계

| 대상 | 캐시 키 | 이유 |
|---|---|---|
| 영상 제목 (시청 페이지) | `videoId` | URL 파라미터로 확정 가능 |
| 영상 설명 | `videoId + ':desc'` | 비디오별 고유 |
| 댓글 | 댓글 텍스트 해시 | 고유 ID 없음 |
| 피드 영상 제목 | 제목 텍스트 해시 | 동일 제목은 같은 번역 |
| 채널명 | 채널명 텍스트 | 동일 이름은 재사용 |
| 해시태그 | 해시태그 텍스트 | 동일 태그는 재사용 |
| 재생목록 제목 | `playlist:${list_id}:title` | list_id로 확정 |
| 커뮤니티 게시글 | 게시글 텍스트 해시 | 고유 ID 없음 |
| 챕터 | `videoId + ':ch:' + 제목` | 비디오+챕터로 확정 |

### 뷰포트 최적화 (IntersectionObserver)

피드 페이지(홈, 검색, 구독, 채널 영상 탭)에서는 카드가 수십~수백 개 나열됨. 모두 즉시 번역하면 API 비용이 과다.

```typescript
// IntersectionObserver로 뷰포트 진입 시에만 번역
const viewportObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      translateElement(entry.target);
      viewportObserver.unobserve(entry.target);
    }
  });
}, { rootMargin: '200px' });  // 200px 여유로 미리 번역
```

### SPA 네비게이션 대응

YouTube SPA 네비게이션 시 페이지 전환 감지:

1. `yt-navigate-finish` 이벤트 리스닝 (YouTube가 발생시키는 커스텀 이벤트)
2. URL 변경 감지 (기존 `VideoObserver`의 URL 폴링과 유사)
3. 페이지 전환 시 이전 페이지의 번역 상태 정리 + 새 페이지 스캔

---

## 구현 우선순위

### Phase 1 (핵심 — 시청 페이지)

- [ ] YouTube 페이지 텍스트 번역 설정 플래그 추가 (`youtubePageTranslation`)
- [ ] `page-observer.ts` — 공유 MutationObserver + 셀렉터 라우팅
- [ ] `utils.ts` — YouTube 전용 셀렉터 상수, 캐시 키 추출, 일본어 판별
- [ ] `title-handler.ts` — 시청 페이지 영상 제목 번역
- [ ] `title-handler.ts` — 영상 설명 번역 (펼침 시)
- [ ] `comment-handler.ts` — 댓글 본문 번역
- [ ] `comment-handler.ts` — 답글 댓글 번역
- [ ] YouTube 다크/라이트 모드 대응 스타일
- [ ] `overlay-styles.css` — YouTube 전용 CSS 추가

### Phase 2 (피드 + 채널)

- [ ] `feed-handler.ts` — 홈 피드 영상 제목 호버 툴팁
- [ ] `feed-handler.ts` — 검색 결과 제목/설명 인라인 블록
- [ ] `feed-handler.ts` — 추천 영상 (사이드바) 호버 툴팁
- [ ] `feed-handler.ts` — 재생목록 영상 제목 호버 툴팁
- [ ] IntersectionObserver 뷰포트 최적화
- [ ] `channel-handler.ts` — 채널 헤더 (이름, 태그라인)
- [ ] `channel-handler.ts` — 채널 정보 (About)
- [ ] `channel-handler.ts` — 커뮤니티 게시글 + 투표
- [ ] SPA 네비게이션 이벤트 대응 (`yt-navigate-finish`)

### Phase 3 (확장/옵션)

- [ ] Shorts 제목/설명 번역
- [ ] Shorts 댓글 번역
- [ ] 시청 페이지 해시태그 인라인 괄호
- [ ] 챕터 제목 인라인 괄호
- [ ] 채널명 호버 툴팁 (시청 페이지, 피드)
- [ ] 라이브 채팅 번역 (기본 OFF, 옵션)
- [ ] 알림 번역 (기본 OFF, 옵션)
- [ ] 팝업/옵션 페이지 UI — YouTube 페이지 번역 토글 추가
