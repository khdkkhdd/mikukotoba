# Context Invalidation 자동 복구: PING + scripting 재주입

Status: accepted
Date: 2026-02-21

## Context

Chrome MV3에서 service worker가 비활성 후 종료되면 기존 content script의 `chrome.runtime`이 무효화된다. 이 상태에서 확장 기능이 완전히 마비되며, 유일한 해결책이 페이지 새로고침이었다. 장시간 방치 후 브라우저로 복귀하는 시나리오에서 반복적으로 발생.

## Decision

Service worker에서 탭 활성화/창 포커스 복귀 시 content script에 PING 메시지를 보내고, 응답이 없으면 `chrome.scripting.executeScript`로 자동 재주입한다.

- `MessageType`에 `PING` 추가, content script에서 `{ alive: true }` 응답
- `cleanupPreviousInstance()`로 이전 인스턴스의 UI 오버레이 제거 (번역 결과는 유지)
- 스타일 `<style>` 태그에 id 부여하여 재주입 시 중복 방지
- `tabs.onActivated` + `windows.onFocusChanged` 두 이벤트로 트리거
- `tab.status === 'complete'` + `tab.url.startsWith('http')` 가드로 안전성 확보

## Consequences

### Positive
- 페이지 새로고침 없이 자동 복구 — 사용자 경험 대폭 개선
- 기존 번역 결과가 DOM에 유지되어 시각적 끊김 최소화
- Kuromoji 재로딩 (1-3초) 외에는 즉시 복구

### Negative
- `scripting` 권한 추가 필요 (권한 목록 증가)
- 탭 전환마다 PING 메시지 발생 (정상 상태에서도). 오버헤드는 무시할 수준
- Kuromoji 사전 재로딩 시간 불가피 (1-3초)

## Alternatives Considered

- **콘솔 경고만 표시 (현재 방식)**: 사용자가 직접 새로고침해야 함. UX 불량으로 거부.
- **content script에서 자체 감지 + location.reload()**: 사용자 동의 없이 페이지 새로고침은 공격적. 입력 중인 데이터 손실 위험.
- **Keep-alive (주기적 alarm으로 SW 유지)**: MV3 설계 의도에 반함. Chrome이 언제든 종료할 수 있어 근본 해결이 아님.
- **storage.onChanged 기반 통신**: `chrome.runtime` 없이도 동작하지만, 양방향 통신이 복잡하고 content script의 다른 API 호출(`sendMessage` 등)은 여전히 실패.

## References

- Plan: context-reinject.md
- Related: `packages/extension/src/background/service-worker.ts`, `packages/extension/src/content/index.ts`
