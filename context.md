# Goal

JP Helper Chrome Extension을 리팩토링한다. 문서화 단계에서 드러난 구조적 중복과 사이트 간 비일관성을 해소하여, 공유 인프라 위에서 사이트별 핸들러가 일관된 패턴으로 동작하게 만든다.

성공 기준: Phase 1~2 완료 시 — DOM 감지 3중 구현 통합, ProcessedTracker 전면 적용, 렌더링 경로 일관화

# Research

## 모듈 구조

- **Core**: `src/core/` — translator, analyzer, cache, glossary, vocab-storage, logger
- **Shared**: `src/content/shared/` — batched-observer, processed-tracker, dom-utils, status-indicator, renderers/
- **Handler**: `src/content/{twitter,youtube,webpage}/` — 사이트별 핸들러
- **의존성 규칙**: Handler → Shared → Core (역방향 없음)

## 문서 체계

| 종류 | 위치 | 수량 |
|---|---|---|
| 기능 명세 | `docs/` | 5개 |
| 기술 명세 | `docs/tech/` | 5개 |
| 리팩토링 가이드 | `docs/refactoring-guide.md` | Phase 1~5 상세 |
| 의사결정 | `decisions/` | 0001~0009 |

# Plan

## Decisions

- 4.2(TextDetector 배치 공유)는 중복 ~30줄로 비용 대비 이득 낮아 스킵 (실행 계획에서 결정)
- Phase 1~2를 단일 커밋으로 통합 (7개 논리적 변경을 하나의 커밋 `192d71f`로)
- FuriganaInjector를 textNode 단위 파괴적 교체에서 element 단위 createRubyClone 비파괴적 방식으로 전환
- InlineTranslator의 cleanup()은 ProcessedTracker.cleanup()에 위임

## Steps

### Phase 3 (판별·성능)

상세 가이드: `docs/refactoring-guide-phase3-5.md`

- [x] 3.1: Webpage IntersectionObserver 뷰포트 우선 처리 — `text-detector.ts` scan()에서 뷰포트 외 요소를 IntersectionObserver로 defer
- [x] 3.2: Webpage SPA 네비게이션 대응 — popstate + hashchange + URL 폴링, 네비게이션 시 cleanup + 점진적 재스캔
- [x] 3.3: YouTube VideoObserver 이벤트 통합 — `yt-navigate-finish` 이벤트 추가, 폴링 1000ms→5000ms
- 3.4: Twitter 뷰포트 우선 처리 — 스킵 (가상 스크롤로 필요성 낮음)

### Phase 4~5 (미착수)

- **Phase 4 (단어장 연동)**: 단어 클릭→단어장, 용어집↔단어장 연동, JSON 가져오기
- **Phase 5 (번역 파이프라인)**: 컨텍스트-인식 캐시 키, 프롬프트 템플릿화, 요청 큐잉/병합

# Progress

- [x] 기능 명세 5개
- [x] 기술 명세 5개 + 정확성 점검 34건 수정
- [x] 통합 아키텍처 문서 (`docs/tech/integration_architecture.md`)
- [x] **Phase 1: 공유 인프라 정비** (커밋 `192d71f`)
  - [x] TwitterObserver → BatchedObserver 전환, `twitter/observer.ts` 삭제
  - [x] Webpage에 ProcessedTracker 적용 (InlineTranslator, TextDetector)
  - [x] 재시작 조건 `needsRenderRestart()` 공유 함수 추출 (handlers/types.ts)
  - [x] `isJapaneseShortText`를 `shared/dom-utils.ts`로 이동
- [x] **Phase 2: 렌더링 통합** (커밋 `192d71f`)
  - [x] Webpage 후리가나 → createRubyClone 비파괴적 전환
  - [x] Webpage inline → createInlineBlock 전환 (spoiler 포함)
  - [x] HoverPopup 래퍼 제거, `webpage/hover-popup.ts` 삭제
- [x] **Phase 3: 판별·성능 최적화**
  - [x] 3.1: TextDetector IntersectionObserver 뷰포트 defer (`text-detector.ts`)
  - [x] 3.2: Webpage SPA 네비게이션 대응 (`webpage/index.ts`)
  - [x] 3.3: VideoObserver `yt-navigate-finish` 이벤트 통합 (`video-observer.ts`)
- [ ] Phase 4~5: 미착수

## 삭제된 파일

- `src/content/twitter/observer.ts` — BatchedObserver 전환으로 제거
- `src/content/webpage/hover-popup.ts` — HoverTooltip 직접 사용으로 제거
