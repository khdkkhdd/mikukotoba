# Goal

Extension context invalidation 시 에러 스팸 방지 + 자동 복구 개선. `chrome.runtime.id`가 undefined가 되면 (extension 업데이트/리로드) content script가 죽는데, 이때 번역 시도마다 에러가 연쇄적으로 터지고 수동 새로고침이 필요했음.

# Research

## Context Invalidation 발생 조건

- Extension 업데이트, 리로드, 비활성화 시 `chrome.runtime.id` → undefined
- Service worker idle timeout(5분)은 `chrome.runtime.id`에 영향 없음
- Content script의 `chrome.runtime.onMessage` 리스너도 죽음 → 서비스 워커에서 PING 실패

## 에러 전파 경로

1. DOM 변경 → BatchedObserver flush (requestIdleCallback) → handler callback
2. handler → `translator.translate()` → `apiFetch()` → `bgFetch()` → `checkContext()` throw
3. Translator catch: `FAIL [papago]` 로그 + fallback 시도 → 또 실패
4. 같은 flush 사이클에서 여러 요소가 동시 처리 → 에러 스팸

## 기존 pingAndReinject 메커니즘

- `service-worker.ts`의 `pingAndReinject(tabId)`: PING 실패 시 content script 재주입
- 트리거: `tabs.onActivated` (탭 전환), `windows.onFocusChanged` (윈도우 포커스)
- 누락: `runtime.onInstalled` — extension 리로드 직후 전체 탭 재주입 안 함

## 파일 참조

- `packages/extension/src/content/index.ts:353` — `checkContext()`, `bgFetch()`
- `packages/extension/src/core/translator/index.ts:265-306` — engine selection + fallback
- `packages/extension/src/background/service-worker.ts:544` — `pingAndReinject()`

# Plan

## Decisions

- **에러 식별**: `checkContext()`에서 `err.name = 'ContextInvalidated'` 설정. 문자열 매칭 대신 name 프로퍼티로 식별
- **Translator 가드**: context invalidation 시 fallback/로그 없이 즉시 re-throw. 일반 API 실패와 구분
- **Handler 가드**: 모든 handler catch에서 `ContextInvalidated` 시 조용히 return
- **onInstalled 재주입**: extension 리로드 시 전체 http 탭에 `pingAndReinject` 실행
- **두 수정 모두 필요**: onInstalled 재주입과 에러 가드는 상호보완. 재주입 완료 전 타이밍 갭에 죽은 script의 flush가 실행될 수 있음

## Steps

- [x] `checkContext()`에 `ContextInvalidated` name 추가
- [x] Translator: LLM/Papago catch에서 ContextInvalidated 즉시 re-throw
- [x] 모든 handler catch에 ContextInvalidated 가드 추가
- [x] `onInstalled`에서 전체 탭 `pingAndReinject` 추가
- [x] 빌드 확인
- [ ] 커밋

# Progress

## 완료

모든 코드 수정 및 빌드 통과.

## 변경 파일

- `packages/extension/src/content/index.ts` — checkContext sentinel name, vocab add 가드
- `packages/extension/src/core/translator/index.ts` — LLM/Papago fallback 가드
- `packages/extension/src/content/youtube/page-handler.ts` — processElement, processRichContent 가드
- `packages/extension/src/content/youtube/subtitle-handler.ts` — translation error 가드
- `packages/extension/src/content/twitter/tweet-handler.ts` — 3개 catch 가드
- `packages/extension/src/content/twitter/trend-handler.ts` — trend 가드
- `packages/extension/src/content/twitter/user-handler.ts` — bio, hover+furigana 가드
- `packages/extension/src/content/webpage/inline-translator.ts` — inline 가드
- `packages/extension/src/background/service-worker.ts` — onInstalled 전체 탭 재주입
