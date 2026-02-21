# Context Invalidation 에러 억제 + onInstalled 전체 탭 재주입

Status: accepted
Date: 2025-02-22

## Context

Extension 업데이트/리로드 시 content script의 `chrome.runtime.id`가 undefined가 되어 context가 무효화된다. 이 상태에서 DOM 변경(브라우저 리사이즈 등)이 발생하면 observer flush → translator → bgFetch → checkContext에서 에러가 throw되고, translator가 이를 일반 API 실패로 취급하여 fallback 시도 + FAIL 로그를 찍는 과정이 요소 수만큼 반복된다. 기존 `pingAndReinject`는 탭 전환/윈도우 포커스 시에만 트리거되어, 같은 탭에서 리사이즈만 하면 복구되지 않았다.

## Decision

두 가지 수정을 동시 적용:

1. **에러 식별 + 조기 중단**: `checkContext()`에서 throw하는 에러에 `name = 'ContextInvalidated'` 설정. Translator는 이 에러를 감지하면 fallback/로그 없이 즉시 re-throw. 모든 handler catch에서 `ContextInvalidated`이면 조용히 return.

2. **onInstalled 전체 탭 재주입**: `chrome.runtime.onInstalled`에서 모든 http 탭에 `pingAndReinject` 실행하여 죽은 content script를 즉시 교체.

## Consequences

### Positive
- Context 무효화 시 콘솔에 경고 1회만 출력, 에러 스팸 제거
- Extension 리로드 직후 탭 전환 없이도 content script 자동 복구
- Translator의 불필요한 fallback 호출 방지 (죽은 bgFetch로 Papago 실패 → LLM도 실패하는 무의미한 체인 제거)

### Negative
- 모든 handler catch에 `ContextInvalidated` 가드 코드가 반복됨 (9곳)
- onInstalled 재주입과 에러 가드 사이에 여전히 미세한 타이밍 갭 존재 (flush가 먼저 실행될 수 있음) — 가드가 이 갭을 커버

## Alternatives Considered

- **에러 가드만 적용 (onInstalled 재주입 없이)**: 에러는 조용해지지만 content script가 죽은 채로 남아 사용자가 수동 새로고침 필요. 근본 해결 아님.
- **onInstalled 재주입만 적용 (에러 가드 없이)**: 재주입 완료 전 타이밍 갭에서 에러 스팸 발생. 재주입이 빠르더라도 requestIdleCallback이 먼저 실행될 수 있음.
- **Content script에서 주기적 `chrome.runtime.id` 체크 (setInterval)**: 불필요한 폴링 오버헤드. 어차피 context가 죽으면 observer도 곧 정리되므로 과도한 방어.

## References

- Plan: context.md
- Related: `decisions/0049-context-invalidation-auto-recovery.md`, `packages/extension/src/content/index.ts`, `packages/extension/src/background/service-worker.ts`
