# Phase 3 판별·성능 최적화 완료

Status: accepted
Date: 2026-02-19

## Context

Phase 1~2에서 공유 인프라와 렌더링을 통합한 뒤, 성능·판별 영역의 세 가지 문제가 남아 있었다: TextDetector의 IntersectionObserver 미활성, Webpage SPA 미대응, VideoObserver의 비효율적 URL 폴링.

## Decision

### 3.1 TextDetector IntersectionObserver 뷰포트 우선 처리

`scan()`에서 `isNearViewport()` (getBoundingClientRect, ±200px 마진)으로 블록을 분류. 뷰포트 내 블록은 즉시 `onDetected()`, 뷰포트 밖 블록은 `IntersectionObserver.observe()`로 defer하여 스크롤 시 처리. Deferred 블록은 markProcessed하지 않아 IntersectionObserver 콜백에서 `scan(el)` 재호출 시 자연스럽게 처리.

### 3.2 Webpage SPA 네비게이션 대응

세 가지 감지 방법 병행: `popstate` (뒤로가기/앞으로가기), `hashchange` (해시 라우팅), URL 폴링 1초 (pushState 대응). 네비게이션 감지 시 `tracker.cleanup()` → TextDetector 재시작 → 점진적 재스캔 [500, 1500, 3000]ms. tracker 객체는 교체하지 않고 `cleanup()`으로 내부 상태만 초기화하여 sub-module 참조 유지.

### 3.3 VideoObserver yt-navigate-finish 이벤트 통합

`yt-navigate-finish` 이벤트를 주 감지 수단으로 추가. `setInterval` 폴링을 1000ms→5000ms로 감소하여 보조 수단으로 유지 (자동재생, 플레이리스트 등 이벤트 미발화 대비).

### 3.4 Twitter 뷰포트 우선 처리 — 스킵

Twitter는 가상 스크롤로 화면에 보이는 요소만 DOM에 존재하므로 뷰포트 최적화 필요성 낮음.

## Consequences

### Positive
- 긴 페이지 초기 로딩 시 뷰포트 내 요소만 우선 번역하여 체감 성능 향상
- SPA 사이트에서 페이지 전환 후 새 일본어 콘텐츠 자동 감지·번역
- YouTube 영상 전환 감지 지연 감소 (최대 1초→즉시, 폴링은 5초 보조)

### Negative
- URL 폴링(1초)이 pushState 대응의 유일한 수단 — ISOLATED world 제약으로 pushState 래핑 불가
- `isNearViewport()`의 `getBoundingClientRect()` 호출이 scan() 시 layout 발생 가능 (단, 이미 flush()는 requestIdleCallback 내에서 실행)

## Alternatives Considered

- **SPA: MAIN world 스크립트 주입으로 pushState 래핑**: YouTube의 caption-bridge.ts 패턴 참고. Rejected — 범용 웹페이지에서 MAIN world 스크립트 주입은 CSP 충돌 위험, MutationObserver + URL 폴링으로 충분
- **SPA: tracker 객체 교체**: 네비게이션 시 new ProcessedTracker 생성. Rejected — sub-module(InlineTranslator, TextDetector)에 새 참조를 전파해야 하는 복잡성. cleanup()으로 동일 객체 재사용이 더 단순
- **VideoObserver: 폴링 완전 제거**: yt-navigate-finish만 사용. Rejected — 자동재생, 플레이리스트 다음 영상 등에서 이벤트 미발화 가능성, 5초 폴링으로 안전망 유지

## References

- Plan: `docs/refactoring-guide-phase3-5.md` 3절
- Related: `src/content/webpage/text-detector.ts`, `src/content/webpage/index.ts`, `src/content/youtube/video-observer.ts`
- Commit: `47297c8`
