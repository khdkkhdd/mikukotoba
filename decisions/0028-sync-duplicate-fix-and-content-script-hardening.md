# 동기화 중복 버그 수정 및 Content Script 안정성 강화

Status: accepted
Date: 2026-02-20

## Context

다중 기기 동기화 시 단어장에 동일 단어가 3중으로 표시되는 버그 발생. 원인은 `rebuildLocalIndex()`가 `jp_vocab_search_flat` 키를 날짜 파티션으로 잘못 인식하여 검색 인덱스 엔트리가 단어 카드로 렌더링되고, Drive에까지 push되어 모바일로 전파됨. 추가로 content script에서 CSS preload 실패 에러와 extension context invalidated 에러가 반복 발생.

## Decision

**동기화 중복 (근본 원인)**: `rebuildLocalIndex()`에서 `jp_vocab_search_flat` 키를 명시적으로 제외. pull 루프에서 `YYYY-MM-DD` 정규식으로 날짜 키를 검증하여 향후 키 충돌도 방지. 모바일 pull에도 동일 검증 적용. 오염된 인덱스 자동 정리를 위해 pull 후 인덱스에 invalid date가 있으면 rebuild 실행.

**CSS preload**: `vite.config.ts`에 `build.modulePreload: false` 설정. CRXJS가 manifest `content_scripts.css`로 이미 CSS를 주입하므로 Vite의 preload는 불필요.

**Context invalidation**: `bgFetch` 진입 시 `chrome.runtime.id` 체크 가드 추가. 무효화 감지 시 `cleanupAll()` 1회 실행 후 이후 호출 즉시 차단.

## Consequences

### Positive
- 다중 기기 동기화 시 단어 중복 제거
- Drive에 잘못된 파티션(`vocab_search_flat.json`) 더 이상 push되지 않음
- YouTube 등에서 CSS preload 에러 제거
- 확장 리로드 후 기존 탭에서 에러 스팸 제거

### Negative
- Drive에 이미 존재하는 `vocab_search_flat.json`은 자동 삭제되지 않음 (무시만 됨)
- `rebuildLocalIndex`의 `get(null)` 호출은 데이터가 많을 때 비용이 있으나, invalid date 감지 시에만 실행되므로 실질적 영향 없음

## Alternatives Considered

- **매 sync마다 `rebuildLocalIndex` 실행**: 간단하지만 `chrome.storage.local.get(null)`이 전체 데이터를 메모리에 로드하므로 데이터 축적 시 성능 저하. 인덱스 체크 후 조건부 실행으로 대체.
- **스토리지 키 접두사 변경** (`jp_vocab_` → `jp_vocabdate_`): 근본적이지만 마이그레이션 복잡도가 높고 기존 데이터 호환성 문제.
- **`vite:preloadError` 이벤트 리스너로 에러 억제**: 근본 원인을 해결하지 않고 증상만 숨기므로 기각.

## References

- Plan: context.md
- Related: `packages/extension/src/core/drive-sync.ts`, `packages/extension/src/core/vocab-storage.ts`, `packages/mobile/src/services/sync.ts`, `packages/extension/vite.config.ts`, `packages/extension/src/content/index.ts`
