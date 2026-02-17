# YouTube 인라인 번역 — 요약

> 상세 계획: [youtube-translation-plan.md](./youtube-translation-plan.md)

## 현재 상태

YouTube 핸들러는 **자막 번역만** 구현됨 (4개 파일):

| 파일 | 역할 |
|---|---|
| `video-observer.ts` | SPA 네비게이션 + 비디오 변경 감지 |
| `subtitle-extractor.ts` | 자막 추출 (TextTrack / TimedText API / DOM) |
| `subtitle-overlay.ts` | 자막 오버레이 (Shadow DOM, 비디오 플레이어 위) |
| `caption-bridge.ts` | MAIN world 브릿지 (YouTube Player API 접근) |

---

## YouTube 기술적 특성

| 항목 | Twitter | YouTube |
|---|---|---|
| 프레임워크 | React Native for Web | Polymer/Lit Web Components |
| 안정 셀렉터 | `data-testid` 속성 | `ytd-*` 커스텀 엘리먼트 태그명 + `#id` |
| CSS 클래스 | 난독화 (사용 불가) | 안정적 (보조적 사용 가능) |
| 가상 스크롤 | 매우 공격적 | 댓글에서만 제한적 |
| 테마 | — | `html[dark]` 속성으로 라이트/다크 전환 |

---

## 번역 표시 방식

| 방식 | 용도 | 적용 대상 |
|---|---|---|
| **A. 인라인 블록** | 문장 단위 콘텐츠 | 영상 제목(시청), 설명, 댓글, 커뮤니티 게시글 |
| **B. 호버 툴팁** | 짧은 텍스트 | 채널명, 피드 영상 제목, 재생목록 제목 |
| **C. 인라인 괄호** | 한 줄 텍스트 | 해시태그, 챕터 제목, 투표 옵션 |

---

## 페이지별 번역 대상

### 1. 시청 페이지 (`/watch?v=...`)

| 요소 | 셀렉터 | 방식 |
|---|---|---|
| 영상 제목 | `ytd-watch-metadata h1 yt-formatted-string` | A |
| 채널명 | `#channel-name yt-formatted-string a` | B |
| 영상 설명 | `ytd-text-inline-expander #structured-description` | A (펼침 시만) |
| 해시태그 | `ytd-watch-metadata #super-title a` | C |
| 댓글 본문 | `ytd-comment-thread-renderer #content-text` | A |
| 답글 | `#replies ytd-comment-renderer #content-text` | A |
| 댓글 작성자 | `#author-text yt-formatted-string` | B |
| 챕터 제목 | `ytd-macro-markers-list-item-renderer #details h4` | C |
| 추천 영상 제목 | `ytd-compact-video-renderer #video-title` | B |

### 2. 홈 피드 (`/`)

| 요소 | 셀렉터 | 방식 |
|---|---|---|
| 영상 제목 | `ytd-rich-grid-media #video-title-link yt-formatted-string` | B |
| 채널명 | `ytd-rich-grid-media ytd-channel-name yt-formatted-string` | B |
| Shorts 제목 | `ytd-reel-item-renderer #shorts-title` | B |

### 3. 검색 결과 (`/results?search_query=...`)

| 요소 | 셀렉터 | 방식 |
|---|---|---|
| 영상 제목 | `ytd-video-renderer #video-title yt-formatted-string` | A |
| 설명 미리보기 | `ytd-video-renderer #description-text yt-formatted-string` | A |
| 채널명 | `ytd-channel-name yt-formatted-string` | B |
| 채널 결과 설명 | `ytd-channel-renderer #description yt-formatted-string` | A |
| 재생목록 결과 | `ytd-playlist-renderer #video-title yt-formatted-string` | A |

### 4. 채널 페이지 (`/@channel`)

| 요소 | 셀렉터 | 방식 |
|---|---|---|
| 채널명 (헤더) | `#channel-header #channel-name yt-formatted-string` | B |
| 태그라인 | `#channel-header #channel-tagline yt-formatted-string` | A |
| 정보 (About) | `ytd-channel-about-metadata-renderer #description` | A |
| 커뮤니티 게시글 | `ytd-backstage-post-thread-renderer #content-text` | A |
| 투표 옵션 | `ytd-backstage-poll-renderer #vote-text` | C |
| 영상 탭 | = 홈 피드 동일 | B |

