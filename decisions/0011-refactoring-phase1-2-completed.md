# Phase 1~2 리팩토링: 공유 인프라 정비 및 렌더링 통합

Status: accepted
Date: 2026-02-19

## Context

문서화 단계에서 발견된 5가지 구조적 문제(DOM 감지 3중 구현, ProcessedTracker 미적용, 재시작 조건 복사, 렌더링 비일관성, HoverPopup 불필요 래퍼)를 해결하기 위해 Phase 1~2 리팩토링을 실행했다. `docs/refactoring-guide.md`의 상세 가이드를 기반으로 하되, 실행 단계에서 비용 대비 이득을 재평가하여 일부 조정했다.

## Decision

7개 변경을 단일 커밋(`192d71f`)으로 실행:

**Phase 1 (공유 인프라):**
1. TwitterObserver → BatchedObserver 전환, `twitter/observer.ts` 삭제 (-248줄)
2. Webpage에 ProcessedTracker 적용 (InlineTranslator, TextDetector에 주입)
3. `needsRenderRestart()` 공유 함수 추출 (`handlers/types.ts`)
4. `isJapaneseShortText`를 `shared/dom-utils.ts`로 이동, `twitter/utils.ts`에서 re-export

**Phase 2 (렌더링 통합):**
5. FuriganaInjector를 textNode 파괴적 교체 → createRubyClone 비파괴적 방식 전환
6. InlineTranslator의 수동 div 조립 → createInlineBlock 사용 (spoiler 자동 적용)
7. HoverPopup 래퍼 제거, WebpageSiteHandler에서 HoverTooltip 직접 사용

**스킵:** 4.2(TextDetector 배치 인프라 공유)는 실행하지 않음.

## Consequences

### Positive
- DOM 감지 패턴이 Twitter·YouTube·Webpage 모두 BatchedObserver 또는 그에 준하는 패턴 사용
- ProcessedTracker가 모든 핸들러에 적용되어 상태 관리 일관성 확보
- Webpage가 Twitter·YouTube와 동일한 렌더러(createInlineBlock, createRubyClone, HoverTooltip) 사용
- 파일 2개 삭제, 순 코드 ~300줄 감소
- 재시작 조건 변경 시 1곳만 수정하면 됨

### Negative
- TextDetector는 여전히 자체 배치 로직 유지 (BatchedObserver와 ~30줄 중복)
- Webpage furigana-only 모드에서 block 단위 처리로 전환됨에 따라, 기존 textNode 단위보다 큰 단위로 morphological analysis 호출 (성능 영향 미미할 것으로 예상)
- InlineTranslator의 inline furigana(textNode 교체 방식)는 아직 createRubyClone으로 미전환 — inline 모드의 furigana는 여전히 파괴적 방식

## Alternatives Considered

- **4.2 TextDetector 배치 공유 실행**: MutationBatcher 공유 클래스를 추출하여 TextDetector와 BatchedObserver에서 사용. 중복이 ~30줄에 불과하고 TextDetector의 워킹 방식(walkTextNodes→findBlockParent)이 셀렉터 기반과 근본적으로 달라 추상화 비용 대비 이득이 낮아 스킵.
- **7개 커밋으로 분리**: 계획에서는 커밋 1~7로 분리를 권장했으나, 모두 동일 세션에서 연속 구현되어 중간 상태 검증이 빌드 통과로 충분했고, 단일 커밋이 bisect 필요성 대비 리뷰 편의성에서 유리하다고 판단.
- **InlineTranslator furigana도 createRubyClone 전환**: inline 모드의 furigana는 번역 결과의 tokens를 사용하여 textNode에 직접 주입하는 방식인데, createRubyClone은 element 단위 클론이므로 번역 블록과의 DOM 배치가 복잡해진다. FuriganaInjector(furigana-only 모드)만 전환하고 inline 모드의 furigana는 현행 유지.

## References

- Plan: `docs/refactoring-guide.md` (Phase 1~2 상세 가이드)
- Related: `docs/tech/integration_architecture.md` 7절 (5-Phase 로드맵)
- Related: `docs/tech/twitter_tech.md` 2절 (BatchedObserver 사용으로 갱신됨)