### 5. 재생목록 (`/playlist?list=...`)

| 요소 | 셀렉터 | 방식 |
|---|---|---|
| 재생목록 제목 | `ytd-playlist-header-renderer #title yt-formatted-string` | A |
| 재생목록 설명 | `ytd-playlist-header-renderer #description yt-formatted-string` | A |
| 영상 제목 | `ytd-playlist-video-renderer #video-title` | B |

### 6. Shorts (`/shorts/...`)

| 요소 | 셀렉터 | 방식 |
|---|---|---|
| 제목/설명 | `ytd-reel-video-renderer #reel-description-text` | A |
| 채널명 | `ytd-reel-video-renderer ytd-channel-name yt-formatted-string` | B |
| 댓글 | 댓글 패널 내 `ytd-comment-renderer #content-text` | A |

### 7. 구독 피드 (`/feed/subscriptions`)

홈 피드(2번)와 **완전 동일**.

### 8. 인기/Explore (`/feed/trending`)

검색 결과(3번)와 **유사** — `ytd-video-renderer` 동일 처리.

### 9. 라이브 채팅 (기본 OFF)

| 요소 | 셀렉터 | 방식 |
|---|---|---|
| 일반 메시지 | `yt-live-chat-text-message-renderer #message` | A (소형) |
| 슈퍼챗 | `yt-live-chat-paid-message-renderer #message` | A |

### 10. 알림 (기본 OFF)

| 요소 | 셀렉터 | 방식 |
|---|---|---|
| 알림 텍스트 | `ytd-notification-renderer #message yt-formatted-string` | B |

---

## 신규 모듈 구조

```
src/content/youtube/
  ├── video-observer.ts           ← [기존 유지]
  ├── subtitle-extractor.ts       ← [기존 유지]
  ├── subtitle-overlay.ts         ← [기존 유지]
  ├── caption-bridge.ts           ← [기존 유지]
  │
  ├── page-observer.ts            ← [신규] MutationObserver + 셀렉터 라우팅
  ├── title-handler.ts            ← [신규] 영상 제목 + 설명 + 해시태그
  ├── comment-handler.ts          ← [신규] 댓글 + 답글
  ├── feed-handler.ts             ← [신규] 홈/검색/구독 피드 카드
  ├── channel-handler.ts          ← [신규] 채널 헤더 + 커뮤니티 게시글
  └── utils.ts                    ← [신규] 셀렉터 상수, 캐시 키 추출 유틸
```

---

## 핵심 최적화

- **IntersectionObserver**: 피드 카드(홈, 검색, 구독)는 뷰포트 진입 시에만 번역 → API 비용 절약
- **`yt-navigate-finish` 이벤트**: YouTube SPA 네비게이션 감지 → 페이지 전환 시 상태 정리
- **`html[dark]` 감지**: 라이트/다크 모드 자동 대응
- **설명 펼침 감지**: 접힌 상태에서는 번역하지 않음 (텍스트가 잘려있으므로)

---

## 구현 우선순위

### Phase 1 — 시청 페이지 핵심

- `page-observer.ts` + `utils.ts` 기반 구조
- 영상 제목 번역 (방식 A)
- 영상 설명 번역 (펼침 시, 방식 A)
- 댓글/답글 번역 (방식 A)
- YouTube 다크/라이트 모드 CSS

### Phase 2 — 피드 + 채널

- 홈/검색/구독 피드 영상 제목 (방식 B, 호버)
- 검색 결과 제목/설명 (방식 A)
- 추천 영상 사이드바 (방식 B)
- IntersectionObserver 뷰포트 최적화
- 채널 헤더/정보/커뮤니티
- SPA 네비게이션 대응

### Phase 3 — 확장/옵션

- Shorts 번역
- 해시태그/챕터 인라인 괄호
- 채널명 호버 툴팁
- 라이브 채팅 (기본 OFF)
- 알림 (기본 OFF)
- 팝업/옵션 페이지 UI 토글
